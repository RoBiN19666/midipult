  /* ─────────── микрофон ─────────── */
  var listening = false;
  var listenCtrl = null;

  function extractTranscript(data) {
    if (!data || typeof data !== 'object') return '';
    var candidates = [
      data.transcript, data.text,
      data.result && data.result.transcript, data.result && data.result.text,
      data.response && data.response.transcript
    ];
    for (var i = 0; i < candidates.length; i++) {
      if (typeof candidates[i] === 'string' && candidates[i].trim()) return candidates[i].trim();
    }
    return '';
  }

  function setTranscript(text, isEmpty) {
    if (!el.transcript) return;
    el.transcript.textContent = text;
    el.transcript.classList.toggle('empty', !!isEmpty);
  }

  function listen() {
    if (!el.btnMic || !el.transcript) return;
    if (listening) {
      if (listenCtrl) listenCtrl.abort();
      return;
    }
    listening = true;
    listenCtrl = new AbortController();
    var wasPlaying = (typeof State.playing === 'boolean') ? State.playing : null;

    el.btnMic.classList.add('listening');
    el.btnCancelListen.hidden = false;
    el.micHint.textContent = 'Записываю… скажите «Алиса, …»';
    setTranscript('…', false);
    el.btnRepeat.disabled = true;

    var started = Date.now();
    var timer = setInterval(function () {
      el.micTimer.textContent = ((Date.now() - started) / 1000).toFixed(1) + ' с';
    }, 100);

    busyStart();

    luna('/api/alice/recognize', {}, { timeout: 120000, signal: listenCtrl.signal }).then(function (data) {
      var text = extractTranscript(data);
      if (text) {
        setTranscript(text, false);
        el.btnRepeat.disabled = false;
        toast('Распознано: ' + text, 'ok');
      } else {
        setTranscript('Не расслышал. Скажите фразу с обращением «Алиса, …».', true);
        toast('Пустой ответ микрофона', 'warn');
      }
    }).catch(function (err) {
      var msg = String((err && err.message) || '');
      if (/timeout waiting for recognition|Превышено время|timeout/i.test(msg)) {
        setTranscript('Не расслышал. Скажите фразу с обращением «Алиса, …».', true);
        toast('Не расслышал', 'warn');
      } else {
        setTranscript('Не удалось распознать: ' + msg, true);
        if (msg !== 'Отменено') toast('Микрофон: ' + msg, 'bad');
      }
    }).finally(function () {
      clearInterval(timer);
      listening = false;
      listenCtrl = null;
      el.btnMic.classList.remove('listening');
      el.btnCancelListen.hidden = true;
      el.micHint.textContent = 'Запись фразы · скажите «Алиса, …»';
      el.micTimer.textContent = '';
      busyEnd();
      if (wasPlaying !== null) {
        setTimeout(function () {
          refreshPlayer(true).then(function () {
            if (typeof State.playing === 'boolean' && State.playing !== wasPlaying) {
              cgi('media.py', { action: wasPlaying ? 'play' : 'pause' },
                { timeout: 9000, silent: true }).catch(function () {});
              setPlaying(wasPlaying);
            }
          });
        }, 800);
      }
    });
  }

  function sendCommand(text) {
    var value = (text || '').trim();
    if (!value) { toast('Введите текст команды', 'warn'); return Promise.resolve(); }
    return withBusy(null, function () {
      return cgi('command.py', { text: value }, { timeout: 30000 }).then(function (data) {
        toast(data && data.confirmed ? 'Алиса приняла команду' : 'Команда отправлена', 'ok');
      }).catch(function (err) {
        toast('Команда: ' + err.message, 'bad');
        if (err.data && err.data.hint) log('command', 'hint', err.data.hint, true);
      });
    });
  }

