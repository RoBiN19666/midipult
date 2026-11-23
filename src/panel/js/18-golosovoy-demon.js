  /* ─────────── голосовой демон ─────────── */
  function applyMicMode(mode) {
    if (!el.voiceMicMode || !mode) return;
    var known = Array.prototype.some.call(el.voiceMicMode.options, function (opt) {
      return opt.value === mode;
    });
    if (!known) {
      var extra = document.createElement('option');
      extra.value = mode;
      extra.textContent = mode;
      el.voiceMicMode.appendChild(extra);
    }
    Array.prototype.forEach.call(el.voiceMicMode.options, function (opt) {
      opt.selected = opt.value === mode;
    });
    el.voiceMicMode.value = mode;
    try { localStorage.setItem('mypult.mic', mode); } catch (e) {}
    // Некоторые браузеры не перерисовывают подпись нативного select,
    // если значение выставлено программно, — повторяем на следующем тике.
    setTimeout(function () {
      if (!el.voiceMicMode) return;
      var index = -1;
      Array.prototype.forEach.call(el.voiceMicMode.options, function (opt, idx) {
        if (opt.value === mode) index = idx;
      });
      if (index >= 0) el.voiceMicMode.selectedIndex = index;
    }, 0);
  }

  function loadVoice() {
    return cgi('voicectl.py', {}, { timeout: 8000, silent: true }).then(function (data) {
      State.voice = data;
      el.btnVoiceDaemon.textContent = data.running ? 'Выключить голосовой пульт' : 'Включить голосовой пульт';
      el.btnVoiceDaemon.setAttribute('aria-pressed', data.running ? 'true' : 'false');
      el.voiceDaemonStatus.textContent = data.running
        ? (data.idle === 'auto' ? 'ждёт сценарии или нейросеть' : 'слушает «Алиса, …»')
        : (data.enabled === false ? 'выключен — микрофон не используется' : 'не запущен');
      if (el.voiceIdleMode && data.idle) el.voiceIdleMode.value = data.idle;
      if (el.voiceMicMode && data.mic_mode) applyMicMode(data.mic_mode);
      if (el.voiceMicMode && !data.mic_mode) {
        var cachedMode = null;
        try { cachedMode = localStorage.getItem('mypult.mic'); } catch (e) {}
        if (cachedMode) applyMicMode(cachedMode);
        cgi('voicecfg.py', {}, { timeout: 6000, silent: true }).then(function (cfg) {
          if (cfg && cfg.mic_mode) applyMicMode(cfg.mic_mode);
        }).catch(function () {});
      }
      if (el.voicePanel) el.voicePanel.classList.toggle('off', !data.running);
      var passive = data.mic_mode === 'alice';
      [el.voiceIdleMode, el.voiceMicMode].forEach(function (select) {
        if (!select) return;
        select.disabled = !data.running || (select === el.voiceIdleMode && passive);
        select.setAttribute('aria-disabled', select.disabled ? 'true' : 'false');
      });
      if (el.voiceMicNote) {
        el.voiceMicNote.textContent = data.mic_mode === 'econom'
          ? 'короткие сессии: Алисе легче, но команда может не попасть в паузу'
          : data.mic_mode === 'alice'
            ? 'пульт не открывает микрофон: забирает фразы, которые уже распознала Алиса'
            : 'сессия не закрывается: Алиса может отвечать медленнее';
      }
      if (el.voiceIdleNote) {
        el.voiceIdleNote.textContent = passive
          ? 'в этом режиме не используется: микрофон открывает Алиса'
          : (data.idle || 'auto') === 'auto'
            ? 'если сценариев и нейросети нет — микрофон не открывается вообще'
            : 'микрофон занят постоянно, пока пульт слушает';
      }
    }).catch(function (err) {
      el.voiceDaemonStatus.textContent = err.message;
    });
  }

  function toggleVoiceDaemon() {
    var start = !(State.voice && State.voice.running);
    return withBusy(el.btnVoiceDaemon, function () {
      return cgi('voicectl.py', start ? { start: 1 } : { stop: 1 }, { timeout: 30000 }).then(function () {
        toast(start ? 'Голосовой пульт включён' : 'Голосовой пульт выключен', 'ok');
        return loadVoice();
      }).catch(function (err) {
        toast('Голос: ' + err.message, 'bad');
      });
    });
  }

  function setVoiceMicMode(mode) {
    if (!mode) return Promise.resolve();
    applyMicMode(mode);
    return cgi('voicecfg.py', { mic_mode: mode }, { timeout: 10000 }).then(function () {
      toast(mode === 'alice' ? 'Пульт слушает фразы Алисы'
        : 'Микрофон слушает непрерывно', 'ok');
      return loadVoice();
    }).catch(function (err) {
      toast('Голос: ' + err.message, 'bad');
      return loadVoice();
    });
  }

  function setVoiceIdleMode(mode) {
    if (!mode) return Promise.resolve();
    return cgi('voicecfg.py', { idle: mode }, { timeout: 10000 }).then(function () {
      toast(mode === 'auto' ? 'Микрофон в простое выключен' : 'Пульт слушает постоянно', 'ok');
      return loadVoice();
    }).catch(function (err) {
      toast('Голос: ' + err.message, 'bad');
      return loadVoice();
    });
  }

