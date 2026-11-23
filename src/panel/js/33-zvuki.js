  /* ─────────── звуки ─────────── */
  function fmtSoundSize(bytes) {
    if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' МБ';
    if (bytes >= 1024) return Math.round(bytes / 1024) + ' КБ';
    return bytes + ' Б';
  }

  function setSoundStatus(text, bad) {
    if (!el.soundStatus) return;
    el.soundStatus.textContent = text;
    el.soundStatus.style.color = bad ? 'var(--warn)' : '';
  }

  var CUSTOM_NAME_RE = /^[A-Za-z0-9_-]{1,40}$/;

  function customNameFromFile(name) {
    return String(name || '').replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '').slice(0, 40) || 'sound';
  }

  function applySounds(data) {
    State.sounds = data.sounds || [];
    State.customSounds = data.custom || [];
    State.soundInfo = data;
    var previousSound = State.alarmSound;
    State.alarmSounds = (State.customSounds || []).slice();
    State.alarmSound = (State.alarmSounds.filter(function (sound) {
      return previousSound && sound.id === previousSound.id;
    })[0] || State.alarmSounds[0] || null);
    renderAlarmSoundList();
    updateAlarmSoundName();
    renderSounds();
    renderCustomSounds();
    refreshSoundPickers();
    var disk = (data.disks || []).filter(function (item) { return item.mount === '/data'; })[0];
    var free = disk ? ' · свободно /data ' + fmtSoundSize(disk.free_mb * 1024 * 1024) : '';
    var limit = fmtSoundSize(data.max_upload || 12 * 1024 * 1024);
    el.soundDrop.textContent = 'Перетащите аудиофайл на строку нужного звука или нажмите «Заменить» · до ' + limit;
    setSoundStatus('Бэкапы: ' + (data.backup_root || '/data/mypult/sounds-backup') +
      ' · ' + fmtSoundSize(data.backup_bytes || 0) + free +
      '. После замены нужна перезагрузка.');
  }

  function loadSounds(force) {
    var fromCgi = function () {
      return cgi('sounds.py', {}, { timeout: 20000, silent: true });
    };
    var initial = force ? Promise.reject(new Error('force')) :
      fetch('/state?full=1', { cache: 'no-store', credentials: 'same-origin' })
        .then(function (res) {
          if (!res.ok) throw new Error('state ' + res.status);
          return res.json();
        })
        .then(function (state) {
          if (Array.isArray(state.sounds)) return state;
          throw new Error('в state нет звуков');
        });
    return initial.catch(fromCgi).then(applySounds).catch(function (err) {
      setSoundStatus('Список звуков: ' + err.message, true);
    });
  }

  function renderCustomSounds() {
    if (!el.customSoundList) return;
    el.customSoundList.innerHTML = '';
    if (!State.customSounds.length) {
      var empty = document.createElement('div');
      empty.className = 'seg-note';
      empty.textContent = 'Пока нет своих звуков.';
      el.customSoundList.appendChild(empty);
      return;
    }
    State.customSounds.forEach(function (item) {
      var row = document.createElement('div');
      row.className = 'sound-row';
      var main = document.createElement('div');
      main.className = 'sound-main';
      var name = document.createElement('div');
      name.className = 'sound-name';
      name.textContent = item.name;
      var meta = document.createElement('div');
      meta.className = 'sound-meta';
      meta.textContent = 'свой · OPUS · ' + fmtSoundSize(item.size);
      main.appendChild(name);
      main.appendChild(meta);

      var actions = document.createElement('div');
      actions.className = 'sound-actions';
      var play = document.createElement('button');
      play.className = 'btn sm ghost sound-play';
      play.textContent = '▶';
      play.title = 'Прослушать';
      play.addEventListener('click', function () {
        toggleSoundPreview('custom:' + item.id, play, true);
      });
      actions.appendChild(play);

      var dl = document.createElement('a');
      dl.className = 'btn sm ghost';
      dl.textContent = 'Скачать';
      dl.href = '/cgi-bin/sounds.py?download_custom=' + encodeURIComponent(item.id);
      actions.appendChild(dl);

      var del = document.createElement('button');
      del.className = 'btn sm ghost';
      del.textContent = 'Удалить';
      del.addEventListener('click', function () { deleteCustomSound(item); });
      actions.appendChild(del);

      var rename = document.createElement('button');
      rename.className = 'btn sm ghost';
      rename.textContent = 'Переименовать';
      rename.addEventListener('click', function () { renameCustomSound(item); });
      actions.appendChild(rename);

      row.appendChild(main);
      row.appendChild(actions);
      el.customSoundList.appendChild(row);
    });
  }

  function renameCustomSound(item) {
    var value = window.prompt('Новое имя: только латиница, цифры, _ и -, без пробелов',
      item.name);
    if (value === null) return;
    value = value.trim();
    if (!CUSTOM_NAME_RE.test(value)) {
      toast('Имя: только латиница, цифры, _ и -, до 40 символов, без пробелов', 'warn');
      return;
    }
    cgi('sounds.py', { rename_custom: item.id, name: value }, { timeout: 15000 })
      .then(function () {
        toast('Звук переименован', 'ok');
        return loadSounds(true);
      }).catch(function (err) {
        toast('Переименование: ' + err.message, 'bad');
      });
  }

  function deleteCustomSound(item) {
    askConfirm('Удалить звук «' + item.name + '»?', { yes: 'Удалить' }).then(function (ok) {
      if (!ok) return;
      return cgi('sounds.py', { delete_custom: item.id }, { timeout: 15000 }).then(function () {
        toast('Звук удалён', 'ok');
        return loadSounds(true);
      }).catch(function (err) {
        toast('Удаление: ' + err.message, 'bad');
      });
    });
  }

  function uploadCustomSound(file) {
    if (!file) return;
    var max = (State.soundInfo && State.soundInfo.custom_max_upload) || 12 * 1024 * 1024;
    if (file.size > max) {
      toast('Файл больше ' + fmtSoundSize(max) + ' для /data', 'warn');
      return;
    }
    var rawName = (el.customSoundName.value || '').trim();
    var name = rawName || customNameFromFile(file.name);
    if (!CUSTOM_NAME_RE.test(name)) {
      toast('Имя: только латиница, цифры, _ и -, до 40 символов, без пробелов', 'warn');
      return;
    }
    fetch('/cgi-bin/sounds.py?custom=1&name=' + encodeURIComponent(name), {
      method: 'POST',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file
    }).then(function (res) {
      return res.json().then(function (data) { return { ok: res.ok, data: data }; });
    }).then(function (result) {
      if (!result.ok || result.data.ok === false) {
        throw new Error(result.data.error || 'не удалось добавить');
      }
      el.customSoundName.value = '';
      toast('Свой звук добавлен', 'ok');
      return loadSounds(true);
    }).catch(function (err) {
      toast('Свой звук: ' + err.message, 'bad');
    });
  }

  function stopSoundPreview() {
    var audio = State.previewAudio;
    if (audio) {
      try { audio.pause(); audio.removeAttribute('src'); audio.load(); } catch (e) {}
    }
    if (State.previewBtn) {
      State.previewBtn.textContent = '▶';
      State.previewBtn.title = 'Прослушать';
    }
    State.previewAudio = null;
    State.previewPath = null;
    State.previewBtn = null;
  }

  function toggleSoundPreview(path, btn, custom) {
    if (State.previewPath === path && State.previewAudio) {
      if (State.previewAudio.paused) {
        State.previewAudio.play().then(function () {
          btn.textContent = '■';
          btn.title = 'Пауза';
        }).catch(function (err) { toast('Звук: ' + err.message, 'bad'); });
      } else {
        State.previewAudio.pause();
        btn.textContent = '▶';
        btn.title = 'Прослушать';
      }
      return;
    }
    stopSoundPreview();
    var audioUrl = custom
      ? '/cgi-bin/sounds.py?audio_custom=' + encodeURIComponent(path.replace(/^custom:/, ''))
      : '/cgi-bin/sounds.py?audio=' + encodeURIComponent(path);
    var audio = new Audio(audioUrl);
    audio.preload = 'auto';
    State.previewAudio = audio;
    State.previewPath = path;
    State.previewBtn = btn;
    btn.textContent = '■';
    btn.title = 'Пауза';
    audio.onended = function () {
      if (State.previewAudio === audio) stopSoundPreview();
    };
    audio.onerror = function () {
      if (State.previewAudio === audio) stopSoundPreview();
      toast('Не удалось проиграть звук', 'bad');
    };
    audio.play().catch(function (err) {
      if (State.previewAudio === audio) stopSoundPreview();
      toast('Звук: ' + err.message, 'bad');
    });
  }

  function renderSounds() {
    stopSoundPreview();
    if (!el.soundList) return;    var group = el.soundGroup.value;
    var query = (el.soundSearch.value || '').trim().toLowerCase();
    var items = State.sounds.filter(function (item) {
      if (group !== 'all' && item.group !== group) return false;
      return !query || item.name.toLowerCase().indexOf(query) >= 0;
    });
    el.soundList.innerHTML = '';
    if (!items.length) {
      var empty = document.createElement('div');
      empty.className = 'seg-note';
      empty.textContent = 'Ничего не найдено.';
      el.soundList.appendChild(empty);
      return;
    }
    items.forEach(function (item) {
      var row = document.createElement('div');
      row.className = 'sound-row';
      row.dataset.path = item.path;
      row.title = 'Перетащите сюда .opus или .wav';

      var main = document.createElement('div');
      main.className = 'sound-main';
      var name = document.createElement('div');
      name.className = 'sound-name';
      name.textContent = item.name;
      var desc = null;
      if (item.description) {
        desc = document.createElement('div');
        desc.className = 'sound-desc';
        desc.textContent = item.description;
      }
      var meta = document.createElement('div');
      meta.className = 'sound-meta';
      var maxTxt = item.max_upload && item.max_upload < 12 * 1024 * 1024
        ? 'до ' + fmtSoundSize(item.max_upload) : '';
      meta.textContent = [item.group, item.format.toUpperCase(), fmtSoundSize(item.size),
        item.source === 'data' ? 'свой' : 'системный', item.backup ? 'есть бэкап' : '',
        maxTxt].filter(Boolean).join(' · ');
      main.appendChild(name);
      if (desc) main.appendChild(desc);
      main.appendChild(meta);

      var actions = document.createElement('div');
      actions.className = 'sound-actions';
      var play = document.createElement('button');
      play.className = 'btn sm ghost sound-play';
      play.textContent = '▶';
      play.title = 'Прослушать';
      play.setAttribute('aria-label', 'Прослушать ' + item.name);
      play.addEventListener('click', function (ev) {
        ev.stopPropagation();
        toggleSoundPreview(item.path, play);
      });
      actions.appendChild(play);
      var dl = document.createElement('a');
      dl.className = 'btn sm ghost';
      dl.textContent = 'Скачать';
      dl.href = '/cgi-bin/sounds.py?download=' + encodeURIComponent(item.path);
      actions.appendChild(dl);

      if (item.backup) {
        var restore = document.createElement('button');
        restore.className = 'btn sm ghost';
        restore.textContent = 'Вернуть';
        restore.addEventListener('click', function () { restoreSound(item.path); });
        actions.appendChild(restore);
      }

      if (item.writable) {
        var replace = document.createElement('button');
        replace.className = 'btn sm';
        replace.textContent = 'Заменить';
        replace.addEventListener('click', function () { pickSound(item.path); });
        actions.appendChild(replace);
      } else {
        var unsupported = document.createElement('span');
        unsupported.className = 'sound-unsupported';
        unsupported.textContent = 'Только скачать';
        actions.appendChild(unsupported);
      }

      row.addEventListener('dragover', function (ev) {
        ev.preventDefault();
        row.classList.add('drag');
        State.soundTarget = item.path;
      });
      row.addEventListener('dragleave', function () { row.classList.remove('drag'); });
      row.addEventListener('drop', function (ev) {
        ev.preventDefault();
        row.classList.remove('drag');
        var file = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
        if (file) uploadSound(file, item.path);
      });

      row.appendChild(main);
      row.appendChild(actions);
      el.soundList.appendChild(row);
    });
  }

  function pickSound(rel) {
    State.soundTarget = rel;
    el.soundFile.value = '';
    el.soundFile.click();
  }

  function uploadSound(file, rel) {
    if (!file) return;
    var item = (State.sounds || []).filter(function (entry) { return entry.path === rel; })[0];
    var limit = item && item.max_upload ? item.max_upload : 12 * 1024 * 1024;
    if (file.size > limit) {
      toast('Файл ' + fmtSoundSize(file.size) + ', а с учётом свободного места можно до ' +
        fmtSoundSize(limit), 'warn');
      return;
    }
    setSoundStatus('Заменяю «' + rel + '»: проверяю и конвертирую…');
    var url = '/cgi-bin/sounds.py?replace=' + encodeURIComponent(rel) +
      '&filename=' + encodeURIComponent(file.name || 'sound');
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file
    }).then(function (res) {
      return res.json().then(function (data) { return { ok: res.ok, data: data }; });
    }).then(function (result) {
      if (!result.ok || result.data.ok === false) {
        throw new Error(result.data.error || 'не удалось заменить');
      }
      toast('Звук заменён. Перезагрузите колонку.', 'ok');
      setSoundStatus('Звук заменён: ' + rel + '. Перезагрузите колонку.');
      return loadSounds(true);
    }).catch(function (err) {
      setSoundStatus('Ошибка: ' + err.message, true);
      toast('Звук: ' + err.message, 'bad');
    });
  }

  function restoreSound(rel) {
    askConfirm('Вернуть оригинальный звук «' + rel + '»?', { yes: 'Вернуть' }).then(function (ok) {
      if (!ok) return;
      setSoundStatus('Возвращаю оригинал…');
      return cgi('sounds.py', { restore: rel }, { timeout: 30000 }).then(function () {
        toast('Оригинал возвращён. Перезагрузите колонку.', 'ok');
        setSoundStatus('Оригинал возвращён: ' + rel + '. Перезагрузите колонку.');
        return loadSounds(true);
      }).catch(function (err) {
        setSoundStatus('Ошибка: ' + err.message, true);
        toast('Возврат: ' + err.message, 'bad');
      });
    });
  }

  function showPinGate(show) {
    el.pinGate.hidden = !show;
    if (show && el.pinInput) setTimeout(function () { el.pinInput.focus(); }, 60);
  }

  function loadAuth() {
    return cgi('auth.py', { status: 1 }, { timeout: 8000, silent: true }).then(function (data) {
      el.pinStatus.textContent = data.enabled ? 'PIN включён' : 'PIN не включён';
      el.pinInsecure.hidden = !(data.enabled && location.protocol === 'http:');
      showPinGate(!!data.enabled && !data.authed);
      return data;
    }).catch(function (err) {
      // Ошибка проверки не должна выглядеть как «панель без PIN»: сервер всё
      // равно отдаст 401, а пользователь должен видеть, что нужен вход.
      showPinGate(true);
      if (el.pinError) el.pinError.textContent = 'Не удалось проверить PIN: ' + err.message;
    });
  }

  function enablePin() {
    var pin = el.pinNew.value.trim();
    if (!/^\d{4,8}$/.test(pin)) { toast('PIN: 4–8 цифр', 'warn'); return; }
    return cgi('auth.py', { pin: pin, enabled: 1 }, { timeout: 10000 }).then(function () {
      el.pinNew.value = '';
      el.pinStatus.textContent = 'PIN включён';
      el.pinInsecure.hidden = location.protocol !== 'http:';
      showPinGate(true);
      toast('PIN включён — введите его', 'ok');
    }).catch(function (err) { toast('PIN: ' + err.message, 'bad'); });
  }

  function disablePin() {
    askConfirm('Отключить PIN? Панель снова будет открыта без пароля.', { yes: 'Отключить PIN' }).then(function (ok) {
      if (!ok) return;
      return cgi('auth.py', { disable: 1 }, { timeout: 10000 }).then(function () {
        el.pinStatus.textContent = 'PIN не включён';
        el.pinInsecure.hidden = true;
        toast('PIN отключён', 'ok');
      }).catch(function (err) { toast('PIN: ' + err.message, 'bad'); });
    });
  }

  function lockPanel() {
    return cgi('auth.py', { logout: 1 }, { timeout: 8000 }).then(function () {
      el.pinInput.value = '';
      el.pinError.textContent = '';
      showPinGate(true);
    }).catch(function (err) { toast('PIN: ' + err.message, 'bad'); });
  }

  function loginPin() {
    var pin = el.pinInput.value.trim();
    if (!pin) return;
    el.pinError.textContent = 'проверяю…';
    return cgi('auth.py', { login: 1, pin: pin }, { timeout: 10000 }).then(function () {
      el.pinError.textContent = '';
      showPinGate(false);
      location.reload();
    }).catch(function (err) {
      el.pinError.textContent = err.message || 'Неверный PIN';
      el.pinInput.select();
    });
  }

