#!/opt/bin/python3
# -*- coding: utf-8 -*-
"""Серверный вход в пульт: без PIN отдаёт только страницу входа.

Лежит в корне /data/myweb, назначается index-файлом в lighttpd.
Прямой /index.html запрещён в конфиге, поэтому обойти оверлей нельзя.
"""

from __future__ import annotations

import os
import sys

WEB = "/data/myweb"
sys.path.insert(0, os.path.join(WEB, "cgi-bin"))
import common  # noqa: E402

LOGIN = """<!doctype html>
<html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Пульт — вход</title>
<style>
:root{color-scheme:dark}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#07090f;
 color:#eef2ff;font:15px/1.4 system-ui,sans-serif}
.card{width:min(92vw,340px);padding:26px;border-radius:20px;border:1px solid #2a3146;
 background:linear-gradient(160deg,#1a2030,#0d1019);box-shadow:0 24px 60px #0009;text-align:center}
h1{font-size:19px;margin:0 0 6px}p{color:#8f9bb3;margin:0 0 18px}
input{width:100%;box-sizing:border-box;padding:13px;border-radius:12px;border:1px solid #2a3146;
 background:#0b0e16;color:#eef2ff;font-size:22px;letter-spacing:7px;text-align:center}
button{margin-top:12px;width:100%;padding:12px;border:0;border-radius:12px;cursor:pointer;
 background:linear-gradient(120deg,#7c5cff,#22d3ee);color:#fff;font-weight:600}
#err{min-height:18px;margin-top:10px;color:#fb7185;font-size:13px}
@media (prefers-color-scheme: light){
 :root{color-scheme:light}
 body{background:#f4efe7;color:#20242c}
 .card{background:linear-gradient(160deg,#fffdf9,#f8f1e8);
  border-color:rgba(76,62,48,.16);box-shadow:0 24px 60px rgba(78,58,38,.14)}
 p{color:#6d675e}
 input{background:#fffdfa;color:#20242c;border-color:rgba(76,62,48,.2)}
 #err{color:#be123c}
}
</style></head><body>
<form class="card" id="f">
  <h1>Пульт защищён PIN</h1>
  <p>Введите код, чтобы открыть панель</p>
  <input id="pin" type="password" inputmode="numeric" maxlength="8" autocomplete="current-password" autofocus>
  <button type="submit">Войти</button>
  <div id="err"></div>
</form>
<script>
var f = document.getElementById('f');
f.addEventListener('submit', function (e) {
  e.preventDefault();
  var pin = document.getElementById('pin').value.trim();
  document.getElementById('err').textContent = '';
  fetch('/cgi-bin/auth.py', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({login: 1, pin: pin})
  }).then(function (r) { return r.json().then(function (d) { return {ok: r.ok, d: d}; }); })
    .then(function (res) {
      if (!res.ok || !res.d.ok) throw new Error(res.d.error || 'Неверный PIN');
      location.reload();
    })
    .catch(function (err) { document.getElementById('err').textContent = err.message; });
});
</script></body></html>"""


def main():
    config = common.auth_config()
    if config.get("enabled") and not common.auth_cookie_ok(config):
        body = LOGIN.encode("utf-8")
        sys.stdout.buffer.write(
            ("Status: 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n"
             "Cache-Control: no-store, max-age=0\r\nContent-Length: %d\r\n\r\n"
             % len(body)).encode("latin-1") + body)
        sys.stdout.buffer.flush()
        return

    try:
        with open(os.path.join(WEB, "index.html"), "rb") as fh:
            body = fh.read()
    except OSError:
        common.fail(500, "index.html не найден")
        return

    sys.stdout.buffer.write(
        ("Status: 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n"
         "Cache-Control: no-store, max-age=0\r\nContent-Length: %d\r\n\r\n"
         % len(body)).encode("latin-1") + body)
    sys.stdout.buffer.flush()


if __name__ == "__main__":
    try:
        main()
    except BrokenPipeError:
        pass
    except Exception as exc:  # noqa: BLE001
        try:
            common.fail(500, "Внутренняя ошибка index.py: %s" % exc)
        except Exception:
            pass
