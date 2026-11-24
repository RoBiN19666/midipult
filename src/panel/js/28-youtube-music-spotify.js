  /* ─────────── YouTube Music / Spotify ─────────── */
  function setProvDot(name, kind) {
    var dot = document.querySelector('[data-prov-dot="' + name + '"]');
    if (!dot) return;
    dot.className = 'prov-dot' + (kind ? ' ' + kind : '');
  }

  function initProviders() {
    var tabs = Array.prototype.slice.call(document.querySelectorAll('#provTabs .prov-tab'));
    var panes = Array.prototype.slice.call(document.querySelectorAll('[data-provider-pane]'));
    if (!tabs.length) return;
    function show(name) {
      var found = false;
      tabs.forEach(function (tab) {
        if (tab.hidden) return;
        var on = tab.dataset.provider === name;
        tab.setAttribute('aria-pressed', on ? 'true' : 'false');
        if (on) found = true;
      });
      if (!found) return;
      panes.forEach(function (pane) { pane.hidden = pane.dataset.providerPane !== name; });
      store.set('musicProvider', name);
      // Статус соседнего сервиса мог устареть: обновляем при открытии вкладки.
      if (name === 'zvuk' && typeof zvukLoadStatus === 'function') zvukLoadStatus();
      else if (name === 'ext' && typeof extLoadStatus === 'function') extLoadStatus();
      else if (name === 'spotify' && typeof spotifyLoadStatus === 'function') spotifyLoadStatus();
    }
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        if (tab.disabled) return;
        show(tab.dataset.provider);
      });
    });
    // Сохранённая вкладка могла исчезнуть (например, «VK Музыка»): не
    // оставляем окно сервисов с пустым содержимым.
    var saved = store.get('musicProvider', 'yandex');
    if (saved === 'youtube' || saved === 'soundcloud') saved = 'ext';
    if (!tabs.some(function (tab) { return tab.dataset.provider === saved && !tab.hidden; })) saved = 'yandex';
    show(saved);
    var open = document.getElementById('btnProviderYm');
    if (open) open.addEventListener('click', function () { ymOpen(); });
  }

  function extStatus(node, text, kind) {
    if (!node) return;
    node.textContent = text;
    node.className = 'zvuk-status' + (kind ? ' ' + kind : '');
  }

  function youtubeRender(tracks) {
    if (!el.youtubeResults) return;
    el.youtubeResults.textContent = '';
    if (!tracks || !tracks.length) {
      var empty = document.createElement('div');
      empty.className = 'zvuk-empty';
      empty.textContent = 'Ничего не найдено';
      el.youtubeResults.appendChild(empty);
      return;
    }
    tracks.forEach(function (track) {
      var row = document.createElement('button');
      row.type = 'button';
      row.className = 'zvuk-track';
      var img = document.createElement('img');
      img.alt = '';
      img.loading = 'lazy';
      if (track.cover) img.src = track.cover;
      var info = document.createElement('div');
      var title = document.createElement('div');
      title.className = 'zt-title';
      title.textContent = track.title || 'YouTube Music';
      var artist = document.createElement('div');
      artist.className = 'zt-artist';
      artist.textContent = track.artist || 'YouTube Music';
      info.appendChild(title);
      info.appendChild(artist);
      var play = document.createElement('span');
      play.className = 'zt-play';
      play.textContent = '▶';
      row.appendChild(img);
      row.appendChild(info);
      row.appendChild(play);
      row.addEventListener('click', function () { youtubePlay(track); });
      el.youtubeResults.appendChild(row);
    });
  }

  function youtubeNow(track) {
    if (!el.youtubeNow) return;
    el.youtubeNow.textContent = '';
    if (!track) return;
    var b = document.createElement('b');
    b.textContent = track.title || 'YouTube Music';
    var a = document.createElement('div');
    a.textContent = track.artist || '';
    var stop = document.createElement('button');
    stop.type = 'button';
    stop.className = 'btn sm ghost';
    stop.style.marginTop = '8px';
    stop.textContent = 'Остановить';
    stop.addEventListener('click', function () {
      cgi('media.py', { action: 'pause' }, { timeout: 12000 })
        .then(function () { youtubeNow(null); extStatus(el.youtubeStatus, 'Остановлено'); })
        .catch(function (err) { extStatus(el.youtubeStatus, 'Ошибка: ' + err.message, 'bad'); });
    });
    el.youtubeNow.appendChild(b);
    el.youtubeNow.appendChild(a);
    el.youtubeNow.appendChild(stop);
  }

  function youtubePlay(track) {
    if (!track || !track.id) return;
    extStatus(el.youtubeStatus, 'Готовлю MP3…');
    youtubeNow(track);
    cgi('youtube.py', {
      action: 'play', id: track.id, title: track.title || '',
      artist: track.artist || '', cover: track.cover || ''
    }, { timeout: 240000 })
      .then(function (data) {
        extStatus(el.youtubeStatus, 'Играет: ' + ((data.track && data.track.title) || track.title), 'ok');
        youtubeNow(data.track || track);
      })
      .catch(function (err) {
        extStatus(el.youtubeStatus, 'Ошибка: ' + err.message, 'bad');
        toast('YouTube Music: ' + err.message, 'bad');
      });
  }

  var EXT_LABELS = { youtube: 'YouTube Music', soundcloud: 'SoundCloud' };
  var extSearchSeq = 0;
  var extPrefetched = {};
  var extPrepares = {};
  var extSyncAt = 0;

  function extSyncRemote() {
    if (Date.now() - extSyncAt < 5000) return;
    extSyncAt = Date.now();
    Promise.all([
      cgi('youtube.py', { action: 'status' }, { timeout: 12000, silent: true }).catch(function () { return {}; }),
      cgi('soundcloud.py', { action: 'status' }, { timeout: 12000, silent: true }).catch(function () { return {}; })
    ]).then(function (parts) {
      var yt = parts[0] || {};
      var sc = parts[1] || {};
      var track = (yt.track && yt.track.id && yt.track) || (sc.track && sc.track.id && sc.track);
      if (track) {
        var source = (yt.track && yt.track.id === track.id) ? 'youtube' : 'soundcloud';
        track.source = source;
        if (!State.extTrack || State.extTrack.title !== track.title ||
            State.extTrack.source !== source) {
          extNow(track);
          extApplyPlayer(track, source);
          State.extRemote = true;
        }
      } else if (State.extRemote) {
        // Трек запускали на другом устройстве, а теперь его остановили или
        // включили Яндекс Музыку — убираем чужой now-playing.
        extClearPlayer();
        if (el.extNow) extNow(null);
        State.extRemote = false;
      }
    }).catch(function () {});
  }

  function extPrefetch(track) {
    if (!track || !track.id) return;
    var source = track.source === 'youtube' ? 'youtube' : 'soundcloud';
    var key = source + ':' + track.id;
    if (extPrefetched[key]) return extPrepares[key];
    extPrefetched[key] = true;
    var payload = { action: 'prepare', id: track.id };
    if (source === 'soundcloud') payload.url = track.url;
    var promise = cgi(source === 'youtube' ? 'youtube.py' : 'soundcloud.py', payload,
      { timeout: 90000, silent: true }).catch(function () {});
    extPrepares[key] = promise;
    return promise;
  }

  function extSetStatus(text, kind) {
    extStatus(el.extStatus, text, kind);
  }

  function extSourceBadge(source) {
    var badge = document.createElement('span');
    badge.className = 'ext-src ' + (source === 'youtube' ? 'yt' : 'sc');
    badge.textContent = source === 'youtube' ? 'YouTube Music' : 'SoundCloud';
    badge.title = EXT_LABELS[source] || source;
    return badge;
  }

  function extRender(tracks) {
    if (!el.extResults) return;
    el.extResults.textContent = '';
    if (!tracks || !tracks.length) {
      var empty = document.createElement('div');
      empty.className = 'zvuk-empty';
      empty.textContent = 'Ничего не найдено';
      el.extResults.appendChild(empty);
      return;
    }
    tracks.forEach(function (track) {
      var row = document.createElement('button');
      row.type = 'button';
      row.className = 'zvuk-track';
      var img = document.createElement('img');
      img.alt = '';
      img.loading = 'lazy';
      if (track.cover) img.src = track.cover;
      var info = document.createElement('div');
      var title = document.createElement('div');
      title.className = 'zt-title';
      title.textContent = track.title || EXT_LABELS[track.source] || 'Трек';
      title.appendChild(extSourceBadge(track.source));
      var artist = document.createElement('div');
      artist.className = 'zt-artist';
      artist.textContent = track.artist || EXT_LABELS[track.source] || '';
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
      row.addEventListener('click', function () { extPlay(track); });
      el.extResults.appendChild(row);
    });
  }

  function extNow(track) {
    if (!el.extNow) return;
    el.extNow.textContent = '';
    if (!track) return;
    var b = document.createElement('b');
    b.textContent = track.title || 'Трек';
    var meta = document.createElement('div');
    meta.className = 'ext-now-src';
    meta.textContent = (track.artist ? track.artist + ' · ' : '') +
      (EXT_LABELS[track.source] || '');
    var stop = document.createElement('button');
    stop.type = 'button';
    stop.className = 'btn sm ghost';
    stop.style.marginTop = '8px';
    stop.textContent = 'Остановить';
    stop.addEventListener('click', extStop);
    el.extNow.appendChild(b);
    el.extNow.appendChild(meta);
    el.extNow.appendChild(stop);
  }

  function extStopBackends() {
    return Promise.all([
      cgi('youtube.py', { action: 'stop' }, { timeout: 12000, silent: true }).catch(function () {}),
      cgi('soundcloud.py', { action: 'stop' }, { timeout: 12000, silent: true }).catch(function () {})
    ]);
  }

  function extStop() {
    var kind = document.getElementById('mediaKind');
    if (kind) kind.textContent = '';
    if (State.waveService && State.waveService !== 'zvuk' && typeof waveStop === 'function') {
      extNow(null);
      extSetStatus('Остановлено');
      return waveStop();
    }
    extStopBackends().then(function () {
      return cgi('media.py', { action: 'pause' }, { timeout: 12000 }).catch(function () {});
    }).then(function () {
      extClearPlayer();
      extNow(null);
      extSetStatus('Остановлено');
    });
  }

  function extApplyPlayer(track, source) {
    var label = EXT_LABELS[source] || '';
    State.extTrack = {
      title: track.title || '', artist: track.artist || '',
      cover: track.cover || '', source: source, label: label
    };
    State.extSource = label;
    State.mediaTitle = track.title || '';
    State.mediaArtist = track.artist || '';
    State.mediaCover = track.cover || '';
    if (el.mediaTitle) el.mediaTitle.textContent = State.mediaTitle || 'Трек';
    if (el.mediaSub) el.mediaSub.textContent = State.mediaArtist || label;
    if (el.mediaKind) el.mediaKind.textContent = label + ' · сейчас музыка';
    if (el.mediaCover) {
      if (State.mediaCover) {
        el.mediaCover.src = State.mediaCover;
        el.mediaCover.hidden = false;
        if (el.mediaArtIcon) el.mediaArtIcon.style.display = 'none';
        if (el.npGlow) el.npGlow.style.backgroundImage = 'url("' + State.mediaCover + '")';
      } else {
        el.mediaCover.hidden = true;
        el.mediaCover.removeAttribute('src');
        if (el.mediaArtIcon) el.mediaArtIcon.style.display = '';
        if (el.npGlow) el.npGlow.style.backgroundImage = '';
      }
    }
    syncHomePlayer();
    syncSystemMedia(true);
  }

  function extClearPlayer() {
    State.extTrack = null;
    State.extSource = '';
  }

  function extYieldToOther() {
    extClearPlayer();
    State.extRemote = false;
    if (el.extNow) extNow(null);
    cgi('youtube.py', { action: 'stop' }, { timeout: 12000, silent: true }).catch(function () {});
    cgi('soundcloud.py', { action: 'stop' }, { timeout: 12000, silent: true }).catch(function () {});
    extSetStatus('Сейчас играет Яндекс Музыка');
    // Старый трек YouTube/SoundCloud не должен оставаться в главном плеере
    // до прихода первого состояния Яндекс Музыки.
    State.mediaTitle = 'Загружаю трек…';
    State.mediaArtist = 'Яндекс Музыка';
    State.mediaCover = '';
    if (el.mediaTitle) el.mediaTitle.textContent = State.mediaTitle;
    if (el.mediaSub) el.mediaSub.textContent = State.mediaArtist;
    if (el.mediaKind) el.mediaKind.textContent = 'Яндекс Музыка · загружаю…';
    if (el.mediaCover) {
      el.mediaCover.hidden = true;
      el.mediaCover.removeAttribute('src');
    }
    if (el.mediaArtIcon) el.mediaArtIcon.style.display = '';
    if (el.npGlow) el.npGlow.style.backgroundImage = '';
    syncHomePlayer();
    syncSystemMedia(true);
  }

  function extPlay(track) {
    if (!track || !track.id) return;
    var source = track.source === 'youtube' ? 'youtube' : 'soundcloud';
    extSetStatus('Запускаю ' + (EXT_LABELS[source] || '') + '…');
    var prepKey = source + ':' + track.id;
    var prepare = extPrepares[prepKey] || Promise.resolve();
    prepare.catch(function () {}).then(function () {
      extStopBackends();
    }).then(function () {
      var payload = {
        action: 'play', id: track.id, title: track.title || '',
        artist: track.artist || '', cover: track.cover || ''
      };
      if (source === 'soundcloud') payload.url = track.url;
      return cgi(source === 'youtube' ? 'youtube.py' : 'soundcloud.py', payload,
        { timeout: 120000 });
    }).then(function (data) {
      var played = (data && data.track) || track;
      played.source = source;
      extSetStatus('Играет: ' + (played.title || track.title) +
        ' · ' + (EXT_LABELS[source] || ''), 'ok');
      extNow(played);
      extApplyPlayer(played, source);
      State.extRemote = false;
      setProvDot('ext', 'ok');
      if (typeof zvukShowNow === 'function') zvukShowNow(null);
    }).catch(function (err) {
      // Ошибка запуска не должна оставлять «сейчас играет» и «Остановить».
      extClearPlayer();
      if (el.extNow) extNow(null);
      extStopBackends();
      extSetStatus('Ошибка: ' + err.message, 'bad');
      toast('Музыка: ' + err.message, 'bad');
    });
  }

  function extSearch() {
    var q = (el.extQuery && el.extQuery.value || '').trim();
    if (!q) return;
    var seq = ++extSearchSeq;
    extSetStatus('Ищу в YouTube Music и SoundCloud…');
    var yt = [], sc = [], ytDone = false, scDone = false, errors = [];
    function render() {
      if (seq !== extSearchSeq) return;
      var tracks = [];
      var max = Math.max(yt.length, sc.length);
      for (var i = 0; i < max; i++) {
        if (yt[i]) tracks.push(yt[i]);
        if (sc[i]) tracks.push(sc[i]);
      }
      extRender(tracks);
      var prefix = 'YouTube: ' + (ytDone ? yt.length : 'ищет…') +
        ' · SoundCloud: ' + (scDone ? sc.length : 'ищет…');
      extSetStatus('Найдено: ' + tracks.length + ' · ' + prefix,
        errors.length && !tracks.length ? 'bad' : '');
    }
    function search(file, source) {
      return cgi(file, { action: 'search', q: q, limit: 8 }, { timeout: 90000 })
        .then(function (data) {
          var tracks = (data.tracks || []).map(function (track) {
            track.source = source;
            return track;
          });
          if (source === 'youtube') { yt = tracks; ytDone = true; }
          else { sc = tracks; scDone = true; }
          render();
          if (tracks[0]) extPrefetch(tracks[0]);
          return tracks;
        })
        .catch(function (err) {
          errors.push(err.message);
          if (source === 'youtube') ytDone = true;
          else scDone = true;
          render();
          return [];
        });
    }
    Promise.all([search('youtube.py', 'youtube'), search('soundcloud.py', 'soundcloud')])
      .then(function () {
        if (seq === extSearchSeq) render();
      });
  }

  function extLoadStatus() {
    return Promise.all([
      cgi('youtube.py', { action: 'status' }, { timeout: 12000, silent: true }).catch(function () { return {}; }),
      cgi('soundcloud.py', { action: 'status' }, { timeout: 12000, silent: true }).catch(function () { return {}; })
    ]).then(function (parts) {
      var yt = parts[0] || {};
      var sc = parts[1] || {};
      var ytReady = !!yt.has_ytdlp && !!yt.has_ffmpeg;
      var scReady = !!sc.has_ytdlp;
      var ready = ytReady || scReady;
      extSetStatus('YouTube: ' + (ytReady ? 'готов' : 'нет') +
        ' · SoundCloud: ' + (scReady ? 'готов' : 'нет'), ready ? '' : 'bad');
      setProvDot('ext', ready ? 'ok' : 'bad');
      var track = (yt.track && yt.track.id && yt.track) || (sc.track && sc.track.id && sc.track);
      if (track) {
        track.source = (yt.track && yt.track.id === track.id) ? 'youtube' : 'soundcloud';
        if (!State.extTrack) {
          extApplyPlayer(track, track.source);
          State.extRemote = true;
        }
        extNow(track);
      }
    });
  }

  function youtubeSearch() {
    var q = (el.youtubeQuery && el.youtubeQuery.value || '').trim();
    if (!q) return;
    extStatus(el.youtubeStatus, 'Ищу на YouTube Music…');
    cgi('youtube.py', { action: 'search', q: q, limit: 15 }, { timeout: 60000 })
      .then(function (data) {
        youtubeRender(data.tracks || []);
        extStatus(el.youtubeStatus, 'Найдено: ' + ((data.tracks || []).length));
      })
      .catch(function (err) { extStatus(el.youtubeStatus, 'Ошибка: ' + err.message, 'bad'); });
  }

  function youtubeLoadStatus() {
    return cgi('youtube.py', { action: 'status' }, { timeout: 12000, silent: true })
      .then(function (data) {
        var ready = data.has_ytdlp && data.has_ffmpeg;
        extStatus(el.youtubeStatus,
          ready ? 'yt-dlp и MP3 готовы'
            : !data.has_ytdlp ? 'yt-dlp не установлен' : 'ffmpeg не установлен',
          ready ? 'ok' : 'bad');
        setProvDot('youtube', ready ? 'ok' : 'bad');
        if (data.track && data.track.id) youtubeNow(data.track);
      }).catch(function () { extStatus(el.youtubeStatus, 'YouTube Music недоступен', 'bad'); setProvDot('youtube', 'bad'); });
  }

  function spotifyRender(tracks) {
    if (!el.spotifyResults) return;
    el.spotifyResults.textContent = '';
    if (!tracks || !tracks.length) {
      var empty = document.createElement('div');
      empty.className = 'zvuk-empty';
      empty.textContent = 'Ничего не найдено';
      el.spotifyResults.appendChild(empty);
      return;
    }
    tracks.forEach(function (track) {
      var row = document.createElement('button');
      row.type = 'button';
      row.className = 'zvuk-track';
      row.title = 'Открыть в Spotify';
      var img = document.createElement('img');
      img.alt = '';
      img.loading = 'lazy';
      if (track.cover) img.src = track.cover;
      var info = document.createElement('div');
      var title = document.createElement('div');
      title.className = 'zt-title';
      title.textContent = track.title || 'Spotify';
      var artist = document.createElement('div');
      artist.className = 'zt-artist';
      artist.textContent = track.artist || '';
      info.appendChild(title);
      info.appendChild(artist);
      var open = document.createElement('span');
      open.className = 'zt-play';
      open.textContent = '↗';
      row.appendChild(img);
      row.appendChild(info);
      row.appendChild(open);
      row.addEventListener('click', function () {
        if (track.url) window.open(track.url, '_blank');
      });
      el.spotifyResults.appendChild(row);
    });
  }

  function spotifySave() {
    var cid = (el.spotifyId && el.spotifyId.value || '').trim();
    var sec = (el.spotifySecret && el.spotifySecret.value || '').trim();
    if (!cid || !sec) { extStatus(el.spotifyStatus, 'Нужны Client ID и Client Secret', 'bad'); return; }
    extStatus(el.spotifyStatus, 'Проверяю ключи…');
    cgi('spotify.py', { action: 'credentials', client_id: cid, secret: sec }, { timeout: 40000 })
      .then(function () {
        if (el.spotifyId) el.spotifyId.value = '';
        if (el.spotifySecret) el.spotifySecret.value = '';
        extStatus(el.spotifyStatus, 'Ключи сохранены', 'ok');
      })
      .catch(function (err) { extStatus(el.spotifyStatus, 'Ошибка: ' + err.message, 'bad'); });
  }

  function spotifySearch() {
    var q = (el.spotifyQuery && el.spotifyQuery.value || '').trim();
    if (!q) return;
    extStatus(el.spotifyStatus, 'Ищу в Spotify…');
    cgi('spotify.py', { action: 'search', q: q, limit: 15 }, { timeout: 30000 })
      .then(function (data) {
        spotifyRender(data.tracks || []);
        extStatus(el.spotifyStatus, 'Найдено: ' + ((data.tracks || []).length));
      })
      .catch(function (err) { extStatus(el.spotifyStatus, 'Ошибка: ' + err.message, 'bad'); });
  }

  function spotifyLoadStatus() {
    return cgi('spotify.py', { action: 'status' }, { timeout: 12000, silent: true })
      .then(function (data) {
        extStatus(el.spotifyStatus, data.has_credentials ? 'Ключи сохранены' : 'Ключи не сохранены',
          data.has_credentials ? 'ok' : '');
        setProvDot('spotify', data.has_credentials ? 'ok' : 'warn');
      }).catch(function () { extStatus(el.spotifyStatus, 'Spotify недоступен', 'bad'); setProvDot('spotify', 'bad'); });
  }

  function soundcloudRender(tracks) {
    if (!el.soundcloudResults) return;
    el.soundcloudResults.textContent = '';
    if (!tracks || !tracks.length) {
      var empty = document.createElement('div');
      empty.className = 'zvuk-empty';
      empty.textContent = 'Ничего не найдено';
      el.soundcloudResults.appendChild(empty);
      return;
    }
    tracks.forEach(function (track) {
      var row = document.createElement('button');
      row.type = 'button';
      row.className = 'zvuk-track';
      var img = document.createElement('img');
      img.alt = '';
      img.loading = 'lazy';
      if (track.cover) img.src = track.cover;
      var info = document.createElement('div');
      var title = document.createElement('div');
      title.className = 'zt-title';
      title.textContent = track.title || 'SoundCloud';
      var artist = document.createElement('div');
      artist.className = 'zt-artist';
      artist.textContent = track.artist || 'SoundCloud';
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
      row.addEventListener('click', function () { soundcloudPlay(track); });
      el.soundcloudResults.appendChild(row);
    });
  }

  function soundcloudNow(track) {
    if (!el.soundcloudNow) return;
    el.soundcloudNow.textContent = '';
    if (!track) return;
    var b = document.createElement('b');
    b.textContent = track.title || 'SoundCloud';
    var artist = document.createElement('div');
    artist.textContent = track.artist || '';
    var stop = document.createElement('button');
    stop.type = 'button';
    stop.className = 'btn sm ghost';
    stop.style.marginTop = '8px';
    stop.textContent = 'Остановить';
    stop.addEventListener('click', function () {
      cgi('media.py', { action: 'pause' }, { timeout: 12000 })
        .then(function () { soundcloudNow(null); extStatus(el.soundcloudStatus, 'Остановлено'); })
        .catch(function (err) { extStatus(el.soundcloudStatus, 'Ошибка: ' + err.message, 'bad'); });
    });
    el.soundcloudNow.appendChild(b);
    el.soundcloudNow.appendChild(artist);
    el.soundcloudNow.appendChild(stop);
  }

  function soundcloudPlay(track) {
    if (!track || !track.url) return;
    extStatus(el.soundcloudStatus, 'Получаю поток…');
    soundcloudNow(track);
    cgi('soundcloud.py', {
      action: 'play', id: track.id, url: track.url, title: track.title || '',
      artist: track.artist || '', cover: track.cover || ''
    }, { timeout: 120000 })
      .then(function (data) {
        extStatus(el.soundcloudStatus, 'Играет: ' + ((data.track && data.track.title) || track.title), 'ok');
        soundcloudNow(data.track || track);
      })
      .catch(function (err) {
        extStatus(el.soundcloudStatus, 'Ошибка: ' + err.message, 'bad');
        toast('SoundCloud: ' + err.message, 'bad');
      });
  }

  function soundcloudSearch() {
    var q = (el.soundcloudQuery && el.soundcloudQuery.value || '').trim();
    if (!q) return;
    extStatus(el.soundcloudStatus, 'Ищу на SoundCloud…');
    cgi('soundcloud.py', { action: 'search', q: q, limit: 15 }, { timeout: 60000 })
      .then(function (data) {
        soundcloudRender(data.tracks || []);
        extStatus(el.soundcloudStatus, 'Найдено: ' + ((data.tracks || []).length));
      })
      .catch(function (err) { extStatus(el.soundcloudStatus, 'Ошибка: ' + err.message, 'bad'); });
  }

  function soundcloudLoadStatus() {
    return cgi('soundcloud.py', { action: 'status' }, { timeout: 12000, silent: true })
      .then(function (data) {
        extStatus(el.soundcloudStatus, data.has_ytdlp ? 'yt-dlp готов' : 'yt-dlp не установлен',
          data.has_ytdlp ? 'ok' : 'bad');
        setProvDot('soundcloud', data.has_ytdlp ? 'ok' : 'bad');
        if (data.track && data.track.id) soundcloudNow(data.track);
      }).catch(function () { extStatus(el.soundcloudStatus, 'SoundCloud недоступен', 'bad'); setProvDot('soundcloud', 'bad'); });
  }

