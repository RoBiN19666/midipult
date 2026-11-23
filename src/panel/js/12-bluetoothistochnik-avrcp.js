  /* ─────────── Bluetooth-источник (AVRCP) ─────────── */
  var btPollAt = 0;

  // Состояние плеера телефона: BlueZ отдаёт его по AVRCP, пока телефон
  // подключён как A2DP-источник. Опрос — два локальных вызова dbus-send.
  function btPoll() {
    return cgi('btplayer.py', { action: 'status' }, { timeout: 9000, silent: true })
      .then(function (data) {
        State.btPlayer = data || null;
        State.btPlayerAt = Date.now();
        return State.btPlayer;
      })
      .catch(function () { return State.btPlayer; });
  }

  function btActive() {
    var bt = State.btPlayer;
    if (!bt || !bt.avrcp) return false;
    // Данные старше 15 секунд не считаем: опрос мог отвалиться, и плеер
    // не должен залипать на телефоне, которого уже нет.
    if (!State.btPlayerAt || Date.now() - State.btPlayerAt > 15000) return false;
    if (bt.status === 'playing') {
      // Станция играет своё — приоритет у неё, телефон не перебивает.
      return !State.stationActive;
    }
    if (bt.status !== 'paused') return false;
    // Просто подключённый телефон отдаёт «paused» с пустым треком — это не
    // источник, а фон: не перебиваем им «Glagol» и радио.
    var track = bt.track || {};
    if (!(Number(bt.duration) > 0 || track.title)) return false;
    return !State.stationActive;
  }

  function applyBtPlayer() {
    var bt = State.btPlayer || {};
    var track = bt.track || {};
    var title = track.title || 'С телефона';
    var artist = track.artist || '';
    var duration = Number(bt.duration) || 0;
    var position = Number(bt.position) || 0;

    State.playerKind = 'Bt';
    State.mediaTitle = title;
    State.mediaArtist = artist;
    State.mediaId = '';
    State.mediaDuration = duration;
    State.mediaCover = '';
    State.audioProgress = position;
    State.mediaProgress = position;
    State.progressBase = position;
    State.progressAt = Date.now() / 1000;

    setPlaying(bt.status === 'playing');
    if (el.mediaTitle) el.mediaTitle.textContent = title;
    if (el.mediaSub) el.mediaSub.textContent = artist || 'Bluetooth';
    if (el.mediaKind) el.mediaKind.textContent = 'с телефона · Bluetooth';
    if (el.mediaCover) {
      el.mediaCover.hidden = true;
      el.mediaCover.removeAttribute('src');
    }
    if (el.mediaArtIcon) el.mediaArtIcon.style.display = '';
    if (el.npGlow) el.npGlow.style.backgroundImage = '';
    // AVRCP не умеет абсолютную перемотку: ползунок прячем, но позицию и
    // длительность показываем — их телефон отдаёт.
    if (el.mediaProgress) el.mediaProgress.hidden = false;
    if (el.mediaSeek) {
      el.mediaSeek.hidden = true;
      el.mediaSeek.disabled = true;
    }
    // Лайк и дизлайк — это трек Яндекс Музыки, у трека с телефона их нет.
    [el.btnLike, el.btnDislike].forEach(function (button) {
      if (!button) return;
      button.hidden = true;
      button.disabled = true;
    });
    // Текст песни ищется по названию и исполнителю — для трека с телефона годится.
    if (el.btnLyrics) {
      el.btnLyrics.hidden = false;
      el.btnLyrics.disabled = !title;
    }
    if (State.lyricsLines.length) clearLyrics();
    updateInlineLine();
    updateMediaProgress();
    syncHomePlayer();
    syncSystemMedia();
  }

  function btCommand(action) {
    var optimistic = action === 'play' ? true : action === 'pause' ? false : null;
    if (optimistic !== null) setPlaying(optimistic);
    if (el.mediaKind) {
      el.mediaKind.textContent = action === 'play' ? 'включаю…'
        : action === 'pause' ? 'ставлю на паузу…' : 'переключаю…';
    }
    return cgi('btplayer.py', { action: action }, { timeout: 9000 })
      .then(function (data) {
        // Ответ команды — уже свежее состояние, второй запрос не нужен.
        if (data && typeof data.avrcp !== 'undefined') {
          State.btPlayer = data;
          State.btPlayerAt = Date.now();
        }
        if (btActive()) applyBtPlayer();
      })
      .catch(function (err) { toast('Bluetooth: ' + err.message, 'bad'); });
  }

  function applyPlayerData(data) {
    State.stationActive = !!data.playing;
    if (btActive()) {
      applyBtPlayer();
      return;
    }
    var title = data.title || '';
    // Потоки YouTube/SoundCloud идут через штатный плеер, но их обложку и
    // источник Glagol не возвращает. Пока играет тот же трек, сохраняем
    // метаданные провайдера.
    if (State.extTrack) {
      var ext = State.extTrack;
      // Внешний поток Glagol часто отдаёт пустой title/cover — пока играет
      // наш трек, показываем метаданные провайдера.
      if (!data.title || data.title === ext.title || data.title.indexOf(ext.title) === 0) {
        data.title = ext.title;
        data.artist = ext.artist || data.artist || '';
        data.cover = ext.cover || '';
      } else if (data.title) {
        extClearPlayer();
        if (el.extNow) extNow(null);
        extStopBackends();
      }
    }
    title = data.title || '';
    var trackChanged = title !== (State.mediaTitle || '');
    var incoming = (Number(data.progress) || 0) + (Number(data.age) || 0);
    var local = currentProgress();
    var wasPlaying = State.playing;

    // Ожидаемое состояние после нажатия важнее задержанного state станции.
    var expected = null;
    if (State.cmdPlaying !== null && Date.now() < State.cmdUntil) {
      expected = State.cmdPlaying;
    }
    if (State.cmdPlaying !== null && !!data.playing === State.cmdPlaying) {
      State.cmdPlaying = null;
      State.cmdUntil = 0;
    }
    var playing = expected !== null ? expected : !!data.playing;
    setPlaying(playing);
    State.alice = data.alice || 'IDLE';
    if (nativeLightActive()) stopCustomRingForNative();
    State.playerKind = data.kind || null;
    State.mediaDuration = Number(data.duration) || 0;
    // Лайки и текст имеют смысл только для трека Яндекс Музыки. На радио
    // и на пустом плеере кнопки не убираем, а оставляем неактивными: ряд
    // управления не должен «прыгать».
    var musicTrack = State.playerKind === 'Track' && !!data.id && !!data.title;
    [el.btnLike, el.btnDislike, el.btnLyrics].forEach(function (button) {
      if (!button) return;
      button.hidden = false;
      button.disabled = !musicTrack;
    });
    if (!musicTrack) {
      if (State.lyricsLines.length) clearLyrics();
      updateInlineLine();
      if (el.lyricsDlg && el.lyricsDlg.open) el.lyricsDlg.close();
    }

    // Перемотка: держим целевую позицию, пока станция реально не переедет.
    // Иначе старый снапшот возвращает ползунок назад.
    var pending = State.pendingSeek;
    if (pending) {
      if (trackChanged) {
        State.pendingSeek = null;
      } else if (Math.abs(incoming - pending.target) <= 6) {
        State.pendingSeek = null;
        State.lyricsActive = null;
      } else if (Date.now() > pending.until) {
        State.pendingSeek = null;
        toast('Перемотка не применилась', 'warn');
      } else {
        incoming = pending.target;
      }
    } else if (!trackChanged && playing && local > 0 && incoming < local - 1.5) {
      // Старый снапшот (watcher/демон) не должен откатывать ползунок назад.
      incoming = local;
    } else if (!trackChanged && !playing && wasPlaying && incoming < local - 0.2) {
      // На паузе станция иногда отдаёт позицию чуть позже, чем та, на которой
      // реально остановился звук. Не откатываем строку текста назад.
      incoming = local;
    }
    // Точка отсчёта для локальной интерполяции: progress + age, дальше
    // клиент сам добавляет прошедшее время.
    State.progressBase = incoming;
    State.progressAt = Date.now() / 1000;
    State.mediaProgress = incoming;
    State.audioProgress = incoming;
    var seekable = State.playerKind === 'Track' && State.mediaDuration > 0;
    if (el.mediaProgress) el.mediaProgress.hidden = !seekable;
    // Возврат из Bluetooth-режима: там ползунок был спрятан.
    if (el.mediaSeek) {
      el.mediaSeek.hidden = false;
      el.mediaSeek.disabled = false;
    }
    if (!State.seeking) updateMediaProgress();
    if (el.mediaKind) {
      el.mediaKind.textContent = State.extTrack
      ? ((State.extSource || 'Стриминг') + ' · сейчас музыка')
      : (data.kind === 'FmRadio' ? 'сейчас радио' :
        (data.kind === 'Track' ? 'сейчас музыка' : ''));
    }
    if (data.title) {
      if (data.title !== State.mediaTitle) {
        State.mediaTitle = data.title;
        State.mediaArtist = data.artist || '';
        State.mediaId = data.id || '';
        clearLyrics();
        loadLiked();
        if (State.lyricsInline) {
          setTimeout(function () { loadLyrics(true); }, 600);
        }
      }
      el.mediaTitle.textContent = data.title;
      el.mediaSub.textContent = data.artist || '';
    } else if (data.playing && data.kind === 'Track') {
      // Станция уже играет, но ещё не отдала метаданные. Не показываем
      // «Glagol» и не сбрасываем обложку в пустоту.
      if (!State.mediaTitle) {
        State.mediaTitle = 'Загружаю трек…';
        State.mediaArtist = State.extSource || 'Яндекс Музыка';
        el.mediaTitle.textContent = State.mediaTitle;
        el.mediaSub.textContent = State.mediaArtist;
      }
    } else if (!State.extTrack) {
      State.mediaTitle = '';
      State.mediaArtist = '';
      el.mediaTitle.textContent = 'Ничего не играет';
      el.mediaSub.textContent = 'Включите трек, плейлист или радио';
    }
    if (data.cover) {
      State.mediaCover = data.cover;
      el.mediaCover.src = data.cover;
      el.mediaCover.hidden = false;
      el.mediaArtIcon.style.display = 'none';
      if (el.npGlow) el.npGlow.style.backgroundImage = 'url("' + data.cover + '")';
    } else if (!(data.playing && data.kind === 'Track')) {
      el.mediaCover.hidden = true;
      el.mediaCover.removeAttribute('src');
      State.mediaCover = '';
      if (el.npGlow) el.npGlow.style.backgroundImage = '';
      el.mediaArtIcon.style.display = '';
    }
    syncHomePlayer();
    syncSystemMedia();
  }

  /**
   * Системный плеер Android: шторка/локскрин и аппаратные кнопки громкости.
   * На веб-версии объекта нет — функция просто ничего не делает.
   */
  function syncSystemMedia(force) {
    if (!window.MidiPultMedia) return;
    if (!State.mediaTitle) {
      try { window.MidiPultMedia.clear(); } catch (e) {}
      return;
    }
    var duration = Math.max(0, Math.round((State.mediaDuration || 0) * 1000));
    var elapsed = State.playing ? Math.max(0, (Date.now() / 1000) - (State.progressAt || 0)) : 0;
    var position = Math.max(0, Math.round(((State.mediaProgress || 0) + elapsed) * 1000));
    var payload = {
      title: State.mediaTitle || '',
      artist: State.mediaArtist || '',
      cover: State.mediaCover || '',
      playing: !!State.playing,
      position: Math.min(position, duration || position),
      duration: duration,
      volume: Math.round(State.volume || 0),
      canSeek: State.playerKind === 'Track' && duration > 0,
      // Трек играет сам телефон: приложение не должно забирать кнопки
      // громкости — они остаются телефону (см. PlaybackService).
      fromPhone: State.playerKind === 'Bt'
    };
    var raw = JSON.stringify(payload);
    if (!force && raw === State.systemMediaRaw) return;
    State.systemMediaRaw = raw;
    try { window.MidiPultMedia.update(raw); } catch (e) {}
  }

  var systemMediaTimer = null;
  function syncSystemMediaSoon() {
    if (systemMediaTimer) return;
    systemMediaTimer = setTimeout(function () {
      systemMediaTimer = null;
      syncSystemMedia();
    }, 250);
  }

  window.MidiPultRemote = {
    play: function () { if (!State.playing) mediaAction('play'); },
    pause: function () { if (State.playing) mediaAction('pause'); },
    playPause: function () { mediaAction(State.playing ? 'pause' : 'play'); },
    next: function () { mediaAction('next'); },
    prev: function () { mediaAction('prev'); },
    setVolume: function (level) {
      volumeRemoteAt = Date.now();
      setVolumeUI(parseInt(level, 10) || 0, false);
      // Станцию уже обновляет нативный StationApi.volume(). Повторный
      // pushVolume() создавал гонку двух запросов и дёргал ползунок.
      syncSystemMedia(true);
    },
    seek: function (ms) {
      var total = (State.mediaDuration || 0) * 1000;
      if (total <= 0) return;
      seekMedia(Math.round(Math.max(0, Math.min(Number(ms) || 0, total)) / total * 1000));
    }
  };

  function applyState(data) {
    if (data.status) applyStatusData(data.status);
    if (data.player && !data.player.error) applyPlayerData(data.player);
    else State.stationActive = false;
  }

  var stateTimer = null;

  function scheduleStateRefresh() {
    if (stateTimer) clearTimeout(stateTimer);
    // «Звук» опрашивает player отдельно (3 с при игре, 10 с при паузе);
    // общий state здесь только редкий фон, чтобы не дублировать запросы.
    var delay = State.tab === 'sound' ? 30000 : 15000;
    stateTimer = setTimeout(function () {
      if (document.hidden) {
        scheduleStateRefresh();
        return;
      }
      refreshState().then(scheduleStateRefresh, scheduleStateRefresh);
    }, delay);
  }

  function refreshState(freshPlayer, fresh) {
    if (document.hidden) return Promise.resolve();
    var url = '/state' + (freshPlayer ? '?player=1' + (fresh ? '&fresh=1' : '') : '');
    return fetch(url, { cache: 'no-store', credentials: 'same-origin' })
      .then(function (res) {
        if (!res.ok) throw new Error('state ' + res.status);
        return res.json();
      })
      .then(applyState)
      .catch(function () {
        // Постоянный процесс недоступен — возвращаемся к CGI.
        return cgi('state.py', {}, { timeout: 9000, silent: true })
          .then(applyState)
          .catch(function () {
            State.luna = false;
            renderStatus();
          });
      });
  }

  var playerPromise = null;
  var playerTimer = null;
  var lastPlayerPoll = 0;

  function refreshPlayer(force, fresh) {
    if (playerPromise) {
      if (!force) return playerPromise;
      // Команда пришла во время опроса: дождёмся его и сразу запросим новый.
      return playerPromise.then(function () { return refreshPlayer(true, fresh); });
    }
    playerPromise = refreshState(true, fresh);
    playerPromise.then(function () { playerPromise = null; },
                       function () { playerPromise = null; });
    return playerPromise;
  }

  function stopPlayerPoll() {
    if (playerTimer) clearInterval(playerTimer);
    playerTimer = null;
  }

  function startPlayerPoll() {
    stopPlayerPoll();
    if (State.tab !== 'sound' && State.tab !== 'home') return;
    lastPlayerPoll = Date.now();
    btPollAt = 0;
    btPoll();
    refreshPlayer();
    loadLiked();
    playerTimer = setInterval(function () {
      if (State.tab !== 'sound' && State.tab !== 'home') return;
      // Полоска и текст песни двигаются локально между опросами (как в
      // yapanel): сервер отдаёт progress + age, а здесь добавляем прошедшее.
      updateMediaProgress();
      if (document.hidden) return;
      // Телефон играет мимо станции: Glagol о нём не знает, поэтому
      // состояние спрашиваем у BlueZ отдельно, раз в 2 секунды.
      if (Date.now() - btPollAt > 2000) {
        btPollAt = Date.now();
        var wasBt = btActive();
        btPoll().then(function () {
          if (btActive()) applyBtPlayer();
          else if (wasBt) refreshPlayer(true);
        });
      }
      var active = !!State.playing;
      var wait = active ? 2000 : 10000;
      if (Date.now() - lastPlayerPoll < wait) return;
      lastPlayerPoll = Date.now();
      refreshPlayer();
      extSyncRemote();
    }, 250);
  }

  function commandGuard(action) {
    var playing = action === 'play' ? true
      : (action === 'pause' || action === 'stop') ? false
        : (action === 'next' || action === 'prev') ? true : null;
    if (playing === null) return;
    // Станция применяет команду и обновляет state с задержкой до нескольких
    // секунд. Держим ожидаемое состояние, чтобы кнопки не мигали назад.
    State.cmdPlaying = playing;
    State.cmdUntil = Date.now() + (playing ? 5000 : 7000);
    setPlaying(playing);
  }

  function mediaAction(action) {
    // Пока играет телефон, транспортные кнопки идут в AVRCP, а не в Glagol.
    if (btActive() && (action === 'play' || action === 'pause'
                       || action === 'next' || action === 'prev')) {
      return btCommand(action);
    }
    commandGuard(action);
    var pending = action === 'play' ? 'включаю…'
      : action === 'pause' ? 'ставлю на паузу…'
      : action === 'next' ? 'переключаю…'
      : action === 'prev' ? 'переключаю…'
      : action === 'music' ? 'включаю музыку…' : 'отправляю…';
    el.mediaKind.textContent = pending;
    return withBusy(null, function () {
      return cgi('media.py', { action: action }, { timeout: 9000 }).then(function (data) {
        applyMediaReply(data, action);
        if (data && data.confirmed === false) toast('Команда отправлена, ответа нет', 'warn');
        else toast('Команда отправлена — проверяю состояние', 'ok');
        // Спрашиваем Glagol напрямую (fresh=1): watcher может отдать состояние
        // на секунду-две старше и вернуть кнопку/ползунок назад.
        return new Promise(function (resolve) {
          setTimeout(resolve, 250);
        }).then(function () {
          return refreshPlayer(true, true);
        }).then(function () {
          setTimeout(function () { refreshPlayer(true, true); }, 1200);
        });
      }).catch(function (err) {
        el.mediaKind.textContent = 'не удалось…';
        toast('Плеер: ' + err.message, 'bad');
      });
    });
  }

  function applyMediaReply(data, action) {
    var state = (data && data.state) || {};
    // Кнопка реагирует сразу; state станции догонит (см. commandGuard).
    if (state.title) {
      el.mediaTitle.textContent = state.title;
      if (el.mediaSub) el.mediaSub.textContent = state.artist || '';
    }
    if (typeof state.volume === 'number') setVolumeUI(state.volume);
  }

  function volumeIconHref() {
    if (State.muted || !Number(State.volume)) return '#i-mute';
    var level = Number(State.volume);
    if (level <= 33) return '#i-volume-1';
    if (level <= 66) return '#i-volume-2';
    return '#i-volume-3';
  }

  function updateVolumeIcons() {
    var href = volumeIconHref();
    Array.prototype.forEach.call(
      document.querySelectorAll('[data-volume-icon] use'),
      function (use) { use.setAttribute('href', href); });
  }

  function setVolumeUI(level, silent) {
    var v = clamp(Math.round(level), 0, 100);
    State.volume = v;
    if (!silent) { el.volume.value = v; el.volumeVal.textContent = v + '%'; }
    store.set('volume', v);
    updateVolumeIcons();
    if (typeof syncSystemMediaSoon === 'function') syncSystemMediaSoon();
  }

  var volTimer = null;
  var volPending = false;
  var volDragTimer = null;
  var volumeRemoteAt = 0;

  function endVolumeDrag() {
    if (volDragTimer) clearTimeout(volDragTimer);
    volDragTimer = setTimeout(function () { State.volumeDragging = false; }, 700);
  }

  function pushVolume() {
    if (volTimer) clearTimeout(volTimer);
    volPending = true;
    volTimer = setTimeout(function () {
      volTimer = null;
      if (!volPending) return;
      volPending = false;
      var level = State.volume;
      cgi('volume.py', { level: level }, { timeout: 9000 }).then(function (data) {
        if (data && typeof data.level === 'number') setVolumeUI(data.level);
        if (data && data.method) log('volume', 'method', data.method);
        if (State.tab === 'sound' || State.tab === 'home') refreshPlayer(true);
      }).catch(function (err) {
        toast('Громкость: ' + err.message, 'bad');
      });
    }, 200);
  }

