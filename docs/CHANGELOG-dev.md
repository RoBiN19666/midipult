# Изменения

Формат — [SemVer](https://semver.org/lang/ru/): `MAJOR.MINOR.PATCH`.
Источник истины — [version.json](version.json); в `index.html`, `status.py`,
`install.sh` и `S99mypult` версия читается оттуда. Пока проект в статусе
pre-release, идём по `0.0.x`: каждый залив на колонку поднимает патч.

## 0.0.123 — 2026-10-31

- rename: MidiPult

## 0.0.122 — 2026-10-31

- fix: mute native during command handling

## 0.0.121 — 2026-10-31

- feat: preflight installs missing packages

## 0.0.120 — 2026-10-31

- feat: automatic dependency preflight

## 0.0.119 — 2026-10-31

- feat: autostart shim installer

## Что в проекте сейчас

- SPA на чистом HTML/CSS/JS: дисплей, кольцо, плеер, радио, сеть, система, сценарии.
- Голосовой демон: VPN, LLM-профили, чаты, радио, отмена речи штатной Алисы.
- Нейросеть: несколько профилей, история чатов, выбор длины ответа, озвучка кусками.
- Сценарии: расписание, условия, шаблоны, HTTP-действия.
- Система: логи, сеть, скорость, бэкап, очистка, reboot/poweroff.
- PIN проверяется сервером: без куки отдаётся только страница входа.
- Постоянный `/state`-демон, атомарная запись JSON, автоочистка диска.
- Автозапуск всего стека переживает перезагрузку (проверено реальным ребутом).

Каждый пункт ниже соответствует заливке на колонку; проект в статусе
pre-release, поэтому версии идут по `0.0.x`.


## 0.0.118 — 2026-10-31

- Исправлено: reload applies config and restarts state

## 0.0.117 — 2026-10-31

- Ускорено: persistent state service

## 0.0.116 — 2026-10-31

- Ускорено: atomic json for remaining configs

## 0.0.115 — 2026-10-31

- Ускорено: state endpoint, atomic json, cleanup, fps

## 0.0.114 — 2026-10-31

- Исправлено: pin login token after logout_all

## 0.0.113 — 2026-10-31

- Исправлено: auth guard in respond, deny index.html

## 0.0.112 — 2026-10-31

- Исправлено: server-side pin gate

## 0.0.111 — 2026-10-31

- Исправлено: pin prompts after enabling

## 0.0.110 — 2026-10-31

- Добавлено: breathing ring effect

## 0.0.109 — 2026-10-31

- Добавлено: ring speed and blink

## 0.0.108 — 2026-10-31

- Добавлено: ring animation speed

## 0.0.107 — 2026-10-31

- Исправлено: clock text charset and limit

## 0.0.106 — 2026-10-31

- Добавлено: chunked tts for long answers

## 0.0.105 — 2026-10-31

- Добавлено: configurable llm answer length

## 0.0.104 — 2026-10-31

- Исправлено: sync no longer lights all segments

## 0.0.103 — 2026-10-31

- Добавлено: cancel native for all spoken commands

## 0.0.102 — 2026-10-31

- Исправлено: repeated stop and music pause

## 0.0.101 — 2026-10-31

- Добавлено: cancel alice tts via stop

## 0.0.100 — 2026-10-31

- Настроено: longer silence for native alice

## 0.0.99 — 2026-10-31

- Исправлено: mute window and profile switch music

## 0.0.98 — 2026-10-31

- Добавлено: clean poweroff button

## 0.0.97 — 2026-10-31

- Исправлено: late volume restore after boot

## 0.0.96 — 2026-10-31

- Исправлено: start voice daemon at boot

## 0.0.95 — 2026-10-31

- Исправлено: bind pin elements, volume cap ui

## 0.0.94 — 2026-10-31

- Исправлено: save clock pattern after sync

## 0.0.93 — 2026-10-31

- Исправлено: graceful lighttpd reload

## 0.0.92 — 2026-10-31

- Исправлено: skip light phrases in llm

## 0.0.91 — 2026-10-31

- Исправлено: mute state keeps level

## 0.0.90 — 2026-10-31

- Исправлено: earlier mute, profile activation phrases

## 0.0.89 — 2026-10-31

- Исправлено: duplicate llm answers, chat delete

## 0.0.88 — 2026-10-31

- Добавлено: day presets for scenarios

## 0.0.87 — 2026-10-31

- Добавлено: light theme polish, card drag, pin

## 0.0.86 — 2026-10-31

- Добавлено: optional pin protection

## 0.0.85 — 2026-10-31

- Исправлено: hide seekbar for radio

## 0.0.84 — 2026-10-31

- Добавлено: light theme toggle

## 0.0.83 — 2026-10-31

- Исправлено: speed test url

## 0.0.82 — 2026-10-31

- Добавлено: speed check

## 0.0.81 — 2026-10-31

- Добавлено: config backup and restore

## 0.0.80 — 2026-10-31

- Добавлено: auto brightness by light sensor

## 0.0.79 — 2026-10-31

- Добавлено: quiet voice volume cap

## 0.0.78 — 2026-10-31

- Исправлено: scenario timezone

## 0.0.77 — 2026-10-31

- Исправлено: copy pwa files

## 0.0.76 — 2026-10-31

- Добавлено: schedule, ping, maintenance, pwa

## 0.0.75 — 2026-10-31

- Исправлено: logs id collision

## 0.0.74 — 2026-10-31

- Добавлено: seek, logs, http scenarios, tokens

## 0.0.73 — 2026-10-31

- Исправлено: leave audible volume for answers

## 0.0.72 — 2026-10-31

- Исправлено: audible llm answers, min mute 3s

## 0.0.71 — 2026-10-31

- Ускорено: fast deepseek, mute during generation

## 0.0.70 — 2026-10-31

- Добавлено: llm chats and voice switching

## 0.0.69 — 2026-10-31

- Откат: hush experiment, document tts issue

## 0.0.68 — 2026-10-31

- Добавлено: hush native answer instead of mute

## 0.0.67 — 2026-10-31

- Добавлено: speak append flag for interrupt

## 0.0.66 — 2026-10-31

- Добавлено: mute alice quick answer in llm mode

## 0.0.65 — 2026-10-31

- Исправлено: llm name persona

## 0.0.64 — 2026-10-31

- Исправлено: llm assistant persona prompt

## 0.0.63 — 2026-10-31

- Исправлено: brightness apply current

## 0.0.62 — 2026-10-31

- Исправлено: ring brightness via current, llm prefix

## 0.0.61 — 2026-10-30

- Исправлено: brightness response

## 0.0.60 — 2026-10-30

- Исправлено: brightness response and version

## 0.0.59 — 2026-10-30

- Исправлено: duplicate ring_current

## 0.0.58 — 2026-10-30

- Исправлено: cap ring current on brightness

## 0.0.57 — 2026-10-30

- Добавлено: ring brightness slider

## 0.0.56 — 2026-10-30

- Исправлено: no-store cache header

## 0.0.55 — 2026-10-30

- Исправлено: mobile css outside desktop media

## 0.0.54 — 2026-10-30

- Интерфейс: mobile tabs

## 0.0.53 — 2026-10-30

- Исправлено: mobile clock overflow

## 0.0.52 — 2026-10-30

- Исправлено: ring current, mobile layout

## 0.0.51 — 2026-10-30

- Исправлено: wait alice, faq llm

## 0.0.50 — 2026-10-30

- Исправлено: ring backlight and llm forwarding

## 0.0.49 — 2026-10-30

- Интерфейс: provider select instead of chips

## 0.0.48 — 2026-10-30

- Интерфейс: scenario selects

## 0.0.47 — 2026-10-30

- Исправлено: ring picker change and no-store

## 0.0.46 — 2026-10-30

- Добавлено: llm profiles and voice switch

## 0.0.45 — 2026-10-30

- Добавлено: radio list voice command

## 0.0.44 — 2026-10-30

- Интерфейс: scenario editor width, default row

## 0.0.43 — 2026-10-30

- Добавлено: scenarios engine

## 0.0.42 — 2026-10-30

- Добавлено: more radio, custom stations

## 0.0.41 — 2026-10-30

- Тест: voice run mode

## 0.0.40 — 2026-10-30

- Исправлено: stronger music stop

## 0.0.39 — 2026-10-30

- Исправлено: ring color reset, stop music after voice

## 0.0.38 — 2026-10-30

- Интерфейс: tabs capsule

## 0.0.37 — 2026-10-30

- Добавлено: zigbee status and alice commands

## 0.0.36 — 2026-10-30

- Исправлено: display on restores clock

## 0.0.35 — 2026-10-30

- Исправлено: screen off via clock LED segments

## 0.0.34 — 2026-10-30

- Интерфейс: tab scroll, hotkeys, animation

## 0.0.33 — 2026-10-30

- Добавлено: structured tabs navigation

## 0.0.32 — 2026-10-30

- Исправлено: voice loop busy spin, cpu

## 0.0.31 — 2026-10-30

- Исправлено: bt address, forget duplicates

## 0.0.30 — 2026-10-30

- Добавлено: bt power, saved nets, dns, music button

## 0.0.29 — 2026-10-30

- Исправлено: dedupe saved networks

## 0.0.28 — 2026-10-30

- Исправлено: sections balance

## 0.0.27 — 2026-10-30

- Добавлено: bluetooth and network cards, favicon

## 0.0.26 — 2026-10-30

- Исправлено: radio card order

## 0.0.25 — 2026-10-30

- Добавлено: internet radio card

## 0.0.24 — 2026-10-30

- Исправлено: real screen off via backlight

## 0.0.23 — 2026-10-30

- Исправлено: ambient light via Luna sensors

## 0.0.22 — 2026-10-30

- Исправлено: persist led off state across reload

## 0.0.21 — 2026-10-30

- Исправлено: deepseek-flash model in presets

## 0.0.20 — 2026-10-30

- Исправлено: no alice_light when voice daemon runs

## 0.0.19 — 2026-10-30

- Добавлено: VPN autostart, boot hook prep

## 0.0.18 — 2026-10-30

- Исправлено: voice intents, logging, pause music

## 0.0.17 — 2026-10-30

- Добавлено: voice daemon toggle

## 0.0.16 — 2026-10-30

- Добавлено: resources panel

## 0.0.15 — 2026-10-30

- Исправлено: vpn log truncate

## 0.0.14 — 2026-10-30

- Исправлено: vpn direct dns

## 0.0.13 — 2026-10-30

- Исправлено: vpn dns loopback, resolve proxy ip

## 0.0.12 — 2026-10-30

- Добавлено: VPN module with sing-box

## 0.0.11 — 2026-10-30

- Исправлено: prefer softvol default mixer

## 0.0.10 — 2026-10-30

- Добавлено: player cover, LLM redesign, voice ask

## 0.0.9 — 2026-10-30

- Исправлено: sync volume on load

## 0.0.8 — 2026-10-30

- Добавлено: LLM settings, glagol player, command

## 0.0.7 — 2026-10-30

- Добавлено: glagol player, command.py, LED per-diode

## 0.0.6 — 2026-10-30

- заливка на колонку

## 0.0.5 — 2026-10-30

- заливка на колонку

## 0.0.4 — 2026-10-30

- заливка на колонку

## 0.0.3 — 2026-10-30

- заливка на колонку

## 0.0.2 — 2026-10-30

- заливка на колонку

## 0.0.1 — 2026-10-30

Первый выпуск.

- Проект создан при участии DeepSeek Harness (LLM).

**Пульт**
- SPA без фреймворков: тёмная тема, стеклянные карточки, адаптив 320–1280 px.
- Дисплей: семисегментный предпросмотр как у Миди, режим рисования палочками,
  синхронизация времени, яркость с debounce, гашение.
- Кольцо: палитра, пресеты, радуга, градиент, 24-сегментный предпросмотр.
- Плеер: play/pause/next/prev, громкость, mute.
- Голос: блокирующий `recognize`, расшифровка, повтор Алисе.
- Озвучка: текст → штатный голос Алисы через IPC.
- Индикатор сервисов, журнал запросов и кнопка «Проверить API» в диагностике.

**CGI**
- `speak.py` — protobuf-кадр в IPC aliced (порт 9875), поиск unix-сокета,
  ответ по `TTS_STARTED`, понятные ошибки с подсказками.
- `media.py` — Glagol (1961): play/pause/next/prev/stop/setVolume, `probe`,
  произвольный кадр, переопределение формата в `glagol.conf`.
- `volume.py` — автопоиск микшера через `amixer`, кэш, fallback на Glagol.
- `status.py` — состояние Luna/Glagol/IPC/amixer + версия.
- `diag.py` — самодиагностика: коды и тела ответов Luna, кто слушает порты,
  пробы WebSocket Glagol, время колонки.

**Инфраструктура**
- lighttpd: `mod_cgi`, прокси `/luna/`, `.py` исключён из статики, `.conf` закрыт.
- `S99mypult`: идемпотентный запуск, свои pid-файлы, проверка конфига.
- `install.sh`: бэкап, CRLF, права, откат конфига, установка init в
  `/opt/etc/init.d` при read-only `/etc`.
- `push-to-station.ps1` + `push.cmd`: заливка по SSH без scp/sftp.
- Тесты: статика, юнит-логика, CGI с подставными aliced и Glagol.
