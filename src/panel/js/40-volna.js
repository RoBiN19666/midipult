  /* ─────────── волна сервисов ─────────── */
  function waveStop() {
    return cgi('wave.py', { action: 'stop' }, { timeout: 30000 }).then(function () {
      toast('Волна остановлена', 'ok');
      if (State.waveService === 'zvuk' && typeof zvukShowNow === 'function') zvukShowNow(null);
      else if (typeof extNow === 'function') extNow(null);
      State.waveService = '';
      State.waveKey = '';
      var kind = document.getElementById('mediaKind');
      if (kind) kind.textContent = '';
      if (typeof extSetStatus === 'function') extSetStatus('Волна остановлена');
      if (typeof refreshPlayer === 'function') refreshPlayer(true, true);
    }).catch(function (err) {
      toast('Волна: ' + err.message, 'bad');
    });
  }

  function extWave() {
    var service = el.extWaveService ? el.extWaveService.value : 'youtube';
    var mood = el.extMood ? el.extMood.value : '';
    if (typeof extSetStatus === 'function') extSetStatus('Запускаю волну…');
    return cgi('wave.py', {
      action: 'start', service: service, mode: 'wave', mood: mood
    }, { timeout: 120000 }).then(function (data) {
      if (typeof extSetStatus === 'function') {
        extSetStatus(data.title ? ('Играет: ' + data.title) : 'Волна запущена', 'ok');
      }
      if (typeof refreshPlayer === 'function') refreshPlayer(true, true);
    }).catch(function (err) {
      if (typeof extSetStatus === 'function') extSetStatus('Волна: ' + err.message, 'bad');
      toast('Волна: ' + err.message, 'bad');
    });
  }
