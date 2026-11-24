  /* ─────────── Сбер Звук ─────────── */
  function zvukTime(seconds) {
    var s = Math.max(0, Math.round(Number(seconds) || 0));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  function zvukSetStatus(text, kind) {
    if (!el.zvukStatus) return;
    el.zvukStatus.textContent = text;
    el.zvukStatus.className = 'zvuk-status' + (kind ? ' ' + kind : '');
  }

  function zvukRender(tracks) {
    if (!el.zvukResults) return;
    el.zvukResults.textContent = '';
    if (!tracks || !tracks.length) {
      var empty = document.createElement('div');
      empty.className = 'zvuk-empty';
      empty.textContent = 'Ничего не найдено';
      el.zvukResults.appendChild(empty);
      return;
    }
    tracks.forEach(function (track) {
      var row = document.createElement('button');
      row.type = 'button';
      row.className = 'zvuk-track';
      row.title = 'Включить на станции';
      var img = document.createElement('img');
      img.alt = '';
      img.loading = 'lazy';
      if (track.cover) img.src = track.cover;
      var info = document.createElement('div');
      var title = document.createElement('div');
      title.className = 'zt-title';
      title.textContent = track.title || 'Без названия';
      var artist = document.createElement('div');
      artist.className = 'zt-artist';
      artist.textContent = track.artists || track.artist || '';
      info.appendChild(title);
      info.appendChild(artist);
      var time = document.createElement('span');
      time.className = 'zt-time';
      time.textContent = track.duration ? zvukTime(track.duration) : '';
      var play = document.createElement('span');
      play.className = 'zt-play';
      play.textContent = '▶';
      row.appendChild(img);
      row.appendChild(info);
      row.appendChild(time);
      row.appendChild(play);
      row.addEventListener('click', function () { zvukPlay(track); });
      el.zvukResults.appendChild(row);
    });
  }

  function zvukShowNow(track) {
    if (!el.zvukNow) return;
    el.zvukNow.textContent = '';
    if (!track) return;
    var b = document.createElement('b');
    b.textContent = track.title || 'Сбер Звук';
    var artist = document.createElement('div');
    artist.textContent = track.artist || '';
    var stop = document.createElement('button');
    stop.type = 'button';
    stop.className = 'btn sm ghost';
    stop.textContent = 'Остановить';
    stop.style.marginTop = '8px';
    stop.addEventListener('click', zvukStop);
    el.zvukNow.appendChild(b);
    el.zvukNow.appendChild(artist);
    el.zvukNow.appendChild(stop);
  }

  function zvukPlay(track) {
    if (!track || !track.id) return;
    zvukSetStatus('Загружаю трек и запускаю на станции…');
    zvukShowNow({ title: track.title, artist: track.artists || track.artist });
    cgi('zvuk.py', {
      action: 'play', id: track.id, title: track.title || '',
      artist: track.artists || track.artist || '', cover: track.cover || '',
      duration: track.duration || 0
    }, { timeout: 120000 })
      .then(function (data) {
        zvukSetStatus('Играет: ' + ((data.track && data.track.title) || track.title || ''), 'ok');
        zvukShowNow(data.track || track);
        // Запустили Звук — чужой «сейчас играет» у YouTube/SoundCloud убираем.
        if (typeof extYieldToOther === 'function') extYieldToOther();
      })
      .catch(function (err) {
        zvukSetStatus('Ошибка: ' + err.message, 'bad');
        toast('Сбер Звук: ' + err.message, 'bad');
      });
  }

  function zvukStop() {
    cgi('zvuk.py', { action: 'stop' }, { timeout: 12000, silent: true }).catch(function () {});
    cgi('media.py', { action: 'pause' }, { timeout: 12000 })
      .then(function () { zvukShowNow(null); zvukSetStatus('Остановлено'); })
      .catch(function (err) { zvukSetStatus('Ошибка остановки: ' + err.message, 'bad'); });
  }

  function zvukLoadStatus() {
    return cgi('zvuk.py', { action: 'status' }, { timeout: 12000, silent: true })
      .then(function (data) {
        zvukSetStatus(data.has_token ? 'Аккаунт подключён' : 'Нужен токен — анонимно только 30 секунд',
          data.has_token ? 'ok' : 'warn');
        setProvDot('zvuk', data.has_token ? 'ok' : 'warn');
        if (data.track && data.track.id) zvukShowNow(data.track);
      })
      .catch(function () { zvukSetStatus('Сбер Звук недоступен', 'bad'); setProvDot('zvuk', 'bad'); });
  }

  function zvukSaveToken() {
    var token = (el.zvukToken && el.zvukToken.value || '').trim();
    if (!token) { zvukSetStatus('Вставьте токен', 'bad'); return; }
    zvukSetStatus('Проверяю токен…');
    cgi('zvuk.py', { action: 'token', token: token }, { timeout: 45000 })
      .then(function () {
        if (el.zvukToken) el.zvukToken.value = '';
        zvukSetStatus('Аккаунт подключён', 'ok');
        toast('Сбер Звук подключён', 'ok');
      })
      .catch(function (err) { zvukSetStatus('Токен не принят: ' + err.message, 'bad'); });
  }

  function zvukSearch() {
    var q = (el.zvukQuery && el.zvukQuery.value || '').trim();
    if (!q) return;
    zvukSetStatus('Ищу…');
    cgi('zvuk.py', { action: 'search', q: q, limit: 15 }, { timeout: 30000 })
      .then(function (data) { zvukRender(data.tracks || []); zvukSetStatus('Найдено: ' + ((data.tracks || []).length)); })
      .catch(function (err) { zvukSetStatus('Ошибка поиска: ' + err.message, 'bad'); });
  }

  function zvukWave() {
    var mood = el.zvukMood ? el.zvukMood.value : '';
    zvukSetStatus('Запускаю волну…');
    return cgi('wave.py', { action: 'start', service: 'zvuk', mode: 'wave', mood: mood },
      { timeout: 90000 })
      .then(function (data) {
        zvukSetStatus(data.title ? ('Играет: ' + data.title) : 'Волна запущена');
        if (typeof refreshPlayer === 'function') refreshPlayer(true, true);
      })
      .catch(function (err) { zvukSetStatus('Волна: ' + err.message, 'bad'); });
  }

