  /* ─────────── цвет ─────────── */
  function hexToRgb(hex) {
    var h = String(hex).replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    if (isNaN(n)) return { r: 0, g: 230, b: 118 };
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(function (v) {
      return clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
    }).join('').toUpperCase();
  }

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var h = 0, s = 0, l = (max + min) / 2;
    if (max !== min) {
      var d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    return { h: h, s: s * 100, l: l * 100 };
  }

  function hslToHex(h, s, l) {
    h = ((h % 360) + 360) % 360;
    s = clamp(s, 0, 100) / 100;
    l = clamp(l, 0, 100) / 100;
    var k = function (n) { return (n + h / 30) % 12; };
    var a = s * Math.min(l, 1 - l);
    var f = function (n) {
      return l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    };
    return rgbToHex(f(0) * 255, f(8) * 255, f(4) * 255);
  }

  function waveColors(frame) {
    var out = [];
    for (var i = 0; i < 24; i++) {
      out.push(hslToHex((i * 15 + frame * 7) % 360, 92, 58));
    }
    return out;
  }

  function candleColors(frame) {
    var out = [];
    for (var i = 0; i < 24; i++) {
      // Две медленные волны вместо random: мерцание остаётся живым, но
      // без ступенчатого «шума» на каждом кадре.
      var flicker = 7 * Math.sin(i * 0.55 + frame * 0.22)
        + 3.5 * Math.sin(i * 1.27 - frame * 0.11);
      var hue = 28 + 2.5 * Math.sin(i * 0.3 + frame * 0.05);
      out.push(hslToHex(hue, 95, clamp(50 + flicker, 36, 66)));
    }
    return out;
  }

  function composeColors() {
    var i;
    if (State.ledMode === 'custom') {
      return State.ledColors.slice();
    }
    if (State.ledMode === 'rainbow') {
      var out = [];
      for (i = 0; i < 24; i++) out.push(hslToHex(i * 15, 92, 60));
      return out;
    }
    if (State.ledMode === 'gradient') {
      var base = rgbToHsl.apply(null, (function (c) { return [c.r, c.g, c.b]; })(hexToRgb(State.color)));
      var list = [];
      for (i = 0; i < 24; i++) {
        list.push(hslToHex(base.h + i * 6, Math.max(55, base.s), clamp(base.l - i * 0.9, 26, 78)));
      }
      return list;
    }
    if (State.ledMode === 'wave') return waveColors(0);
    if (State.ledMode === 'candle') return candleColors(0);
    return new Array(24).fill(State.color);
  }

  function paintRing(colors, label) {
    State.ringPreview = null;
    State.hwActive = false;
    if (!ringDots.length) return;
    for (var i = 0; i < ringDots.length; i++) {
      var c = colors[i % colors.length];
      ringDots[i].style.background = c;
      ringDots[i].style.color = c;
      ringDots[i].style.boxShadow = '0 0 10px ' + c;
    }
    el.ringHex.textContent = label || colors[0].toUpperCase();
  }

  function paintOff() {
    State.ringPreview = null;
    State.hwActive = false;
    ringDots.forEach(function (dot) {
      dot.style.background = '#171b26';
      dot.style.color = 'transparent';
      dot.style.boxShadow = 'none';
    });
    el.ringHex.textContent = 'OFF';
  }

  function ringOffBurst() {
    function off() {
      luna('/api/led/off/ring', {}, { timeout: 4000, silent: true }).catch(function () {});
    }
    off();
    setTimeout(off, 600);
    setTimeout(off, 1400);
  }

  function markActiveChip() {
    var chips = el.presets.querySelectorAll('.chip');
    for (var i = 0; i < chips.length; i++) {
      var chip = chips[i];
      var match = chip.dataset.mode
        ? chip.dataset.mode === State.ledMode
        : (State.ledMode === 'solid' && chip.dataset.hex.toLowerCase() === State.color.toLowerCase());
      chip.setAttribute('aria-pressed', match ? 'true' : 'false');
    }
  }

  function selectLed(index) {
    if (State.ledMode === 'wave' || State.ledMode === 'candle') {
      State.ledColors = composeColors().slice();
      stopLedAnimation();
      State.ledMode = 'custom';
    }

    if (State.selected === index) {
      State.selected = null;
    } else {
      if (State.ledMode !== 'custom') {
        State.ledColors = composeColors().slice();
      }
      State.selected = index;
      State.ledMode = 'custom';
    }

    ringDots.forEach(function (dot, i) {
      dot.classList.toggle('sel', i === State.selected);
    });
    el.ledHint.textContent = State.selected === null
      ? 'Нажмите на диод, чтобы задать ему свой цвет'
      : 'Диод ' + (State.selected + 1) + ' — выберите цвет';
    store.set('ledColors', State.ledColors);
    store.set('ledMode', State.ledMode);
    markActiveChip();
    paintRing(State.ledMode === 'custom' ? State.ledColors : composeColors());
  }

  function applySelected(hex) {
    if (State.selected === null) return false;
    State.color = hex.toUpperCase();
    State.ledColors[State.selected] = State.color;
    State.ledMode = 'custom';
    el.colorPicker.value = State.color.toLowerCase();
    el.colorCode.textContent = State.color;
    store.set('color', State.color);
    store.set('ledColors', State.ledColors);
    store.set('ledMode', 'custom');
    paintRing(State.ledColors);
    markActiveChip();
    ensureRingBacklight();
    pushRing();
    return true;
  }

  function stopLedAnimation() {
    if (State.ledAnim && State.ledAnim.timer) clearInterval(State.ledAnim.timer);
    State.ledAnim = null;
    if (ledTimer) {
      clearTimeout(ledTimer);
      ledTimer = null;
    }
    ledPending = false;
    stopRingBlink();
  }

  function stopFirmwareRingAnim() {
    if (!State.ringAnimName && !State.ringPreview) return Promise.resolve();
    State.ringAnimName = null;
    State.ringPreview = null;
    markRingAnim(null);
    return cgi('display.py', { ring_anim_stop: 1, keep: 1 },
      { timeout: 8000, silent: true }).catch(function () {});
  }

  function stopRingBlink() {
    if (State.blinkTimer) {
      clearInterval(State.blinkTimer);
      State.blinkTimer = null;
    }
  }

  function scaleHex(hex, factor) {
    var rgb = hexToRgb(hex);
    function channel(value) {
      var text = Math.max(0, Math.min(255, Math.round(value * factor))).toString(16);
      return text.length < 2 ? '0' + text : text;
    }
    return '#' + channel(rgb.r) + channel(rgb.g) + channel(rgb.b);
  }

  /* Кадры кольца: прямой канал /ring → state-демон → Luna.
     Раньше каждый кадр запускал CGI-процесс, из-за этого анимация шла рывками. */
  var ringDirectOk = true;
  var ringBusy = false;
  var ringPending = null;

  function nativeLightActive() {
    return !!State.playing || (State.alice && State.alice !== 'IDLE');
  }

  function stopCustomRingForNative() {
    if (State.ledMode === 'off' && !State.ledAnim &&
        !State.ringAnimName && !State.ringPreview) return;
    stopLedAnimation();
    State.ledAnim = null;
    State.ringPreview = null;
    State.ringAnimName = null;
    State.ringMusicActive = false;
    State.ledMode = 'off';
    State.selected = null;
    store.set('ledMode', 'off');
    ringDots.forEach(function (dot) { dot.classList.remove('sel'); });
    if (el.ledHint) el.ledHint.textContent = 'Кольцом управляет станция';
    cgi('display.py', { ring_anim_stop: 1, keep: 1 }, { timeout: 8000, silent: true })
      .catch(function () {});
    markActiveChip();
  }

  function ringFrame(colors) {
    if (nativeLightActive()) {
      if (State.ledMode !== 'off') stopCustomRingForNative();
      return;
    }
    if (ringBusy) {
      ringPending = colors;
      return;
    }
    ringBusy = true;
    var payload = colors.slice();
    var send;
    if (ringDirectOk) {
      send = request('/ring', { body: { colors: payload }, timeout: 4000 })
        .catch(function (err) {
          // Старый конфиг lighttpd без прокси /ring — возвращаемся к CGI.
          ringDirectOk = false;
          log('ring', 'direct', err.message, true);
          return luna('/api/led/ring', { colors: payload });
        });
    } else {
      send = luna('/api/led/ring', { colors: payload });
    }
    send.catch(function () { /* кадр потерян, следующий догонит */ })
      .finally(function () {
        ringBusy = false;
        var next = ringPending;
        ringPending = null;
        if (next) ringFrame(next);
      });
  }

  function startRingBlink() {
    stopRingBlink();
    if (State.ledMode !== 'solid' || !State.ringSpeed) return;
    var started = Date.now();
    State.blinkTimer = setInterval(function () {
      if (State.ledMode !== 'solid' || !State.ringSpeed) {
        stopRingBlink();
        return;
      }
      if (document.hidden) return;
      // Плавное «дыхание» по времени, а не по счётчику кадров: 25 fps.
      var phase = (Date.now() - started) / 1000 * State.ringSpeed * 1.2;
      var factor = 0.15 + 0.85 * (0.5 - 0.5 * Math.cos(phase));
      var color = scaleHex(State.color, factor);
      ringFrame(new Array(24).fill(color));
    }, 40);
  }

  function startLedAnimation(kind) {
    if (nativeLightActive()) {
      stopCustomRingForNative();
      toast('Во время музыки или ответа Алисы кольцом управляет станция', 'warn');
      return;
    }
    stopLedAnimation();
    stopFirmwareRingAnim();
    State.selected = null;
    ringDots.forEach(function (dot) { dot.classList.remove('sel'); });
    el.ledHint.textContent = kind === 'wave'
      ? 'Волна: цвет бежит по кольцу'
      : 'Свеча: тёплое мерцание';
    State.ledMode = kind;
    store.set('ledMode', kind);
    markActiveChip();
    ensureRingBacklight();

    var anim = { kind: kind, frame: 0, busy: false, timer: null, started: Date.now() };
    State.ledAnim = anim;

    var tick = function () {
      if (State.ledAnim !== anim) return;
      if (document.hidden) return;
      // Фаза от времени, а не от номера кадра: при 25 fps не «ускоряется»
      // и не зависит от подвисаний таймера.
      var speed = State.ringSpeed || 1;
      var seconds = (Date.now() - anim.started) / 1000 * speed;
      var frame = seconds * 7;
      var colors = kind === 'wave' ? waveColors(frame) : candleColors(frame);
      paintRing(colors, kind === 'wave' ? 'WAVE' : 'FIRE');
      ringFrame(colors);
    };

    anim.timer = setInterval(tick, 40);
    tick();
  }

  function applyColor(hex, mode) {
    if (nativeLightActive()) {
      stopCustomRingForNative();
      toast('Во время музыки или ответа Алисы кольцом управляет станция', 'warn');
      return;
    }
    stopLedAnimation();
    stopFirmwareRingAnim();
    State.color = hex.toUpperCase();
    State.ledMode = mode || 'solid';
    if (State.ledMode === 'solid') {
      State.ledColors = new Array(24).fill(State.color);
      store.set('ledColors', State.ledColors);
    }
    el.colorPicker.value = State.color.toLowerCase();
    el.colorCode.textContent = State.color;
    store.set('color', State.color);
    store.set('ledMode', State.ledMode);
    paintRing(composeColors());
    markActiveChip();
    ensureRingBacklight();
    pushRing();
    if (State.ledMode === 'solid') startRingBlink();
  }

  var ledTimer = null;
  var ledSeq = 0;
  var ledPending = false;
  var lastBacklight = 0;

  function ensureRingBacklight() {
    // Подсветка fb0 кольца могла остаться в 0 (например, старым «погасить экран»),
    // тогда диоды меняют цвет, но физически не горят.
    var now = Date.now();
    if (now - lastBacklight < 4000) return;
    lastBacklight = now;
    cgi('display.py', {
      ring_brightness: State.ringBrightness == null ? 255 : State.ringBrightness
    }, { timeout: 5000, silent: true }).catch(function () { /* тихо */ });
  }

  var ringBrightTimer = null;

  function setRingSpeed(value) {
    var speed = Math.max(0, Math.min(3, (parseInt(value, 10) || 0) / 100));
    State.ringSpeed = speed;
    el.ringSpeed.value = String(Math.round(speed * 100));
    el.ringSpeedVal.textContent = speed ? speed.toFixed(1) + '×' : 'фикс';
    store.set('animSpeed', speed);
    if (State.ledAnim) {
      startLedAnimation(State.ledAnim.kind);
    } else if (State.ledMode === 'solid') {
      startRingBlink();
    }
  }

  function loadRingSpeed() {
    var saved = Number(store.get('animSpeed'));
    setRingSpeed(Math.round((saved > 0 ? saved : 0) * 100));
  }

  function ringMusicLabel(value) {
    if (value === 'off' || !value) return 'Не менять';
    if (value === 'rainbow') return 'Радуга';
    if (value === 'gradient') return 'Градиент';
    if (value === 'wave') return 'Волна';
    if (value === 'candle') return 'Свеча';
    if (value.indexOf('anim:') === 0) {
      var name = value.slice(5);
      return RING_ANIM_LABELS[name] || name;
    }
    return value;
  }

  function renderRingMusicOptions() {
    var pop = document.getElementById('ringMusicPop');
    if (!pop) return;
    pop.innerHTML = '';
    [['off', 'Не менять'], ['rainbow', 'Радуга'], ['gradient', 'Градиент'],
      ['wave', 'Волна'], ['candle', 'Свеча']].forEach(function (pair) {
      var item = document.createElement('button');
      item.type = 'button';
      item.className = 'alarm-station-item';
      item.textContent = pair[1];
      item.setAttribute('aria-selected', State.ringMusic === pair[0] ? 'true' : 'false');
      item.addEventListener('click', function () { setRingMusic(pair[0]); });
      pop.appendChild(item);
    });
  }

  function updateRingMusicUi() {
    var name = document.getElementById('ringMusicName');
    var status = document.getElementById('ringMusicStatus');
    if (name) name.textContent = ringMusicLabel(State.ringMusic);
    if (status) status.textContent = State.ringMusicActive
      ? 'играет'
      : (State.ringMusic === 'off' ? 'не менять' : 'при музыке');
  }

  function startMusicRing() {
    // Своя подсветка при музыке отключена: кольцом управляет прошивка.
    State.ringMusic = 'off';
    return;
  }

  function stopMusicRing() {
    if (!State.ringMusicActive) return;
    var prev = State.ringMusicPrev || { mode: 'off' };
    State.ringMusicActive = false;
    stopLedAnimation();
    stopFirmwareRingAnim();
    if (prev.mode === 'wave' || prev.mode === 'candle') {
      startLedAnimation(prev.mode);
    } else if (prev.mode === 'anim' && prev.anim) {
      playRingAnim(prev.anim);
    } else if (prev.mode === 'custom') {
      State.ledMode = 'custom';
      State.ledColors = prev.colors || State.ledColors;
      paintRing(State.ledColors);
    } else if (prev.mode === 'off') {
      State.ledMode = 'off';
      paintOff();
    } else {
      applyColor(prev.color || State.color,
        prev.mode === 'rainbow' || prev.mode === 'gradient' ? prev.mode : 'solid');
    }
    State.ringMusicPrev = null;
    updateRingMusicUi();
  }

  function syncMusicRing() {
    if (State.playing) startMusicRing();
    else stopMusicRing();
  }

  function setRingMusic(value) {
    State.ringMusic = value || 'off';
    store.set('ringMusic', State.ringMusic);
    var pop = document.getElementById('ringMusicPop');
    if (pop) pop.hidden = true;
    var button = document.getElementById('btnRingMusic');
    if (button) button.setAttribute('aria-expanded', 'false');
    if (State.playing) {
      if (State.ringMusicActive) stopMusicRing();
      startMusicRing();
    }
    updateRingMusicUi();
  }

  function initRingMusic() {
    var saved = store.get('ringMusic', 'off');
    if (String(saved).indexOf('anim:') === 0) saved = 'off';
    State.ringMusic = saved === 'off' || saved === 'rainbow' || saved === 'gradient' ||
      saved === 'wave' || saved === 'candle'
      ? saved : 'off';
    updateRingMusicUi();
    var button = document.getElementById('btnRingMusic');
    var pop = document.getElementById('ringMusicPop');
    if (!button || !pop) return;
    if (pop.parentNode !== document.body) document.body.appendChild(pop);
    function placeRingMusicPop() {
      var rect = button.getBoundingClientRect();
      pop.style.left = Math.round(rect.left) + 'px';
      pop.style.top = Math.round(rect.bottom + 6) + 'px';
      pop.style.width = Math.round(rect.width) + 'px';
    }
    button.addEventListener('click', function (event) {
      event.stopPropagation();
      if (pop.hidden) {
        renderRingMusicOptions();
        placeRingMusicPop();
      }
      pop.hidden = !pop.hidden;
      if (!pop.hidden) placeHomeExtraPop();
      button.setAttribute('aria-expanded', pop.hidden ? 'false' : 'true');
    });
    window.addEventListener('resize', function () {
      if (!pop.hidden) placeHomeExtraPop();
    });
    document.addEventListener('scroll', function () {
      if (!pop.hidden) placeHomeExtraPop();
    }, true);
    pop.addEventListener('click', function (event) { event.stopPropagation(); });
    document.addEventListener('click', function (event) {
      if (!event.target.closest('#btnRingMusic') && !event.target.closest('#ringMusicPop')) {
        pop.hidden = true;
        button.setAttribute('aria-expanded', 'false');
      }
    });
    if (State.playing) startMusicRing();
  }

  function cssColorHex(value) {
    var text = String(value || '').trim();
    if (!text || text === 'transparent') return '000000';
    if (text.charAt(0) === '#') {
      var h = text.slice(1).toUpperCase();
      return h.length === 3 ? h[0] + h[0] + h[1] + h[1] + h[2] + h[2] : h;
    }
    var m = text.match(/rgba?\(([^)]+)\)/);
    if (m) {
      var p = m[1].split(',').map(function (v) { return parseInt(v, 10) || 0; });
      return rgbToHex(p[0], p[1], p[2]).slice(1);
    }
    return '000000';
  }

  function logoColors() {
    if (State.logoMode === 'off') return new Array(6).fill('000000');
    if (State.logoMode === 'purple') return new Array(6).fill('C084FC');
    if (State.logoMode === 'white') return new Array(6).fill('FFFFFF');
    if (State.ledMode === 'off') return new Array(6).fill('000000');
    var out = [];
    for (var i = 0; i < 6; i++) {
      var dot = ringDots[i * 4];
      out.push(cssColorHex(dot && dot.style.background));
    }
    return out;
  }

  function logoStatusText() {
    if (State.logoMode === 'off') return 'выключен';
    if (State.logoMode === 'purple') return 'фиолетовый';
    if (State.logoMode === 'white') return 'белый';
    return 'как кольцо';
  }

  function syncLogo() {
    if (nativeLightActive() || document.hidden || State.logoSending) return;
    var colors = logoColors();
    var key = colors.join(',');
    if (key === State.logoLast) return;
    State.logoSending = true;
    luna('/api/led/logo', { colors: colors }, { timeout: 4000 }).then(function () {
      State.logoLast = key;
      var status = document.getElementById('logoStatus');
      if (status) status.textContent = logoStatusText();
    }).catch(function () {
      var status = document.getElementById('logoStatus');
      if (status) status.textContent = 'нет связи';
    }).then(function () {
      State.logoSending = false;
    });
  }

  function initLogo() {
    var saved = store.get('logoMode', 'sync');
    State.logoMode = ['sync', 'purple', 'white', 'off'].indexOf(saved) >= 0 ? saved : 'sync';
    Array.prototype.forEach.call(document.querySelectorAll('[data-logo-mode]'), function (button) {
      button.setAttribute('aria-pressed',
        button.dataset.logoMode === State.logoMode ? 'true' : 'false');
      button.addEventListener('click', function () {
        State.logoMode = button.dataset.logoMode;
        store.set('logoMode', State.logoMode);
        State.logoLast = '';
        Array.prototype.forEach.call(document.querySelectorAll('[data-logo-mode]'), function (b) {
          b.setAttribute('aria-pressed',
            b.dataset.logoMode === State.logoMode ? 'true' : 'false');
        });
        var status = document.getElementById('logoStatus');
        if (status) status.textContent = logoStatusText();
        syncLogo();
      });
    });
    every(450, syncLogo);
    syncLogo();
  }

  function pollRingState() {
    if (document.hidden || State.hwPollBusy) return;
    if (Date.now() < State.hwHoldUntil) return;
    if (State.ledMode === 'wave' || State.ledMode === 'candle' ||
        State.ledMode === 'anim' || State.ringPreview) return;
    State.hwPollBusy = true;
    request('/ring_state', { method: 'GET', timeout: 4000, silent: true })
      .catch(function () {
        return cgi('ring_state.py', {}, { timeout: 4000, silent: true });
      }).then(function (data) {
      if (!data || !Array.isArray(data.colors) || data.colors.length !== 24) return;
      var colors = data.colors.map(function (hex) { return '#' + String(hex); });
      var key = colors.join(',');
      if (key === State.hwLast) return;
      State.hwLast = key;
      var lit = colors.some(function (hex) { return parseInt(hex.slice(1), 16) > 0; });
      if (!lit) {
        paintOff();
        if (el.ledHint) el.ledHint.textContent = 'Кольцо выключено';
        return;
      }
      paintRing(colors, 'КОЛОНКА');
      State.hwActive = true;
      if (el.ledHint) el.ledHint.textContent = 'Как на колонке';
    }).catch(function () {}).then(function () {
      State.hwPollBusy = false;
    });
  }

  function initRingStatePolling() {
    every(400, pollRingState);
    setTimeout(pollRingState, 900);
  }

  function renderYmPlaylists(items) {
    var box = document.getElementById('ymPlaylists');
    if (!box) return;
    box.innerHTML = '';
    if (!items || !items.length) {
      var empty = document.createElement('div');
      empty.className = 'seg-note';
      empty.textContent = 'Плейлисты не найдены';
      box.appendChild(empty);
      return;
    }
    items.forEach(function (item) {
      var row = document.createElement('div');
      row.className = 'ym-item';
      var cover = document.createElement('div');
      cover.className = 'ym-cover';
      if (item.cover) {
        var img = document.createElement('img');
        img.src = item.cover;
        img.alt = '';
        img.loading = 'lazy';
        cover.textContent = '';
        cover.appendChild(img);
      }
      var meta = document.createElement('div');
      meta.className = 'ym-meta';
      var title = document.createElement('div');
      title.className = 'ym-title';
      title.textContent = item.title || 'Плейлист';
      var count = document.createElement('div');
      count.className = 'ym-count';
      count.textContent = item.tracks ? item.tracks + ' треков' : 'плейлист';
      meta.appendChild(title);
      meta.appendChild(count);
      var play = document.createElement('button');
      play.className = 'btn sm';
      play.type = 'button';
      play.textContent = '▶';
      play.title = 'Включить через Алису';
      play.addEventListener('click', function () { playYmPlaylist(item); });
      row.appendChild(cover);
      row.appendChild(meta);
      row.appendChild(play);
      box.appendChild(row);
    });
  }

  function restoreYmIfNeeded() {
    if (State.ymRestored || !State.ymLoggedIn || !store.get('ymOpen', false)) return;
    State.ymRestored = true;
    var view = store.get('ymView', 'all');
    if (!view || view === 'tracks' || view === 'now') view = 'all';
    State.ymView = view;
    setTimeout(function () { ymOpen(); }, 0);
  }

  function applyYmAuth(data) {
    var status = document.getElementById('ymStatus');
    var out = document.getElementById('ymLoggedOut');
    var inn = document.getElementById('ymLoggedIn');
    var account = document.getElementById('ymAccount');
    var prov = document.getElementById('provYmStatus');
    if (data && data.oauth_url) State.ymOauthUrl = data.oauth_url;
    if (data && data.logged_in) {
      State.ymLoggedIn = true;
      if (status) status.textContent = 'подключена';
      if (prov) prov.textContent = 'подключена' + (data.login ? ' · ' + data.login : '');
      setProvDot('yandex', 'ok');
      if (out) out.hidden = true;
      if (inn) inn.hidden = false;
      if (account) account.textContent = 'Вы вошли как ' + (data.login || 'Яндекс');
      loadYmPlaylists();
      loadYmProfile();
      restoreYmIfNeeded();
    } else {
      State.ymLoggedIn = false;
      if (status) status.textContent = 'не подключена';
      if (prov) prov.textContent = 'не подключена';
      setProvDot('yandex', 'warn');
      if (out) out.hidden = false;
      if (inn) inn.hidden = true;
    }
  }

  function loadYmAuth() {
    return cgi('yandex_auth.py', {}, { timeout: 12000, silent: true })
      .then(applyYmAuth)
      .catch(function () {
        var status = document.getElementById('ymStatus');
        if (status) status.textContent = 'недоступно';
        var prov = document.getElementById('provYmStatus');
        if (prov) prov.textContent = 'недоступно';
        setProvDot('yandex', 'bad');
      });
  }

  function loadYmProfile() {
    return cgi('ymprofile.py', {}, { timeout: 12000, silent: true }).then(function (data) {
      if (!data || data.ok === false) return;
      var profile = document.querySelector('.ym-profile');
      var label = document.querySelector('.ym-profile-label');
      var name = String(data.name || data.login || '').trim();
      if (label && name) {
        // Вместо «Моя музыка» — имя из аккаунта, рядом с фото.
        label.textContent = name;
        label.title = data.login ? '@' + data.login : name;
        if (profile) profile.classList.add('has-name');
      }
      var box = document.querySelector('.ym-avatar');
      if (!box || !data.avatar) return;
      var img = new Image();
      img.className = 'ym-avatar-img';
      img.alt = name;
      img.onload = function () {
        box.textContent = '';
        box.appendChild(img);
        box.classList.add('has-photo');
        box.title = name;
      };
      img.src = data.avatar;
    }).catch(function () { /* без профиля остаётся «Моя музыка» и нота */ });
  }

  function loadYmPlaylists() {
    cgi('ymusic.py', { all_playlists: 1 }, { timeout: 25000, silent: true })
      .then(function (data) { renderYmPlaylists(data && data.playlists); })
      .catch(function () {
        renderYmPlaylists([]);
      });
  }

  function playYmPlaylist(item) {
    var title = item && item.title ? item.title : '';
    extYieldToOther();
    cgi('ymusic.py', { play: title, id: item && item.id || '' }, { timeout: 20000 })
      .then(function () { toast('Включаю: ' + title, 'ok'); })
      .catch(function (err) { toast('Яндекс Музыка: ' + err.message, 'bad'); });
  }

  function ymTime(seconds) {
    seconds = Math.max(0, Math.round(Number(seconds) || 0));
    return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
  }

  function ymCover(url, className) {
    var node;
    if (url) {
      node = document.createElement('img');
      node.src = url;
      node.alt = '';
      node.loading = 'lazy';
    } else {
      node = document.createElement('div');
      node.className = className + ' ym-cover-stub';
    }
    node.className = className;
    return node;
  }

  function ymLoadLibrary() {
    if (!State.ymLoggedIn) {
      ymRenderMessage('Войдите в Яндекс Музыку в блоке ниже.');
      return;
    }
    ymRenderMessage('Загружаю музыку…');
    cgi('ymusic.py', { playlists: 1 }, { timeout: 20000, silent: true })
      .then(function (data) {
        State.ymPlaylists = (data && data.playlists) || [];
        ymRender();
        cgi('ymusic.py', { my_playlists: 1 }, { timeout: 20000, silent: true })
          .then(function (mine) {
            State.ymMine = (mine && mine.playlists) || [];
            ymRender();
          })
          .catch(function () { /* сохранённые плейлисты необязательны */ });
      })
      .catch(function (err) {
        ymRenderMessage('Не удалось загрузить: ' + err.message);
      });
  }

  function ymLoadLiked() {
    if (!State.ymLoggedIn) return;
    if (State.ymLiked.length) { ymRender(); return; }
    ymRenderMessage('Загружаю избранное…');
    cgi('ymusic.py', { liked: 1 }, { timeout: 25000, silent: true })
      .then(function (data) {
        State.ymLiked = (data && data.tracks) || [];
        ymRender();
      })
      .catch(function (err) { ymRenderMessage('Избранное: ' + err.message); });
  }

  function ymOpenPlaylist(item) {
    State.ymSelected = item;
    State.ymView = 'tracks';
    ymSetFilterButtons();
    ymRenderMessage('Загружаю треки…');
    cgi('ymusic.py', { playlist: item.id }, { timeout: 25000, silent: true })
      .then(function (data) {
        State.ymTracks = (data && data.tracks) || [];
        ymRender();
      })
      .catch(function (err) { ymRenderMessage('Плейлист: ' + err.message); });
  }

  function ymPlayTrack(track) {
    extYieldToOther();
    if (typeof zvukShowNow === 'function') zvukShowNow(null);
    cgi('ymusic.py', {
      play: track.title || 'трек', id: track.id || '', type: 'track'
    }, { timeout: 20000 })
      .then(function () {
        toast('Включаю: ' + (track.title || 'трек'), 'ok');
        setTimeout(ymOpenNow, 700);
      })
      .catch(function (err) { toast('Яндекс Музыка: ' + err.message, 'bad'); });
  }

  function ymRenderMessage(text) {
    var body = document.getElementById('ymBody');
    if (!body) return;
    body.innerHTML = '';
    var note = document.createElement('div');
    note.className = 'ym-empty';
    note.textContent = text;
    body.appendChild(note);
  }

  function ymSetFilterButtons() {
    var filters = document.getElementById('ymFilters');
    if (!filters) return;
    Array.prototype.forEach.call(filters.querySelectorAll('[data-ym-view]'), function (button) {
      button.setAttribute('aria-pressed',
        String(button.dataset.ymView === State.ymView));
    });
  }

  function ymUpdatePromo() {
    var promo = document.getElementById('ymPromo');
    var cover = document.getElementById('ymPromoCover');
    var title = document.getElementById('ymPromoTitle');
    var sub = document.getElementById('ymPromoSub');
    if (!promo || !cover || !title || !sub) return;
    if (State.ymView !== 'all' || State.ymSearch.trim().length >= 2) {
      promo.hidden = true;
      return;
    }
    var item = State.ymPlaylists[0];
    if (!item) {
      promo.hidden = true;
      return;
    }
    promo.hidden = false;
    cover.style.backgroundImage = item.cover
      ? 'linear-gradient(180deg,rgba(0,0,0,.05),rgba(0,0,0,.35)),url("' + item.cover + '")'
      : 'linear-gradient(140deg,#5b3bb5,#ff7043)';
    title.textContent = item.title || 'Музыка для вас';
    sub.textContent = (item.tracks || 0) + ' треков · персональная подборка';
    promo.onclick = function () { ymOpenPlaylist(item); };
    promo.setAttribute('role', 'button');
    promo.tabIndex = 0;
  }

  function ymRender() {
    var body = document.getElementById('ymBody');
    if (!body) return;
    body.innerHTML = '';
    ymSetFilterButtons();
    var query = (State.ymSearch || '').trim().toLowerCase();
    var view = State.ymView;
    var pageTitle = document.getElementById('ymTitle');
    if (pageTitle) {
      pageTitle.textContent = view === 'tracks'
        ? (State.ymSelected ? State.ymSelected.title : 'Треки')
        : view === 'liked' ? 'Избранное'
          : view === 'playlists' ? 'Плейлисты'
            : view === 'wave' ? 'Моя волна'
              : view === 'trends' ? 'Тренды'
                : view === 'audio' ? 'Книги' : 'Главное';
    }
    if (query.length >= 2) {
      if (pageTitle) pageTitle.textContent = 'Поиск';
    }
    ymUpdatePromo();
    if (query.length >= 2) {
      ymRenderGlobalSearch(body, query);
      return;
    }
    if (view === 'audio') {
      ymRenderAudio(body, query);
      return;
    }
    if (view === 'wave') {
      ymRenderWave(body);
      return;
    }
    if (view === 'trends') {
      ymRenderTrends(body, query);
      return;
    }
    if (view === 'liked' && !State.ymLiked.length) {
      ymLoadLiked();
      return;
    }

    var section = document.createElement('div');
    var title = document.createElement('div');
    title.className = 'ym-section-title';
    section.appendChild(title);

    if (view === 'tracks') {
      title.hidden = true;
      if (!State.ymSelected) {
        ymRenderMessage('Откройте плейлист, чтобы увидеть треки.');
        return;
      }
      title.textContent = State.ymSelected.title || 'Треки плейлиста';
      var tracks = State.ymTracks.filter(function (track) {
        return !query || ((track.title || '') + ' ' + (track.artist || '')).toLowerCase().indexOf(query) !== -1;
      });
      if (!tracks.length) {
        section.appendChild(ymEmptyNode(query ? 'Ничего не найдено.' : 'В плейлисте нет треков.'));
      } else {
        section.appendChild(ymTrackList(tracks));
      }
      body.appendChild(section);
      return;
    }

    if (view === 'liked') {
      title.textContent = 'Избранное';
      var liked = State.ymLiked.filter(function (track) {
        return !query || ((track.title || '') + ' ' + (track.artist || '')).toLowerCase().indexOf(query) !== -1;
      });
      if (!liked.length) section.appendChild(ymEmptyNode(query ? 'Ничего не найдено.' : 'В избранном пока пусто.'));
      else section.appendChild(ymTrackList(liked));
      body.appendChild(section);
      return;
    }

    if (State.ymMine.length) {
      body.appendChild(ymSearchSection('Мои плейлисты',
        ymSearchCards(State.ymMine, ymOpenPlaylist)));
    }
    title.textContent = 'Умные плейлисты для вас';
    var playlists = State.ymPlaylists.filter(function (item) {
      return !query || String(item.title || '').toLowerCase().indexOf(query) !== -1;
    });
    if (!playlists.length) {
      section.appendChild(ymEmptyNode(query ? 'Ничего не найдено.' : 'Плейлисты не найдены.'));
      body.appendChild(section);
      return;
    }
    var grid = document.createElement('div');
    grid.className = 'ym-grid';
    playlists.forEach(function (item) {
      var card = document.createElement('div');
      card.className = 'ym-card';
      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      card.appendChild(ymCover(item.cover, 'ym-card-cover'));
      var name = document.createElement('b');
      name.textContent = item.title || 'Плейлист';
      var count = document.createElement('span');
      count.textContent = (item.tracks || 0) + ' треков';
      card.appendChild(name);
      card.appendChild(count);
      card.addEventListener('click', function () { ymOpenPlaylist(item); });
      card.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          ymOpenPlaylist(item);
        }
      });
      grid.appendChild(card);
    });
    section.appendChild(grid);
    body.appendChild(section);
  }

  function ymEmptyNode(text) {
    var note = document.createElement('div');
    note.className = 'ym-empty';
    note.textContent = text;
    return note;
  }

  function ymRenderAudio(body, query) {
    if (!State.ymAudio.length && !State.ymBooks.length) { ymLoadAudio(); return; }
    var wrap = document.createElement('div');
    var books = State.ymBooks.filter(function (item) {
      return !query || ((item.title || '') + ' ' + (item.author || '')).toLowerCase().indexOf(query) !== -1;
    });
    if (books.length) {
      wrap.appendChild(ymSearchSection('Аудиокниги', ymSearchCards(books, ymOpenBook)));
    }
    var book = document.createElement('a');
    book.className = 'ym-audiobook-link';
    book.href = 'https://books.yandex.ru/audiobooks';
    book.target = '_blank';
    book.rel = 'noopener';
    book.innerHTML = '<b>Все аудиокниги</b><span>Открыть каталог Яндекс Книг</span>';
    wrap.appendChild(book);
    var title = document.createElement('div');
    title.className = 'ym-section-title';
    title.textContent = 'Подкасты';
    wrap.appendChild(title);
    var grid = document.createElement('div');
    grid.className = 'ym-grid ym-audio-grid';
    State.ymAudio.filter(function (item) {
      return !query || String(item.title || '').toLowerCase().indexOf(query) !== -1;
    }).forEach(function (item) {
      var card = document.createElement('a');
      card.className = 'ym-card ym-audio-card';
      card.href = 'https://music.yandex.ru/podcast/' + encodeURIComponent(item.id);
      card.target = '_blank';
      card.rel = 'noopener';
      card.appendChild(ymCover(item.cover, 'ym-card-cover'));
      var name = document.createElement('b');
      name.textContent = item.title;
      card.appendChild(name);
      var desc = document.createElement('span');
      desc.textContent = item.description || 'Подкаст';
      card.appendChild(desc);
      grid.appendChild(card);
    });
    wrap.appendChild(grid);
    body.appendChild(wrap);
  }

  function ymOpenBook(item) {
    window.open(item.url || ('https://books.yandex.ru/audiobooks/' + item.id), '_blank', 'noopener');
  }

  function ymLoadAudio() {
    if (State.ymAudio.length) { ymRender(); return; }
    ymRenderMessage('Загружаю книги…');
    cgi('ymusic.py', { podcasts: 1 }, { timeout: 20000, silent: true })
      .then(function (data) {
        State.ymAudio = (data && data.podcasts) || [];
        ymRender();
        cgi('ymusic.py', { books: 1 }, { timeout: 25000, silent: true })
          .then(function (books) {
            State.ymBooks = (books && books.books) || [];
            ymRender();
          })
          .catch(function () { /* книги необязательны */ });
      })
      .catch(function (err) { ymRenderMessage('Книги: ' + err.message); });
  }

  function ymSearchSection(title, node) {
    var section = document.createElement('section');
    section.className = 'ym-search-section';
    var caption = document.createElement('div');
    caption.className = 'ym-section-title';
    caption.textContent = title;
    section.appendChild(caption);
    section.appendChild(node);
    return section;
  }

  function ymSearchCards(items, onOpen) {
    var grid = document.createElement('div');
    grid.className = 'ym-grid';
    items.forEach(function (item) {
      var card = document.createElement('div');
      card.className = 'ym-card';
      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      card.appendChild(ymCover(item.cover, 'ym-card-cover'));
      var title = document.createElement('b');
      title.textContent = item.title;
      card.appendChild(title);
      var sub = document.createElement('span');
      sub.textContent = item.artist || item.author || item.description ||
        (item.tracks ? item.tracks + ' треков' : '');
      card.appendChild(sub);
      if (onOpen) {
        card.addEventListener('click', function () { onOpen(item); });
        card.addEventListener('keydown', function (event) {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onOpen(item);
          }
        });
      }
      grid.appendChild(card);
    });
    return grid;
  }

  function ymDoSearch(query) {
    if (State.ymSearchPending === query) return;
    State.ymSearchPending = query;
    cgi('ymusic.py', { search: query }, { timeout: 25000, silent: true })
      .then(function (data) {
        if (State.ymSearch.trim().toLowerCase() !== query) return;
        State.ymSearchResults = {
          query: query,
          tracks: (data && data.tracks) || [],
          albums: (data && data.albums) || [],
          playlists: (data && data.playlists) || [],
          artists: (data && data.artists) || [],
          podcasts: (data && data.podcasts) || [],
          books: (data && data.books) || []
        };
        State.ymSearchPending = '';
        ymRender();
      })
      .catch(function (err) {
        State.ymSearchPending = '';
        ymRenderMessage('Поиск: ' + err.message);
      });
  }

  function ymRenderGlobalSearch(body, query) {
    var results = State.ymSearchResults;
    if (!results || results.query !== query) {
      ymDoSearch(query);
      ymRenderMessage('Ищу «' + query + '»…');
      return;
    }
    var filter = State.ymSearchFilter || 'all';
    var chips = document.createElement('div');
    chips.className = 'ym-search-filters';
    [
      ['all', 'Все'], ['tracks', 'Треки'], ['albums', 'Альбомы'],
      ['playlists', 'Плейлисты'], ['artists', 'Артисты'],
      ['podcasts', 'Подкасты'], ['books', 'Аудиокниги']
    ].forEach(function (pair) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'ym-search-chip';
      button.textContent = pair[1];
      button.setAttribute('aria-pressed', String(filter === pair[0]));
      button.addEventListener('click', function () {
        State.ymSearchFilter = pair[0];
        ymRender();
      });
      chips.appendChild(button);
    });
    body.appendChild(chips);

    var found = false;
    function add(key, title, node, count) {
      if (!count || (filter !== 'all' && filter !== key)) return;
      body.appendChild(ymSearchSection(title, node));
      found = true;
    }
    add('tracks', 'Треки', ymTrackList(results.tracks), results.tracks.length);
    add('albums', 'Альбомы', ymSearchCards(results.albums, ymOpenAlbum), results.albums.length);
    add('playlists', 'Плейлисты', ymSearchCards(results.playlists, ymOpenPlaylist), results.playlists.length);
    add('artists', 'Артисты', ymSearchCards(results.artists), results.artists.length);
    add('podcasts', 'Подкасты', ymSearchCards(results.podcasts), results.podcasts.length);
    add('books', 'Аудиокниги', ymSearchCards(results.books || [], ymOpenBook),
      (results.books || []).length);
    if (!found) body.appendChild(ymEmptyNode('В этом разделе ничего не найдено.'));
  }

  function ymOpenAlbum(album) {
    State.ymSelected = { title: album.title || 'Альбом' };
    State.ymView = 'tracks';
    ymSetFilterButtons();
    ymRenderMessage('Загружаю альбом…');
    cgi('ymusic.py', { album: album.id }, { timeout: 25000, silent: true })
      .then(function (data) {
        State.ymTracks = (data && data.tracks) || [];
        ymRender();
      })
      .catch(function (err) { ymRenderMessage('Альбом: ' + err.message); });
  }

  function ymLoadWave() {
    if (State.ymWave) { ymRender(); return; }
    ymRenderMessage('Загружаю настройки волны…');
    cgi('ymusic.py', { wave: 1 }, { timeout: 20000, silent: true })
      .then(function (data) {
        State.ymWave = {
          settings: (data && data.settings) || {},
          restrictions: (data && data.restrictions) || {}
        };
        State.ymWaveSettings = {
          mood: Number(State.ymWave.settings.mood) || 2,
          energy: Number(State.ymWave.settings.energy) || 2,
          language: State.ymWave.settings.language || 'any',
          diversity: State.ymWave.settings.diversity || 'default'
        };
        ymRender();
      })
      .catch(function (err) { ymRenderMessage('Моя волна: ' + err.message); });
  }

  function ymLoadTrends() {
    if (State.ymTrends.length) { ymRender(); return; }
    ymRenderMessage('Загружаю тренды…');
    cgi('ymusic.py', { trends: 1 }, { timeout: 20000, silent: true })
      .then(function (data) {
        State.ymTrends = (data && data.tracks) || [];
        ymRender();
      })
      .catch(function (err) { ymRenderMessage('Тренды: ' + err.message); });
  }

  function ymRenderTrends(body, query) {
    if (!State.ymTrends.length) { ymLoadTrends(); return; }
    var tracks = State.ymTrends.filter(function (track) {
      return !query || ((track.title || '') + ' ' + (track.artist || '')).toLowerCase().indexOf(query) !== -1;
    });
    var section = document.createElement('div');
    var title = document.createElement('div');
    title.className = 'ym-section-title';
    title.textContent = 'Популярно сейчас';
    section.appendChild(title);
    section.appendChild(tracks.length ? ymTrackList(tracks) : ymEmptyNode('Ничего не найдено.'));
    body.appendChild(section);
  }

  function ymChoice(value, label, active, onPick, hint) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'ym-choice';
    button.textContent = label;
    button.setAttribute('aria-pressed', String(active));
    if (hint) {
      button.title = hint;
      button.setAttribute('aria-label', hint);
    }
    button.addEventListener('click', function () { onPick(value); });
    return button;
  }

  function ymRenderWave(body) {
    if (!State.ymWave) { ymLoadWave(); return; }
    var wave = State.ymWave;
    var chosen = State.ymWaveSettings;
    var restrictions = wave.restrictions || {};
    var wrap = document.createElement('div');
    wrap.className = 'ym-wave';

    var hero = document.createElement('div');
    hero.className = 'ym-wave-hero';
    var art = document.createElement('div');
    art.className = 'ym-wave-art';
    art.innerHTML = '<span>МОЯ</span><b>волна</b>';
    var copy = document.createElement('div');
    copy.className = 'ym-wave-copy';
    var heading = document.createElement('h3');
    heading.textContent = 'Настроение под вас';
    var note = document.createElement('p');
    note.textContent = 'Настроение: 1 — грустнее, 4 — веселее. Энергичность: 1 — спокойнее, 4 — бодрее.';
    var play = document.createElement('button');
    play.type = 'button';
    play.className = 'ym-wave-play';
    play.textContent = 'Включить волну';
    play.addEventListener('click', ymApplyWave);
    copy.appendChild(heading);
    copy.appendChild(note);
    copy.appendChild(play);
    hero.appendChild(art);
    hero.appendChild(copy);

    var settingsBox = document.createElement('div');
    settingsBox.className = 'ym-wave-settings';

    function addGroup(label, control, extra) {
      var group = document.createElement('div');
      group.className = 'ym-choice-group';
      var caption = document.createElement('span');
      caption.className = 'ym-choice-label';
      caption.textContent = label;
      group.appendChild(caption);
      group.appendChild(control);
      if (extra) group.appendChild(extra);
      settingsBox.appendChild(group);
    }

    var lang = document.createElement('div');
    lang.className = 'ym-choice-row';
    ((restrictions.language || {}).possibleValues || [
      { value: 'any', name: 'Любой' }, { value: 'russian', name: 'Русский' }
    ]).forEach(function (item) {
      lang.appendChild(ymChoice(item.value, item.name || item.value,
        chosen.language === item.value, function (value) {
          chosen.language = value;
          ymRender();
        }));
    });
    addGroup((restrictions.language || {}).name || 'По языку', lang);

    function scaleGroup(key, restriction) {
      var row = document.createElement('div');
      row.className = 'ym-choice-row';
      var min = (restriction || {}).min || { value: 1, name: 'Меньше' };
      var max = (restriction || {}).max || { value: 4, name: 'Больше' };
      for (var value = min.value; value <= max.value; value += 1) {
        row.appendChild(ymChoice(value, String(value), chosen[key] === value,
          function (picked) {
            chosen[key] = picked;
            ymRender();
          }, (restriction || {}).name + ': ' + value + ' из ' + max.value +
            ' — ' + (value <= min.value ? min.name : value >= max.value ? max.name : 'среднее')));
      }
      var legend = document.createElement('div');
      legend.className = 'ym-scale-legend';
      var left = document.createElement('span');
      left.textContent = min.name;
      var right = document.createElement('span');
      right.textContent = max.name;
      legend.appendChild(left);
      legend.appendChild(right);
      addGroup((restriction || {}).name || key, row, legend);
    }
    scaleGroup('mood', restrictions.mood);
    scaleGroup('energy', restrictions.energy);

    var diversity = document.createElement('div');
    diversity.className = 'ym-choice-row';
    ((restrictions.diversity || {}).possibleValues || [
      { value: 'default', name: 'Все' }, { value: 'diverse', name: 'Редкие' },
      { value: 'favorite', name: 'Любимые' }, { value: 'popular', name: 'Популярные' }
    ]).forEach(function (item) {
      diversity.appendChild(ymChoice(item.value, item.name || item.value,
        chosen.diversity === item.value, function (value) {
          chosen.diversity = value;
          ymRender();
        }));
    });
    addGroup((restrictions.diversity || {}).name || 'По характеру', diversity);

    wrap.appendChild(hero);
    wrap.appendChild(settingsBox);
    body.appendChild(wrap);
  }

  function ymApplyWave() {
    var chosen = State.ymWaveSettings;
    if (!chosen) return;
    extYieldToOther();
    cgi('ymusic.py', {
      wave_play: 1, mood: chosen.mood, energy: chosen.energy,
      language: chosen.language, diversity: chosen.diversity
    }, { timeout: 20000 }).then(function () {
      toast('Включаю Мою волну', 'ok');
      ymOpenNow();
    }).catch(function (err) { toast('Моя волна: ' + err.message, 'bad'); });
  }

  function ymTrackList(tracks) {
    var list = document.createElement('div');
    tracks.forEach(function (track) {
      var row = document.createElement('div');
      row.className = 'ym-track';
      row.appendChild(ymCover(track.cover, 'ym-track-cover'));
      var meta = document.createElement('div');
      meta.className = 'ym-track-meta';
      var name = document.createElement('b');
      name.textContent = track.title || 'Трек';
      var artist = document.createElement('span');
      artist.textContent = track.artist || 'Яндекс Музыка';
      meta.appendChild(name);
      meta.appendChild(artist);
      row.appendChild(meta);
      var duration = document.createElement('span');
      duration.className = 'ym-duration';
      duration.textContent = ymTime(track.duration);
      row.appendChild(duration);
      // Вся строка — кнопка воспроизведения: отдельный «плей» больше не нужен.
      row.setAttribute('role', 'button');
      row.tabIndex = 0;
      row.title = 'Воспроизвести';
      row.addEventListener('click', function () { ymPlayTrack(track); });
      row.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          ymPlayTrack(track);
        }
      });
      list.appendChild(row);
    });
    return list;
  }

  function ymSyncNow() {
    var now = document.getElementById('ymNow');
    if (!now || now.hidden) return;
    var cover = document.getElementById('ymNowCover');
    var bg = document.getElementById('ymNowBg');
    var title = document.getElementById('ymNowTitle');
    var artist = document.getElementById('ymNowArtist');
    var play = document.getElementById('ymNowPlay');
    var seek = document.getElementById('ymNowSeek');
    var pos = document.getElementById('ymNowPos');
    var dur = document.getElementById('ymNowDur');
    var volume = document.getElementById('ymNowVolume');
    var volumeVal = document.getElementById('ymNowVolumeVal');
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
    if (bg) {
      bg.style.backgroundImage = State.mediaCover
        ? 'url("' + State.mediaCover + '")' : 'linear-gradient(140deg,#2a2a31,#101014)';
    }
    if (play) {
      var use = play.querySelector('use');
      if (use) use.setAttribute('href', State.playing ? '#i-pause' : '#i-play');
      play.setAttribute('aria-label', State.playing ? 'Пауза' : 'Воспроизвести');
    }
    if (seek) {
      seek.max = String(Math.max(1, Math.round(duration)));
      if (!State.ymSeeking) seek.value = String(Math.min(duration, current));
    }
    if (pos) pos.textContent = ymTime(current);
    if (dur) dur.textContent = ymTime(duration);
    if (volume && !State.ymVolumeBusy) volume.value = String(State.volume || 0);
    if (volumeVal) volumeVal.textContent = (State.volume || 0) + '%';
  }

  var ymNowTimer = null;

  function ymOpenNow() {
    if (!State.mediaTitle) {
      toast('Сейчас ничего не играет', 'warn');
      return;
    }
    var now = document.getElementById('ymNow');
    if (!now) return;
    clearTimeout(ymNowTimer);
    now.hidden = false;
    now.classList.remove('now-closing');
    now.classList.add('now-entering');
    // Даём браузеру зафиксировать стартовое состояние, затем плавно
    // поднимаем плеер снизу.
    void now.offsetWidth;
    requestAnimationFrame(function () {
      now.classList.remove('now-entering');
    });
    var content = document.querySelector('.ym-content');
    if (content) content.classList.add('now-open');
    var dialog = document.getElementById('ymDlg');
    if (dialog) dialog.classList.add('now-open');
    State.ymNowOpen = true;
    ymSyncNow();
    if (State.playerKind === 'Track' && !State.lyricsLines.length) loadLyrics(true);
    else highlightNowLyrics(true);
  }

  function ymCloseNow(instant) {
    var now = document.getElementById('ymNow');
    if (!now || now.hidden) return;
    var content = document.querySelector('.ym-content');
    var dialog = document.getElementById('ymDlg');
    clearTimeout(ymNowTimer);
    var finish = function () {
      now.hidden = true;
      now.classList.remove('now-closing', 'now-entering');
      if (content) content.classList.remove('now-open');
      if (dialog) dialog.classList.remove('now-open');
      State.ymNowOpen = false;
    };
    if (instant) {
      finish();
      return;
    }
    now.classList.remove('now-entering');
    now.classList.add('now-closing');
    ymNowTimer = setTimeout(finish, 360);
  }

  function ymSeekTo(seconds) {
    var duration = Number(State.mediaDuration) || 0;
    if (!duration) return;
    var target = Math.max(0, Math.min(duration, Number(seconds) || 0));
    State.mediaProgress = target;
    if (typeof seekMedia === 'function') {
      seekMedia(target / duration * 1000);
      return;
    }
    cgi('media.py', {
      action: 'seek', position: Math.round(target)
    }, { timeout: 10000, silent: true }).catch(function (err) {
      toast('Перемотка: ' + err.message, 'bad');
    });
  }

  function ymSyncBar() {
    var title = document.getElementById('ymBarTitle');
    var sub = document.getElementById('ymBarSub');
    var cover = document.getElementById('ymBarCover');
    var play = document.getElementById('ymBarPlay');
    var time = document.getElementById('ymBarTime');
    var fill = document.getElementById('ymBarFill');
    if (!title) return;
    title.textContent = State.mediaTitle || 'Ничего не играет';
    sub.textContent = State.mediaArtist || (State.mediaTitle ? 'Яндекс Музыка' : 'Выберите плейлист или трек');
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
      play.setAttribute('aria-label', State.playing ? 'Пауза' : 'Воспроизвести');
    }
    var duration = State.mediaDuration || 0;
    var current = State.mediaProgress || 0;
    if (time) time.textContent = ymTime(current) + ' / ' + ymTime(duration);
    if (fill) fill.style.width = duration ? Math.min(100, current / duration * 100) + '%' : '0%';
    var seek = document.getElementById('ymBarSeek');
    if (seek) {
      seek.max = String(Math.max(1, Math.round(duration)));
      if (!State.ymSeeking) seek.value = String(Math.max(0, Math.min(duration, current)));
    }
    var volume = document.getElementById('ymBarVolume');
    if (volume && !State.ymVolumeBusy) volume.value = String(State.volume || 0);
    var volumeVal = document.getElementById('ymBarVolumeVal');
    if (volumeVal) volumeVal.textContent = (State.volume || 0) + '%';
    updateVolumeIcons();
    ymSyncNow();
  }

  var ymCloseTimer = null;

  function closeYmDialog() {
    var dialog = document.getElementById('ymDlg');
    if (!dialog || !dialog.open || dialog.classList.contains('closing')) {
      document.body.classList.remove('ym-open');
      return;
    }
    dialog.classList.add('closing');
    clearTimeout(ymCloseTimer);
    ymCloseTimer = setTimeout(function () {
      if (dialog.open) dialog.close();
      document.body.classList.remove('ym-open');
    }, 170);
  }

  function ymOpen() {
    var dialog = document.getElementById('ymDlg');
    if (!dialog) return;
    if (!State.ymLoggedIn) {
      toast('Сначала войдите в Яндекс Музыку', 'warn');
      showTab('sound');
      var providerTab = document.querySelector('#provTabs .prov-tab[data-provider="yandex"]');
      if (providerTab) providerTab.click();
      var auth = document.getElementById('ymAuth');
      if (auth) {
        auth.open = true;
        var card = auth.closest('.c-providers');
        if (card && card.scrollIntoView) {
          card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
      return;
    }
    clearTimeout(ymCloseTimer);
    dialog.classList.remove('closing');
    if (!dialog.open) dialog.showModal();
    document.body.classList.add('ym-open');
    store.set('ymOpen', true);
    store.set('ymView', State.ymView);
    ymCloseNow(true);
    ymSyncBar();
    ymLoadLibrary();
  }

  function initLyricsPlayer() {
    [['lyrPlayerPrev', 'btnPrev'], ['lyrPlayerPlay', 'btnPlay'],
      ['lyrPlayerNext', 'btnNext'], ['lyrPlayerLike', 'btnLike'],
      ['lyrPlayerDislike', 'btnDislike']
    ].forEach(function (pair) {
      var button = document.getElementById(pair[0]);
      var target = document.getElementById(pair[1]);
      if (button && target) button.addEventListener('click', function () { target.click(); });
    });
    var seek = document.getElementById('lyrPlayerSeek');
    if (seek) {
      seek.addEventListener('input', function () {
        State.lyrSeeking = true;
        var duration = Number(State.mediaDuration) || 0;
        var pos = document.getElementById('lyrPlayerPos');
        if (pos && duration) pos.textContent = fmtTime(Number(seek.value) / 1000 * duration);
      });
      seek.addEventListener('change', function () {
        State.lyrSeeking = false;
        var duration = Number(State.mediaDuration) || 0;
        if (duration) State.mediaProgress = Number(seek.value) / 1000 * duration;
        seekMedia(Number(seek.value));
        syncLyricsPlayer();
      });
    }
    var volume = document.getElementById('lyrPlayerVolume');
    if (volume) {
      volume.addEventListener('input', function () {
        State.ymVolumeBusy = true;
        var value = Math.max(0, Math.min(100, parseInt(volume.value, 10) || 0));
        var label = document.getElementById('lyrPlayerVolumeVal');
        if (label) label.textContent = value + '%';
        var main = document.getElementById('volume');
        if (main) {
          main.value = String(value);
          main.dispatchEvent(new Event('input', { bubbles: true }));
        }
        setTimeout(function () { State.ymVolumeBusy = false; }, 400);
      });
    }
  }

  function initYmDialog() {
    var dialog = document.getElementById('ymDlg');
    if (!dialog) return;
    var open = document.getElementById('btnYmExpand');
    if (open) {
      open.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        ymOpen();
      });
      open.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          event.stopPropagation();
          ymOpen();
        }
      });
    }
    var close = document.getElementById('btnYmDlgClose');
    if (close) close.addEventListener('click', closeYmDialog);
    dialog.addEventListener('cancel', function (event) {
      event.preventDefault();
      // Esc в развёрнутом плеере сначала сворачивает только плеер;
      // повторный Esc уже закрывает всю Яндекс Музыку.
      if (State.ymNowOpen) ymCloseNow();
      else closeYmDialog();
    });
    dialog.addEventListener('close', function () {
      State.ymSearch = '';
      dialog.classList.remove('closing');
      document.body.classList.remove('ym-open');
      store.set('ymOpen', false);
      ymCloseNow(true);
    });
    var back = document.getElementById('ymNowBack');
    if (back) back.addEventListener('click', function () { ymCloseNow(); });
    var closeAll = document.getElementById('ymNowCloseAll');
    if (closeAll) closeAll.addEventListener('click', closeYmDialog);

    // Esc: сначала сворачиваем развёрнутый плеер, второй Esc закрывает
    // Яндекс Музыку. Перехватываем в capture, чтобы нативный cancel
    // диалога не закрыл всё окно сразу.
    document.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape' || !dialog.open) return;
      var dialogs = document.querySelectorAll('dialog[open]');
      if (dialogs.length && dialogs[dialogs.length - 1] !== dialog) return;
      var now = document.getElementById('ymNow');
      var nowOpen = now && !now.hidden && !now.classList.contains('now-closing');
      event.preventDefault();
      event.stopPropagation();
      if (nowOpen) ymCloseNow();
      else closeYmDialog();
    }, true);
    var barArt = document.getElementById('ymBarArt');
    var barMeta = document.querySelector('.ym-bar-meta');
    [barArt, barMeta].forEach(function (node) {
      if (node) {
        node.style.cursor = 'pointer';
        node.addEventListener('click', ymOpenNow);
      }
    });
    [['ymNowPrev', 'btnPrev'], ['ymNowPlay', 'btnPlay'], ['ymNowNext', 'btnNext']
    ].forEach(function (pair) {
      var button = document.getElementById(pair[0]);
      var target = document.getElementById(pair[1]);
      if (button && target) button.addEventListener('click', function () { target.click(); });
    });
    // Лайк/дизлайк зовём напрямую: кнопки вне модального диалога
    // становятся inert, и программный click по ним не срабатывает.
    var ymNowLike = document.getElementById('ymNowLike');
    if (ymNowLike) ymNowLike.addEventListener('click', function () { toggleLike(); });
    var ymNowDislike = document.getElementById('ymNowDislike');
    if (ymNowDislike) ymNowDislike.addEventListener('click', function () { dislikeTrack(); });
    var ymNowQueue = document.getElementById('ymNowQueue');
    if (ymNowQueue) ymNowQueue.addEventListener('click', function () { openQueue(true); });
    var nowLyricsBox = document.getElementById('ymNowLyricsBox');
    if (nowLyricsBox) {
      // Клик по строке — перемотка на её время (как в окне текста).
      nowLyricsBox.addEventListener('click', function (event) {
        var line = event.target.closest('.ym-now-line');
        if (!line || line.classList.contains('plain')) return;
        var moment = parseFloat(line.dataset.t);
        if (isNaN(moment)) return;
        ymSeekTo(moment);
        highlightNowLyrics(true);
      });
    }
    var nowSeek = document.getElementById('ymNowSeek');
    if (nowSeek) {
      nowSeek.addEventListener('input', function () {
        State.ymSeeking = true;
        var pos = document.getElementById('ymNowPos');
        if (pos) pos.textContent = ymTime(Number(nowSeek.value));
      });
      nowSeek.addEventListener('change', function () {
        State.ymSeeking = false;
        State.mediaProgress = Number(nowSeek.value) || 0;
        ymSeekTo(Number(nowSeek.value));
        ymSyncNow();
      });
    }
    var nowVolume = document.getElementById('ymNowVolume');
    if (nowVolume) {
      // На телефоне наведения нет: поповер громкости открывается по клику.
      var volWrap = nowVolume.closest('.ym-vol');
      var volBtn = document.getElementById('ymNowVolumeBtn');
      if (volBtn && volWrap) {
        volBtn.addEventListener('click', function (event) {
          event.stopPropagation();
          volWrap.classList.toggle('open');
        });
        var volPop = volWrap.querySelector('.ym-vol-pop');
        if (volPop) volPop.addEventListener('click', function (event) { event.stopPropagation(); });
        document.addEventListener('click', function () { volWrap.classList.remove('open'); });
      }
      nowVolume.addEventListener('input', function () {
        State.ymVolumeBusy = true;
        var value = Math.max(0, Math.min(100, parseInt(nowVolume.value, 10) || 0));
        var label = document.getElementById('ymNowVolumeVal');
        if (label) label.textContent = value + '%';
        var main = document.getElementById('volume');
        if (main) {
          main.value = String(value);
          main.dispatchEvent(new Event('input', { bubbles: true }));
        }
        setTimeout(function () { State.ymVolumeBusy = false; }, 400);
      });
    }
    var barSeek = document.getElementById('ymBarSeek');
    if (barSeek) {
      barSeek.addEventListener('input', function () {
        State.ymSeeking = true;
        var max = Number(barSeek.max) || 1;
        var fill = document.getElementById('ymBarFill');
        if (fill) fill.style.width = Math.min(100, Number(barSeek.value) / max * 100) + '%';
      });
      barSeek.addEventListener('change', function () {
        State.ymSeeking = false;
        State.mediaProgress = Number(barSeek.value) || 0;
        ymSeekTo(Number(barSeek.value));
        ymSyncBar();
      });
    }
    var barVolume = document.getElementById('ymBarVolume');
    if (barVolume) {
      barVolume.addEventListener('input', function () {
        State.ymVolumeBusy = true;
        var value = Math.max(0, Math.min(100, parseInt(barVolume.value, 10) || 0));
        var label = document.getElementById('ymBarVolumeVal');
        if (label) label.textContent = value + '%';
        var main = document.getElementById('volume');
        if (main) {
          main.value = String(value);
          main.dispatchEvent(new Event('input', { bubbles: true }));
        }
        setTimeout(function () { State.ymVolumeBusy = false; }, 500);
      });
    }
    var filters = document.getElementById('ymFilters');
    if (filters) {
      filters.addEventListener('click', function (event) {
        var button = event.target.closest('[data-ym-view]');
        if (!button) return;
        ymCloseNow(true);
        if (State.ymSearchTimer) { clearTimeout(State.ymSearchTimer); State.ymSearchTimer = null; }
        State.ymSearch = '';
        State.ymSearchResults = null;
        State.ymSearchPending = '';
        var searchBox = document.getElementById('ymSearch');
        if (searchBox) searchBox.value = '';
        State.ymView = button.dataset.ymView;
        store.set('ymView', State.ymView);
        if (State.ymView !== 'tracks') {
          State.ymSelected = null;
          State.ymTracks = [];
        }
        ymRender();
      });
    }
    var search = document.getElementById('ymSearch');
    if (search) {
      search.addEventListener('input', function () {
        State.ymSearch = search.value;
        State.ymSearchResults = null;
        State.ymSearchPending = '';
        State.ymSearchFilter = 'all';
        if (State.ymSearchTimer) clearTimeout(State.ymSearchTimer);
        State.ymSearchTimer = setTimeout(function () {
          State.ymSearchTimer = null;
          ymRender();
        }, State.ymSearch.trim().length >= 2 ? 320 : 0);
      });
    }
    [['ymBarPrev', 'btnPrev'], ['ymBarPlay', 'btnPlay'], ['ymBarNext', 'btnNext'],
      ['ymBarMute', 'btnMute']
    ].forEach(function (pair) {
      var button = document.getElementById(pair[0]);
      var target = document.getElementById(pair[1]);
      if (button && target) button.addEventListener('click', function () { target.click(); });
    });
    var ymBarLike = document.getElementById('ymBarLike');
    if (ymBarLike) ymBarLike.addEventListener('click', function () { toggleLike(); });
    var ymBarDislike = document.getElementById('ymBarDislike');
    if (ymBarDislike) ymBarDislike.addEventListener('click', function () { dislikeTrack(); });
    var ymBarQueue = document.getElementById('ymBarQueue');
    if (ymBarQueue) ymBarQueue.addEventListener('click', function () { openQueue(true); });
    setInterval(function () { if (dialog.open) ymSyncBar(); }, 1000);
  }

  var ymQrTimer = null;
  var ymLoginWindow = null;
  var ymLoginUrl = '';

  function stopYmQr() {
    if (ymQrTimer) clearInterval(ymQrTimer);
    ymQrTimer = null;
  }

  function closeYmLoginWindow() {
    if (ymLoginWindow && !ymLoginWindow.closed) {
      try { ymLoginWindow.close(); } catch (e) {}
    }
    ymLoginWindow = null;
  }

  function openYmLoginWindow() {
    if (!ymLoginUrl) return;
    if (ymLoginWindow && !ymLoginWindow.closed) {
      try { ymLoginWindow.focus(); } catch (e) {}
      return;
    }
    ymLoginWindow = window.open(ymLoginUrl, 'ym_login',
      'popup=yes,width=520,height=720,resizable=yes,scrollbars=yes');
    if (!ymLoginWindow) {
      toast('Разрешите всплывающее окно для входа в Яндекс', 'warn');
      return;
    }
    try { ymLoginWindow.focus(); } catch (e) {}
  }

  function setYmQrStatus(text, kind) {
    var node = document.getElementById('ymQrStatus');
    if (!node) return;
    node.textContent = text || '';
    node.className = 'seg-note' + (kind ? ' ' + kind : '');
  }

  function startYmQr() {
    stopYmQr();
    closeYmLoginWindow();
    ymLoginUrl = '';
    var box = document.getElementById('ymQrBox');
    var phone = document.getElementById('ymQrPhoneLink');
    if (box) box.innerHTML = '<div class="seg-note">Готовлю QR…</div>';
    if (phone) phone.hidden = true;
    setYmQrStatus('Запрашиваю ссылку входа…');
    cgi('yandex_auth.py', { qr_start: 1 }, { timeout: 30000 })
      .then(function (data) {
        if (!data || !data.link) throw new Error('Яндекс не выдал ссылку');
        ymLoginUrl = data.link;
        if (phone) phone.hidden = false;
        if (box && typeof qrcode === 'function') {
          try {
            var qr = qrcode(0, 'M');
            qr.addData(data.link);
            qr.make();
            box.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
          } catch (e) {
            box.innerHTML = '<div class="seg-note">QR не построился — используйте ссылку</div>';
          }
        }
        setYmQrStatus('Ждём подтверждения на телефоне…');
        ymQrTimer = setInterval(pollYmQr, 2000);
      })
      .catch(function (err) {
        setYmQrStatus('QR недоступен: ' + err.message + '. Войдите по ссылке.', 'bad');
      });
  }

  function pollYmQr() {
    cgi('yandex_auth.py', { qr_status: 1 }, { timeout: 20000, silent: true })
      .then(function (data) {
        if (!data || data.state === 'waiting') return;
        if (data.state === 'done') {
          stopYmQr();
          closeYmLoginWindow();
          setYmQrStatus('Готово: ' + (data.login || 'Яндекс') + ' подключён', 'ok');
          var dlg = document.getElementById('ymLoginDlg');
          if (dlg && dlg.open) dlg.close();
          toast('Яндекс Музыка подключена', 'ok');
          loadYmAuth();
          return;
        }
        if (data.state === 'expired' || data.state === 'none') {
          stopYmQr();
          closeYmLoginWindow();
          setYmQrStatus('QR устарел — нажмите «Новый QR».', 'bad');
        }
      })
      .catch(function (err) {
        stopYmQr();
        setYmQrStatus('Не удалось проверить вход: ' + err.message, 'bad');
      });
  }

  function openYmLogin() {
    var dlg = document.getElementById('ymLoginDlg');
    if (!dlg) return;
    if (!dlg.open) dlg.showModal();
    startYmQr();
  }

  function initYandexMusic() {
    var login = document.getElementById('btnYmLogin');
    var logout = document.getElementById('btnYmLogout');
    if (!login || !logout) return;
    login.addEventListener('click', openYmLogin);
    var dlg = document.getElementById('ymLoginDlg');
    var close = document.getElementById('btnYmLoginClose');
    var retry = document.getElementById('btnYmQrRetry');
    var phone = document.getElementById('ymQrPhoneLink');
    if (close) close.addEventListener('click', function () { if (dlg) dlg.close(); });
    if (retry) retry.addEventListener('click', startYmQr);
    if (phone) phone.addEventListener('click', openYmLoginWindow);
    if (dlg) dlg.addEventListener('close', function () {
      stopYmQr();
      closeYmLoginWindow();
    });
    logout.addEventListener('click', function () {
      cgi('yandex_auth.py', { logout: 1 }, { timeout: 10000 }).then(applyYmAuth)
        .catch(function (err) { toast('Яндекс Музыка: ' + err.message, 'bad'); });
    });
    loadYmAuth();
  }

  function setRingBrightness(value, save) {
    var level = clamp(parseInt(value, 10) || 0, 0, 255);
    State.ringBrightness = level;
    el.ringBrightness.value = level;
    el.ringBrightVal.textContent = level;
    if (save === false) return;
    clearTimeout(ringBrightTimer);
    ringBrightTimer = setTimeout(function () {
      cgi('display.py', { ring_brightness: level }, { timeout: 6000, silent: true })
        .catch(function (err) { toast('Кольцо: ' + err.message, 'bad'); });
    }, 120);
  }

  function loadRingBrightness() {
    return cgi('display.py', {}, { timeout: 8000, silent: true }).then(function (data) {
      var level = typeof data.ring_brightness === 'number' ? data.ring_brightness : data.backlight;
      if (typeof level === 'number') setRingBrightness(level, false);
    }).catch(function () { /* тихо */ });
  }

  function pushRing() {
    if (nativeLightActive()) {
      stopCustomRingForNative();
      return;
    }
    if (ledTimer) clearTimeout(ledTimer);
    ledPending = true;
    ledTimer = setTimeout(function () {
      ledTimer = null;
      if (!ledPending) return;
      ledPending = false;
      var seq = ++ledSeq;
      var colors = composeColors();
      var animated = State.ledMode === 'wave' || State.ledMode === 'candle';
      var send = function (list) {
        return luna('/api/led/ring', { colors: list });
      };
      // Luna не обнуляет каналы прошлого цвета: перед установкой нового
      // отправляем чёрный кадр, иначе красный остаётся с зелёно-синим хвостом.
      var chain = animated
        ? send(colors)
        : send(new Array(24).fill('#000000')).then(function () { return send(colors); });
      chain.then(function () {
        if (seq !== ledSeq) return;
        el.ring.classList.remove('flash');
        void el.ring.offsetWidth;
        el.ring.classList.add('flash');
      }).catch(function (err) {
        toast('Кольцо: ' + err.message, 'bad');
      });
    }, 190);
  }

