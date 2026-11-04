# Android APK

Тонкая WebView-оболочка MidiPult. Панель живёт на станции, поэтому изменения
интерфейса не требуют пересборки APK.

## Сборка

Нужен Android SDK, JDK 17 и Gradle 8.11+.

```sh
cd android
gradle assembleDebug
```

Для подписанного release:

```sh
export ANDROID_KEYSTORE_PATH=release.keystore
export ANDROID_KEYSTORE_PASSWORD=...
export ANDROID_KEY_ALIAS=...
export ANDROID_KEY_PASSWORD=...
gradle assembleRelease
```

`release.keystore` не коммитится.

## GitHub Actions

Workflow `.github/workflows/android.yml`:

- по тегу `android-v1.0.0` собирает APK;
- если заданы secrets, подписывает release;
- иначе собирает debug APK и кладёт в артефакты workflow;
- для тега публикует `midipult-android-<version>.apk` и `.sha256` в GitHub Release.

Secrets:

- `ANDROID_KEYSTORE_BASE64` — keystore в base64;
- `ANDROID_KEYSTORE_PASSWORD`;
- `ANDROID_KEY_ALIAS`;
- `ANDROID_KEY_PASSWORD`.

## Обновление APK

Приложение проверяет GitHub Releases с тегами `android-v*` не чаще раза в
сутки, скачивает `midipult-android-<version>.apk`, проверяет `.sha256` и
открывает системный установщик. Тихая установка без подтверждения
пользователя в Android запрещена.

## Discovery

Станция отвечает на UDP-broadcast `MYPULT_DISCOVER` на порт **8056**.
Ответ содержит `service`, `api`, `name`, `model`, `version`, `ip`, `port`.
Секретов в ответе нет; приложение после выбора станции открывает её панель.
