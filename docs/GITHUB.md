# Публикация на GitHub

Проект подготовлен к публикации: личные данные, секреты, локальные логи и
скриншоты с реальными IP/SSID исключены через `.gitignore`.

## Что намеренно не попадает в репозиторий

| Путь | Почему |
|---|---|
| `.mypult-station` | IP вашей колонки |
| `.mypult-hash` | локальное состояние деплоя |
| `push.log` | журнал заливки с адресами |
| `tests/*.png`, `tests/shot-*.png` | скриншоты с IP, SSID и подпиской |
| `__pycache__/`, `*.pyc` | сборочный мусор |
| `/data/mypult/*` | токены, ключи LLM, VPN-подписка, DNS, PIN — **никогда** не коммитить |
| `auth.json`, `volume.json`, `ring.json` | создаются только на устройстве |

Секреты создаются на колонке в `/data/mypult` с правами `600` и в исходниках
отсутствуют. Резервная копия из панели тоже содержит ключи — её нельзя
прикладывать к issue или коммитить.

## Вариант A — через git (рекомендуется)

Установите [Git for Windows](https://git-scm.com/download/win), затем в папке проекта:

```powershell
git init
git add .
git status                 # просмотрите список: не должно быть секретов и IP
git commit -m "Initial commit: MidiPult"
git branch -M main
git remote add origin https://github.com/<ваш-логин>/<репозиторий>.git
git push -u origin main
```

Если `git status` показывает что-то лишнее — добавьте путь в `.gitignore`
и повторите `git add .`.

## Вариант B — через веб-интерфейс GitHub

1. Создайте пустой репозиторий (без README).
2. На странице репозитория: **Add file → Upload files**.
3. Перетащите папки `cgi-bin`, `deploy`, `docs`, `init.d`, `lighttpd`,
   `service`, `tests` и файлы:
   - `index.html`, `index.py`, `manifest.json`, `favicon.ico`,
     `icon-192.png`, `icon-512.png`, `icon.png`;
   - `README.md`, `FAQ.md`, `SECURITY.md`, `CHANGELOG.md`, `LICENSE`, `.gitignore`;
   - `version.json`.
4. Не загружайте `tests/*.png`, `.mypult-station`, `push.log`, `auth.json`,
   `llm.json`, `vpn.json` и прочие файлы из `/data/mypult`.

## Проверка перед публикацией

```powershell
# реальные адреса, токены LLM, подписки, PIN
Select-String -Path *.md,*.html,*.json,cgi-bin\*.py,service\*.py,deploy\* `
  -Pattern "192\.168\.(?!1\.100)|y0__|sk-[A-Za-z0-9]{10,}|vless://|vmess://|trojan://|Session_id|mypult_token="
```

Ожидаемый результат — пусто (кроме учебных примеров вида `192.168.1.100`).

Дополнительно проверьте, что не попали:

- `auth.json` (PIN-хэш и токен);
- `llm.json` (ключи провайдеров);
- `vpn.json` (подписка);
- `chats.json` (личные вопросы к нейросети);
- логи `voice.log`, `mypult.log`.

## Лицензия

Проект распространяется по MIT (`LICENSE`). Замените имя правообладателя,
если публикуете от своего имени.

## Скриншоты для README

Сделайте свои на тестовой сети без реальных данных: подписка VPN и SSID
должны быть фиктивными, IP — из диапазона `192.168.1.x`. Не показывайте
карточку «Нейросеть» с ключом и «Резервная копия» с реальными настройками.
