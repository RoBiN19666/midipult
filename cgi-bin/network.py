#!/opt/bin/python3
# -*- coding: utf-8 -*-
"""Wi-Fi колонки: состояние, скан, подключение к сети.

    GET  /cgi-bin/network.py                — текущая сеть
    POST /cgi-bin/network.py {"action":"scan"}
    POST /cgi-bin/network.py {"action":"connect","ssid":"...","psk":"..."}
    POST /cgi-bin/network.py {"action":"forget","ssid":"..."}

Подключение идёт через wpa_cli. Если новая сеть не поднялась за 25 секунд,
возвращаемся к прежней — чтобы не потерять доступ к пульту.
"""

from __future__ import annotations

import ipaddress
import json
import os
import re
import socket
import struct
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402

WPA = "/usr/sbin/wpa_cli"
IFACE = "wlan0"
INIT = "/etc/init.d/S70unbound"
UNBOUND_BIN = "/usr/sbin/unbound"
PIDFILE = "/var/run/unbound.pid"
UNBOUND = "/etc/unbound/unbound.conf"
UNBOUND_BACKUP = "/data/mypult/unbound.conf.bak"
DNS_STATE = "/data/mypult/dns.json"


def wpa(*args, timeout=12):
    code, out, err = common.run([WPA, "-i", IFACE] + list(args), timeout=timeout)
    return code, (out or ""), (err or "")


def parse_status():
    _, out, _ = wpa("status")
    data = {}
    for line in out.splitlines():
        if "=" in line:
            key, value = line.split("=", 1)
            data[key.strip()] = value.strip()
    return data


def signal_level():
    code, out, _ = common.run(["/usr/sbin/iw", "dev", IFACE, "link"], timeout=6)
    match = re.search(r"signal:\s*(-?\d+)", out or "")
    return int(match.group(1)) if match else None


def list_networks():
    _, out, _ = wpa("list_networks")
    result = []
    seen = set()
    for line in out.splitlines()[1:]:
        parts = line.split("\t")
        if len(parts) >= 2 and parts[0].strip().isdigit():
            ssid = parts[1]
            if ssid in seen:
                continue
            seen.add(ssid)
            result.append({"id": int(parts[0]), "ssid": ssid, "flags": parts[-1]})
    return result


def gateway():
    code, out, _ = common.run(["/sbin/ip", "route"], timeout=6)
    match = re.search(r"default via (\d+\.\d+\.\d+\.\d+)", out or "")
    return match.group(1) if match else None


def address_info():
    code, out, _ = common.run(["/sbin/ip", "-4", "-o", "addr", "show", IFACE], timeout=6)
    match = re.search(r"inet (\d+\.\d+\.\d+\.\d+)/(\d+)", out or "")
    if not match:
        return None, None
    return match.group(1), int(match.group(2))


def resolv_nameservers():
    try:
        with open("/etc/resolv.conf", "r", encoding="utf-8") as fh:
            return [line.split()[1] for line in fh
                    if line.startswith("nameserver") and len(line.split()) > 1]
    except OSError:
        return []


def dns_servers():
    try:
        with open(UNBOUND, "r", encoding="utf-8") as fh:
            return re.findall(r'forward-addr:\s*"([^"]+)"', fh.read())
    except OSError:
        return []


def clean_servers(servers):
    """Проверить forward-адреса: только реальные IP, без scope-id и link-local."""
    clean = []
    for item in servers:
        item = str(item).strip()
        if not item:
            continue
        if "%" in item:
            raise RuntimeError("адрес со scope-id не подходит: %s" % item)
        try:
            address = ipaddress.ip_address(item)
        except ValueError:
            raise RuntimeError("не IP-адрес: %s" % item)
        if address.version == 6 and address.is_link_local:
            raise RuntimeError("link-local IPv6 не годится как forwarder: %s" % item)
        if item not in clean:
            clean.append(item)
    if not clean:
        raise RuntimeError("нужен хотя бы один DNS-сервер")
    return clean


def port53_listening():
    try:
        with open("/proc/net/udp", "r", encoding="ascii") as fh:
            lines = fh.read().splitlines()[1:]
    except OSError:
        return False
    for line in lines:
        parts = line.split()
        if len(parts) < 2:
            continue
        try:
            port = int(parts[1].split(":")[1], 16)
        except (IndexError, ValueError):
            continue
        if port == 53:
            return True
    return False


def dns_probe(timeout=1.5):
    """Спросить локальный резолвер про A-запись: жив ли unbound."""
    query_id = int.from_bytes(os.urandom(2), "big")
    header = struct.pack("!HHHHHH", query_id, 0x0100, 1, 0, 0, 0)
    qname = b"".join(bytes([len(part)]) + part.encode("ascii")
                     for part in "ya.ru".split(".")) + b"\x00"
    packet = header + qname + struct.pack("!HH", 1, 1)
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.settimeout(timeout)
        sock.sendto(packet, ("127.0.0.1", 53))
        data, _ = sock.recvfrom(512)
        return len(data) > 12
    except OSError:
        return False
    finally:
        sock.close()


def ensure_loopback_ipv6():
    """unbound слушает и ::1: без адреса на loopback он не стартует."""
    path = "/proc/sys/net/ipv6/conf/lo/disable_ipv6"
    try:
        with open(path, "r", encoding="ascii") as fh:
            if fh.read().strip() != "1":
                return False
        with open(path, "w", encoding="ascii") as fh:
            fh.write("0")
        time.sleep(0.5)
        return True
    except OSError:
        return False


def restart_unbound(force=False):
    """Поднять unbound: штатный init, затем start-stop-daemon/бинарник.

    Без `force` живой резолвер не трогаем. С `force` перезапускаем даже
    отвечающий: конфиг только что переписан, и старые forwarders ещё в памяти.
    Каждый способ пробуем один раз: раньше четыре круга рестартов давали
    «код 0», скачущий PID и пустой 502 у CGI.
    """
    if not force and dns_probe(1.0):
        return [], True
    attempts = []
    if ensure_loopback_ipv6():
        attempts.append({"command": "loopback-ipv6", "code": 0, "detail": "::1 включён"})
    commands = []
    if os.access(INIT, os.X_OK):
        commands.append([INIT, "restart"])
    commands.append(["/bin/sh", "-c",
                     "kill \"$(cat %s 2>/dev/null)\" 2>/dev/null; sleep 1; "
                     "start-stop-daemon -S -q -p %s -x %s >/dev/null 2>&1 || %s"
                     % (PIDFILE, PIDFILE, UNBOUND_BIN, UNBOUND_BIN)])
    for command in commands:
        code, out, err = common.run(command, timeout=12)
        detail = ((out or "") + (err or "")).strip().replace("\n", " ")[:180]
        attempts.append({"command": command[0], "code": code, "detail": detail})
        for _ in range(5):
            if dns_probe(0.8):
                return attempts, True
            time.sleep(0.4)
    return attempts, dns_probe(1.0)


def ensure_dns(force=False):
    """Поднять резолвер; если не вышло — вернуть резервный конфиг и один повтор."""
    attempts, ok = restart_unbound(force=force)
    restored = False
    if not ok and os.path.exists(UNBOUND_BACKUP):
        try:
            with open(UNBOUND_BACKUP, "r", encoding="utf-8") as src:
                data = src.read()
            with open(UNBOUND, "w", encoding="utf-8") as dst:
                dst.write(data)
            restored = True
        except OSError:
            restored = False
        if restored:
            more, ok = restart_unbound(force=True)
            attempts += more
    result = {"ok": bool(ok), "restored": restored, "attempts": attempts}
    if not ok:
        result["error"] = ("unbound не отвечает на 127.0.0.1:53; попытки: "
                           + "; ".join("%s -> %s" % (item["command"], item["code"])
                                       for item in attempts))
    return result


def set_dns(servers):
    clean = clean_servers(servers)
    same = dns_servers() == clean
    if same and dns_probe(1.0):
        return clean, {"ok": True, "restored": False, "attempts": [], "skipped": True}

    if os.path.exists(UNBOUND) and not os.path.exists(UNBOUND_BACKUP):
        with open(UNBOUND, "r", encoding="utf-8") as src:
            data = src.read()
        with open(UNBOUND_BACKUP, "w", encoding="utf-8") as dst:
            dst.write(data)

    content = (
        "server:\n"
        "\tmsg-cache-size: 2m\n"
        "\trrset-cache-size: 2m\n"
        '\tusername: "nobody"\n'
        "forward-zone:\n"
        '\tname: "."\n'
    ) + "".join('\tforward-addr: "%s"\n' % item for item in clean)

    with open(UNBOUND, "w", encoding="utf-8") as fh:
        fh.write(content)

    probe = ensure_dns(force=True)
    if probe["ok"]:
        try:
            common.write_json(DNS_STATE, {"servers": clean})
        except OSError:
            pass
    return clean, probe


def reset_dns():
    restored = False
    if os.path.exists(UNBOUND_BACKUP):
        with open(UNBOUND_BACKUP, "r", encoding="utf-8") as src:
            data = src.read()
        with open(UNBOUND, "w", encoding="utf-8") as dst:
            dst.write(data)
        restored = True
        probe = ensure_dns(force=True)
    else:
        probe = ensure_dns(force=True)
    try:
        os.remove(DNS_STATE)
    except OSError:
        pass
    result = dict(probe)
    result["restored"] = restored
    result["servers"] = dns_servers()
    return result


def status():
    data = parse_status()
    address, prefix = address_info()
    return {
        "ok": True,
        "connected": data.get("wpa_state") == "COMPLETED",
        "ssid": data.get("ssid"),
        "ip": data.get("ip_address") or address,
        "prefix": prefix,
        "gateway": gateway(),
        "mac": data.get("address"),
        "state": data.get("wpa_state"),
        "bssid": data.get("bssid"),
        "freq": data.get("freq"),
        "id": data.get("id"),
        "signal": signal_level(),
        "dns": dns_servers(),
        "resolv": resolv_nameservers(),
        "saved": list_networks(),
    }


def scan():
    wpa("scan")
    time.sleep(4)
    _, out, _ = wpa("scan_results")
    seen = {}
    for line in out.splitlines()[1:]:
        parts = line.split("\t")
        if len(parts) < 5:
            continue
        bssid, freq, signal, flags, ssid = parts[0], parts[1], parts[2], parts[3], parts[4]
        if not ssid.strip():
            continue
        try:
            level = int(signal)
        except ValueError:
            continue
        item = {
            "ssid": ssid.strip(),
            "bssid": bssid,
            "freq": freq,
            "signal": level,
            "secure": "WPA" in flags or "WEP" in flags,
        }
        if ssid not in seen or seen[ssid]["signal"] < level:
            seen[ssid] = item
    return sorted(seen.values(), key=lambda item: -item["signal"])


def wait_connected(previous_id, seconds=25):
    deadline = time.time() + seconds
    while time.time() < deadline:
        data = parse_status()
        if data.get("wpa_state") == "COMPLETED" and data.get("ip_address"):
            return True
        time.sleep(2)
    # откат к прежней сети
    if previous_id is not None:
        wpa("select_network", str(previous_id))
        wpa("enable_network", str(previous_id))
        wpa("save_config")
    return False


def connect(ssid, psk):
    if not ssid:
        raise RuntimeError("не указан SSID")

    previous = parse_status().get("id")

    network_id = None
    for item in list_networks():
        if item["ssid"] == ssid:
            network_id = item["id"]
            break

    if network_id is None:
        _, out, _ = wpa("add_network")
        digits = re.findall(r"\d+", out)
        if not digits:
            raise RuntimeError("wpa_cli не выдал id сети")
        network_id = int(digits[-1])

    wpa("set_network", str(network_id), "ssid", '"%s"' % ssid)
    if psk:
        wpa("set_network", str(network_id), "psk", '"%s"' % psk)
        wpa("set_network", str(network_id), "key_mgmt", "WPA-PSK")
    else:
        wpa("set_network", str(network_id), "key_mgmt", "NONE")

    wpa("enable_network", str(network_id))
    wpa("select_network", str(network_id))
    wpa("save_config")

    wait_connected(previous)
    return status()


def forget(ssid):
    # В wpa_supplicant бывают дубликаты одного SSID — убираем все.
    _, out, _ = wpa("list_networks")
    ids = []
    for line in out.splitlines()[1:]:
        parts = line.split("\t")
        if len(parts) >= 2 and parts[0].strip().isdigit() and parts[1] == ssid:
            ids.append(parts[0].strip())
    for network_id in ids:
        wpa("remove_network", network_id)
    wpa("save_config")
    return status()


def main():
    data = common.params()
    action = (data.get("action") or "").strip()

    if action == "scan":
        common.respond(200, {"ok": True, "networks": scan(), "state": status()})
        return

    if action == "connect":
        try:
            result = connect(str(data.get("ssid") or "").strip(), str(data.get("psk") or ""))
        except Exception as exc:  # noqa: BLE001
            common.fail(502, "Не удалось подключиться: %s" % exc)
            return
        common.respond(200, result)
        return

    if action == "forget":
        common.respond(200, forget(str(data.get("ssid") or "").strip()))
        return

    if action == "connect_saved":
        sid = common.to_int(data.get("id"), 0, 0, 999)
        previous = parse_status().get("id")
        wpa("select_network", str(sid))
        wpa("enable_network", str(sid))
        wpa("save_config")
        wait_connected(previous)
        common.respond(200, status())
        return

    if action == "dns":
        try:
            servers, probe = set_dns(str(data.get("servers") or "").split(","))
        except Exception as exc:  # noqa: BLE001
            common.fail(400, "DNS: %s" % exc)
            return
        result = status()
        result["applied"] = servers
        result["dns_check"] = probe
        common.respond(200, result)
        return

    if action == "dns_reset":
        probe = reset_dns()
        result = status()
        result["dns_check"] = probe
        common.respond(200, result)
        return

    if action == "dns_apply_saved":
        try:
            with open(DNS_STATE, "r", encoding="utf-8") as fh:
                servers = json.load(fh).get("servers") or []
            if servers:
                set_dns(servers)
        except (OSError, ValueError, RuntimeError):
            pass
        common.respond(200, status())
        return

    common.respond(200, status())


if __name__ == "__main__":
    try:
        main()
    except BrokenPipeError:
        pass
    except Exception as exc:  # noqa: BLE001
        try:
            common.fail(500, "Внутренняя ошибка network.py: %s" % exc)
        except Exception:
            pass
