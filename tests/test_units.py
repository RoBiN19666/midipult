#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Юнит-проверки чистой логики CGI и сервисов (volume, media, discovery, update, чаты).

  python3 tests/test_units.py
"""

from __future__ import annotations

import os
import sys
import shutil
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
CGI_DIR = os.path.normpath(os.path.join(HERE, "..", "cgi-bin"))
SERVICE_DIR = os.path.normpath(os.path.join(HERE, "..", "service"))
sys.path.insert(0, CGI_DIR)
sys.path.insert(0, SERVICE_DIR)

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

import common  # noqa: E402
import auth  # noqa: E402
import discovery  # noqa: E402
import display  # noqa: E402
import files  # noqa: E402
import glagol  # noqa: E402
import llm  # noqa: E402
import layout_presets  # noqa: E402
import media  # noqa: E402
import network  # noqa: E402
import dnsprobe  # noqa: E402
import alice_cli  # noqa: E402
import lyrics  # noqa: E402
import radio  # noqa: E402
import speak  # noqa: E402
import state_daemon  # noqa: E402
import update  # noqa: E402
import voice_daemon  # noqa: E402
import volume  # noqa: E402
import vpn  # noqa: E402
import websearch  # noqa: E402

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


def test_display_auto():
    import json
    from unittest import mock

    saved = (display.luna_clock, display.ambient_lux, display.save_state, display.read_all)
    config = {"enabled": True, "min": 20, "max": 60,
              "display_enabled": True, "display_min": 30, "display_max": 200}
    try:
        calls = []
        display.luna_clock = lambda level, time_text=None: calls.append(level) or {
            "brightness": level, "time": "12:00"}
        display.save_state = lambda values: None
        display.read_all = lambda: {}
        with mock.patch("builtins.open", mock.mock_open(read_data=json.dumps(config))):
            auto = display.load_auto()
            check("display: конфиг автояркости читается",
                  auto["display_enabled"] and auto["display_min"] == 30
                  and auto["display_max"] == 200)

            display.ambient_lux = lambda: 0.0
            dark = display.display_auto_apply()
            display.ambient_lux = lambda: 200.0
            light = display.display_auto_apply()
        check("display: автояркость берёт min/max дисплея",
              dark["level"] == 30 and light["level"] == 200 and calls == [30, 200])

        display.sync_display(111)
        check("display: синхронизация шлёт яркость станции в Luna", calls[-1] == 111)
    finally:
        (display.luna_clock, display.ambient_lux,
         display.save_state, display.read_all) = saved


def test_display_segment_guard():
    saved = (display.read_all, display.save_state, display.save_display_brightness)
    try:
        flags = {"saved": 0, "brightness": None}
        display.save_state = lambda values: flags.__setitem__("saved", flags["saved"] + 1)
        display.save_display_brightness = lambda value: flags.__setitem__("brightness", value)
        display.read_all = lambda: {"/fake/a": 0, "/fake/b": 0}
        changed = display.segment_brightness(80)
        check("display: яркость погашенного экрана не затирает рисунок",
              changed == 0 and flags["saved"] == 0 and flags["brightness"] == 80)
        display.read_all = lambda: {"/fake/a": 40}
        from unittest import mock
        with mock.patch("builtins.open", mock.mock_open()):
            changed = display.segment_brightness(90)
        check("display: яркость горящего экрана сохраняет рисунок",
              changed == 1 and flags["saved"] == 1 and flags["brightness"] == 90)
    finally:
        display.read_all, display.save_state, display.save_display_brightness = saved


def test_display_reset():
    from unittest import mock
    auto = {"enabled": True, "min": 10, "max": 150,
            "display_enabled": True, "display_min": 10, "display_max": 170}
    flags = {}

    def save_auto(value):
        flags["auto"] = dict(value)

    with mock.patch.object(display, "save_display_brightness",
                           side_effect=lambda value: flags.__setitem__("brightness", value)), \
            mock.patch.object(display, "segment_brightness"), \
            mock.patch.object(display, "load_auto", return_value=dict(auto)), \
            mock.patch.object(display, "save_auto", side_effect=save_auto), \
            mock.patch.object(display, "save_mode",
                              side_effect=lambda manual, kind: flags.__setitem__("mode", (manual, kind))), \
            mock.patch.object(display, "load_mode", return_value={"manual": False, "kind": "clock"}), \
            mock.patch("os.remove"):
        data = display.reset_display()
    check("display reset: яркость 170", flags.get("brightness") == 170)
    check("display reset: только дисплейная автояркость выключена",
          flags.get("auto", {}).get("display_enabled") is False
          and flags.get("auto", {}).get("enabled") is True)
    check("display reset: ручной режим снят", flags.get("mode") == (False, "clock"))
    check("display reset: ответ", data.get("brightness") == 170)

    flags.clear()
    with mock.patch.object(display, "set_ring_brightness", return_value=255), \
            mock.patch.object(display, "load_auto", return_value=dict(auto)), \
            mock.patch.object(display, "save_auto", side_effect=save_auto):
        data = display.reset_ring()
    check("ring reset: яркость 255", data.get("ring_brightness") == 255)
    check("ring reset: только кольцевая автояркость выключена",
          flags.get("auto", {}).get("enabled") is False
          and flags.get("auto", {}).get("display_enabled") is True)


def test_auth_guard():
    from unittest import mock

    old = (auth._guard_load, auth._guard_save, auth.time.time)
    state = {}
    try:
        auth._guard_load = lambda: dict(state)
        auth._guard_save = lambda data: (state.clear(), state.update(data))
        auth.time.time = lambda: 1000.0
        retry = 0
        for _ in range(auth.MAX_FAILS):
            retry = auth.guard_fail()
        check("auth: после 5 ошибок включена блокировка", retry > 0, str(retry))
        auth.time.time = lambda: 1000.0 + auth.LOCK_SECONDS + 1
        check("auth: блокировка истекает", auth.guard_retry() == 0)
        auth.guard_success()
        check("auth: успешный вход сбрасывает счётчик", auth.guard_retry() == 0 and not state)

        with mock.patch("builtins.open", side_effect=OSError("denied")):
            check("auth: битый файл — fail-closed",
                  common.auth_config().get("broken") is True
                  and auth.load().get("broken") is True)
    finally:
        auth._guard_load, auth._guard_save, auth.time.time = old


def test_url_guard():
    def bad(url, **kwargs):
        try:
            common.url_guard(url, **kwargs)
            return False
        except ValueError:
            return True

    check("ssrf: публичный https разрешён",
          common.url_guard("https://8.8.8.8") == "https://8.8.8.8")
    check("ssrf: http для подписки запрещён",
          bad("http://8.8.8.8", allow_http=False))
    check("ssrf: loopback запрещён по умолчанию",
          bad("http://127.0.0.1", allow_http=True, allow_private=True))
    check("ssrf: loopback разрешён явно",
          common.url_guard("http://127.0.0.1", allow_http=True,
                           allow_private=True, allow_loopback=True))
    check("ssrf: приватный адрес сценария разрешён",
          common.url_guard("http://192.168.1.10", allow_http=True,
                           allow_private=True) == "http://192.168.1.10")
    check("ssrf: метаданные запрещены",
          bad("http://169.254.169.254", allow_http=True, allow_private=True,
              allow_loopback=True))
    check("ssrf: неверная схема запрещена", bad("ftp://8.8.8.8"))


def test_update_assets():
    def bad(url):
        try:
            update.asset_guard(url)
            return False
        except ValueError:
            return True

    check("update: http-архив запрещён", bad("http://github.com/x.tar.gz"))
    check("update: чужой хост запрещён", bad("https://evil.example/x.tar.gz"))


def test_state_player_fresh():
    old = state_daemon.player.snapshot
    calls = []
    try:
        def snapshot(force=False):
            calls.append(force)
            return {"playing": True, "title": "Трек"}
        state_daemon.player.snapshot = snapshot
        check("state: player=1 берёт свежий snapshot",
              state_daemon.player_now().get("title") == "Трек")
        state_daemon.player_now(force=True)
        check("state: fresh=1 просит Glagol напрямую", calls[-1] is True, str(calls))

        def boom(force=False):
            raise RuntimeError("glagol down")
        state_daemon.player.snapshot = boom
        check("state: ошибка snapshot не валит state",
              state_daemon.player_now().get("error", "").startswith("glagol down"))
    finally:
        state_daemon.player.snapshot = old


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


# --------------------------------------------------------------------------- #
#  glagol.py: форматы OAuth-токена в account_storage.dat
# --------------------------------------------------------------------------- #

def test_glagol_token_formats():
    import tempfile

    old = glagol.ACCOUNT
    fd, path = tempfile.mkstemp(prefix="mypult-acc-", suffix=".dat")
    try:
        with os.fdopen(fd, "wb") as fh:
            # y0__… — как в хранилище проверенной прошивки;
            # y3_… и y1_Ag… — документированный формат «y + 0–3 + _».
            fh.write(b"\x00y0__TEST_ONLY_TOKEN_0000000000000000000000000000\x00"
                     b"y3_TEST_ONLY_TOKEN_0000000000000000000000000000\x00"
                     b"y1_AgAAAABmZ0h2AAk9Z1QAAAAA9Xk2Q1p0kR0\x00")
        glagol.ACCOUNT = path
        tokens = glagol._oauth_tokens()
        check("glagol: y0__ найден", any(t.startswith("y0__") for t in tokens), str(tokens))
        check("glagol: y1_ найден", any(t.startswith("y1_") for t in tokens), str(tokens))
        check("glagol: y3_ найден", any(t.startswith("y3_") for t in tokens), str(tokens))
        check("glagol: все три токена", len(tokens) == 3, str(len(tokens)))
    finally:
        glagol.ACCOUNT = old
        try:
            os.remove(path)
        except OSError:
            pass


# --------------------------------------------------------------------------- #
#  llm.py: 400 на temperature -> один повтор без неё
# --------------------------------------------------------------------------- #

def test_llm_temperature_retry():
    import io
    import json
    import tempfile
    import urllib.error

    config = {
        "enabled": False,
        "active": "p1",
        "profiles": [{
            "id": "p1", "name": "Claude", "provider": "custom",
            "model": "claude-haiku-5-5", "base_url": "http://127.0.0.1:1",
            "key": "test-key",
        }],
        "max_tokens": 260,
        "system_prompt": "",
    }
    cfg_fd, cfg_path = tempfile.mkstemp(prefix="mypult-llm-", suffix=".json")
    chat_fd, chat_path = tempfile.mkstemp(prefix="mypult-chats-", suffix=".json")
    os.close(cfg_fd)
    os.close(chat_fd)
    old = (llm.CONFIG_PATH, llm.CHATS_PATH, llm._post_chat,
           common.respond, common.fail)
    payloads = []
    called = []
    try:
        with open(cfg_path, "w", encoding="utf-8") as fh:
            json.dump(config, fh)
        with open(chat_path, "w", encoding="utf-8") as fh:
            json.dump({"active": "chat-1", "chats": [
                {"id": "chat-1", "name": "Чат 1", "messages": []}]}, fh)
        llm.CONFIG_PATH = cfg_path
        llm.CHATS_PATH = chat_path

        def fake_post(base_url, payload, key, timeout=90):
            payloads.append(dict(payload))
            if len(payloads) == 1:
                raise urllib.error.HTTPError(
                    base_url + "/chat/completions", 400, "Bad Request", {},
                    io.BytesIO(b'{"error":{"message":'
                               b'"temperature is deprecated for this model"}}'))
            return {"choices": [{"message": {"content": "ok"}}],
                    "usage": {"total_tokens": 3}}

        llm._post_chat = fake_post
        common.respond = lambda status, payload, headers=None: called.append((status, payload))

        def capture_fail(status, message, **extra):
            payload = {"ok": False, "error": message}
            payload.update(extra)
            called.append((status, payload))

        common.fail = capture_fail
        llm.ask("привет")

        check("llm: первый запрос с temperature",
              bool(payloads) and "temperature" in payloads[0], str(payloads[:1]))
        check("llm: 400 про temperature -> повтор без неё",
              len(payloads) == 2 and "temperature" not in payloads[1],
              str([sorted(p) for p in payloads]))
        check("llm: ответ получен после повтора",
              bool(called) and called[-1][1].get("answer") == "ok", str(called)[:200])
        check("llm: в ответе флаг сброса temperature",
              bool(called) and called[-1][1].get("temperature_dropped") is True,
              str(called[-1][1])[:200])
    finally:
        (llm.CONFIG_PATH, llm.CHATS_PATH, llm._post_chat,
         common.respond, common.fail) = old
        for path in (cfg_path, chat_path):
            try:
                os.remove(path)
            except OSError:
                pass


# --------------------------------------------------------------------------- #
#  radio.py: свои потоки по ссылке и старый формат каналов
# --------------------------------------------------------------------------- #

def test_radio_custom_stations():
    import tempfile

    check("radio: старый формат (строки) читается",
          radio.normalize_custom(["Радио X", {"name": "Поток", "url": "http://a/b"}])
          == [{"name": "Радио X", "url": ""}, {"name": "Поток", "url": "http://a/b"}])
    check("radio: пустые и мусорные записи отбрасываются",
          radio.normalize_custom([None, "", {"url": "http://x"}]) == [])
    check("radio: http-ссылка проходит", radio.check_url("http://example.org/stream.mp3"))
    for bad in ("ftp://example.org/x", "http://exa mple.org", "http://x/!bad", "javascript:1"):
        try:
            radio.check_url(bad)
            passed = True
        except ValueError:
            passed = False
        check("radio: ссылка отклонена: %s" % bad[:24], not passed)

    import base64
    payload = base64.b64decode(radio.audio_play_data(
        "http://example.org/s.mp3", "FIP"))
    check("radio: protobuf начинается с поля 1", payload[:1] == b"\x0a", repr(payload[:2]))
    check("radio: в кадре команда audio_play", b"audio_play" in payload)
    check("radio: в кадре ссылка и название",
          b"http://example.org/s.mp3" in payload and b"FIP" in payload)

    old_file = radio.CUSTOM_FILE
    fd, path = tempfile.mkstemp(prefix="mypult-radio-", suffix=".json")
    os.close(fd)
    try:
        radio.CUSTOM_FILE = path
        radio.save_custom([{"name": "Старый", "url": ""},
                           {"name": "Поток", "url": "http://example.org/a.mp3"}])
        stations = radio.all_stations()
        custom = [item for item in stations if item["custom"]]
        check("radio: оба своих канала в списке", len(custom) == 2, str(custom))
        check("radio: у потока есть url",
              any(item["name"] == "Поток" and item["url"].endswith("a.mp3")
                  for item in custom), str(custom))
        check("radio: у канала без url пусто",
              any(item["name"] == "Старый" and item["url"] == "" for item in custom))
    finally:
        radio.CUSTOM_FILE = old_file
        try:
            os.remove(path)
        except OSError:
            pass


# --------------------------------------------------------------------------- #
#  websearch.py и поиск в llm.py
# --------------------------------------------------------------------------- #

SEARX_FIXTURE = (
    '{"results": [{"title": "Погода в Екатеринбурге",'
    ' "url": "https://yandex.ru/pogoda/yekaterinburg", "content": "Малооблачно, +1"},'
    ' {"title": "<b>GISMETEO</b>", "url": "https://gismeteo.ru/x",'
    ' "content": "Прогноз на сегодня"}]}'
)

OPENROUTER_BODY = {
    "choices": [{"message": {
        "content": "По данным поиска: +1 °C",
        "annotations": [{"type": "url_citation", "url_citation": {
            "url": "https://yandex.ru/pogoda/yekaterinburg",
            "title": "Яндекс.Погода", "content": "Малооблачно"}}],
    }}],
    "usage": {"total_tokens": 10},
}

OPENAI_BODY = {
    "output": [{"type": "message", "content": [{
        "type": "output_text", "text": "Сейчас +1 °C",
        "annotations": [{"type": "url_citation",
                         "url": "https://gismeteo.ru/x",
                         "title": "GISMETEO",
                         "start_index": 0, "end_index": 5}],
    }]}],
    "usage": {"total_tokens": 7},
}


def _llm_ask_with(config, prompt="вопрос", search=None, chat=None, responses=None):
    """Прогнать ask() с подменёнными сетевыми вызовами и временными файлами."""
    import json
    import tempfile

    fd, cfg_path = tempfile.mkstemp(prefix="mypult-llm-", suffix=".json")
    chat_fd, chat_path = tempfile.mkstemp(prefix="mypult-chats-", suffix=".json")
    os.close(fd)
    os.close(chat_fd)
    old = (llm.CONFIG_PATH, llm.CHATS_PATH, llm._post_chat, llm._post_responses,
           common.respond, common.fail)
    payloads, called = [], []
    try:
        with open(cfg_path, "w", encoding="utf-8") as fh:
            json.dump(config, fh)
        with open(chat_path, "w", encoding="utf-8") as fh:
            json.dump({"active": "chat-1", "chats": [
                {"id": "chat-1", "name": "Чат 1", "messages": []}]}, fh)
        llm.CONFIG_PATH = cfg_path
        llm.CHATS_PATH = chat_path

        def fake_chat(base_url, payload, key, timeout=90):
            payloads.append(dict(payload))
            return chat or {}

        def fake_responses(base_url, payload, key, timeout=120):
            payloads.append(dict(payload))
            if responses is None:
                raise RuntimeError("нет Responses")
            return responses

        llm._post_chat = fake_chat
        llm._post_responses = fake_responses
        common.respond = lambda status, payload, headers=None: called.append((status, payload))
        common.fail = lambda status, message, **extra: called.append(
            (status, dict({"error": message}, **extra)))
        llm.ask(prompt, search=search)
    finally:
        (llm.CONFIG_PATH, llm.CHATS_PATH, llm._post_chat, llm._post_responses,
         common.respond, common.fail) = old
        for path in (cfg_path, chat_path):
            try:
                os.remove(path)
            except OSError:
                pass
    return payloads, called


def _provider_config(provider, search_url=""):
    return {
        "enabled": False, "active": "p1", "web_search": True, "search_url": search_url,
        "profiles": [{"id": "p1", "name": provider, "provider": provider,
                      "model": "m", "base_url": "http://127.0.0.1:1", "key": "k"}],
        "max_tokens": 260, "system_prompt": "",
    }


def test_websearch_parsing():
    import websearch

    check("websearch: запрос без инструкций и вопросительных слов",
          websearch.query_from_prompt(
              "Какая сегодня погода в Екатеринбурге? Ответь одной фразой.")
          == "погода в Екатеринбурге",
          repr(websearch.query_from_prompt(
              "Какая сегодня погода в Екатеринбурге? Ответь одной фразой.")))
    check("websearch: «что нового в X» → «X»",
          websearch.query_from_prompt("Что нового в Python 3.13?") == "Python 3.13",
          repr(websearch.query_from_prompt("Что нового в Python 3.13?")))

    old_fetch = websearch._fetch
    try:
        websearch._fetch = lambda url, timeout=8, accept="application/json": SEARX_FIXTURE
        found = websearch.search_searx("погода", "https://searx.example")
    finally:
        websearch._fetch = old_fetch
    check("websearch: searx разобран", len(found) == 2, str(found))
    check("websearch: searx заголовок без тегов",
          found[1]["title"] == "GISMETEO", str(found[1]))

    nested = websearch.annotations([
        {"type": "url_citation", "url_citation": {
            "url": "https://a/x", "title": "A", "content": "s"}},
        {"type": "url_citation", "url": "https://b/y", "title": "B"},
        {"type": "url_citation", "url_citation": {"url": "https://a/x", "title": "A2"}},
    ])
    check("websearch: аннотации OpenRouter разобраны", len(nested) == 2, str(nested))
    check("websearch: дубликаты источников убраны",
          [item["url"] for item in nested] == ["https://a/x", "https://b/y"], str(nested))
    flat = websearch.annotations(
        OPENAI_BODY["output"][0]["content"][0]["annotations"])
    check("websearch: плоские аннотации OpenAI разобраны",
          flat == [{"title": "GISMETEO", "url": "https://gismeteo.ru/x",
                    "snippet": ""}], str(flat))


def test_llm_native_search():
    payloads, called = _llm_ask_with(_provider_config("openrouter"),
                                     chat=OPENROUTER_BODY)
    payload = payloads[0] if payloads else {}
    check("llm: OpenRouter получает плагин web",
          payload.get("plugins") == [{"id": "web"}], str(payload.get("plugins")))
    result = called[-1][1] if called else {}
    check("llm: источники OpenRouter в ответе", len(result.get("sources") or []) == 1,
          str(result.get("sources")))
    check("llm: источник поиска OpenRouter",
          result.get("search_source") == "openrouter", str(result.get("search_source")))

    payloads, called = _llm_ask_with(_provider_config("openai"), responses=OPENAI_BODY)
    payload = payloads[0] if payloads else {}
    check("llm: OpenAI Responses с инструментом web_search",
          payload.get("tools") == [{"type": "web_search"}], str(payload.get("tools")))
    result = called[-1][1] if called else {}
    check("llm: ответ и источники OpenAI",
          result.get("answer") == "Сейчас +1 °C" and len(result.get("sources") or []) == 1,
          str(result)[:200])
    check("llm: источник поиска OpenAI",
          result.get("search_source") == "openai", str(result.get("search_source")))

    payloads, called = _llm_ask_with(_provider_config("deepseek"),
                                     chat={"choices": [{"message": {"content": "ok"}}]})
    payload = payloads[0] if payloads else {}
    result = called[-1][1] if called else {}
    check("llm: у DeepSeek нет плагина поиска", "plugins" not in payload, str(payload.keys()))
    check("llm: DeepSeek получает честную заметку о поиске",
          "нет встроенного поиска" in str(result.get("search_note") or ""),
          str(result.get("search_note")))
    check("llm: вызовов Responses у DeepSeek нет",
          all("input" not in item for item in payloads), str(payloads))


def test_alice_cli_commands():
    """maind --cli: 'c' — отмена, 's' — слушать, 'q'+текст — запрос."""
    import alice_cli as cli

    class FakeProc:
        def __init__(self):
            self.writes = []
            self.stdin = self

        def write(self, data):
            self.writes.append(data.decode("utf-8"))

        def flush(self):
            pass

        def close(self):
            pass

        def wait(self, timeout=None):
            return 0

        def terminate(self):
            pass

        def kill(self):
            pass

    procs = []
    old_popen, old_available = cli.subprocess.Popen, cli.available
    old_start, old_close = cli.START_DELAY, cli.CLOSE_DELAY
    try:
        cli.available = lambda: True
        cli.START_DELAY = 0
        cli.CLOSE_DELAY = 0
        cli.subprocess.Popen = lambda argv, **kw: (procs.append(FakeProc()), procs[-1])[1]
        cli.cancel()
        cli.listen()
        cli.close_session()
        cli.query("  привет   мир ")
    finally:
        cli.subprocess.Popen, cli.available = old_popen, old_available
        cli.START_DELAY, cli.CLOSE_DELAY = old_start, old_close
        cli._session = None

    check("alice_cli: три процесса", len(procs) == 3, str(len(procs)))
    check("alice_cli: отмена — 'c'", procs[0].writes == ["c\n"], str(procs[0].writes))
    check("alice_cli: слушать — 's', затем 'c' при закрытии",
          procs[1].writes == ["s\n", "c\n"], str(procs[1].writes))
    check("alice_cli: запрос — 'q' и текст",
          procs[2].writes == ["q\n", "привет мир\n"], str(procs[2].writes))


def test_voice_follow_up_words():
    check("follow-up: «хватит» завершает", voice_daemon.follow_up_wanted("Хватит."))
    check("follow-up: «спасибо» завершает", voice_daemon.follow_up_wanted("спасибо!"))
    check("follow-up: обычная фраза продолжает",
          not voice_daemon.follow_up_wanted("а какая погода завтра?"))


def test_voice_speech_post():
    import io
    import urllib.error

    calls = []

    def fake_post(url, payload, timeout=None):
        calls.append(("POST", url, payload))
        return {"type": "speech", "transcript": "привет", "final": True}

    def fake_get(url, timeout=None):
        calls.append(("GET", url, None))
        return {"type": "speech", "transcript": "старая", "final": True}

    old_post, old_get = voice_daemon.post, voice_daemon.get
    old_flag = voice_daemon._LUNA_POST_CANCEL["ok"]
    try:
        voice_daemon.post, voice_daemon.get = fake_post, fake_get
        voice_daemon._LUNA_POST_CANCEL["ok"] = True
        event = voice_daemon._speech_event(500)
        check("голос: follow-up идёт POST-ом", calls and calls[0][0] == "POST", str(calls))
        check("голос: POST несёт cancel и empty_on_timeout",
              "cancel=true" in calls[0][1] and "empty_on_timeout=true" in calls[0][1],
              calls[0][1])
        check("голос: POST возвращает событие", event.get("transcript") == "привет", str(event))

        calls.clear()
        voice_daemon._speech_event(500, cancel=False)
        check("голос: follow-up не отменяет свой диалог",
              "cancel=true" not in calls[0][1], calls[0][1])

        calls.clear()

        def post_timeout(url, payload, timeout=None):
            calls.append(("POST", url, payload))
            raise urllib.error.HTTPError(
                url, 400, "Bad Request", {},
                io.BytesIO(b'{"error":"timeout waiting for speech"}'))

        voice_daemon.post = post_timeout
        event = voice_daemon._speech_event(500)
        check("голос: 400 по таймауту не переключает на GET",
              [c[0] for c in calls] == ["POST"] and "error" in event,
              str([c[0] for c in calls]))
        check("голос: после таймаута POST остаётся включён",
              voice_daemon._LUNA_POST_CANCEL["ok"] is True)

        calls.clear()

        def post_404(url, payload, timeout=None):
            calls.append(("POST", url, payload))
            raise urllib.error.HTTPError(url, 404, "Not Found", {}, io.BytesIO(b"{}"))

        voice_daemon.post = post_404
        event = voice_daemon._speech_event(500)
        check("голос: старый Luna — откат на GET",
              [c[0] for c in calls] == ["POST", "GET"], str([c[0] for c in calls]))
        check("голос: в GET нет незнакомого empty_on_timeout",
              "empty_on_timeout" not in calls[1][1], calls[1][1])
        check("голос: откат запоминается до перезапуска",
              voice_daemon._LUNA_POST_CANCEL["ok"] is False)
        check("голос: GET вернул событие", event.get("transcript") == "старая", str(event))
    finally:
        voice_daemon.post, voice_daemon.get = old_post, old_get
        voice_daemon._LUNA_POST_CANCEL["ok"] = old_flag


def test_voice_recognize_event():
    old_post = voice_daemon.post
    try:
        voice_daemon.post = lambda url, payload, timeout=None: {
            "type": "speech", "source": "voice", "phase": "LISTENING",
            "request_id": "abc", "transcript": " привет ", "final": True,
        }
        event = voice_daemon.recognize_event()
        check("голос: recognize отдаёт request_id", event["request_id"] == "abc", str(event))
        check("голос: recognize приводит phase к нижнему регистру",
              event["phase"] == "listening", str(event))
        check("голос: recognize чистит transcript", event["text"] == "привет", str(event))
        check("голос: recognize() по-прежнему отдаёт текст",
              voice_daemon.recognize() == "привет")
    finally:
        voice_daemon.post = old_post


def test_voice_repeat_filter():
    now = 1000.0
    last = {"text": "Почему так долго", "request_id": "r1", "ts": now}
    check("голос: тот же request_id — повтор",
          voice_daemon.is_repeat(
              {"text": "Почему так долго", "request_id": "r1", "phase": "busy"},
              last, now + 120))
    check("голос: та же фраза через 20 с — повтор",
          voice_daemon.is_repeat(
              {"text": "Почему так долго", "request_id": "r2", "phase": "listening"},
              last, now + 20))
    check("голос: та же фраза через 40 с в listening — новая команда",
          not voice_daemon.is_repeat(
              {"text": "Почему так долго", "request_id": "r2", "phase": "listening"},
              last, now + 40))
    check("голос: та же фраза через 40 с в busy — повтор",
          voice_daemon.is_repeat(
              {"text": "Почему так долго", "request_id": "r2", "phase": "busy"},
              last, now + 40))
    check("голос: та же фраза через 100 с — новая",
          not voice_daemon.is_repeat(
              {"text": "Почему так долго", "request_id": "r2", "phase": "busy"},
              last, now + 100))
    check("голос: другая фраза — новая",
          not voice_daemon.is_repeat(
              {"text": "Включи свет", "request_id": "r2", "phase": "listening"},
              last, now + 5))
    check("голос: пустая история — не повтор",
          not voice_daemon.is_repeat(last, {}, now))


def test_voice_say_append():
    posted = []

    def fake_post(url, payload, timeout=None):
        posted.append((url, dict(payload)))
        return {}

    old_post, old_sleep = voice_daemon.post, voice_daemon.time.sleep
    try:
        voice_daemon.post = fake_post
        voice_daemon.time.sleep = lambda *_: None
        voice_daemon.say("а" * 4000, append=0)
        speaks = [payload for url, payload in posted if url.endswith("/speak.py")]
        check("голос: длинный ответ режется на куски", len(speaks) >= 2, str(len(speaks)))
        check("голос: append=0 только у первого куска",
              speaks[0].get("append") == 0
              and all("append" not in payload for payload in speaks[1:]),
              str(speaks[:3]))
        posted.clear()
        voice_daemon.say("коротко")
        speaks = [payload for url, payload in posted if url.endswith("/speak.py")]
        check("голос: без append=0 очередь Алисы не трогаем",
              len(speaks) == 1 and "append" not in speaks[0], str(speaks))
    finally:
        voice_daemon.post = old_post
        voice_daemon.time.sleep = old_sleep


def test_voice_cancel_native():
    calls = []
    old_post, old_stop = voice_daemon.post, voice_daemon.stop_alice_speech
    try:
        voice_daemon.post = lambda url, payload, timeout=None: calls.append(url) or {}
        voice_daemon.stop_alice_speech = lambda: calls.append("cli")
        voice_daemon.cancel_native_dialog()
        check("голос: отмена диалога через Luna",
              "/api/alice/speech/cancel" in calls[0], str(calls))
        check("голос: CLI остаётся страховкой", "cli" in calls, str(calls))

        calls.clear()
        voice_daemon.cancel_native_dialog(fast=True)
        check("голос: быстрая отмена не запускает процесс CLI",
              calls == ["http://127.0.0.1:8099/api/alice/speech/cancel"], str(calls))

        calls.clear()

        def broken(url, payload, timeout=None):
            raise OSError("no luna")

        voice_daemon.post = broken
        voice_daemon.cancel_native_dialog()
        check("голос: без Luna отмена всё равно уходит в CLI",
              calls == ["cli"], str(calls))
    finally:
        voice_daemon.post = old_post
        voice_daemon.stop_alice_speech = old_stop


def test_voice_follow_up_skip():
    events = [
        {"text": "Как дела", "request_id": "r1", "phase": "listening"},
        {"text": "А почему", "request_id": "r2", "phase": "listening"},
    ]
    calls = []

    old_event = voice_daemon.recognize_event
    old_wait = voice_daemon.wait_alice_idle
    old_sleep = voice_daemon.time.sleep
    try:
        voice_daemon.time.sleep = lambda *_: None

        def fake_event(timeout=120):
            calls.append(timeout)
            return events.pop(0)

        voice_daemon.recognize_event = fake_event
        voice_daemon.wait_alice_idle = lambda timeout=6.0: True
        text = voice_daemon.listen_for_phrase(timeout=5, skip_request_id="r1",
                                              skip_text="Как дела")
        check("follow-up: старый ответ пропущен", text == "А почему", repr(text))
        check("follow-up: распознавание перезапускается",
              len(calls) == 2, str(calls))
    finally:
        voice_daemon.recognize_event = old_event
        voice_daemon.wait_alice_idle = old_wait
        voice_daemon.time.sleep = old_sleep


def test_voice_follow_up_closes_alice():
    calls = []
    old_post = voice_daemon.post
    old_listen = voice_daemon.listen_for_phrase
    old_wait = voice_daemon.wait_alice_idle
    old_state = voice_daemon.alice_state
    try:
        voice_daemon.post = lambda url, payload, timeout=None: calls.append(url) or {}
        voice_daemon.wait_alice_idle = lambda timeout=3.0: True
        voice_daemon.alice_state = lambda: "IDLE"
        voice_daemon.listen_for_phrase = lambda **kwargs: ""
        voice_daemon.follow_up("system")
        check("follow-up: закрывает диалог Алисы перед слушанием",
              any("/api/alice/speech/cancel" in url for url in calls), str(calls))
    finally:
        voice_daemon.post = old_post
        voice_daemon.listen_for_phrase = old_listen
        voice_daemon.wait_alice_idle = old_wait
        voice_daemon.alice_state = old_state


def test_voice_auto_follow_up():
    old_mode = voice_daemon.mic_mode_now
    try:
        voice_daemon.mic_mode_now = lambda: "alice"
        check("follow-up: в alice-режиме отдельный сеанс не нужен",
              not voice_daemon.auto_follow_up({"follow_up": True}))
        voice_daemon.mic_mode_now = lambda: "continuous"
        check("follow-up: в continuous работает как раньше",
              voice_daemon.auto_follow_up({"follow_up": True}))
        check("follow-up: выключенная галочка уважается",
              not voice_daemon.auto_follow_up({"follow_up": False}))
    finally:
        voice_daemon.mic_mode_now = old_mode


def test_voice_llm_cache():
    old_info = voice_daemon.llm_info
    old_snapshot = dict(voice_daemon._LLM_SNAPSHOT)
    try:
        voice_daemon.llm_info = lambda: {
            "enabled": True, "profiles": [{"name": "DeepSeek", "provider": "deepseek"}]}
        voice_daemon.refresh_llm_snapshot()
        check("голос: снимок LLM видит включённую сеть",
              voice_daemon.llm_enabled_cached() is True)

        def broken():
            raise OSError("no net")

        voice_daemon.llm_info = broken
        check("голос: включённость берётся из кэша без HTTP",
              voice_daemon.llm_enabled_cached() is True)
        check("голос: профиль ищется по кэшу",
              bool(voice_daemon.llm_profile_target(
                  "включи дипсик", voice_daemon.llm_snapshot())))
    finally:
        voice_daemon.llm_info = old_info
        voice_daemon._LLM_SNAPSHOT.clear()
        voice_daemon._LLM_SNAPSHOT.update(old_snapshot)


def test_voice_answer_append():
    check("голос: append=0 при BUSY", voice_daemon.answer_append("BUSY") == 0)
    check("голос: append=0 при SPEAKING",
          voice_daemon.answer_append("speaking") == 0)
    check("голос: обычная очередь при IDLE",
          voice_daemon.answer_append("IDLE") == 1)
    check("голос: обычная очередь при пустом состоянии",
          voice_daemon.answer_append("") == 1)


def test_voice_music_intent():
    check("музыка: ютуб и запрос",
          voice_daemon.music_intent("включи ютуб джаз") ==
          {"service": "youtube", "query": "джаз"},
          str(voice_daemon.music_intent("включи ютуб джаз")))
    check("музыка: падеж «на ютубе»",
          voice_daemon.music_intent("включи на ютубе кино") ==
          {"service": "youtube", "query": "кино"},
          str(voice_daemon.music_intent("включи на ютубе кино")))
    check("музыка: саундклауд",
          voice_daemon.music_intent("включи саундклауд lofi") ==
          {"service": "soundcloud", "query": "lofi"},
          str(voice_daemon.music_intent("включи саундклауд lofi")))
    check("музыка: сбер звук",
          voice_daemon.music_intent("включи сбер звук джаз") ==
          {"service": "zvuk", "query": "джаз"},
          str(voice_daemon.music_intent("включи сбер звук джаз")))
    check("музыка: спотифай распознан",
          (voice_daemon.music_intent("включи спотифай кино") or {}).get("service") == "spotify")
    check("музыка: «включи звук» — не сервис",
          voice_daemon.music_intent("включи звук") is None)
    check("музыка: без глагола — не наша",
          voice_daemon.music_intent("ютуб джаз") is None)
    check("музыка: «включи музыку» — без сервиса",
          voice_daemon.music_intent("включи музыку") is None)
    check("музыка: bare-запрос ловится",
          voice_daemon.bare_music_request("включи музыку"))


def test_voice_music_play():
    old_ready = voice_daemon.music_service_ready
    old_post = voice_daemon.post
    calls = []
    try:
        voice_daemon.music_service_ready = lambda service: False
        check("музыка: не настроенный Spotify",
              "Spotify" in voice_daemon.music_play({"service": "spotify"}))
        check("музыка: не настроенный YouTube",
              "не настроен" in voice_daemon.music_play({"service": "youtube"}))

        voice_daemon.music_service_ready = lambda service: True

        def fake_post(url, payload, timeout=None):
            calls.append((url.rsplit("/", 1)[-1], dict(payload)))
            if payload.get("action") == "search":
                return {"tracks": [{"id": "abc", "url": "https://sc/1",
                                    "title": "T", "artist": "A"}]}
            return {}

        voice_daemon.post = fake_post
        check("музыка: YouTube запускается",
              voice_daemon.music_play({"service": "youtube", "query": "джаз"}) == "")
        check("музыка: сначала search, потом play",
              [payload["action"] for _, payload in calls] == ["search", "play"],
              str(calls))
        calls.clear()
        check("музыка: SoundCloud запускается",
              voice_daemon.music_play({"service": "soundcloud", "query": "lofi"}) == "")
        check("музыка: SoundCloud play с url",
              calls[-1][1].get("url") == "https://sc/1", str(calls))
    finally:
        voice_daemon.music_service_ready = old_ready
        voice_daemon.post = old_post


def test_voice_music_wave():
    old_path = voice_daemon.MUSIC_QUEUE_PATH
    old_ready = voice_daemon.music_service_ready
    old_post = voice_daemon.post
    calls = []
    try:
        voice_daemon.MUSIC_QUEUE_PATH = os.path.join(
            tempfile.mkdtemp(prefix="mypult-wave-"), "queue.json")
        voice_daemon.music_service_ready = lambda service: True

        def fake_post(url, payload, timeout=None):
            calls.append((url.rsplit("/", 1)[-1], dict(payload)))
            if payload.get("action") == "search":
                return {"tracks": [
                    {"id": "1", "title": "A", "duration": 100},
                    {"id": "2", "title": "B", "duration": 120},
                ]}
            return {}

        voice_daemon.post = fake_post
        check("музыка: волна YouTube запускается",
              voice_daemon.music_wave_start("youtube") == "")
        queue = voice_daemon.music_queue_load()
        check("музыка: в очереди два трека",
              len(queue.get("tracks") or []) == 2, str(queue))
        check("музыка: играет первый", int(queue.get("index") or 0) == 0)
        check("музыка: поиск и play вызваны",
              [payload["action"] for _, payload in calls] == ["search", "play"],
              str(calls))
        voice_daemon.music_queue_clear()
    finally:
        voice_daemon.MUSIC_QUEUE_PATH = old_path
        voice_daemon.music_service_ready = old_ready
        voice_daemon.post = old_post


def test_voice_passive_wants():
    old_llm = voice_daemon.llm_enabled_cached
    old_info = voice_daemon.llm_info
    try:
        voice_daemon.llm_info = lambda: {"profiles": []}
        voice_daemon.llm_enabled_cached = lambda: True
        check("alice: вопрос уходит в нейросеть",
              voice_daemon.passive_wants("как дела"))
        check("alice: команда пульта забирается",
              voice_daemon.passive_wants("включи впн"))
        check("alice: музыка остаётся Алисе",
              not voice_daemon.passive_wants("включи песню кино"))
        check("alice: свет не трогаем",
              not voice_daemon.passive_wants("включи свет"))
        check("alice: стоп остаётся Алисе",
              not voice_daemon.passive_wants("стоп"))
        check("alice: время остаётся Алисе",
              not voice_daemon.passive_wants("сколько времени"))
        voice_daemon.llm_enabled_cached = lambda: False
        check("alice: без нейросети вопрос не забираем",
              not voice_daemon.passive_wants("как дела"))
        check("alice: без нейросети команды всё равно наши",
              voice_daemon.passive_wants("включи впн"))
    finally:
        voice_daemon.llm_enabled_cached = old_llm
        voice_daemon.llm_info = old_info


def test_voice_native_phrase():
    old_get = voice_daemon.get
    calls = []
    try:
        def fake_get(url, timeout=None):
            calls.append(url)
            return {"transcript": " привет ", "request_id": "r1",
                    "phase": "LISTENING", "source": "voice"}

        voice_daemon.get = fake_get
        event = voice_daemon.native_phrase(1000)
        check("alice: читает command без cancel",
              "/api/alice/command" in calls[0] and "cancel" not in calls[0], calls[0])
        check("alice: пустой таймаут не шумит",
              "empty_on_timeout=true" in calls[0], calls[0])
        check("alice: поля события разобраны",
              event["text"] == "привет" and event["request_id"] == "r1"
              and event["phase"] == "listening", str(event))
    finally:
        voice_daemon.get = old_get


def test_status_probe_cache():
    import status

    status._PROBES.clear()
    counters = {"glagol": 0, "ipc": 0}
    old_latency, old_open = common.tcp_latency, common.port_open

    def fake_latency(port, *args, **kwargs):
        if port == 1961:
            counters["glagol"] += 1
            return 1.5
        return 2.5

    def fake_open(port, *args, **kwargs):
        counters["ipc"] += 1
        return True

    try:
        common.tcp_latency, common.port_open = fake_latency, fake_open
        status.build()
        status.build()
        check("status: успешная проба Glagol кэшируется",
              counters["glagol"] == 1, str(counters))
        check("status: успешная проба IPC кэшируется",
              counters["ipc"] == 1, str(counters))
        check("status: в detail остаётся живое значение",
              status.build()["detail"]["glagol_ms"] == 1.5, str(status.build()["detail"]))

        status._PROBES.clear()
        counters.update(glagol=0, ipc=0)

        def dead_latency(port, *args, **kwargs):
            if port == 1961:
                counters["glagol"] += 1
            return None

        def dead_open(port, *args, **kwargs):
            counters["ipc"] += 1
            return False

        common.tcp_latency, common.port_open = dead_latency, dead_open
        status.build()
        status.build()
        check("status: неудачная проба повторяется каждый раз",
              counters["glagol"] == 2, str(counters))
    finally:
        common.tcp_latency, common.port_open = old_latency, old_open
        status._PROBES.clear()


def test_lyrics_parse():
    lines = lyrics.parse_lrc(
        "[00:12.34] Первая строка\n"
        "[01:02] Вторая строка\n"
        "не LRC\n"
        "[00:05.5][00:20.0] Повтор\n")
    check("текст: LRC разобран", len(lines) == 4, str(lines))
    check("текст: время в секундах", lines[0] == {"t": 12.34, "text": "Первая строка"},
          str(lines[0]))
    check("текст: строка без долей", lines[1] == {"t": 62.0, "text": "Вторая строка"},
          str(lines[1]))
    check("текст: повтор с двумя метками", lines[2]["t"] == 5.5 and lines[3]["t"] == 20.0,
          str(lines[2:4]))


def test_ring_animations_list():
    import shutil
    import tempfile

    folder = tempfile.mkdtemp(prefix="mypult-anim-")
    try:
        for name in ("alice_listening.led", "boot.binscled.zst", "readme.txt"):
            with open(os.path.join(folder, name), "w", encoding="utf-8") as fh:
                fh.write("x")
        old = display.ANIM_DIRS
        display.ANIM_DIRS = (folder,)
        try:
            items = display.ring_animations()
        finally:
            display.ANIM_DIRS = old
    finally:
        shutil.rmtree(folder, ignore_errors=True)
    names = [item["name"] for item in items]
    check("кольцо: .led попал в список", "alice_listening" in names, str(names))
    check("кольцо: .binscled.zst попал", "boot" in names, str(names))
    check("кольцо: посторонние файлы отброшены", "readme" not in names, str(names))


def test_ring_animation_preview():
    import shutil
    import tempfile

    folder = tempfile.mkdtemp(prefix="mypult-anim-prev-")
    try:
        tokens = ["%02x%02x%02x" % (i % 256, (i * 3) % 256, (i * 7) % 256)
                  for i in range(48)]
        body = "loop\n" + " ".join(tokens) + "\n"
        with open(os.path.join(folder, "demo.led"), "w", encoding="ascii") as fh:
            fh.write(body)
        old = display.ANIM_DIRS
        display.ANIM_DIRS = (folder,)
        try:
            preview = display.anim_preview("demo")
        finally:
            display.ANIM_DIRS = old
    finally:
        shutil.rmtree(folder, ignore_errors=True)
    check("анимация: два кадра по 24 диода", len(preview["frames"]) == 2,
          str(len(preview.get("frames") or [])))
    check("анимация: кадр содержит 24 цвета", len(preview["frames"][0]) == 24,
          str(len(preview["frames"][0])))
    check("анимация: флаг loop прочитан", preview["loop"] is True)
    check("анимация: первый цвет совпал", preview["frames"][0][0] == "000000",
          preview["frames"][0][0])


def test_ring_forward():
    """state_daemon.ring_forward ходит в Luna без запуска CGI."""
    import state_daemon

    class FakeResponse:
        status = 200

        def read(self, size=None):
            return b"{}"

    class FakeConnection:
        def __init__(self, host, port, timeout=2.0):
            self.host, self.port = host, port
            self.sent = None
            self.closed = False

        def request(self, method, path, body=None, headers=None):
            self.sent = (method, path, body, headers)

        def getresponse(self):
            return FakeResponse()

        def close(self):
            self.closed = True

    created = []

    def factory(host, port, timeout=2.0):
        connection = FakeConnection(host, port, timeout)
        created.append(connection)
        return connection

    old = state_daemon.http.client.HTTPConnection
    try:
        state_daemon.http.client.HTTPConnection = factory
        ok = state_daemon.ring_forward(["#FF0000"] * 3)
    finally:
        state_daemon.http.client.HTTPConnection = old

    connection = created[0] if created else None
    check("кольцо: кадр уходит в Luna", ok and connection is not None)
    check("кольцо: адрес и путь Luna", connection and connection.host == "127.0.0.1"
          and connection.port == 8099
          and connection.sent[1] == "/api/led/ring", str(connection and connection.sent[:2]))
    check("кольцо: цвета сериализованы",
          connection and b"#FF0000" in (connection.sent[2] or b""),
          str(connection and connection.sent[2]))


def test_ring_reset_and_stop():
    """Сброс и «Стоп» должны гасить кольцо, а не оставлять последний кадр."""
    import display

    calls = []
    state = {"enabled": True, "min": 10, "max": 150,
             "display_enabled": False, "display_min": 10, "display_max": 170}
    old = (display.luna_ring_off, display.animation_stop,
           display.set_ring_brightness, display.load_auto, display.save_auto)
    try:
        display.luna_ring_off = lambda: calls.append("off") or True
        display.animation_stop = lambda: calls.append("stop") or True
        display.set_ring_brightness = lambda value: (
            calls.append(("bright", value)) or value)
        display.load_auto = lambda: dict(state)
        display.save_auto = lambda config: (state.update(config),
                                            calls.append("save"))
        result = display.reset_ring()
    finally:
        (display.luna_ring_off, display.animation_stop,
         display.set_ring_brightness, display.load_auto,
         display.save_auto) = old

    check("кольцо: сброс сначала останавливает анимацию, потом гасит",
          calls[:2] == ["stop", "off"], str(calls))
    check("кольцо: сброс возвращает яркость по умолчанию",
          ("bright", 255) in calls, str(calls))
    check("кольцо: сброс снимает автояркость и отдаёт off",
          result.get("off") is True and result["auto"]["enabled"] is False,
          str(result))


def test_media_pause_via_cli():
    """Пауза/стоп идут через maind --cli 'o' — Glagol слишком медленный."""
    import media

    if media.alice_cli is None:
        check("media: CLI доступен", False)
        return
    calls = []
    old = (media.common.params, media.common.respond, media.alice_cli.pause)
    try:
        media.common.params = lambda: {"action": "pause"}
        media.common.respond = lambda status, payload, headers=None: calls.append(
            (status, payload))
        media.alice_cli.pause = lambda: calls.append("pause") or True
        media.main()
    finally:
        media.common.params, media.common.respond = old[0], old[1]
        media.alice_cli.pause = old[2]

    check("media: пауза через maind --cli", calls and calls[0] == "pause", str(calls))
    check("media: ответ via=cli",
          calls and calls[-1][1].get("via") == "cli", str(calls[-1:]))


def _fresh_musicapi():
    """Импорт musicapi именно из тестового дерева, а не из /data/myweb."""
    import importlib
    sys.path.insert(0, CGI_DIR)
    sys.modules.pop("musicapi", None)
    return importlib.import_module("musicapi")


def test_musicapi():
    """Токен станции для Яндекс Музыки и разбор лайков."""
    import shutil
    import tempfile

    musicapi = _fresh_musicapi()

    folder = tempfile.mkdtemp(prefix="mypult-music-")
    account = os.path.join(folder, "account_storage.dat")
    with open(account, "wb") as fh:
        fh.write(b'\x00\x01"y0__R0FakeTokenABCDEFGHIJKLMNOP1234567890"rest')
    old_account = musicapi.ACCOUNT
    try:
        musicapi.ACCOUNT = account
        tokens = musicapi._tokens()
    finally:
        musicapi.ACCOUNT = old_account
    check("музыка: OAuth-токен найден в account_storage",
          tokens and tokens[0].startswith("y0_"), str(tokens))
    check("музыка: токен без кавычек", tokens and '"' not in tokens[0],
          str(tokens))

    cache = os.path.join(folder, "likes.json")
    old = (musicapi.account, musicapi._request, musicapi.LIKES_CACHE)
    try:
        musicapi.account = lambda force=False: ("tok", "42")
        musicapi.LIKES_CACHE = cache

        def fake_request(token, path, form=None, timeout=15):
            check("музыка: путь лайков", path == "/users/42/likes/tracks", path)
            return {"result": {"library": {"tracks": [
                {"id": "111", "track": {"id": "111"}},
                {"id": "222", "track": {"id": "222"}},
            ]}}}

        musicapi._request = fake_request
        ids = musicapi.likes(force=True)
    finally:
        musicapi.account, musicapi._request, musicapi.LIKES_CACHE = old
        shutil.rmtree(folder, ignore_errors=True)
    check("музыка: лайки разобраны", ids == {"111", "222"}, str(ids))


def test_music_queue():
    """Очередь из альбома, похожие и избранное через Music API."""
    musicapi = _fresh_musicapi()

    old = (musicapi.account, musicapi._request, musicapi._player)
    try:
        musicapi.account = lambda force=False: ("tok", "42")
        musicapi._player = lambda: {"id": "7", "title": "Сейчас",
                                    "playlist_type": "Album", "playlist_id": "123"}

        def fake(token, path, form=None, timeout=15, query=None):
            if path == "/albums/123/with-tracks":
                return {"result": {"title": "Альбом", "volumes": [[
                    {"id": "7", "title": "A", "artists": [{"name": "X"}],
                     "durationMs": 125000},
                    {"id": "8", "title": "B", "artists": [{"name": "Y"}]},
                ]]}}
            if path == "/tracks/7/similar":
                return {"result": {"similarTracks": [
                    {"id": "9", "title": "Похожий", "artists": [{"name": "Z"}]}]}}
            if path == "/users/42/likes/tracks":
                return {"result": {"library": {"tracks": [{"id": "10"}]}}}
            if path == "/tracks/10":
                return {"result": [{"id": "10", "title": "Любимый",
                                    "artists": [{"name": "W"}]}]}
            return {}

        musicapi._request = fake
        musicapi.FAVORITES_CACHE = "/tmp/mypult-fav-test.json"
        try:
            os.remove(musicapi.FAVORITES_CACHE)
        except OSError:
            pass
        queue = musicapi.queue()
        similar = musicapi.similar()
        favorites = musicapi.favorites()
    finally:
        musicapi.account, musicapi._request, musicapi._player = old

    check("музыка: очередь альбома", queue["title"] == "Альбом"
          and [t["id"] for t in queue["tracks"]] == ["7", "8"], str(queue))
    check("музыка: индекс текущего трека", queue["index"] == 0, str(queue["index"]))
    check("музыка: длительность в секундах",
          queue["tracks"][0]["duration"] == 125, str(queue["tracks"][0]))
    check("музыка: похожие", similar["tracks"][0]["title"] == "Похожий", str(similar))
    check("музыка: избранное", favorites["tracks"][0]["title"] == "Любимый",
          str(favorites))


def _fresh_module(name, folder):
    import importlib
    sys.path.insert(0, folder)
    sys.modules.pop(name, None)
    return importlib.import_module(name)


def test_alarm_rules():
    """Валидация будильника и расписание."""
    import datetime
    import json
    import os
    import tempfile

    alarm = _fresh_module("alarm", CGI_DIR)
    alarmd = _fresh_module("alarmd", SERVICE_DIR)

    item = alarm.build({
        "time": "07:30", "days": [1, 2, 3, 4, 5], "mode": "radio",
        "text": "Маяк", "volume": 150, "ramp": -5, "stop_after": 0, "snooze": 0,
    })
    check("будильник: время и дни", item["time"] == "07:30"
          and item["days"] == [1, 2, 3, 4, 5], str(item))
    check("будильник: границы громкости", item["volume"] == 100, str(item["volume"]))
    check("будильник: рампа и snooze зажаты", item["ramp"] == 0
          and item["snooze"] == 1, str((item["ramp"], item["snooze"])))
    check("будильник: текст сохранён", item["text"] == "Маяк")

    music = alarm.build({"time": "08:00", "mode": "music", "text": ""})
    check("будильник: Яндекс Музыка по умолчанию",
          music["mode"] == "music" and music["text"] == "мою волну", str(music))

    once = alarm.build({"time": "09:00", "once": True, "days": [1, 2, 3]})
    check("будильник: одноразовый без дней",
          once["once"] is True and once["days"] == [], str(once))
    sound = alarm.build({"time": "09:00", "mode": "sound", "text": "morning"})
    check("будильник: свой звук", sound["mode"] == "sound"
          and sound["text"] == "morning", str(sound))
    try:
        alarm.build({"time": "09:00", "mode": "sound", "text": ""})
        no_sound = False
    except ValueError:
        no_sound = True
    check("будильник: без звука отклонён", no_sound)
    repeat = alarm.build({"time": "09:00", "once": False, "days": [6, 7]})
    check("будильник: повторяемый с днями",
          repeat["once"] is False and repeat["days"] == [6, 7], str(repeat))
    try:
        alarm.build({"time": "09:00", "once": False, "days": []})
        no_days = False
    except ValueError:
        no_days = True
    check("будильник: повтор без дней отклонён", no_days)

    check("будильник: пояс браузера принимается",
          alarm.timezone_name("Asia/Yekaterinburg") == "Asia/Yekaterinburg")
    try:
        alarm.timezone_name("Mars/Base")
        bad_tz = False
    except ValueError:
        bad_tz = True
    check("будильник: неизвестный пояс отклонён", bad_tz)

    old_data = alarmd.DATA
    fd, path = tempfile.mkstemp(prefix="mypult-tz-", suffix=".json")
    os.close(fd)
    try:
        with open(path, "w", encoding="utf-8") as fh:
            json.dump({"timezone": "Asia/Yekaterinburg", "alarms": []}, fh)
        alarmd.DATA = path
        now = alarmd.AlarmScheduler()._now()
        check("будильник: планировщик в поясе панели",
              now.utcoffset() == datetime.timedelta(hours=5), str(now))
    finally:
        alarmd.DATA = old_data
        os.remove(path)

    try:
        alarm.build({"time": "25:00"})
        bad = False
    except ValueError:
        bad = True
    check("будильник: неверное время отклонено", bad)

    scheduler = alarmd.AlarmScheduler()
    friday = datetime.datetime(2026, 11, 20, 7, 30)
    rule = {"enabled": True, "time": "07:30", "days": [1, 2, 3, 4, 5], "id": "a1"}
    check("будильник: срабатывает в срок",
          scheduler._due(rule, friday) is True)
    check("будильник: догоняет в пределах 5 минут",
          scheduler._due(rule, friday.replace(minute=34)) is True)
    check("будильник: не догоняет спустя 6 минут",
          scheduler._due(rule, friday.replace(minute=36)) is False)
    check("будильник: не срабатывает раньше времени",
          scheduler._due(rule, friday.replace(minute=29)) is False)
    once_rule = {"enabled": True, "time": "07:30", "days": [],
                 "once": True, "id": "a2"}
    check("будильник: одноразовый срабатывает",
          scheduler._due(once_rule, friday) is True)

    fd2, path2 = tempfile.mkstemp(prefix="mypult-once-", suffix=".json")
    os.close(fd2)
    try:
        with open(path2, "w", encoding="utf-8") as fh:
            json.dump({"alarms": [dict(once_rule)]}, fh)
        alarmd.DATA = path2
        scheduler._disable_once("a2")
        with open(path2, "r", encoding="utf-8") as fh:
            saved = json.load(fh)
        check("будильник: одноразовый выключается",
              saved["alarms"][0]["enabled"] is False, str(saved))
    finally:
        alarmd.DATA = old_data
        os.remove(path2)
    check("будильник: выключенный не срабатывает",
          scheduler._due(dict(rule, enabled=False), friday) is False)
    check("будильник: без дней — каждый день",
          scheduler._due(dict(rule, days=[]), friday) is True)
    check("будильник: ключ уникален по дате",
          scheduler._key(rule, friday) == "a1|2026-11-20|07:30",
          scheduler._key(rule, friday))

    old_snooze = alarmd.SNOOZE
    fd3, snooze_path = tempfile.mkstemp(prefix="mypult-snooze-", suffix=".json")
    os.close(fd3)
    os.remove(snooze_path)
    try:
        alarmd.SNOOZE = snooze_path
        scheduler.snooze_alarm = dict(rule)
        scheduler.snooze_until = 1795200000.0
        scheduler._save_snooze()
        restored = alarmd.AlarmScheduler()
        check("будильник: отложенный переживает перезапуск",
              restored.snooze_alarm == rule and restored.snooze_until == 1795200000.0,
              str((restored.snooze_alarm, restored.snooze_until)))
        restored._clear_snooze()
        check("будильник: отложенный очищается", not os.path.exists(snooze_path))
    finally:
        alarmd.SNOOZE = old_snooze
        try:
            os.remove(snooze_path)
        except OSError:
            pass


def test_clock_animation():
    """Кадры анимации часов: 45 сегментов, волна/пульс/радуга/стоп."""
    import state_daemon

    wave = state_daemon.clock_frame("wave", 0.0, 45, 200)
    check("часы: 45 сегментов", len(wave) == 45, str(len(wave)))
    check("часы: волна светит", max(wave) >= 150, str(max(wave)))
    check("часы: стоп — нули", set(state_daemon.clock_frame("off", 0.0, 45, 200)) == {0})
    check("часы: пульс меняется по фазе",
          state_daemon.clock_frame("pulse", 0.0, 45, 200)
          != state_daemon.clock_frame("pulse", 0.25, 45, 200))
    check("часы: значения в 0..255",
          all(0 <= value <= 255 for value in state_daemon.clock_frame("rainbow", 0.3)))
    snake = state_daemon.clock_frame("snake", 0.25, 45, 200)
    check("часы: змейка — яркий хвост", max(snake) >= 150 and min(snake) <= 10,
          str((max(snake), min(snake))))
    scan = state_daemon.clock_frame("scan", 0.5, 45, 200)
    check("часы: скан движется", max(scan) >= 150 and min(scan) <= 10,
          str((max(scan), min(scan))))
    sparkle = state_daemon.clock_frame("sparkle", 0.1, 45, 200)
    check("часы: искры в пределах", any(value > 100 for value in sparkle)
          and all(0 <= value <= 255 for value in sparkle))
    sunrise = state_daemon.clock_frame("sunrise", 0.2, 45, 200)
    check("часы: рассвет заполняет", any(value > 100 for value in sunrise)
          and any(value < 20 for value in sunrise))

    anim = display.clean_clock_anim({
        "name": "Подмигивание",
        "frames": [["abcdefg", "", "", ""], ["", "abcdefg", "", ""]],
        "duration": 120,
    })
    check("часы: кадры анимации сохранены",
          anim["name"] == "Подмигивание" and len(anim["frames"]) == 2
          and anim["frames"][0][0] == "abcdefg" and anim["duration"] == 120, str(anim))
    try:
        display.clean_clock_anim({"name": "x", "frames": [["abc"]], "duration": 100})
        bad_frame = False
    except ValueError:
        bad_frame = True
    check("часы: кривой кадр отклонён", bad_frame)


def test_discovery_payload():
    import json

    expected = ""
    try:
        with open(os.path.join(HERE, "..", "version.json"), "r", encoding="utf-8") as fh:
            expected = str(json.load(fh).get("version") or "")
    except (OSError, ValueError, TypeError):
        pass

    check("discovery: порт 8056", discovery.PORT == 8056, str(discovery.PORT))
    check("discovery: запрос MYPULT_DISCOVER", discovery.DISCOVER == b"MYPULT_DISCOVER")

    old_version = discovery.version
    old_model = discovery.model
    old_ip = discovery.local_ip
    old_hostname = discovery.socket.gethostname
    payload = {}
    try:
        discovery.version = lambda: expected or "0.0.0"
        discovery.model = lambda: "Yandex Station Midi"
        discovery.local_ip = lambda: "192.168.31.220"
        discovery.socket.gethostname = lambda: "mypult-kitchen"
        payload = discovery.payload()
    finally:
        discovery.version = old_version
        discovery.model = old_model
        discovery.local_ip = old_ip
        discovery.socket.gethostname = old_hostname

    check("discovery: service=midipult", payload.get("service") == "midipult", repr(payload))
    check("discovery: api=1", payload.get("api") == 1, repr(payload))
    check("discovery: имя станции", payload.get("name") == "mypult-kitchen", repr(payload))
    check("discovery: модель", payload.get("model") == "Yandex Station Midi", repr(payload))
    check("discovery: версия", payload.get("version") == expected, repr(payload))
    check("discovery: ip", payload.get("ip") == "192.168.31.220", repr(payload))
    check("discovery: port=8055", payload.get("port") == 8055, repr(payload))

    from_json = discovery.version(paths=(os.path.join(HERE, "..", "version.json"),))
    check("discovery: version() читает version.json", from_json == expected,
          "%r != %r" % (from_json, expected))
    missing = discovery.version(paths=(os.path.join(HERE, "no-such-version.json"),))
    check("discovery: version() без файла -> ''", missing == "", repr(missing))


# --------------------------------------------------------------------------- #
#  update.py: релизы панели, Android-фильтр и защита от релизов без архива
# --------------------------------------------------------------------------- #

def make_release(tag, *assets, **flags):
    """Минимальный объект GitHub Release: tag_name, assets и флаги."""
    item = {
        "tag_name": tag,
        "name": "release " + tag,
        "assets": [
            {"name": name,
             "browser_download_url": "https://example.invalid/" + name,
             "size": 1}
            for name in assets
        ],
    }
    item.update(flags)
    return item


def test_update_release_filter():
    android = make_release("android-v1.0.2", "midipult-android-1.0.2.apk")
    no_archive = make_release("v0.4.60")
    panel = make_release("v0.4.52", "midipult-0.4.52.tar.gz",
                         "midipult-0.4.52.tar.gz.sha256")
    draft = make_release("v0.4.99", "midipult-0.4.99.tar.gz", draft=True)
    prerelease = make_release("v0.4.98", "midipult-0.4.98.tar.gz", prerelease=True)

    check("update: android-v1.0.2 не версия панели",
          update.release_version(android) == "", update.release_version(android))
    check("update: версия панели из тега v0.4.52",
          update.release_version(panel) == "0.4.52", update.release_version(panel))

    picked = update.pick_panel_release([draft, prerelease, android, no_archive, panel])
    check("update: draft, prerelease и android пропущены",
          picked is no_archive, str(picked.get("tag_name")))

    picked = update.pick_panel_release([android, panel])
    check("update: после Android выбирается релиз панели",
          picked is panel and update.release_version(picked) == "0.4.52")

    try:
        update.pick_panel_release([android])
        rejected = False
    except ValueError:
        rejected = True
    check("update: только Android -> ошибка", rejected)

    archive, sha = update.release_assets(panel, "0.4.52")
    check("update: архив и sha релиза панели найдены", bool(archive and sha))


def test_update_beta_channel():
    beta = make_release("v0.6.94-beta", "midipult-0.6.94-beta.tar.gz",
                        prerelease=True)
    stable = make_release("v0.6.93", "midipult-0.6.93.tar.gz")

    check("update: бета не попадает в стабильный канал",
          update.pick_panel_release([beta, stable]) is stable)
    check("update: на бете берётся самая свежая",
          update.pick_panel_release([stable, beta], allow_beta=True) is beta)
    check("update: бета ниже стабильной того же номера",
          update.version_key("0.6.94-beta") < update.version_key("0.6.94"))
    check("update: с беты на стабильную — обновление",
          update.update_available("0.6.93", "0.6.94-beta", "stable", False, True))
    check("update: стабильная не обновление на бете",
          not update.update_available("0.6.93", "0.6.94-beta", "beta", False, True))
    check("update: стабильная новее беты — обновление",
          update.update_available("0.6.94", "0.6.93", "beta", False, True))
    check("update: установленная бета без суффикса — возврат на стабильную",
          update.update_available("0.6.94", "0.6.95", "stable", False, True, True))

    old_settings = update.load_settings
    try:
        update.load_settings = lambda: {"installed_prerelease": True}
        public = update.public_release({})
        check("update: статус отдаёт признак установленной беты",
              public.get("installed_prerelease") is True)
    finally:
        update.load_settings = old_settings


def test_update_check_guard():
    import time

    def release(version, with_archive):
        names = (("midipult-%s.tar.gz" % version, "midipult-%s.tar.gz.sha256" % version)
                 if with_archive else ())
        return {
            "tag": "v" + version,
            "version": version,
            "name": "MidiPult " + version,
            "body": "",
            "published_at": "",
            "html_url": "",
            "assets": [{"name": name, "url": "https://example.invalid/" + name,
                        "size": 1} for name in names],
        }

    old_fetch = update.fetch_release
    old_cache = update.load_cache
    old_current = update.current_version
    old_write = common.write_json
    try:
        update.current_version = lambda: "0.4.51"
        update.load_cache = lambda: {}
        common.write_json = lambda *args, **kwargs: None

        update.fetch_release = lambda *args, **kwargs: release("0.4.99", False)
        data = update.check(force=True)
        check("update: релиз без архива не считается обновлением",
              data.get("update_available") is False, repr(data.get("update_available")))
        check("update: есть ошибка про архив",
              "архив" in str(data.get("error") or "").lower(), repr(data.get("error")))

        update.fetch_release = lambda *args, **kwargs: release("0.4.52", True)
        data = update.check(force=True)
        check("update: v0.4.x с архивом — обновление",
              data.get("update_available") is True, repr(data.get("update_available")))
        check("update: архив попал в ответ", bool(data.get("archive")))

        update.load_cache = lambda: {"checked_at": int(time.time()), "version": "0.4.60",
                                     "ok": True, "archive": None, "sha": None}
        data = update.check()
        check("update: кэш без архива не обновление",
              data.get("update_available") is False, repr(data.get("update_available")))

        update.load_cache = lambda: {"checked_at": int(time.time()), "version": "0.4.60",
                                     "ok": True,
                                     "archive": {"name": "midipult-0.4.60.tar.gz"},
                                     "sha": {"name": "midipult-0.4.60.tar.gz.sha256"}}
        data = update.check()
        check("update: кэш с архивом — обновление",
              data.get("update_available") is True, repr(data.get("update_available")))
    finally:
        update.fetch_release = old_fetch
        update.load_cache = old_cache
        update.current_version = old_current
        common.write_json = old_write


def test_update_fetch_release():
    import json

    class FakeResponse:
        def __init__(self, body):
            self._body = body

        def read(self):
            return self._body

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

    android = make_release("android-v1.0.2", "midipult-android-1.0.2.apk")
    draft = make_release("v0.4.99", "midipult-0.4.99.tar.gz", draft=True)
    panel = make_release("v0.4.52", "midipult-0.4.52.tar.gz",
                         "midipult-0.4.52.tar.gz.sha256")
    body = json.dumps([android, draft, panel]).encode("utf-8")

    old_urlopen = update.urllib.request.urlopen
    try:
        update.urllib.request.urlopen = lambda request, timeout=None: FakeResponse(body)
        fetched = update.fetch_release()
    finally:
        update.urllib.request.urlopen = old_urlopen

    check("update: fetch_release пропускает Android и draft",
          fetched["tag"] == "v0.4.52" and fetched["version"] == "0.4.52", str(fetched))
    archive, sha = update.release_assets(fetched, fetched["version"])
    check("update: fetch_release возвращает архив и sha", bool(archive and sha))


def test_llm_chat_names():
    import json
    import tempfile

    old_path = llm.CHATS_PATH
    fd, path = tempfile.mkstemp(prefix="mypult-chats-", suffix=".json")
    os.close(fd)
    try:
        llm.CHATS_PATH = path
        data = llm.chat_switch({"chat_new": 1, "chat_name": "  Работа  "})
        active = llm.active_chat(data)
        check("чат: имя из запроса", active.get("name") == "Работа", str(active))
        first = active.get("id")

        data = llm.chat_switch({"chat_rename": first, "chat_name": "«Дела»"})
        check("чат: переименование", llm.active_chat(data).get("name") == "Дела",
              str(llm.active_chat(data)))
        with open(path, "r", encoding="utf-8") as fh:
            saved = json.load(fh)
        check("чат: имя сохранено в файле", llm.active_chat(saved).get("name") == "Дела")

        data = llm.chat_switch({"chat_new": 1, "chat_name": "дела"})
        check("чат: одинаковые имена разведены",
              llm.active_chat(data).get("name") == "дела 2", str(llm.active_chat(data)))

        data = llm.chat_switch({"chat_new": 1, "chat_name": "Отчёты"})
        second = llm.active_chat(data).get("id")
        data = llm.chat_switch({"chat_rename": second, "chat_name": "Дела"})
        check("чат: rename не создаёт дубль",
              llm.active_chat(data).get("name") == "Дела 3", str(llm.active_chat(data)))

        data = llm.chat_switch({"chat_new": 1})
        check("чат: без имени получает «Чат N»",
              str(llm.active_chat(data).get("name")).startswith("Чат "),
              str(llm.active_chat(data)))
        check("чат: имя чистится",
              llm.clean_chat_name("  «Мой   чат»  ") == "Мой чат",
              llm.clean_chat_name("  «Мой   чат»  "))
    finally:
        llm.CHATS_PATH = old_path
        try:
            os.remove(path)
        except OSError:
            pass


def test_llm_chat_history():
    import json
    import tempfile

    old_path, old_ok, old_fail = llm.CHATS_PATH, llm.common.ok, llm.common.fail
    fd, path = tempfile.mkstemp(prefix="mypult-chats-", suffix=".json")
    os.close(fd)
    out = {}
    try:
        with open(path, "w", encoding="utf-8") as fh:
            json.dump({"active": "chat-2", "chats": [
                {"id": "chat-1", "name": "Старый", "messages": [
                    {"role": "user", "content": "раз"}, {"role": "assistant", "content": "два"}]},
                {"id": "chat-2", "name": "Голос", "messages": [
                    {"role": "user", "content": "Кто ты?"},
                    {"role": "assistant", "content": "Я Claude."},
                    "мусор"]},
                {"id": "chat-long", "name": "Длинный", "messages": [
                    {"role": "user" if index % 2 == 0 else "assistant",
                     "content": "m%d" % index} for index in range(25)]},
            ]}, fh, ensure_ascii=False)
        llm.CHATS_PATH = path
        llm.common.ok = lambda **payload: out.update(ok=True, **payload)
        llm.common.fail = lambda status, message, **extra: out.update(ok=False, status=status)

        llm.chat_history()
        check("история: по умолчанию активный чат", out.get("chat_id") == "chat-2", str(out))
        check("история: сообщения по порядку, мусор отброшен",
              out.get("messages") == [{"role": "user", "content": "Кто ты?", "ts": 0},
                                      {"role": "assistant", "content": "Я Claude.", "ts": 0}],
              str(out.get("messages")))

        out.clear()
        llm.chat_history("chat-1")
        check("история: выбранный чат", out.get("chat_name") == "Старый"
              and len(out.get("messages") or []) == 2, str(out))

        out.clear()
        llm.chat_history("chat-9")
        check("история: неизвестный чат -> 404", out.get("status") == 404, str(out))
        out.clear()
        llm.chat_history("chat-long")
        check("история: не больше 20 сообщений",
              len(out.get("messages") or []) == 20
              and out["messages"][-1]["content"] == "m24", str(out.get("messages"))[:200])
        with open(path, "r", encoding="utf-8") as fh:
            check("история: файл чатов не меняется", json.load(fh).get("active") == "chat-2")
    finally:
        llm.CHATS_PATH, llm.common.ok, llm.common.fail = old_path, old_ok, old_fail
        try:
            os.remove(path)
        except OSError:
            pass


def test_llm_context_note():
    import datetime

    moment = datetime.datetime(2026, 11, 19, 14, 5, tzinfo=datetime.timezone.utc)
    note = llm.context_note({"timezone": "Europe/Kaliningrad", "location": "Калининград"}, moment)
    check("контекст: местное время и дата",
          "четверг, 19 ноября 2026 года, 16:05" in note, note)
    check("контекст: пояс и смещение", "Europe/Kaliningrad, UTC+02:00" in note, note)
    check("контекст: местоположение", "Калининград" in note, note)

    note = llm.context_note({"timezone": "UTC", "location": ""}, moment)
    check("контекст: без места строки о месте нет", "находится" not in note, note)
    check("контекст: явный UTC", "14:05 (часовой пояс UTC, UTC+00:00)" in note, note)
    local = llm.local_now({"timezone": ""}, moment)
    check("контекст: без пояса — местное время станции",
          local.utcoffset() == moment.astimezone().utcoffset(), str(local))
    note = llm.context_note({"timezone": "Mars/Base"}, moment)
    check("контекст: неизвестный пояс не роняет", "Сейчас " in note, note)
    check("пояс: проверка имени", llm.zone("Europe/Moscow") is not None and llm.zone("Mars/Base") is None)


def test_llm_anthropic_native():
    sent = []
    replies = []
    old_post = llm.post_json

    def fake_post(url, payload, headers, timeout=90):
        import copy
        sent.append((url, copy.deepcopy(payload), dict(headers)))
        return replies.pop(0)

    llm.post_json = fake_post
    try:
        dialog = [{"role": "user", "content": "раз"}, {"role": "assistant", "content": "два"},
                  {"role": "user", "content": "Какая погода?"}]
        replies.append({
            "stop_reason": "end_turn",
            "usage": {"input_tokens": 100, "output_tokens": 20, "server_tool_use": {"web_search_requests": 1}},
            "content": [
                {"type": "text", "text": "Сейчас посмотрю."},
                {"type": "server_tool_use", "name": "web_search", "input": {"query": "погода"}},
                {"type": "web_search_tool_result", "content": [
                    {"type": "web_search_result", "url": "https://weather.example/a", "title": "Погода A"},
                    {"type": "web_search_result", "url": "https://weather.example/b", "title": "Погода B"},
                ]},
                {"type": "thinking", "thinking": ""},
                {"type": "text", "text": "Сейчас +19, ", "citations": [
                    {"type": "web_search_result_location", "url": "https://weather.example/b",
                     "title": "Погода B", "cited_text": "+19, малооблачно"}]},
                {"type": "text", "text": "малооблачно."},
            ]})
        answer, usage, sources = llm.anthropic_messages("https://api.anthropic.com/v1", "k", "claude-haiku-5-5",
                                               "SYS", dialog, 260, True)
        url, payload, headers = sent[-1]
        check("anthropic: адрес /v1/messages", url == "https://api.anthropic.com/v1/messages", url)
        check("anthropic: заголовки ключа и версии",
              headers.get("x-api-key") == "k" and headers.get("anthropic-version") == llm.ANTHROPIC_VERSION,
              str(headers))
        check("anthropic: system отдельно, без temperature",
              payload["system"] == "SYS" and "temperature" not in payload
              and all(m["role"] != "system" for m in payload["messages"]), str(payload))
        check("anthropic: поиск подключён",
              payload.get("tools") == [{"type": llm.ANTHROPIC_SEARCH_TOOL, "name": "web_search",
                                        "max_uses": llm.ANTHROPIC_SEARCH_MAX_USES}], str(payload.get("tools")))
        check("anthropic: без temperature и сэмплинга",
              not {"temperature", "top_p", "top_k"} & set(payload), str(sorted(payload)))
        check("anthropic: запас токенов на рассуждение",
              payload["max_tokens"] == 260 + llm.ANTHROPIC_THINKING_ROOM, str(payload["max_tokens"]))
        check("anthropic: текст только после поиска", answer == "Сейчас +19, малооблачно.", answer)
        check("anthropic: usage со счётчиком поиска",
              usage.get("total_tokens") == 120
              and usage.get("server_tool_use", {}).get("web_search_requests") == 1, str(usage))
        check("anthropic: источники — сначала цитата, потом выдача, без повторов",
              [item["url"] for item in sources] == ["https://weather.example/b", "https://weather.example/a"]
              and sources[0]["snippet"] == "+19, малооблачно", str(sources))

        replies.append({"stop_reason": "end_turn", "usage": {}, "content": [{"type": "text", "text": "391"}]})
        answer, _, sources = llm.anthropic_messages("https://x/v1", "k", "m", "S", dialog, 260, False)
        check("anthropic: без поиска нет tools", "tools" not in sent[-1][1] and answer == "391"
              and sources == [], str(sent[-1][1]))

        replies.append({"stop_reason": "end_turn", "usage": {}, "content": [
            {"type": "server_tool_use", "name": "web_search", "input": {}},
            {"type": "web_search_tool_result",
             "content": {"type": "web_search_tool_result_error", "error_code": "max_uses_exceeded"}},
            {"type": "text", "text": "Не нашёл."}]})
        answer, _, sources = llm.anthropic_messages("https://x/v1", "k", "m", "S", dialog, 260, True)
        check("anthropic: ошибка поиска не роняет ответ", answer == "Не нашёл." and sources == [],
              str(sources))

        replies.extend([
            {"stop_reason": "pause_turn", "usage": {"input_tokens": 5},
             "content": [{"type": "server_tool_use", "name": "web_search", "input": {}}]},
            {"stop_reason": "end_turn", "usage": {"input_tokens": 7},
             "content": [{"type": "web_search_tool_result", "content": []},
                         {"type": "text", "text": "Готово."}]},
        ])
        answer, usage, _ = llm.anthropic_messages("https://x/v1", "k", "m", "S", dialog, 260, True)
        resumed = sent[-1][1]["messages"]
        check("anthropic: pause_turn продолжает с ответом ассистента",
              resumed[-1]["role"] == "assistant" and resumed[-1]["content"][0]["type"] == "server_tool_use"
              and answer == "Готово." and usage.get("input_tokens") == 12, str(resumed[-1]))

        replies.extend([
            {"stop_reason": "pause_turn", "usage": {},
             "content": [{"type": "server_tool_use", "name": "web_search", "input": {}}]},
            {"stop_reason": "pause_turn", "usage": {},
             "content": [{"type": "server_tool_use", "name": "web_search", "input": {}}]},
            {"stop_reason": "pause_turn", "usage": {},
             "content": [{"type": "server_tool_use", "name": "web_search", "input": {}}]},
        ])
        try:
            llm.anthropic_messages("https://x/v1", "k", "m", "S", dialog, 260, True)
            paused = None
        except llm.ApiError as exc:
            paused = str(exc)
        check("anthropic: три pause_turn -> понятная ошибка",
              paused and "не закончила" in paused, str(paused))

        calls = []

        def fake_fallback(url, payload, headers, timeout=90):
            calls.append((payload.get("tools") or [{}])[0].get("type"))
            if len(calls) == 1:
                raise llm.ApiError(502, "API ответил HTTP 400", detail="tools")
            return {"stop_reason": "end_turn", "usage": {},
                    "content": [{"type": "text", "text": "Запасной вариант."}]}

        llm.post_json = fake_fallback
        answer, _, _ = llm.anthropic_messages(
            "https://x/v1", "k", "m", "S", dialog, 260, True)
        check("anthropic: 400 -> запасная версия поиска",
              answer == "Запасной вариант."
              and calls == [llm.ANTHROPIC_SEARCH_TOOL, llm.ANTHROPIC_SEARCH_FALLBACK],
              str(calls))

        llm.post_json = fake_post
        replies.append({"stop_reason": "refusal", "usage": {}, "content": [],
                        "stop_details": {"type": "refusal", "category": "cyber", "explanation": None}})
        try:
            llm.anthropic_messages("https://x/v1", "k", "m", "S", dialog, 260, False)
            refused = False
        except llm.ApiError as exc:
            refused = "отказалась" in exc.message
        check("anthropic: отказ модели -> понятная ошибка", refused)
    finally:
        llm.post_json = old_post

    check("голос: синоним «клод» для провайдера anthropic",
          "клод" in voice_daemon.LLM_ALIASES.get("anthropic", ()))


def test_llm_anthropic_ask():
    """ask() с провайдером anthropic: родной API, поиск автора, контекст."""
    import copy

    sent = []
    old_post = llm.post_json

    def fake_post(url, payload, headers, timeout=90):
        sent.append((url, copy.deepcopy(payload)))
        return {"stop_reason": "end_turn", "usage": {"input_tokens": 9, "output_tokens": 3},
                "content": [
                    {"type": "server_tool_use", "name": "web_search", "input": {}},
                    {"type": "web_search_tool_result", "content": [
                        {"type": "web_search_result", "url": "https://news.example/1",
                         "title": "Новость"}]},
                    {"type": "text", "text": "Готово."}]}

    llm.post_json = fake_post
    try:
        config = _provider_config("anthropic")
        config["timezone"] = "Europe/Moscow"
        config["location"] = "Калининград"
        chat_calls, called = _llm_ask_with(config, prompt="что нового?")
        url, payload = sent[-1] if sent else ("", {})
        result = called[-1][1] if called else {}
        check("llm/anthropic: запрос в Messages API, не в /chat/completions",
              url == "http://127.0.0.1:1/messages" and not chat_calls, url + str(chat_calls)[:80])
        check("llm/anthropic: поиск по галочке автора",
              (payload.get("tools") or [{}])[0].get("type") == llm.ANTHROPIC_SEARCH_TOOL,
              str(payload.get("tools")))
        check("llm/anthropic: в system дата, место и подсказка про поиск",
              "Калининград" in payload.get("system", "") and "Сейчас " in payload.get("system", "")
              and llm.ANTHROPIC_SEARCH_NOTE in payload.get("system", ""), payload.get("system", "")[:200])
        check("llm/anthropic: в messages нет роли system",
              all(m.get("role") in ("user", "assistant") for m in payload.get("messages") or []),
              str(payload.get("messages")))
        check("llm/anthropic: ответ, источники и search_source",
              result.get("answer") == "Готово." and result.get("search_source") == "anthropic"
              and [item["url"] for item in result.get("sources") or []] == ["https://news.example/1"],
              str(result)[:300])
        check("llm/anthropic: usage в ответе", (result.get("usage") or {}).get("total_tokens") == 12,
              str(result.get("usage")))
        check("llm/anthropic: режим поиска — родной",
              llm.search_mode("anthropic", {}) == "anthropic", str(llm.search_mode("anthropic", {})))

        config = _provider_config("anthropic")
        config["web_search"] = False
        config["profiles"][0]["model"] = ""
        _llm_ask_with(config, prompt="привет")
        payload = sent[-1][1] if sent else {}
        result = called[-1][1] if called else {}
        check("llm/anthropic: без галочки нет tools и подсказки",
              "tools" not in payload and llm.ANTHROPIC_SEARCH_NOTE not in payload.get("system", ""),
              str(sorted(payload)))
        check("llm/anthropic: модель по умолчанию — первая из списка",
              payload.get("model") == llm.PROVIDERS["anthropic"]["models"][0], str(payload.get("model")))
    finally:
        llm.post_json = old_post


def test_llm_chat_timestamps():
    items = [
        {"role": "user", "content": "привет", "ts": 123},
        {"role": "assistant", "content": "ответ", "ts": 123},
        {"role": "system", "content": "служебное", "ts": 1},
    ]
    clean = llm.dialog_messages(items)
    check("чат: ts не уходит в API", all("ts" not in item for item in clean), str(clean))
    check("чат: служебная роль отброшена",
          len(clean) == 2 and clean[1]["role"] == "assistant", str(clean))
    check("чат: пустой контент пропущен",
          llm.dialog_messages([{"role": "user", "content": ""}]) == [])


def test_llm_chat_history_ts():
    calls = {}
    old_load, old_respond = llm.load_chats, llm.common.respond
    try:
        llm.load_chats = lambda: {"active": "c1", "chats": [{
            "id": "c1", "name": "Чат", "messages": [
                {"role": "user", "content": "привет", "ts": 123}]}]}
        llm.common.respond = lambda status, payload, headers=None: calls.update(payload)
        llm.chat_history()
        messages = calls.get("messages") or []
        check("чат: история отдаёт время сообщения",
              messages and messages[0].get("ts") == 123, str(calls))
    finally:
        llm.load_chats = old_load
        llm.common.respond = old_respond


def test_voice_chat_commands():
    check("голос: создай чат",
          voice_daemon.parse_chat_command("Алиса, создай чат Работа") == ("create", "Работа"),
          str(voice_daemon.parse_chat_command("Алиса, создай чат Работа")))
    check("голос: новый чат",
          voice_daemon.parse_chat_command("новый чат Дела") == ("create", "Дела"))
    check("голос: создай новый чат",
          voice_daemon.parse_chat_command("создай новый чат Идеи") == ("create", "Идеи"))
    check("голос: переключись на чат",
          voice_daemon.parse_chat_command("переключись на чат Работа") == ("switch", "Работа"))
    check("голос: открой чат без регистра",
          voice_daemon.parse_chat_command("Открой чат дела") == ("switch", "дела"))
    check("голос: имя без слова «пожалуйста»",
          voice_daemon.parse_chat_command("создай чат Отпуск пожалуйста") == ("create", "Отпуск"))
    check("голос: без имени — пустая строка",
          voice_daemon.parse_chat_command("создай чат") == ("create", ""))
    check("голос: переключение без имени",
          voice_daemon.parse_chat_command("переключись на чат") == ("switch", ""))
    check("голос: обычная фраза не команда",
          voice_daemon.parse_chat_command("включи музыку") is None)
    check("голос: включение нейросети не команда",
          voice_daemon.parse_chat_command("включи нейросеть") is None)
    check("голос: вопрос про чат не команда",
          voice_daemon.parse_chat_command("какой чат сейчас") is None)
    check("голос: «включи чат гпт» не перехватываем",
          voice_daemon.parse_chat_command("включи чат гпт") is None)

    items = [{"id": "chat-1", "name": "Чат 1"}, {"id": "chat-2", "name": "Работа"}]
    found = voice_daemon.chat_by_name(items, "РАБОТА")
    check("голос: поиск без учёта регистра", found and found.get("id") == "chat-2", str(found))
    found = voice_daemon.chat_by_name(items, "  работа ")
    check("голос: поиск с пробелами", found and found.get("id") == "chat-2", str(found))
    check("голос: несуществующий чат", voice_daemon.chat_by_name(items, "Отпуск") is None)
    yolo = voice_daemon.chat_by_name([{"id": "c3", "name": "Ёлка"}], "елка")
    check("голос: «ё» и «е» не различаются", yolo and yolo.get("id") == "c3", str(yolo))


def test_voice_chat_actions():
    old_post = voice_daemon.post
    old_announce = voice_daemon.announce
    old_info = voice_daemon.llm_info
    calls = []
    try:
        voice_daemon.post = lambda url, payload, timeout=None: calls.append(payload) or {
            "ok": True, "active_chat_name": "Работа"}
        voice_daemon.announce = lambda text, pause=False: calls.append(text)
        ok = voice_daemon.chat_create("Работа")
        check("голос: создание шлёт chat_new с именем",
              ok and calls[0] == {"chat_new": 1, "chat_name": "Работа"}, str(calls[0]))
        check("голос: подтверждение создания", calls[1] == "Создан чат Работа", str(calls[1]))

        calls[:] = []
        voice_daemon.llm_info = lambda: {"chats": [{"id": "chat-2", "name": "Работа"},
                                                   {"id": "chat-1", "name": "Чат 1"}]}
        ok = voice_daemon.chat_select_by_name("работа")
        check("голос: переключение шлёт chat_select",
              ok and calls[0] == {"chat_select": "chat-2"}, str(calls[0]))
        check("голос: подтверждение переключения",
              calls[1] == "Переключился на чат Работа", str(calls[1]))

        calls[:] = []
        ok = voice_daemon.chat_select_by_name("Отпуск")
        check("голос: ошибка при неизвестном чате",
              ok and str(calls[0]).startswith("Чат Отпуск не найден"), str(calls[0]))
        check("голос: ошибка перечисляет доступные чаты",
              "Есть: Работа, Чат 1" in str(calls[0]), str(calls[0]))
    finally:
        voice_daemon.post = old_post
        voice_daemon.announce = old_announce
        voice_daemon.llm_info = old_info


def test_files_safety():
    root = tempfile.mkdtemp(prefix="mypult-files-", dir="/tmp")
    try:
        path = os.path.join(root, "note.txt")
        files._write(path, "привет")
        check("файлы: запись в /tmp", open(path, encoding="utf-8").read() == "привет")
        check("файлы: чтение в /tmp", files._read(path).get("text") == "привет")
        check("файлы: список видит файл", any(x["name"] == "note.txt" for x in files._list(root)["items"]))
        check("файлы: запись в /etc запрещена", not files._can_write("/etc/passwd"))
        try:
            files._resolve("/tmp/../etc/passwd", write=True)
            blocked = False
        except files.FileError:
            blocked = True
        check("файлы: обход пути запрещён", blocked)
        try:
            files._new_name("../x")
            bad_name = False
        except files.FileError:
            bad_name = True
        check("файлы: имя с .. запрещено", bad_name)
    finally:
        shutil.rmtree(root, ignore_errors=True)


def test_security_fixes():
    """Аудит 0.5.65: чтение файлов, удаление корней, PIN и POST-гард DNS."""
    check("файлы: /etc вне чтения", files._can_read("/etc/passwd") is False)
    check("файлы: /data/mypult читается", files._can_read("/data/mypult/ring.json") is True)
    check("файлы: auth.json не читается", files._can_read("/data/mypult/auth.json") is False)

    old_forbidden = files.FORBIDDEN_DELETE
    files.FORBIDDEN_DELETE = tuple(old_forbidden) + (os.path.realpath("/data/mypult"),)
    try:
        for root in ("/data", "/data/mypult"):
            try:
                files._delete(root)
                blocked = False
            except files.FileError:
                blocked = True
            check("файлы: удаление %s запрещено" % root, blocked)
    finally:
        files.FORBIDDEN_DELETE = old_forbidden

    salt = "abc"
    pin = "1234"
    pbkdf2 = {"algo": "pbkdf2_sha256", "salt": salt, "iterations": 10000,
              "pin_hash": auth.pin_hash(pin, salt, 10000)}
    check("auth: PBKDF2 проверяется", auth.verify_pin(pin, pbkdf2) is True)
    check("auth: неверный PIN отклонён", auth.verify_pin("0000", pbkdf2) is False)
    check("auth: старый SHA-256 ещё работает",
          auth.verify_pin(pin, {"salt": salt, "pin_hash": auth.legacy_hash(pin, salt)}) is True)
    check("auth: токен случайный и длинный",
          auth.new_token() != auth.new_token() and len(auth.new_token()) == 64)

    check("сеть: dns требует POST", "dns" in common.WRITE_ACTIONS)
    check("сеть: dns_reset требует POST", "dns_reset" in common.WRITE_ACTIONS)


def test_voice_idle_and_toggle():
    import voicectl
    import voicecfg

    check("голос: Миди по умолчанию не держит микрофон",
          voicecfg.default_idle("yandexmidi") == "auto")
    check("голос: Station 2 не слушает вхолостую",
          voicecfg.default_idle("yandexstation_2") == "auto")
    check("голос: неизвестная модель — тоже auto", voicecfg.default_idle("") == "auto")
    check("голос: режим микрофона по умолчанию непрерывный",
          voicecfg.default_mic_mode() == "continuous")
    check("голос: на Миди по умолчанию фразы Алисы",
          voicecfg.default_mic_mode("yandexmidi") == "alice")
    check("голос: на Station 2 пока непрерывно",
          voicecfg.default_mic_mode("yandexstation_2") == "continuous")
    check("голос: экономный режим уважается",
          voicecfg.resolve_mic_mode({"mic_mode": "econom"}) == "econom")
    check("голос: мусорный режим микрофона — непрерывный",
          voicecfg.resolve_mic_mode({"mic_mode": "wat"}) == "continuous")
    check("голос: явный режим важнее модели",
          voicecfg.resolve_idle({"idle": "always"}, "yandexstation_2") == "always")
    check("голос: по умолчанию включён", voicecfg.is_enabled({}) is True)
    check("голос: выключение уважается", voicecfg.is_enabled({"enabled": False}) is False)
    check("голос: музыка голосом по умолчанию выключена",
          voicecfg.music_voice_enabled({}) is False)
    check("голос: сервис по умолчанию пуст",
          voicecfg.resolve_music_default({}) == "")
    check("голос: spotify не принимается как сервис по умолчанию",
          voicecfg.resolve_music_default({"music_default": "spotify"}) == "")

    started = []
    old_load = voicecfg.load
    old_start = voicectl.start
    try:
        voicectl.start = lambda: started.append(True)
        voicecfg.load = lambda: {"enabled": False}
        check("голос: watchdog не поднимает выключенный пульт",
              voicectl.ensure() is False and not started)
        voicecfg.load = lambda: {"enabled": True}
        check("голос: watchdog поднимает включённый пульт",
              voicectl.ensure() is True and started == [True])
    finally:
        voicecfg.load = old_load
        voicectl.start = old_start


    old_pid = voicectl.read_pid
    old_match = voicectl.pid_matches
    old_load = voicecfg.load
    old_model = voicecfg.device_model
    try:
        voicectl.read_pid = lambda: None
        voicectl.pid_matches = lambda pid: False
        voicecfg.load = lambda: {"mic_mode": "alice"}
        voicecfg.device_model = lambda: "yandexmidi"
        st = voicectl.status()
        check("голос: статус отдаёт режим микрофона",
              st.get("mic_mode") == "alice", str(st))
    finally:
        voicectl.read_pid = old_pid
        voicectl.pid_matches = old_match
        voicecfg.load = old_load
        voicecfg.device_model = old_model


def test_device_classify():
    import device

    check("модель: Cucumber — это Миди",
          device.classify("yandexmidi", "Yandex Cucumber DVT2", []) == "midi")
    check("модель: Station 2 по Luna",
          device.classify("yandexstation_2", "Yandex Station Midi", []) == "station2")
    check("модель: Station 2 по device-tree (ловушка «Midi»)",
          device.classify("", "Yandex Station Midi", []) == "station2")
    check("модель: Миди по фиче сегментов",
          device.classify("", "", ["display.clock.segment.v1"]) == "midi")
    check("модель: неизвестная станция",
          device.classify("", "", []) == "unknown")


def test_glagol_device_override():
    import json
    import tempfile

    old = glagol.OVERRIDE_PATH
    handle, path = tempfile.mkstemp(prefix="mypult-glagol-dev-", suffix=".json")
    os.close(handle)
    try:
        glagol.OVERRIDE_PATH = path
        check("glagol: без override — None", glagol._override() is None)

        with open(path, "w", encoding="utf-8") as fh:
            json.dump({"device_id": "R103JQ000BMYYK", "platform": "yandexmidi"}, fh)
        check("glagol: override читается",
              glagol._override() == ("R103JQ000BMYYK", "yandexmidi"))

        with open(path, "w", encoding="utf-8") as fh:
            json.dump({"device_id": "X"}, fh)
        check("glagol: platform по умолчанию",
              glagol._override() == ("X", "yandexmidi"))

        with open(path, "w", encoding="utf-8") as fh:
            json.dump({"device_id": ""}, fh)
        check("glagol: пустой override игнорируется", glagol._override() is None)
    finally:
        glagol.OVERRIDE_PATH = old
        try:
            os.remove(path)
        except OSError:
            pass


def test_ring_fb_geometry():
    import ring_state

    check("кольцо: virtual_size 89,1", ring_state.parse_virtual_size("89,1") == (89, 1))
    check("кольцо: пробелы в размере", ring_state.parse_virtual_size(" 89, 1 ") == (89, 1))
    check("кольцо: кривой размер", ring_state.parse_virtual_size("foo") is None)
    check("кольцо: пустой размер", ring_state.parse_virtual_size("") is None)
    check("кольцо: нулевая ширина", ring_state.parse_virtual_size("0,1") is None)


def test_glagol_device_from_logs():
    import tempfile

    old_logs = glagol.LOG_FILES
    old_devices = glagol.DEVICES
    old_override = glagol.OVERRIDE_PATH
    folder = tempfile.mkdtemp(prefix="mypult-logs-")
    yiod = os.path.join(folder, "yiod.log")
    try:
        with open(yiod, "wb") as fh:
            fh.write(b"Backend request: https://quasar.yandex.net/register?"
                     b"device_id=U00QNP100Y59RK&name=quasar&platform=yandexmidi\n")
        glagol.LOG_FILES = (yiod,)
        check("glagol: device_id из логов демона",
              glagol._device_from_logs() == ("U00QNP100Y59RK", "yandexmidi"))

        glagol.DEVICES = os.path.join(folder, "missing.json")
        glagol.OVERRIDE_PATH = os.path.join(folder, "missing-override.json")
        check("glagol: без devices.json id берётся из логов",
              glagol._device() == ("U00QNP100Y59RK", "yandexmidi"))

        with open(yiod, "wb") as fh:
            fh.write(b'{"device_id":"U00QNP100Y59RK","device_model":"yandexmidi"}')
        check("glagol: device_id из JSON-строки лога",
              glagol._device_from_logs()[0] == "U00QNP100Y59RK")

        with open(yiod, "wb") as fh:
            fh.write(b"nothing here\n")
        check("glagol: без id в логах — None", glagol._device_from_logs() is None)
    finally:
        glagol.LOG_FILES = old_logs
        glagol.DEVICES = old_devices
        glagol.OVERRIDE_PATH = old_override
        try:
            os.remove(yiod)
        except OSError:
            pass


def test_panel_backlight():
    import panel

    check("панель: яркость в пределах", panel.clamp(300, 255) == 255)
    check("панель: отрицательная — 0", panel.clamp(-5, 255) == 0)
    check("панель: не число — None", panel.clamp("ярко", 255) is None)
    check("панель: строка с числом", panel.clamp("83", 255) == 83)


def test_glagol_probe_source():
    import contextlib
    import io
    import json
    import tempfile

    old = (glagol.LOG_FILES, glagol.DEVICES, glagol.OVERRIDE_PATH, glagol._resolve)
    folder = tempfile.mkdtemp(prefix="mypult-probe-")
    yiod = os.path.join(folder, "yiod.log")
    try:
        with open(yiod, "wb") as fh:
            fh.write(b"https://quasar.yandex.net/register?device_id=U00QNP100Y59RK"
                     b"&platform=yandexmidi\n")
        glagol.LOG_FILES = (yiod,)
        glagol.DEVICES = os.path.join(folder, "missing.json")
        glagol.OVERRIDE_PATH = os.path.join(folder, "missing-override.json")
        glagol._resolve = lambda host: ["1.2.3.4"]
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            glagol.probe([])
        report = json.loads(out.getvalue())
        check("probe: id берётся из логов",
              report.get("device_id_source") == "daemons_logs"
              and report.get("checked_device_id") == "U00QNP100Y59RK",
              str(report.get("device_id_source")))
    finally:
        (glagol.LOG_FILES, glagol.DEVICES,
         glagol.OVERRIDE_PATH, glagol._resolve) = old


def test_network_dns_servers():
    def raises(fn):
        try:
            fn()
        except Exception:  # noqa: BLE001
            return True
        return False

    check("network: link-local IPv6 отклоняется",
          raises(lambda: network.clean_servers(["fe80::1"])))
    check("network: адрес со scope-id отклоняется",
          raises(lambda: network.clean_servers(["fe80::1%wlan0"])))
    check("network: пустой список отклоняется",
          raises(lambda: network.clean_servers([])))
    check("network: IPv4 принимается, дубли убираются",
          network.clean_servers(["77.88.8.8", " 77.88.8.8 ", "1.1.1.1"])
          == ["77.88.8.8", "1.1.1.1"])
    check("network: имя вместо IP отклоняется",
          raises(lambda: network.clean_servers(["dns.google"])))


def test_update_local_archive():
    def raises(fn):
        try:
            fn()
        except Exception:  # noqa: BLE001
            return True
        return False

    old_roots = update.LOCAL_ROOTS
    update.LOCAL_ROOTS = (tempfile.gettempdir(), "/tmp", "/data")
    handle, path = tempfile.mkstemp(suffix=".tar.gz")
    os.close(handle)
    try:
        with open(path, "wb") as fh:
            fh.write(b"x" * 2048)
        check("update: локальный архив принимается", bool(update.local_archive(path)))
    finally:
        update.LOCAL_ROOTS = old_roots
        try:
            os.remove(path)
        except OSError:
            pass
    check("update: путь вне /tmp и /data отклоняется",
          raises(lambda: update.local_archive("/etc/passwd")))
    check("update: несуществующий файл отклоняется",
          raises(lambda: update.local_archive("/tmp/midipult-nope.tar.gz")))


def test_update_dns_hint():
    hint = update.explain_net_error(
        OSError("[Errno -3] Temporary failure in name resolution"))
    check("update: ошибка DNS объясняется по-человечески", "DNS" in hint, hint)
    other = update.explain_net_error(OSError("timed out"))
    check("update: прочие ошибки остаются прежними", "GitHub" in other, other)


def test_files_security_guard():
    check("файлы: chats.json — секрет",
          files._sensitive("/data/mypult/chats.json"))
    check("файлы: secrets.json — секрет",
          files._sensitive("/data/mypult/secrets.json"))
    check("файлы: *_auth.json — секрет",
          files._sensitive("/data/mypult/some_auth.json"))
    check("файлы: voice_daemon.py — защищён",
          files._protected("/data/mypult/voice_daemon.py"))
    check("файлы: alarmd.py — защищён",
          files._protected("/data/mypult/alarmd.py"))
    check("файлы: bin/yt-dlp — защищён",
          files._protected("/data/mypult/bin/yt-dlp"))
    check("файлы: sounds/*.wav — можно",
          not files._protected("/data/mypult/sounds/test.wav"))
    check("файлы: panel.json — можно",
          not files._protected("/data/mypult/panel.json"))
    check("файлы: запись в voice_daemon.py запрещена",
          not files._can_write("/data/mypult/voice_daemon.py"))
    check("файлы: запись в sounds разрешена",
          files._can_write("/data/mypult/sounds/test.wav"))


def test_dns_probe_and_skip():
    query = dnsprobe.build_query("ya.ru", 0x1234)
    check("dnsprobe: id запроса на месте", query[:2] == b"\x12\x34")
    check("dnsprobe: qname и тип A", b"ya" in query and query.endswith(b"\x00\x01\x00\x01"))

    old = (network.dns_probe, network.dns_servers)
    network.dns_probe = lambda *args, **kwargs: True
    network.dns_servers = lambda: ["77.88.8.8"]
    try:
        clean, probe = network.set_dns(["77.88.8.8"])
        check("network: DNS жив и серверы те же — рестарта нет",
              probe.get("skipped") is True and clean == ["77.88.8.8"])
    finally:
        network.dns_probe, network.dns_servers = old


def test_display_clock_timezone():
    from datetime import datetime, timezone
    moment = datetime(2026, 1, 1, 20, 0, tzinfo=timezone.utc)
    check("часы: UTC → Екатеринбург +5",
          display.format_clock(moment, "Asia/Yekaterinburg") == "01:00",
          display.format_clock(moment, "Asia/Yekaterinburg"))
    check("часы: UTC остаётся UTC", display.format_clock(moment, "UTC") == "20:00")
    check("часы: неизвестный пояс — без сдвига",
          display.format_clock(moment, "Nowhere/Zone") == "20:00")


def test_layout_presets_sanitize():
    layout = layout_presets.clean_layout({
        "order": ["h-media", "bad id", "h-media", "h-radio"],
        "spans": {"h-media": 7, "h-radio": 99, "x y": 4},
        "rows": {"h-media": 10, "h-radio": 0},
    })
    check("раскладка: порядок без мусора и дублей",
          layout["order"] == ["h-media", "h-radio"])
    check("раскладка: ширина в пределах 1..12",
          layout["spans"] == {"h-media": 7})
    check("раскладка: высота в пределах 1..20",
          layout["rows"] == {"h-media": 10})
    check("раскладка: режим только wide/phone",
          layout_presets.clean_mode("phone") == "phone"
          and layout_presets.clean_mode("hack") == "wide")
    check("раскладка: имя обрезается и чистится",
          layout_presets.clean_name("  Мой   дом  ") == "Мой дом"
          and len(layout_presets.clean_name("x" * 80)) == 40)


def main():
    for test in (
        test_generic_helpers,
        test_files_safety,
        test_security_fixes,
        test_volume_discovery,
        test_volume_parse,
        test_volume_set,
        test_glagol_payloads,
        test_glagol_device_selection,
        test_glagol_token_formats,
        test_llm_temperature_retry,
        test_radio_custom_stations,
        test_websearch_parsing,
        test_llm_native_search,
        test_alice_cli_commands,
        test_voice_follow_up_words,
        test_voice_speech_post,
        test_voice_recognize_event,
        test_voice_repeat_filter,
        test_voice_say_append,
        test_voice_cancel_native,
        test_voice_follow_up_skip,
        test_voice_follow_up_closes_alice,
        test_voice_auto_follow_up,
        test_voice_passive_wants,
        test_voice_llm_cache,
        test_voice_answer_append,
        test_voice_music_intent,
        test_voice_music_play,
        test_voice_music_wave,
        test_voice_native_phrase,
        test_status_probe_cache,
        test_lyrics_parse,
        test_ring_animations_list,
        test_ring_animation_preview,
        test_ring_forward,
        test_ring_reset_and_stop,
        test_media_pause_via_cli,
        test_musicapi,
        test_music_queue,
        test_alarm_rules,
        test_clock_animation,
        test_media_config_override,
        test_speak_frames,
        test_display_auto,
        test_display_clock_timezone,
        test_layout_presets_sanitize,
        test_display_segment_guard,
        test_display_reset,
        test_auth_guard,
        test_url_guard,
        test_update_assets,
        test_state_player_fresh,
        test_vpn_parsing,
        test_discovery_payload,
        test_update_release_filter,
        test_update_beta_channel,
        test_update_check_guard,
        test_update_fetch_release,
        test_llm_chat_names,
        test_llm_chat_timestamps,
        test_llm_chat_history_ts,
        test_llm_chat_history,
        test_llm_context_note,
        test_llm_anthropic_native,
        test_llm_anthropic_ask,
        test_voice_chat_commands,
        test_voice_chat_actions,
        test_voice_idle_and_toggle,
        test_device_classify,
        test_glagol_device_override,
        test_glagol_device_from_logs,
        test_glagol_probe_source,
        test_panel_backlight,
        test_ring_fb_geometry,
        test_network_dns_servers,
        test_update_local_archive,
        test_update_dns_hint,
        test_files_security_guard,
        test_dns_probe_and_skip,
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