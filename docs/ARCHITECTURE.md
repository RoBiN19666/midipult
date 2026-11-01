# Архитектура MidiPult

Документ описывает, из чего состоит пульт, как компоненты взаимодействуют,
где хранятся данные и что происходит при загрузке колонки.

---

## 1. Общая схема

```
Браузер (LAN)
   │  HTTP :8055
   ▼
lighttpd ── static /data/myweb/index.html
   │
   ├── CGI /cgi-bin/*.py  (Python 3, root)
   │      ├── Luna  http://127.0.0.1:8099
   │      ├── Glagol ws://127.0.0.1:1961
   │      ├── IPC TTS tcp://127.0.0.1:9875  (maind --platformd)
   │      ├── sysfs  (/sys/class/leds, /sys/class/backlight, i2c)
   │      └── /data/mypult/*.json
   │
   └── голосовой демон (отдельный процесс)
          ├── Luna recognize (микрофон)
          ├── сценарии / LLM / VPN / радио
          ├── планировщик расписания
          ├── автояркость
          └── отложенное восстановление громкости
```

Ключевая идея: панель не дублирует демонов Яндекса, а управляет ими через
локальные API и sysfs. Там, где API нет (Zigbee, прямой URL потока), пульт
честно показывает ограничение.

---

## 2. Компоненты

| Компонент | Роль |
|---|---|
| `lighttpd` | отдаёт статику и запускает CGI на `8055` |
| `index.py` | серверный вход: без PIN-куки отдаёт только страницу входа |
| `index.html` | SPA: вкладки, карточки, опрос состояния, drag-and-drop |
| CGI `cgi-bin/*.py` | вся логика: JSON-ответы, вызовы Luna/Glagol/sysfs |
| `voice_daemon.py` | распознавание, интенты, LLM, сценарии, планировщик |
| `state_daemon.py` | постоянный кэш статуса/плеера, системы и звуков на `127.0.0.1:8057` |
| `maind --platformd` | владелец IPC `9875`, TTS и части системных API |
| Luna | LED, дисплей, сенсоры, распознавание, медиа-состояние |
| Glagol | диалог, музыка, радио, громкость, `sendText` |
| `sing-box` | VPN, интерфейс `tun0` |
| `unbound` | DNS, конфиг `/etc/unbound/unbound.conf` |
| `bluealsad` | A2DP-приёмник Bluetooth |

---

## 3. Файлы проекта

```
index.html                 SPA целиком (HTML+CSS+JS)
index.py                   серверный PIN-гейт и отдача index.html
manifest.json, icon.svg    PWA-ярлык (без service worker)
version.json               версия и дата
CHANGELOG.md               история
FAQ.md, README.md          документация
docs/                      архитектура и GitHub
cgi-bin/                   CGI-скрипты
  common.py                общие помощники, PIN-guard, запуск процессов
  auth.py                  PIN: включение, вход, кука
  backup.py                экспорт/импорт настроек
  bluetooth.py             Bluetooth
  command.py               sendText в Glagol
  diag.py                  расширенная диагностика
  display.py               LED часов, кольцо, яркость, автояркость
  glagol.py                WebSocket-клиент Glagol
  llm.py                   профили, чаты, запросы к API
  logs.py                  хвосты логов
  maintenance.py           очистка, reboot, poweroff
  media.py                 play/pause/next/prev/seek/music
  netcheck.py              ping, DNS, HTTP, скорость
  network.py               Wi-Fi, DNS
  player.py                состояние плеера
  radio.py                 29 станций + свои
  scenarios.py             сценарии, расписание, условия, HTTP
  speak.py                 TTS через IPC 9875
  status.py                сводка сервисов
  state.py                 объединённый статус + плеер (CGI-резерв)
  system.py                CPU/RAM/температура/диск/свет
  voicecfg.py              потолок громкости ответов
  voicectl.py              старт/стоп голосового демона
  volume.py                громкость, mute, сохранение уровня
  vpn.py                   sing-box, подписка, серверы
  zigbee.py                статус и список устройств
service/voice_daemon.py    голосовой демон
service/state_daemon.py    постоянный кэш /state
init.d/S99mypult           init-скрипт (start/stop/restart/reload/status)
lighttpd/myweb.conf        конфиг веб-сервера
deploy/                    установка и заливка с Windows
tests/                     статические, юнит- и CGI-тесты
```

---

## 4. CGI-эндпоинты

Все ответы — JSON. Ошибки: `{"ok": false, "error": "..."}`.

| Эндпоинт | Назначение |
|---|---|
| `status.py` | версия, Luna/Glagol/TTS/amixer/websocket |
| `state.py` | объединённый статус + плеер (резерв для `/state`) |
| `display.py` | часы (LED), кольцо, яркость, автояркость, save/restore |
| `volume.py` | уровень, mute/unmute, сохранение в `volume.json` |
| `player.py` | состояние плеера и Glagol |
| `media.py` | play/pause/next/prev/stop/music/seek |
| `radio.py` | список, добавление, удаление, запуск |
| `llm.py` | профили, чаты, промпты, токены |
| `voicecfg.py` | потолок громкости ответов LLM |
| `voicectl.py` | запуск/остановка голосового демона |
| `scenarios.py` | CRUD, запуск, `tick` расписания |
| `sounds.py` | список, скачивание, бэкап и замена системных звуков |
| `speak.py` | озвучка текста (IPC 9875) |
| `command.py` | `sendText` в Glagol, в т.ч. «стоп» |
| `vpn.py` | подписка, серверы, старт/стоп, статус |
| `network.py` | Wi-Fi, скан, подключение, DNS |
| `bluetooth.py` | питание, скан, сопряжение |
| `zigbee.py` | статус и устройства |
| `system.py` | ресурсы и датчики |
| `logs.py` | хвосты логов |
| `netcheck.py` | сеть и скорость |
| `maintenance.py` | очистка, reboot, poweroff |
| `backup.py` | экспорт/импорт конфигов |
| `auth.py` | PIN: статус, включение, вход, выключение |
| `diag.py` | диагностика |

Плюс два серверных маршрута вне `cgi-bin`:

- `index.py` (`/`) — проверяет PIN-куку и отдаёт либо страницу входа, либо
  `index.html`; прямой `/index.html` запрещён (403);
- `/state` — проксируется на `state_daemon.py` (`127.0.0.1:8057`), отдаёт
  кэш статуса, плеера, системы и звуков за ~5 мс; при сбое панель использует
  CGI-резерв.

CGI запускаются от root: иначе недоступны sysfs, `amixer`, `wpa_cli`.

---

## 5. Потоки данных

### Дисплей и часы

1. Панель отправляет `{time, brightness}` в Luna `/api/clock`.
2. Luna рисует 45 LED-сегментов.
3. После синхронизации панель вызывает `display.py {save:1}` — сохраняет
   текущий рисунок, чтобы восстановление не вернуло старое время.
4. «Погасить экран» сохраняет рисунок и пишет нули во все LED.

### Кольцо и яркость

1. Цвета уходят в Luna `/api/led/ring` (24 диода).
2. Яркость — это ток LED-контроллеров `1-0034/1-0035` (`current`), а не
   `fb0`: запись в `fb0` даёт краткую вспышку.
3. Значение сохраняется в `ring.json`; boot-скрипт и `display.py restore`
   возвращают его после загрузки.
4. Автояркость читает `lux` из `/api/sensors` и пересчитывает ток.

### LLM и чаты

1. Панель или демон вызывает `llm.py {prompt, system}`.
2. `llm.py` берёт активный профиль и активный чат, добавляет последние
   10 сообщений, отправляет в OpenAI-совместимый API.
3. Для DeepSeek: `max_tokens: 260`, `thinking: disabled`.
4. Ответ и вопрос дописываются в чат (до 20 сообщений), сохраняются в
   `chats.json`.
5. В ответе возвращаются `usage` (токены), имя чата и профиля.

### Голос

1. Демон вызывает Luna recognize и получает текст.
2. Одинаковые фразы в течение 30 секунд игнорируются.
3. Порядок разбора: сценарий → переключение LLM/чата → встроенные интенты →
   LLM.
4. Перед собственным ответом демон отправляет Glagol `sendText «стоп»` —
   это отменяет TTS Алисы (`cancelDirective`), а не глушит звук.
5. Своё подтверждение читается через `speak.py`; для профилей дополнительно
   ставится пауза музыки.

### Сценарии и расписание

1. Сценарий — JSON: имя, фразы, действия, `schedule`, `conditions`.
2. Планировщик в демоне каждые 30 секунд вызывает `scenarios.py {tick:1}`.
3. `tick` сравнивает локальное время (UTC + `tz_offset` браузера), дни и
   условия; один сценарий выполняется не чаще раза в минуту.
4. Действия выполняются по порядку; HTTP-действие — GET с таймаутом 10 с.

### Громкость

1. `volume.py` управляет `Master` через amixer; при mute запоминает уровень.
2. Уровень сохраняется в `volume.json`.
3. После загрузки maind выставляет свои ~40%; демон через 20 секунд
   возвращает сохранённое значение.

---

## 6. Хранение данных

| Файл | Содержимое |
|---|---|
| `/data/mypult/llm.json` | профили, ключи, активный, enabled |
| `chats.json` | чаты и история сообщений |
| `scenarios.json` | сценарии, расписание, условия |
| `radio.json` | свои станции |
| `vpn.json` | подписка, серверы, автозапуск |
| `dns.json` | пользовательский DNS |
| `ring.json` | яркость кольца |
| `auto_brightness.json` | автояркость |
| `voice.json` | потолок громкости ответов |
| `volume.json` | сохранённая громкость |
| `tz.json` | смещение часового пояса |
| `auth.json` | PIN-хэш, соль, токен, enabled |
| `glagol.json` | токен Glagol |
| `/tmp/mypult-clock.json` | сохранённый рисунок часов |
| `/tmp/mypult-mute.json` | уровень до mute |
| `/tmp/mypult.log` | лог init/CGI |
| `/data/mypult/voice.log` | лог голосового демона |

Все файлы в `/data/mypult` — `600`. Бэкап включает секреты.

---

## 7. Загрузка колонки

Голосовой тракт: демон получает текст через Luna `recognize` только после
финального распознавания, а штатный диалог Алисы стартует раньше. Поэтому
отмена TTS всегда с гонкой; ограничения и обходы —
[VOICE-LIMITS.md](VOICE-LIMITS.md).

```
/etc/init.d/rcS
  └── /etc/init.d/S99mypult        (шим на ro-rootfs)
        └── /opt/etc/init.d/S99mypult start
              ├── start_ipc         (socat/порт 9875 при необходимости)
              ├── start_luna        (8099)
              ├── start_web         (lighttpd 8055)
              ├── restore_volume    (volume.json)
              ├── start_voice       (voice_daemon.py + voice.pid)
              ├── start_state       (state_daemon.py на 8057)
              ├── start_ring_backlight (ring.json → ток)
              ├── start_dns_auto
              └── start_vpn_auto    (если autostart)
```

`start_voice` вызывает `voicectl.py {start:1}` и проверяет `voice.pid`.
Голосовой демон поднимает потоки: расписание, автояркость, отложенную
громкость и автоочистку диска. `start_state` запускает постоянный кэш
`/state`; если он не поднялся, панель использует CGI-резерв.

`reload` **полностью** перезапускает web, голос и state: SIGHUP в этой сборке
не перечитывает конфиг lighttpd. `restart` перезапускает весь стек, `stop`
останавливает только то, что запустил сам.

---

## 8. Деплой

`deploy/install.sh`:
1. запускает `deploy/preflight.sh`: root, Entware, `opkg`, пакеты
   (`python3`, `lighttpd`, `mod_cgi`, `mod_proxy`, `curl`,
   `python3-websocket-client`), Luna, IPC, место; недостающие пакеты ставит;
2. копирует `index.html`, `index.py`, `manifest.json`, `icon.svg`, CGI, конфиг,
   init и демоны;
3. проверяет `lighttpd -t`;
4. делает бэкап конфигов в `/data/mypult/backup`;
5. вызывает `reload`: web + voice + state (панель пропадает на 2–3 секунды,
   зато конфиг применяется);
6. проверяет, что панель и CGI отвечают.

`deploy/push-to-station.ps1` находит колонку, считает хэш, поднимает патч-версию,
шлёт tar по SSH и запускает install. Флаги: `-Station`, `-NoBump`, `-NoInstall`,
`-NoScan`, `-Message`.

`deploy/uninstall.sh` останавливает только процессы пульта, делает бэкап в
`/data/mypult-uninstall-<дата>`, удаляет `/data/myweb`, init-скрипты и
`myweb.conf`. `alice_light` не запускается и не восстанавливается.
Luna/YAM/Entware не затрагиваются; `--purge` дополнительно удаляет
`/data/mypult`, `--dry-run` только показывает план.

---

## 9. Тесты

- `tests/static_checks.py` — 49 проверок: структура HTML, дубликаты id,
  версия/CHANGELOG, кодировка и переводы строк;
- `tests/test_units.py` — 43 проверки чистой логики;
- `tests/run_cgi_tests.py` — 36 проверок CGI на стенде.

Запуск:

```sh
/opt/bin/python3 tests/static_checks.py
/opt/bin/python3 tests/test_units.py
/opt/bin/python3 tests/run_cgi_tests.py
```

---

## 10. Безопасность

- PIN опционален (по умолчанию выключен) и проверяется **на сервере**:
  - `/` обслуживает `index.py`: без куки — страница входа, с кукой — SPA;
  - `/index.html` запрещён в lighttpd (403);
  - `common.require_auth()` вызывается из `params()` и `respond()`, поэтому
    любой CGI без куки с LAN получает 401;
  - `/state` проверяет куку в state-демоне.
- Localhost (сам пульт и демоны) проходит без PIN.
- Кука `mypult_token` — HttpOnly, SameSite=Lax, 30 дней; смена PIN
  инвалидирует старые сессии; «Заблокировать» сбрасывает текущую.
- HTTPS не используется: самоподписанный сертификат даёт предупреждение,
  Let's Encrypt требует публичный домен.
- Секреты — `600`, JSON пишется атомарно; бэкап содержит ключи, хранить отдельно.
- CGI от root — необходимо для sysfs/amixer/wpa_cli.
- Порт 8055 нельзя публиковать в интернет.

---

## 11. Ограничения

- **Zigbee**: локального API управления нет; только статус и список.
- **Spotify**: glibc 2.27 в Entware не совместим с готовыми клиентами.
- **Прямые URL потоков** и **лайки**: Glagol `UNSUPPORTED`.
- **ASR без wake-word** не реализован.
- **Остановка Алисы** — через `sendText «стоп»`; при позднем старте TTS
  возможны первые слоги.
- **Статический IP** и HTTPS не реализованы.
- **Самообновление с GitHub** не включено.
- **FastCGI** в сборке отсутствует (`mod_fastcgi`/`flup`); горячий `/state`
  обслуживает отдельный локальный демон.

---

## 12. Оптимизации

- `/state` — один запрос вместо `status.py` + `player.py`; постоянный демон
  отдаёт кэш за ~5 мс, CGI-резерв остаётся.
- Атомарная запись JSON (`tmp` → `fsync` → `rename`) для LLM, чатов,
  сценариев, PIN, громкости, кольца, радио, VPN, DNS и бэкапа.
- Кольцо: «дыхание» на 10 fps, кадры не отправляются при скрытой вкладке.
- Автоочистка логов и `__pycache__` при занятости диска >85%.
