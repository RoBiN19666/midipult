#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Юнит-проверки чистой логики volume.py и media.py (без колонки).

  python3 tests/test_units.py
"""

from __future__ import annotations

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CGI_DIR = os.path.normpath(os.path.join(HERE, "..", "cgi-bin"))
sys.path.insert(0, CGI_DIR)

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

import common  # noqa: E402
import glagol  # noqa: E402
import media  # noqa: E402
import speak  # noqa: E402
import volume  # noqa: E402
import vpn  # noqa: E402

RESULTS = []


def reset_cache():
    volume.CACHE_PATH = os.path.join(HERE, ".volume-cache.json")
    try:
        os.remove(volume.CACHE_PATH)
    except OSError:
        pass


def check(name, condition, detail=""):
    RESULTS.append((name, bool(condition), detail))
    print("[%s] %s%s" % ("PASS" if condition else "FAIL", name,
                        ("  — " + detail) if detail and not condition else ""))


# --------------------------------------------------------------------------- #
#  Подставной amixer
# --------------------------------------------------------------------------- #

class FakeAmixer:
    def __init__(self, controls=("PCM", "Master"), start=40, fail_sset=False,
                 default_controls=True):
        self.controls = list(controls)
        self.level = start
        self.muted = False
        self.fail_sset = fail_sset
        self.default_controls = default_controls
        self.calls = []

    def __call__(self, argv, timeout=6.0):
        self.calls.append(list(argv))
        action = argv[-2] if argv[-2] in ("sget", "sset") else argv[-1]
        # без -c amixer работает с устройством default (asound.conf -> softvol)
        on_default = "-c" not in argv

        if "scontrols" in argv:
            names = self.controls if (self.default_controls or not on_default) else []
            body = "".join("Simple mixer control '%s',0\n" % name for name in names)
            return 0, body, ""

        if "sget" in argv:
            if argv[-1] not in self.controls:
                return 1, "", "amixer: Unable to find simple control '%s',0" % argv[-1]
            if on_default and not self.default_controls:
                return 1, "", "amixer: mixers not found"
            state = "off" if self.muted else "on"
            out = ("Simple mixer control '%s',0\n  Capabilities: pvolume pswitch\n"
                   "  Playback channels: Front Left - Front Right\n"
                   "  Limits: Playback 0 - 100\n"
                   "  Front Left: Playback %d [%d%%] [0.00dB] [%s]\n"
                   "  Front Right: Playback %d [%d%%] [0.00dB] [%s]\n"
                   % (argv[-1], self.level, self.level, state,
                      self.level, self.level, state))
            return 0, out, ""

        if "sset" in argv:
            if self.fail_sset:
                return 1, "", "amixer: Invalid command!"
            value = argv[-1]
            if value == "mute":
                self.muted = True
            elif value == "unmute":
                self.muted = False
            else:
                digits = "".join(ch for ch in value if ch.isdigit())
                if digits:
                    self.level = int(digits)
                else:
                    return 1, "", "amixer: bad value"
            return 0, "Simple mixer control '%s',0\n" % argv[-1], ""

        return 0, "", ""

    @property
    def sset_calls(self):
        return [c for c in self.calls if "sset" in c]


def with_fake_run(fake, fn):
    original = common.run
    common.run = fake
    try:
        return fn()
    finally:
        common.run = original


def test_generic_helpers():
    check("truthy: '1'", common.truthy("1") is True)
    check("truthy: 'off'", common.truthy("off") is False)
    check("to_int: клампит", common.to_int("250", 0, 0, 100) == 100)
    check("to_int: мусор -> default", common.to_int("abc", 7) == 7)


def test_volume_discovery():
    reset_cache()
    fake = FakeAmixer(controls=("PCM", "Master"))
    choice, diag = with_fake_run(fake, lambda: volume.discover("/fake/amixer"))
    check("volume: выбран Master, а не первый PCM", choice == {"card": None, "control": "Master"}, str(choice))
    check("volume: сначала default (softvol), без -c", choice and choice["card"] is None, str(choice))
    check("volume: диагностика заполнена", bool(diag.get("cards")), str(diag)[:120])

    reset_cache()
    fake_card = FakeAmixer(controls=("Master",), default_controls=False)
    choice_card, _ = with_fake_run(fake_card, lambda: volume.discover("/fake/amixer"))
    check("volume: fallback на карту 0, если default пуст",
          choice_card == {"card": 0, "control": "Master"}, str(choice_card))

    reset_cache()
    fake2 = FakeAmixer(controls=("Speaker", "Headphone"))
    choice2, _ = with_fake_run(fake2, lambda: volume.discover("/fake/amixer"))
    check("volume: Speaker важнее Headphone", choice2["control"] == "Speaker", str(choice2))


def test_volume_parse():
    fake = FakeAmixer(start=63)
    state = with_fake_run(fake, lambda: volume.sget("/fake/amixer", 0, "Master"))
    check("volume: уровень из sget", state and state["level"] == 63, str(state))
    check("volume: mute=false", state and state["muted"] is False)

    fake.muted = True
    state = with_fake_run(fake, lambda: volume.sget("/fake/amixer", 0, "Master"))
    check("volume: mute распознан", state and state["muted"] is True, str(state))

    bad = with_fake_run(fake, lambda: volume.sget("/fake/amixer", 0, "NoSuch"))
    check("volume: неизвестный регулятор -> None", bad is None)


def test_volume_set():
    fake = FakeAmixer(start=20)
    ok, out = with_fake_run(fake, lambda: volume.sset("/fake/amixer", 0, "Master", "55%"))
    check("volume: sset принят", ok is True, out)
    check("volume: уровень изменился", fake.level == 55, str(fake.level))
    check("volume: вызван sset", any("sset" in c for c in fake.calls))

    broken = FakeAmixer(fail_sset=True)
    ok, out = with_fake_run(broken, lambda: volume.sset("/fake/amixer", 0, "Master", "55%"))
    check("volume: ошибка sset возвращается", ok is False and "Invalid" in out, out)


def test_glagol_payloads():
    check("media: render подставляет громкость",
          media.render({"event": "setVolume", "volume": "{volume}"}, 42) == {"event": "setVolume", "volume": 42})
    check("media: render без плейсхолдера не ломается",
          media.render({"event": "play"}, 42) == {"event": "play"})
    check("media: ошибка в ответе распознана", media.looks_like_error({"error": "bad"}) is True)
    check("media: ok:false распознан", media.looks_like_error({"ok": False}) is True)
    check("media: нормальный ответ не ошибка", media.looks_like_error({"ok": True}) is False)
    check("media: алиас resume -> play", media.ALIASES.get("resume") == "play")
    check("media: все действия описаны",
          all(a in media.DEFAULT_PAYLOADS for a in ("play", "pause", "next", "prev", "setVolume")))


def test_media_config_override():
    url, payloads, conf = media.config()
    check("media: url по умолчанию", url.startswith("ws://"), url)
    check("media: список кадров play не пуст", bool(payloads.get("play")))


def test_speak_frames():
    frame = speak.vocalize_frame("тест")
    size = int.from_bytes(frame[:4], "little")
    check("speak: длина кадра совпадает", size == len(frame) - 4, "%d vs %d" % (size, len(frame) - 4))

    envelope = speak.fields(frame[4:])
    inner = speak.fields(speak.fields(envelope.get(252, b"")).get(8, b""))
    check("speak: rpc 8 -> 18", envelope.get(253) == 210 and inner.get(1) == 18, str(inner))
    check("speak: подпись поля 7", speak.fields(envelope[252]).get(7) == b"AliceCapability")

    check("speak: utf-8 текст в директиве",
          speak.fields(inner.get(13, b"")).get(1) == "тест".encode("utf-8"))

    check("speak: varint 300 корректен", speak.varint(300) == b"\xac\x02")


def test_vpn_parsing():
    import base64
    import json

    vless = vpn.parse_link(
        "vless://11111111-2222-3333-4444-555555555555@example.com:443"
        "?security=tls&type=ws&path=%2Fws&sni=example.com#Test")
    check("vpn: vless распознан", vless and vless["outbound"]["type"] == "vless", str(vless))
    check("vpn: vless host/port", vless["outbound"]["server"] == "example.com"
          and vless["outbound"]["server_port"] == 443)
    check("vpn: vless tls+ws", vless["outbound"]["tls"]["enabled"] is True
          and vless["outbound"]["transport"]["type"] == "ws")

    vmess_data = {"v": "2", "ps": "VM", "add": "1.2.3.4", "port": "443",
                  "id": "uuid", "aid": "0", "net": "ws", "path": "/x",
                  "host": "vm.example", "tls": "tls"}
    vmess_line = "vmess://" + base64.b64encode(
        json.dumps(vmess_data).encode()).decode()
    vmess = vpn.parse_link(vmess_line)
    check("vpn: vmess распознан", vmess and vmess["outbound"]["type"] == "vmess", str(vmess))
    check("vpn: vmess ws+tls", vmess["outbound"]["transport"]["type"] == "ws"
          and vmess["outbound"]["tls"]["enabled"] is True)

    ss_body = base64.b64encode(b"aes-256-gcm:pass@5.6.7.8:8388").decode()
    ss = vpn.parse_link("ss://" + ss_body + "#SS")
    check("vpn: shadowsocks распознан", ss and ss["outbound"]["type"] == "shadowsocks", str(ss))
    check("vpn: shadowsocks порт", ss["outbound"]["server_port"] == 8388)

    trojan = vpn.parse_link("trojan://secret@example.org:443?sni=example.org#T")
    check("vpn: trojan распознан", trojan and trojan["outbound"]["type"] == "trojan", str(trojan))
    check("vpn: trojan tls", trojan["outbound"]["tls"]["server_name"] == "example.org")

    subscription = base64.b64encode(
        ("vless://11111111-2222-3333-4444-555555555555@a.example:443?security=tls#A\n"
         "trojan://pw@b.example:443#B\n").encode()).decode()
    servers = vpn.parse_subscription(subscription)
    check("vpn: подписка base64 разобрана", len(servers) == 2, str(len(servers)))

    config = vpn.build_config(servers[0]["outbound"])
    check("vpn: конфиг с tun", config["inbounds"][0]["type"] == "tun")
    check("vpn: final на proxy", config["route"]["final"] == "proxy")


def test_glagol_device_selection():
    import json
    import tempfile
    import time

    old_devices = glagol.DEVICES
    old_cache = glagol.CACHE_PATH
    old_fetch = glagol._fetch_token
    old_local = glagol._local_endpoints
    path = None
    cache = None
    try:
        fd, path = tempfile.mkstemp(prefix="mypult-devices-", suffix=".json")
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump({"devices": [
                {"id": "light", "platform": "yandexmicro",
                 "networkInfo": {"ip_addresses": ["192.168.31.50"]}},
                {"id": "midi", "platform": "cucumber",
                 "networkInfo": {"ip_addresses": ["192.168.31.220"]}},
            ]}, fh)
        glagol.DEVICES = path
        glagol._local_endpoints = lambda: ({"192.168.31.220"}, set())
        check("glagol: выбирает Миди по IP, а не первое устройство",
              glagol._device() == ("midi", "cucumber"), str(glagol._device()))

        fd, cache = tempfile.mkstemp(prefix="mypult-glagol-", suffix=".json")
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump({"token": "old-light-token", "ts": int(time.time())}, fh)
        glagol.CACHE_PATH = cache
        glagol._fetch_token = lambda device_id=None, platform=None: "new-midi-token"
        check("glagol: старый кэш без device_id перезапрашивается",
              glagol.token() == "new-midi-token")

        with open(path, "w", encoding="utf-8") as fh:
            json.dump({"devices": [
                {"id": "light", "platform": "yandexmicro",
                 "networkInfo": {"ip_addresses": ["192.168.31.50"]}},
            ]}, fh)
        try:
            glagol._device()
            rejected = False
        except glagol.GlagolError:
            rejected = True
        check("glagol: без Миди не берёт чужое устройство", rejected)
    finally:
        glagol.DEVICES = old_devices
        glagol.CACHE_PATH = old_cache
        glagol._fetch_token = old_fetch
        glagol._local_endpoints = old_local
        for name in (path, cache):
            try:
                os.remove(name)
            except (OSError, TypeError):
                pass


def main():
    for test in (
        test_generic_helpers,
        test_volume_discovery,
        test_volume_parse,
        test_volume_set,
        test_glagol_payloads,
        test_glagol_device_selection,
        test_media_config_override,
        test_speak_frames,
        test_vpn_parsing,
    ):
        try:
            test()
        except Exception as exc:  # noqa: BLE001
            check(test.__name__, False, repr(exc))

    failed = [n for n, ok, _ in RESULTS if not ok]
    try:
        os.remove(volume.CACHE_PATH)
    except OSError:
        pass
    print("\n%d проверок, %d провалов" % (len(RESULTS), len(failed)))
    for name in failed:
        print("  ✗", name)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
