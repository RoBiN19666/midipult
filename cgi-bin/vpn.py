#!/opt/bin/python3
# -*- coding: utf-8 -*-
"""VPN по https-подписке: хранилище, парсинг, запуск sing-box.

    POST /cgi-bin/vpn.py {"url": "https://..."}   — сохранить подписку и разобрать
    GET  /cgi-bin/vpn.py?info=1                   — статус, серверы, настройки
    POST /cgi-bin/vpn.py {"start": 1, "index": 0} — поднять туннель
    POST /cgi-bin/vpn.py {"stop": 1}              — опустить
    GET  /cgi-bin/vpn.py?log=1                    — последние строки лога

sing-box качается один раз с GitHub в /data/mypult/bin. Конфиг и pid —
в /data/mypult/vpn, права 600: в подписке и конфиге есть секреты.
"""

from __future__ import annotations

import base64
import json
import os
import re
import shutil
import signal
import subprocess
import time
import urllib.parse
import urllib.request

import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402

BASE = "/data/mypult"
VPN_DIR = os.path.join(BASE, "vpn")
SETTINGS = os.path.join(BASE, "vpn.json")
BINARY = os.path.join(BASE, "bin", "sing-box")
CONFIG = os.path.join(VPN_DIR, "config.json")
PIDFILE = os.path.join(VPN_DIR, "sing-box.pid")
LOG = os.path.join(VPN_DIR, "sing-box.log")
AUTOSTART = os.path.join(BASE, "vpn.autostart")
VERSION = "1.10.7"
TUN = "tun0"


# --------------------------------------------------------------------------- #
#  Настройки
# --------------------------------------------------------------------------- #

def load_settings():
    try:
        with open(SETTINGS, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def save_settings(data):
    os.makedirs(BASE, exist_ok=True)
    try:
        os.chmod(BASE, 0o700)
    except OSError:
        pass
    common.write_json(SETTINGS, data, indent=2)


def mask_url(url):
    if not url:
        return None
    parsed = urllib.parse.urlparse(url)
    host = parsed.hostname or ""
    return "%s://%s/…" % (parsed.scheme or "https", host)


# --------------------------------------------------------------------------- #
#  Подписка
# --------------------------------------------------------------------------- #

def fetch(url, timeout=20):
    request = urllib.request.Request(url, headers={"User-Agent": "mypult/1.0"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        raw = response.read(2_000_000)
    return raw.decode("utf-8", "replace")


def decode_subscription(text):
    text = text.strip()
    if "://" in text:
        return text.splitlines()
    compact = re.sub(r"\s+", "", text)
    try:
        decoded = base64.b64decode(compact + "=" * (-len(compact) % 4)).decode("utf-8", "replace")
    except Exception:
        return []
    return decoded.splitlines()


def parse_link(line):
    line = line.strip()
    if not line or "://" not in line:
        return None
    scheme = line.split("://", 1)[0].lower()
    if scheme == "vless":
        return parse_vless(line)
    if scheme == "vmess":
        return parse_vmess(line)
    if scheme == "trojan":
        return parse_trojan(line)
    if scheme in ("ss", "shadowsocks"):
        return parse_ss(line)
    return None


def _query(parsed):
    return {key: values[-1] for key, values in urllib.parse.parse_qs(parsed.query).items()}


def _ws_transport(query, host):
    return {
        "type": "ws",
        "path": query.get("path") or "/",
        "headers": {"Host": query.get("host") or host},
    }


def parse_vless(line):
    parsed = urllib.parse.urlparse(line)
    if not parsed.hostname or not parsed.username:
        return None
    query = _query(parsed)
    name = urllib.parse.unquote(parsed.fragment) or parsed.hostname
    security = (query.get("security") or "none").lower()
    tls = {"enabled": security in ("tls", "reality", "xtls")}
    if tls["enabled"]:
        tls["server_name"] = query.get("sni") or query.get("host") or parsed.hostname
        if query.get("fp"):
            tls["utls"] = {"enabled": True, "fingerprint": query["fp"]}
        if security == "reality":
            tls["reality"] = {
                "enabled": True,
                "public_key": query.get("pbk", ""),
                "short_id": query.get("sid", ""),
            }
    outbound = {
        "type": "vless",
        "tag": "proxy",
        "server": parsed.hostname,
        "server_port": parsed.port or 443,
        "uuid": parsed.username,
        "packet_encoding": "xudp",
    }
    if query.get("flow"):
        outbound["flow"] = query["flow"]
    if tls["enabled"]:
        outbound["tls"] = tls
    kind = (query.get("type") or "tcp").lower()
    if kind == "ws":
        outbound["transport"] = _ws_transport(query, parsed.hostname)
    elif kind == "grpc":
        outbound["transport"] = {"type": "grpc", "service_name": query.get("serviceName", "")}
    return {"name": name, "outbound": outbound}


def parse_vmess(line):
    payload = line[8:]
    try:
        data = json.loads(base64.b64decode(payload + "=" * (-len(payload) % 4)).decode("utf-8"))
    except Exception:
        return None
    server = data.get("add")
    if not server:
        return None
    outbound = {
        "type": "vmess",
        "tag": "proxy",
        "server": server,
        "server_port": int(data.get("port") or 443),
        "uuid": data.get("id"),
        "security": data.get("scy") or "auto",
        "alter_id": int(data.get("aid") or 0),
    }
    tls_on = str(data.get("tls") or "").lower() in ("tls", "reality", "true")
    if tls_on:
        outbound["tls"] = {
            "enabled": True,
            "server_name": data.get("sni") or data.get("host") or server,
        }
    if (data.get("net") or "").lower() == "ws":
        outbound["transport"] = {
            "type": "ws",
            "path": data.get("path") or "/",
            "headers": {"Host": data.get("host") or server},
        }
    return {"name": data.get("ps") or server, "outbound": outbound}


def parse_trojan(line):
    parsed = urllib.parse.urlparse(line)
    if not parsed.hostname or not parsed.username:
        return None
    query = _query(parsed)
    outbound = {
        "type": "trojan",
        "tag": "proxy",
        "server": parsed.hostname,
        "server_port": parsed.port or 443,
        "password": parsed.username,
        "tls": {
            "enabled": True,
            "server_name": query.get("sni") or parsed.hostname,
        },
    }
    if (query.get("type") or "").lower() == "ws":
        outbound["transport"] = _ws_transport(query, parsed.hostname)
    return {"name": urllib.parse.unquote(parsed.fragment) or parsed.hostname, "outbound": outbound}


def parse_ss(line):
    body = line.split("://", 1)[1]
    name = ""
    if "#" in body:
        body, name = body.split("#", 1)
        name = urllib.parse.unquote(name)
    if "@" in body:
        userinfo, hostpart = body.split("@", 1)
        try:
            method, password = base64.b64decode(
                userinfo + "=" * (-len(userinfo) % 4)).decode("utf-8").split(":", 1)
        except Exception:
            return None
        host, port = hostpart.rsplit(":", 1)
    else:
        try:
            decoded = base64.b64decode(body + "=" * (-len(body) % 4)).decode("utf-8")
        except Exception:
            return None
        method, rest = decoded.split(":", 1)
        password, hostport = rest.split("@", 1)
        host, port = hostport.rsplit(":", 1)
    return {
        "name": name or host,
        "outbound": {
            "type": "shadowsocks",
            "tag": "proxy",
            "server": host.strip("[]"),
            "server_port": int(port),
            "method": method,
            "password": password,
        },
    }


def parse_subscription(text):
    servers = []
    for line in decode_subscription(text):
        try:
            parsed = parse_link(line)
        except Exception:
            parsed = None
        if parsed:
            servers.append(parsed)
    return servers


# --------------------------------------------------------------------------- #
#  sing-box
# --------------------------------------------------------------------------- #

def ensure_binary():
    if os.path.isfile(BINARY) and os.access(BINARY, os.X_OK):
        return BINARY

    os.makedirs(os.path.dirname(BINARY), exist_ok=True)
    archive = "/tmp/sing-box.tar.gz"
    url = ("https://github.com/SagerNet/sing-box/releases/download/v%s/"
           "sing-box-%s-linux-arm64.tar.gz" % (VERSION, VERSION))
    code, _, err = common.run(["/opt/bin/curl", "-L", "-s", "-m", "180", "-o", archive, url], timeout=200)
    if code != 0 or not os.path.exists(archive):
        raise RuntimeError("не скачался sing-box: %s" % (err or code))

    extract = "/tmp/sing-box-extract"
    if os.path.isdir(extract):
        shutil.rmtree(extract, ignore_errors=True)
    os.makedirs(extract, exist_ok=True)
    code, _, err = common.run(
        ["/bin/sh", "-c", "gzip -dc %s | tar -xf - -C %s" % (archive, extract)], timeout=60)
    if code != 0:
        raise RuntimeError("не распаковался sing-box: %s" % err)

    found = None
    for root, _dirs, files in os.walk(extract):
        if "sing-box" in files:
            found = os.path.join(root, "sing-box")
            break
    if not found:
        raise RuntimeError("в архиве нет sing-box")

    shutil.move(found, BINARY)
    os.chmod(BINARY, 0o755)
    return BINARY


def build_config(outbound):
    return {
        "log": {"level": "info", "timestamp": True, "output": LOG},
        "dns": {
            # DNS идёт напрямую, а не через прокси: иначе sing-box ловит
            # собственные DNS-запросы в tun и пишет «DNS query loopback».
            # Трафик по IP при этом всё равно уходит в туннель.
            "servers": [
                {"tag": "dns-local", "address": "223.5.5.5", "detour": "direct"},
                {"tag": "dns-backup", "address": "1.1.1.1", "detour": "direct"},
            ],
            "final": "dns-local",
        },
        "inbounds": [{
            "type": "tun",
            "tag": "tun-in",
            "interface_name": TUN,
            "address": ["172.19.0.1/30"],
            "mtu": 1500,
            "auto_route": True,
            "strict_route": False,
            "stack": "gvisor",
            "sniff": True,
        }],
        "outbounds": [outbound, {"type": "direct", "tag": "direct"}],
        "route": {
            "rules": [{
                "ip_cidr": ["127.0.0.0/8", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"],
                "outbound": "direct",
            }],
            "final": "proxy",
            "auto_detect_interface": True,
        },
    }


def read_pid():
    try:
        with open(PIDFILE, "r", encoding="utf-8") as fh:
            return int(fh.read().strip())
    except (OSError, ValueError):
        return None


def pid_alive(pid):
    if not pid:
        return False
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def running():
    pid = read_pid()
    return pid_alive(pid), pid


def log_tail(lines=25):
    try:
        with open(LOG, "r", encoding="utf-8", errors="replace") as fh:
            return "".join(fh.readlines()[-lines:])
    except OSError:
        return ""


def stop():
    pid = read_pid()
    if pid and pid_alive(pid):
        try:
            os.kill(pid, signal.SIGTERM)
        except OSError:
            pass
        for _ in range(30):
            if not pid_alive(pid):
                break
            time.sleep(0.1)
        if pid_alive(pid):
            try:
                os.kill(pid, signal.SIGKILL)
            except OSError:
                pass
    try:
        os.remove(PIDFILE)
    except OSError:
        pass
    return True


def resolve_server(outbound):
    """Разрешить домен сервера до IP до поднятия туннеля.

    Иначе sing-box резолвит адрес прокси через собственный DNS, который идёт
    через этот же прокси — классический loopback.
    """
    import ipaddress
    import socket

    server = outbound.get("server")
    if not server:
        return outbound
    try:
        ipaddress.ip_address(server)
        return outbound
    except ValueError:
        pass
    try:
        infos = socket.getaddrinfo(server, outbound.get("server_port", 443), socket.AF_INET)
        if infos:
            outbound = dict(outbound)
            outbound["server"] = infos[0][4][0]
    except OSError:
        pass
    return outbound


def start(outbound):
    stop()
    os.makedirs(VPN_DIR, exist_ok=True)
    outbound = resolve_server(outbound)
    config = build_config(outbound)
    with open(CONFIG, "w", encoding="utf-8") as fh:
        json.dump(config, fh, ensure_ascii=False, indent=2)
    os.chmod(CONFIG, 0o600)

    binary = ensure_binary()

    code, out, err = common.run([binary, "check", "-c", CONFIG], timeout=30)
    if code != 0:
        raise RuntimeError("конфиг не прошёл проверку: %s" % ((err or out).strip()[:400]))

    # Лог прошлых запусков только путает — начинаем с чистого листа.
    try:
        open(LOG, "wb").close()
    except OSError:
        pass

    with open(LOG, "ab") as log_file:
        proc = subprocess.Popen(
            [binary, "run", "-c", CONFIG],
            stdout=log_file, stderr=subprocess.STDOUT,
            start_new_session=True, close_fds=True,
        )
    with open(PIDFILE, "w", encoding="utf-8") as fh:
        fh.write(str(proc.pid))

    time.sleep(2.5)
    if proc.poll() is not None:
        raise RuntimeError("sing-box завершился: %s" % log_tail(6))

    return proc.pid


def status():
    alive, pid = running()
    settings = load_settings()
    servers = settings.get("servers") or []
    return {
        "ok": True,
        "running": alive,
        "pid": pid if alive else None,
        "tun": os.path.exists("/sys/class/net/%s" % TUN),
        "binary": os.path.isfile(BINARY),
        "url_set": bool(settings.get("url")),
        "url_hint": mask_url(settings.get("url")),
        "servers": [{"index": i, "name": item.get("name"), "type": item.get("outbound", {}).get("type")}
                    for i, item in enumerate(servers)],
        "selected": settings.get("selected") or 0,
        "autostart": os.path.exists(AUTOSTART),
        "log": log_tail(10) if alive else None,
    }


# --------------------------------------------------------------------------- #
#  Точка входа
# --------------------------------------------------------------------------- #

def main():
    data = common.params()

    if common.truthy(data.get("log")):
        common.ok(log=log_tail(120))
        return

    if data.get("url") is not None:
        url = str(data.get("url") or "").strip()
        if not url.startswith(("http://", "https://")):
            common.fail(400, "Нужна https-ссылка на подписку")
            return
        try:
            text = fetch(url)
        except Exception as exc:  # noqa: BLE001
            common.fail(502, "Не удалось скачать подписку: %s" % exc)
            return
        servers = parse_subscription(text)
        if not servers:
            common.fail(422, "В подписке не найдено поддерживаемых серверов",
                        hint="поддерживаются vless, vmess, trojan, shadowsocks")
            return
        settings = load_settings()
        settings["url"] = url
        settings["servers"] = servers
        settings["selected"] = 0
        save_settings(settings)
        common.respond(200, {"ok": True, "servers": status()["servers"], "url_hint": mask_url(url)})
        return

    if common.truthy(data.get("start")):
        settings = load_settings()
        servers = settings.get("servers") or []
        if not servers:
            common.fail(400, "Сначала сохраните подписку", hint="POST {\"url\": \"https://...\"}")
            return
        index = common.to_int(data.get("index"), default=settings.get("selected") or 0,
                              lo=0, hi=len(servers) - 1)
        try:
            pid = start(servers[index]["outbound"])
        except Exception as exc:  # noqa: BLE001
            common.fail(502, "VPN не поднялся: %s" % exc, log=log_tail(20))
            return
        settings["selected"] = index
        save_settings(settings)
        time.sleep(0.5)
        common.ok(running=True, pid=pid, tun=os.path.exists("/sys/class/net/%s" % TUN),
                  server=servers[index].get("name"))
        return

    if common.truthy(data.get("stop")):
        stop()
        common.ok(running=False)
        return

    if "autostart" in data:
        try:
            if common.truthy(data.get("autostart")):
                with open(AUTOSTART, "w", encoding="utf-8") as fh:
                    fh.write("1\n")
                os.chmod(AUTOSTART, 0o600)
            else:
                os.remove(AUTOSTART)
        except OSError:
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
            common.fail(500, "Внутренняя ошибка vpn.py: %s" % exc)
        except Exception:
            pass
