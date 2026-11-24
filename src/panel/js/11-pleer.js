  /* ─────────── плеер ─────────── */
  function fmtTime(seconds) {
    var total = Math.max(0, Math.round(seconds || 0));
    var mins = Math.floor(total / 60);
    var secs = total % 60;
    return mins + ':' + (secs < 10 ? '0' : '') + secs;
  }

  function playbackProgress() {
    var base = Number(State.progressBase) || 0;
    var at = Number(State.progressAt) || 0;
    var extra = (State.playing && !State.seeking && at)
      ? Math.max(0, Date.now() / 1000 - at) : 0;
    var value = base + extra;
    var duration = Number(State.mediaDuration) || 0;
    if (duration > 0) value = Math.min(value, duration);
    return Math.max(0, value);
  }

  function currentProgress() {
    if (State.pendingSeek) return State.pendingSeek.target;
    return playbackProgress();
  }

  var CLOCK_PRESETS = {
    wink: {
      name: 'Подмигивание', duration: 260, frames: [
        ['abcdefg', 'abcdefg', 'abcdefg', 'abcdefg'],
        ['', '', 'abcdefg', 'abcdefg'],
        ['abcdefg', 'abcdefg', 'abcdefg', 'abcdefg'],
        ['abcdefg', 'abcdefg', '', '']
      ]
    },
    blink: {
      name: 'Моргание', duration: 280, frames: [
        ['abcdefg', 'abcdefg', 'abcdefg', 'abcdefg'],
        ['', '', '', ''],
        ['abcdefg', 'abcdefg', 'abcdefg', 'abcdefg'],
        ['', '', '', '']
      ]
    },
    snake: {
      name: 'Змейка', duration: 220, frames: [
        ['abcdefg', '', '', ''], ['', 'abcdefg', '', ''],
        ['', '', 'abcdefg', ''], ['', '', '', 'abcdefg']
      ]
    }
  };

  function currentPattern() {
    return (State.pattern || ['', '', '', '']).slice(0, 4).map(function (segments) {
      return segments || '';
    });
  }

  function animFrameCaption(frame) {
    var chars = (frame || []).map(function (segments) {
      return SEG_TO_DIGIT[sortSegments(segments || '')] || '·';
    }).join('');
    return /^\d{4}$/.test(chars) ? chars.slice(0, 2) + ':' + chars.slice(2) : chars;
  }

  function renderAnimFrames() {
    if (!el.animFrames) return;
    el.animFrames.innerHTML = '';
    State.animFrames.forEach(function (frame, index) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'anim-frame';
      button.setAttribute('aria-pressed', index === State.animIndex ? 'true' : 'false');
      var number = document.createElement('b');
      number.textContent = String(index + 1);
      var caption = document.createElement('small');
      caption.textContent = animFrameCaption(frame);
      button.appendChild(number);
      button.appendChild(caption);
      button.addEventListener('click', function () { setAnimFrame(index); });
      el.animFrames.appendChild(button);
    });
  }

  function setAnimFrame(index) {
    if (!State.animFrames.length) return;
    State.animIndex = Math.max(0, Math.min(State.animFrames.length - 1, index));
    State.pattern = State.animFrames[State.animIndex].slice();
    State.drawing = true;
    el.displayPreview.classList.add('editing');
    el.btnDraw.setAttribute('aria-pressed', 'true');
    renderPattern(State.pattern);
    renderAnimFrames();
  }

  function syncAnimFrame() {
    if (!el.animEditor || el.animEditor.hidden) return;
    State.animFrames[State.animIndex] = currentPattern();
    renderAnimFrames();
  }

  function initialAnimFrame() {
    if (State.drawing && State.pattern) return currentPattern();
    var digits = String(el.clockTime.textContent || '').replace(/\D/g, '').slice(0, 4);
    if (digits.length === 4) return digits.split('').map(segmentsForChar);
    return currentPattern();
  }

  function openAnimEditor(frames, name, duration, id, fresh) {
    stopClockAnim(false);
    if (frames && frames.length) {
      State.animFrames = frames.map(function (frame) { return frame.slice(); });
      State.animIndex = 0;
    } else if (fresh || !State.animFrames.length) {
      State.animFrames = [initialAnimFrame()];
      State.animIndex = 0;
    }
    State.editingAnimId = id || null;
    if (name !== undefined) el.animName.value = name || '';
    if (duration !== undefined) el.animDuration.value = String(duration || 300);
    el.animEditor.hidden = false;
    el.segToolbar.hidden = true;
    el.btnDraw.hidden = true;
    setAnimFrame(State.animIndex || 0);
    loadSavedAnims();
  }

  function closeAnimEditor() {
    stopClockAnim(true);
    el.animEditor.hidden = true;
    State.animFrames = [];
    State.animIndex = 0;
    State.editingAnimId = null;
    el.animName.value = '';
    el.animDuration.value = '300';
    el.btnDraw.hidden = false;
    State.drawing = false;
    State.pattern = null;
    el.displayPreview.classList.remove('editing');
    el.btnDraw.setAttribute('aria-pressed', 'false');
    renderTime(el.clockTime.textContent);
  }

  function clockLayerOff() {
    return request('/cgi-bin/luna.py?path=%2Fapi%2Fclock%2Foff',
      { body: {}, timeout: 5000 }).catch(function () { /* тихо */ });
  }

  function playClockAnim(frames, duration, name) {
    if (!State.animPlaying) {
      State.animBrightness = parseInt(el.brightness.value, 10) || 170;
    }
    stopClockAnim(false);
    frames = (frames && frames.length ? frames : State.animFrames);
    if (!frames || !frames.length) return;
    State.animPlaying = true;
    var run = ++State.animRun;
    setDisplayManual('anim');
    if (el.btnClockAnimStop) el.btnClockAnimStop.hidden = false;
    if (el.clockAnimStatus) el.clockAnimStatus.textContent = name || 'анимация';
    var index = 0;
    var failures = 0;
    var delay = Math.max(80, parseInt(duration, 10) || 300);
    var schedule = function (ms) {
      if (!State.animPlaying || run !== State.animRun) return;
      State.animTimer = setTimeout(send, ms);
    };
    var send = function () {
      if (!State.animPlaying || run !== State.animRun) return;
      var frame = frames[index % frames.length];
      State.modelFrame = frame.slice();
      drawHomeScreen();
      renderPattern(frame);
      var started = Date.now();
      var ctrl = new AbortController();
      State.animAbort = ctrl;
      luna('/api/clock', { segments: patternSegments(frame) },
        { timeout: 6000, signal: ctrl.signal }).then(function () {
        if (!State.animPlaying || run !== State.animRun) return;
        failures = 0;
        schedule(Math.max(0, delay - (Date.now() - started)));
      }).catch(function (err) {
        if (!State.animPlaying || run !== State.animRun) return;
        failures += 1;
        if (failures >= 2) {
          stopClockAnim(false);
          toast('Анимация остановлена: ' + err.message, 'bad');
          return;
        }
        // Не долбим станцию сразу: одна пауза и ещё одна попытка.
        schedule(Math.max(400, delay));
      });
      index += 1;
    };
    clockLayerOff().then(send);
  }

  function stopClockAnim(restore) {
    State.animPlaying = false;
    State.animRun += 1;
    State.modelFrame = null;
    drawHomeScreen();
    if (el.btnClockAnimStop) el.btnClockAnimStop.hidden = true;
    if (State.animAbort) {
      try { State.animAbort.abort(); } catch (e) { /* уже завершён */ }
      State.animAbort = null;
    }
    if (State.animTimer) {
      clearTimeout(State.animTimer);
      State.animTimer = null;
    }
    if (el.clockAnimStatus) el.clockAnimStatus.textContent = '—';
    if (restore) {
      var brightness = State.animBrightness || parseInt(el.brightness.value, 10) || 170;
      State.animBrightness = null;
      returnClock(brightness);
    }
  }

  function clockPresetItems() {
    return Object.keys(CLOCK_PRESETS).map(function (key) {
      var preset = CLOCK_PRESETS[key];
      return {
        id: 'preset:' + key,
        key: key,
        preset: true,
        name: preset.name,
        frames: preset.frames,
        duration: preset.duration
      };
    });
  }

  function renderClockAnimList() {
    if (!el.clockAnimList) return;
    var hidden = State.hiddenPresets || [];
    var presets = clockPresetItems().filter(function (item) {
      return hidden.indexOf(item.id) < 0;
    });
    var custom = State.clockAnims || [];
    el.clockAnimList.innerHTML = '';
    if (el.btnAnimRestorePresets) el.btnAnimRestorePresets.hidden = !hidden.length;
    if (!presets.length && !custom.length) {
      var empty = document.createElement('div');
      empty.className = 'anim-saved-empty';
      empty.textContent = 'Анимаций нет — создайте новую.';
      el.clockAnimList.appendChild(empty);
      return;
    }
    presets.concat(custom).forEach(function (item) {
      var row = document.createElement('div');
      row.className = 'clock-anim-row';
      var nameWrap = document.createElement('div');
      nameWrap.className = 'clock-anim-name';
      var name = document.createElement('b');
      name.textContent = item.name || 'Анимация';
      var note = document.createElement('small');
      note.textContent = (item.frames || []).length + ' кадров · ' + (item.duration || 300) + ' мс';
      nameWrap.appendChild(name);
      if (item.preset) {
        var badge = document.createElement('span');
        badge.className = 'preset';
        badge.textContent = 'пресет';
        nameWrap.appendChild(badge);
      }
      nameWrap.appendChild(note);
      var play = document.createElement('button');
      play.type = 'button';
      play.className = 'btn sm ghost';
      play.textContent = 'Играть';
      play.addEventListener('click', function () {
        playClockAnim(item.frames, item.duration, item.name);
      });
      var edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'btn sm ghost';
      edit.textContent = 'Изменить';
      edit.addEventListener('click', function () {
        openAnimEditor(item.frames, item.name, item.duration, item.preset ? null : item.id);
      });
      var remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'clock-anim-del';
      remove.textContent = '×';
      remove.title = 'Удалить';
      remove.addEventListener('click', function () {
        if (item.preset) { hideClockPreset(item.id); return; }
        askConfirm('Удалить анимацию «' + (item.name || 'Анимация') + '»?',
          { yes: 'Удалить' }).then(function (ok) {
          if (ok) deleteClockAnim(item.id);
        });
      });
      row.appendChild(nameWrap);
      row.appendChild(play);
      row.appendChild(edit);
      row.appendChild(remove);
      el.clockAnimList.appendChild(row);
    });
  }

  function loadSavedAnims() {
    return cgi('display.py', {}, { timeout: 15000, silent: true }).then(function (data) {
      State.clockAnims = data.clock_anims || [];
      State.hiddenPresets = data.hidden_presets || [];
      renderClockAnimList();
    }).catch(function () {});
  }

  function hideClockPreset(id) {
    cgi('display.py', { clock_preset_hide: id }, { timeout: 15000 }).then(function (data) {
      State.hiddenPresets = data.hidden_presets || [];
      renderClockAnimList();
      toast('Пресет убран из списка', 'ok');
    }).catch(function (err) { toast('Анимация: ' + err.message, 'bad'); });
  }

  function restoreClockPresets() {
    cgi('display.py', { clock_preset_restore: 1 }, { timeout: 15000 }).then(function (data) {
      State.hiddenPresets = data.hidden_presets || [];
      renderClockAnimList();
      toast('Пресеты возвращены', 'ok');
    }).catch(function (err) { toast('Анимация: ' + err.message, 'bad'); });
  }

  function saveClockAnim() {
    var name = (el.animName.value || '').trim();
    if (!name) { toast('Укажите название анимации', 'warn'); el.animName.focus(); return; }
    var frames = State.animFrames.map(function (frame) { return frame.slice(); });
    var duration = parseInt(el.animDuration.value, 10) || 300;
    var payload = { name: name, frames: frames, duration: duration };
    if (State.editingAnimId) payload.id = State.editingAnimId;
    var wasEditing = !!State.editingAnimId;
    cgi('display.py', { clock_anim_save: payload }, { timeout: 15000 }).then(function (data) {
      State.clockAnims = data.clock_anims || [];
      if (!State.editingAnimId) {
        var saved = State.clockAnims.filter(function (item) {
          return item.name === name;
        }).pop();
        if (saved) State.editingAnimId = saved.id;
      }
      renderClockAnimList();
      toast(wasEditing ? 'Анимация обновлена' : 'Анимация сохранена', 'ok');
    }).catch(function (err) { toast('Анимация: ' + err.message, 'bad'); });
  }

  function deleteClockAnim(id) {
    cgi('display.py', { clock_anim_delete: id }, { timeout: 15000 }).then(function (data) {
      State.clockAnims = data.clock_anims || [];
      if (State.editingAnimId === id) State.editingAnimId = null;
      renderClockAnimList();
      toast('Анимация удалена', 'ok');
    }).catch(function (err) { toast('Анимация: ' + err.message, 'bad'); });
  }

  function clockAnimBind() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-cpreset]'), function (button) {
      button.addEventListener('click', function () {
        var preset = CLOCK_PRESETS[button.dataset.cpreset];
        if (!preset) return;
        openAnimEditor(preset.frames, preset.name, preset.duration);
        playClockAnim(preset.frames, preset.duration, preset.name);
      });
    });
    if (el.btnAnimEditor) el.btnAnimEditor.addEventListener('click', function () {
      openAnimEditor(null, '', 300, null, true);
    });
    if (el.btnAnimRestorePresets) el.btnAnimRestorePresets.addEventListener('click', restoreClockPresets);
    if (el.btnClockAnimStop) el.btnClockAnimStop.addEventListener('click', function () {
      stopClockAnim(true);
    });
    if (el.btnAnimPlay) el.btnAnimPlay.addEventListener('click', function () {
      playClockAnim(State.animFrames, parseInt(el.animDuration.value, 10) || 300,
        (el.animName.value || '').trim() || 'анимация');
    });
    if (el.btnAnimStop) el.btnAnimStop.addEventListener('click', function () { stopClockAnim(true); });
    if (el.btnAnimClose) el.btnAnimClose.addEventListener('click', closeAnimEditor);
    if (el.btnAnimAdd) el.btnAnimAdd.addEventListener('click', function () {
      State.animFrames.splice(State.animIndex + 1, 0, currentPattern());
      setAnimFrame(State.animIndex + 1);
    });
    if (el.btnAnimDup) el.btnAnimDup.addEventListener('click', function () {
      State.animFrames.splice(State.animIndex + 1, 0,
        (State.animFrames[State.animIndex] || ['', '', '', '']).slice());
      setAnimFrame(State.animIndex + 1);
    });
    if (el.btnAnimDel) el.btnAnimDel.addEventListener('click', function () {
      if (State.animFrames.length <= 1) return;
      State.animFrames.splice(State.animIndex, 1);
      setAnimFrame(Math.max(0, State.animIndex - 1));
    });
    if (el.btnAnimText) el.btnAnimText.addEventListener('click', function () {
      var digits = String(el.animText.value || '').replace(/\D/g, '').slice(0, 4);
      if (digits.length !== 4) { toast('Введите 4 цифры, например 12:34', 'warn'); return; }
      State.animFrames[State.animIndex] = digits.split('').map(segmentsForChar);
      setAnimFrame(State.animIndex);
    });
    if (el.btnAnimSave) el.btnAnimSave.addEventListener('click', saveClockAnim);
  }

  function updateMediaProgress() {
    if (!el.mediaSeek) return;
    var duration = State.mediaDuration || 0;
    var progress = currentProgress();
    State.mediaProgress = progress;
    // Текст ведём по подтверждённой позиции звука, а не по цели перемотки:
    // иначе строка прыгает вперёд, пока станция ещё переезжает.
    State.audioProgress = State.pendingSeek ? playbackProgress() : progress;
    // Пока пользователь тянет ползунок, его значение и подпись трогать нельзя:
    // иначе change прочитает позицию, переписанную таймером, и перемотки не будет.
    if (!State.seeking) {
      var ratio = duration > 0 ? Math.max(0, Math.min(1, progress / duration)) : 0;
      el.mediaSeek.value = String(Math.round(ratio * 1000));
      el.mediaPos.textContent = fmtTime(progress);
      el.mediaDur.textContent = duration > 0 ? fmtTime(duration) : '0:00';
    }
    highlightLyrics();
    syncLyricsPlayer();
  }

  function clearLyrics() {
    State.lyricsLines = [];
    State.lyricsActive = null;
    if (el.lyricsBox) {
      el.lyricsBox.innerHTML = '';
      el.lyricsBox.style.transform = '';
    }
    if (el.lyricsStatus) el.lyricsStatus.textContent = '';
    if (el.lyricsDlg && el.lyricsDlg.open) el.lyricsDlg.close();
    clearNowLyrics();
    updateInlineLine();
  }

  function syncLyricsPlayer() {
    var dialog = el.lyricsDlg;
    if (!dialog || !dialog.open) return;
    var title = document.getElementById('lyrPlayerTitle');
    var artist = document.getElementById('lyrPlayerArtist');
    var cover = document.getElementById('lyrPlayerCover');
    var play = document.getElementById('lyrPlayerPlay');
    var seek = document.getElementById('lyrPlayerSeek');
    var pos = document.getElementById('lyrPlayerPos');
    var dur = document.getElementById('lyrPlayerDur');
    var volume = document.getElementById('lyrPlayerVolume');
    var volumeVal = document.getElementById('lyrPlayerVolumeVal');
    var duration = Number(State.mediaDuration) || 0;
    var current = Number(State.mediaProgress) || 0;
    if (title) title.textContent = State.mediaTitle || 'Ничего не играет';
    if (artist) artist.textContent = State.mediaArtist || 'Яндекс Музыка';
    if (cover) {
      if (State.mediaCover) {
        cover.src = State.mediaCover;
        cover.hidden = false;
      } else {
        cover.hidden = true;
      }
    }
    if (play) {
      var use = play.querySelector('use');
      if (use) use.setAttribute('href', State.playing ? '#i-pause' : '#i-play');
    }
    if (seek) {
      seek.max = '1000';
      if (!State.lyrSeeking) {
        seek.value = duration ? String(Math.round(current / duration * 1000)) : '0';
      }
    }
    if (pos) pos.textContent = fmtTime(current);
    if (dur) dur.textContent = duration ? fmtTime(duration) : '0:00';
    if (volume && !State.ymVolumeBusy) volume.value = String(State.volume || 0);
    if (volumeVal) volumeVal.textContent = (State.volume || 0) + '%';
    updateVolumeIcons();
  }

  function clearNowLyrics() {
    var box = document.getElementById('ymNowLyricsBox');
    if (box) {
      box.innerHTML = '';
      box.hidden = true;
    }
    State.nowLyricsLines = [];
    State.nowLyricsActive = null;
  }

  function renderNowLyrics(data) {
    var box = document.getElementById('ymNowLyricsBox');
    if (!box) return;
    box.innerHTML = '';
    State.nowLyricsLines = [];
    State.nowLyricsActive = null;
    if (!data || !data.found) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    if (data.synced && data.synced.length) {
      data.synced.forEach(function (item) {
        var line = document.createElement('div');
        line.className = 'ym-now-line';
        line.textContent = item.text;
        line.dataset.t = item.t;
        box.appendChild(line);
      });
    } else {
      String(data.plain || '').split('\n').forEach(function (text) {
        if (!text.trim()) return;
        var line = document.createElement('div');
        line.className = 'ym-now-line plain';
        line.textContent = text;
        box.appendChild(line);
      });
    }
    State.nowLyricsLines = Array.prototype.slice.call(box.children);
    highlightNowLyrics(true);
  }

  // Небольшой запас: локальные часы панели чуть обгоняют станцию, из-за чего
  // строка включалась раньше звука. 0.22 с убирает этот забег.
  var LYRICS_DELAY = 0.22;

  function highlightNowLyrics(force) {
    var lines = State.nowLyricsLines;
    if (!lines || !lines.length) return;
    var now = Math.max(0, (State.audioProgress || State.mediaProgress || 0) - LYRICS_DELAY);
    var active = null;
    lines.forEach(function (line) {
      var moment = parseFloat(line.dataset.t);
      if (!isNaN(moment) && moment <= now + 0.03) active = line;
    });
    if (!force && State.nowLyricsActive === active) return;
    State.nowLyricsActive = active;
    lines.forEach(function (line) {
      line.classList.toggle('active', line === active);
    });
    var box = document.getElementById('ymNowLyricsBox');
    if (active && box && box.scrollHeight > box.clientHeight) {
      var top = active.offsetTop - box.clientHeight / 2 + active.offsetHeight / 2;
      box.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    }
  }

  function renderLyrics(data) {
    if (!el.lyricsBox) return;
    el.lyricsBox.innerHTML = '';
    el.lyricsBox.style.transform = '';
    State.lyricsLines = [];
    State.lyricsActive = null;
    if (!data || !data.found) {
      if (el.lyricsStatus) el.lyricsStatus.textContent = '';
      renderNowLyrics(data);
      var empty = document.createElement('div');
      empty.className = 'plain';
      empty.textContent = 'Текст не найден';
      el.lyricsBox.appendChild(empty);
      return;
    }
    el.lyricsStatus.textContent = data.source || 'LRCLIB';
    if (data.synced && data.synced.length) {
      data.synced.forEach(function (item) {
        var line = document.createElement('div');
        line.className = 'line';
        line.textContent = item.text;
        line.dataset.t = item.t;
        el.lyricsBox.appendChild(line);
      });
      State.lyricsLines = Array.prototype.slice.call(el.lyricsBox.children);
      renderNowLyrics(data);
      highlightLyrics();
      return;
    }
    var plain = document.createElement('div');
    plain.className = 'plain';
    plain.textContent = data.plain || '';
    el.lyricsBox.appendChild(plain);
    renderNowLyrics(data);
  }

  function highlightLyrics() {
    var lines = State.lyricsLines;
    if (!lines || !lines.length) {
      updateInlineLine();
      return;
    }
    var now = Math.max(0, (State.audioProgress || State.mediaProgress || 0) - LYRICS_DELAY);
    var active = null;
    lines.forEach(function (line) {
      var moment = parseFloat(line.dataset.t);
      if (!isNaN(moment) && moment <= now + 0.03) active = line;
    });
    if (State.lyricsActive === active) {
      highlightNowLyrics();
      updateInlineLine();
      return;
    }
    State.lyricsActive = active;
    lines.forEach(function (line) {
      line.classList.toggle('active', line === active);
    });
    // Плавно ведём активную строку к центру внутри stage. scrollIntoView не
    // используем: он прокручивает и сам dialog, обрезая заголовок.
    if (active && el.lyricsDlg && el.lyricsDlg.open && el.lyrStage) {
      var stage = el.lyrStage;
      var top = active.offsetTop - stage.clientHeight / 2 + active.offsetHeight / 2;
      stage.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    }
    highlightNowLyrics();
    updateInlineLine();
  }

  var ALARM_DAYS = [[1, 'Пн'], [2, 'Вт'], [3, 'Ср'], [4, 'Чт'],
                    [5, 'Пт'], [6, 'Сб'], [7, 'Вс']];
  var alarmDays = new Set([1, 2, 3, 4, 5]);

  function alarmPad(value) {
    return (value < 10 ? '0' : '') + value;
  }

  function scrollAlarmTimeList(list) {
    if (!list) return;
    var selected = list.querySelector('[aria-selected="true"]');
    if (!selected) return;
    list.scrollTop = Math.max(0, selected.offsetTop - list.clientHeight / 2
      + selected.offsetHeight / 2);
  }

  function renderAlarmTime() {
    if (el.alarmTimeValue) {
      el.alarmTimeValue.textContent = alarmPad(State.alarmHour) + ':'
        + alarmPad(State.alarmMinute);
    }
    [el.alarmHours, el.alarmMinutes].forEach(function (list) {
      if (!list) return;
      Array.prototype.forEach.call(list.children, function (button) {
        button.setAttribute('aria-selected',
          button.dataset.value === String(list === el.alarmHours
            ? State.alarmHour : State.alarmMinute) ? 'true' : 'false');
      });
    });
  }

  function buildAlarmTimeLists() {
    if (!el.alarmHours || el.alarmHours.childElementCount) return;
    var hour, minute;
    for (hour = 0; hour < 24; hour += 1) {
      (function (value) {
        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'alarm-time-item';
        button.dataset.value = String(value);
        button.textContent = alarmPad(value);
        button.addEventListener('click', function () {
          State.alarmHour = value;
          renderAlarmTime();
          scrollAlarmTimeList(el.alarmHours);
        });
        el.alarmHours.appendChild(button);
      }(hour));
    }
    for (minute = 0; minute < 60; minute += 1) {
      (function (value) {
        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'alarm-time-item';
        button.dataset.value = String(value);
        button.textContent = alarmPad(value);
        button.addEventListener('click', function () {
          State.alarmMinute = value;
          renderAlarmTime();
          scrollAlarmTimeList(el.alarmMinutes);
        });
        el.alarmMinutes.appendChild(button);
      }(minute));
    }
    renderAlarmTime();
  }

  function openAlarmTime() {
    buildAlarmTimeLists();
    renderAlarmTime();
    if (el.alarmTimePop) el.alarmTimePop.hidden = false;
    scrollAlarmTimeList(el.alarmHours);
    scrollAlarmTimeList(el.alarmMinutes);
  }

  function closeAlarmTime() {
    if (el.alarmTimePop) el.alarmTimePop.hidden = true;
  }

  function updateAlarmStationName() {
    if (!el.alarmStationName) return;
    el.alarmStationName.textContent = State.alarmStation
      ? (State.alarmStation.name || State.alarmStation.query || 'Станция')
      : 'Выберите станцию';
  }

  function renderAlarmStationList() {
    if (!el.alarmStationList) return;
    el.alarmStationList.innerHTML = '';
    (State.alarmStations || []).forEach(function (station) {
      var row = document.createElement('button');
      row.type = 'button';
      row.className = 'alarm-station-item';
      row.textContent = station.name + (station.custom ? ' · своя' : '');
      row.setAttribute('aria-selected',
        State.alarmStation && State.alarmStation.name === station.name ? 'true' : 'false');
      row.addEventListener('click', function () {
        State.alarmStation = station;
        updateAlarmStationName();
        el.alarmStationList.hidden = true;
      });
      el.alarmStationList.appendChild(row);
    });
    if (!State.alarmStations.length) {
      var note = document.createElement('div');
      note.className = 'alarm-station-item';
      note.textContent = 'Станции не загрузились — введите вручную';
      el.alarmStationList.appendChild(note);
    }
  }

  function loadAlarmStations() {
    if (State.alarmStations.length) {
      renderAlarmStationList();
      updateAlarmStationName();
      return Promise.resolve();
    }
    return cgi('radio.py', {}, { timeout: 15000, silent: true }).then(function (data) {
      State.alarmStations = data.stations || [];
      if (!State.alarmStation) {
        var preferred = State.alarmStations.filter(function (station) {
          return /европа/i.test(station.name || '');
        })[0];
        State.alarmStation = preferred || State.alarmStations[0] || null;
      }
      renderAlarmStationList();
      updateAlarmStationName();
    }).catch(function () {});
  }

  function setAlarmRepeat(repeat) {
    State.alarmRepeat = !!repeat;
    Array.prototype.forEach.call(document.querySelectorAll('[data-repeat]'), function (button) {
      button.setAttribute('aria-pressed',
        button.dataset.repeat === (State.alarmRepeat ? '1' : '0') ? 'true' : 'false');
    });
    if (el.alarmDays) el.alarmDays.hidden = !State.alarmRepeat;
    if (el.alarmRepeatHint) {
      el.alarmRepeatHint.textContent = State.alarmRepeat
        ? 'Повторять: выберите дни недели'
        : 'Сработает один раз и выключится';
    }
  }

  function loadAlarmSounds() {
    if (State.alarmSounds.length) {
      renderAlarmSoundList();
      updateAlarmSoundName();
      return Promise.resolve();
    }
    return cgi('sounds.py', {}, { timeout: 20000, silent: true }).then(function (data) {
      State.alarmSounds = data.custom || [];
      if (!State.alarmSound) State.alarmSound = State.alarmSounds[0] || null;
      renderAlarmSoundList();
      updateAlarmSoundName();
    }).catch(function () {});
  }

  function updateAlarmSoundName() {
    if (!el.alarmSoundName) return;
    el.alarmSoundName.textContent = State.alarmSound
      ? State.alarmSound.name : 'Выберите свой звук';
  }

  function renderAlarmSoundList() {
    if (!el.alarmSoundList) return;
    el.alarmSoundList.innerHTML = '';
    (State.alarmSounds || []).forEach(function (sound) {
      var row = document.createElement('button');
      row.type = 'button';
      row.className = 'alarm-station-item';
      row.textContent = sound.name;
      row.setAttribute('aria-selected',
        State.alarmSound && State.alarmSound.id === sound.id ? 'true' : 'false');
      row.addEventListener('click', function () {
        State.alarmSound = sound;
        updateAlarmSoundName();
        el.alarmSoundList.hidden = true;
      });
      el.alarmSoundList.appendChild(row);
    });
    if (!State.alarmSounds.length) {
      var note = document.createElement('div');
      note.className = 'alarm-station-item';
      note.textContent = 'Сначала добавьте звук: «Система» → «Звуки»';
      el.alarmSoundList.appendChild(note);
    }
  }

  function setAlarmMode(mode) {
    State.alarmMode = mode === 'query' || mode === 'music' || mode === 'sound'
      ? mode : 'radio';
    Array.prototype.forEach.call(document.querySelectorAll('[data-amode]'), function (button) {
      button.setAttribute('aria-pressed', button.dataset.amode === State.alarmMode ? 'true' : 'false');
    });
    if (el.alarmRadioBox) el.alarmRadioBox.hidden = State.alarmMode !== 'radio';
    if (el.alarmMusicBox) el.alarmMusicBox.hidden = State.alarmMode !== 'music';
    if (el.alarmSoundBox) el.alarmSoundBox.hidden = State.alarmMode !== 'sound';
    if (el.alarmText) el.alarmText.hidden = State.alarmMode !== 'query';
  }

  function alarmDaysText(days) {
    if (!days || !days.length) return 'Один раз';
    var sorted = days.slice().sort();
    var key = sorted.join(',');
    if (key === '1,2,3,4,5') return 'Пн–Пт';
    if (key === '6,7') return 'Сб, Вс';
    if (sorted.length === 7) return 'Каждый день';
    return sorted.map(function (d) {
      return (ALARM_DAYS[d - 1] || ['', ''])[1];
    }).join(', ');
  }

  function renderAlarmDays() {
    if (!el.alarmDays) return;
    el.alarmDays.innerHTML = '';
    ALARM_DAYS.forEach(function (pair) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'chip';
      button.textContent = pair[1];
      button.setAttribute('aria-pressed', alarmDays.has(pair[0]) ? 'true' : 'false');
      button.addEventListener('click', function () {
        if (alarmDays.has(pair[0])) alarmDays.delete(pair[0]);
        else alarmDays.add(pair[0]);
        button.setAttribute('aria-pressed', alarmDays.has(pair[0]) ? 'true' : 'false');
      });
      el.alarmDays.appendChild(button);
    });
  }

  function renderAlarmRinging(state) {
    if (!el.alarmRinging) return;
    var ringing = !!(state && state.ringing);
    el.alarmRinging.hidden = !ringing;
    if (ringing && el.alarmRingLabel) {
      el.alarmRingLabel.textContent = state.label || 'Будильник';
    }
  }

  function renderAlarmList(alarms) {
    if (!el.alarmList) return;
    el.alarmList.innerHTML = '';
    if (!alarms || !alarms.length) {
      var empty = document.createElement('div');
      empty.className = 'alarm-empty';
      empty.textContent = 'Пока нет будильников — нажмите «Добавить».';
      el.alarmList.appendChild(empty);
      return;
    }
    alarms.slice().sort(function (a, b) {
      return String(a.time).localeCompare(String(b.time));
    }).forEach(function (alarm) {
      var row = document.createElement('div');
      row.className = 'alarm-item' + (alarm.enabled ? '' : ' off');
      var time = document.createElement('div');
      time.className = 'alarm-time';
      time.textContent = alarm.time || '--:--';
      var meta = document.createElement('div');
      meta.className = 'alarm-meta';
      var what = document.createElement('div');
      what.className = 'alarm-what';
      var prefix = alarm.mode === 'query' ? 'Алиса: '
        : alarm.mode === 'music' ? 'Музыка: '
        : alarm.mode === 'sound' ? 'Звук: ' : 'Радио: ';
      what.textContent = prefix + (alarm.label || alarm.text || '');
      var when = document.createElement('div');
      when.className = 'alarm-when';
      when.textContent = (alarm.once ? 'Один раз' : alarmDaysText(alarm.days)) +
        (alarm.enabled ? '' : ' · выключен');
      meta.appendChild(what);
      meta.appendChild(when);
      var actions = document.createElement('div');
      actions.className = 'alarm-actions';
      var toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'chip';
      toggle.textContent = alarm.enabled ? 'вкл' : 'выкл';
      toggle.setAttribute('aria-pressed', alarm.enabled ? 'true' : 'false');
      toggle.addEventListener('click', function () {
        alarmToggle(alarm.id, !alarm.enabled);
      });
      var test = document.createElement('button');
      test.type = 'button';
      test.className = 'btn sm ghost';
      test.textContent = 'Тест';
      test.addEventListener('click', function () { alarmTest(alarm.id); });
      var remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'btn sm ghost';
      remove.textContent = '×';
      remove.title = 'Удалить';
      remove.addEventListener('click', function () { alarmDelete(alarm.id); });
      actions.appendChild(toggle);
      actions.appendChild(test);
      actions.appendChild(remove);
      row.appendChild(time);
      row.appendChild(meta);
      row.appendChild(actions);
      el.alarmList.appendChild(row);
    });
  }

  function loadAlarms(silent) {
    return cgi('alarm.py', {}, { timeout: 15000, silent: !!silent }).then(function (data) {
      State.alarms = data.alarms || [];
      renderAlarmList(data.alarms || []);
      renderAlarmRinging(data.state || {});
      syncHomeAlarm();
      var browserTz = browserTimezone();
      var savedTz = data.timezone || '';
      if (el.alarmTz) {
        el.alarmTz.textContent = 'Время по поясу ' + (savedTz || browserTz || 'станции');
      }
      // Будильник должен звонить по местному времени браузера. Пояс задаём
      // только один раз — при первом открытии, когда в alarms.json его ещё
      // нет. Иначе второе устройство в другом поясе молча сдвигало бы все
      // будильники.
      if (browserTz && !savedTz && !State.alarmTzSynced) {
        State.alarmTzSynced = true;
        cgi('alarm.py', { timezone: browserTz }, { timeout: 10000, silent: true })
          .then(function () { loadAlarms(true); })
          .catch(function () { State.alarmTzSynced = false; });
      }
      return data;
    }).catch(function (err) {
      if (!silent) toast('Будильники: ' + err.message, 'bad');
    });
  }

  function alarmToggle(id, enabled) {
    return cgi('alarm.py', { toggle: id, enabled: enabled ? 1 : 0 }, { timeout: 15000 })
      .then(function (data) { renderAlarmList(data.alarms || []); })
      .catch(function (err) { toast('Будильник: ' + err.message, 'bad'); });
  }

  function alarmDelete(id) {
    return cgi('alarm.py', { delete: id }, { timeout: 15000 })
      .then(function (data) {
        renderAlarmList(data.alarms || []);
        toast('Будильник удалён', 'ok');
      }).catch(function (err) { toast('Будильник: ' + err.message, 'bad'); });
  }

  function alarmTest(id) {
    return cgi('alarm.py', { test: id }, { timeout: 15000 }).then(function () {
      toast('Проверяю будильник — прозвучит через пару секунд', 'ok');
      setTimeout(function () { loadAlarms(true); }, 3000);
    }).catch(function (err) { toast('Будильник: ' + err.message, 'bad'); });
  }

  function alarmAdd() {
    var custom = (el.alarmCustomStation && el.alarmCustomStation.value || '').trim();
    var phrase = (el.alarmText && el.alarmText.value || '').trim();
    var music = (el.alarmMusicText && el.alarmMusicText.value || '').trim();
    var text;
    if (State.alarmMode === 'query') text = phrase;
    else if (State.alarmMode === 'music') text = music || 'мою волну';
    else if (State.alarmMode === 'sound') {
      text = State.alarmSound ? String(State.alarmSound.id || '') : '';
    } else text = custom || (State.alarmStation
      && (State.alarmStation.query || State.alarmStation.name)) || '';
    if (!text) {
      toast(State.alarmMode === 'query' ? 'Введите фразу для Алисы'
        : State.alarmMode === 'sound' ? 'Выберите свой звук'
        : 'Выберите станцию или введите свою', 'warn');
      return;
    }
    var payload = {
      time: alarmPad(State.alarmHour) + ':' + alarmPad(State.alarmMinute),
      mode: State.alarmMode,
      text: text,
      days: State.alarmRepeat ? Array.from(alarmDays) : [],
      once: !State.alarmRepeat,
      label: State.alarmMode === 'sound' && State.alarmSound
        ? String(State.alarmSound.name || '') : '',
      volume: parseInt(el.alarmVolume.value, 10) || 40,
      ramp: parseInt(el.alarmRamp.value, 10) || 0,
      stop_after: parseInt(el.alarmStop.value, 10) || 0,
      snooze: parseInt(el.alarmSnooze.value, 10) || 5
    };
    if (State.alarmRepeat && !alarmDays.size) {
      toast('Выберите дни недели или режим «Один раз»', 'warn');
      return;
    }
    return cgi('alarm.py', { add: payload }, { timeout: 15000 }).then(function (data) {
      renderAlarmList(data.alarms || []);
      if (el.alarmCustomStation) el.alarmCustomStation.value = '';
      if (el.alarmText) el.alarmText.value = '';
      if (el.alarmDlg && el.alarmDlg.open) el.alarmDlg.close();
      toast('Будильник добавлен', 'ok');
    }).catch(function (err) { toast('Будильник: ' + err.message, 'bad'); });
  }

  function alarmDismiss() {
    return cgi('alarm.py', { dismiss: 1 }, { timeout: 15000 }).then(function () {
      setTimeout(function () { loadAlarms(true); }, 1200);
    });
  }

  function alarmSnooze() {
    return cgi('alarm.py', { snooze: 1 }, { timeout: 15000 }).then(function () {
      toast('Будильник отложен', 'ok');
      setTimeout(function () { loadAlarms(true); }, 1200);
    });
  }

  function playQueueItem(track) {
    var phrase = [track.artist, track.title].filter(Boolean).join(' ').trim();
    if (!phrase) return;
    toast('Включаю: ' + track.title, 'ok');
    cgi('musicapi.py', { play: phrase }, { timeout: 25000 }).catch(function (err) {
      toast('Включить: ' + err.message, 'bad');
    });
  }

  function renderQueue(data) {
    if (!el.queueList) return;
    el.queueName.textContent = data.title || 'Очередь';
    el.queueList.innerHTML = '';
    var tracks = data.tracks || [];
    if (!tracks.length) {
      var note = document.createElement('div');
      note.className = 'q-note';
      note.textContent = State.queueTab === 'similar'
        ? 'Похожих для этого трека не нашлось.'
        : State.queueTab === 'favorites'
          ? 'В избранном пока пусто.'
          : 'Пусто — для радио очередь ограничена соседними треками.';
      el.queueList.appendChild(note);
      return;
    }
    tracks.forEach(function (track) {
      var row = document.createElement('button');
      row.type = 'button';
      row.className = 'queue-row';
      if (track.id && track.id === State.mediaId) row.classList.add('current');
      if (track.cover) {
        var img = document.createElement('img');
        img.src = track.cover;
        img.alt = '';
        img.loading = 'lazy';
        row.appendChild(img);
      } else {
        var cover = document.createElement('span');
        cover.className = 'q-cover';
        cover.textContent = '♪';
        row.appendChild(cover);
      }
      var text = document.createElement('span');
      text.className = 'q-text';
      var title = document.createElement('span');
      title.className = 'q-t';
      title.textContent = track.title || 'Без названия';
      var artist = document.createElement('span');
      artist.className = 'q-a';
      artist.textContent = track.artist || '';
      text.appendChild(title);
      text.appendChild(artist);
      row.appendChild(text);
      var duration = document.createElement('span');
      duration.className = 'q-d';
      duration.textContent = track.duration ? fmtTime(track.duration) : '';
      row.appendChild(duration);
      row.addEventListener('click', function () { playQueueItem(track); });
      el.queueList.appendChild(row);
    });
  }

  function loadQueueTab(tab) {
    State.queueTab = tab || 'queue';
    Array.prototype.forEach.call(document.querySelectorAll('[data-qtab]'), function (button) {
      button.setAttribute('aria-pressed', button.dataset.qtab === State.queueTab ? 'true' : 'false');
    });
    if (el.queueKicker) {
      el.queueKicker.textContent = State.queueTab === 'favorites' ? 'Ваша коллекция'
        : State.queueTab === 'similar' ? 'Похоже на этот трек' : 'Сейчас играет';
    }
    if (!el.queueList) return;
    el.queueList.innerHTML = '<div class="q-note">Загружаю…</div>';
    var payload = {};
    payload[State.queueTab] = 1;
    return cgi('musicapi.py', payload, { timeout: 25000 }).then(renderQueue).catch(function (err) {
      el.queueList.innerHTML = '';
      var note = document.createElement('div');
      note.className = 'q-note';
      note.textContent = 'Не получилось: ' + err.message;
      el.queueList.appendChild(note);
    });
  }

  function openQueue(fromYm) {
    if (el.queueDlg) {
      el.queueDlg.classList.toggle('ym-look', !!fromYm);
      if (!el.queueDlg.open) el.queueDlg.showModal();
    }
    loadQueueTab(State.queueTab || 'queue');
  }

  var lyricsCloseTimer = null;

  function closeLyricsDialog() {
    if (!el.lyricsDlg || !el.lyricsDlg.open || el.lyricsDlg.classList.contains('closing')) return;
    el.lyricsDlg.classList.add('closing');
    clearTimeout(lyricsCloseTimer);
    lyricsCloseTimer = setTimeout(function () {
      if (el.lyricsDlg && el.lyricsDlg.open) el.lyricsDlg.close();
      if (el.lyricsDlg) el.lyricsDlg.classList.remove('closing');
    }, 160);
  }

  function openLyrics(fromYm) {
    if (!State.mediaTitle) {
      toast('Сейчас ничего не играет', 'warn');
      return;
    }
    if (el.lyricsDlg) el.lyricsDlg.classList.toggle('ym-look', !!fromYm);
    if (el.lyrBg) {
      el.lyrBg.style.backgroundImage = State.mediaCover
        ? 'url("' + State.mediaCover + '")' : 'none';
    }
    State.lyricsActive = null;
    if (el.lyricsBox) el.lyricsBox.style.transform = '';
    if (el.lyricsDlg && !el.lyricsDlg.open) {
      clearTimeout(lyricsCloseTimer);
      el.lyricsDlg.classList.remove('closing');
      el.lyricsDlg.showModal();
    }
    syncLyricsPlayer();
    if (State.lyricsLines.length) highlightLyrics();
    else loadLyrics();
  }

  function setLikeUI(liked) {
    State.liked = !!liked;
    if (!el.btnLike) return;
    el.btnLike.setAttribute('aria-pressed', State.liked ? 'true' : 'false');
    el.btnLike.classList.toggle('on', State.liked);
    el.btnLike.setAttribute('title', State.liked ? 'Убрать из избранного' : 'Нравится');
    el.btnLike.setAttribute('aria-label', State.liked ? 'Убрать из избранного' : 'Нравится');
  }

  function loadLiked() {
    if (!State.mediaTitle) {
      setLikeUI(false);
      return Promise.resolve();
    }
    return cgi('musicapi.py', {}, { timeout: 20000, silent: true }).then(function (data) {
      if (data && data.track && State.mediaId && data.track.id !== State.mediaId) return;
      setLikeUI(data && data.liked);
    }).catch(function () { setLikeUI(false); });
  }

  function toggleLike() {
    if (!State.mediaTitle) {
      toast('Сейчас ничего не играет', 'warn');
      return;
    }
    var next = !State.liked;
    setLikeUI(next);
    return cgi('musicapi.py', { like: next ? 1 : 0 }, { timeout: 25000 })
      .then(function (data) {
        setLikeUI(data && data.liked);
        toast(next ? 'Добавлено в «Мне нравится»' : 'Убрано из избранного', 'ok');
      }).catch(function (err) {
        setLikeUI(!next);
        toast('Лайк: ' + err.message, 'bad');
      });
  }

  function dislikeTrack() {
    if (!State.mediaTitle) {
      toast('Сейчас ничего не играет', 'warn');
      return;
    }
    return cgi('musicapi.py', { dislike: 1 }, { timeout: 25000 })
      .then(function () {
        setLikeUI(false);
        toast('Больше не буду предлагать этот трек', 'ok');
      }).catch(function (err) {
        toast('Дизлайк: ' + err.message, 'bad');
      });
  }

  function updateInlineLine() {
    if (!el.lyricsNow || !el.lyricsNowText) return;
    var active = State.lyricsActive;
    var first = State.lyricsLines && State.lyricsLines.length ? State.lyricsLines[0] : null;
    var text = active ? (active.textContent || '')
      : (first ? (first.textContent || '') : '');
    var show = State.lyricsInline && !!text && State.playerKind === 'Track';
    el.lyricsNow.hidden = !show;
    if (!show) {
      el.lyricsNowText.textContent = '';
      el.lyricsNowText.dataset.text = '';
      return;
    }
    if (el.lyricsNowText.dataset.text !== text) {
      el.lyricsNowText.dataset.text = text;
      el.lyricsNowText.textContent = text;
      el.lyricsNow.classList.remove('swap');
      void el.lyricsNow.offsetWidth;
      el.lyricsNow.classList.add('swap');
    }
  }

  function loadLyrics(silent) {
    if (!State.mediaTitle) {
      if (!silent) toast('Сейчас ничего не играет', 'warn');
      return;
    }
    if (el.lyricsStatus && el.lyricsDlg && el.lyricsDlg.open) {
      el.lyricsStatus.textContent = 'ищу…';
    }
    return cgi('lyrics.py', {
      title: State.mediaTitle,
      artist: State.mediaArtist,
      duration: Math.round(State.mediaDuration || 0)
    }, { timeout: 20000 }).then(renderLyrics).catch(function (err) {
      if (el.lyricsStatus) el.lyricsStatus.textContent = '';
      if (!silent) toast('Текст песни: ' + err.message, 'bad');
    });
  }

  function setLyricsInline(on) {
    State.lyricsInline = !!on;
    store.set('lyricsInline', State.lyricsInline ? 1 : 0);
    if (el.lyricsInline) el.lyricsInline.checked = State.lyricsInline;
    if (State.lyricsInline && !State.lyricsLines.length) loadLyrics(true);
    updateInlineLine();
  }

  function seekMedia(value) {
    var duration = State.mediaDuration || 0;
    if (!duration) return;
    var position = Math.round((value / 1000) * duration);
    State.seeking = false;
    // Ползунок и прогресс двигаются сразу, подтверждение — в фоне.
    State.pendingSeek = { target: position, until: Date.now() + 12000 };
    State.progressBase = position;
    State.progressAt = Date.now() / 1000;
    State.mediaProgress = position;
    updateMediaProgress();
    el.mediaKind.textContent = 'перематываю…';
    return cgi('media.py', { action: 'seek', position: position }, { timeout: 12000 })
      .then(function () {
        // Не ждём станцию: один фоновый опрос для подтверждения.
        setTimeout(function () {
          refreshPlayer(true, true).then(function () {
            el.mediaKind.textContent = 'сейчас музыка';
          });
        }, 900);
      })
      .catch(function (err) {
        State.pendingSeek = null;
        el.mediaKind.textContent = 'перемотка не удалась';
        toast('Перемотка: ' + err.message, 'bad');
      });
  }

  function setPlaying(value) {
    var was = State.playing;
    State.playing = !!value;
    var use = el.btnPlay.querySelector('use');
    use.setAttribute('href', State.playing ? '#i-pause' : '#i-play');
    el.btnPlay.setAttribute('aria-label', State.playing ? 'Пауза' : 'Воспроизвести');
    if (was !== State.playing && State.lyricsLines.length) {
      State.lyricsActive = null;
      updateMediaProgress();
    }
    if (was !== State.playing && State.playing) {
      stopCustomRingForNative();
    }
    if (was && !State.playing && !State.ringMusicActive && State.ledMode === 'off') {
      setTimeout(ringOffBurst, 350);
    }
    if (was !== State.playing) syncMusicRing();
  }

