
(function () {
  'use strict';

  /* ─────────── утилиты ─────────── */
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var pad = function (n) { return String(n).padStart(2, '0'); };
  var clamp = function (v, lo, hi) { return Math.min(hi, Math.max(lo, v)); };

  // Заливка ползунка до бегунка: CSS берёт процент из --fill.
  function paintRange(input) {
    if (!input || input.type !== 'range') return;
    var min = Number(input.min) || 0;
    var max = Number(input.max) || 100;
    var value = Number(input.value) || 0;
    var pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
    input.style.setProperty('--fill', clamp(pct, 0, 100).toFixed(1) + '%');
  }

  function paintRanges() {
    Array.prototype.forEach.call(document.querySelectorAll('input[type="range"]'), paintRange);
  }

  // На телефоне автофокус поля поиска сразу поднимает клавиатуру и перекрывает
  // список. Фокусируем только там, где есть настоящая мышь/трекпад.
  function focusOnDesktop(node, delay) {
    if (!node) return;
    try {
      if (!window.matchMedia || !window.matchMedia('(hover:hover) and (pointer:fine)').matches) return;
    } catch (e) { return; }
    setTimeout(function () {
      try { node.focus(); } catch (e) {}
    }, delay || 0);
  }

  // Таймеры, которые не должны крутиться в фоновой вкладке/на чужой вкладке:
  // на телефоне это лишние запросы, нагрев и расход батареи.
  function every(ms, fn) {
    return setInterval(function () { if (!document.hidden) fn(); }, ms);
  }
  function everyHome(ms, fn) {
    return setInterval(function () {
      if (!document.hidden && State.tab === 'home') fn();
    }, ms);
  }

  // Android-оболочка умеет pull-to-refresh. На время вращения 3D-модели его
  // нужно выключить, иначе вертикальный жест обновляет страницу.
  function setPullRefresh(enabled) {
    try {
      if (window.MidiPultPull && window.MidiPultPull.setEnabled) {
        window.MidiPultPull.setEnabled(!!enabled);
      }
    } catch (e) {}
  }

  var store = {
    get: function (k, dflt) {
      try { var v = localStorage.getItem('mypult.' + k); return v === null ? dflt : JSON.parse(v); }
      catch (e) { return dflt; }
    },
    set: function (k, v) {
      try { localStorage.setItem('mypult.' + k, JSON.stringify(v)); } catch (e) {}
    }
  };

  function ApiError(message, status, data) {
    var err = new Error(message);
    err.name = 'ApiError';
    err.status = status || 0;
    err.data = data || null;
    return err;
  }

  /* ─────────── сеть ─────────── */
  function request(url, opts) {
    opts = opts || {};
    var method = opts.method || 'POST';
    var body = opts.body === undefined ? null : opts.body;
    var timeout = opts.timeout || 12000;
    var outside = opts.signal || null;

    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, timeout);
    var onOutsideAbort = function () { ctrl.abort(); };
    if (outside) {
      if (outside.aborted) ctrl.abort();
      else outside.addEventListener('abort', onOutsideAbort);
    }

    var init = {
      method: method,
      signal: ctrl.signal,
      cache: 'no-store',
      headers: { 'Accept': 'application/json', 'X-Requested-With': 'MidiPult' }
    };
    if (body !== null) {
      init.headers['Content-Type'] = 'application/json; charset=utf-8';
      init.body = JSON.stringify(body);
    }

    return fetch(url, init).then(function (res) {
      return res.text().then(function (text) {
        var data = null;
        if (text) { try { data = JSON.parse(text); } catch (e) { data = { raw: text }; } }
        if (!res.ok) {
          var msg = (data && (data.error || data.message)) || ('HTTP ' + res.status);
          throw ApiError(msg, res.status, data);
        }
        return data === null ? {} : data;
      });
    }).catch(function (err) {
      if (err && err.name === 'ApiError') throw err;
      if (err && err.name === 'AbortError') {
        if (outside && outside.aborted) throw ApiError('Отменено', 0);
        throw ApiError('Превышено время ожидания', 0);
      }
      throw ApiError('Нет связи с устройством', 0);
    }).finally(function () {
      clearTimeout(timer);
      if (outside) outside.removeEventListener('abort', onOutsideAbort);
    });
  }

  /* ─────────── состояние ─────────── */
  function stripAnsi(value) {
    return String(value == null ? '' : value)
      .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
      .replace(/\r/g, '');
  }

  var State = {
    luna: null,
    glagol: null,
    services: null,
    color: '#00E676',
    ledMode: 'solid',
    ledColors: null,
    selected: null,
    ledAnim: null,
    brightness: 170,
    displayAuto: false,
    displayManual: false,
    volume: 40,
    playing: false,
    busy: 0,
    version: null,
    sounds: [],
    customSounds: [],
    soundTarget: null,
    previewAudio: null,
    previewPath: null,
    previewBtn: null,
    rebootActive: false,
    rebootStart: 0,
    rebootSawDown: false,
    rebootTimer: null,
    rebootPoll: null,
    drawing: false,
    pattern: null,
    animFrames: [],
    animIndex: 0,
    animPlaying: false,
    animTimer: null,
    animRun: 0,
    animAbort: null,
    editingAnimId: null,
    clockAnims: [],
    hiddenPresets: [],
    displayOverride: false,
    displayOff: false,
    ringBrightness: 255,
    ringAuto: false,
    ringSpeed: 0,
    ringMusic: 'off',
    ringMusicActive: false,
    ringMusicPrev: null,
    alice: 'IDLE',
    logoMode: 'sync',
    logoLast: '',
    logoSending: false,
    hwPollBusy: false,
    hwLast: '',
    hwActive: false,
    hwHoldUntil: 0,
    ymOauthUrl: '',
    ymLoggedIn: false,
    ymRestored: false,
    ymView: 'all',
    ymPlaylists: [],
    ymMine: [],
    ymTracks: [],
    ymLiked: [],
    ymAudio: [],
    ymBooks: [],
    ymSearchResults: null,
    ymSearchPending: '',
    ymSearchTimer: null,
    ymSearchFilter: 'all',
    ymWave: null,
    ymWaveSettings: null,
    ymTrends: [],
    ymNowOpen: false,
    ymSeeking: false,
    ymVolumeBusy: false,
    ymSelected: null,
    ymSearch: '',
    ringAnimName: null,
    ringPreview: null,
    ringAnimations: [],
    hiddenRing: [],
    blinkTimer: null,
    muted: false,
    llmAnswer: '',
    tab: 'display',
    llm: null,
    vpn: null,
    vpnBusy: null,
    voice: null,
    radio: null,
    bt: null,
    net: null,
    scenarios: [],
    mediaDuration: 0,
    mediaProgress: 0,
    progressBase: 0,
    progressAt: 0,
    pendingSeek: null,
    cmdPlaying: null,
    cmdUntil: 0,
    mediaTitle: '',
    mediaArtist: '',
    mediaId: '',
    mediaCover: '',
    liked: false,
    queueTab: 'queue',
    llmTzAutosaved: false,
    alarmMode: 'radio',
    alarmRepeat: true,
    alarmTzSynced: false,
    alarmHour: 7,
    alarmMinute: 0,
    alarmStations: [],
    alarmStation: null,
    alarmSounds: [],
    alarmSound: null,
    alarms: [],
    lyricsInline: false,
    lyricsActive: null,
    lyricsLines: [],
    nowLyricsLines: [],
    nowLyricsActive: null,
    lyrSeeking: false,
    audioProgress: 0,
    bt: null,
    btPlayer: null,
    btPlayerAt: 0,
    stationActive: false,
    homeVolumeDragging: false,
    homeExtra: 'resources',
    homeSystem: null,
    homeNet: null,
    homeVpn: null,
    homeScenarios: null,
    homeLlm: null,
    modelFrame: null,
    stationColor: 'black',
    bodyMaterials: null,
    seeking: false,
    volumeDragging: false,
    updateInfo: null,
    updateRunning: false,
    btScanning: false,
    netScanning: false,
    dragCard: null
  };

  var el = {};
  var ringDots = [];

  /* ─────────── журнал / тосты ─────────── */
  var logs = [];

  function log(kind, title, detail, isErr) {
    logs.unshift({ t: new Date(), kind: kind, title: title, detail: detail, err: !!isErr });
    if (logs.length > 100) logs.pop();
    renderLog();
  }

  function renderLog() {
    if (!el.logBox) return;
    if (!logs.length) { el.logBox.textContent = 'Журнал пуст.'; return; }
    el.logBox.textContent = logs.map(function (item) {
      var t = pad(item.t.getHours()) + ':' + pad(item.t.getMinutes()) + ':' + pad(item.t.getSeconds());
      var line = t + '  [' + item.kind + '] ' + item.title;
      if (item.detail !== undefined && item.detail !== null) {
        var d = typeof item.detail === 'string' ? item.detail : JSON.stringify(item.detail);
        if (d && d.length > 400) d = d.slice(0, 400) + '…';
        line += ' → ' + d;
      }
      return (item.err ? '✖ ' : '· ') + line;
    }).join('\n');
  }

  function toast(message, kind) {
    var node = document.createElement('div');
    node.className = 'toast' + (kind ? ' ' + kind : '');
    node.textContent = message;
    el.toasts.appendChild(node);
    setTimeout(function () {
      node.style.transition = 'opacity .3s, transform .3s';
      node.style.opacity = '0';
      node.style.transform = 'translateY(8px)';
      setTimeout(function () { node.remove(); }, 320);
    }, 3200);
  }

  /* ─────────── статус ─────────── */
  function setPill(kind, text) {
    el.pill.className = 'pill' + (kind ? ' ' + kind : '');
    el.pillText.textContent = text;
  }

  function renderStatus() {
    if (State.busy > 0) { setPill('busy', 'Отправка…'); }
    else if (State.luna === false) { setPill('bad', 'Luna недоступна'); }
    else if (State.luna === true && State.glagol === false) { setPill('warn', 'Luna в сети · Glagol offline'); }
    else if (State.luna === true) { setPill('ok', 'В сети'); }
    else { setPill('', 'Проверка…'); }

    el.offlineBanner.classList.toggle('show', State.luna === false);

    var parts = [];
    parts.push('Luna ' + (State.luna === null ? '?' : State.luna ? '✓' : '✕'));
    parts.push('Glagol ' + (State.glagol === null ? '?' : State.glagol ? '✓' : '✕'));
    var tts = State.services && typeof State.services.tts === 'boolean' ? State.services.tts : null;
    if (tts !== null) parts.push('IPC ' + (tts ? '✓' : '✕'));
    el.netLine.textContent = parts.join(' · ');
    el.footStatus.textContent = State.luna === null ? '—' :
      (State.luna ? 'шлюз 8099 доступен' : 'шлюз 8099 недоступен');
  }

  function renderServices() {
    var s = State.services || {};
    var rows = [
      ['Luna :8099', s.luna],
      ['Glagol :1961', s.glagol],
      ['IPC :9875', s.tts],
      ['amixer', s.amixer],
      ['websocket-client', s.websocket]
    ];
    el.svcState.innerHTML = '';
    rows.forEach(function (row) {
      var node = document.createElement('span');
      node.textContent = row[0] + ' ' + (row[1] === true ? '✓' : row[1] === false ? '✕' : '?');
      if (row[1] === true) node.className = 'on';
      if (row[1] === false) node.className = 'off';
      el.svcState.appendChild(node);
    });
  }

  function busyStart() { State.busy += 1; renderStatus(); }
  function busyEnd() { State.busy = Math.max(0, State.busy - 1); renderStatus(); }

  function withBusy(button, fn) {
    if (button && button.dataset.busy === '1') return Promise.resolve();
    if (button) { button.dataset.busy = '1'; button.disabled = true; }
    busyStart();
    return Promise.resolve().then(fn).finally(function () {
      if (button) { delete button.dataset.busy; button.disabled = false; }
      busyEnd();
    });
  }

  /* ─────────── кастомные выпадающие списки ─────────── */
  var ddCounter = 0;
  var ddPlacers = [];
  var ddSync = [];

  function refreshDropdowns() {
    Array.prototype.forEach.call(ddPlacers, function (fn) {
      try { fn(); } catch (e) {}
    });
    // Значение селекта могли выставить программно: change при этом не
    // приходит, и подпись кастомного списка оставалась старой.
    ddSync.forEach(function (fn) {
      try { fn(); } catch (e) {}
    });
  }

  function enhanceSelect(select) {
    if (!select || select.dataset.ddReady === '1' || select.multiple) return;
    var host = select.parentElement;
    if (!host) return;
    select.dataset.ddReady = '1';
    if (window.getComputedStyle(host).position === 'static') host.classList.add('dd-host');
    select.classList.add('dd-native');
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');

    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'dd-btn';
    button.dataset.ddFor = select.id || '';
    button.setAttribute('role', 'combobox');
    button.setAttribute('aria-haspopup', 'listbox');
    button.setAttribute('aria-expanded', 'false');
    var text = document.createElement('span');
    text.className = 'dd-text';
    button.appendChild(text);

    var panel = document.createElement('div');
    panel.className = 'dd-panel';
    panel.id = 'dd-panel-' + (++ddCounter);
    panel.setAttribute('role', 'listbox');
    button.setAttribute('aria-controls', panel.id);
    document.body.appendChild(panel);
    host.appendChild(button);

    var open = false;
    var active = 0;

    function options() {
      return Array.prototype.slice.call(select.options);
    }

    function place() {
      var r = select.getBoundingClientRect();
      button.style.left = select.offsetLeft + 'px';
      button.style.top = select.offsetTop + 'px';
      button.style.width = r.width + 'px';
      button.style.height = r.height + 'px';
      if (!open) return;
      var width = Math.min(Math.max(r.width, 140), window.innerWidth - 16);
      var left = Math.min(Math.max(8, r.left), window.innerWidth - width - 8);
      var want = Math.min(panel.scrollHeight || 0, 320);
      var below = r.bottom + 6;
      var spaceBelow = window.innerHeight - below - 8;
      var spaceAbove = r.top - 8;
      var height = Math.max(80, Math.min(want || 160, 320));
      var top = below;
      panel.style.width = width + 'px';
      panel.style.left = left + 'px';
      if (!(spaceBelow >= Math.min(height, 160) || spaceBelow >= spaceAbove)) {
        top = r.top - height - 6;
      }
      top = Math.max(8, Math.min(top, window.innerHeight - height - 8));
      panel.style.top = top + 'px';
      panel.style.maxHeight = height + 'px';
    }

    function setActive(index) {      var opts = options();
      if (!opts.length) return;
      active = Math.max(0, Math.min(index, opts.length - 1));
      Array.prototype.forEach.call(panel.children, function (item, i) {
        item.classList.toggle('active', i === active);
        item.setAttribute('aria-selected', String(i === select.selectedIndex));
      });
      var item = panel.children[active];
      if (item && item.scrollIntoView) item.scrollIntoView({ block: 'nearest' });
      button.setAttribute('aria-activedescendant', panel.id + '-opt-' + active);
    }

    function render() {
      panel.innerHTML = '';
      options().forEach(function (opt, i) {
        var item = document.createElement('div');
        item.className = 'dd-opt';
        item.id = panel.id + '-opt-' + i;
        item.setAttribute('role', 'option');
        item.setAttribute('aria-selected', String(i === select.selectedIndex));
        item.textContent = opt.text;
        item.addEventListener('click', function () { pick(i); });
        item.addEventListener('mousemove', function () { setActive(i); });
        panel.appendChild(item);
      });
      setActive(select.selectedIndex >= 0 ? select.selectedIndex : 0);
    }

    function pick(index) {
      var opts = options();
      if (index < 0 || index >= opts.length) return;
      select.selectedIndex = index;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      sync();
      close();
      button.focus();
    }

    function outside(ev) {
      if (panel.contains(ev.target) || button.contains(ev.target)) return;
      close();
    }

    function close() {
      if (!open) return;
      open = false;
      panel.classList.remove('open');
      button.setAttribute('aria-expanded', 'false');
      document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    }

    function openPanel() {
      if (button.disabled || open) return;
      render();
      panel.classList.add('open');
      open = true;
      button.setAttribute('aria-expanded', 'true');
      place();
      document.addEventListener('pointerdown', outside, true);
      window.addEventListener('resize', place);
      window.addEventListener('scroll', place, true);
    }

    function sync() {
      var idx = select.selectedIndex;
      text.textContent = idx >= 0 ? select.options[idx].text : '';
      var hidden = !!select.hidden;
      button.style.display = hidden ? 'none' : '';
      button.title = text.textContent;
      if (hidden) close();
      button.disabled = !!select.disabled;
      if (button.disabled) close();
      if (open) { render(); place(); }
      else { place(); }
    }
    ddSync.push(sync);
    sync();

    button.addEventListener('click', function () {
      if (open) close(); else openPanel();
    });

    button.addEventListener('keydown', function (ev) {
      var opts = options();
      if (!opts.length) return;
      var key = ev.key;
      if (!open && (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Enter' || key === ' ')) {
        ev.preventDefault();
        openPanel();
        return;
      }
      if (!open) return;
      if (key === 'ArrowDown') { ev.preventDefault(); setActive(active + 1); }
      else if (key === 'ArrowUp') { ev.preventDefault(); setActive(active - 1); }
      else if (key === 'Home') { ev.preventDefault(); setActive(0); }
      else if (key === 'End') { ev.preventDefault(); setActive(opts.length - 1); }
      else if (key === 'Enter' || key === ' ') { ev.preventDefault(); pick(active); }
      else if (key === 'Escape') { ev.preventDefault(); close(); }
      else if (key === 'Tab') { close(); }
      else if (key.length === 1) {
        var ch = key.toLowerCase();
        for (var i = 1; i <= opts.length; i++) {
          var idx = (active + i) % opts.length;
          if (opts[idx].text.toLowerCase().charAt(0) === ch) { setActive(idx); break; }
        }
      }
    });

    select.addEventListener('change', sync);
    ddPlacers.push(function () { sync(); place(); });
    if (typeof MutationObserver === 'function') {
      new MutationObserver(sync).observe(select, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'hidden'] });
    }
    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(place).observe(select);
      new ResizeObserver(place).observe(host);
    }
    window.addEventListener('resize', place);

    sync();
    setTimeout(place, 0);
  }

  function enhanceSelects() {
    Array.prototype.forEach.call(document.querySelectorAll('select'), enhanceSelect);
  }

  /* ─────────── API-обёртки ─────────── */
  function luna(path, body, opts) {
    opts = opts || {};
    return request('/cgi-bin/luna.py?path=' + encodeURIComponent(path), {
      body: body || {},
      timeout: opts.timeout || 12000,
      signal: opts.signal
    }).then(function (data) {
      State.luna = true;
      renderStatus();
      log('luna', path, data);
      return data;
    }).catch(function (err) {
      if (err.status === 0) { State.luna = false; renderStatus(); }
      log('luna', path, err.message, true);
      throw err;
    });
  }

  function cgi(script, params, opts) {
    opts = opts || {};
    return request('/cgi-bin/' + script, {
      body: params || {},
      timeout: opts.timeout || 12000,
      signal: opts.signal
    }).then(function (data) {
      if (!opts.silent) log('cgi', script, data);
      return data;
    }).catch(function (err) {
      if (!opts.silent) log('cgi', script, err.message, true);
      throw err;
    });
  }

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
    [['ymNowPrev', 'btnPrev'], ['ymNowPlay', 'btnPlay'], ['ymNowNext', 'btnNext'],
      ['ymNowLike', 'btnLike'], ['ymNowDislike', 'btnDislike']
    ].forEach(function (pair) {
      var button = document.getElementById(pair[0]);
      var target = document.getElementById(pair[1]);
      if (button && target) button.addEventListener('click', function () { target.click(); });
    });
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
      ['ymBarLike', 'btnLike'], ['ymBarDislike', 'btnDislike'],
      ['ymBarMute', 'btnMute']
    ].forEach(function (pair) {
      var button = document.getElementById(pair[0]);
      var target = document.getElementById(pair[1]);
      if (button && target) button.addEventListener('click', function () { target.click(); });
    });
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

  /* ─────────── дисплей: семисегментное табло ─────────── */
  var SEG_GEOM = {
    a: [18, 6, 64, 12],
    b: [82, 16, 12, 64],
    c: [82, 100, 12, 64],
    d: [18, 162, 64, 12],
    e: [6, 100, 12, 64],
    f: [6, 16, 12, 64],
    g: [18, 84, 64, 12]
  };
  var DIGIT_POS = [0, 120, 260, 380];
  var DIGIT_SEGMENTS = {
    '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc',
    '5': 'afgcd', '6': 'afgecd', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg'
  };
  var SEG_TO_DIGIT = {};
  Object.keys(DIGIT_SEGMENTS).forEach(function (key) {
    SEG_TO_DIGIT[DIGIT_SEGMENTS[key].split('').sort().join('')] = key;
  });

  function sortSegments(segments) {
    return segments.split('').sort().join('');
  }

  function segmentsForChar(ch) {
    return DIGIT_SEGMENTS[ch] || '';
  }

  function buildSevenSeg() {
    var ns = 'http://www.w3.org/2000/svg';
    DIGIT_POS.forEach(function (offset, digit) {
      var group = document.createElementNS(ns, 'g');
      group.setAttribute('transform', 'translate(' + offset + ',0)');
      Object.keys(SEG_GEOM).forEach(function (seg) {
        var geo = SEG_GEOM[seg];
        var rect = document.createElementNS(ns, 'rect');
        rect.setAttribute('x', geo[0]);
        rect.setAttribute('y', geo[1]);
        rect.setAttribute('width', geo[2]);
        rect.setAttribute('height', geo[3]);
        rect.setAttribute('rx', 4);
        rect.setAttribute('data-digit', digit);
        rect.setAttribute('data-seg', seg);
        rect.addEventListener('click', onSegmentClick);
        group.appendChild(rect);
      });
      el.seg7Digits.appendChild(group);
    });
  }

  function renderPattern(pattern) {
    var rects = el.seg7Digits.querySelectorAll('rect');
    for (var i = 0; i < rects.length; i++) {
      var digit = parseInt(rects[i].getAttribute('data-digit'), 10);
      var seg = rects[i].getAttribute('data-seg');
      rects[i].classList.toggle('on', (pattern[digit] || '').indexOf(seg) >= 0);
    }
  }

  function renderTime(text) {
    var parts = String(text).split(':');
    if (parts.length !== 2 || parts[0].length !== 2 || parts[1].length !== 2) return;
    renderPattern([
      segmentsForChar(parts[0][0]),
      segmentsForChar(parts[0][1]),
      segmentsForChar(parts[1][0]),
      segmentsForChar(parts[1][1])
    ]);
  }

  function tickClock() {
    var d = new Date();
    var text = pad(d.getHours()) + ':' + pad(d.getMinutes());
    el.clockTime.textContent = text;
    if (!State.drawing && !State.animPlaying) {
      renderTime(text);
    }
    el.clockSub.textContent = d.toLocaleDateString('ru-RU', {
      weekday: 'long', day: 'numeric', month: 'long'
    });
  }

  /* ─────────── дисплей: рисование палочками ─────────── */
  function enterDrawMode() {
    State.drawing = true;
    State.pattern = (el.clockTime.textContent.split(':').length === 2
      ? el.clockTime.textContent
      : pad(new Date().getHours()) + ':' + pad(new Date().getMinutes())
    ).split('').filter(function (ch) { return ch !== ':'; })
      .map(segmentsForChar)
      .slice(0, 4);
    while (State.pattern.length < 4) State.pattern.push('');

    el.displayPreview.classList.add('editing');
    el.segToolbar.hidden = false;
    el.btnDraw.setAttribute('aria-pressed', 'true');
    renderPattern(State.pattern);
    validatePattern();
  }

  function exitDrawMode() {
    State.drawing = false;
    State.pattern = null;
    el.displayPreview.classList.remove('editing');
    el.segToolbar.hidden = true;
    el.btnDraw.setAttribute('aria-pressed', 'false');
    renderTime(el.clockTime.textContent);
  }

  function onSegmentClick(ev) {
    if (!State.drawing) return;
    var digit = parseInt(ev.currentTarget.getAttribute('data-digit'), 10);
    var seg = ev.currentTarget.getAttribute('data-seg');
    var current = State.pattern[digit] || '';
    State.pattern[digit] = current.indexOf(seg) >= 0
      ? current.replace(seg, '')
      : current + seg;
    renderPattern(State.pattern);
    validatePattern();
    syncAnimFrame();
  }

  function patternTime() {
    var chars = State.pattern.map(function (segs) {
      return SEG_TO_DIGIT[sortSegments(segs)] || '?';
    }).join('');
    if (!/^\d{4}$/.test(chars)) return null;
    var hh = parseInt(chars.slice(0, 2), 10);
    var mm = parseInt(chars.slice(2), 10);
    if (hh > 23 || mm > 59) return null;
    return chars.slice(0, 2) + ':' + chars.slice(2);
  }

  function validatePattern() {
    var time = patternTime();
    // Luna принимает карту сегментов, поэтому рисунок можно отправлять всегда.
    el.btnSegSend.disabled = false;
    el.segNote.textContent = time
      ? 'На дисплее ' + time + ' — или отправьте рисунок как есть'
      : 'Рисунок уйдёт на дисплей как есть';
    return time;
  }

  function markOverride(on) {
    State.displayOverride = !!on;
    el.btnClockBack.hidden = !on;
  }

  function setDisplayManual(kind) {
    return cgi('display.py', { manual: 1, kind: kind }, { timeout: 5000, silent: true })
      .catch(function () { /* тихо: не критично для рисунка */ });
  }

  var offTimer = null;

  function sendBacklight(off) {
    return cgi('display.py', off ? { off: 1 } : { on: 1 }, { timeout: 6000, silent: true });
  }

  function sendDisplayOff() {
    // Luna убирает свой слой, backlight гасит сам экран — прошивка его
    // больше не «включает», потому что подсветка уже нулевая.
    return Promise.all([
      request('/cgi-bin/luna.py?path=%2Fapi%2Fclock%2Foff', { body: {}, timeout: 5000 }).catch(function () { return null; }),
      sendBacklight(true).catch(function () { return null; })
    ]);
  }

  // Пока режим «выключен», повторяем: прошивка умеет вернуть и часы, и яркость.
  function startDisplayOff() {
    State.displayOff = true;
    markOverride(true);
    sendDisplayOff().catch(function () { /* тихо */ });
    if (offTimer) clearInterval(offTimer);
    offTimer = setInterval(function () {
      if (!document.hidden && State.displayOff) {
        sendDisplayOff().catch(function () { /* тихо */ });
      }
    }, 2000);
  }

  function cancelDisplayOff() {
    // Экран больше не гасим: on восстанавливает сохранённый рисунок.
    State.displayOff = false;
    if (offTimer) {
      clearInterval(offTimer);
      offTimer = null;
    }
  }

  function stopDisplayOff() {
    State.displayOff = false;
    if (offTimer) {
      clearInterval(offTimer);
      offTimer = null;
    }
    sendBacklight(false).catch(function () { /* тихо */ });
  }

  function patternSegments(pattern) {
    // API: {"segments": {"A1": 255, ...}} — яркость каждого сегмента 0…255.
    pattern = pattern || State.pattern || ['', '', '', ''];
    var segments = {};
    for (var digit = 0; digit < 4; digit++) {
      var lit = pattern[digit] || '';
      for (var i = 0; i < 'abcdefg'.length; i++) {
        var seg = 'abcdefg'[i];
        segments[seg.toUpperCase() + (digit + 1)] = lit.indexOf(seg) >= 0 ? 255 : 0;
      }
    }
    return segments;
  }

  function sendDrawing() {
    withBusy(el.btnSegSend, function () {
      State.modelFrame = (State.pattern || []).slice();
      drawHomeScreen();
      return luna('/api/clock', { segments: patternSegments() }).then(function () {
        setDisplayManual('draw');
        toast('Рисунок на дисплее', 'ok');
        markOverride(true);
      }).catch(function (err) {
        toast('Дисплей: ' + err.message, 'bad');
      });
    });
  }

  var TICKER_ALLOWED = '0123456789ABCDEFGHIJLNOPQRSTUY_abcdefghijlnopqrstuy-';

  function sendDisplayText() {
    var raw = (el.displayText.value || '').trim();
    if (!raw) { toast('Введите текст для дисплея', 'warn'); return; }
    var text = raw.replace(/ /g, '_');
    var bad = {};
    for (var i = 0; i < text.length; i++) {
      if (TICKER_ALLOWED.indexOf(text[i]) < 0) bad[text[i]] = true;
    }
    if (Object.keys(bad).length) {
      toast('Дисплей не умеет: ' + Object.keys(bad).join(' ') +
        '. Можно 0-9, A-Y (без K M V W X Z), _, -', 'bad');
      return;
    }
    if (text.length > 32) { toast('Максимум 32 символа', 'warn'); return; }
    var duration = Math.min(15000, Math.max(3000, 1000 + text.length * 200));
    withBusy(el.btnDisplayText, function () {
      return luna('/api/clock/text', { text: text, duration_ms: duration }, { timeout: 25000 }).then(function () {
        setDisplayManual('text');
        toast('Бегущая строка запущена', 'ok');
        markOverride(true);
      }).catch(function (err) {
        toast('Дисплей: ' + err.message, 'bad');
      });
    });
  }

  function returnClock(brightness) {
    var value = parseInt(brightness, 10) || parseInt(el.brightness.value, 10) || 170;
    withBusy(el.btnClockBack, function () {
      State.modelFrame = null;
      stopDisplayOff();
      return cgi('display.py', { restore_clock: 1, brightness: value },
        { timeout: 8000, silent: true }).then(function (data) {
        applyBrightness(data.brightness || value, false);
        markOverride(false);
        loadDisplayState();
        toast('Часы возвращены', 'ok');
      }).catch(function (err) {
        toast('Часы: ' + err.message, 'bad');
      });
    });
  }

  function resetDisplay() {
    askConfirm('Сбросить настройки дисплея? Яркость, автояркость, режим, рисунок и текст вернутся к стандартным.',
      { yes: 'Сбросить дисплей' }).then(function (ok) {
      if (!ok) return;
      return withBusy(el.btnDisplayReset, function () {
        return cgi('display.py', { reset_display: 1 }, { timeout: 10000 }).then(function (data) {
          stopDisplayOff();
          applyBrightness(170, false);
          State.drawing = false;
          State.pattern = null;
          el.segToolbar.hidden = true;
          el.displayPreview.classList.remove('editing');
          el.displayText.value = '';
          markOverride(false);
          applyAutoConfig(data.auto || {}, data.mode || {});
          return loadDisplayState();
        }).then(function () {
          toast('Настройки дисплея сброшены', 'ok');
        });
      }).catch(function (err) { toast('Сброс дисплея: ' + err.message, 'bad'); });
    });
  }

  function resetRing() {
    askConfirm('Сбросить кольцо? Цвет, яркость, скорость и эффект вернутся к стандартным.',
      { yes: 'Сбросить кольцо' }).then(function (ok) {
      if (!ok) return;
      return withBusy(el.btnRingReset, function () {
        return cgi('display.py', { reset_ring: 1 }, { timeout: 10000 }).then(function (data) {
          stopLedAnimation();
          setRingSpeed(0);
          setRingBrightness(255, false);
          State.ledMode = 'off';
          store.set('ledMode', 'off');
          State.ringAnimName = null;
          markRingAnim(null);
          paintOff();
          markActiveChip();
          applyAutoConfig(data.auto || {});
          toast('Кольцо сброшено и выключено', 'ok');
        });
      }).catch(function (err) { toast('Сброс кольца: ' + err.message, 'bad'); });
    });
  }

  function clearPattern() {
    State.pattern = ['', '', '', ''];
    renderPattern(State.pattern);
    validatePattern();
  }

  function applyBrightness(value, send) {
    var v = clamp(parseInt(value, 10) || 170, 10, 255);
    State.brightness = v;
    el.brightness.value = v;
    el.brightnessVal.textContent = v;
    el.displayPreview.style.opacity = (0.38 + ((v - 10) / 245) * 0.62).toFixed(2);
    store.set('brightness', v);

    var chips = el.brightChips.querySelectorAll('.chip');
    for (var i = 0; i < chips.length; i++) {
      chips[i].setAttribute('aria-pressed',
        parseInt(chips[i].dataset.bright, 10) === v ? 'true' : 'false');
    }
    if (send) pushBrightness();
  }

  var brightTimer = null;
  var brightPending = false;

  function pushBrightness() {
    if (brightTimer) clearTimeout(brightTimer);
    brightPending = true;
    brightTimer = setTimeout(function () {
      brightTimer = null;
      if (!brightPending) return;
      brightPending = false;
      cgi('display.py', { segments_brightness: State.brightness }, { timeout: 6000, silent: true })
        .catch(function (err) {
          toast('Яркость: ' + err.message, 'bad');
        });
    }, 240);
  }

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
    // Держим цель до подтверждения: старые снапшоты не вернут ползунок.
    State.pendingSeek = { target: position, until: Date.now() + 10000 };
    State.progressBase = position;
    State.progressAt = Date.now() / 1000;
    State.mediaProgress = position;
    updateMediaProgress();

    var attempts = 0;
    var send = function () {
      attempts += 1;
      return cgi('media.py', { action: 'seek', position: position }, { timeout: 12000 })
        .then(function () {
          el.mediaKind.textContent = 'перематываю…';
          return new Promise(function (resolve) { setTimeout(resolve, 700); });
        })
        .then(function () { return refreshPlayer(true, true); })
        .then(function () { return check(); });
    };
    var check = function () {
      // Проверяем по «сырому» state, а не по отображаемой цели: если станция
      // команду проигнорировала, повторяем (до 3 раз).
      return fetch('/state?player=1&fresh=1', { cache: 'no-store', credentials: 'same-origin' })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          var p = (data && data.player) || {};
          var got = Number(p.progress) || 0;
          if (Math.abs(got - position) <= 8) {
            el.mediaKind.textContent = 'сейчас музыка';
            return;
          }
          if (attempts < 3) return send();
          State.pendingSeek = null;
          el.mediaKind.textContent = 'перемотка не удалась';
          toast('Станция не применила перемотку', 'warn');
        });
    };
    return send().catch(function (err) {
      State.pendingSeek = null;
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

  /* ─────────── озвучка ─────────── */
  function say() {
    var text = el.ttsText.value.trim();
    if (!text) { toast('Введите текст для озвучки', 'warn'); return; }
    return withBusy(el.btnSay, function () {
      return cgi('speak.py', { text: text }, { timeout: 30000 }).then(function (data) {
        if (data && data.started) toast('Алиса говорит', 'ok');
        else toast('Запрос ушёл, подтверждения нет', 'warn');
      }).catch(function (err) {
        toast('Озвучка: ' + err.message, 'bad');
        if (err.data && err.data.hint) log('speak', 'hint', err.data.hint, true);
      });
    });
  }

  /* ─────────── нейросеть ─────────── */
  function syncVolumeFromDevice() {
    if (State.volumeDragging || volPending) return Promise.resolve();
    // Только что громкость меняли аппаратными кнопками Android — не
    // перебиваем её устаревшим ответом опроса.
    if (Date.now() - volumeRemoteAt < 1500) return Promise.resolve();
    return cgi('volume.py', {}, { timeout: 6000, silent: true }).then(function (data) {
      if (data && typeof data.level === 'number' && data.level !== State.volume) {
        setVolumeUI(data.level);
      }
    }).catch(function () { /* тихо */ });
  }

  var volumePollTimer = null;

  function stopVolumePoll() {
    if (volumePollTimer) clearInterval(volumePollTimer);
    volumePollTimer = null;
  }

  function startVolumePoll() {
    stopVolumePoll();
    syncVolumeFromDevice();
    volumePollTimer = setInterval(function () {
      if (!document.hidden && (State.tab === 'sound' || State.tab === 'home')) syncVolumeFromDevice();
    }, 5000);
  }

  function fillProviderSelect() {
    var list = (State.llm && State.llm.providers) || [];
    var current = (State.llm && State.llm.provider) || 'openai';
    el.llmProviderSelect.innerHTML = '';
    list.forEach(function (provider) {
      var option = document.createElement('option');
      option.value = provider.id;
      option.textContent = provider.title;
      if (provider.id === current) option.selected = true;
      el.llmProviderSelect.appendChild(option);
    });
  }

  function currentProvider() {
    var list = (State.llm && State.llm.providers) || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === State.llm.provider) return list[i];
    }
    return null;
  }

  function toggleCustomModel() {
    el.llmModelCustomWrap.hidden = el.llmModel.value !== '__custom';
  }

  function fillModels(selected) {
    var provider = currentProvider();
    el.llmModel.innerHTML = '';
    (provider ? provider.models : []).forEach(function (name) {
      var option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      el.llmModel.appendChild(option);
    });
    var custom = document.createElement('option');
    custom.value = '__custom';
    custom.textContent = 'Другая модель…';
    el.llmModel.appendChild(custom);

    if (selected) {
      var found = false;
      for (var i = 0; i < el.llmModel.options.length; i++) {
        if (el.llmModel.options[i].value === selected) found = true;
      }
      if (found) {
        el.llmModel.value = selected;
      } else if (selected) {
        el.llmModel.value = '__custom';
        el.llmModelCustom.value = selected;
      }
    }
    toggleCustomModel();
    if (provider && provider.base_url) el.llmBase.value = provider.base_url;
  }

  function selectProvider(id) {
    State.llm.provider = id;
    fillProviderSelect();
    fillModels('');
  }

  function renderProfileChips() {
    var list = (State.llm && State.llm.profiles) || [];
    el.llmProfiles.innerHTML = '';
    list.forEach(function (profile) {
      var chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.textContent = profile.name;
      chip.dataset.id = profile.id;
      chip.setAttribute('aria-pressed', profile.id === State.llm.active ? 'true' : 'false');
      el.llmProfiles.appendChild(chip);
    });
    if (!list.length) {
      el.llmProfiles.innerHTML = '<span class="seg-note">профилей пока нет — добавьте первый</span>';
    }
  }

  function findProfile(id) {
    var list = (State.llm && State.llm.profiles) || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i];
    }
    return null;
  }

  function updateLlmStatus() {
    if (!State.llm) return;
    var active = findProfile(State.llm.active);
    el.llmActive.textContent = active
      ? ('активный: ' + active.name + (active.key_set ? ', ключ есть' : ', ключа нет'))
      : 'профиль не выбран';
    el.llmStatus.textContent = State.llm.enabled
      ? 'Голосовые вопросы: вкл · текст работает всегда'
      : 'Голосовые вопросы: выкл · текст работает всегда';
  }

  function applyProfile(profile) {
    if (!State.llm) return;
    State.llm.active = profile ? profile.id : null;
    if (profile) {
      State.llm.provider = profile.provider || 'openai';
      el.llmName.value = profile.name || '';
      fillModels(profile.model || '');
      el.llmBase.value = profile.base_url || '';
      el.llmKey.value = '';
      el.llmKey.placeholder = profile.key_set ? 'ключ сохранён, можно заменить' : 'ключ не задан';
    } else {
      State.llm.provider = 'openai';
      el.llmName.value = '';
      fillModels('');
      el.llmKey.value = '';
      el.llmKey.placeholder = 'хранится на колонке';
    }
    fillProviderSelect();
    renderProfileChips();
    updateLlmStatus();
  }

  function selectProfile(id) {
    applyProfile(findProfile(id));
  }

  function newProfile() {
    if (!State.llm) return;
    applyProfile(null);
    el.llmName.focus();
    toast('Новый профиль: заполните название, провайдера и ключ', 'ok');
  }

  function applyLlmInfo(data) {
    State.llm = {
      providers: data.providers || [],
      profiles: data.profiles || [],
      active: data.active || null,
      enabled: !!(data.voice_enabled !== undefined ? data.voice_enabled : data.enabled),
      provider: 'openai',
      chats: data.chats || [],
      activeChat: data.active_chat || null
    };
    el.llmEnabled.checked = !!(data.voice_enabled !== undefined ? data.voice_enabled : data.enabled);
    if (el.llmLength) {
      var length = String(data.max_tokens || 260);
      el.llmLength.value = length;
      if (!el.llmLength.value) el.llmLength.value = '260';
    }
    if (el.llmChat) {
      var chatName = data.active_chat_name || 'Чат 1';
      el.llmChat.textContent = chatName;
      el.llmChat.title = chatName;
    }
    var activeChatInfo = State.llm.chats.filter(function (c) { return c.id === State.llm.activeChat; })[0];
    setChatHistoryCount(activeChatInfo ? activeChatInfo.messages : null);
    loadChatHistory();
    if (el.llmSystem) {
      el.llmSystem.value = data.system_prompt || '';
      el.llmSystemStatus.textContent = data.system_prompt ? 'Свой промпт' : 'Стандартный промпт';
    }
    if (el.llmSearch) {
      el.llmSearch.checked = !!data.web_search;
      var mode = data.search_mode || null;
      el.llmSearch.disabled = !mode;
      el.llmSearch.title = mode ? '' : 'У активного провайдера нет встроенного поиска';
      var label = mode === 'openrouter' ? 'родной OpenRouter'
        : mode === 'openai' ? 'родной OpenAI'
          : mode === 'anthropic' ? 'родной Anthropic'
            : mode === 'searx' ? 'свой SearXNG'
              : 'поиск недоступен';
      el.llmSearchStatus.textContent = data.web_search
        ? ('вкл · ' + label) : label;
    }
    if (el.llmFollowUp) {
      el.llmFollowUp.checked = !!data.follow_up;
    }
    if (el.llmSearchUrl && document.activeElement !== el.llmSearchUrl) {
      el.llmSearchUrl.value = data.search_url || '';
    }
    applyLlmContext(data);
    applyProfile(findProfile(data.active));
    updateLlmStatus();
    // Кастомный dropdown мог отрисоваться до ответа llm.py — синхронизируем
    // подпись с только что установленными значениями (длина ответа и т.п.).
    refreshDropdowns();
  }

  /* История активного чата: блок раскрывается по клику, данные берутся из
     llm.py?history=1. Пока блок открыт и виден, он обновляется раз в 15 с —
     так появляются вопросы, заданные голосом. */
  function pluralMessages(n) {
    var m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return 'сообщение';
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'сообщения';
    return 'сообщений';
  }

  function setChatHistoryCount(n) {
    if (!el.llmHistoryCount) return;
    el.llmHistoryCount.textContent = typeof n === 'number' ? (n + ' ' + pluralMessages(n)) : '';
  }

  function assistantLabel() {
    var profile = State.llm && findProfile(State.llm.active);
    return (profile && profile.name) || 'Нейросеть';
  }

  function chatTime(ts) {
    var date = new Date(Number(ts) * 1000);
    if (isNaN(date.getTime())) return '';
    var now = new Date();
    var hm = ('0' + date.getHours()).slice(-2) + ':' + ('0' + date.getMinutes()).slice(-2);
    if (date.toDateString() === now.toDateString()) return hm;
    return ('0' + date.getDate()).slice(-2) + '.' + ('0' + (date.getMonth() + 1)).slice(-2) + ' ' + hm;
  }

  function renderChatHistory(data) {
    var messages = data.messages || [];
    var signature = (data.chat_id || '') + '|' + JSON.stringify(messages);
    setChatHistoryCount(messages.length);
    if (signature === State.chatHistorySig) return;
    State.chatHistorySig = signature;
    var box = el.llmHistory;
    box.textContent = '';
    if (!messages.length) {
      var empty = document.createElement('div');
      empty.className = 'chat-log-empty';
      empty.textContent = 'В этом чате пока нет сообщений.';
      box.appendChild(empty);
      return;
    }
    var who = assistantLabel();
    messages.forEach(function (msg) {
      var item = document.createElement('div');
      item.className = 'chat-msg ' + (msg.role === 'user' ? 'user' : 'assistant');
      var label = document.createElement('span');
      label.className = 'chat-msg-who';
      label.textContent = (msg.role === 'user' ? 'Вы' : who)
        + (msg.ts ? ' · ' + chatTime(msg.ts) : '');
      item.appendChild(label);
      item.appendChild(document.createTextNode(msg.content));
      box.appendChild(item);
    });
    box.scrollTop = box.scrollHeight;
  }

  function loadChatHistory(force) {
    if (!el.llmHistoryBox) return Promise.resolve();
    if (force) State.chatHistorySig = null;
    return cgi('llm.py', { history: 1 }, { timeout: 10000, silent: true })
      .then(renderChatHistory)
      .catch(function (err) {
        State.chatHistorySig = null;
        el.llmHistory.textContent = '';
        var fail = document.createElement('div');
        fail.className = 'chat-log-empty';
        fail.textContent = 'Не удалось загрузить историю: ' + err.message;
        el.llmHistory.appendChild(fail);
      });
  }

  function pollChatHistory() {
    var box = el.llmHistoryBox;
    if (!box || document.hidden || box.offsetParent === null) return;
    loadChatHistory();
  }

  function switchChat(payload) {
    return cgi('llm.py', payload, { timeout: 15000 }).then(function (data) {
      applyLlmInfo(data);
      toast('Чат: ' + (data.active_chat_name || '—'), 'ok');
    }).catch(function (err) {
      toast('Чат: ' + err.message, 'bad');
    });
  }

  function openChatRename() {
    var active = State.llm && State.llm.activeChat;
    if (!active || !el.chatRenameDlg) return;
    el.chatRenameInput.value = el.llmChat ? el.llmChat.textContent : '';
    if (typeof el.chatRenameDlg.showModal === 'function') {
      try { el.chatRenameDlg.showModal(); } catch (e) { return; }
    }
    setTimeout(function () { el.chatRenameInput.focus(); el.chatRenameInput.select(); }, 0);
  }

  function closeChatRename() {
    try { el.chatRenameDlg.close(); } catch (e) {}
  }

  function saveChatRename() {
    var active = State.llm && State.llm.activeChat;
    if (!active) return;
    var name = (el.chatRenameInput.value || '').trim();
    if (!name) { el.chatRenameInput.focus(); return; }
    return cgi('llm.py', { chat_rename: active, chat_name: name }, { timeout: 10000 }).then(function (data) {
      applyLlmInfo(data);
      closeChatRename();
      toast('Чат переименован: ' + (data.active_chat_name || name), 'ok');
    }).catch(function (err) {
      toast('Имя чата: ' + err.message, 'bad');
    });
  }

  function loadLlm() {
    return cgi('llm.py', { info: 1 }, { timeout: 8000, silent: true }).then(function (data) {
      applyLlmInfo(data);
    }).catch(function (err) {
      el.llmStatus.textContent = 'LLM недоступна: ' + err.message;
    });
  }

  /* Местоположение и часовой пояс: модель сама не знает ни даты, ни города,
     llm.py дописывает их к system prompt. Пока пояс не сохранён, подставляем
     пояс браузера — пользователь видит его и сохраняет одной кнопкой. */
  function browserTimezone() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { return ''; }
  }

  function fillTimezoneList() {
    if (!el.llmTimezoneList || el.llmTimezoneList.childElementCount) return;
    var zones = [];
    try { if (Intl.supportedValuesOf) zones = Intl.supportedValuesOf('timeZone'); } catch (e) {}
    var own = browserTimezone();
    if (own && zones.indexOf(own) < 0) zones.unshift(own);
    var frag = document.createDocumentFragment();
    zones.forEach(function (name) {
      var opt = document.createElement('option');
      opt.value = name;
      frag.appendChild(opt);
    });
    el.llmTimezoneList.appendChild(frag);
  }

  function applyLlmContext(data) {
    if (!el.llmLocation) return;
    fillTimezoneList();
    // Пояс станции может быть UTC, поэтому при первом открытии сохраняем пояс
    // браузера сами — иначе модель видит неверное местное время.
    if (!data.timezone && !State.llmTzAutosaved) {
      var detected = browserTimezone();
      if (detected) {
        State.llmTzAutosaved = true;
        cgi('llm.py', { timezone: detected }, { timeout: 10000, silent: true })
          .then(applyLlmInfo)
          .catch(function () {});
      }
    }
    var editing = document.activeElement === el.llmLocation || document.activeElement === el.llmTimezone;
    if (!editing) {
      el.llmLocation.value = data.location || '';
      el.llmTimezone.value = data.timezone || browserTimezone();
    }
    var saved = !!data.timezone;
    el.llmContextStatus.textContent = saved
      ? (data.context || '')
      : 'Пояс не сохранён — используется местное время станции. Проверьте поля и нажмите «Сохранить место».';
  }

  function saveLlmContext() {
    var payload = {
      location: el.llmLocation.value.trim(),
      timezone: el.llmTimezone.value.trim()
    };
    return withBusy(el.btnLlmContext, function () {
      return cgi('llm.py', payload, { timeout: 15000 }).then(function (data) {
        el.llmLocation.blur();
        el.llmTimezone.blur();
        applyLlmInfo(data);
        toast('Местоположение сохранено', 'ok');
      }).catch(function (err) {
        toast('Местоположение: ' + err.message, 'bad');
      });
    });
  }

  function saveLlmSystem() {
    var value = el.llmSystem.value.trim();
    return cgi('llm.py', { system_prompt: value }, { timeout: 15000 }).then(function (data) {
      applyLlmInfo(data);
      toast(value ? 'Промпт сохранён' : 'Вернул стандартный промпт', 'ok');
    }).catch(function (err) {
      toast('Промпт: ' + err.message, 'bad');
    });
  }

  function toggleLlmEnabled() {
    var on = el.llmEnabled.checked ? 1 : 0;
    return cgi('llm.py', { voice_enabled: on }, { timeout: 15000 }).then(function (data) {
      applyLlmInfo(data);
      toast(on ? 'Голосовые вопросы включены' : 'Голосовые вопросы выключены', 'ok');
    }).catch(function (err) {
      el.llmEnabled.checked = !el.llmEnabled.checked;
      toast('Голосовые вопросы: ' + err.message, 'bad');
    });
  }

  function toggleLlmSearch() {
    var on = el.llmSearch.checked ? 1 : 0;
    return cgi('llm.py', { web_search: on }, { timeout: 15000 }).then(function (data) {
      applyLlmInfo(data);
      toast(on ? 'Поиск в интернете включён' : 'Поиск в интернете выключен', 'ok');
    }).catch(function (err) {
      el.llmSearch.checked = !el.llmSearch.checked;
      toast('Поиск: ' + err.message, 'bad');
    });
  }

  function toggleFollowUp() {
    var on = el.llmFollowUp.checked ? 1 : 0;
    return cgi('llm.py', { follow_up: on }, { timeout: 15000 }).then(function (data) {
      applyLlmInfo(data);
      toast(on ? 'Продолжение разговора включено' : 'Продолжение разговора выключено', 'ok');
    }).catch(function (err) {
      el.llmFollowUp.checked = !el.llmFollowUp.checked;
      toast('Продолжение: ' + err.message, 'bad');
    });
  }

  function saveLlmSearchUrl() {
    var url = el.llmSearchUrl.value.trim();
    return cgi('llm.py', { search_url: url }, { timeout: 15000 }).then(function (data) {
      applyLlmInfo(data);
      toast(url ? 'SearXNG сохранён' : 'По умолчанию — Bing', 'ok');
    }).catch(function (err) {
      toast('SearXNG: ' + err.message, 'bad');
    });
  }

  function saveLlm() {
    var model = el.llmModel.value === '__custom'
      ? el.llmModelCustom.value.trim()
      : el.llmModel.value;
    var name = el.llmName.value.trim();
    if (name.length < 2) {
      toast('Название профиля: минимум 2 символа', 'warn');
      return;
    }
    var payload = {
      name: name,
      provider: (State.llm && State.llm.provider) || 'openai',
      model: model,
      base_url: el.llmBase.value.trim(),
      voice_enabled: el.llmEnabled.checked ? 1 : 0
    };
    if (State.llm && State.llm.active) payload.profile_id = State.llm.active;
    var key = el.llmKey.value.trim();
    if (key) payload.key = key;

    return withBusy(el.btnLlmSave, function () {
      return cgi('llm.py', payload, { timeout: 15000 }).then(function (data) {
        el.llmKey.value = '';
        applyLlmInfo(data);
        toast('Профиль сохранён: ' + name, 'ok');
      }).catch(function (err) {
        toast('LLM: ' + err.message, 'bad');
      });
    });
  }

  function renderLlmSources(items, note) {
    if (!el.llmSources) return;
    el.llmSources.innerHTML = '';
    if (!items || !items.length) {
      var empty = !!note;
      el.llmSources.hidden = !empty;
      if (empty) el.llmSources.textContent = 'Поиск: ' + note;
      return;
    }
    el.llmSources.hidden = false;
    var head = document.createElement('div');
    head.className = 'seg-note';
    head.textContent = 'Источники:';
    el.llmSources.appendChild(head);
    items.forEach(function (item) {
      var link = document.createElement('a');
      link.className = 'llm-source';
      link.href = item.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = item.title || item.url;
      link.title = item.url;
      el.llmSources.appendChild(link);
    });
  }

  function askLlm(voice) {
    var prompt = el.llmPrompt.value.trim();
    if (!prompt) { toast('Введите запрос', 'warn'); return; }
    var button = voice && el.btnLlmAskSay ? el.btnLlmAskSay : el.btnLlmAsk;
    return withBusy(button, function () {
      el.llmAnswer.textContent = 'Думаю…';
      el.llmAnswer.classList.remove('empty');
      return cgi('llm.py', { prompt: prompt }, { timeout: 95000 }).then(function (data) {
        State.llmAnswer = data.answer || '';
        el.llmAnswer.textContent = '';
        el.llmAnswer.classList.add('empty');
        el.llmPrompt.value = '';
        renderLlmSources(data.sources, data.search_note);
        var tokens = data.usage && data.usage.total_tokens
          ? ' · ' + data.usage.total_tokens + ' токенов' : '';
        el.llmMeta.textContent = [data.provider, data.model].filter(Boolean).join(' · ') + tokens;
        loadChatHistory(true);
        if (voice && State.llmAnswer) {
          return cgi('speak.py', { text: State.llmAnswer.slice(0, 1900) }, { timeout: 40000 })
            .then(function (res) {
              toast(res && res.started ? 'Алиса читает ответ' : 'Ответ отправлен', 'ok');
            })
            .catch(function (err) {
              toast('Озвучка: ' + err.message, 'bad');
            });
        }
      }).catch(function (err) {
        el.llmAnswer.textContent = 'Ошибка: ' + err.message;
        el.llmAnswer.classList.remove('empty');
        toast('Нейросеть: ' + err.message, 'bad');
      });
    });
  }

  function loadIpv6() {
    return cgi('ipv6.py', {}, { timeout: 10000, silent: true }).then(function (data) {
      if (!data.supported) {
        el.netIpv6.checked = false;
        el.netIpv6.disabled = true;
        el.ipv6Status.textContent = 'IPv6 не поддерживается ядром';
        return;
      }
      el.netIpv6.checked = !data.disabled;
      el.ipv6Status.textContent = data.disabled
        ? 'выключен · используется IPv4'
        : 'включён · при отсутствии IPv6 возможны задержки';
    }).catch(function (err) {
      el.ipv6Status.textContent = 'IPv6: ' + err.message;
    });
  }

  function toggleIpv6() {
    var disabled = !el.netIpv6.checked;
    el.ipv6Status.textContent = disabled ? 'выключаю…' : 'включаю…';
    cgi('ipv6.py', { disabled: disabled }, { timeout: 15000 }).then(function (data) {
      el.netIpv6.checked = !data.disabled;
      el.ipv6Status.textContent = data.disabled
        ? 'выключен · используется IPv4'
        : 'включён · при отсутствии IPv6 возможны задержки';
      toast(data.disabled ? 'IPv6 выключен' : 'IPv6 включён',
        data.disabled ? 'ok' : 'warn');
    }).catch(function (err) {
      el.netIpv6.checked = !el.netIpv6.checked;
      el.ipv6Status.textContent = 'IPv6: ' + err.message;
      toast('IPv6: ' + err.message, 'bad');
    });
  }

  /* ─────────── VPN ─────────── */
  function renderVpn(data) {
    State.vpn = data;
    var status = data.running
      ? ('включён' + (data.tun ? ' · tun0' : ' · tun0 нет'))
      : (data.url_set ? 'выключен' : 'не настроено');
    el.vpnStatus.textContent = status;
    renderVpnButton();
    el.vpnAutostart.checked = !!data.autostart;
    if (data.url_hint) el.vpnUrl.placeholder = data.url_hint;

    var servers = data.servers || [];
    var previous = el.vpnServer.value;
    el.vpnServer.innerHTML = '';
    servers.forEach(function (server) {
      var option = document.createElement('option');
      option.value = String(server.index);
      option.textContent = (server.name || ('сервер ' + (server.index + 1))) +
        ' · ' + (server.type || '');
      el.vpnServer.appendChild(option);
    });
    el.vpnServer.disabled = !servers.length;
    if (servers.length) {
      var exists = false;
      for (var i = 0; i < el.vpnServer.options.length; i++) {
        if (el.vpnServer.options[i].value === previous) exists = true;
      }
      el.vpnServer.value = exists ? previous : String(data.selected || 0);
    }
  }

  function loadVpn() {
    return cgi('vpn.py', { info: 1 }, { timeout: 10000, silent: true })
      .then(renderVpn)
      .catch(function (err) { el.vpnStatus.textContent = 'VPN: ' + err.message; });
  }

  function saveVpn() {
    var url = el.vpnUrl.value.trim();
    if (!url) { toast('Вставьте ссылку на подписку', 'warn'); return; }
    return withBusy(el.btnVpnSave, function () {
      el.vpnStatus.textContent = 'скачиваю подписку…';
      return cgi('vpn.py', { url: url }, { timeout: 90000 }).then(function (data) {
        toast('Подписка: ' + data.servers.length + ' серверов', 'ok');
        el.vpnUrl.value = '';
        return loadVpn();
      }).catch(function (err) {
        el.vpnStatus.textContent = 'ошибка подписки';
        toast('VPN: ' + err.message, 'bad');
      });
    });
  }

  function renderVpnButton() {
    var button = el.btnVpnToggle;
    if (!button) return;
    var data = State.vpn || {};
    var running = !!data.running;
    var busy = !!State.vpnBusy;
    button.classList.toggle('primary', !running);
    button.classList.toggle('danger', running);
    button.classList.toggle('is-busy', busy);
    button.textContent = busy
      ? (State.vpnBusy === 'stop' ? 'Выключаю…' : 'Включаю…')
      : (running ? 'Выключить' : 'Включить');
    button.disabled = busy || (!running && !data.url_set);
    button.setAttribute('aria-busy', busy ? 'true' : 'false');
  }

  function toggleVpn() {
    var button = el.btnVpnToggle;
    if (!button || State.vpnBusy || button.dataset.busy === '1') return;
    var data = State.vpn || {};
    var running = !!data.running;
    if (!running && !data.url_set) return;
    var index = parseInt(el.vpnServer.value, 10) || 0;
    State.vpnBusy = running ? 'stop' : 'start';
    button.dataset.busy = '1';
    renderVpnButton();
    el.vpnStatus.textContent = running ? 'выключаю…' : 'поднимаю туннель…';
    busyStart();
    var request = running
      ? cgi('vpn.py', { stop: 1 }, { timeout: 30000 })
      : cgi('vpn.py', { start: 1, index: index }, { timeout: 240000 });
    return request.then(function () {
      if (!running) {
        el.vpnLog.hidden = true;
        toast('VPN включён', 'ok');
      } else {
        toast('VPN выключен', 'ok');
      }
      State.vpn = Object.assign({}, State.vpn || {}, { running: !running });
      renderVpnButton();
      return loadVpn();
    }).catch(function (err) {
      if (!running) {
        var details = err.data && err.data.log;
        if (details) {
          el.vpnLog.hidden = false;
          el.vpnLog.textContent = details;
        }
      }
      if (State.vpn) renderVpn(State.vpn);
      el.vpnStatus.textContent = running ? 'ошибка остановки' : 'ошибка запуска';
      toast('VPN: ' + err.message, 'bad');
    }).then(function () {
      State.vpnBusy = null;
      delete button.dataset.busy;
      busyEnd();
      renderVpnButton();
    });
  }

  /* ─────────── радио ─────────── */
  function filterRadio() {
    if (!el.radioChips || !el.radioSearch) return;
    var query = (el.radioSearch.value || '').trim().toLowerCase();
    Array.prototype.forEach.call(el.radioChips.children, function (option) {
      var label = option.querySelector('.radio-label');
      var name = label ? (label.textContent || '').toLowerCase() : '';
      option.hidden = !!query && name.indexOf(query) < 0;
    });
  }

  function placeRadioPop() {
    if (!el.radioPop || !el.btnRadioPick || el.radioPop.hidden) return;
    var rect = el.btnRadioPick.getBoundingClientRect();
    var width = Math.max(220, Math.min(420, rect.width));
    var left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    var below = window.innerHeight - rect.bottom - 12;
    var above = rect.top - 12;
    var up = below < 220 && above > below;
    var height = Math.max(140, Math.min(360, up ? above : below));
    el.radioPop.style.position = 'fixed';
    el.radioPop.style.width = width + 'px';
    el.radioPop.style.left = left + 'px';
    el.radioPop.style.maxHeight = height + 'px';
    el.radioPop.style.overflow = 'auto';
    if (up) {
      el.radioPop.style.top = 'auto';
      el.radioPop.style.bottom = (window.innerHeight - rect.top + 6) + 'px';
    } else {
      el.radioPop.style.top = (rect.bottom + 6) + 'px';
      el.radioPop.style.bottom = 'auto';
    }
  }

  function toggleRadioPop(show) {
    if (!el.radioPop || !el.btnRadioPick) return;
    if (show) placeRadioPop();
    el.radioPop.hidden = !show;
    el.btnRadioPick.setAttribute('aria-expanded', show ? 'true' : 'false');
    if (show) {
      el.radioSearch.value = '';
      filterRadio();
      placeRadioPop();
      focusOnDesktop(el.radioSearch, 30);
    }
  }

  function markRadioChip() {
    var current = State.radio ? State.radio.index : null;
    var station = null;
    if (State.radio && State.radio.stations) {
      State.radio.stations.some(function (item) {
        if (item.index === current) { station = item; return true; }
        return false;
      });
    }
    if (el.radioPickName) {
      el.radioPickName.textContent = station ? station.name : 'Выберите станцию';
    }
    if (el.radioPickCount) {
      el.radioPickCount.textContent = String((State.radio && State.radio.stations || []).length);
    }
    Array.prototype.forEach.call(el.radioChips.children, function (option) {
      var active = parseInt(option.dataset.index, 10) === current;
      option.setAttribute('aria-pressed', String(active));
      option.setAttribute('aria-selected', String(active));
    });
  }

  function renderRadio(stations) {
    if (!State.radio) State.radio = { stations: [], index: null };
    State.radio.stations = stations || [];
    el.radioChips.innerHTML = '';
    State.radio.stations.forEach(function (station) {
      var option = document.createElement('button');
      option.type = 'button';
      option.className = 'alarm-station-item radio-option';
      option.dataset.index = station.index;
      option.setAttribute('role', 'option');
      var label = document.createElement('span');
      label.className = 'radio-label';
      label.textContent = station.name;
      option.appendChild(label);
      if (station.url) {
        option.classList.add('radio-url');
        option.title = 'Поток: ' + station.url;
      } else {
        option.title = 'Алиса: ' + (station.query || station.name);
      }
      if (station.custom) {
        var del = document.createElement('span');
        del.className = 'chip-x';
        del.textContent = '×';
        del.title = 'Удалить канал';
        del.addEventListener('click', function (ev) {
          ev.stopPropagation();
          removeRadio(station.name);
        });
        option.appendChild(del);
      }
      el.radioChips.appendChild(option);
    });
    markRadioChip();
    filterRadio();
  }

  function loadRadio() {
    return cgi('radio.py', {}, { timeout: 8000, silent: true }).then(function (data) {
      renderRadio(data.stations || []);
      if (data.stream && data.stream.playing) {
        el.radioStatus.textContent = 'играет свой поток';
      }
    }).catch(function (err) {
      el.radioStatus.textContent = 'радио: ' + err.message;
    });
  }

  function addRadioStream() {
    var name = el.radioName.value.trim();
    var url = el.radioUrl.value.trim();
    if (name.length < 2) {
      toast('Название потока — минимум 2 символа', 'warn');
      el.radioName.focus();
      return;
    }
    if (!/^https?:\/\/[^\s]+$/.test(url)) {
      toast('Ссылка должна начинаться с http:// или https://', 'warn');
      el.radioUrl.focus();
      return;
    }
    return withBusy(el.btnRadioStream, function () {
      return cgi('radio.py', { add: name, url: url }, { timeout: 15000 }).then(function (data) {
        renderRadio(data.stations || []);
        el.radioName.value = '';
        el.radioUrl.value = '';
        toast('Поток добавлен: ' + name, 'ok');
      }).catch(function (err) {
        toast('Радио: ' + err.message, 'bad');
      });
    });
  }

  function addRadio() {
    var name = el.radioName.value.trim();
    if (name.length < 2) {
      toast('Название канала — минимум 2 символа', 'warn');
      return;
    }
    return withBusy(el.btnRadioAdd, function () {
      return cgi('radio.py', { add: name }, { timeout: 15000 }).then(function (data) {
        renderRadio(data.stations || []);
        el.radioName.value = '';
        toast('Канал добавлен: ' + name, 'ok');
      }).catch(function (err) {
        toast('Радио: ' + err.message, 'bad');
      });
    });
  }

  function removeRadio(name) {
    return cgi('radio.py', { remove: name }, { timeout: 15000 }).then(function (data) {
      renderRadio(data.stations || []);
      toast('Канал удалён: ' + name, 'ok');
    }).catch(function (err) {
      toast('Радио: ' + err.message, 'bad');
    });
  }

  function playRadio(index) {
    return withBusy(null, function () {
      el.radioStatus.textContent = 'включаю…';
      return cgi('radio.py', { index: index }, { timeout: 60000 }).then(function (data) {
        if (State.radio) State.radio.index = index;
        markRadioChip();
        if (data.stream) {
          el.radioStatus.textContent = 'поток: ' +
            (((data.station || {}).name) || 'свой канал');
        } else {
          el.radioStatus.textContent = (data.playing ? 'играет: ' : 'загружено: ') +
            (data.title || 'радио');
        }
        refreshPlayer(true);
      }).catch(function (err) {
        el.radioStatus.textContent = 'не включилось';
        if (err.data && err.data.log) log('radio', 'stream', err.data.log, true);
        toast('Радио: ' + err.message, 'bad');
      });
    });
  }

  function stopRadio() {
    return withBusy(null, function () {
      return cgi('radio.py', { stop: 1 }, { timeout: 15000 }).then(function () {
        if (State.radio) State.radio.index = null;
        markRadioChip();
        el.radioStatus.textContent = 'остановлено';
        refreshPlayer(true);
      }).catch(function (err) {
        toast('Радио: ' + err.message, 'bad');
      });
    });
  }

  function stepRadio(delta) {
    if (!State.radio || !State.radio.stations.length) return;
    var count = State.radio.stations.length;
    var current = State.radio.index === null ? 0 : State.radio.index;
    var next = ((current + delta) % count + count) % count;
    playRadio(next);
  }

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
      if (el.voiceMusicVoice) {
        el.voiceMusicVoice.value = data.music_voice ? 'on' : 'off';
      }
      if (el.voiceMusicDefault) {
        el.voiceMusicDefault.value = data.music_default || '';
        el.voiceMusicDefault.disabled = !data.music_voice;
      }
      // Селекты усилены кастомными списками: после программной установки
      // значения нужно обновить их подписи, иначе видно старый пункт.
      if (typeof refreshDropdowns === 'function') refreshDropdowns();
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

  function setVoiceMusicVoice(on) {
    return cgi('voicecfg.py', { music_voice: on }, { timeout: 10000 }).then(function () {
      toast(on ? 'Музыка голосом включена' : 'Музыка голосом выключена', 'ok');
      return loadVoice();
    }).catch(function (err) {
      toast('Голос: ' + err.message, 'bad');
      return loadVoice();
    });
  }

  function setVoiceMusicDefault(mode) {
    return cgi('voicecfg.py', { music_default: mode }, { timeout: 10000 }).then(function () {
      toast(mode ? '«Включи музыку» — из выбранного сервиса'
        : '«Включи музыку» — Алиса', 'ok');
      return loadVoice();
    }).catch(function (err) {
      toast('Голос: ' + err.message, 'bad');
      return loadVoice();
    });
  }

  /* ─────────── индикация панели (Station 2) ─────────── */
  function renderPanel(data) {
    if (!el.cardPanel) return;
    var supported = !!(data && data.supported);
    el.cardPanel.hidden = !supported;
    if (!supported) return;
    var max = data.max || 255;
    var current = data.current == null ? max : data.current;
    el.panelBright.max = max;
    el.panelBright.value = current;
    el.panelBrightVal.textContent = current + ' / ' + max;
    el.panelStatus.textContent = data.off ? 'панель погашена' : 'светится';
  }

  function loadPanel() {
    return cgi('panel.py', {}, { timeout: 8000, silent: true }).then(function (data) {
      State.panel = data;
      renderPanel(data);
    }).catch(function () {
      if (el.cardPanel) el.cardPanel.hidden = true;
    });
  }

  function setPanel(payload) {
    return cgi('panel.py', payload, { timeout: 8000 }).then(function (data) {
      State.panel = data;
      renderPanel(data);
      return data;
    }).catch(function (err) {
      toast('Панель: ' + err.message, 'bad');
    });
  }

  /* ─────────── ресурсы ─────────── */
  function loadLevel(percent) {
    if (percent == null) return '';
    if (percent >= 85) return 'bad';
    if (percent >= 65) return 'warn';
    return '';
  }

  function fmtMb(kb) {
    return Math.round(kb / 1024) + ' МБ';
  }

  function fmtUptime(seconds) {
    if (seconds == null) return '—';
    var days = Math.floor(seconds / 86400);
    var hours = Math.floor((seconds % 86400) / 3600);
    var mins = Math.floor((seconds % 3600) / 60);
    if (days) return days + ' д ' + hours + ' ч';
    if (hours) return hours + ' ч ' + mins + ' м';
    return mins + ' мин';
  }

  function renderHardware(items) {
    if (!el.hwList) return;
    el.hwList.innerHTML = '';
    if (!items || !items.length) {
      var empty = document.createElement('div');
      empty.className = 'seg-note';
      empty.textContent = 'Характеристики недоступны.';
      el.hwList.appendChild(empty);
      return;
    }
    items.forEach(function (item) {
      var row = document.createElement('div');
      row.className = 'hw-item';
      var label = document.createElement('span');
      label.className = 'hw-label';
      label.textContent = item.label;
      var value = document.createElement('span');
      value.className = 'hw-value';
      value.textContent = item.value || '—';
      var src = document.createElement('span');
      src.className = 'hw-src' + (item.source === 'wiki' ? ' wiki' : '');
      src.textContent = item.source === 'wiki' ? 'вики' : 'система';
      src.title = item.source === 'wiki'
        ? 'Linux не отдаёт это значение; взято из статьи hackalice.me'
        : 'Прочитано из /proc или /sys';
      row.appendChild(label);
      row.appendChild(value);
      row.appendChild(src);
      el.hwList.appendChild(row);
    });
  }

  function refreshSystem() {
    if (document.hidden || (State.tab !== 'system' && State.tab !== 'home')) {
      return Promise.resolve();
    }
    return fetch('/state?full=1', { cache: 'no-store', credentials: 'same-origin' })
      .then(function (res) {
        if (!res.ok) throw new Error('state ' + res.status);
        return res.json();
      })
      .then(function (state) {
        if (state.system && Object.keys(state.system).length) return state.system;
        return cgi('system.py', {}, { timeout: 8000, silent: true });
      })
      .catch(function () {
        return cgi('system.py', {}, { timeout: 8000, silent: true });
      })
      .then(function (data) {
      var cpu = data.cpu || {};
      el.sysCpu.textContent = (cpu.percent == null) ? '—' : cpu.percent + '%';
      el.sysCpuBar.style.width = (cpu.percent || 0) + '%';
      el.sysCpuBar.className = loadLevel(cpu.percent);
      el.sysLoad.textContent = cpu.load ? ('load ' + cpu.load.join(' · ')) : '';

      var mem = data.memory || {};
      el.sysRam.textContent = (mem.percent == null) ? '—' : mem.percent + '%';
      el.sysRamBar.style.width = (mem.percent || 0) + '%';
      el.sysRamBar.className = loadLevel(mem.percent);
      el.sysRamSub.textContent = mem.total_kb
        ? (fmtMb(mem.used_kb) + ' из ' + fmtMb(mem.total_kb))
        : '';

      var temp = data.temperature || {};
      var hot = temp.hottest;
      el.sysTemp.textContent = hot ? (hot.c + '°C') : '—';
      el.sysTempSub.textContent = hot ? hot.name : 'датчик не найден';

      function paintDisk(disk, valueEl, barEl, subEl) {
        if (!disk) {
          valueEl.textContent = '—';
          subEl.textContent = 'нет данных';
          return;
        }
        valueEl.textContent = disk.percent + '%';
        barEl.style.width = disk.percent + '%';
        barEl.className = loadLevel(disk.percent);
        var free = disk.free_mb >= 1024
          ? (Math.round(disk.free_mb / 102.4) / 10) + ' ГБ'
          : Math.round(disk.free_mb) + ' МБ';
        var total = disk.total_mb >= 1024
          ? (Math.round(disk.total_mb / 102.4) / 10) + ' ГБ'
          : Math.round(disk.total_mb) + ' МБ';
        subEl.textContent = 'свободно ' + free + ' из ' + total;
      }

      var disks = {};
      (data.disk || []).forEach(function (item) { disks[item.mount] = item; });
      paintDisk(disks['/data'], el.sysDisk, el.sysDiskBar, el.sysDiskSub);
      paintDisk(disks['/'], el.sysRoot, el.sysRootBar, el.sysRootSub);
      renderHardware(data.hardware);

      var light = data.light;
      if (light) {
        var unit = light.unit === 'lux' ? 'lx' : (light.unit || '');
        el.sysLight.textContent = Math.round(light.value) + (unit ? ' ' + unit : '');
        el.sysLightSub.textContent = light.name || 'датчик света';
      } else {
        el.sysLight.textContent = '—';
        el.sysLightSub.textContent = 'нет датчика';
      }
      el.sysUptime.textContent = fmtUptime(data.uptime_s);
      el.sysBoard.textContent = data.board || '';
      syncHomeStats(data);
    }).catch(function () { /* тихо */ });
  }

  /* ─────────── разделы ─────────── */
  var TABS = ['home', 'display', 'sound', 'ai', 'network', 'scenarios', 'system'];
  var TAB_KEY = 'mypult.tab';
  var START_KEY = 'mypult.start-system';

  function loadTabData(name) {
    if (name === 'home') {
      refreshSystem();
      loadAlarms(true);
      refreshPlayer(true);
      syncHomePlayer();
      syncHomeAlarm();
    } else if (name === 'display') {
      loadRingBrightness();
      loadDisplayState();
    } else if (name === 'sound') {
      loadRadio();
      loadVoice();
    } else if (name === 'ai') {
      loadLlm();
    } else if (name === 'network') {
      loadVpn();
      loadBt();
      loadNet();
      loadZb();
      loadIpv6();
    } else if (name === 'system') {
      loadVoice();
      loadLogs();
      loadSounds();
      refreshSystem();
      loadCharts();
    } else if (name === 'scenarios') {
      loadScenarios();
      loadSounds();
    }
  }

  // Фиксированный шаг сетки: строка 36 px, зазор 12 px. Карточка занимает
  // целое число строк и растягивается на них, поэтому все блоки выровнены
  // по общей вертикальной сетке.
  var PACK_UNIT = 36;
  var PACK_GAP = 12;
  var packTimer = 0;
  var packing = false;
  var cardResizing = false;
  var packObserver = null;


  var INNER_CAPS = { '.log': 240, '.sound-list': 300 };

  function resetInnerCaps(cards) {
    cards.forEach(function (card) {
      Object.keys(INNER_CAPS).forEach(function (selector) {
        Array.prototype.forEach.call(card.querySelectorAll(selector), function (el) {
          el.style.maxHeight = INNER_CAPS[selector] + 'px';
        });
      });
    });
  }

  function fitInnerHeights() {
    Array.prototype.forEach.call(document.querySelectorAll('main.grid > .card'), function (card) {
      if (card.classList.contains('is-hidden')) return;
      var box = card.getBoundingClientRect();
      Array.prototype.forEach.call(card.querySelectorAll('.log, .sound-list'), function (el) {
        var rect = el.getBoundingClientRect();
        // Оставляем место элементам после списка (подписи, итоги, кнопки):
        // иначе список растягивается до низа карточки и обрезает их.
        var after = 0;
        var node = el.nextElementSibling;
        while (node) {
          var nodeStyle = getComputedStyle(node);
          after += node.offsetHeight +
            (parseFloat(nodeStyle.marginTop) || 0) +
            (parseFloat(nodeStyle.marginBottom) || 0);
          node = node.nextElementSibling;
        }
        var available = Math.max(80, Math.round(box.bottom - rect.top - after - 16));
        el.style.maxHeight = available + 'px';
      });
      card.dataset.packH = String(Math.ceil(card.scrollHeight));
    });
  }

  function packCards() {
    if (packing || cardResizing) return;
    if (document.body.classList.contains('card-dragging')) return;
    var grid = document.querySelector('main.grid');
    if (!grid) return;
    packing = true;
    try {
      var cards = Array.prototype.filter.call(grid.children, function (node) {
        return node.classList.contains('card');
      });
      if (!cards.length) return;
      grid.style.gridAutoRows = PACK_UNIT + 'px';
      resetInnerCaps(cards);
      cards.forEach(function (card) {
        if (card.classList.contains('is-hidden')) {
          if (card.dataset.packBox) {
            card.style.height = '';
            delete card.dataset.packBox;
          }
          return;
        }
        // Текущий span и высота — чтобы не трогать карточку без нужды:
        // каждый лишний сброс height вызывал reflow и прыжки прокрутки.
        var currentSpan = parseInt(String(card.style.gridRowEnd || '').replace(/[^0-9]/g, ''), 10) || 0;
        var height;
        var forceFit = !!card.dataset.forceFit;
        if (forceFit) {
          var prevHeight = card.style.height;
          var prevAlign = card.style.alignSelf;
          card.style.height = 'auto';
          card.style.alignSelf = 'start';
          height = Math.ceil(card.getBoundingClientRect().height);
          card.style.height = prevHeight;
          card.style.alignSelf = prevAlign;
          delete card.dataset.forceFit;
        } else {
          // scrollHeight не меньше текущей высоты: карточка растёт, когда
          // содержимому становится тесно, и не «дышит» на каждом опросе.
          height = Math.ceil(card.scrollHeight);
        }
        var span = Math.max(1, Math.ceil((height + PACK_GAP) / (PACK_UNIT + PACK_GAP)));
        var wanted = Number(card.dataset.rows || 0);
        if (wanted > span) span = wanted;
        // Без forceFit карточка не сжимается (чтобы не дёргалась на опросах),
        // но после сворачивания/удаления контента — сжимается до контента
        // или до вручную выставленной высоты.
        if (!forceFit && currentSpan && span < currentSpan) span = currentSpan;
        var box = span * (PACK_UNIT + PACK_GAP) - PACK_GAP;
        var before = Number(card.dataset.packBox || 0);
        if (currentSpan !== span) card.style.gridRowEnd = 'span ' + span;
        if (card.dataset.packBox !== String(box)) {
          card.style.height = box + 'px';
          card.dataset.packBox = String(box);
          if (before && Math.abs(before - box) > 1 && card.animate) {
            card.animate([{ height: before + 'px' }, { height: box + 'px' }],
              { duration: 180, easing: 'ease-out' });
          }
        }
        card.dataset.packH = String(Math.ceil(card.scrollHeight));
      });
      fitInnerHeights();
    } finally {
      packing = false;
    }
  }

  function fitCardToContent(card) {
    if (!card || card.classList.contains('is-hidden')) return;
    var prevHeight = card.style.height;
    var prevAlign = card.style.alignSelf;
    var inner = card.querySelectorAll('.log, .sound-list');
    var prevCaps = [];
    Array.prototype.forEach.call(inner, function (el, index) {
      prevCaps[index] = el.style.maxHeight;
      el.style.maxHeight = (INNER_CAPS[el.classList.contains('log') ? '.log' : '.sound-list']) + 'px';
    });
    card.style.height = 'auto';
    card.style.alignSelf = 'start';
    var height = Math.ceil(card.getBoundingClientRect().height);
    card.style.height = prevHeight;
    card.style.alignSelf = prevAlign;
    Array.prototype.forEach.call(inner, function (el, index) {
      el.style.maxHeight = prevCaps[index];
    });
    var span = Math.max(1, Math.ceil((height + PACK_GAP) / (PACK_UNIT + PACK_GAP)));
    var wanted = Number(card.dataset.rows || 0);
    if (wanted > span) span = wanted;
    var box = span * (PACK_UNIT + PACK_GAP) - PACK_GAP;
    card.style.gridRowEnd = 'span ' + span;
    card.style.height = box + 'px';
    card.dataset.packBox = String(box);
    card.dataset.packH = String(Math.ceil(card.scrollHeight));
  }

  // Раскрытие/сворачивание details внутри карточки: разрешаем карточке
  // и вырасти, и сжаться обратно (forceFit), иначе после сворачивания
  // оставалась пустая высота.
  document.addEventListener('toggle', function (event) {
    var target = event.target;
    if (!target || target.tagName !== 'DETAILS') return;
    var card = target.closest('main.grid > .card');
    if (!card) return;
    card.dataset.forceFit = '1';
    fitCardToContent(card);
    schedulePack();
  }, true);

  function contentChanged() {
    var cards = document.querySelectorAll('main.grid > .card');
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      if (card.classList.contains('is-hidden')) continue;
      var stored = Number(card.dataset.packH || 0);
      if (Math.abs(card.scrollHeight - stored) > 1) return true;
    }
    return false;
  }

  function schedulePack() {
    clearTimeout(packTimer);
    packTimer = setTimeout(packCards, 90);
  }

  function observeCards() {
    if (!window.ResizeObserver) return;
    if (packObserver) packObserver.disconnect();
    packObserver = new ResizeObserver(function () {
      if (!packing && contentChanged()) schedulePack();
    });
    Array.prototype.forEach.call(
      document.querySelectorAll('main.grid > .card'),
      function (card) { packObserver.observe(card); });
    // Раскрыли блок внутри карточки, подгрузился текст или список — высота
    // содержимого меняется, хотя сама карточка ещё нет. Пересобираем сетку.
    var contentObserver = new MutationObserver(function (records) {
      if (packing || cardResizing ||
          document.body.classList.contains('card-dragging')) return;
      records.forEach(function (record) {
        var node = record.target;
        if (node && node.nodeType !== 1) node = node.parentElement;
        var card = node && node.closest ? node.closest('main.grid > .card') : null;
        if (card) card.dataset.forceFit = '1';
      });
      schedulePack();
    });
    var grid = document.querySelector('main.grid');
    if (grid) {
      contentObserver.observe(grid, {
        childList: true,
        subtree: true,
        characterData: false,
        attributes: true,
        attributeFilter: ['open', 'hidden', 'class']
      });
    }
  }

  window.addEventListener('resize', schedulePack);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(schedulePack);

  function showTab(name, save) {
    if (TABS.indexOf(name) < 0) name = 'display';
    document.body.dataset.tab = name;
    Array.prototype.forEach.call(document.querySelectorAll('.card[data-group]'), function (card) {
      card.classList.toggle('is-hidden', card.dataset.group !== name);
    });
    Array.prototype.forEach.call(el.tabs.children, function (btn) {
      btn.setAttribute('aria-pressed', String(btn.dataset.tab === name));
    });
    State.tab = name;
    loadTabData(name);
    if (name === 'network') startBtCardPoll();
    else stopBtCardPoll();
    var activeTab = el.tabs.querySelector('.tab[aria-pressed="true"]');
    var mobileLabel = document.getElementById('mobileTabLabel');
    if (mobileLabel && activeTab) {
      mobileLabel.textContent = activeTab.textContent.trim().replace(/^[^A-Za-zА-Яа-я]+/, '');
    }
    Array.prototype.forEach.call(
      document.querySelectorAll('#mobileTabsMenu [data-tab]'), function (item) {
        item.setAttribute('aria-pressed', String(item.dataset.tab === name));
      });
    var mobileMenu = document.getElementById('mobileTabsMenu');
    var mobileButton = document.getElementById('btnMobileTabs');
    if (mobileMenu) mobileMenu.hidden = true;
    if (mobileButton) mobileButton.setAttribute('aria-expanded', 'false');
    setTimeout(refreshDropdowns, 80);
    schedulePack();
    if (name === 'sound' || name === 'home') startVolumePoll();
    else stopVolumePoll();
    if (name === 'sound' || name === 'home') startPlayerPoll();
    else stopPlayerPoll();
    scheduleStateRefresh();
    if (save !== false) {
      store.set(TAB_KEY, name);
      if (window.scrollTo) window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    if (history.replaceState) history.replaceState(null, '', '#' + name);
  }

  /* ─────────── bluetooth ─────────── */
  function showScanSkeleton(list, count) {
    list.innerHTML = '';
    for (var i = 0; i < count; i++) {
      var row = document.createElement('div');
      row.className = 'bt-item scan-skeleton';
      var name = document.createElement('span');
      name.className = 'sk-name';
      var state = document.createElement('span');
      state.className = 'sk-state';
      var button = document.createElement('span');
      button.className = 'sk-btn';
      row.appendChild(name);
      row.appendChild(state);
      row.appendChild(button);
      list.appendChild(row);
    }
  }

  function beginScan(button, status, text) {
    if (!button) return false;
    button.dataset.scanLabel = button.textContent;
    button.disabled = true;
    button.classList.add('is-scanning');
    button.textContent = 'Сканирую…';
    status.textContent = text;
    status.classList.add('scanning-text');
    return true;
  }

  function endScan(button, status) {
    if (button) {
      button.disabled = false;
      button.classList.remove('is-scanning');
      button.textContent = button.dataset.scanLabel || 'Сканировать';
    }
    if (status) status.classList.remove('scanning-text');
  }

  function btRow(item, onAction) {
    var row = document.createElement('div');
    row.className = 'bt-item';
    var name = document.createElement('span');
    name.className = 'name';
    name.textContent = item.name || item.mac;
    var state = document.createElement('small');
    state.textContent = item.connected ? 'подключено' : (item.paired ? 'сопряжено' : '');
    var btn = document.createElement('button');
    btn.className = 'btn sm ghost';
    btn.textContent = item.connected ? 'Отключить' : 'Подключить';
    btn.addEventListener('click', function () { onAction(item); });
    row.appendChild(name);
    row.appendChild(state);
    row.appendChild(btn);
    return row;
  }

  function renderBt(data) {
    State.bt = data;
    el.btnBtPower.textContent = data.powered ? 'Bluetooth: вкл' : 'Bluetooth: выкл';
    el.btnBtPairMode.textContent = data.discoverable ? 'Сопряжение: вкл' : 'Сопряжение: выкл';
    el.btStatus.textContent = (data.powered ? 'адаптер включён' : 'адаптер выключен') +
      ' · ' + (data.discoverable ? 'видим для сопряжения' : 'скрыт') +
      (data.audio ? ' · A2DP-приёмник активен' : ' · bluealsa не запущен');
    el.btDevices.innerHTML = '';
    (data.devices || []).forEach(function (item) {
      el.btDevices.appendChild(btRow(item, function (device) {
        btAction({ action: device.connected ? 'disconnect' : 'connect', mac: device.mac });
      }));
    });
    if (!data.devices || !data.devices.length) {
      el.btDevices.innerHTML = '<div class="seg-note">устройств пока нет — включите «Режим сопряжения» и ищите колонку с телефона</div>';
    }
  }

  function loadBt() {
    return cgi('bluetooth.py', {}, { timeout: 12000, silent: true }).then(renderBt).catch(function (err) {
      el.btStatus.textContent = 'Bluetooth: ' + err.message;
    });
  }

  // Телефон подключается со своей стороны, поэтому карточку надо опрашивать:
  // иначе состояние видно только после перезагрузки страницы.
  var btCardTimer = null;

  function startBtCardPoll() {
    if (btCardTimer) return;
    btCardTimer = setInterval(function () {
      if (State.tab !== 'network' || document.hidden || State.btScanning) return;
      loadBt();
    }, 4000);
  }

  function stopBtCardPoll() {
    if (btCardTimer) clearInterval(btCardTimer);
    btCardTimer = null;
  }

  function btScan() {
    if (State.btScanning) return Promise.resolve();
    State.btScanning = true;
    if (!beginScan(el.btnBtScan, el.btStatus, 'Сканирую Bluetooth')) {
      State.btScanning = false;
      return Promise.resolve();
    }
    showScanSkeleton(el.btDevices, 3);
    return cgi('bluetooth.py', { action: 'scan' }, { timeout: 45000 }).then(function (data) {
      renderBt(data);
      if (!data.devices || !data.devices.length) {
        el.btDevices.innerHTML = '<div class="seg-note">устройств не найдено. Включите «Режим сопряжения» и ищите колонку с телефона.</div>';
      }
      toast('Bluetooth: найдено ' + ((data.devices || []).length) + ' устройств', 'ok');
    }).catch(function (err) {
      el.btStatus.textContent = 'Bluetooth: ' + err.message;
      if (!el.btDevices.children.length) {
        el.btDevices.innerHTML = '<div class="seg-note">не удалось просканировать — попробуйте ещё раз</div>';
      }
      toast('Bluetooth: ' + err.message, 'bad');
    }).finally(function () {
      State.btScanning = false;
      endScan(el.btnBtScan, el.btStatus);
    });
  }

  function btAction(payload) {
    return withBusy(null, function () {
      return cgi('bluetooth.py', payload, { timeout: 45000 }).then(function (data) {
        renderBt(data);
        toast('Bluetooth обновлён', 'ok');
        // Соединение могло не удержаться: перепроверяем фактический статус.
        window.setTimeout(function () {
          if (State.tab === 'network') loadBt();
        }, 2500);
      }).catch(function (err) {
        toast('Bluetooth: ' + err.message, 'bad');
      });
    });
  }

  /* ─────────── сеть ─────────── */
  function renderNet(data) {
    State.net = data;
    var parts = [];
    parts.push(data.connected ? ('подключено к ' + (data.ssid || '?')) : ('не подключено (' + (data.state || '?') + ')'));
    if (data.ip) parts.push(data.ip);
    if (data.signal != null) parts.push(data.signal + ' dBm');
    el.netStatus.textContent = parts.join(' · ');

    if (el.netDetails) {
      var details = [];
      if (data.gateway) details.push('шлюз ' + data.gateway);
      if (data.mac) details.push('MAC ' + data.mac);
      if (data.dns && data.dns.length) details.push('DNS ' + data.dns.join(', '));
      el.netDetails.textContent = details.join(' · ');
      if (el.netDns && !el.netDns.value && data.dns && data.dns.length) {
        el.netDns.value = data.dns.join(', ');
      }
    }
  }

  function renderNetSaved(saved) {
    el.netList.innerHTML = '';
    saved.forEach(function (net) {
      var row = document.createElement('div');
      row.className = 'bt-item';
      var name = document.createElement('span');
      name.className = 'name';
      name.textContent = net.ssid;
      var mark = document.createElement('small');
      var current = State.net && net.ssid === State.net.ssid;
      mark.textContent = current ? 'текущая' : 'сохранена';
      row.appendChild(name);
      row.appendChild(mark);
      if (!current) {
        var connect = document.createElement('button');
        connect.className = 'btn sm ghost';
        connect.textContent = 'Подключить';
        connect.addEventListener('click', function () { netConnectSaved(net.id); });
        row.appendChild(connect);
      }
      var forget = document.createElement('button');
      forget.className = 'btn sm ghost';
      forget.textContent = 'Забыть';
      forget.addEventListener('click', function () { netForget(net.ssid); });
      row.appendChild(forget);
      el.netList.appendChild(row);
    });
  }

  function netConnectSaved(id) {
    return withBusy(null, function () {
      el.netStatus.textContent = 'подключаюсь к сохранённой сети…';
      return cgi('network.py', { action: 'connect_saved', id: id }, { timeout: 60000 })
        .then(function (data) {
          renderNet(data);
          renderNetSaved(data.saved || []);
          toast(data.connected ? ('Подключено: ' + data.ssid) : 'Не удалось, вернул прежнюю сеть',
            data.connected ? 'ok' : 'warn');
        }).catch(function (err) {
          toast('Сеть: ' + err.message, 'bad');
        });
    });
  }

  function netForget(ssid) {
    return withBusy(null, function () {
      return cgi('network.py', { action: 'forget', ssid: ssid }, { timeout: 20000 })
        .then(function (data) {
          renderNet(data);
          renderNetSaved(data.saved || []);
          toast('Сеть забыта: ' + ssid, 'ok');
        }).catch(function (err) {
          toast('Сеть: ' + err.message, 'bad');
        });
    });
  }

  function netDnsApply() {
    var servers = el.netDns.value.trim();
    if (!servers) {
      toast('Введите DNS через запятую', 'warn');
      return;
    }
    return withBusy(el.btnNetDns, function () {
      return cgi('network.py', { action: 'dns', servers: servers }, { timeout: 45000 })
        .then(function (data) {
          renderNet(data);
          toast('DNS: ' + (data.dns || []).join(', '), 'ok');
        }).catch(function (err) {
          toast('DNS: ' + err.message, 'bad');
        });
    });
  }

  function netDnsReset() {
    return withBusy(el.btnNetDnsReset, function () {
      return cgi('network.py', { action: 'dns_reset' }, { timeout: 45000 })
        .then(function (data) {
          renderNet(data);
          toast('DNS возвращён к штатному', 'ok');
        }).catch(function (err) {
          toast('DNS: ' + err.message, 'bad');
        });
    });
  }

  function loadNet() {
    return cgi('network.py', {}, { timeout: 15000, silent: true }).then(function (data) {
      renderNet(data);
      renderNetSaved(data.saved || []);
    }).catch(function (err) {
      el.netStatus.textContent = 'Сеть: ' + err.message;
    });
  }

  function netScan() {
    if (State.netScanning) return Promise.resolve();
    State.netScanning = true;
    if (!beginScan(el.btnNetScan, el.netStatus, 'Сканирую Wi-Fi')) {
      State.netScanning = false;
      return Promise.resolve();
    }
    showScanSkeleton(el.netList, 4);
    return cgi('network.py', { action: 'scan' }, { timeout: 30000 }).then(function (data) {
      renderNet(data.state || {});
      el.netList.innerHTML = '';
      (data.networks || []).forEach(function (net) {
        var row = document.createElement('div');
        row.className = 'bt-item';
        var name = document.createElement('span');
        name.className = 'name';
        name.textContent = (net.secure ? '🔒 ' : '') + net.ssid;
        var sig = document.createElement('small');
        sig.textContent = net.signal + ' dBm';
        var btn = document.createElement('button');
        btn.className = 'btn sm ghost';
        btn.textContent = 'Подключить';
        btn.addEventListener('click', function () { netConnect(net); });
        row.appendChild(name);
        row.appendChild(sig);
        row.appendChild(btn);
        el.netList.appendChild(row);
      });
      if (!data.networks || !data.networks.length) {
        el.netList.innerHTML = '<div class="seg-note">сети не найдены — попробуйте ещё раз</div>';
      }
      toast('Wi-Fi: найдено ' + ((data.networks || []).length) + ' сетей', 'ok');
    }).catch(function (err) {
      el.netStatus.textContent = 'Сеть: ' + err.message;
      if (!el.netList.children.length) {
        el.netList.innerHTML = '<div class="seg-note">не удалось просканировать — попробуйте ещё раз</div>';
      }
      toast('Сеть: ' + err.message, 'bad');
    }).finally(function () {
      State.netScanning = false;
      endScan(el.btnNetScan, el.netStatus);
    });
  }

  function netConnect(net) {
    var psk = el.netPsk.value;
    if (net.secure && !psk) {
      toast('Введите пароль Wi-Fi в поле выше', 'warn');
      el.netPsk.focus();
      return;
    }
    return withBusy(null, function () {
      el.netStatus.textContent = 'подключаюсь к ' + net.ssid + '…';
      return cgi('network.py', { action: 'connect', ssid: net.ssid, psk: psk }, { timeout: 70000 })
        .then(function (data) {
          renderNet(data);
          el.netPsk.value = '';
          toast(data.connected ? ('Подключено: ' + data.ssid) : 'Не удалось, вернул прежнюю сеть',
            data.connected ? 'ok' : 'warn');
        }).catch(function (err) {
          toast('Сеть: ' + err.message, 'bad');
          loadNet();
        });
    });
  }

  /* ─────────── zigbee ─────────── */
  function loadZb() {
    return cgi('zigbee.py', {}, { timeout: 12000, silent: true }).then(function (data) {
      State.zb = data;
      var shorts = (data.devices || []).map(function (item) { return item.short; });
      el.zbStatus.textContent = 'радио ' + (data.radio ? 'активно' : 'выключено') +
        ' · сеть ' + (data.network ? 'сформирована' : 'не сформирована') +
        ' · записей устройств: ' + (data.count || 0) +
        (shorts.length ? ' · ' + shorts.join(', ') : '');
    }).catch(function (err) {
      el.zbStatus.textContent = 'Zigbee: ' + err.message;
    });
  }

  function sendZb() {
    var text = el.zbCommand.value.trim();
    if (!text) {
      toast('Введите команду, например «включи лампу»', 'warn');
      return;
    }
    return withBusy(el.btnZbSend, function () {
      return cgi('zigbee.py', { text: text }, { timeout: 30000 }).then(function () {
        el.zbCommand.value = '';
        toast('Передано Алисе', 'ok');
        refreshPlayer(true);
      }).catch(function (err) {
        toast('Zigbee: ' + err.message, 'bad');
      });
    });
  }

  /* ─────────── сценарии ─────────── */
  var SC_TYPES = [
    { id: 'speak', label: 'Сказать', hint: 'текст', key: 'text' },
    { id: 'led', label: 'Кольцо: цвет', hint: '#00E676', key: 'color' },
    { id: 'led_off', label: 'Кольцо: погасить', hint: '' },
    { id: 'radio', label: 'Радио', hint: 'Европа Плюс', key: 'name' },
    { id: 'play_sound', label: 'Свой звук', hint: '', key: 'name' },
    { id: 'play_url', label: 'Проиграть ссылку', hint: 'https://… (mp3, m4a, wav)', key: 'url' },
    { id: 'volume', label: 'Громкость', hint: '0–100', key: 'value' },
    { id: 'clock_text', label: 'Текст на дисплей', hint: 'Доброе утро', key: 'text' },
    { id: 'clock_anim', label: 'Анимация дисплея', hint: '', key: 'anim_id' },
    { id: 'clock_anim_stop', label: 'Анимация: стоп', hint: '' },
    { id: 'vpn', label: 'VPN', hint: 'on / off', key: 'on' },
    { id: 'llm', label: 'Нейросеть', hint: 'on / off', key: 'on' },
    { id: 'pause', label: 'Пауза плеера', hint: '' },
    { id: 'sleep', label: 'Пауза, секунд', hint: '1', key: 'seconds' },
    { id: 'http', label: 'HTTP-запрос', hint: 'https://…', key: 'url' }
  ];

  function scTypeById(id) {
    for (var i = 0; i < SC_TYPES.length; i++) if (SC_TYPES[i].id === id) return SC_TYPES[i];
    return SC_TYPES[0];
  }

  function fillScTypes() {
    SC_TYPES.forEach(function (type) {
      if (!scTypeAvailable(type)) return;
      var option = document.createElement('option');
      option.value = type.id;
      option.textContent = type.label;
      el.scType.appendChild(option);
    });
  }

  function populateSoundPicker(picker, selected) {
    while (picker.options.length) picker.remove(0);
    (State.customSounds || []).forEach(function (item) {
      var option = document.createElement('option');
      option.value = item.id;
      option.textContent = item.name;
      picker.appendChild(option);
    });
    if (!(State.customSounds || []).length) {
      var none = document.createElement('option');
      none.value = '';
      none.textContent = 'Сначала добавьте звук';
      picker.appendChild(none);
    }
    if (selected && !Array.prototype.some.call(picker.options,
        function (option) { return option.value === selected; })) {
      var missing = document.createElement('option');
      missing.value = selected;
      missing.textContent = 'Не найден: ' + selected;
      picker.appendChild(missing);
    }
    if (selected) picker.value = selected;
  }

  function refreshSoundPickers() {
    Array.prototype.forEach.call(document.querySelectorAll('#scActions select[data-value]'),
      function (picker) {
        populateSoundPicker(picker, picker.value);
      });
  }

  function clockAnimById(id) {
    var items = clockPresetItems().concat(State.clockAnims || []);
    for (var i = 0; i < items.length; i++) {
      if (items[i].id === id) return items[i];
    }
    return null;
  }

  function populateClockAnimPicker(picker, selected) {
    while (picker.options.length) picker.remove(0);
    var hidden = State.hiddenPresets || [];
    var items = clockPresetItems().filter(function (item) {
      return hidden.indexOf(item.id) < 0;
    }).concat(State.clockAnims || []);
    items.forEach(function (item) {
      var option = document.createElement('option');
      option.value = item.id;
      option.textContent = item.name + (item.preset ? ' · пресет' : '');
      picker.appendChild(option);
    });
    if (!items.length) {
      var none = document.createElement('option');
      none.value = '';
      none.textContent = 'Сначала создайте анимацию';
      picker.appendChild(none);
    }
    if (selected && !Array.prototype.some.call(picker.options,
        function (option) { return option.value === selected; })) {
      var missing = document.createElement('option');
      missing.value = selected;
      missing.textContent = 'Не найдена: ' + selected;
      picker.appendChild(missing);
    }
    if (selected) picker.value = selected;
  }

  function addScRow(typeId, value, action) {
    var type = scTypeById(typeId || el.scType.value);
    var row = document.createElement('div');
    row.className = 'bt-item';
    row.dataset.type = type.id;

    var select = document.createElement('select');
    select.className = 'net-input';
    select.style.maxWidth = '190px';
    SC_TYPES.forEach(function (item) {
      if (!scTypeAvailable(item)) return;
      var option = document.createElement('option');
      option.value = item.id;
      option.textContent = item.label;
      if (item.id === type.id) option.selected = true;
      select.appendChild(option);
    });

    var input = document.createElement('input');
    input.className = 'net-input';
    input.placeholder = type.hint || '';
    input.value = value == null ? '' : value;
    if (type.id === 'clock_text') {
      input.maxLength = 32;
      input.placeholder = 'До 32 символов';
      input.addEventListener('input', function () {
        if (this.value.length > 32) this.value = this.value.slice(0, 32);
      });
    }

    var picker = document.createElement('select');
    picker.className = 'net-input';
    picker.dataset.value = '1';
    picker.hidden = type.id !== 'play_sound';
    populateSoundPicker(picker, type.id === 'play_sound' ? String(value || '') : '');

    var animPicker = document.createElement('select');
    animPicker.className = 'net-input';
    animPicker.dataset.anim = '1';
    animPicker.hidden = type.id !== 'clock_anim';
    populateClockAnimPicker(animPicker,
      type.id === 'clock_anim' ? String(value || '') : '');
    row._clockAnim = action || null;

    var remove = document.createElement('button');
    remove.className = 'btn sm ghost';
    remove.textContent = '×';
    remove.title = 'Убрать действие';
    remove.addEventListener('click', function () { row.remove(); });

    select.addEventListener('change', function () {
      var next = scTypeById(select.value);
      row.dataset.type = next.id;
      input.placeholder = next.hint || '';
      input.value = '';
      input.hidden = next.id === 'play_sound' || next.id === 'clock_anim' || !next.hint;
      picker.hidden = next.id !== 'play_sound';
      animPicker.hidden = next.id !== 'clock_anim';
      row._clockAnim = null;
      if (next.id === 'play_sound') populateSoundPicker(picker, '');
      if (next.id === 'clock_anim') populateClockAnimPicker(animPicker, '');
      setTimeout(refreshDropdowns, 0);
    });
    input.hidden = type.id === 'play_sound' || type.id === 'clock_anim' || !type.hint;

    row.appendChild(select);
    row.appendChild(input);
    row.appendChild(picker);
    row.appendChild(animPicker);
    row.appendChild(remove);
    el.scActions.appendChild(row);
    enhanceSelect(select);
    enhanceSelect(picker);
    enhanceSelect(animPicker);
    setTimeout(refreshDropdowns, 0);
  }

  function collectScActions() {
    var actions = [];
    Array.prototype.forEach.call(el.scActions.children, function (row) {
      var type = scTypeById(row.dataset.type);
      var input = row.querySelector('input');
      var picker = row.querySelector('select[data-value]');
      var value = type.id === 'play_sound'
        ? (picker ? picker.value : '')
        : (input ? input.value.trim() : '');
      var action = { type: type.id };
      if (type.id === 'clock_anim') {
        var animPicker = row.querySelector('select[data-anim]');
        var chosen = clockAnimById(animPicker ? animPicker.value : '') || row._clockAnim;
        if (!chosen || !chosen.frames || !chosen.frames.length) return;
        action.anim_id = (animPicker && animPicker.value) || chosen.id || '';
        action.name = chosen.name || 'Анимация';
        action.frames = chosen.frames;
        action.duration = chosen.duration || 300;
        actions.push(action);
        return;
      }
      if (type.key === 'text') action.text = value;
      else if (type.key === 'color') action.color = value || '#00E676';
      else if (type.key === 'name') action.name = value;
      else if (type.key === 'value') action.value = parseInt(value, 10) || 30;
      else if (type.key === 'seconds') action.seconds = parseFloat(value) || 1;
      else if (type.key === 'on') action.on = /^(on|вкл|1|true|да)$/i.test(value);
      else if (type.key === 'url') action.url = value;
      actions.push(action);
    });
    return actions;
  }

  function renderScBuiltin(items) {
    el.scBuiltin.innerHTML = '';
    (items || []).forEach(function (item) {
      var row = document.createElement('div');
      row.className = 'bt-item';
      var name = document.createElement('span');
      name.className = 'name';
      name.textContent = item.phrase;
      var what = document.createElement('small');
      what.textContent = item.what;
      row.appendChild(name);
      row.appendChild(what);
      el.scBuiltin.appendChild(row);
    });
  }

  function renderScList(items) {
    el.scList.innerHTML = '';
    if (!items || !items.length) {
      el.scList.innerHTML = '<div class="seg-note">своих сценариев пока нет</div>';
      return;
    }
    items.forEach(function (item) {
      var row = document.createElement('div');
      row.className = 'bt-item';
      var name = document.createElement('span');
      name.className = 'name';
      name.textContent = item.name;
      var phrases = document.createElement('small');
      var schedule = item.schedule || {};
      var when = schedule.time ? ' ⏰ ' + schedule.time : '';
      phrases.textContent = (item.phrases || []).join(', ') + when;
      var run = document.createElement('button');
      run.className = 'btn sm ghost';
      run.textContent = 'Запустить';
      run.addEventListener('click', function () { runScenario(item.name); });
      var edit = document.createElement('button');
      edit.className = 'btn sm ghost';
      edit.textContent = 'Изменить';
      edit.addEventListener('click', function () { loadScenarioToEditor(item); });
      var del = document.createElement('button');
      del.className = 'btn sm ghost';
      del.textContent = 'Удалить';
      del.addEventListener('click', function () { deleteScenario(item.name); });
      row.appendChild(name);
      row.appendChild(phrases);
      row.appendChild(run);
      row.appendChild(edit);
      row.appendChild(del);
      el.scList.appendChild(row);
    });
  }

  function loadScenarios() {
    return cgi('scenarios.py', {}, { timeout: 10000, silent: true }).then(function (data) {
      State.scenarios = data.scenarios || [];
      renderScBuiltin(data.builtin || []);
      renderScList(State.scenarios);
    }).catch(function (err) {
      var note = document.createElement('div');
      note.className = 'seg-note';
      note.textContent = 'сценарии: ' + err.message;
      el.scList.innerHTML = '';
      el.scList.appendChild(note);
    });
  }

  function loadScenarioToEditor(item) {
    el.scName.value = item.name || '';
    el.scPhrases.value = (item.phrases || []).join(', ');
    var schedule = item.schedule || {};
    el.scTime.value = schedule.time || '';
    el.scDays.value = (schedule.days || []).join(',');
    var conditions = item.conditions || {};
    el.scCondVpn.value = conditions.vpn || '';
    el.scCondMusic.value = conditions.music || '';
    el.scActions.innerHTML = '';
    (item.actions || []).forEach(function (action) {
      var type = scTypeById(action.type);
      var value = action[type.key || 'text'] != null ? action[type.key] : '';
      if (type.key === 'on') value = action.on ? 'on' : 'off';
      addScRow(action.type, value, action);
    });
  }

  function saveScenario() {
    var name = el.scName.value.trim();
    var phrases = el.scPhrases.value.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    var actions = collectScActions();
    if (name.length < 2) { toast('Название: минимум 2 символа', 'warn'); return; }
    if (!phrases.length) { toast('Добавьте хотя бы одну фразу', 'warn'); return; }
    if (!actions.length) { toast('Добавьте хотя бы одно действие', 'warn'); return; }
    return withBusy(el.btnScSave, function () {
      var schedule = el.scTime.value ? { time: el.scTime.value, days: el.scDays.value } : {};
      var conditions = { vpn: el.scCondVpn.value, music: el.scCondMusic.value };
      return cgi('scenarios.py', { name: name, phrases: phrases, actions: actions,
        schedule: schedule, conditions: conditions }, { timeout: 20000 })
        .then(function (data) {
          State.scenarios = data.scenarios || [];
          renderScList(State.scenarios);
          toast('Сценарий сохранён: ' + name, 'ok');
        }).catch(function (err) {
          toast('Сценарий: ' + err.message, 'bad');
        });
    });
  }

  function runScenario(name) {
    return cgi('scenarios.py', { run: name }, { timeout: 90000 }).then(function (data) {
      var result = data.result || {};
      toast(result.ok ? ('Выполнено: ' + name) : ('Ошибки: ' + (result.errors || []).join('; ')),
        result.ok ? 'ok' : 'bad');
      refreshPlayer(true);
    }).catch(function (err) {
      toast('Сценарий: ' + err.message, 'bad');
    });
  }

  function deleteScenario(name) {
    return cgi('scenarios.py', { delete: name }, { timeout: 15000 }).then(function (data) {
      State.scenarios = data.scenarios || [];
      renderScList(State.scenarios);
      toast('Удалён: ' + name, 'ok');
    }).catch(function (err) {
      toast('Сценарий: ' + err.message, 'bad');
    });
  }

  function clearScenarioEditor() {
    el.scName.value = '';
    el.scPhrases.value = '';
    el.scActions.innerHTML = '';
  }

  /* ─────────── графики ─────────── */
  function drawChart(canvas, values, color, fixedMax) {
    if (!canvas) return;
    var dpr = window.devicePixelRatio || 1;
    var width = canvas.clientWidth || 240;
    var height = canvas.clientHeight || 110;
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    if (!values.length) return;
    var max = fixedMax || Math.max.apply(null, values.concat([1]));
    var min = fixedMax ? 0 : Math.min.apply(null, values);
    var span = Math.max(0.01, max - min);
    var pad = 4;
    function px(i) {
      return pad + (width - pad * 2) * i / Math.max(1, values.length - 1);
    }
    function py(value) {
      return height - pad - ((value - min) / span) * (height - pad * 2);
    }
    ctx.strokeStyle = 'rgba(255,255,255,.08)';
    ctx.lineWidth = 1;
    for (var grid = 0; grid <= 2; grid++) {
      var y = pad + (height - pad * 2) * grid / 2;
      ctx.beginPath();
      ctx.moveTo(pad, y);
      ctx.lineTo(width - pad, y);
      ctx.stroke();
    }
    ctx.beginPath();
    values.forEach(function (value, index) {
      if (index === 0) ctx.moveTo(px(index), py(value));
      else ctx.lineTo(px(index), py(value));
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.lineTo(px(values.length - 1), height - pad);
    ctx.lineTo(px(0), height - pad);
    ctx.closePath();
    ctx.fillStyle = color.replace('rgb', 'rgba').replace(')', ',.12)');
    if (color.charAt(0) === '#') {
      ctx.fillStyle = color + '22';
    }
    ctx.fill();
  }

  function loadCharts() {
    var cpuCanvas = document.getElementById('sparkCpu');
    if (!cpuCanvas) return;
    return cgi('history.py', {}, { timeout: 12000, silent: true }).then(function (data) {
      var points = data.points || [];
      if (points.length < 2) return;
      function series(key) {
        return points.map(function (p) { return Number(p[key]); })
          .map(function (v) { return isNaN(v) ? 0 : v; });
      }
      var cpu = series('cpu'), mem = series('mem'), disk = series('disk');
      var temp = points.map(function (p) {
        var value = p.temp;
        if (value && typeof value === 'object') value = value.c;
        var v = Number(value);
        return isNaN(v) ? null : v;
      }).filter(function (v) { return v !== null; });
      drawChart(cpuCanvas, cpu, '#7c5cff', 100);
      drawChart(document.getElementById('sparkMem'), mem, '#22d3ee', 100);
      drawChart(document.getElementById('sparkDisk'), disk, '#f59e0b', 100);
      drawChart(document.getElementById('sparkTemp'), temp, '#f472b6', 0);
    }).catch(function () {});
  }

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
    zvukSetStatus('Запускаю «Мой поток»…');
    cgi('zvuk.py', { action: 'wave', count: 15 }, { timeout: 30000 })
      .then(function (data) { zvukRender(data.tracks || []); zvukSetStatus('Мой поток готов'); })
      .catch(function (err) { zvukSetStatus('Ошибка: ' + err.message, 'bad'); });
  }

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

  /* ─────────── файлы ─────────── */
  var filesCurrent = '/data/mypult';
  var filesEditing = '';

  function filesSize(bytes) {
    var n = Number(bytes) || 0;
    if (n < 1024) return n + ' Б';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' КБ';
    return (n / (1024 * 1024)).toFixed(1) + ' МБ';
  }

  function filesDate(ts) {
    try { return new Date(ts * 1000).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }
    catch (e) { return ''; }
  }

  function filesRaw(path, download) {
    return '/cgi-bin/files.py?action=raw&path=' + encodeURIComponent(path) +
      (download ? '&download=1' : '');
  }

  function filesSetNote(text) {
    if (el.filesNote) el.filesNote.textContent = text || '';
  }

  function filesLoad(path) {
    var target = path || filesCurrent || '/data/mypult';
    filesSetNote('Читаю…');
    return cgi('files.py', { action: 'list', path: target }, { timeout: 15000, silent: true })
      .then(function (data) {
        filesCurrent = data.path || target;
        if (el.filesPath) el.filesPath.value = filesCurrent;
        filesSetNote(data.can_write ?
          'Запись разрешена: /data/mypult и /tmp' :
          'Только чтение. Запись разрешена в /data/mypult и /tmp.');
        if (el.filesRoots) {
          el.filesRoots.textContent = '';
          (data.roots || []).forEach(function (root) {
            var b = document.createElement('button');
            b.type = 'button';
            b.textContent = root.label || root.path;
            b.title = root.path;
            b.addEventListener('click', function () { filesLoad(root.path); });
            el.filesRoots.appendChild(b);
          });
        }
        if (!el.filesList) return;
        el.filesList.textContent = '';
        if (!data.items || !data.items.length) {
          var empty = document.createElement('div');
          empty.className = 'files-empty';
          empty.textContent = 'Пусто';
          el.filesList.appendChild(empty);
          return;
        }
        data.items.forEach(function (item) {
          var row = document.createElement('div');
          row.className = 'files-row';
          var ico = document.createElement('span');
          ico.className = 'files-ico';
          ico.textContent = item.kind === 'dir' ? '▸' : '·';
          var name = document.createElement('div');
          name.className = 'files-name';
          name.textContent = item.name;
          var meta = document.createElement('span');
          meta.className = 'files-meta';
          meta.style.display = 'block';
          meta.style.color = 'var(--muted)';
          meta.style.fontSize = '10px';
          meta.textContent = item.kind === 'dir' ? 'папка' : filesSize(item.size) + ' · ' + filesDate(item.mtime);
          name.appendChild(meta);
          if (item.link) {
            var link = document.createElement('small');
            link.textContent = 'симлинк';
            name.appendChild(link);
          }
          name.addEventListener('click', function () {
            if (item.kind === 'dir') filesLoad(item.path);
            else filesOpenFile(item);
          });
          row.appendChild(ico);
          row.appendChild(name);
          if (item.locked) {
            var lock = document.createElement('span');
            lock.className = 'files-lock';
            lock.textContent = '🔒';
            lock.title = 'Секретный файл';
            row.appendChild(lock);
          }
          var actions = document.createElement('div');
          actions.className = 'files-act';
          if (item.kind === 'file' && !item.locked) {
            var dl = document.createElement('button');
            dl.type = 'button';
            dl.textContent = '↓';
            dl.title = 'Скачать';
            dl.addEventListener('click', function (event) {
              event.stopPropagation();
              window.open(filesRaw(item.path, true), '_blank');
            });
            actions.appendChild(dl);
            var edit = document.createElement('button');
            edit.type = 'button';
            edit.textContent = '✎';
            edit.title = 'Открыть / изменить';
            edit.addEventListener('click', function (event) {
              event.stopPropagation();
              filesOpenFile(item);
            });
            actions.appendChild(edit);
          }
          if (item.writable && !item.locked) {
            var del = document.createElement('button');
            del.type = 'button';
            del.textContent = '×';
            del.title = 'Удалить';
            del.addEventListener('click', function (event) {
              event.stopPropagation();
              if (!window.confirm('Удалить «' + item.name + '»?')) return;
              cgi('files.py', { action: 'delete', path: item.path }, { timeout: 15000 })
                .then(function () { toast('Удалено', 'ok'); filesLoad(filesCurrent); })
                .catch(function (err) { toast('Файлы: ' + err.message, 'bad'); });
            });
            actions.appendChild(del);
          }
          row.appendChild(actions);
          el.filesList.appendChild(row);
        });
      })
      .catch(function (err) {
        filesSetNote('Ошибка: ' + err.message);
        if (el.filesList) {
          el.filesList.textContent = '';
          var box = document.createElement('div');
          box.className = 'files-empty';
          box.textContent = err.message;
          el.filesList.appendChild(box);
        }
        throw err;
      });
  }

  function filesOpenFile(item) {
    cgi('files.py', { action: 'read', path: item.path }, { timeout: 15000, silent: true })
      .then(function (data) {
        if (data.binary) {
          window.open(filesRaw(item.path, false), '_blank');
          return;
        }
        filesEditing = item.path;
        if (el.filesEditorName) el.filesEditorName.textContent = item.name;
        if (el.filesText) el.filesText.value = data.text || '';
        if (el.filesEditor) el.filesEditor.hidden = false;
        if (el.filesText) el.filesText.focus();
      })
      .catch(function (err) { toast('Файлы: ' + err.message, 'bad'); });
  }

  function filesOpen() {
    if (!el.filesDlg) return;
    if (typeof el.filesDlg.showModal === 'function') el.filesDlg.showModal();
    else el.filesDlg.setAttribute('open', '');
    if (el.filesEditor) el.filesEditor.hidden = true;
    filesLoad(filesCurrent);
  }

  function filesCloseEditor() {
    filesEditing = '';
    if (el.filesEditor) el.filesEditor.hidden = true;
  }

  function filesSave() {
    if (!filesEditing) return;
    cgi('files.py', { action: 'write', path: filesEditing, text: el.filesText.value },
      { timeout: 15000 })
      .then(function () { toast('Файл сохранён', 'ok'); filesCloseEditor(); filesLoad(filesCurrent); })
      .catch(function (err) { toast('Файлы: ' + err.message, 'bad'); });
  }

  function filesUploadFile(file) {
    if (!file) return;
    var url = '/cgi-bin/files.py?action=upload&path=' + encodeURIComponent(filesCurrent) +
      '&name=' + encodeURIComponent(file.name);
    filesSetNote('Загружаю ' + file.name + '…');
    fetch(url, {
      method: 'POST',
      headers: { 'X-Requested-With': 'MidiPult' },
      body: file
    }).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
        return data;
      });
    }).then(function () {
      toast('Файл загружен', 'ok');
      filesLoad(filesCurrent);
    }).catch(function (err) {
      filesSetNote('Ошибка: ' + err.message);
      toast('Файлы: ' + err.message, 'bad');
    });
  }

  function filesMkdir() {
    var name = window.prompt('Имя новой папки');
    if (!name) return;
    cgi('files.py', { action: 'mkdir', path: filesCurrent, name: name }, { timeout: 15000 })
      .then(function () { filesLoad(filesCurrent); })
      .catch(function (err) { toast('Файлы: ' + err.message, 'bad'); });
  }

  function filesRename() {
    if (!filesEditing) return;
    var name = window.prompt('Новое имя', filesEditing.split('/').pop());
    if (!name) return;
    cgi('files.py', { action: 'rename', path: filesEditing, name: name }, { timeout: 15000 })
      .then(function () { filesCloseEditor(); filesLoad(filesCurrent); })
      .catch(function (err) { toast('Файлы: ' + err.message, 'bad'); });
  }

  /* ─────────── логи ─────────── */
  function loadLogs() {
    return cgi('logs.py', { name: el.logName.value, lines: 200 }, { timeout: 10000, silent: true })
      .then(function (data) {
        el.logsBox.textContent = stripAnsi(data.text || '(пусто)');
        el.logsBox.scrollTop = el.logsBox.scrollHeight;
      }).catch(function (err) {
        el.logsBox.textContent = 'Логи: ' + err.message;
      });
  }

  /* ─────────── обслуживание ─────────── */
  function runNetcheck() {
    el.maintBox.textContent = 'проверяю…';
    return cgi('netcheck.py', {}, { timeout: 40000 }).then(function (data) {
      var lines = [];
      var gw = data.gateway || {};
      lines.push('шлюз ' + (gw.host || '—') + ': ' + (gw.ok ? (gw.rtt ? gw.rtt + ' мс' : 'ok') : 'нет'));
      var net = data.internet || {};
      lines.push('интернет ' + (net.host || '—') + ': ' + (net.ok ? (net.rtt ? net.rtt + ' мс' : 'ok') : 'нет'));
      var dns = data.dns || {};
      lines.push('DNS: ' + (dns.ok ? dns.ms + ' мс' : 'ошибка'));
      var http = data.http || {};
      lines.push('HTTP ' + (http.url || '') + ': ' + (http.code || '—') +
        (http.time ? ' за ' + Math.round(http.time * 1000) + ' мс' : ''));
      el.maintBox.textContent = lines.join('\n');
    }).catch(function (err) {
      el.maintBox.textContent = 'Сеть: ' + err.message;
    });
  }

  function runSpeed() {
    el.maintBox.textContent = 'замеряю скорость…';
    return cgi('netcheck.py', { speed: 1 }, { timeout: 45000 }).then(function (data) {
      var speed = data.speed || {};
      el.maintBox.textContent = speed.mbps != null
        ? ('Скорость: ' + speed.mbps + ' Мбит/с (HTTP ' + (speed.code || '—') + ')')
        : 'Скорость: не удалось измерить';
    }).catch(function (err) {
      el.maintBox.textContent = 'Скорость: ' + err.message;
    });
  }

  function runCleanup() {
    el.maintBox.textContent = 'чищу…';
    return cgi('maintenance.py', { cleanup: 1 }, { timeout: 20000 }).then(function (data) {
      el.maintBox.textContent = 'Освобождено: ' + Math.round((data.freed || 0) / 1024) + ' КБ';
      toast('Логи и кэш очищены', 'ok');
    }).catch(function (err) {
      el.maintBox.textContent = 'Очистка: ' + err.message;
    });
  }

  function askConfirm(message, options) {
    var opts = options || {};
    return new Promise(function (resolve) {
      var dlg = el.confirmDlg;
      if (!dlg || typeof dlg.showModal !== 'function') { resolve(window.confirm(message)); return; }
      var done = false;
      function finish(value) {
        if (done) return;
        done = true;
        try { dlg.close(); } catch (e) {}
        resolve(value);
      }
      el.confirmText.textContent = message;
      el.btnConfirmYes.textContent = opts.yes || 'Подтвердить';
      el.btnConfirmYes.className = 'btn sm ' + (opts.danger === false ? '' : 'danger');
      el.btnConfirmYes.onclick = function () { finish(true); };
      el.btnConfirmNo.onclick = function () { finish(false); };
      dlg.oncancel = function (ev) { ev.preventDefault(); finish(false); };
      dlg.onclose = function () { if (!done) finish(false); };
      if (dlg.open) { try { dlg.close(); } catch (e) {} }
      try { dlg.showModal(); } catch (e) { resolve(false); return; }
      setTimeout(function () { el.btnConfirmNo.focus(); }, 0);
    });
  }

  function doPoweroff() {
    askConfirm('Выключить колонку? Включить можно только кнопкой питания.', { yes: 'Выключить' }).then(function (ok) {
      if (!ok) return;
      return cgi('maintenance.py', { poweroff: 'yes' }, { timeout: 8000 }).then(function () {
        toast('Выключение…', 'warn');
      }).catch(function (err) {
        toast('Выключение: ' + err.message, 'bad');
      });
    });
  }

  function doReboot() {
    askConfirm('Перезагрузить колонку? Панель пропадёт примерно на 1–3 минуты.', { yes: 'Перезагрузить' }).then(function (ok) {
      if (!ok) return;
      startRebootWatch();
      return cgi('maintenance.py', { reboot: 'yes' }, { timeout: 8000 }).then(function () {
        toast('Команда перезагрузки отправлена', 'warn');
      }).catch(function (err) {
        if (/PIN|auth|401/i.test(err.message || '')) {
          stopRebootWatch();
          toast('Ребут: ' + err.message, 'bad');
        } else {
          toast('Команда отправлена, ждём колонку…', 'warn');
        }
      });
    });
  }

  var REBOOT_KEY = 'mypult.reboot-start';
  var REBOOT_DOWN_KEY = 'mypult.reboot-down';
  var REBOOT_BOOT_KEY = 'mypult.reboot-boot';
  var REBOOT_UPTIME_KEY = 'mypult.reboot-uptime';

  function fetchBootInfo() {
    return fetch('/cgi-bin/maintenance.py?boot=1&ts=' + Date.now(), {
      cache: 'no-store',
      credentials: 'same-origin'
    }).then(function (res) {
      if (!res.ok) throw new Error('boot ' + res.status);
      return res.json();
    });
  }

  function bootChanged() {
    return fetchBootInfo().then(function (info) {
      if (State.rebootBootId && info.boot_id && info.boot_id !== State.rebootBootId) return true;
      if (State.rebootBaseUptime != null && info.uptime != null &&
          info.uptime < State.rebootBaseUptime - 30) return true;
      return false;
    });
  }

  function rebootNotSeen(elapsed) {
    if (elapsed < 180) {
      el.rebootStatus.textContent = 'Ждём отключение…';
      State.rebootPoll = setTimeout(rebootPoll, 2000);
      return;
    }
    stopRebootWatch();
    el.rebootStatus.textContent = 'Перезагрузка не подтверждена';
    toast('Колонка не отключалась. Проверьте вручную.', 'warn');
  }

  function fmtRebootTime(seconds) {
    var m = Math.floor(seconds / 60);
    var s = seconds % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  function stopRebootWatch() {
    State.rebootActive = false;
    if (State.rebootTimer) clearInterval(State.rebootTimer);
    if (State.rebootPoll) clearTimeout(State.rebootPoll);
    State.rebootTimer = null;
    State.rebootPoll = null;
    try {
      localStorage.removeItem(REBOOT_KEY);
      localStorage.removeItem(REBOOT_DOWN_KEY);
      localStorage.removeItem(REBOOT_BOOT_KEY);
      localStorage.removeItem(REBOOT_UPTIME_KEY);
    } catch (e) {}
  }

  function paintReboot(elapsed, done) {
    el.rebootTime.textContent = fmtRebootTime(elapsed);
    el.rebootBar.style.width = done ? '100%' : Math.min(90, 6 + elapsed * 0.8) + '%';
  }

  function finishReboot() {
    if (!State.rebootActive) return;
    var elapsed = Math.max(0, Math.floor((Date.now() - State.rebootStart) / 1000));
    stopRebootWatch();
    el.rebootStatus.textContent = 'Колонка перезагружена';
    paintReboot(elapsed, true);
    toast('Колонка перезагружена', 'ok');
    setTimeout(function () {
      if (el.rebootDlg && el.rebootDlg.open) el.rebootDlg.close();
    }, 2500);
  }

  function rebootPoll() {
    if (!State.rebootActive) return;
    var elapsed = Math.max(0, Math.floor((Date.now() - State.rebootStart) / 1000));
    paintReboot(elapsed, false);
    if (elapsed > 240) {
      stopRebootWatch();
      el.rebootStatus.textContent = 'Связь не восстановилась';
      toast('Колонка не ответила. Проверьте вручную.', 'warn');
      return;
    }
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, 4000) : null;
    fetch('/version.json?ts=' + Date.now(), {
      cache: 'no-store',
      signal: controller ? controller.signal : undefined
    }).then(function (res) {
      if (!res.ok) throw new Error('нет ответа');
      return res.json();
    }).then(function () {
      if (timer) clearTimeout(timer);
      if (!State.rebootActive) return;
      if (State.rebootSawDown) { finishReboot(); return; }
      return bootChanged().then(function (changed) {
        if (!State.rebootActive) return;
        if (changed) { finishReboot(); return; }
        rebootNotSeen(elapsed);
      }).catch(function () {
        rebootNotSeen(elapsed);
      });
    }).catch(function () {
      if (timer) clearTimeout(timer);
      if (!State.rebootActive) return;
      State.rebootSawDown = true;
      try { localStorage.setItem(REBOOT_DOWN_KEY, '1'); } catch (e) {}
      el.rebootStatus.textContent = 'Ждём подключение…';
      State.rebootPoll = setTimeout(rebootPoll, 2000);
    });
  }

  function startRebootWatch(startedAt, sawDown) {
    var started = Number(startedAt) || Date.now();
    if (State.rebootTimer) clearInterval(State.rebootTimer);
    if (State.rebootPoll) clearTimeout(State.rebootPoll);
    State.rebootStart = started;
    State.rebootActive = true;
    State.rebootSawDown = !!sawDown;
    State.rebootBootId = null;
    State.rebootBaseUptime = null;
    try {
      State.rebootBootId = localStorage.getItem(REBOOT_BOOT_KEY) || null;
      var savedUptime = Number(localStorage.getItem(REBOOT_UPTIME_KEY));
      State.rebootBaseUptime = isFinite(savedUptime) && savedUptime > 0 ? savedUptime : null;
    } catch (e) {}
    try { localStorage.setItem(REBOOT_KEY, String(started)); } catch (e) {}
    if (State.rebootBootId) {
      fetchBootInfo().then(function (info) {
        if (State.rebootActive && info.boot_id && info.boot_id !== State.rebootBootId) finishReboot();
      }).catch(function () {});
    } else {
      fetchBootInfo().then(function (info) {
        if (!State.rebootActive || State.rebootBootId) return;
        State.rebootBootId = info.boot_id || null;
        State.rebootBaseUptime = info.uptime;
        try {
          if (info.boot_id) localStorage.setItem(REBOOT_BOOT_KEY, info.boot_id);
          if (info.uptime != null) localStorage.setItem(REBOOT_UPTIME_KEY, String(info.uptime));
        } catch (e) {}
      }).catch(function () {});
    }
    if (el.rebootDlg) {
      if (typeof el.rebootDlg.showModal === 'function') {
        if (!el.rebootDlg.open) el.rebootDlg.showModal();
      } else {
        el.rebootDlg.setAttribute('open', '');
      }
    }
    el.rebootStatus.textContent = 'Перезагружаю колонку…';
    paintReboot(Math.max(0, Math.floor((Date.now() - started) / 1000)), false);
    State.rebootTimer = setInterval(function () {
      paintReboot(Math.max(0, Math.floor((Date.now() - State.rebootStart) / 1000)), false);
    }, 1000);
    State.rebootPoll = setTimeout(rebootPoll, 9000);
  }

  function resumeRebootWatch() {
    var value = null;
    var down = false;
    try {
      value = localStorage.getItem(REBOOT_KEY);
      down = localStorage.getItem(REBOOT_DOWN_KEY) === '1';
    } catch (e) {}
    var started = Number(value) || 0;
    var age = Date.now() - started;
    if (started && age >= 0 && age < 300000) startRebootWatch(started, down);
    else if (value) {
      try {
        localStorage.removeItem(REBOOT_KEY);
        localStorage.removeItem(REBOOT_DOWN_KEY);
      } catch (e) {}
    }
  }

  function applyAutoConfig(auto, mode) {
    var ringOn = !!auto.enabled;
    el.autoBright.checked = ringOn;
    el.autoBrightStatus.textContent = ringOn
      ? ('вкл · ' + (auto.min || 10) + '–' + (auto.max || 150)) : 'выкл';

    if (mode) State.displayManual = !!(mode.manual);
    State.displayAuto = !!auto.display_enabled;
    State.displayMin = auto.display_min || 10;
    State.displayMax = auto.display_max || 170;
    State.displayCurve = auto.display_curve || [];
    el.displayAuto.checked = State.displayAuto;
    el.displayAutoStatus.textContent = State.displayAuto
      ? ('вкл · ' + (State.displayManual ? 'пауза (ручной режим)'
        : (auto.display_min || 10) + '–' + (auto.display_max || 170))) : 'выкл';
    el.brightness.classList.toggle('is-auto', State.displayAuto);
    el.brightChips.classList.toggle('is-auto', State.displayAuto);
    el.brightness.title = State.displayAuto
      ? 'Автояркость включена: движение ползунка выключит её' : '';
    State.ringAuto = ringOn;
    el.ringBrightness.classList.toggle('is-auto', ringOn);
    el.ringBrightVal.classList.toggle('is-auto', ringOn);
    el.ringBrightness.title = ringOn
      ? 'Автояркость кольца включена: движение ползунка выключит её' : '';
  }

  // Показать, что именно сейчас измеряет датчик и какую яркость выбрала
  // автояркость. Без этого «вкл» выглядит как «ничего не происходит».
  function applyAutoReading(ring) {
    if (!ring || !State.ringAuto) return;
    if (typeof ring.level === 'number') {
      State.ringBrightness = ring.level;
      if (el.ringBrightness) {
        el.ringBrightness.value = ring.level;
        paintRange(el.ringBrightness);
      }
      if (el.ringBrightVal) {
        el.ringBrightVal.textContent = ring.level;
        el.ringBrightVal.classList.add('is-auto');
      }
    }
    if (el.autoBrightStatus) {
      var lux = (typeof ring.lux === 'number') ? (Math.round(ring.lux * 10) / 10) : null;
      el.autoBrightStatus.textContent = 'вкл · ' +
        (lux === null ? 'датчик…' : lux + ' lux') +
        (typeof ring.level === 'number' ? ' · ' + ring.level : '');
    }
  }

  function refreshAutoBrightness() {
    if (!State.ringAuto && !State.displayAuto) return Promise.resolve();
    return cgi('display.py', { auto_tick: 1 }, { timeout: 12000, silent: true })
      .then(function (data) {
        applyAutoConfig(data.auto || {}, data.mode || {});
        applyAutoReading(data.ring);
        if (data.display && data.display.applied && typeof data.display.level === 'number') {
          applyBrightness(data.display.level, false);
        }
      }).catch(function () { /* тихо: следующий тик повторит */ });
  }

  function loadDisplayState() {
    return cgi('display.py', {}, { timeout: 8000, silent: true }).then(function (data) {
      if (typeof data.display_brightness === 'number') {
        applyBrightness(data.display_brightness, false);
      }
      applyAutoConfig(data.auto || {}, data.mode || {});
      if (data.auto && (data.auto.enabled || data.auto.display_enabled)) {
        setTimeout(refreshAutoBrightness, 0);
      }
      if (data.clock_anims) {
        State.clockAnims = data.clock_anims;
        State.hiddenPresets = data.hidden_presets || [];
        renderClockAnimList();
      }
      if (data.hidden_animations) State.hiddenRing = data.hidden_animations;
      if (el.ringAnimChips && data.animations) {
        // После «Выключить кольцо» запрос состояния мог прийти со старым
        // animation=test и снова запустить превью. Коротко игнорируем его.
        var offRecent = State.ringOffAt && Date.now() - State.ringOffAt < 4000;
        var playingName = data.animation && !offRecent
          ? (State.ringAnimName || data.animation_name || null) : null;
        renderRingAnims(data.animations, playingName);
        if (el.ringAnimStatus) {
          el.ringAnimStatus.textContent = playingName ? 'играет' : '—';
        }
        if (playingName) startRingPreview(playingName);
        else if (!data.animation || offRecent) {
          if (State.ringPreview) {
            State.ringPreview = null;
            paintOff();
            el.ledHint.textContent = 'Кольцо выключено';
          }
        }
      }
    }).catch(function () { /* тихо */ });
  }

  var RING_ANIM_LABELS = {
    alice_listening: 'Слушает',
    alice_thinking: 'Думает',
    alice_speaking: 'Говорит',
    alice_listening_out: 'Отбой',
    bluetooth_pairing: 'BT пара',
    bluetooth_connected: 'BT',
    boot: 'Загрузка',
    volume_sound: 'Громкость'
  };
  var ringAnimFrames = {};
  var ringAnimTiles = {};

  function buildRingDots(container, count, radius) {
    container.innerHTML = '';
    var dots = [];
    radius = radius || 15;
    for (var i = 0; i < count; i++) {
      var dot = document.createElement('i');
      dot.style.transform = 'rotate(' + (i * (360 / count)) + 'deg) translate(' + radius + 'px)';
      container.appendChild(dot);
      dots.push(dot);
    }
    return dots;
  }

  function paintRingFrame(name, frame) {
    var tile = ringAnimTiles[name];
    if (!tile || !frame) return;
    for (var i = 0; i < tile.dots.length; i++) {
      var hex = frame[i] || '000000';
      var r = parseInt(hex.substr(0, 2), 16);
      var g = parseInt(hex.substr(2, 2), 16);
      var b = parseInt(hex.substr(4, 2), 16);
      if (isNaN(r) || isNaN(g) || isNaN(b)) {
        r = g = b = 0;
      }
      tile.dots[i].style.background = 'rgb(' + r + ',' + g + ',' + b + ')';
      tile.dots[i].style.opacity = (r + g + b) > 12 ? '1' : '.2';
    }
  }

  function paintMainRingFrame(frame) {
    if (!ringDots.length || !frame) return;
    for (var i = 0; i < ringDots.length; i++) {
      var hex = frame[i] || '000000';
      var r = parseInt(hex.substr(0, 2), 16);
      var g = parseInt(hex.substr(2, 2), 16);
      var b = parseInt(hex.substr(4, 2), 16);
      if (isNaN(r) || isNaN(g) || isNaN(b)) {
        r = g = b = 0;
      }
      var color = 'rgb(' + r + ',' + g + ',' + b + ')';
      ringDots[i].style.background = color;
      ringDots[i].style.color = color;
      ringDots[i].style.boxShadow = (r + g + b) > 12
        ? '0 0 10px ' + color : 'none';
    }
  }

  function startRingPreview(name) {
    // Запоздавший ответ загрузки кадров не должен включать превью после
    // «Выключить кольцо».
    if (State.ringOffAt && Date.now() - State.ringOffAt < 4000) return;
    var playback = ringAnimFrames[name];
    if (!playback || !playback.frames.length) {
      return loadRingFrames(name).then(function (loaded) {
        if (loaded && loaded.frames.length) startRingPreview(name);
      });
    }
    if (State.ringPreview && State.ringPreview.name === name) return;
    State.ringPreview = { name: name, index: playback.index || 0 };
    el.ledHint.textContent = 'Анимация: ' + (RING_ANIM_LABELS[name] || name);
    if (el.ringHex) el.ringHex.textContent = RING_ANIM_LABELS[name] || 'Анимация';
    paintMainRingFrame(playback.frames[State.ringPreview.index]);
  }

  var ringEditorFrames = [];
  var ringEditorIndex = 0;
  var ringEditorDots = [];
  var ringEditorColor = '#00e676';
  var ringEditorName = null;

  function ringEditorNewFrame() {
    return new Array(24).fill('000000');
  }

  function ringEditorPaint() {
    var frame = ringEditorFrames[ringEditorIndex] || ringEditorNewFrame();
    var light = document.body.classList.contains('light');
    for (var i = 0; i < ringEditorDots.length; i++) {
      var hex = frame[i] || '000000';
      var color = '#' + hex;
      // В светлой теме погашенные диоды — тёплый серый, а не чёрные точки.
      ringEditorDots[i].style.background = (hex === '000000' && light) ? '#d8cfc2' : color;
      ringEditorDots[i].style.boxShadow = hex === '000000'
        ? 'none' : '0 0 10px ' + color;
    }
  }

  function ringEditorRenderFrames() {
    if (!el.ringEditorFrames) return;
    el.ringEditorFrames.innerHTML = '';
    ringEditorFrames.forEach(function (frame, index) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'anim-frame';
      button.setAttribute('aria-pressed', index === ringEditorIndex ? 'true' : 'false');
      var number = document.createElement('b');
      number.textContent = String(index + 1);
      var caption = document.createElement('small');
      caption.textContent = '24';
      button.appendChild(number);
      button.appendChild(caption);
      button.addEventListener('click', function () {
        ringEditorIndex = index;
        ringEditorPaint();
        ringEditorRenderFrames();
      });
      el.ringEditorFrames.appendChild(button);
    });
  }

  function ringEditorSetFrames(frames, name) {
    ringEditorFrames = (frames && frames.length ? frames : [ringEditorNewFrame()])
      .map(function (frame) { return frame.slice(0, 24); });
    ringEditorIndex = 0;
    ringEditorName = name || null;
    if (el.ringEditorName) el.ringEditorName.value = name || '';
    if (el.btnRingEditorDelete) el.btnRingEditorDelete.hidden = !name;
    ringEditorPaint();
    ringEditorRenderFrames();
  }

  function renderRingEditorSaved() {
    if (!el.ringEditorSaved) return;
    el.ringEditorSaved.innerHTML = '';
    var custom = (State.ringAnimations || []).filter(function (item) {
      return item.custom;
    });
    if (!custom.length) {
      var empty = document.createElement('div');
      empty.className = 'anim-saved-empty';
      empty.textContent = 'Своих анимаций кольца пока нет.';
      el.ringEditorSaved.appendChild(empty);
      return;
    }
    custom.forEach(function (item) {
      var row = document.createElement('div');
      row.className = 'anim-saved-row';
      var name = document.createElement('b');
      name.textContent = item.name;
      var play = document.createElement('button');
      play.type = 'button';
      play.className = 'btn sm ghost';
      play.textContent = 'Играть';
      play.addEventListener('click', function () { playRingAnim(item.name); });
      var edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'btn sm ghost';
      edit.textContent = 'Изменить';
      edit.addEventListener('click', function () { ringEditorLoad(item.name); });
      var remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'btn sm ghost';
      remove.textContent = '×';
      remove.title = 'Удалить';
      remove.addEventListener('click', function () {
        askConfirm('Удалить анимацию кольца «' + item.name + '»?',
          { yes: 'Удалить' }).then(function (ok) {
          if (ok) ringEditorDelete(item.name);
        });
      });
      row.appendChild(name);
      row.appendChild(play);
      row.appendChild(edit);
      row.appendChild(remove);
      el.ringEditorSaved.appendChild(row);
    });
  }

  function ringEditorLoad(name) {
    loadRingFrames(name).then(function (playback) {
      if (!playback || !playback.frames.length) {
        toast('Не удалось прочитать кадры анимации', 'bad');
        return;
      }
      ringEditorSetFrames(playback.frames, name);
    });
  }

  function openRingEditor() {
    if (!el.ringEditorDlg) return;
    var painting = false;
    ringEditorDots = buildRingDots(el.ringEditorRing, 24, 82);
    ringEditorDots.forEach(function (dot, index) {
      var paint = function () {
        ringEditorFrames[ringEditorIndex][index] = ringEditorColor.replace('#', '');
        ringEditorPaint();
      };
      dot.addEventListener('pointerdown', function (event) {
        event.preventDefault();
        painting = true;
        paint();
      });
      dot.addEventListener('pointerenter', function () {
        if (painting) paint();
      });
    });
    document.addEventListener('pointerup', function () { painting = false; });
    ringEditorSetFrames([ringEditorNewFrame()], null);
    renderRingEditorSaved();
    el.ringEditorDlg.showModal();
  }

  function saveRingEditor() {
    var name = (el.ringEditorName.value || '').trim();
    if (name.length < 2) {
      toast('Название анимации: минимум 2 символа', 'warn');
      el.ringEditorName.focus();
      return;
    }
    var duration = parseInt(el.ringEditorDuration.value, 10) || 50;
    cgi('display.py', {
      ring_anim_save: {
        name: name,
        frames: ringEditorFrames,
        duration: duration
      }
    }, { timeout: 15000 }).then(function (data) {
      State.ringAnimations = data.animations || [];
      ringEditorName = name;
      if (el.btnRingEditorDelete) el.btnRingEditorDelete.hidden = false;
      renderRingEditorSaved();
      renderRingAnims(State.ringAnimations, State.ringAnimName);
      toast('Анимация кольца сохранена', 'ok');
    }).catch(function (err) { toast('Кольцо: ' + err.message, 'bad'); });
  }

  function ringEditorDelete(name) {
    cgi('display.py', { ring_anim_delete: name }, { timeout: 10000 }).then(function (data) {
      State.ringAnimations = data.animations || [];
      renderRingEditorSaved();
      renderRingAnims(State.ringAnimations, State.ringAnimName);
      if (ringEditorName === name) ringEditorSetFrames([ringEditorNewFrame()], null);
      toast('Анимация кольца удалена', 'ok');
    }).catch(function (err) { toast('Кольцо: ' + err.message, 'bad'); });
  }

  function loadRingFrames(name) {
    if (ringAnimFrames[name]) {
      var playback = ringAnimFrames[name];
      if (playback.frames.length) {
        paintRingFrame(name, playback.frames[playback.index] || playback.frames[0]);
      }
      return Promise.resolve(playback);
    }
    return cgi('display.py', { anim_preview: name }, { timeout: 12000, silent: true })
      .then(function (data) {
        var frames = data.frames || [];
        var best = 0;
        var bestSum = -1;
        frames.forEach(function (frame, index) {
          var sum = 0;
          frame.forEach(function (hex) {
            sum += parseInt(hex.substr(0, 2), 16)
              + parseInt(hex.substr(2, 2), 16)
              + parseInt(hex.substr(4, 2), 16);
          });
          if (sum > bestSum) { bestSum = sum; best = index; }
        });
        ringAnimFrames[name] = { frames: frames, loop: !!data.loop, index: best };
        if (frames.length) paintRingFrame(name, frames[best]);
        return ringAnimFrames[name];
      }).catch(function () {
        ringAnimFrames[name] = { frames: [], loop: false, index: 0 };
      });
  }

  function markRingAnim(name) {
    Object.keys(ringAnimTiles).forEach(function (key) {
      var tile = ringAnimTiles[key];
      var active = key === name;
      tile.el.setAttribute('aria-pressed', active ? 'true' : 'false');
      tile.active = active || tile.hovered;
    });
    if (el.ringAnimStatus) el.ringAnimStatus.textContent = name ? 'играет' : '—';
    if (el.ringPickName) {
      el.ringPickName.textContent = name ? (RING_ANIM_LABELS[name] || name) : 'Все анимации';
    }
  }

  function filterRingAnims() {
    if (!el.ringAnimList || !el.ringSearch) return;
    var query = (el.ringSearch.value || '').trim().toLowerCase();
    Array.prototype.forEach.call(el.ringAnimList.children, function (option) {
      var text = (option.dataset.name || '').toLowerCase() + ' ' +
        (option.textContent || '').toLowerCase();
      option.hidden = !!query && text.indexOf(query) < 0;
    });
  }

  function placeRingPick() {
    if (!el.ringPickPop || !el.btnRingPick || el.ringPickPop.hidden) return;
    var rect = el.btnRingPick.getBoundingClientRect();
    var width = Math.max(240, Math.min(420, rect.width));
    var left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    var below = window.innerHeight - rect.bottom - 12;
    var above = rect.top - 12;
    var up = below < 220 && above > below;
    var height = Math.max(140, Math.min(340, up ? above : below));
    el.ringPickPop.style.position = 'fixed';
    el.ringPickPop.style.width = width + 'px';
    el.ringPickPop.style.left = left + 'px';
    el.ringPickPop.style.maxHeight = height + 'px';
    el.ringPickPop.style.overflow = 'auto';
    if (up) {
      el.ringPickPop.style.top = 'auto';
      el.ringPickPop.style.bottom = (window.innerHeight - rect.top + 6) + 'px';
    } else {
      el.ringPickPop.style.top = (rect.bottom + 6) + 'px';
      el.ringPickPop.style.bottom = 'auto';
    }
  }

  function toggleRingPick(show) {
    if (!el.ringPickPop || !el.btnRingPick) return;
    if (show) placeRingPick();
    el.ringPickPop.hidden = !show;
    el.btnRingPick.setAttribute('aria-expanded', show ? 'true' : 'false');
    if (show) {
      el.ringSearch.value = '';
      filterRingAnims();
      placeRingPick();
      focusOnDesktop(el.ringSearch, 30);
    }
  }

  function renderRingAnims(animations, playingName) {
    if (!el.ringAnimChips) return;
    var list = animations || [];
    State.ringAnimations = list;
    var hidden = State.hiddenRing || [];
    var names = {};
    list.forEach(function (item) { names[item.name] = true; });
    el.ringAnimChips.innerHTML = '';
    ringAnimTiles = {};
    State.ringAnimName = playingName || null;
    Object.keys(RING_ANIM_LABELS).forEach(function (name) {
      if (!names[name] || hidden.indexOf(name) >= 0) return;
      var tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'anim-tile';
      tile.setAttribute('aria-pressed', playingName === name ? 'true' : 'false');
      var ring = document.createElement('span');
      ring.className = 'anim-ring';
      var dots = buildRingDots(ring, 24);
      var label = document.createElement('span');
      label.className = 'anim-name';
      label.textContent = RING_ANIM_LABELS[name];
      tile.appendChild(ring);
      tile.appendChild(label);
      var hideTile = document.createElement('span');
      hideTile.className = 'anim-tile-x';
      hideTile.textContent = '×';
      hideTile.title = 'Скрыть анимацию';
      hideTile.addEventListener('click', function (event) {
        event.stopPropagation();
        hideRingAnim(name);
      });
      tile.appendChild(hideTile);
      ringAnimTiles[name] = {
        el: tile, dots: dots,
        active: playingName === name,
        hovered: false
      };
      tile.addEventListener('mouseenter', function () {
        ringAnimTiles[name].hovered = true;
        ringAnimTiles[name].active = true;
        loadRingFrames(name);
      });
      tile.addEventListener('mouseleave', function () {
        ringAnimTiles[name].hovered = false;
        ringAnimTiles[name].active = tile.getAttribute('aria-pressed') === 'true';
      });
      tile.addEventListener('click', function () { playRingAnim(name); });
      el.ringAnimChips.appendChild(tile);
      var cached = ringAnimFrames[name];
      if (cached && cached.frames.length) {
        paintRingFrame(name, cached.frames[cached.index] || cached.frames[0]);
      } else {
        loadRingFrames(name);
      }
    });
    list.filter(function (item) {
      return item.custom && hidden.indexOf(item.name) < 0;
    }).forEach(function (item) {
      var name = item.name;
      var tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'anim-tile';
      tile.setAttribute('aria-pressed', playingName === name ? 'true' : 'false');
      var ring = document.createElement('span');
      ring.className = 'anim-ring';
      var dots = buildRingDots(ring, 24);
      var label = document.createElement('span');
      label.className = 'anim-name';
      label.textContent = name;
      tile.appendChild(ring);
      tile.appendChild(label);
      var remove = document.createElement('span');
      remove.className = 'anim-tile-x';
      remove.textContent = '×';
      remove.title = 'Удалить свою анимацию';
      remove.addEventListener('click', function (event) {
        event.stopPropagation();
        askConfirm('Удалить анимацию кольца «' + name + '»?', { yes: 'Удалить' })
          .then(function (ok) { if (ok) ringEditorDelete(name); });
      });
      tile.appendChild(remove);
      ringAnimTiles[name] = { el: tile, dots: dots, active: playingName === name, hovered: false };
      tile.addEventListener('mouseenter', function () {
        ringAnimTiles[name].hovered = true;
        ringAnimTiles[name].active = true;
        loadRingFrames(name);
      });
      tile.addEventListener('mouseleave', function () {
        ringAnimTiles[name].hovered = false;
        ringAnimTiles[name].active = tile.getAttribute('aria-pressed') === 'true';
      });
      tile.addEventListener('click', function () { playRingAnim(name); });
      el.ringAnimChips.appendChild(tile);
      loadRingFrames(name).then(function (playback) {
        if (playback && playback.frames.length) {
          paintRingFrame(name, playback.frames[playback.index] || playback.frames[0]);
        }
      });
    });
    if (el.btnRingRestoreHidden) el.btnRingRestoreHidden.hidden = !hidden.length;
    if (el.ringAnimList) {
      el.ringAnimList.innerHTML = '';
      var seen = {};
      list.forEach(function (item) {
        if (seen[item.name] || hidden.indexOf(item.name) >= 0) return;
        seen[item.name] = true;
        var option = document.createElement('button');
        option.type = 'button';
        option.className = 'alarm-station-item ring-option';
        option.dataset.name = item.name;
        option.setAttribute('role', 'option');
        option.title = item.name;
        var label = document.createElement('span');
        label.className = 'ring-label';
        label.textContent = RING_ANIM_LABELS[item.name] || item.name;
        option.appendChild(label);
        if (RING_ANIM_LABELS[item.name]) {
          var raw = document.createElement('span');
          raw.className = 'ring-raw';
          raw.textContent = item.name;
          option.appendChild(raw);
        }
        option.addEventListener('click', function () {
          toggleRingPick(false);
          playRingAnim(item.name);
        });
        el.ringAnimList.appendChild(option);
      });
      filterRingAnims();
    }
    markRingAnim(playingName);
  }

  function tickRingAnims() {
    if (State.ringPreview) {
      var preview = State.ringPreview;
      var playback = ringAnimFrames[preview.name];
      if (playback && playback.frames.length) {
        preview.index = (preview.index + 1) % playback.frames.length;
        paintMainRingFrame(playback.frames[preview.index]);
      }
    }
    Object.keys(ringAnimTiles).forEach(function (name) {
      var tile = ringAnimTiles[name];
      var playback = ringAnimFrames[name];
      if (!tile.active || !playback || !playback.frames.length) return;
      playback.index = (playback.index + 1) % playback.frames.length;
      paintRingFrame(name, playback.frames[playback.index]);
    });
  }

  function playRingAnim(name, allowDuringMusic) {
    name = typeof name === 'string' ? name : (State.ringAnimName || '');
    if (!name) { toast('Выберите анимацию кольца', 'warn'); return; }
    if (nativeLightActive()) {
      stopCustomRingForNative();
      toast('Во время музыки или ответа Алисы кольцом управляет станция', 'warn');
      return;
    }
    stopLedAnimation();
    State.ringOffAt = 0;
    State.ledMode = 'anim';
    store.set('ledMode', 'anim');
    markActiveChip();
    return stopFirmwareRingAnim().then(function () {
      return cgi('display.py', { ring_anim: name }, { timeout: 10000 });
    }).then(function () {
      State.ringAnimName = name;
      markRingAnim(name);
      loadRingFrames(name).then(function () { startRingPreview(name); });
      toast('Анимация: ' + (RING_ANIM_LABELS[name] || name), 'ok');
    }).catch(function (err) {
      toast('Анимация: ' + err.message, 'bad');
    });
  }

  function hideRingAnim(name) {
    cgi('display.py', { ring_anim_hide: name }, { timeout: 10000 }).then(function (data) {
      State.hiddenRing = data.hidden_animations || [];
      if (State.ringAnimName === name) {
        State.ringAnimName = null;
        State.ringPreview = null;
        paintOff();
        el.ledHint.textContent = 'Кольцо выключено';
      }
      renderRingAnims(State.ringAnimations, State.ringAnimName);
      toast('Анимация убрана из списка', 'ok');
    }).catch(function (err) { toast('Кольцо: ' + err.message, 'bad'); });
  }

  function restoreRingAnims() {
    cgi('display.py', { ring_anim_restore: 1 }, { timeout: 10000 }).then(function (data) {
      State.hiddenRing = data.hidden_animations || [];
      renderRingAnims(State.ringAnimations, State.ringAnimName);
      toast('Анимации возвращены', 'ok');
    }).catch(function (err) { toast('Кольцо: ' + err.message, 'bad'); });
  }

  function stopRingAnim() {
    // Сначала гасим UI, не дожидаясь ответа: даже если backend завис,
    // пользователь не должен остаться с «залипшей» анимацией.
    State.ringPreview = null;
    State.ringAnimName = null;
    State.ringOffAt = Date.now();
    State.ledMode = 'off';
    State.hwActive = false;
    State.hwLast = '';
    State.hwHoldUntil = Date.now() + 1500;
    store.set('ledMode', 'off');
    stopLedAnimation();
    State.selected = null;
    ringDots.forEach(function (dot) { dot.classList.remove('sel'); });
    paintOff();
    markRingAnim(null);
    markActiveChip();
    if (el.ledHint) el.ledHint.textContent = 'Кольцо выключено';
    ringOffBurst();
    return cgi('display.py', { ring_anim_stop: 1 }, { timeout: 8000 }).then(function () {      toast('Анимация остановлена, кольцо выключено', 'ok');
    }).catch(function (err) {
      toast('Анимация: ' + err.message, 'bad');
    });
  }

  function toggleAutoBright() {
    var on = el.autoBright.checked ? 1 : 0;
    return cgi('display.py', { auto_brightness: on, min: 10, max: 150 }, { timeout: 10000 })
      .then(function (data) {
        applyAutoConfig(data.auto || {});
        if (on) {
          return cgi('display.py', { auto_tick: 1 }, { timeout: 12000, silent: true })
            .then(function (tick) { applyAutoReading(tick.ring); })
            .catch(function () { /* датчик/демон ответит позже */ });
        }
      }).then(function () {
        toast(on ? 'Автояркость кольца включена' : 'Автояркость кольца выключена', 'ok');
      }).catch(function (err) {
        el.autoBright.checked = !el.autoBright.checked;
        toast('Автояркость кольца: ' + err.message, 'bad');
      });
  }

  function toggleDisplayAuto() {
    var on = el.displayAuto.checked ? 1 : 0;
    var warning = '';
    return cgi('display.py', { display_auto_brightness: on }, { timeout: 10000 })
      .then(function (data) {
        applyAutoConfig(data.auto || {}, data.mode || {});
        if (on) {
          if (data.mode && data.mode.manual) {
            warning = 'Автояркость включена, но сейчас ручной режим дисплея';
          } else if (data.display && data.display.reason === 'sensor') {
            warning = 'Автояркость включена, но датчик света не отвечает';
          } else if (!data.display || data.display.applied === false) {
            warning = 'Автояркость включена, но Luna не ответила';
          }
          return cgi('display.py', { auto_tick: 1 }, { timeout: 10000, silent: true })
            .catch(function () { /* тихо */ });
        }
      }).then(function () {
        if (warning) toast(warning, 'warn');
        else toast(on ? 'Автояркость дисплея включена' : 'Автояркость дисплея выключена', 'ok');
      }).catch(function (err) {
        el.displayAuto.checked = !el.displayAuto.checked;
        toast('Автояркость дисплея: ' + err.message, 'bad');
      });
  }

  function disableDisplayAuto() {
    if (!State.displayAuto) return Promise.resolve();
    State.displayAuto = false;
    el.displayAuto.checked = false;
    el.displayAutoStatus.textContent = 'выкл';
    el.brightness.classList.remove('is-auto');
    el.brightChips.classList.remove('is-auto');
    return cgi('display.py', { display_auto_brightness: 0 }, { timeout: 8000, silent: true })
      .then(function (data) { applyAutoConfig(data.auto || {}, data.mode || {}); })
      .catch(function () { /* тихо */ });
  }

  function disableRingAuto() {
    if (!State.ringAuto) return Promise.resolve();
    State.ringAuto = false;
    el.autoBright.checked = false;
    el.autoBrightStatus.textContent = 'выкл';
    el.ringBrightness.classList.remove('is-auto');
    el.ringBrightVal.classList.remove('is-auto');
    return cgi('display.py', { auto_brightness: 0 }, { timeout: 8000, silent: true })
      .then(function (data) { applyAutoConfig(data.auto || {}); })
      .catch(function () { /* тихо */ });
  }

  /* ─────────── бэкап ─────────── */
  function downloadBackup() {
    // По умолчанию ключи API и подписка VPN не попадают в файл: панель
    // работает по HTTP, а копию легко переслать. Полная — только по выбору.
    return askConfirm('Скачать копию вместе с ключами API и подпиской VPN? «Отмена» — скачать без секретов.', { yes: 'С ключами', danger: false }).then(function (full) {
      return cgi('backup.py', full ? { full: 1 } : {}, { timeout: 20000 }).then(function (data) {
        var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        var link = document.createElement('a');
        var stamp = new Date().toISOString().slice(0, 10);
        link.href = URL.createObjectURL(blob);
        link.download = 'mypult-backup-' + stamp + (full ? '-full' : '') + '.json';
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(function () { URL.revokeObjectURL(link.href); }, 3000);
        toast(full ? 'Бэкап с ключами скачан' : 'Бэкап скачан без ключей', 'ok');
      }).catch(function (err) { toast('Бэкап: ' + err.message, 'bad'); });
    });
  }

  function restoreBackup(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var parsed;
      try {
        parsed = JSON.parse(String(reader.result));
      } catch (err) {
        toast('Файл не JSON', 'bad');
        return;
      }
      var payload = parsed && parsed.data ? parsed.data : parsed;
      askConfirm('Восстановить настройки из файла? Текущие будут заменены.', { yes: 'Восстановить' }).then(function (ok) {
        if (!ok) return;
        return cgi('backup.py', { data: payload }, { timeout: 30000 }).then(function (data) {
          var done = (data.restored || []).join(', ') || 'ничего';
          var msg = 'Восстановлено: ' + done;
          if (data.skipped && data.skipped.length) msg += ' · пропущено с маской: ' + data.skipped.join(', ');
          toast(msg, 'ok');
          setTimeout(function () { location.reload(); }, 1200);
        }).catch(function (err) { toast('Восстановление: ' + err.message, 'bad'); });
      });
    };
    reader.readAsText(file);
  }

  /* ─────────── кривая автояркости ─────────── */
  var curvePoints = [];

  function curveDefaults() {
    var lo = Number(State.displayMin) || 10;
    var hi = Number(State.displayMax) || 170;
    return [[0, lo], [50, Math.round((lo + hi) / 2)], [200, hi]];
  }

  function curveDraw() {
    var canvas = el.curveCanvas;
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    var width = canvas.width;
    var height = canvas.height;
    var pad = 26;
    ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = 'rgba(255,255,255,.08)';
    ctx.fillStyle = 'rgba(255,255,255,.45)';
    ctx.font = '10px sans-serif';
    ctx.lineWidth = 1;
    var maxLux = 10000;
    var maxLevel = 255;
    function x(lux) {
      var span = Math.log10(maxLux + 1);
      return pad + (width - pad - 10) * Math.min(1, Math.log10(Math.max(0, lux) + 1) / span);
    }
    function y(level) {
      return height - pad - (height - pad - 12) * Math.min(1, Math.max(0, level) / maxLevel);
    }
    [0, 10, 100, 1000, 10000].forEach(function (lux) {
      ctx.beginPath();
      ctx.moveTo(x(lux), 12);
      ctx.lineTo(x(lux), height - pad);
      ctx.stroke();
      ctx.fillText(lux ? String(lux) : '0', x(lux) - 6, height - 8);
    });
    [10, 100, 255].forEach(function (level) {
      ctx.beginPath();
      ctx.moveTo(pad, y(level));
      ctx.lineTo(width - 10, y(level));
      ctx.stroke();
      ctx.fillText(String(level), 2, y(level) + 3);
    });
    var points = curvePoints.slice().sort(function (a, b) { return a[0] - b[0]; });
    if (!points.length) return;
    ctx.strokeStyle = '#8b7bff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    points.forEach(function (point, index) {
      if (index === 0) ctx.moveTo(x(point[0]), y(point[1]));
      else ctx.lineTo(x(point[0]), y(point[1]));
    });
    ctx.stroke();
    ctx.fillStyle = '#ffdb4d';
    points.forEach(function (point) {
      ctx.beginPath();
      ctx.arc(x(point[0]), y(point[1]), 4, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function curveRender() {
    if (!el.curveRows) return;
    el.curveRows.textContent = '';
    curvePoints.sort(function (a, b) { return a[0] - b[0]; });
    curvePoints.forEach(function (point, index) {
      var row = document.createElement('div');
      row.className = 'curve-row';
      var lux = document.createElement('input');
      lux.type = 'number';
      lux.min = '0';
      lux.max = '100000';
      lux.step = '1';
      lux.value = String(point[0]);
      lux.className = 'net-input';
      lux.setAttribute('aria-label', 'Освещённость, lux');
      var arrow = document.createElement('span');
      arrow.textContent = '→';
      arrow.className = 'seg-note';
      var level = document.createElement('input');
      level.type = 'number';
      level.min = '10';
      level.max = '255';
      level.step = '1';
      level.value = String(point[1]);
      level.className = 'net-input';
      level.setAttribute('aria-label', 'Яркость');
      var del = document.createElement('button');
      del.type = 'button';
      del.className = 'btn sm ghost curve-del';
      del.textContent = 'Удалить';
      del.disabled = curvePoints.length <= 2;
      function apply() {
        var lx = Math.max(0, Math.min(100000, Number(lux.value) || 0));
        var lv = Math.max(10, Math.min(255, Math.round(Number(level.value) || 10)));
        curvePoints[index] = [lx, lv];
        point = curvePoints[index];
        curveDraw();
      }
      lux.addEventListener('change', apply);
      level.addEventListener('change', apply);
      del.addEventListener('click', function () {
        if (curvePoints.length <= 2) return;
        curvePoints.splice(index, 1);
        curveRender();
        curveDraw();
      });
      row.appendChild(lux);
      row.appendChild(arrow);
      row.appendChild(level);
      row.appendChild(del);
      el.curveRows.appendChild(row);
    });
  }

  function curveOpen() {
    curvePoints = (State.displayCurve || []).map(function (pair) {
      return [Number(pair[0]) || 0, Number(pair[1]) || 10];
    });
    if (!curvePoints.length) curvePoints = curveDefaults();
    curveRender();
    curveDraw();
    if (el.curveDlg && el.curveDlg.showModal) el.curveDlg.showModal();
  }

  function curveClose() {
    if (el.curveDlg && el.curveDlg.open) el.curveDlg.close();
  }

  function curveAdd() {
    var points = curvePoints.slice().sort(function (a, b) { return a[0] - b[0]; });
    var last = points[points.length - 1] || [0, 10];
    var before = points[points.length - 2] || [0, last[1]];
    curvePoints.push([Math.min(100000, Math.round((before[0] + last[0]) / 2) || 100), last[1]]);
    curveRender();
    curveDraw();
  }

  function curveReset() {
    curvePoints = curveDefaults();
    curveRender();
    curveDraw();
  }

  function curveSave() {
    var points = curvePoints.slice().sort(function (a, b) { return a[0] - b[0]; });
    if (points.length < 2) {
      toast('Нужно минимум две точки', 'bad');
      return;
    }
    return cgi('display.py', { display_curve: points }, { timeout: 12000 }).then(function (data) {
      if (data.auto && data.auto.display_curve) {
        State.displayCurve = data.auto.display_curve;
      }
      toast('Кривая автояркости сохранена', 'ok');
      curveClose();
    }).catch(function (err) {
      toast('Кривая: ' + err.message, 'bad');
    });
  }
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

  /* ─────────── порядок карточек ─────────── */
  function initCardDrag() {
    var main = document.querySelector('main');
    var cards = Array.prototype.slice.call(document.querySelectorAll('main .card'));

    function groupCards(card) {
      return Array.prototype.filter.call(
        document.querySelectorAll('main .card'),
        function (item) { return item.dataset.group === card.dataset.group; });
    }

    function updateMoveButtons() {
      cards.forEach(function (card) {
        var box = card.querySelector('.card-move');
        if (!box) return;
        var siblings = groupCards(card);
        var index = siblings.indexOf(card);
        box.children[0].disabled = index <= 0;
        box.children[1].disabled = index < 0 || index >= siblings.length - 1;
      });
    }

    function moveCard(card, direction) {
      var siblings = groupCards(card);
      var target = siblings[siblings.indexOf(card) + direction];
      if (!target) return;
      main.insertBefore(card, direction < 0 ? target : target.nextSibling);
      saveCardOrder();
      updateMoveButtons();
    }

    function layoutRect(card) {
      var parent = card.offsetParent || main;
      var parentBox = parent.getBoundingClientRect();
      return {
        left: parentBox.left + card.offsetLeft,
        top: parentBox.top + card.offsetTop,
        right: parentBox.left + card.offsetLeft + card.offsetWidth,
        bottom: parentBox.top + card.offsetTop + card.offsetHeight,
        width: card.offsetWidth,
        height: card.offsetHeight
      };
    }

    function cardPlacement(card, x, y) {
      var box = card.getBoundingClientRect();
      var middle = box.top + box.height / 2;
      if (y < middle) return false;
      if (y > middle) return true;
      return x > box.left + box.width / 2;
    }

    function pointerTarget(x, y, drag) {
      var node = document.elementFromPoint(x, y);
      var found = node && node.closest ? node.closest('.card') : null;
      if (found && found !== drag && found.dataset.group === drag.dataset.group) {
        return { card: found, after: cardPlacement(found, x, y) };
      }
      var best = null;
      var bestDistance = Infinity;
      groupCards(drag).forEach(function (card) {
        if (card === drag) return;
        var box = card.getBoundingClientRect();
        var dx = x < box.left ? box.left - x : (x > box.right ? x - box.right : 0);
        var dy = y < box.top ? box.top - y : (y > box.bottom ? y - box.bottom : 0);
        var distance = dx * dx + dy * dy;
        if (distance < bestDistance) {
          bestDistance = distance;
          best = card;
        }
      });
      return best ? { card: best, after: cardPlacement(best, x, y) } : null;
    }

    var cardAnimations = new WeakMap();

    function reorderAnimated(drag, target, after) {
      if (!target || target === drag) return;
      var siblings = groupCards(drag);
      var order = siblings.filter(function (card) { return card !== drag; });
      var targetIndex = order.indexOf(target);
      if (targetIndex < 0) return;
      var desired = targetIndex + (after ? 1 : 0);
      var current = siblings.indexOf(drag);
      if (desired === current) return;

      var first = {};
      siblings.forEach(function (card) {
        first[card.dataset.cardId] = card.getBoundingClientRect();
      });
      var reference = order[desired] || null;
      if (reference) {
        main.insertBefore(drag, reference);
      } else {
        var last = order[order.length - 1];
        main.insertBefore(drag, last ? last.nextSibling : null);
      }

      groupCards(drag).forEach(function (card) {
        if (card === drag) return;
        var previous = cardAnimations.get(card);
        if (previous) {
          try { previous.cancel(); } catch (e) { /* уже завершена */ }
        }
        var a = first[card.dataset.cardId];
        var b = card.getBoundingClientRect();
        if (!a) return;
        var dx = a.left - b.left;
        var dy = a.top - b.top;
        if (!dx && !dy) return;
        var anim = card.animate([
          { transform: 'translate3d(' + dx + 'px,' + dy + 'px,0)' },
          { transform: 'translate3d(0,0,0)' }
        ], {
          duration: 190,
          easing: 'cubic-bezier(.2,.7,.2,1)'
        });
        cardAnimations.set(card, anim);
        anim.onfinish = function () {
          if (cardAnimations.get(card) === anim) cardAnimations.delete(card);
        };
      });
    }

    function beginPointerDrag(card, event) {
      if (event.pointerType && event.pointerType !== 'mouse') return;
      if (event.button !== 0 || !event.target.closest || event.target.closest('.card-move, .card-resize')) return;
      event.preventDefault();
      var startX = event.clientX;
      var startY = event.clientY;
      var active = false;
      var ghost = null;
      var offsetX = 0;
      var offsetY = 0;
      var frame = 0;
      var latest = null;
      var lastTarget = null;
      var lastAfter = false;

      function stopFrame() {
        if (frame) {
          cancelAnimationFrame(frame);
          frame = 0;
        }
      }

      function finish() {
        stopFrame();
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', finish);
        document.removeEventListener('pointercancel', finish);
        if (!active) return;
        if (ghost) ghost.remove();
        card.classList.remove('dragging');
        document.body.classList.remove('card-dragging');
        State.dragCard = null;
        saveCardOrder();
        updateMoveButtons();
        schedulePack();
      }

      function processMove() {
        frame = 0;
        if (!active || !latest || !ghost) return;
        ghost.style.transform = 'translate3d(' + (latest.x - offsetX) + 'px,' +
          (latest.y - offsetY) + 'px,0) rotate(.45deg) scale(1.012)';
        if (latest.y < 90) window.scrollBy(0, -16);
        if (latest.y > window.innerHeight - 90) window.scrollBy(0, 16);
        var underNode = document.elementFromPoint(latest.x, latest.y);
        var under = underNode && underNode.closest ? underNode.closest('.card') : null;
        var target;
        if (under === card && lastTarget) {
          target = { card: lastTarget, after: lastAfter };
        } else {
          target = pointerTarget(latest.x, latest.y, card);
        }
        if (target && (target.card !== lastTarget || target.after !== lastAfter)) {
          reorderAnimated(card, target.card, target.after);
          lastTarget = target.card;
          lastAfter = target.after;
        }
      }

      function onMove(move) {
        move.preventDefault();
        latest = { x: move.clientX, y: move.clientY };
        if (!active) {
          if (Math.abs(move.clientX - startX) + Math.abs(move.clientY - startY) < 6) return;
          active = true;
          State.dragCard = card;
          var startRect = card.getBoundingClientRect();
          offsetX = move.clientX - startRect.left;
          offsetY = move.clientY - startRect.top;
          ghost = card.cloneNode(true);
          Array.prototype.forEach.call(ghost.querySelectorAll('[id]'), function (node) {
            node.removeAttribute('id');
          });
          ghost.classList.add('card-ghost');
          ghost.style.width = startRect.width + 'px';
          ghost.style.height = startRect.height + 'px';
          ghost.style.transform = 'translate3d(' + startRect.left + 'px,' +
            startRect.top + 'px,0) rotate(.45deg) scale(1.012)';
          document.body.appendChild(ghost);
          card.classList.add('dragging');
          document.body.classList.add('card-dragging');
        }
        if (!frame) frame = requestAnimationFrame(processMove);
      }

      document.addEventListener('pointermove', onMove, { passive: false });
      document.addEventListener('pointerup', finish);
      document.addEventListener('pointercancel', finish);
    }

    cards.forEach(function (card, index) {
      var head = card.querySelector('h2');
      if (!head) return;
      card.dataset.cardId = head.id || ((head.textContent.trim() || 'card') + '-' + index);
      card.dataset.legacyCardId = (head.textContent.trim() || 'card') + '-' + index;
      head.draggable = false;
      head.addEventListener('pointerdown', function (event) {
        beginPointerDrag(card, event);
      });
      var controls = document.createElement('div');
      controls.className = 'card-move';
      var up = document.createElement('button');
      up.type = 'button';
      up.textContent = '↑';
      up.title = 'Поднять карточку';
      up.setAttribute('aria-label', 'Поднять карточку');
      var down = document.createElement('button');
      down.type = 'button';
      down.textContent = '↓';
      down.title = 'Опустить карточку';
      down.setAttribute('aria-label', 'Опустить карточку');
      up.addEventListener('click', function (event) {
        event.stopPropagation();
        moveCard(card, -1);
      });
      down.addEventListener('click', function (event) {
        event.stopPropagation();
        moveCard(card, 1);
      });
      controls.appendChild(up);
      controls.appendChild(down);
      var header = document.createElement('div');
      header.className = 'card-head';
      card.insertBefore(header, head);
      header.appendChild(head);
      header.appendChild(controls);
      var resize = document.createElement('button');
      resize.type = 'button';
      resize.className = 'card-resize';
      resize.title = 'Потяните за угол: ширина и высота (двойной клик — сброс)';
      resize.setAttribute('aria-label', 'Изменить ширину и высоту карточки');
      card.appendChild(resize);
      resize.addEventListener('pointerdown', function (event) {
        beginResize(card, event);
      });
      resize.addEventListener('dblclick', function (event) {
        event.preventDefault();
        event.stopPropagation();
        var spans = loadMap(SPANS_KEY);
        delete spans[card.dataset.cardId];
        saveMap(SPANS_KEY, spans);
        var rowsMap = loadMap(ROWS_KEY);
        delete rowsMap[card.dataset.cardId];
        saveMap(ROWS_KEY, rowsMap);
        delete card.dataset.rows;
        card.style.gridColumn = '';
        card.style.gridRowEnd = '';
        schedulePack();
      });
    });

    var saved = [];
    try { saved = JSON.parse(localStorage.getItem('mypult-cards') || '[]'); } catch (e) {}
    if (saved.length) {
      var map = {};
      var legacy = {};
      cards.forEach(function (card) {
        map[card.dataset.cardId] = card;
        if (card.dataset.legacyCardId) legacy[card.dataset.legacyCardId] = card;
        (card.dataset.legacyCardIds || '').split(',').forEach(function (id) {
          if (id) legacy[id] = card;
        });
      });
      saved.forEach(function (id) {
        var card = map[id] || legacy[id];
        // «Сервисы музыки» — новая объединённая карточка: не тащим её в конец
        // из старого сохранённого порядка, оставляем рядом с плеером и радио.
        if (!card || card.dataset.cardId === 'providers') return;
        main.appendChild(card);
      });
      // Новые карточки, которых ещё нет в сохранённом порядке, ставим в конец
      // своей группы, а не оставляем вверху.
      cards.forEach(function (card) {
        var id = card.dataset.cardId;
        if (!id || saved.indexOf(id) >= 0) return;
        var group = card.dataset.group;
        var last = null;
        Array.prototype.forEach.call(main.querySelectorAll('.card[data-group="' + group + '"]'),
          function (other) { if (other !== card) last = other; });
        if (last) main.insertBefore(card, last.nextSibling);
        else main.appendChild(card);
      });
    }
    updateMoveButtons();

    /* ---------- размер карточек: тянем за угол ---------- */
    var SPANS_KEY = 'mypult-card-spans';
    var ROWS_KEY = 'mypult-card-rows';

    function loadMap(key) {
      try {
        return JSON.parse(localStorage.getItem(key) || '{}') || {};
      } catch (e) {
        return {};
      }
    }

    function saveMap(key, map) {
      try { localStorage.setItem(key, JSON.stringify(map)); } catch (e) {}
    }

    function minSpan(card) {
      if (card.classList.contains('c-media')) return 5;
      if (card.classList.contains('c-alarm')) return 4;
      if (card.classList.contains('c-radio')) return 4;
      if (card.classList.contains('c-voice')) return 5;
      return 3;
    }

    function contentRows(card) {
      var style = card.style;
      var prevAlign = style.alignSelf;
      var prevHeight = style.height;
      var inner = card.querySelectorAll('.log, .sound-list');
      var prevCaps = [];
      Array.prototype.forEach.call(inner, function (el, index) {
        prevCaps[index] = el.style.maxHeight;
        el.style.maxHeight = (INNER_CAPS[el.classList.contains('log') ? '.log' : '.sound-list']) + 'px';
      });
      style.alignSelf = 'start';
      style.height = 'auto';
      var height = Math.ceil(card.getBoundingClientRect().height);
      style.alignSelf = prevAlign;
      style.height = prevHeight;
      Array.prototype.forEach.call(inner, function (el, index) {
        el.style.maxHeight = prevCaps[index];
      });
      return Math.max(1, Math.ceil((height + PACK_GAP) / (PACK_UNIT + PACK_GAP)));
    }

    function applySizes() {
      var desktop = window.innerWidth > 760;
      var spans = loadMap(SPANS_KEY);
      var rowsMap = loadMap(ROWS_KEY);
      cards.forEach(function (card) {
        var min = minSpan(card);
        var span = desktop ? parseInt(spans[card.dataset.cardId], 10) : 0;
        card.style.gridColumn = (span >= min && span <= 12) ? 'span ' + span : '';
        var rows = desktop ? parseInt(rowsMap[card.dataset.cardId], 10) : 0;
        if (rows >= 1 && rows <= 20) card.dataset.rows = String(rows);
        else delete card.dataset.rows;
      });
    }

    window.PultLayout = {
      mode: function () {
        return window.innerWidth > 760 ? 'wide' : 'phone';
      },
      capture: function () {
        var order = Array.prototype.map.call(
          document.querySelectorAll('main .card'),
          function (card) { return card.dataset.cardId; }
        ).filter(Boolean);
        return {
          order: order,
          spans: loadMap(SPANS_KEY),
          rows: loadMap(ROWS_KEY)
        };
      },
      apply: function (layout) {
        if (!layout) return;
        var byId = {};
        Array.prototype.forEach.call(cards, function (card) {
          if (card.dataset.cardId) byId[card.dataset.cardId] = card;
        });
        var order = Array.isArray(layout.order) ? layout.order : [];
        order.forEach(function (id) {
          var card = byId[id];
          if (card && card.dataset.cardId !== 'providers') main.appendChild(card);
        });
        Array.prototype.forEach.call(cards, function (card) {
          var id = card.dataset.cardId;
          if (id && order.indexOf(id) < 0) main.appendChild(card);
        });
        saveMap(SPANS_KEY, layout.spans || {});
        saveMap(ROWS_KEY, layout.rows || {});
        applySizes();
        saveCardOrder();
        updateMoveButtons();
        schedulePack();
      }
    };

    function beginResize(card, event) {
      if (window.innerWidth <= 760 || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      var grid = card.parentElement;
      var gridStyle = getComputedStyle(grid);
      var columns = (gridStyle.gridTemplateColumns || '').split(' ').filter(Boolean).length || 12;
      var gap = parseFloat(gridStyle.columnGap) || 12;
      var columnWidth = (grid.clientWidth - gap * (columns - 1)) / columns;
      var rect = card.getBoundingClientRect();
      var min = minSpan(card);
      var span = Math.max(min, Math.min(columns,
        Math.round((rect.width + gap) / (columnWidth + gap))));
      var startRows = Math.max(1, Math.round((rect.height + gap) / (PACK_UNIT + PACK_GAP)));
      var startX = event.clientX;
      var startY = event.clientY;
      var startSpan = span;
      var rows = startRows;
      cardResizing = true;
      card.classList.add('resizing');
      document.body.classList.add('card-resizing');

      function onMove(moveEvent) {
        span = Math.max(min, Math.min(columns,
          Math.round(startSpan + (moveEvent.clientX - startX) / (columnWidth + gap))));
        card.style.gridColumn = 'span ' + span;
        var minRows = contentRows(card);
        rows = Math.max(minRows, Math.min(20, Math.round(startRows +
          (moveEvent.clientY - startY) / (PACK_UNIT + PACK_GAP))));
        card.dataset.rows = String(rows);
        card.style.gridRowEnd = 'span ' + rows;
        card.style.height = (rows * (PACK_UNIT + PACK_GAP) - PACK_GAP) + 'px';
      }

      function onUp() {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('pointercancel', onUp);
        card.classList.remove('resizing');
        document.body.classList.remove('card-resizing');
        cardResizing = false;
        card.dataset.forceFit = '1';
        var spans = loadMap(SPANS_KEY);
        spans[card.dataset.cardId] = span;
        saveMap(SPANS_KEY, spans);
        var rowsMap = loadMap(ROWS_KEY);
        rowsMap[card.dataset.cardId] = rows;
        saveMap(ROWS_KEY, rowsMap);
        schedulePack();
      }

      document.addEventListener('pointermove', onMove, { passive: false });
      document.addEventListener('pointerup', onUp);
      document.addEventListener('pointercancel', onUp);
    }

    applySizes();
    window.addEventListener('resize', function () {
      applySizes();
      schedulePack();
    });
    observeCards();

    function clearCardDropTarget() {
      Array.prototype.forEach.call(main.querySelectorAll('.card.drop-before,.card.drop-after'),
        function (card) { card.classList.remove('drop-before', 'drop-after'); });
      State.dropCard = null;
      State.dropAfter = false;
    }

    function cardDropPlacement(card, event) {
      var box = card.getBoundingClientRect();
      var y = event.clientY;
      if (y < box.top + box.height * 0.25) return false;
      if (y > box.top + box.height * 0.75) return true;
      return event.clientX > box.left + box.width / 2;
    }

    function nearestDropTarget(event) {
      var drag = State.dragCard;
      if (!drag) return null;
      var cards = Array.prototype.filter.call(
        main.querySelectorAll('.card[data-group="' + drag.dataset.group + '"]'),
        function (card) {
          return card !== drag && !card.classList.contains('is-hidden') &&
            card.getBoundingClientRect().height > 0;
        });
      var best = null;
      var bestDistance = Infinity;
      cards.forEach(function (card) {
        var box = card.getBoundingClientRect();
        var dx = event.clientX < box.left ? box.left - event.clientX :
          (event.clientX > box.right ? event.clientX - box.right : 0);
        var dy = event.clientY < box.top ? box.top - event.clientY :
          (event.clientY > box.bottom ? event.clientY - box.bottom : 0);
        var distance = dx * dx + dy * dy;
        if (distance < bestDistance) {
          bestDistance = distance;
          best = card;
        }
      });
      if (!best) return null;
      var box = best.getBoundingClientRect();
      var after = event.clientY > box.top + box.height / 2;
      return { card: best, after: after };
    }

    function useDropTarget(target) {
      if (!target || !target.card) return false;
      if (State.dropCard === target.card && State.dropAfter === target.after) return true;
      clearCardDropTarget();
      State.dropCard = target.card;
      State.dropAfter = target.after;
      target.card.classList.add(target.after ? 'drop-after' : 'drop-before');
      return true;
    }

    main.addEventListener('dragover', function (event) {
      if (!State.dragCard) return;
      var card = event.target.closest ? event.target.closest('.card') : null;
      if (card === State.dragCard) card = null;
      if (card && card.dataset.group !== State.dragCard.dataset.group) card = null;
      var target = card
        ? { card: card, after: cardDropPlacement(card, event) }
        : nearestDropTarget(event);
      if (!target) {
        clearCardDropTarget();
        return;
      }
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      useDropTarget(target);
    });
    main.addEventListener('dragleave', function (event) {
      if (!event.relatedTarget || !main.contains(event.relatedTarget)) clearCardDropTarget();
    });
    main.addEventListener('drop', function (event) {
      if (!State.dragCard) return;
      event.preventDefault();
      var card = State.dropCard;
      var after = State.dropAfter;
      if (!card) {
        var target = nearestDropTarget(event);
        card = target && target.card;
        after = target && target.after;
      }
      if (card && card !== State.dragCard &&
          card.dataset.group === State.dragCard.dataset.group) {
        main.insertBefore(State.dragCard, after ? card.nextSibling : card);
      }
      State.dragCard = null;
      clearCardDropTarget();
      saveCardOrder();
      updateMoveButtons();
    });
  }

  function saveCardOrder() {
    var ids = Array.prototype.map.call(document.querySelectorAll('main .card'),
      function (card) { return card.dataset.cardId; }).filter(Boolean);
    try { localStorage.setItem('mypult-cards', JSON.stringify(ids)); } catch (e) {}
  }

  /* ─────────── статус сервисов ─────────── */
  function applyStatusData(data) {
    State.services = data.services || data;
    State.luna = !!data.luna;
    State.glagol = !!data.glagol;
    renderStatus();
    renderServices();
  }

  function refreshStatus() {
    return refreshState();
  }

  /* ─────────── версия ─────────── */
  function loadVersion() {
    return fetch('/version.json', { cache: 'no-store' }).then(function (res) {
      if (!res.ok) throw new Error('нет version.json');
      return res.json();
    }).then(function (data) {
      State.version = data.version || null;
      el.verTag.textContent = 'v' + (data.version || '?');
      el.verLine.textContent = [data.version && ('v' + data.version), data.date]
        .filter(Boolean).join(' · ');
      log('app', 'версия', data.version + ' / ' + data.date);
    }).catch(function () {
      el.verTag.textContent = 'v?';
      log('app', 'version.json недоступен', null, true);
    });
  }

  /* ─────────── возможности модели ─────────── */
  function scTypeAvailable(type) {
    var caps = State.caps || {};
    if ((type.id === 'clock_text' || type.id === 'clock_anim' || type.id === 'clock_anim_stop')
        && caps.display === false) return false;
    if ((type.id === 'led' || type.id === 'led_off') && caps.ring === false) return false;
    return true;
  }

  function applyCaps(caps) {
    State.caps = caps || {};
    var noDisplay = caps.display === false;
    var noRing = caps.ring === false;
    var clock = document.querySelector('.c-clock');
    var led = document.querySelector('.c-led');
    if (clock) clock.hidden = noDisplay;
    if (led) led.hidden = noRing;
    var tab = document.querySelector('.tab[data-tab="display"]');
    if (tab && noDisplay && noRing) tab.hidden = true;
    var banner = el.capsBanner;
    if (banner) {
      var text = caps.note || '';
      if (!text && noDisplay && !noRing) text = 'Дисплей на этой модели не поддерживается.';
      if (!text && noRing && !noDisplay) text = 'Кольцо на этой модели не поддерживается.';
      banner.hidden = !text;
      banner.textContent = text;
    }
    if (el.scType) {
      el.scType.innerHTML = '';
      fillScTypes();
    }
    log('app', 'модель: ' + (caps.kind || '?') + ' · дисплей ' + (noDisplay ? 'нет' : 'да') +
      ' · кольцо ' + (noRing ? 'нет' : 'да'));
  }

  function loadCaps() {
    return cgi('caps.py', {}, { timeout: 15000, silent: true }).then(applyCaps)
      .catch(function () { /* старые сборки без caps.py — молча */ });
  }

  /* ─────────── обновления ─────────── */
  var UPDATE_DISMISS_KEY = 'updateDismissedVersion';
  var UPDATE_PROMPT_KEY = 'updatePrompted';

  function updateDismissed(version) {
    return !!version && String(store.get(UPDATE_DISMISS_KEY, '')) === String(version);
  }

  function formatUpdateTime(seconds) {
    if (!seconds) return '';
    try {
      return new Date(seconds * 1000).toLocaleString('ru-RU', {
        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
      });
    } catch (e) {
      return '';
    }
  }

  function versionCmp(a, b) {
    var left = String(a || '').split('.');
    var right = String(b || '').split('.');
    for (var i = 0; i < 3; i++) {
      var x = parseInt(left[i], 10) || 0;
      var y = parseInt(right[i], 10) || 0;
      if (x !== y) return x - y;
    }
    return 0;
  }

  function renderUpdateInfo(data) {
    State.updateInfo = data || null;
    if (el.updChannel) el.updChannel.value = (data && data.channel) || 'stable';
    var current = (data && data.current) || State.version || '—';
    var installedBeta = !!(data && data.installed_prerelease);
    var downgrade = !!(installedBeta && data && !data.prerelease && data.latest &&
      versionCmp(current, data.latest) > 0);
    el.updCurrent.textContent = 'v' + current + (installedBeta ? ' · бета' : '');
    if (data && data.checked_at) {
      el.updChecked.textContent = 'проверено ' + formatUpdateTime(data.checked_at);
    } else {
      el.updChecked.textContent = '';
    }
    el.btnUpdateApply.disabled = !(data && data.update_available) || State.updateRunning;
    if (!data || !data.update_available) {
      el.updNew.hidden = true;
      el.updHint.textContent = '';
      el.btnUpdateApply.textContent = 'Обновить';
      if (data && data.error) {
        el.updState.textContent = data.error;
      } else if (data && data.latest) {
        el.updState.textContent = versionCmp(current, data.latest) > 0
          ? 'Локально v' + current + ' — новее последнего релиза v' + data.latest
          : 'Установлена последняя версия: v' + data.latest;
      } else {
        el.updState.textContent = 'Проверка недоступна';
      }
      return;
    }
    el.updNew.hidden = false;
    el.updNewTitle.textContent = downgrade
      ? 'Возврат на стабильную версию v' + data.latest +
        (data.published_at ? ' · ' + formatUpdateTime(Date.parse(data.published_at) / 1000) : '')
      : 'Доступна версия v' + data.latest +
        (data.prerelease ? ' (бета)' : '') +
        (data.published_at ? ' · ' + formatUpdateTime(Date.parse(data.published_at) / 1000) : '');
    el.updNotes.textContent = data.body || 'Описание изменений не приложено.';
    el.updState.textContent = downgrade
      ? 'Сейчас бета v' + current + ' · стабильная v' + data.latest
      : 'Есть обновление: v' + current + ' → v' + data.latest;
    el.btnUpdateApply.textContent = downgrade ? 'Вернуться на стабильную' : 'Обновить';
    el.updHint.textContent = updateDismissed(data.latest) ? 'уведомление отключено' : '';
  }

  function showUpdateDialog(data) {
    if (!data || !data.update_available) return;
    State.updateInfo = data;
    el.updateDlgVer.textContent = 'v' + data.latest + (data.prerelease ? ' (бета)' : '');
    el.updateDlgFrom.textContent = 'Сейчас: v' + data.current +
      (data.published_at ? ' · опубликовано ' + formatUpdateTime(Date.parse(data.published_at) / 1000) : '');
    el.updateDlgNotes.textContent = data.body || 'Описание изменений не приложено.';
    el.updateDismiss.checked = updateDismissed(data.latest);
    if (typeof el.updateDlg.showModal === 'function') {
      if (!el.updateDlg.open) el.updateDlg.showModal();
    } else {
      el.updateDlg.setAttribute('open', '');
    }
  }

  function closeUpdateDialog() {
    if (typeof el.updateDlg.close === 'function') {
      try { el.updateDlg.close(); } catch (e) {}
    } else {
      el.updateDlg.removeAttribute('open');
    }
  }

  function maybePromptUpdate(data) {
    if (!data || !data.update_available) return;
    // С беты на более старую стабильную — не навязываем окном, только в карточке.
    if (data.installed_prerelease && !data.prerelease &&
        versionCmp(data.current, data.latest) > 0) return;
    if (updateDismissed(data.latest) || State.updateRunning) return;
    var prompted = store.get(UPDATE_PROMPT_KEY, {}) || {};
    var today = new Date().toISOString().slice(0, 10);
    if (prompted.version === data.latest && prompted.date === today) return;
    store.set(UPDATE_PROMPT_KEY, { version: data.latest, date: today });
    showUpdateDialog(data);
  }

  function loadUpdateInfo(force, manual) {
    el.updState.textContent = force ? 'Проверяю GitHub…' : 'Проверяю обновления…';
    var payload = force ? { check: 1 } : { info: 1 };
    return cgi('update.py', payload, { timeout: 25000, silent: true }).then(function (data) {
      renderUpdateInfo(data);
      if (manual) {
        if (data.update_available) showUpdateDialog(data);
        else toast('Обновлений нет', 'ok');
      } else {
        maybePromptUpdate(data);
      }
      return data;
    }).catch(function (err) {
      el.updState.textContent = 'Не удалось проверить: ' + err.message;
      if (manual) toast('Обновления: ' + err.message, 'bad');
    });
  }

  function setUpdateChannel(value) {
    return cgi('update.py', { channel: value }, { timeout: 25000 }).then(function (data) {
      renderUpdateInfo(data);
      toast(value === 'beta' ? 'Канал: бета' : 'Канал: стабильный', 'ok');
    }).catch(function (err) {
      toast('Канал: ' + err.message, 'bad');
      loadUpdateInfo(true);
    });
  }

  function rollbackUpdate() {
    if (!window.confirm('Откатить последнее обновление? Панель перезапустится.')) return;
    if (State.updateRunning) return;
    State.updateRunning = true;
    el.updState.textContent = 'Запускаю откат…';
    return cgi('update.py', { rollback: 1 }, { timeout: 30000, silent: true })
      .then(function () { pollUpdateStatus(0); })
      .catch(function (err) {
        State.updateRunning = false;
        el.updState.textContent = 'Откат не запущен: ' + err.message;
        toast('Откат: ' + err.message, 'bad');
      });
  }

  function pollUpdateStatus(attempt) {
    return cgi('update.py', { status: 1 }, { timeout: 8000, silent: true }).then(function (data) {
      var status = data.status || {};
      var state = status.state || 'idle';
      if (state === 'done') {
        el.updState.textContent = (status.rolled_back ? 'Откат выполнен' : 'Обновление установлено')
          + '. Перезагружаю панель…';
        setTimeout(function () { location.reload(); }, 2400);
        return;
      }
      if (state === 'error') {
        State.updateRunning = false;
        el.btnUpdateApply.disabled = false;
        el.updState.textContent = 'Ошибка обновления: ' + (status.error || 'неизвестно') +
          (status.rolled_back ? ' · выполнен откат' : '');
        toast('Обновление не установлено', 'bad');
        return;
      }
      if (state === 'queued' || state === 'downloading' || state === 'installing' || state === 'rollback') {
        el.updState.textContent = status.message ||
          (state === 'downloading' ? 'Скачиваю архив…' : 'Устанавливаю…');
        window.setTimeout(function () { pollUpdateStatus(attempt + 1); }, 2500);
        return;
      }
      // После перезапуска lighttpd статус может быть временно недоступен.
      if (State.updateRunning) {
        if (attempt < 30) window.setTimeout(function () { pollUpdateStatus(attempt + 1); }, 2500);
        else {
          State.updateRunning = false;
          el.btnUpdateApply.disabled = false;
          el.updState.textContent = 'Панель перезапускается. Проверьте обновление вручную.';
        }
      }
    }).catch(function () {
      if (State.updateRunning && attempt < 30) {
        window.setTimeout(function () { pollUpdateStatus(attempt + 1); }, 2500);
      } else if (State.updateRunning) {
        State.updateRunning = false;
        el.btnUpdateApply.disabled = false;
        el.updState.textContent = 'Панель перезапускается. Проверьте обновление вручную.';
      }
    });
  }

  function startUpdate() {
    if (State.updateRunning) return;
    var info = State.updateInfo;
    if (!info || !info.update_available) {
      toast('Нет доступного обновления', 'warn');
      return;
    }
    if (el.updateDismiss.checked) store.set(UPDATE_DISMISS_KEY, info.latest);
    closeUpdateDialog();
    State.updateRunning = true;
    el.btnUpdateApply.disabled = true;
    el.updState.textContent = 'Запускаю обновление…';
    return cgi('update.py', { apply: 1 }, { timeout: 20000, silent: true }).then(function () {
      pollUpdateStatus(0);
    }).catch(function (err) {
      State.updateRunning = false;
      el.btnUpdateApply.disabled = false;
      el.updState.textContent = 'Не удалось запустить: ' + err.message;
      toast('Обновление: ' + err.message, 'bad');
    });
  }

  /* ─────────── привязка ─────────── */
  function bind() {
    el.btnDebug.addEventListener('click', function () {
      renderServices();
      if (typeof el.debugDlg.showModal === 'function') el.debugDlg.showModal();
      else el.debugDlg.setAttribute('open', '');
    });
    el.btnFaq.addEventListener('click', function () {
      if (typeof el.faqDlg.showModal === 'function') el.faqDlg.showModal();
      else el.faqDlg.setAttribute('open', '');
    });
    el.btnCloseFaq.addEventListener('click', function () { el.faqDlg.close(); });
    el.faqDlg.addEventListener('click', function (event) {
      if (event.target !== el.faqDlg) return;
      var rect = el.faqDlg.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right ||
          event.clientY < rect.top || event.clientY > rect.bottom) {
        el.faqDlg.close();
      }
    });
    el.btnCloseDebug.addEventListener('click', function () { el.debugDlg.close(); });
    el.btnTheme.addEventListener('click', function () {
      var light = !document.body.classList.contains('light');
      document.body.classList.toggle('light', light);
      document.documentElement.classList.toggle('light-scroll', light);
      try { localStorage.setItem('mypult-theme', light ? 'light' : 'dark'); } catch (e) {}
      el.btnTheme.textContent = light ? '☾' : '☼';
      el.btnTheme.setAttribute('aria-label', light ? 'Тёмная тема' : 'Светлая тема');
    });
    el.btnRefreshStatus.addEventListener('click', function () {
      withBusy(el.btnRefreshStatus, refreshStatus);
    });
    el.btnDiag.addEventListener('click', function () {
      withBusy(el.btnDiag, function () {
        return cgi('diag.py', {}, { timeout: 30000, silent: true }).then(function (data) {
          el.diagBox.hidden = false;
          el.diagBox.textContent = JSON.stringify(data, null, 2);
          log('diag', 'пробы выполнены', { ports: (data.ports || []).length });
        }).catch(function (err) {
          el.diagBox.hidden = false;
          el.diagBox.textContent = 'Ошибка диагностики: ' + err.message;
        });
      });
    });

    /* дисплей */
    el.btnDisplayReset.addEventListener('click', resetDisplay);
    el.btnRingReset.addEventListener('click', resetRing);
    el.btnRingAnimPlay.addEventListener('click', function () { playRingAnim(); });
    el.btnRingAnimStop.addEventListener('click', stopRingAnim);
    if (el.btnRingRestoreHidden) {
      el.btnRingRestoreHidden.addEventListener('click', restoreRingAnims);
    }
    if (el.btnRingEditor) {
      el.btnRingEditor.addEventListener('click', openRingEditor);      el.btnRingEditorClose.addEventListener('click', function () {
        if (el.ringEditorDlg) el.ringEditorDlg.close();
      });
      el.btnRingEditorAdd.addEventListener('click', function () {
        ringEditorFrames.splice(ringEditorIndex + 1, 0, ringEditorNewFrame());
        ringEditorIndex += 1;
        ringEditorPaint();
        ringEditorRenderFrames();
      });
      el.btnRingEditorDup.addEventListener('click', function () {
        ringEditorFrames.splice(ringEditorIndex + 1, 0,
          ringEditorFrames[ringEditorIndex].slice());
        ringEditorIndex += 1;
        ringEditorPaint();
        ringEditorRenderFrames();
      });
      el.btnRingEditorDelFrame.addEventListener('click', function () {
        if (ringEditorFrames.length <= 1) return;
        ringEditorFrames.splice(ringEditorIndex, 1);
        ringEditorIndex = Math.max(0, ringEditorIndex - 1);
        ringEditorPaint();
        ringEditorRenderFrames();
      });
      el.btnRingEditorFill.addEventListener('click', function () {
        ringEditorFrames[ringEditorIndex] = new Array(24).fill(ringEditorColor.replace('#', ''));
        ringEditorPaint();
      });
      el.btnRingEditorClear.addEventListener('click', function () {
        ringEditorFrames[ringEditorIndex] = ringEditorNewFrame();
        ringEditorPaint();
      });
      el.ringEditorColor.addEventListener('input', function () {
        ringEditorColor = el.ringEditorColor.value || '#00e676';
      });
      el.btnRingEditorSave.addEventListener('click', saveRingEditor);
      el.btnRingEditorPlay.addEventListener('click', function () {
        if (!ringEditorName) {
          toast('Сначала сохраните анимацию', 'warn');
          return;
        }
        playRingAnim(ringEditorName);
      });
      el.btnRingEditorDelete.addEventListener('click', function () {
        if (!ringEditorName) return;
        askConfirm('Удалить анимацию кольца «' + ringEditorName + '»?',
          { yes: 'Удалить' }).then(function (ok) {
          if (ok) ringEditorDelete(ringEditorName);
        });
      });
    }
    el.btnRingPick.addEventListener('click', function (ev) {
      ev.stopPropagation();
      toggleRingPick(el.ringPickPop.hidden);
    });
    el.ringSearch.addEventListener('input', filterRingAnims);
    el.ringPickPop.addEventListener('click', function (ev) { ev.stopPropagation(); });
    // Попап вне карточки: иначе transform/animation карточки делает fixed
    // относительным её самой и список «улетает» в сторону.
    document.body.appendChild(el.ringPickPop);
    document.addEventListener('click', function (ev) {
      if (!ev.target.closest('.ring-picker') && !ev.target.closest('#ringPickPop')) {
        toggleRingPick(false);
      }
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && el.ringPickPop && !el.ringPickPop.hidden) {
        toggleRingPick(false);
        el.btnRingPick.focus();
      }
    });
    el.btnScreenOff.addEventListener('click', function () {
      withBusy(el.btnScreenOff, function () {
        return sendDisplayOff().then(function () {
          startDisplayOff();
          toast('Экран выключен', 'ok');
        });
      });
    });
    el.brightness.addEventListener('input', function () {
      if (State.displayAuto) disableDisplayAuto();
      applyBrightness(el.brightness.value, true);
    });
    el.ringBrightness.addEventListener('input', function () {
      if (State.ringAuto) disableRingAuto();
      setRingBrightness(el.ringBrightness.value, true);
    });
    el.ringSpeed.addEventListener('input', function () {
      setRingSpeed(el.ringSpeed.value);
    });
    el.brightChips.addEventListener('click', function (ev) {
      var chip = ev.target.closest('.chip');
      if (!chip || !chip.dataset.bright) return;
      if (State.displayAuto) disableDisplayAuto();
      applyBrightness(chip.dataset.bright, true);
    });

    /* рисование на дисплее */
    el.btnDraw.addEventListener('click', function () {
      if (State.drawing) exitDrawMode();
      else enterDrawMode();
    });
    el.btnSegSend.addEventListener('click', sendDrawing);
    el.btnSegClear.addEventListener('click', clearPattern);
    el.btnSegDone.addEventListener('click', exitDrawMode);
    el.btnDisplayText.addEventListener('click', sendDisplayText);
    el.btnClockBack.addEventListener('click', returnClock);
    el.displayText.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        el.btnDisplayText.click();
      }
    });
    el.displayText.addEventListener('input', function () {
      if (this.value.length > 32) this.value = this.value.slice(0, 32);
    });

    /* кольцо */
    el.colorPicker.addEventListener('input', function () {
      if (!applySelected(el.colorPicker.value)) {
        applyColor(el.colorPicker.value, 'solid');
      }
    });
    el.colorPicker.addEventListener('change', function () {
      if (!applySelected(el.colorPicker.value)) {
        applyColor(el.colorPicker.value, 'solid');
      }
    });
    el.presets.addEventListener('click', function (ev) {
      var chip = ev.target.closest('.chip');
      if (!chip) return;
      if (chip.dataset.mode === 'wave' || chip.dataset.mode === 'candle') {
        startLedAnimation(chip.dataset.mode);
        return;
      }
      State.selected = null;
      ringDots.forEach(function (dot) { dot.classList.remove('sel'); });
      el.ledHint.textContent = 'Нажмите на диод, чтобы задать ему свой цвет';
      if (chip.dataset.mode) applyColor(State.color, chip.dataset.mode);
      else if (chip.dataset.hex) applyColor(chip.dataset.hex, 'solid');
    });
    el.btnLedOff.addEventListener('click', function () {
      withBusy(el.btnLedOff, function () {
        // Сначала останавливаем всё локально: JS-волну/свечу, превью
        // редактора и аппаратный проигрыватель.
        stopLedAnimation();
        State.ringPreview = null;
        State.ringAnimName = null;
        State.ringOffAt = Date.now();
        State.hwActive = false;
        State.hwLast = '';
        State.hwHoldUntil = Date.now() + 1500;
        State.ledMode = 'off';
        store.set('ledMode', 'off');
        State.selected = null;
        ringDots.forEach(function (dot) { dot.classList.remove('sel'); });
        markRingAnim(null);
        el.ledHint.textContent = 'Кольцо выключено';
        paintOff();
        markActiveChip();
        ringOffBurst();
        // И только потом гасим led_util и сам слой Luna. ring_anim_stop
        // обязателен: luna /api/led/off/ring не убивает процесс led_util,
        // поэтому анимация из редактора продолжала идти.
        return cgi('display.py', { ring_anim_stop: 1 }, { timeout: 8000, silent: true })
          .catch(function () { /* уже остановлено / нечего останавливать */ })
          .then(function () { return luna('/api/led/off/ring', {}); })
          .then(function () { toast('Кольцо погашено', 'ok'); });
      }).catch(function (err) { toast('Кольцо: ' + err.message, 'bad'); });
    });

    /* плеер */
    el.btnPrev.addEventListener('click', function () { mediaAction('prev'); });
    el.btnNext.addEventListener('click', function () { mediaAction('next'); });
    el.btnMusic.addEventListener('click', function () { mediaAction('music'); });
    el.btnLyrics.addEventListener('click', function () { openLyrics(false); });
    if (el.btnLyricsClose) el.btnLyricsClose.addEventListener('click', closeLyricsDialog);
    if (el.lyricsDlg) el.lyricsDlg.addEventListener('cancel', function (event) {
      event.preventDefault();
      closeLyricsDialog();
    });
    if (el.btnLike) el.btnLike.addEventListener('click', toggleLike);
    if (el.btnDislike) el.btnDislike.addEventListener('click', dislikeTrack);
    if (el.lyricsInline) {
      State.lyricsInline = !!store.get('lyricsInline');
      el.lyricsInline.checked = State.lyricsInline;
      el.lyricsInline.addEventListener('change', function () {
        setLyricsInline(el.lyricsInline.checked);
      });
    }
    if (el.btnAlarmAdd) el.btnAlarmAdd.addEventListener('click', function (event) {
      event.preventDefault();
      alarmAdd();
    });
    if (el.btnAlarmOpen) el.btnAlarmOpen.addEventListener('click', function () {
      setAlarmMode(State.alarmMode || 'radio');
      setAlarmRepeat(State.alarmRepeat);
      if (el.alarmDlg) el.alarmDlg.showModal();
      buildAlarmTimeLists();
      renderAlarmTime();
      closeAlarmTime();
      loadAlarmStations();
      loadAlarmSounds();
    });
    if (el.btnAlarmTime) el.btnAlarmTime.addEventListener('click', function (event) {
      event.stopPropagation();
      if (el.alarmTimePop && el.alarmTimePop.hidden) openAlarmTime();
      else closeAlarmTime();
    });
    if (el.btnAlarmTimeDone) el.btnAlarmTimeDone.addEventListener('click', closeAlarmTime);
    if (el.alarmTimePop) el.alarmTimePop.addEventListener('click', function (event) {
      event.stopPropagation();
    });
    if (el.btnAlarmStation) el.btnAlarmStation.addEventListener('click', function (event) {
      event.stopPropagation();
      if (el.alarmStationList) el.alarmStationList.hidden = !el.alarmStationList.hidden;
    });
    if (el.btnAlarmSound) el.btnAlarmSound.addEventListener('click', function (event) {
      event.stopPropagation();
      if (el.alarmSoundList) el.alarmSoundList.hidden = !el.alarmSoundList.hidden;
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-amode]'), function (button) {
      button.addEventListener('click', function () { setAlarmMode(button.dataset.amode); });
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-repeat]'), function (button) {
      button.addEventListener('click', function () {
        setAlarmRepeat(button.dataset.repeat === '1');
      });
    });
    if (el.btnAlarmClose) el.btnAlarmClose.addEventListener('click', function () {
      if (el.alarmDlg) el.alarmDlg.close();
    });
    if (el.alarmDlg) {
      el.alarmDlg.addEventListener('click', function (event) {
        if (event.target === el.alarmDlg) el.alarmDlg.close();
        if (el.alarmStationList) el.alarmStationList.hidden = true;
        closeAlarmTime();
      });
      el.alarmDlg.addEventListener('close', function () {
        if (el.alarmStationList) el.alarmStationList.hidden = true;
        closeAlarmTime();
      });
    }
    if (el.btnAlarmDismiss) el.btnAlarmDismiss.addEventListener('click', alarmDismiss);
    if (el.btnAlarmSnooze) el.btnAlarmSnooze.addEventListener('click', alarmSnooze);
    if (el.alarmVolume) el.alarmVolume.addEventListener('input', function () {
      if (el.alarmVolumeVal) el.alarmVolumeVal.textContent = el.alarmVolume.value + '%';
    });
    [el.lyricsDlg, el.queueDlg].forEach(function (dialog) {
      if (!dialog) return;
      dialog.addEventListener('click', function (event) {
        if (event.target === dialog) dialog.close();
      });
    });
    if (el.btnQueue) el.btnQueue.addEventListener('click', function () { openQueue(false); });
    if (el.btnQueueClose) el.btnQueueClose.addEventListener('click', function () {
      if (el.queueDlg) el.queueDlg.close();
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-qtab]'), function (button) {
      button.addEventListener('click', function () { loadQueueTab(button.dataset.qtab); });
    });
    if (el.lyricsBox) {
      el.lyricsBox.addEventListener('click', function (event) {
        var line = event.target.closest('.line');
        if (!line) return;
        var moment = parseFloat(line.dataset.t);
        var duration = State.mediaDuration || 0;
        if (isNaN(moment) || !duration) return;
        seekMedia((moment / duration) * 1000);
      });
    }
    if (el.lyricsDlg) {
      el.lyricsDlg.addEventListener('close', function () {
        if (el.lyricsBox) el.lyricsBox.style.transform = '';
        updateInlineLine();
      });
    }
    el.mediaSeek.addEventListener('input', function () {
      State.seeking = true;
      var duration = State.mediaDuration || 0;
      var position = (el.mediaSeek.value / 1000) * duration;
      el.mediaPos.textContent = fmtTime(position);
    });
    el.mediaSeek.addEventListener('change', function () {
      seekMedia(parseInt(el.mediaSeek.value, 10) || 0);
    });
    // Если перетаскивание прервалось без change, снимаем «seeking», иначе
    // ползунок перестанет обновляться.
    ['pointerup', 'pointercancel', 'blur'].forEach(function (name) {
      el.mediaSeek.addEventListener(name, function () {
        setTimeout(function () { State.seeking = false; }, 0);
      });
    });
    el.btnPlay.addEventListener('click', function () {
      mediaAction(State.playing ? 'pause' : 'play');
    });
    el.volume.addEventListener('pointerdown', function () {
      State.volumeDragging = true;
    });
    el.volume.addEventListener('pointerup', endVolumeDrag);
    el.volume.addEventListener('pointercancel', endVolumeDrag);
    el.volume.addEventListener('blur', endVolumeDrag);
    el.volume.addEventListener('input', function () {
      State.volumeDragging = true;
      setVolumeUI(parseInt(el.volume.value, 10), true);
      el.volumeVal.textContent = State.volume + '%';
      pushVolume();
      endVolumeDrag();
    });
    el.btnVolUp.addEventListener('click', function () {
      setVolumeUI(State.volume + 5);
      pushVolume();
    });
    el.btnVolDown.addEventListener('click', function () {
      setVolumeUI(State.volume - 5);
      pushVolume();
    });
    el.btnMute.addEventListener('click', function () {
      var payload = State.muted ? { unmute: 1 } : { mute: 1 };
      withBusy(el.btnMute, function () {
        return cgi('volume.py', payload, { timeout: 9000 }).then(function (data) {
          State.muted = !!(data && data.muted);
          el.btnMute.setAttribute('aria-pressed', State.muted ? 'true' : 'false');
          updateVolumeIcons();
          if (data && typeof data.level === 'number') setVolumeUI(data.level);
          toast(State.muted ? 'Звук выключен (0%)' : ('Звук включён' +
            (data && data.level ? ' · ' + data.level + '%' : '')), 'ok');
        }).catch(function (err) { toast('Mute: ' + err.message, 'bad'); });
      });
    });

    /* голос: настройки и текстовая команда */
    if (el.btnSendCmd) el.btnSendCmd.addEventListener('click', function () {
      var value = el.command.value;
      sendCommand(value).then(function () { el.command.value = ''; });
    });
    if (el.command) el.command.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        if (el.btnSendCmd) el.btnSendCmd.click();
      }
    });

    /* озвучка */
    el.ttsText.addEventListener('input', function () {
      el.ttsCount.textContent = el.ttsText.value.length;
    });
    el.btnSay.addEventListener('click', say);
    el.btnTtsClear.addEventListener('click', function () {
      el.ttsText.value = '';
      el.ttsCount.textContent = '0';
      el.ttsText.focus();
    });
    el.ttsChips.addEventListener('click', function (ev) {
      var chip = ev.target.closest('.chip');
      if (!chip || !chip.dataset.text) return;
      el.ttsText.value = chip.dataset.text;
      el.ttsCount.textContent = el.ttsText.value.length;
      el.ttsText.focus();
    });

    /* нейросеть */
    el.llmProfiles.addEventListener('click', function (ev) {
      var chip = ev.target.closest('.chip');
      if (chip && chip.dataset.id) selectProfile(chip.dataset.id);
    });
    el.btnLlmNew.addEventListener('click', newProfile);
    el.llmEnabled.addEventListener('change', toggleLlmEnabled);
    el.btnChatPrev.addEventListener('click', function () { switchChat({ chat_prev: 1 }); });
    el.btnChatNext.addEventListener('click', function () { switchChat({ chat_next: 1 }); });
    el.btnChatNew.addEventListener('click', function () { switchChat({ chat_new: 1 }); });
    if (el.llmHistoryBox) {
      el.btnChatHistoryRefresh.addEventListener('click', function () {
        withBusy(el.btnChatHistoryRefresh, function () { return loadChatHistory(true); });
      });
      every(15000, pollChatHistory);
    }
    el.btnChatRename.addEventListener('click', openChatRename);
    el.btnChatRenameYes.addEventListener('click', saveChatRename);
    el.btnChatRenameNo.addEventListener('click', closeChatRename);
    el.chatRenameDlg.addEventListener('cancel', function (ev) {
      ev.preventDefault();
      closeChatRename();
    });
    el.chatRenameInput.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        saveChatRename();
      }
    });
    if (el.llmChat) el.llmChat.addEventListener('dblclick', openChatRename);
    el.btnChatDel.addEventListener('click', function () {
      var active = State.llm && State.llm.activeChat;
      if (!active) return;
      askConfirm('Удалить текущий чат вместе с историей?', { yes: 'Удалить чат' }).then(function (ok) {
        if (ok) switchChat({ chat_delete: active });
      });
    });
    el.llmLength.addEventListener('change', function () {
      var value = parseInt(el.llmLength.value, 10) || 260;
      return cgi('llm.py', { max_tokens: value }, { timeout: 10000 }).then(function (data) {
        applyLlmInfo(data);
        toast('Длина ответа: ' + el.llmLength.options[el.llmLength.selectedIndex].text, 'ok');
      }).catch(function (err) { toast('Длина ответа: ' + err.message, 'bad'); });
    });
    el.llmProviderSelect.addEventListener('change', function () {
      selectProvider(el.llmProviderSelect.value);
    });
    el.llmModel.addEventListener('change', toggleCustomModel);
    el.btnLlmSave.addEventListener('click', saveLlm);
    el.btnLlmSystem.addEventListener('click', saveLlmSystem);
    if (el.btnLlmContext) el.btnLlmContext.addEventListener('click', saveLlmContext);
    el.btnLlmAsk.addEventListener('click', function () { askLlm(false); });
    if (el.btnLlmAskSay) {
      el.btnLlmAskSay.addEventListener('click', function () { askLlm(true); });
    }
    el.llmSearch.addEventListener('change', toggleLlmSearch);
    el.llmFollowUp.addEventListener('change', toggleFollowUp);
    el.btnLlmSearchUrl.addEventListener('click', saveLlmSearchUrl);
    el.llmSearchUrl.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        saveLlmSearchUrl();
      }
    });
    el.llmPrompt.addEventListener('keydown', function (ev) {
      if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') {
        ev.preventDefault();
        if (ev.shiftKey && el.btnLlmAskSay) el.btnLlmAskSay.click();
        else el.btnLlmAsk.click();
      }
    });

    /* VPN */
    el.btnVpnSave.addEventListener('click', saveVpn);
    el.btnVpnToggle.addEventListener('click', toggleVpn);
    el.vpnUrl.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        el.btnVpnSave.click();
      }
    });
    el.vpnAutostart.addEventListener('change', function () {
      var on = el.vpnAutostart.checked ? 1 : 0;
      cgi('vpn.py', { autostart: on }, { timeout: 15000 }).then(function (data) {
        renderVpn(data);
        toast(on ? 'VPN будет включаться при загрузке' : 'Автозапуск VPN выключен', 'ok');
      }).catch(function (err) {
        el.vpnAutostart.checked = !el.vpnAutostart.checked;
        toast('VPN: ' + err.message, 'bad');
      });
    });

    /* голосовой демон */
    el.btnVoiceDaemon.addEventListener('click', toggleVoiceDaemon);
    if (el.voiceIdleMode) {
      el.voiceIdleMode.addEventListener('change', function () {
        setVoiceIdleMode(this.value);
      });
    }
    if (el.voiceMicMode) {
      el.voiceMicMode.addEventListener('change', function () {
        setVoiceMicMode(this.value);
      });
    }
    if (el.voiceMusicVoice) {
      el.voiceMusicVoice.addEventListener('change', function () {
        setVoiceMusicVoice(this.value === 'on');
      });
    }
    if (el.voiceMusicDefault) {
      el.voiceMusicDefault.addEventListener('change', function () {
        setVoiceMusicDefault(this.value);
      });
    }

    /* индикация панели */
    if (el.panelBright) {
      el.panelBright.addEventListener('input', function () {
        el.panelBrightVal.textContent = this.value + ' / ' + this.max;
      });
      el.panelBright.addEventListener('change', function () {
        setPanel({ brightness: parseInt(this.value, 10) || 0 });
      });
    }
    if (el.btnPanelOff) {
      el.btnPanelOff.addEventListener('click', function () { setPanel({ off: 1 }); });
    }
    if (el.btnPanelRestore) {
      el.btnPanelRestore.addEventListener('click', function () { setPanel({ restore: 1 }); });
    }

    /* радио */
    el.btnRadioPick.addEventListener('click', function (ev) {
      ev.stopPropagation();
      toggleRadioPop(el.radioPop.hidden);
    });
    el.radioSearch.addEventListener('input', filterRadio);
    el.radioPop.addEventListener('click', function (ev) { ev.stopPropagation(); });
    // Попап вне карточки: иначе он попадает в scrollHeight и карточка растёт
    // при каждом открытии списка станций.
    document.body.appendChild(el.radioPop);
    window.addEventListener('resize', function () {
      if (!el.radioPop.hidden) placeRadioPop();
    });
    document.addEventListener('scroll', function () {
      if (!el.radioPop.hidden) placeRadioPop();
    }, true);
    document.addEventListener('click', function (ev) {
      if (!ev.target.closest('.radio-picker') && !ev.target.closest('#radioPop')) {
        toggleRadioPop(false);
      }
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && el.radioPop && !el.radioPop.hidden) {
        toggleRadioPop(false);
        el.btnRadioPick.focus();
      }
    });
    el.radioChips.addEventListener('click', function (ev) {
      var option = ev.target.closest('.radio-option');
      if (!option || option.dataset.index === undefined) return;
      toggleRadioPop(false);
      playRadio(parseInt(option.dataset.index, 10));
    });
    el.btnRadioPrev.addEventListener('click', function () { stepRadio(-1); });
    el.btnRadioNext.addEventListener('click', function () { stepRadio(1); });
    el.btnRadioStop.addEventListener('click', stopRadio);
    el.btnRadioAdd.addEventListener('click', addRadio);
    el.btnRadioStream.addEventListener('click', addRadioStream);
    el.radioName.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        addRadio();
      }
    });
    el.radioUrl.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        addRadioStream();
      }
    });

    /* bluetooth и сеть */
    el.btnBtPower.addEventListener('click', function () {
      btAction({ action: 'power', on: (State.bt && State.bt.powered) ? 0 : 1 });
    });
    el.btnBtPairMode.addEventListener('click', function () {
      btAction({ action: 'discoverable', on: (State.bt && State.bt.discoverable) ? 0 : 1 });
    });
    el.btnBtScan.addEventListener('click', btScan);
    el.btnNetScan.addEventListener('click', netScan);
    el.btnNetDns.addEventListener('click', netDnsApply);
    el.btnNetDnsReset.addEventListener('click', netDnsReset);
    el.netIpv6.addEventListener('change', toggleIpv6);

    /* zigbee */
    el.btnZbSend.addEventListener('click', sendZb);
    el.zbCommand.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        sendZb();
      }
    });

    /* сценарии */
    el.btnScAddAction.addEventListener('click', function () { addScRow(el.scType.value); });
    el.btnScSave.addEventListener('click', saveScenario);
    el.btnScClear.addEventListener('click', clearScenarioEditor);
    el.btnDaysWork.addEventListener('click', function () { el.scDays.value = '1-5'; });
    el.btnDaysAll.addEventListener('click', function () { el.scDays.value = '1-7'; });
    el.btnDaysWeekend.addEventListener('click', function () { el.scDays.value = '6-7'; });

    /* логи */
    el.btnLogs.addEventListener('click', loadLogs);
    el.logName.addEventListener('change', loadLogs);

    if (el.btnFilesOpen) el.btnFilesOpen.addEventListener('click', filesOpen);
    if (el.btnZvukSave) el.btnZvukSave.addEventListener('click', zvukSaveToken);
    if (el.btnZvukClear) el.btnZvukClear.addEventListener('click', function () {
      cgi('zvuk.py', { action: 'clear' }, { timeout: 12000 }).then(function () {
        zvukSetStatus('Нужен токен — анонимно только 30 секунд'); zvukShowNow(null);
      }).catch(function (err) { zvukSetStatus('Ошибка: ' + err.message, 'bad'); });
    });
    if (el.btnZvukSearch) el.btnZvukSearch.addEventListener('click', zvukSearch);
    if (el.btnZvukWave) el.btnZvukWave.addEventListener('click', zvukWave);
    if (el.btnZvukSite) el.btnZvukSite.addEventListener('click', function () {
      window.open('https://zvuk.com/', '_blank', 'noopener');
    });
    if (el.btnZvukProfile) el.btnZvukProfile.addEventListener('click', function () {
      window.open('https://zvuk.com/api/tiny/profile', '_blank', 'noopener');
    });
    if (el.zvukQuery) el.zvukQuery.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') { event.preventDefault(); zvukSearch(); }
    });
    if (el.btnYoutubeSearch) el.btnYoutubeSearch.addEventListener('click', youtubeSearch);
    if (el.youtubeQuery) el.youtubeQuery.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') { event.preventDefault(); youtubeSearch(); }
    });
    if (el.btnSpotifySave) el.btnSpotifySave.addEventListener('click', spotifySave);
    if (el.btnSpotifyClear) el.btnSpotifyClear.addEventListener('click', function () {
      cgi('spotify.py', { action: 'clear' }, { timeout: 12000 }).then(function () {
        extStatus(el.spotifyStatus, 'Ключи удалены');
      }).catch(function (err) { extStatus(el.spotifyStatus, 'Ошибка: ' + err.message, 'bad'); });
    });
    if (el.btnSpotifySearch) el.btnSpotifySearch.addEventListener('click', spotifySearch);
    if (el.spotifyQuery) el.spotifyQuery.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') { event.preventDefault(); spotifySearch(); }
    });
    if (el.btnSoundcloudSearch) el.btnSoundcloudSearch.addEventListener('click', soundcloudSearch);
    if (el.soundcloudQuery) el.soundcloudQuery.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') { event.preventDefault(); soundcloudSearch(); }
    });
    if (el.btnExtSearch) el.btnExtSearch.addEventListener('click', extSearch);
    if (el.extQuery) el.extQuery.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') { event.preventDefault(); extSearch(); }
    });
    zvukLoadStatus();
    extLoadStatus();
    spotifyLoadStatus();
    initProviders();
    if (el.btnFilesClose) el.btnFilesClose.addEventListener('click', function () { el.filesDlg.close(); });
    if (el.btnFilesRefresh) el.btnFilesRefresh.addEventListener('click', function () { filesLoad(filesCurrent); });
    if (el.btnFilesUp) el.btnFilesUp.addEventListener('click', function () {
      cgi('files.py', { action: 'list', path: filesCurrent }, { timeout: 15000, silent: true })
        .then(function (data) { if (data.parent) filesLoad(data.parent); })
        .catch(function (err) { toast('Файлы: ' + err.message, 'bad'); });
    });
    if (el.btnFilesGo) el.btnFilesGo.addEventListener('click', function () { filesLoad(el.filesPath.value.trim()); });
    if (el.filesPath) el.filesPath.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') { event.preventDefault(); filesLoad(el.filesPath.value.trim()); }
    });
    if (el.btnFilesMkdir) el.btnFilesMkdir.addEventListener('click', filesMkdir);
    if (el.filesUpload) el.filesUpload.addEventListener('change', function () {
      filesUploadFile(el.filesUpload.files && el.filesUpload.files[0]);
      el.filesUpload.value = '';
    });
    if (el.btnFilesSave) el.btnFilesSave.addEventListener('click', filesSave);
    if (el.btnFilesRename) el.btnFilesRename.addEventListener('click', filesRename);
    if (el.btnFilesEditorClose) el.btnFilesEditorClose.addEventListener('click', filesCloseEditor);
    if (el.filesDlg) el.filesDlg.addEventListener('click', function (event) {
      if (event.target !== el.filesDlg) return;
      var rect = el.filesDlg.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right ||
          event.clientY < rect.top || event.clientY > rect.bottom) el.filesDlg.close();
    });

    /* обслуживание */
    el.btnNetcheck.addEventListener('click', runNetcheck);
    el.btnSpeed.addEventListener('click', runSpeed);
    el.btnCleanup.addEventListener('click', runCleanup);
    el.btnReboot.addEventListener('click', doReboot);
    el.btnCloseReboot.addEventListener('click', function () {
      if (el.rebootDlg && el.rebootDlg.open) el.rebootDlg.close();
    });
    el.btnPoweroff.addEventListener('click', doPoweroff);
    el.autoBright.addEventListener('change', toggleAutoBright);
    el.displayAuto.addEventListener('change', toggleDisplayAuto);
    if (el.btnDisplayCurve) el.btnDisplayCurve.addEventListener('click', curveOpen);
    if (el.btnCurveClose) el.btnCurveClose.addEventListener('click', curveClose);
    if (el.btnCurveAdd) el.btnCurveAdd.addEventListener('click', curveAdd);
    if (el.btnCurveReset) el.btnCurveReset.addEventListener('click', curveReset);
    if (el.btnCurveSave) el.btnCurveSave.addEventListener('click', curveSave);
    el.btnBackup.addEventListener('click', downloadBackup);
    el.btnUpdateCheck.addEventListener('click', function () { loadUpdateInfo(true, true); });
    if (el.updChannel) {
      el.updChannel.addEventListener('change', function () {
        var value = this.value;
        if (value === 'beta' && !window.confirm(
          'Бета-канал: сборки могут быть нестабильными и ломать панель. ' +
          'Вернуться на стабильную версию можно в любой момент. Включить?')) {
          this.value = 'stable';
          return;
        }
        setUpdateChannel(value);
      });
    }
    if (el.btnUpdateRollback) {
      el.btnUpdateRollback.addEventListener('click', rollbackUpdate);
    }
    if (el.btnUpdLocal) {
      el.btnUpdLocal.addEventListener('click', function () {
        var path = (el.updLocalPath.value || '').trim();
        if (!path) {
          el.updLocalPath.focus();
          toast('Укажите путь к архиву в /tmp', 'warn');
          return;
        }
        el.btnUpdLocal.disabled = true;
        el.updLocalHint.textContent = 'Запускаю установку из файла…';
        State.updateRunning = true;
        cgi('update.py', { install_local: path }, { timeout: 20000, silent: true })
          .then(function () {
            el.btnUpdLocal.disabled = false;
            pollUpdateStatus(0);
          })
          .catch(function (err) {
            State.updateRunning = false;
            el.btnUpdLocal.disabled = false;
            el.updLocalHint.textContent = 'Не удалось: ' + err.message;
            toast('Установка: ' + err.message, 'bad');
          });
      });
    }
    el.btnUpdateApply.addEventListener('click', startUpdate);
    el.btnUpdateDlgYes.addEventListener('click', startUpdate);
    el.btnUpdateLater.addEventListener('click', closeUpdateDialog);
    el.btnUpdateDlgNo.addEventListener('click', closeUpdateDialog);
    el.updateDismiss.addEventListener('change', function () {
      var info = State.updateInfo;
      if (!info || !info.latest) return;
      store.set(UPDATE_DISMISS_KEY, el.updateDismiss.checked ? info.latest : '');
      if (el.updHint) {
        el.updHint.textContent = el.updateDismiss.checked ? 'уведомление отключено' : '';
      }
    });
    el.backupFile.addEventListener('change', function () {
      if (el.backupFile.files && el.backupFile.files[0]) restoreBackup(el.backupFile.files[0]);
      el.backupFile.value = '';
    });
    el.btnSoundRefresh.addEventListener('click', loadSounds);
    el.btnSoundBackup.addEventListener('click', function () {
      window.location.href = '/cgi-bin/sounds.py?zip=1';
    });
    el.soundFile.addEventListener('change', function () {
      var file = el.soundFile.files && el.soundFile.files[0];
      var target = State.soundTarget;
      el.soundFile.value = '';
      if (file && target) uploadSound(file, target);
    });
    el.btnCustomSound.addEventListener('click', function () {
      if (!(el.customSoundName.value || '').trim()) {
        toast('Сначала введите название звука', 'warn');
        el.customSoundName.focus();
        return;
      }
      el.customSoundFile.value = '';
      el.customSoundFile.click();
    });
    el.customSoundFile.addEventListener('change', function () {
      var file = el.customSoundFile.files && el.customSoundFile.files[0];
      el.customSoundFile.value = '';
      if (file) uploadCustomSound(file);
    });
    el.soundGroup.addEventListener('change', renderSounds);
    el.soundSearch.addEventListener('input', renderSounds);
    el.soundDrop.addEventListener('dragover', function (ev) {
      ev.preventDefault();
      el.soundDrop.classList.add('drag');
    });
    el.soundDrop.addEventListener('dragleave', function () {
      el.soundDrop.classList.remove('drag');
    });
    el.soundDrop.addEventListener('drop', function (ev) {
      ev.preventDefault();
      el.soundDrop.classList.remove('drag');
      var file = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
      if (file) uploadCustomSound(file);
    });
    el.btnPinEnable.addEventListener('click', enablePin);
    el.btnPinDisable.addEventListener('click', disablePin);
    el.btnPinLock.addEventListener('click', lockPanel);
    el.btnPinLogin.addEventListener('click', loginPin);
    el.pinInput.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') loginPin();
    });

    /* разделы */
    el.tabs.addEventListener('click', function (ev) {
      var btn = ev.target.closest('.tab');
      if (btn && btn.dataset.tab) showTab(btn.dataset.tab);
    });
    window.addEventListener('hashchange', function () {
      var name = (location.hash || '').replace('#', '');
      if (name) showTab(name, false);
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.target && ev.target.matches && ev.target.matches('input, textarea, select')) return;
      var index = parseInt(ev.key, 10);
      if (index >= 1 && index <= TABS.length) showTab(TABS[index - 1]);
    });

    /* мобильная клавиатура не должна закрывать поле раньше времени */
    el.ttsText.addEventListener('keydown', function (ev) {
      if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') {
        ev.preventDefault();
        el.btnSay.click();
      }
    });

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) refreshStatus();
    });
  }

  /* ─────────── инициализация ─────────── */
  function buildRing() {
    for (var i = 0; i < 24; i++) {
      var dot = document.createElement('b');
      dot.style.setProperty('--i', i);
      (function (index) {
        dot.addEventListener('click', function () { selectLed(index); });
      })(i);
      el.ringDots.appendChild(dot);
      ringDots.push(dot);
    }
  }

  function restore() {
    var color = store.get('color', '#00E676');
    if (!/^#[0-9a-f]{6}$/i.test(color)) color = '#00E676';
    State.color = color.toUpperCase();
    State.brightness = clamp(parseInt(store.get('brightness', 170), 10) || 170, 10, 255);
    State.volume = clamp(parseInt(store.get('volume', 40), 10) || 0, 0, 100);

    var savedColors = store.get('ledColors', null);
    if (Array.isArray(savedColors) && savedColors.length === 24 &&
        savedColors.every(function (c) { return typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c); })) {
      State.ledColors = savedColors.map(function (c) { return c.toUpperCase(); });
    } else {
      State.ledColors = new Array(24).fill(State.color);
    }

    el.colorPicker.value = State.color.toLowerCase();
    el.colorCode.textContent = State.color;
    applyBrightness(State.brightness, false);
    setVolumeUI(State.volume);

    // Luna не умеет отдавать состояние кольца, поэтому восстанавливаем
    // последний известный режим — но только если пользователь его выбирал.
    // Иначе дефолтный зелёный (#00E676) зажигал кольцо при каждом открытии
    // панели, и оно горело, пока не нажмёшь «Выключить».
    var mode = store.get('ledMode', null);
    if (!mode) {
      State.ledMode = 'off';
      el.ledHint.textContent = 'кольцо не менялось';
    } else if (mode === 'off') {
      State.ledMode = 'off';
      paintOff();
      el.ledHint.textContent = 'Кольцо выключено';
    } else if (mode === 'custom') {
      State.ledMode = 'custom';
      paintRing(State.ledColors);
    } else if (mode === 'wave' || mode === 'candle') {
      State.ledMode = mode;
      paintRing(composeColors());
      startLedAnimation(mode);
    } else if (mode === 'anim') {
      State.ledMode = 'anim';
    } else {
      State.ledMode = mode;
      paintRing(composeColors());
    }
    markActiveChip();
  }

  /* ─────────── главная: 3D-станция ─────────── */
  var homeRingDots = [];
  var homeRingAngle = 0;

  function drawHomeScreen() {
    var canvas = document.getElementById('homeScreen');
    if (!canvas) return;
    if (canvas.width !== 512) {
      canvas.width = 512;
      canvas.height = 128;
    }
    var ctx = canvas.getContext('2d');
    var now = new Date();
    var text = (now.getHours() < 10 ? '0' : '') + now.getHours() +
      (now.getMinutes() < 10 ? '0' : '') + now.getMinutes();
    var masks = { '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc',
      '5': 'afgcd', '6': 'afgedc', '7': 'abc', '8': 'abcdefg', '9': 'abfgcd' };
    ctx.clearRect(0, 0, 512, 128);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 8;
    ctx.strokeStyle = '#f4f1ff';
    ctx.shadowColor = 'rgba(170,145,255,.95)';
    ctx.shadowBlur = 10;
    function seg(x, y, w, h, name) {
      var p = {
        a: [x + 7, y + 4, x + w - 7, y + 4],
        b: [x + w - 4, y + 11, x + w - 4, y + h / 2 - 6],
        c: [x + w - 4, y + h / 2 + 6, x + w - 4, y + h - 11],
        d: [x + 7, y + h - 4, x + w - 7, y + h - 4],
        e: [x + 4, y + h / 2 + 6, x + 4, y + h - 11],
        f: [x + 4, y + 11, x + 4, y + h / 2 - 6],
        g: [x + 7, y + h / 2, x + w - 7, y + h / 2]
      }[name];
      ctx.beginPath();
      ctx.moveTo(p[0], p[1]);
      ctx.lineTo(p[2], p[3]);
      ctx.stroke();
    }
    var xs = [66, 150, 304, 388];
    var frame = State.modelFrame;
    for (var i = 0; i < 4; i++) {
      var mask = frame ? (frame[i] || '') : (masks[text.charAt(i)] || '');
      for (var s = 0; s < mask.length; s++) seg(xs[i], 20, 58, 92, mask.charAt(s));
    }
    ctx.beginPath();
    ctx.arc(268, 48, 6, 0, Math.PI * 2);
    ctx.arc(268, 82, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#f4f1ff';
    ctx.fill();
    ctx.shadowBlur = 0;
    uploadHomeTexture();
    var gltfState = window.__stationGLTF;
    if (gltfState && gltfState.screenTexture) gltfState.screenTexture.needsUpdate = true;
  }

  function uploadHomeTexture() {
    var state = window.__stationGL;
    if (!state || !state.gl || !state.texture) return;
    var gl = state.gl;
    var canvas = document.getElementById('homeScreen');
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, state.texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
  }

  function initStationGLTF() {
    if (!window.THREE || !THREE.GLTFLoader) return false;
    var canvas = document.getElementById('stationGL');
    var stage = document.getElementById('stationStage');
    if (!canvas || !stage) return false;
    var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.setSize(stage.clientWidth || 600, stage.clientHeight || 500, false);
    if (THREE.sRGBEncoding) renderer.outputEncoding = THREE.sRGBEncoding;
    if (THREE.ACESFilmicToneMapping) renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.92;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(34, (stage.clientWidth || 600) / (stage.clientHeight || 500), 0.1, 100);
    scene.add(new THREE.HemisphereLight(0xdedbff, 0x101116, 0.7));
    var key = new THREE.DirectionalLight(0xfff5e8, 1.25);
    key.position.set(2.8, 4.5, 3.8);
    key.castShadow = true;
    scene.add(key);
    var fill = new THREE.DirectionalLight(0xdfe3ff, 0.35);
    fill.position.set(-3.5, 1.2, 2.2);
    scene.add(fill);
    var rim = new THREE.DirectionalLight(0xffffff, 0.3);
    rim.position.set(0, 2.5, -4.5);
    scene.add(rim);
    var state = { renderer: renderer, scene: scene, camera: camera, model: null,
      screenMesh: null, screenPlane: null, ringMaterials: [],
      yaw: 0.44, pitch: 0.16, distance: 6.55 };
    window.__stationGLTF = state;
    var drag = null;
    stage.addEventListener('pointerdown', function (event) {
      drag = { x: event.clientX, y: event.clientY, yaw: state.yaw, pitch: state.pitch };
      setPullRefresh(false);
      try { stage.setPointerCapture(event.pointerId); } catch (e) {}
    });
    stage.addEventListener('pointermove', function (event) {
      if (!drag) return;
      state.yaw = drag.yaw - (event.clientX - drag.x) * 0.007;
      state.pitch = Math.max(-0.25, Math.min(0.7, drag.pitch + (event.clientY - drag.y) * 0.004));
    });
    stage.addEventListener('pointerup', function () { drag = null; setPullRefresh(true); });
    stage.addEventListener('pointercancel', function () { drag = null; setPullRefresh(true); });
    stage.addEventListener('lostpointercapture', function () { drag = null; setPullRefresh(true); });
    stage.addEventListener('dblclick', function () { state.yaw = 0.44; state.pitch = 0.16; });
    function resize() {
      var w = stage.clientWidth || 600;
      var h = stage.clientHeight || 500;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    if (window.ResizeObserver) new ResizeObserver(resize).observe(stage);
    else window.addEventListener('resize', resize);
    var loader = new THREE.GLTFLoader();
    loader.load('assets/scene.gltf', function (gltf) {
      var model = gltf.scene;
      scene.add(model);
      model.updateMatrixWorld(true);
      var screenMesh = null;
      var ringMesh = null;
      var ringMaterials = [];
      var bodyBox = new THREE.Box3();
      var bodyNodes = [];
      var bodyMaterials = [];
      var hasBody = false;
      var fc = document.createElement('canvas');
      fc.width = 256;
      fc.height = 256;
      var fx = fc.getContext('2d');
      fx.fillStyle = '#7b7e88';
      fx.fillRect(0, 0, 256, 256);
      for (var fy = 0; fy < 256; fy += 4) {
        fx.fillStyle = fy % 8 === 0 ? 'rgba(255,255,255,.025)' : 'rgba(0,0,0,.10)';
        fx.fillRect(0, fy, 256, 1);
      }
      for (var fxx = 0; fxx < 256; fxx += 4) {
        fx.fillStyle = fxx % 8 === 0 ? 'rgba(255,255,255,.018)' : 'rgba(0,0,0,.09)';
        fx.fillRect(fxx, 0, 1, 256);
      }
      var fseed = 987654321;
      for (var fn = 0; fn < 8000; fn++) {
        fseed = (fseed * 1664525 + 1013904223) >>> 0;
        var nx = fseed % 256;
        fseed = (fseed * 1664525 + 1013904223) >>> 0;
        var ny = fseed % 256;
        fx.fillStyle = (fseed & 1) ? 'rgba(255,255,255,.006)' : 'rgba(0,0,0,.045)';
        fx.fillRect(nx, ny, 1, 1);
      }
      var fabricTex = new THREE.CanvasTexture(fc);
      fabricTex.wrapS = THREE.RepeatWrapping;
      fabricTex.wrapT = THREE.RepeatWrapping;
      fabricTex.repeat.set(2, 2);
      if (THREE.sRGBEncoding) fabricTex.encoding = THREE.sRGBEncoding;
      model.traverse(function (node) {
        if (!node.isMesh) return;
        node.castShadow = true;
        node.receiveShadow = true;
        var mats = Array.isArray(node.material) ? node.material : [node.material];
        var name = (mats[0] && mats[0].name) || '';
        mats.forEach(function (mat) {
          if (!mat) return;
          mat.side = THREE.FrontSide;
          if (name === '.002') ringMaterials.push(mat);
          if (mat.emissive) {
            var lum = mat.emissive.r + mat.emissive.g + mat.emissive.b;
            if (lum > 0.25) ringMaterials.push(mat);
          }
        });
        if (name === 'material' || name === 'Материал') screenMesh = node;
        if (name === '.002') ringMesh = node;
        if (name === '.001' || name === 'Material') {
          mats.forEach(function (mat) {
            if (!mat) return;
            mat.map = fabricTex;
            mat.color.setHex(0x33363e);
            mat.roughness = 0.95;
            mat.metalness = 0.0;
            mat.onBeforeCompile = function (shader) {
              shader.vertexShader = 'varying float vMypultBodyY;\n' +
                shader.vertexShader.replace('#include <begin_vertex>',
                  '#include <begin_vertex>\n' +
                  'vMypultBodyY = (modelMatrix * vec4(transformed, 1.0)).y;');
              shader.fragmentShader = 'varying float vMypultBodyY;\n' +
                shader.fragmentShader.replace('#include <color_fragment>',
                  '#include <color_fragment>\n' +
                  'diffuseColor.rgb = mix(vec3(0.02, 0.021, 0.025), diffuseColor.rgb, ' +
                  'step(vMypultBodyY, 1.02));');
            };
            mat.customProgramCacheKey = function () { return 'mypult-body-upper-black'; };
            mat.needsUpdate = true;
            bodyMaterials.push(mat);
          });
          bodyBox.expandByObject(node);
          bodyNodes.push(node);
          hasBody = true;
        }
      });
      if (!hasBody) bodyBox.setFromObject(model);
      var size = new THREE.Vector3();
      bodyBox.getSize(size);
      var scale = 2.15 / Math.max(size.y, 0.001);
      model.scale.setScalar(scale);
      model.updateMatrixWorld(true);
      bodyBox.makeEmpty();
      if (bodyNodes.length) {
        bodyNodes.forEach(function (node) { bodyBox.expandByObject(node); });
      } else {
        bodyBox.setFromObject(model);
      }
      var center = new THREE.Vector3();
      bodyBox.getCenter(center);
      model.position.x -= center.x;
      model.position.y -= center.y;
      model.position.z -= center.z;
      model.updateMatrixWorld(true);
      bodyBox.makeEmpty();
      if (bodyNodes.length) bodyNodes.forEach(function (node) { bodyBox.expandByObject(node); });
      state.model = model;
      state.screenMesh = screenMesh;
      state.ringMaterials = ringMaterials;
      State.bodyMaterials = bodyMaterials;
      applyStationColor();
      if (ringMesh) {
        model.updateMatrixWorld(true);
        var bsize = new THREE.Vector3();
        var bcenter = new THREE.Vector3();
        bodyBox.getSize(bsize);
        bodyBox.getCenter(bcenter);
        var ringGeo = ringMesh.geometry;
        ringMesh.visible = true;
        var ringColors = new Float32Array(ringGeo.attributes.position.count * 3);
        ringGeo.setAttribute('color', new THREE.BufferAttribute(ringColors, 3));
        ringMesh.material = new THREE.MeshBasicMaterial({
          vertexColors: true, side: THREE.DoubleSide,
          transparent: true, toneMapped: false
        });
        state.ringMesh = ringMesh;

        var logoCanvas = document.createElement('canvas');
        logoCanvas.width = 512;
        logoCanvas.height = 512;
        var lctx = logoCanvas.getContext('2d');
        lctx.clearRect(0, 0, 512, 512);
        var glow = lctx.createRadialGradient(256, 256, 90, 256, 256, 250);
        glow.addColorStop(0, 'rgba(190,130,255,.42)');
        glow.addColorStop(0.55, 'rgba(150,90,255,.16)');
        glow.addColorStop(1, 'rgba(120,70,255,0)');
        lctx.fillStyle = glow;
        lctx.fillRect(0, 0, 512, 512);
        lctx.shadowColor = 'rgba(196,145,255,.55)';
        lctx.shadowBlur = 12;
        lctx.fillStyle = '#c084fc';
        function plectrum(ctx, scale) {
          ctx.save();
          ctx.translate(256, 256);
          ctx.scale(scale, scale);
          ctx.translate(-256, -256);
          ctx.beginPath();
          ctx.moveTo(256, 116);
          ctx.quadraticCurveTo(284, 116, 302, 160);
          ctx.lineTo(369, 332);
          ctx.quadraticCurveTo(383, 370, 345, 378);
          ctx.lineTo(167, 378);
          ctx.quadraticCurveTo(129, 370, 143, 332);
          ctx.lineTo(210, 160);
          ctx.quadraticCurveTo(228, 116, 256, 116);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
        lctx.fillStyle = '#c084fc';
        lctx.beginPath();
        lctx.arc(256, 256, 136, 0, Math.PI * 2);
        lctx.fill();
        lctx.shadowBlur = 0;
        lctx.fillStyle = '#17131f';
        plectrum(lctx, 0.56);
        var logoTex = new THREE.CanvasTexture(logoCanvas);
        logoTex.minFilter = THREE.LinearFilter;
        if (THREE.sRGBEncoding) logoTex.encoding = THREE.sRGBEncoding;
        var logoPlane = new THREE.Mesh(
          new THREE.PlaneGeometry(0.9, 0.9),
          new THREE.MeshBasicMaterial({ map: logoTex, transparent: true,
            depthWrite: false, side: THREE.DoubleSide })
        );
        logoPlane.position.set(bcenter.x, bodyBox.max.y + 0.008, bcenter.z);
        logoPlane.rotation.x = -Math.PI / 2;
        logoPlane.renderOrder = 8;
        scene.add(logoPlane);
        state.logoPlane = logoPlane;
        var backZ = bodyBox.min.z - 0.012;
        function roundRectPath(ctx, x, y, w, h, r) {
          ctx.beginPath();
          ctx.moveTo(x + r, y);
          ctx.arcTo(x + w, y, x + w, y + h, r);
          ctx.arcTo(x + w, y + h, x, y + h, r);
          ctx.arcTo(x, y + h, x, y, r);
          ctx.arcTo(x, y, x + w, y, r);
          ctx.closePath();
        }
        var muteCanvas = document.createElement('canvas');
        muteCanvas.width = 512;
        muteCanvas.height = 192;
        var mctx = muteCanvas.getContext('2d');
        mctx.clearRect(0, 0, 512, 192);
        mctx.shadowColor = 'rgba(0,0,0,.7)';
        mctx.shadowBlur = 18;
        mctx.fillStyle = '#111318';
        roundRectPath(mctx, 40, 46, 432, 100, 44);
        mctx.fill();
        mctx.shadowBlur = 0;
        mctx.strokeStyle = 'rgba(255,255,255,.18)';
        mctx.lineWidth = 2;
        mctx.stroke();
        mctx.fillStyle = '#d8d9df';
        roundRectPath(mctx, 244, 62, 24, 58, 12);
        mctx.fill();
        mctx.strokeStyle = '#d8d9df';
        mctx.lineWidth = 5;
        mctx.lineCap = 'round';
        mctx.beginPath();
        mctx.arc(256, 116, 32, 0, Math.PI);
        mctx.stroke();
        mctx.beginPath();
        mctx.moveTo(256, 148);
        mctx.lineTo(256, 160);
        mctx.moveTo(238, 162);
        mctx.lineTo(274, 162);
        mctx.stroke();
        var muteTex = new THREE.CanvasTexture(muteCanvas);
        muteTex.minFilter = THREE.LinearFilter;
        if (THREE.sRGBEncoding) muteTex.encoding = THREE.sRGBEncoding;
        var mutePlane = new THREE.Mesh(
          new THREE.PlaneGeometry(0.46, 0.17),
          new THREE.MeshBasicMaterial({ map: muteTex, transparent: true,
            depthWrite: false, side: THREE.DoubleSide })
        );
        mutePlane.position.set(bcenter.x, bodyBox.max.y - 0.48, backZ);
        mutePlane.rotation.y = Math.PI;
        mutePlane.renderOrder = 6;
        scene.add(mutePlane);

        var usbCanvas = document.createElement('canvas');
        usbCanvas.width = 256;
        usbCanvas.height = 128;
        var uctx = usbCanvas.getContext('2d');
        uctx.clearRect(0, 0, 256, 128);
        uctx.fillStyle = '#0b0d11';
        roundRectPath(uctx, 56, 40, 144, 48, 22);
        uctx.fill();
        uctx.strokeStyle = 'rgba(255,255,255,.26)';
        uctx.lineWidth = 3;
        uctx.stroke();
        uctx.fillStyle = '#2b2e36';
        roundRectPath(uctx, 74, 54, 108, 20, 10);
        uctx.fill();
        var usbTex = new THREE.CanvasTexture(usbCanvas);
        usbTex.minFilter = THREE.LinearFilter;
        if (THREE.sRGBEncoding) usbTex.encoding = THREE.sRGBEncoding;
        var usbPlane = new THREE.Mesh(
          new THREE.PlaneGeometry(0.24, 0.12),
          new THREE.MeshBasicMaterial({ map: usbTex, transparent: true,
            depthWrite: false, side: THREE.DoubleSide })
        );
        usbPlane.position.set(bcenter.x, bodyBox.min.y + 0.44, backZ);
        usbPlane.rotation.y = Math.PI;
        usbPlane.renderOrder = 6;
        scene.add(usbPlane);
      }
      if (screenMesh) {
        model.updateMatrixWorld(true);
        var sbox = new THREE.Box3().setFromObject(screenMesh);
        var ssize = new THREE.Vector3();
        var scenter = new THREE.Vector3();
        sbox.getSize(ssize);
        sbox.getCenter(scenter);
        var normal = new THREE.Vector3(0, 0, 1)
          .applyQuaternion(screenMesh.getWorldQuaternion(new THREE.Quaternion())).normalize();
        screenMesh.visible = false;
        var texture = new THREE.CanvasTexture(document.getElementById('homeScreen'));
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        var plane = new THREE.Mesh(
          new THREE.PlaneGeometry(Math.max(ssize.x * 1.65, 1.0), Math.max(ssize.x * 1.65, 1.0) / 4),
          new THREE.MeshBasicMaterial({ map: texture, transparent: true,
            blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
            polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
        );
        plane.position.set(bcenter.x, scenter.y, bodyBox.max.z + 0.002);
        plane.rotation.set(0, 0, 0);
        plane.renderOrder = 5;
        scene.add(plane);
        state.screenPlane = plane;
        state.screenTexture = texture;
      }
      stage.classList.add('gl-on');
      var last = 0;
      function frame(now) {
        requestAnimationFrame(frame);
        if (document.hidden || now - last < 33) return;
        last = now;
        camera.position.set(
          Math.sin(state.yaw) * state.distance,
          0.35 + Math.sin(state.pitch) * state.distance,
          Math.cos(state.yaw) * state.distance
        );
        camera.lookAt(0, 0, 0);
        renderer.render(scene, camera);
      }
      requestAnimationFrame(frame);
      drawHomeScreen();
      syncHomeRing();
      everyHome(1000, drawHomeScreen);
      everyHome(130, syncHomeRing);
    }, undefined, function (error) {
      console.warn('GLTF load failed', error);
      stage.classList.remove('gl-on');
    });
    return true;
  }

  function initStationGL() {
    var canvas = document.getElementById('stationGL');
    var stage = document.getElementById('stationStage');
    if (!canvas || !stage) return false;
    var gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false, antialias: true });
    if (!gl) return false;
    function compile(type, source) {
      var shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return null;
      return shader;
    }
    var vs = compile(gl.VERTEX_SHADER,
      'attribute vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }');
    var fs = compile(gl.FRAGMENT_SHADER, [
      'precision highp float;',
      'uniform vec2 u_res; uniform vec2 u_rot; uniform vec3 u_ring; uniform sampler2D u_screen; uniform sampler2D u_fabric;',
      'const vec3 B = vec3(0.48, 0.55, 0.48);',
      'vec3 fabricAt(vec2 uv){ vec3 c = texture2D(u_fabric, uv + 0.5).rgb; return c; }',
      'float sdRound(vec3 p){ vec3 q = abs(p) - B + 0.14;',
      '  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - 0.14; }',
      'vec3 calcNormal(vec3 p){ vec2 e = vec2(0.0015, 0.0);',
      '  return normalize(vec3(sdRound(p+e.xyy)-sdRound(p-e.xyy),',
      '    sdRound(p+e.yxy)-sdRound(p-e.yxy), sdRound(p+e.yyx)-sdRound(p-e.yyx))); }',
      'void main(){',
      '  vec2 uv = (gl_FragCoord.xy / u_res) * 2.0 - 1.0;',
      '  uv.x *= u_res.x / u_res.y;',
      '  vec3 ro = vec3(sin(u_rot.x) * 1.55, 0.60 + u_rot.y, cos(u_rot.x) * 1.55);',
      '  vec3 ta = vec3(0.0);',
      '  vec3 ww = normalize(ta - ro);',
      '  vec3 uu = normalize(cross(ww, vec3(0.0, 1.0, 0.0)));',
      '  vec3 vv = cross(uu, ww);',
      '  vec3 rd = normalize(uv.x * uu + uv.y * vv + 1.20 * ww);',
      '  float t = 0.05; bool hit = false;',
      '  for (int i = 0; i < 96; i++) {',
      '    float d = sdRound(ro + rd * t);',
      '    if (d < 0.001) { hit = true; break; }',
      '    t += d; if (t > 7.0) break;',
      '  }',
      '  if (!hit) { gl_FragColor = vec4(0.0); return; }',
      '  vec3 p = ro + rd * t; vec3 n = calcNormal(p);',
      '  vec3 L = normalize(vec3(-0.55, 0.85, 0.65));',
      '  float diff = max(dot(n, L), 0.0);',
      '  vec3 col = vec3(0.055, 0.058, 0.066);',
      '  if (n.y > 0.55) {',
      '    col = vec3(0.018, 0.020, 0.025);',
      '    float m = max(abs(p.x), abs(p.z));',
      '    float ring = smoothstep(0.355, 0.37, m) * (1.0 - smoothstep(0.415, 0.44, m));',
      '    float glow = exp(-pow((m - 0.395) / 0.035, 2.0));',
      '    col += u_ring * (ring * 1.05 + glow * 0.14);',
      '    float cm = length(vec2(p.x / 0.065, p.z / 0.036));',
      '    col += u_ring * smoothstep(1.0, 0.75, cm) * 0.55;',
      '    float spec = pow(max(dot(reflect(-L, n), -rd), 0.0), 36.0);',
      '    col += vec3(spec * 0.35);',
      '  } else if (n.z < -0.55) {',
      '    col = fabricAt(p.xy) * vec3(0.62, 0.64, 0.68);',
      '    float mute = length(vec2(p.x / 0.115, (p.y - 0.34) / 0.038));',
      '    if (mute < 1.0) col = vec3(0.008, 0.009, 0.012);',
      '    if (mute < 0.55 && abs(p.x) < 0.008 && abs(p.y - 0.34) < 0.012) col = vec3(0.55);',
      '    float usb = length(vec2(p.x / 0.07, (p.y + 0.44) / 0.018));',
      '    if (usb < 1.0) col = vec3(0.003);',
      '  } else if (n.z > 0.55) {',
      '    col = fabricAt(p.xy) * vec3(0.65, 0.67, 0.70);',
      '    vec2 suv = vec2((p.x + 0.32) / 0.64, (p.y - 0.02) / 0.22);',
      '    if (suv.x > 0.0 && suv.x < 1.0 && suv.y > 0.0 && suv.y < 1.0) {',
      '      vec4 sc = texture2D(u_screen, suv);',
      '      col = mix(col, sc.rgb, sc.a);',
      '    }',
      '  } else {',
      '    vec2 q = abs(n.x) > 0.5 ? p.zy : p.xy;',
      '    col = fabricAt(q) * vec3(0.58, 0.60, 0.64);',
      '  }',
      '  float spec = pow(max(dot(reflect(-L, n), -rd), 0.0), 24.0);',
      '  col *= 0.52 + 0.62 * diff;',
      '  col += spec * 0.15;',
      '  float rim = pow(1.0 - max(dot(n, -rd), 0.0), 2.0);',
      '  col += u_ring * rim * 0.035;',
      '  col *= mix(0.55, 1.0, smoothstep(-0.55, 0.0, p.y));',
      '  gl_FragColor = vec4(pow(col, vec3(0.92)), 1.0);',
      '}'
    ].join('\n'));
    if (!vs || !fs) return false;
    var program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return false;
    gl.useProgram(program);
    var buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(program, 'a');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    var texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    var fabricCanvas = document.createElement('canvas');
    fabricCanvas.width = 512;
    fabricCanvas.height = 512;
    var fctx = fabricCanvas.getContext('2d');
    fctx.fillStyle = '#34373e';
    fctx.fillRect(0, 0, 512, 512);
    for (var fy = 0; fy < 512; fy += 3) {
      fctx.fillStyle = fy % 8 === 0 ? 'rgba(255,255,255,.09)' : 'rgba(0,0,0,.20)';
      fctx.fillRect(0, fy, 512, 1);
    }
    for (var fx = 0; fx < 512; fx += 3) {
      fctx.fillStyle = fx % 8 === 0 ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.15)';
      fctx.fillRect(fx, 0, 1, 512);
    }
    fctx.strokeStyle = 'rgba(255,255,255,.035)';
    fctx.lineWidth = 1;
    for (var fd = -512; fd < 512; fd += 11) {
      fctx.beginPath();
      fctx.moveTo(fd, 0);
      fctx.lineTo(fd + 512, 512);
      fctx.stroke();
    }
    var noiseSeed = 12345;
    for (var fn = 0; fn < 24000; fn++) {
      noiseSeed = (noiseSeed * 1664525 + 1013904223) >>> 0;
      var nx = noiseSeed % 512;
      noiseSeed = (noiseSeed * 1664525 + 1013904223) >>> 0;
      var ny = noiseSeed % 512;
      fctx.fillStyle = (noiseSeed & 1)
        ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.12)';
      fctx.fillRect(nx, ny, 1, 1);
    }
    var fabric = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, fabric);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, fabricCanvas);
    var state = {
      gl: gl, program: program, texture: texture, fabric: fabric,
      uRes: gl.getUniformLocation(program, 'u_res'),
      uRot: gl.getUniformLocation(program, 'u_rot'),
      uRing: gl.getUniformLocation(program, 'u_ring'),
      uScreen: gl.getUniformLocation(program, 'u_screen'),
      uFabric: gl.getUniformLocation(program, 'u_fabric'),
      ring: [0.55, 0.36, 0.96], yaw: 0.42, pitch: 0.24
    };
    window.__stationGL = state;
    gl.clearColor(0, 0, 0, 0);
    gl.uniform1i(state.uScreen, 0);
    gl.uniform1i(state.uFabric, 1);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, fabric);
    gl.activeTexture(gl.TEXTURE0);
    drawHomeScreen();
    stage.classList.add('gl-on');
    var drag = null;
    stage.addEventListener('pointerdown', function (event) {
      drag = { x: event.clientX, y: event.clientY, yaw: state.yaw, pitch: state.pitch };
      setPullRefresh(false);
      try { stage.setPointerCapture(event.pointerId); } catch (e) {}
    });
    stage.addEventListener('pointermove', function (event) {
      if (!drag) return;
      state.yaw = drag.yaw - (event.clientX - drag.x) * 0.005;
      state.pitch = Math.max(-0.08, Math.min(0.42, drag.pitch + (event.clientY - drag.y) * 0.003));
    });
    stage.addEventListener('pointerup', function () { drag = null; setPullRefresh(true); });
    stage.addEventListener('pointercancel', function () { drag = null; setPullRefresh(true); });
    stage.addEventListener('lostpointercapture', function () { drag = null; setPullRefresh(true); });
    stage.addEventListener('dblclick', function () { state.yaw = 0.42; state.pitch = 0.24; });
    function resize() {
      var rect = stage.getBoundingClientRect();
      var dpr = Math.min(window.devicePixelRatio || 1, 1.75);
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
    }
    resize();
    if (window.ResizeObserver) new ResizeObserver(resize).observe(stage);
    else window.addEventListener('resize', resize);
    var last = 0;
    function frame(now) {
      requestAnimationFrame(frame);
      if (document.hidden || now - last < 33) return;
      last = now;
      if (canvas.width !== Math.round(stage.getBoundingClientRect().width * Math.min(window.devicePixelRatio || 1, 1.75))) {
        resize();
      }
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, fabric);
      gl.uniform2f(state.uRes, canvas.width, canvas.height);
      gl.uniform2f(state.uRot, state.yaw, state.pitch);
      gl.uniform3f(state.uRing, state.ring[0], state.ring[1], state.ring[2]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    requestAnimationFrame(frame);
    return true;
  }

  function syncHomeRing() {
    var ring = document.getElementById('homeRing');
    var off = State.ledMode === 'off' && !State.ringPreview && !State.hwActive;
    var color = '';
    if (!off) {
      for (var i = 0; i < ringDots.length; i++) {
        var bg = ringDots[i] && ringDots[i].style.background;
        if (bg && bg !== 'transparent' && bg !== '#171b26' && bg !== '#16352a') {
          color = bg;
          break;
        }
      }
    }
    if (!color) color = '#8b5cf6';
    if (ring) {
      ring.style.borderColor = color;
      ring.style.opacity = off ? '.55' : '1';
      ring.style.boxShadow = 'inset 0 0 12px ' + color + '40,0 0 14px ' + color + '80';
    }
    var rgb = [0.55, 0.36, 0.96];
    if (color.charAt(0) === '#') {
      rgb = [parseInt(color.slice(1, 3), 16) / 255,
        parseInt(color.slice(3, 5), 16) / 255,
        parseInt(color.slice(5, 7), 16) / 255];
    } else {
      var match = color.match(/\d+/g);
      if (match && match.length >= 3) {
        rgb = [Number(match[0]) / 255, Number(match[1]) / 255, Number(match[2]) / 255];
      }
    }
    var glState = window.__stationGL;
    if (glState) {
      glState.ring = rgb;
    }
    var gltfState = window.__stationGLTF;
    if (gltfState && gltfState.ringMaterials) {
      gltfState.ringMaterials.forEach(function (material) {
        if (material.emissive) {
          material.emissive.setRGB(rgb[0], rgb[1], rgb[2]);
          material.emissiveIntensity = off ? 0.8 : 6.0;
          if ('toneMapped' in material) material.toneMapped = false;
          material.needsUpdate = true;
        }
        if (material.color) {
          material.color.setRGB(rgb[0] * 0.5, rgb[1] * 0.5, rgb[2] * 0.5);
        }
      });
    }
    if (gltfState && gltfState.ringTube) {
      gltfState.ringTube.color.setRGB(rgb[0], rgb[1], rgb[2]);
      gltfState.ringTube.opacity = off ? 0.45 : 1;
      gltfState.ringTube.transparent = true;
    }
    if (gltfState && gltfState.ringMesh) {
      var colors24 = [];
      for (var ri = 0; ri < 24; ri++) {
        var dotColor = !off && ringDots[ri] ? ringDots[ri].style.background : '';
        var cr = [0.55, 0.36, 0.96];
        if (dotColor && dotColor.charAt(0) === '#') {
          cr = [parseInt(dotColor.slice(1, 3), 16) / 255,
            parseInt(dotColor.slice(3, 5), 16) / 255,
            parseInt(dotColor.slice(5, 7), 16) / 255];
        } else if (dotColor) {
          var cm = dotColor.match(/\d+/g);
          if (cm && cm.length >= 3) cr = [cm[0] / 255, cm[1] / 255, cm[2] / 255];
        }
        if (off) cr = [0.018, 0.019, 0.022];
        colors24.push(cr);
      }
      var geom = gltfState.ringMesh.geometry;
      var pos = geom.attributes.position;
      var col = geom.attributes.color;
      for (var vi = 0; vi < pos.count; vi++) {
        var vx = pos.getX(vi);
        var vz = pos.getZ(vi);
        var at = (Math.atan2(vz, vx) / (Math.PI * 2) + 1) % 1;
        var fidx = at * 24;
        var i0 = Math.floor(fidx) % 24;
        var i1 = (i0 + 1) % 24;
        var frac = fidx - Math.floor(fidx);
        var c0 = colors24[i0];
        var c1 = colors24[i1];
        col.setXYZ(vi,
          c0[0] + (c1[0] - c0[0]) * frac,
          c0[1] + (c1[1] - c0[1]) * frac,
          c0[2] + (c1[2] - c0[2]) * frac);
      }
      col.needsUpdate = true;
      gltfState.ringMesh.visible = true;
      gltfState.ringMesh.material.opacity = 1;
    }
    if (gltfState && gltfState.ringBand) {
      gltfState.ringBand.color.setRGB(rgb[0], rgb[1], rgb[2]);
      gltfState.ringBand.opacity = off ? 0.5 : 1;
      gltfState.ringBand.transparent = true;
    }
    if (gltfState && gltfState.ringGlow) {
      gltfState.ringGlow.color.setRGB(rgb[0], rgb[1], rgb[2]);
      gltfState.ringGlow.opacity = off ? 0.12 : 0.28;
    }
    if (gltfState && gltfState.ringDots3d) {
      gltfState.ringDots3d.forEach(function (material, index) {
        var dot = ringDots[index] && ringDots[index].style.background;
        var c = [0.55, 0.36, 0.96];
        if (dot && dot.charAt(0) === '#') {
          c = [parseInt(dot.slice(1, 3), 16) / 255,
            parseInt(dot.slice(3, 5), 16) / 255,
            parseInt(dot.slice(5, 7), 16) / 255];
        } else if (dot) {
          var m = dot.match(/\d+/g);
          if (m && m.length >= 3) c = [m[0] / 255, m[1] / 255, m[2] / 255];
        }
        material.color.setRGB(c[0], c[1], c[2]);
      });
    }
  }

  function initStation3D() {
    var stage = document.getElementById('stationStage');
    if (!stage) return;
    if (initStationGLTF()) return;
    if (initStationGL()) {
      drawHomeScreen();
      syncHomeRing();
      everyHome(1000, drawHomeScreen);
      everyHome(130, syncHomeRing);
      return;
    }
    var fallback = document.getElementById('stationFallback');
    if (fallback) fallback.hidden = false;
  }

  function syncHomePlayer() {
    var title = document.getElementById('homeTitle');
    if (!title) return;
    title.textContent = State.mediaTitle || 'Ничего не играет';
    document.getElementById('homeArtist').textContent =
      State.mediaArtist || 'Яндекс Музыка и радио';
    var cover = document.getElementById('homeCover');
    var art = document.getElementById('homeArt');
    if (State.mediaCover) {
      cover.src = State.mediaCover;
      cover.hidden = false;
      if (art) art.style.display = 'none';
    } else {
      cover.hidden = true;
      cover.removeAttribute('src');
      if (art) art.style.display = '';
    }
    var play = document.getElementById('homePlay');
    if (play) {
      play.querySelector('use').setAttribute('href', State.playing ? '#i-pause' : '#i-play');
    }
    var volume = document.getElementById('homeVolume');
    if (volume && !State.homeVolumeDragging) {
      volume.value = String(State.volume || 0);
      document.getElementById('homeVolumeVal').textContent = (State.volume || 0) + '%';
    }
  }

  var HOME_EXTRAS = {
    resources: 'Ресурсы',
    alarm: 'Будильник',
    network: 'Сеть',
    scenarios: 'Сценарии',
    ai: 'Нейросеть'
  };

  function syncHomeStats(data) {
    State.homeSystem = data || null;
    if (State.homeExtra === 'resources') renderHomeExtra();
  }

  function syncHomeAlarm() {
    if (State.homeExtra === 'alarm') renderHomeExtra();
  }

  function homeCell(label, value) {
    var cell = document.createElement('div');
    cell.className = 'home-extra-cell';
    var l = document.createElement('span');
    l.textContent = label;
    var v = document.createElement('b');
    v.textContent = value == null || value === '' ? '—' : String(value);
    cell.appendChild(l);
    cell.appendChild(v);
    return cell;
  }

  function homeLine(label, value) {
    var row = document.createElement('div');
    row.className = 'home-extra-line';
    var l = document.createElement('span');
    l.textContent = label;
    var v = document.createElement('b');
    v.textContent = value == null || value === '' ? '—' : String(value);
    row.appendChild(l);
    row.appendChild(v);
    return row;
  }

  function renderHomeExtra() {
    var body = document.getElementById('homeExtraBody');
    if (!body) return;
    var label = document.getElementById('homeExtraLabel');
    if (label) label.textContent = HOME_EXTRAS[State.homeExtra] || 'Ресурсы';
    body.innerHTML = '';
    if (State.homeExtra === 'resources') {
      var data = State.homeSystem || {};
      var cpu = data.cpu || {};
      var temp = data.temperature || {};
      var mem = data.memory || {};
      var disks = data.disk || [];
      var dataDisk = null;
      disks.forEach(function (disk) { if (disk.mount === '/data') dataDisk = disk; });
      var grid = document.createElement('div');
      grid.className = 'home-extra-grid';
      grid.appendChild(homeCell('CPU', cpu.percent == null ? '—' : cpu.percent + '%'));
      grid.appendChild(homeCell('Температура', temp.hottest ? temp.hottest.c + '°C' : '—'));
      grid.appendChild(homeCell('Память', mem.percent == null ? '—' : mem.percent + '%'));
      grid.appendChild(homeCell('Диск /data', dataDisk ? dataDisk.percent + '%' : '—'));
      body.appendChild(grid);
      return;
    }
    if (State.homeExtra === 'alarm') {
      var items = (State.alarms || []).filter(function (alarm) { return alarm.enabled; })
        .sort(function (a, b) { return String(a.time).localeCompare(String(b.time)); });
      if (!items.length) {
        body.innerHTML = '<div class="home-extra-empty">Будильников нет</div>';
        return;
      }
      body.appendChild(homeLine('Ближайший', items[0].time));
      body.appendChild(homeLine('Повтор', items[0].once ? 'один раз' : alarmDaysText(items[0].days)));
      body.appendChild(homeLine('Режим', items[0].label || items[0].text || items[0].mode || '—'));
      return;
    }
    if (State.homeExtra === 'network') {
      var net = State.homeNet || {};
      var vpn = State.homeVpn || {};
      body.appendChild(homeLine('Wi-Fi', net.connected ? (net.ssid || 'подключено') : (net.state || 'нет')));
      body.appendChild(homeLine('IP', net.ip || '—'));
      body.appendChild(homeLine('Сигнал', net.signal == null ? '—' : net.signal + ' dBm'));
      body.appendChild(homeLine('VPN', vpn.running ? 'включён' : (vpn.url_set ? 'выключен' : 'не настроен')));
      return;
    }
    if (State.homeExtra === 'scenarios') {
      var scenarios = State.homeScenarios || [];
      if (!scenarios.length) {
        body.innerHTML = '<div class="home-extra-empty">Своих сценариев нет</div>';
        return;
      }
      body.appendChild(homeLine('Всего', scenarios.length));
      scenarios.slice(0, 3).forEach(function (scenario) {
        body.appendChild(homeLine(scenario.name || 'Сценарий', scenario.phrases || ''));
      });
      return;
    }
    var llm = State.homeLlm || {};
    body.appendChild(homeLine('Провайдер', llm.provider || llm.current || '—'));
    body.appendChild(homeLine('Модель', llm.model || llm.current_model || '—'));
    if (llm.enabled != null) body.appendChild(homeLine('Состояние', llm.enabled ? 'включена' : 'выключена'));
  }

  function loadHomeExtraData(kind) {
    if (kind === 'network') {
      return Promise.all([
        cgi('network.py', {}, { timeout: 15000, silent: true }).catch(function () { return null; }),
        cgi('vpn.py', { info: 1 }, { timeout: 10000, silent: true }).catch(function () { return null; })
      ]).then(function (result) {
        State.homeNet = result[0] || {};
        State.homeVpn = result[1] || {};
        if (State.homeExtra === 'network') renderHomeExtra();
      });
    }
    if (kind === 'scenarios') {
      return cgi('scenarios.py', {}, { timeout: 10000, silent: true }).then(function (data) {
        State.homeScenarios = data.scenarios || [];
        if (State.homeExtra === 'scenarios') renderHomeExtra();
      }).catch(function () {});
    }
    if (kind === 'ai') {
      return cgi('llm.py', { info: 1 }, { timeout: 10000, silent: true }).then(function (data) {
        State.homeLlm = data || {};
        if (State.homeExtra === 'ai') renderHomeExtra();
      }).catch(function () {});
    }
    return Promise.resolve();
  }

  function setHomeExtra(kind) {
    if (!HOME_EXTRAS[kind]) kind = 'resources';
    State.homeExtra = kind;
    store.set('homeExtra', kind);
    renderHomeExtra();
    renderHomeExtraOptions();
    loadHomeExtraData(kind);
  }

  function renderHomeExtraOptions() {
    var pop = document.getElementById('homeExtraPop');
    if (!pop) return;
    pop.innerHTML = '';
    Object.keys(HOME_EXTRAS).forEach(function (kind) {
      var item = document.createElement('button');
      item.type = 'button';
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', State.homeExtra === kind ? 'true' : 'false');
      item.textContent = HOME_EXTRAS[kind];
      item.addEventListener('click', function () {
        setHomeExtra(kind);
        pop.hidden = true;
        var button = document.getElementById('btnHomeExtra');
        if (button) button.setAttribute('aria-expanded', 'false');
      });
      pop.appendChild(item);
    });
  }

  function placeHomeExtraPop() {
    var button = document.getElementById('btnHomeExtra');
    var pop = document.getElementById('homeExtraPop');
    if (!button || !pop || pop.hidden) return;
    var rect = button.getBoundingClientRect();
    var width = Math.max(180, Math.min(260, rect.width));
    var left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
    var below = window.innerHeight - rect.bottom - 10;
    var above = rect.top - 10;
    var up = below < 160 && above > below;
    var height = Math.max(120, Math.min(300, up ? above : below));
    pop.style.position = 'fixed';
    pop.style.width = width + 'px';
    pop.style.left = left + 'px';
    pop.style.maxHeight = height + 'px';
    pop.style.overflow = 'auto';
    if (up) {
      pop.style.top = 'auto';
      pop.style.bottom = (window.innerHeight - rect.top + 6) + 'px';
    } else {
      pop.style.top = (rect.bottom + 6) + 'px';
      pop.style.bottom = 'auto';
    }
  }

  function initHomeExtra() {
    var button = document.getElementById('btnHomeExtra');
    var pop = document.getElementById('homeExtraPop');
    if (!button || !pop) return;
    // Попап вне карточки: иначе её transform делает fixed относительным
    // карточки, и список обрезается/съезжает.
    document.body.appendChild(pop);
    var saved = store.get('homeExtra', 'resources');
    State.homeExtra = HOME_EXTRAS[saved] ? saved : 'resources';
    renderHomeExtraOptions();
    renderHomeExtra();
    loadHomeExtraData(State.homeExtra);
    button.addEventListener('click', function (event) {
      event.stopPropagation();
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
      if (!event.target.closest('#btnHomeExtra') && !event.target.closest('#homeExtraPop')) {
        pop.hidden = true;
        button.setAttribute('aria-expanded', 'false');
      }
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        pop.hidden = true;
        button.setAttribute('aria-expanded', 'false');
      }
    });
  }

  function buildMobileTabs() {
    var menu = document.getElementById('mobileTabsMenu');
    var button = document.getElementById('btnMobileTabs');
    var label = document.getElementById('mobileTabLabel');
    if (!menu || !button || !el.tabs) return;
    menu.innerHTML = '';
    Array.prototype.forEach.call(el.tabs.children, function (tab) {
      var item = document.createElement('button');
      item.type = 'button';
      item.dataset.tab = tab.dataset.tab;
      item.textContent = tab.textContent;
      item.addEventListener('click', function () {
        showTab(tab.dataset.tab);
        menu.hidden = true;
        button.setAttribute('aria-expanded', 'false');
      });
      menu.appendChild(item);
    });
    button.addEventListener('click', function (event) {
      event.stopPropagation();
      menu.hidden = !menu.hidden;
      button.setAttribute('aria-expanded', menu.hidden ? 'false' : 'true');
    });
    menu.addEventListener('click', function (event) { event.stopPropagation(); });
    document.addEventListener('click', function (event) {
      if (!event.target.closest('#btnMobileTabs') && !event.target.closest('#mobileTabsMenu')) {
        menu.hidden = true;
        button.setAttribute('aria-expanded', 'false');
      }
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !menu.hidden) {
        menu.hidden = true;
        button.setAttribute('aria-expanded', 'false');
      }
    });
    var active = el.tabs.querySelector('.tab[aria-pressed="true"]');
    if (active && label) label.textContent = active.textContent.replace(/^[^\wА-Яа-я]+/, '');
  }

  var STATION_COLORS = {
    black: { label: 'Чёрный', tint: 0x33363e },
    gray: { label: 'Серый', tint: 0xc4c7cf },
    emerald: { label: 'Изумрудный', tint: 0x1c9c76 },
    raspberry: { label: 'Малиновый', tint: 0xa52565 },
    yellow: { label: 'Жёлтый', tint: 0xc99b19 }
  };

  function applyStationColor() {
    var spec = STATION_COLORS[State.stationColor] || STATION_COLORS.black;
    if (State.bodyMaterials) {
      State.bodyMaterials.forEach(function (material) {
        if (material && material.color) {
          material.color.setHex(spec.tint);
          material.needsUpdate = true;
        }
      });
    }
    Array.prototype.forEach.call(
      document.querySelectorAll('[data-station-color]'), function (button) {
        button.setAttribute('aria-pressed',
          button.dataset.stationColor === State.stationColor ? 'true' : 'false');
      });
  }

  function initStationColors() {
    var saved = store.get('stationColor', 'black');
    State.stationColor = STATION_COLORS[saved] ? saved : 'black';
    Array.prototype.forEach.call(
      document.querySelectorAll('[data-station-color]'), function (button) {
        button.addEventListener('click', function () {
          State.stationColor = button.dataset.stationColor;
          store.set('stationColor', State.stationColor);
          applyStationColor();
        });
      });
    applyStationColor();
  }

  function initHome() {
    initStation3D();
    initStationColors();
    syncHomePlayer();
    syncHomeAlarm();
    initHomeExtra();
    var play = document.getElementById('homePlay');
    if (play) play.addEventListener('click', function () {
      mediaAction(State.playing ? 'pause' : 'play');
    });
    var prev = document.getElementById('homePrev');
    if (prev) prev.addEventListener('click', function () { mediaAction('prev'); });
    var next = document.getElementById('homeNext');
    if (next) next.addEventListener('click', function () { mediaAction('next'); });
    var volume = document.getElementById('homeVolume');
    if (volume) {
      volume.addEventListener('input', function () {
        State.homeVolumeDragging = true;
        document.getElementById('homeVolumeVal').textContent = volume.value + '%';
      });
      volume.addEventListener('change', function () {
        State.homeVolumeDragging = false;
        var value = parseInt(volume.value, 10) || 0;
        cgi('volume.py', { level: value }, { timeout: 10000 }).then(function () {
          setVolumeUI(value);
        }).catch(function (err) { toast('Громкость: ' + err.message, 'bad'); });
      });
    }
    ['homeVolDown', 'homeVolUp'].forEach(function (id) {
      var button = document.getElementById(id);
      if (!button) return;
      button.addEventListener('click', function () {
        var current = parseInt(volume && volume.value, 10) || State.volume || 40;
        var next = Math.max(0, Math.min(100, current + (id === 'homeVolUp' ? 5 : -5)));
        if (volume) volume.value = String(next);
        cgi('volume.py', { level: next }, { timeout: 10000 }).then(function () {
          setVolumeUI(next);
        }).catch(function () {});
      });
    });
  }

  function initLayoutPresets() {
    var select = document.getElementById('layoutPreset');
    var nameInput = document.getElementById('layoutName');
    var status = document.getElementById('layoutStatus');
    var applyBtn = document.getElementById('btnLayoutApply');
    var saveBtn = document.getElementById('btnLayoutSave');
    var deleteBtn = document.getElementById('btnLayoutDelete');
    if (!select || !status || !window.PultLayout) return;

    var presets = [];
    var mode = function () { return window.PultLayout.mode(); };
    var modeLabel = function () { return mode() === 'phone' ? 'телефона' : 'компьютера'; };

    function current() {
      var id = select.value;
      for (var i = 0; i < presets.length; i++) {
        if (presets[i].id === id) return presets[i];
      }
      return null;
    }

    function render() {
      var list = presets.filter(function (item) { return item.mode === mode(); });
      var previous = select.value;
      select.innerHTML = '';
      if (!list.length) {
        var empty = document.createElement('option');
        empty.value = '';
        empty.textContent = 'Нет пресетов для ' + modeLabel();
        select.appendChild(empty);
      } else {
        list.forEach(function (item) {
          var option = document.createElement('option');
          option.value = item.id;
          option.textContent = item.name;
          select.appendChild(option);
        });
        if (previous && list.some(function (item) { return item.id === previous; })) {
          select.value = previous;
        }
      }
      var count = list.length;
      status.textContent = count
        ? 'Пресетов для ' + modeLabel() + ': ' + count
        : 'Пресетов для ' + modeLabel() + ' пока нет';
    }

    function applyDefaultIfFresh() {
      try { if (localStorage.getItem('mypult-cards')) return; } catch (e) { return; }
      var defaultName = '\u041f\u043e \u0443\u043c\u043e\u043b\u0447\u0430\u043d\u0438\u044e';
      var preset = presets.filter(function (item) {
        return item.mode === mode() && item.name === defaultName;
      })[0];
      if (!preset) {
        preset = presets.filter(function (item) {
          return item.mode === 'wide' && item.name === defaultName;
        })[0];
      }
      if (!preset) return;
      window.PultLayout.apply(preset.layout);
      status.textContent = '\u041f\u0440\u0438\u043c\u0435\u043d\u0435\u043d\u0430 \u0440\u0430\u0441\u043a\u043b\u0430\u0434\u043a\u0430 \u00ab\u041f\u043e \u0443\u043c\u043e\u043b\u0447\u0430\u043d\u0438\u044e\u00bb';
    }

    function load() {
      cgi('layout_presets.py', { action: 'list' }, { silent: true })
        .then(function (data) {
          presets = (data && data.presets) || [];
          render();
          applyDefaultIfFresh();
        })
        .catch(function (err) {
          status.textContent = 'Не удалось загрузить пресеты: ' + err.message;
        });
    }

    function savePreset(name, id, update) {
      saveBtn.disabled = true;
      var payload = {
        action: 'save',
        name: name,
        mode: mode(),
        layout: window.PultLayout.capture()
      };
      if (id) payload.id = id;
      if (update) payload.update = 1;
      cgi('layout_presets.py', payload).then(function (data) {
        presets = (data && data.presets) || [];
        nameInput.value = '';
        render();
        status.textContent = 'Сохранён пресет «' + name + '» для ' + modeLabel();
      }).catch(function (err) {
        status.textContent = 'Ошибка сохранения: ' + err.message;
      }).then(function () { saveBtn.disabled = false; });
    }

    saveBtn.addEventListener('click', function () {
      var name = (nameInput.value || '').trim();
      if (!name) {
        status.textContent = 'Введите название пресета';
        nameInput.focus();
        return;
      }
      var existing = presets.filter(function (item) {
        return item.mode === mode() &&
          String(item.name || '').toLowerCase() === name.toLowerCase();
      })[0];
      if (existing) {
        askConfirm('Пресет «' + existing.name + '» уже есть. Обновить его?',
          { yes: 'Обновить' }).then(function (ok) {
          if (ok) savePreset(name, existing.id, true);
        });
        return;
      }
      savePreset(name);
    });

    applyBtn.addEventListener('click', function () {
      var preset = current();
      if (!preset) {
        status.textContent = 'Нет пресета для применения';
        return;
      }
      window.PultLayout.apply(preset.layout);
      status.textContent = 'Применён пресет «' + preset.name + '»';
    });

    deleteBtn.addEventListener('click', function () {
      var preset = current();
      if (!preset) return;
      askConfirm('Удалить пресет «' + preset.name + '»?', { yes: 'Удалить' }).then(function (ok) {
        if (!ok) return;
        cgi('layout_presets.py', { action: 'delete', id: preset.id }).then(function (data) {
          presets = (data && data.presets) || [];
          render();
          status.textContent = 'Пресет «' + preset.name + '» удалён';
        }).catch(function (err) {
          status.textContent = 'Ошибка удаления: ' + err.message;
        });
      });
    });

    var resizeTimer = 0;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(render, 200);
    });

    load();
  }

  function init() {
    function syncScrollbarPad() {
      var sb = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
      document.documentElement.style.setProperty('--sbw', sb + 'px');
    }
    syncScrollbarPad();
    window.addEventListener('resize', syncScrollbarPad);
    if (window.ResizeObserver) {
      new ResizeObserver(syncScrollbarPad).observe(document.body);
    }
    try {
      if (localStorage.getItem('mypult-theme') === 'light') {
        document.body.classList.add('light');
        document.documentElement.classList.add('light-scroll');
        el.btnTheme.textContent = '☾';
        el.btnTheme.setAttribute('aria-label', 'Тёмная тема');
      }
    } catch (e) { /* приватный режим */ }
    [
      'pill', 'pillText', 'netLine', 'offlineBanner', 'footStatus', 'tabs',
      'clockTime', 'clockSub', 'btnDisplayReset', 'btnScreenOff', 'brightness', 'brightnessVal',
      'displayPreview', 'brightChips',
      'seg7', 'seg7Digits', 'btnDraw', 'segToolbar', 'btnSegSend', 'btnSegClear', 'btnSegDone', 'segNote',
      'displayText', 'btnDisplayText', 'btnClockBack',
      'ring', 'ringDots', 'ringHex', 'colorPicker', 'colorCode', 'presets', 'btnLedOff', 'btnRingReset', 'ledHint',
      'ringBrightness', 'ringBrightVal', 'ringSpeed', 'ringSpeedVal',
      'ringAnimStatus', 'ringAnimChips', 'btnRingAnimPlay', 'btnRingAnimStop',
      'btnRingPick', 'ringPickName', 'ringPickPop', 'ringSearch', 'ringAnimList',
      'btnRingEditor', 'ringEditorDlg', 'ringEditorRing', 'ringEditorColor',
      'btnRingEditorAdd', 'btnRingEditorDup', 'btnRingEditorDelFrame',
      'btnRingEditorFill', 'btnRingEditorClear', 'btnRingRestoreHidden',
      'ringEditorFrames', 'ringEditorName', 'ringEditorDuration',
      'btnRingEditorSave', 'btnRingEditorPlay', 'btnRingEditorDelete',
      'btnRingEditorClose', 'ringEditorSaved',
      'mediaTitle', 'mediaSub', 'btnPrev', 'btnPlay', 'btnNext', 'mediaCover', 'mediaArtIcon',
      'btnMusic', 'mediaKind', 'mediaSeek', 'mediaPos', 'mediaDur', 'mediaProgress',
      'btnLyrics', 'lyricsStatus', 'lyricsBox',
      'btnLike', 'btnDislike', 'lyricsDlg', 'lyrBg',
      'btnLyricsClose', 'lyrStage', 'npGlow',
      'btnQueue', 'queueDlg', 'queueName', 'queueList', 'btnQueueClose', 'queueKicker',
      'lyricsNow', 'lyricsInline', 'lyricsNowText',
      'alarmList', 'alarmRinging', 'alarmRingLabel', 'btnAlarmDismiss',
      'alarmTz',
      'btnAlarmSnooze', 'alarmText', 'alarmDays',
      'alarmTimeField', 'btnAlarmTime', 'alarmTimeValue', 'alarmTimePop',
      'alarmHours', 'alarmMinutes', 'btnAlarmTimeDone',
      'alarmRadioBox', 'alarmModes', 'btnAlarmStation', 'alarmStationName',
      'alarmSoundBox', 'btnAlarmSound', 'alarmSoundName', 'alarmSoundList',
      'alarmRepeatModes', 'alarmRepeatHint',
      'alarmStationList', 'alarmCustomStation', 'alarmMusicBox', 'alarmMusicText',
      'alarmVolume', 'alarmVolumeVal', 'alarmRamp', 'alarmStop', 'alarmSnooze',
      'btnAlarmAdd', 'clockAnimStatus', 'btnAlarmOpen', 'btnAlarmClose', 'alarmDlg',
      'animEditor', 'animName', 'animFrames', 'animDuration', 'animText',
      'clockAnimList', 'btnAnimRestorePresets',
      'btnAnimEditor', 'btnAnimPlay', 'btnAnimStop', 'btnAnimSave', 'btnAnimClose',
      'btnClockAnimStop',
      'btnAnimAdd', 'btnAnimDup', 'btnAnimDel', 'btnAnimText',
      'volume', 'volumeVal', 'btnVolDown', 'btnVolUp', 'btnMute',
        'command', 'btnSendCmd', 'ttsText', 'ttsCount', 'btnTtsClear', 'btnSay', 'ttsChips',
      'toasts', 'debugDlg', 'btnDebug', 'btnTheme', 'btnFaq', 'faqDlg', 'btnCloseFaq', 'btnCloseDebug', 'svcState', 'logBox', 'btnRefreshStatus',
      'btnDiag', 'diagBox',
      'verTag', 'verLine', 'capsBanner',
      'llmProviderSelect', 'llmModel', 'llmModelCustomWrap', 'llmModelCustom', 'llmBase', 'llmKey',
      'llmProfiles', 'btnLlmNew', 'llmName', 'llmActive',
      'llmChat', 'btnChatPrev', 'btnChatNext', 'btnChatNew', 'btnChatRename', 'btnChatDel',
      'llmHistoryBox', 'llmHistoryCount', 'llmHistory', 'btnChatHistoryRefresh',
      'chatRenameDlg', 'chatRenameInput', 'btnChatRenameNo', 'btnChatRenameYes', 'llmLength',
      'llmEnabled', 'llmStatus', 'btnLlmSave', 'llmPrompt', 'btnLlmAsk', 'btnLlmAskSay',
      'llmSystem', 'btnLlmSystem', 'llmSystemStatus',
      'llmSearch', 'llmSearchStatus', 'llmSearchUrl', 'btnLlmSearchUrl', 'llmSources',
      'llmFollowUp',
      'llmLocation', 'llmTimezone', 'llmTimezoneList', 'llmContextStatus', 'btnLlmContext',
      'llmAnswer', 'llmMeta',
      'vpnUrl', 'btnVpnSave', 'btnVpnToggle', 'vpnStatus', 'vpnServer', 'vpnLog', 'vpnAutostart',
      'btnVoiceDaemon', 'voiceDaemonStatus', 'voiceIdleMode', 'voiceIdleNote',
    'voiceMicMode', 'voiceMicNote', 'voicePanel',
      'voiceMusicVoice', 'voiceMusicVoiceNote', 'voiceMusicDefault', 'voiceMusicDefaultNote',
      'cardPanel', 'panelBright', 'panelBrightVal', 'btnPanelOff', 'btnPanelRestore', 'panelStatus',
      'radioChips', 'btnRadioPrev', 'btnRadioStop', 'btnRadioNext', 'radioStatus',
      'radioName', 'btnRadioAdd', 'radioUrl', 'btnRadioStream',
      'btnRadioPick', 'radioPickName', 'radioPickCount', 'radioPop', 'radioSearch',
      'btnBtPairMode', 'btnBtScan', 'btStatus', 'btDevices', 'btnBtPower',
      'netPsk', 'btnNetScan', 'netStatus', 'netList', 'netDetails',
      'netDns', 'btnNetDns', 'btnNetDnsReset', 'netIpv6', 'ipv6Status',
      'zbStatus', 'zbCommand', 'btnZbSend',
      'scBuiltin', 'scList', 'scName', 'scPhrases', 'scActions', 'scType',
      'scTime', 'scDays', 'scCondVpn', 'scCondMusic',
      'btnDaysWork', 'btnDaysAll', 'btnDaysWeekend',
      'btnScAddAction', 'btnScSave', 'btnScClear',
      'logName', 'btnLogs', 'logsBox',
      'filesDlg', 'btnFilesOpen', 'btnFilesClose', 'btnFilesUp', 'btnFilesRefresh',
      'filesPath', 'btnFilesGo', 'btnFilesMkdir', 'filesUpload', 'filesRoots',
      'filesNote', 'filesList', 'filesEditor', 'filesEditorName', 'filesText',
      'btnFilesSave', 'btnFilesEditorClose', 'btnFilesRename',
      'zvukToken', 'btnZvukSave', 'btnZvukClear', 'zvukStatus', 'zvukQuery',
      'btnZvukSearch', 'btnZvukWave', 'zvukResults', 'zvukNow', 'btnZvukSite', 'btnZvukProfile',
      'spotifyId', 'spotifySecret', 'btnSpotifySave', 'btnSpotifyClear', 'spotifyStatus',
      'spotifyQuery', 'btnSpotifySearch', 'spotifyResults',
      'extQuery', 'btnExtSearch', 'extStatus', 'extNow', 'extResults',
      'btnNetcheck', 'btnCleanup', 'btnReboot', 'btnPoweroff', 'maintBox', 'autoBright', 'autoBrightStatus',
      'displayAuto', 'displayAutoStatus', 'btnDisplayCurve', 'curveDlg', 'curveCanvas', 'curveRows',
      'btnCurveClose', 'btnCurveAdd', 'btnCurveReset', 'btnCurveSave',
      'btnSpeed', 'btnBackup', 'backupFile',
      'rebootDlg', 'btnCloseReboot', 'rebootStatus', 'rebootBar', 'rebootTime',
      'confirmDlg', 'confirmText', 'btnConfirmNo', 'btnConfirmYes',
      'updCurrent', 'updChecked', 'updNew', 'updNewTitle', 'updNotes', 'updHint',
      'updState', 'btnUpdateCheck', 'btnUpdateApply', 'updChannel', 'btnUpdateRollback',
    'updLocalPath', 'btnUpdLocal', 'updLocalHint',
      'updateDlg', 'updateDlgVer', 'updateDlgFrom', 'updateDlgNotes', 'updateDismiss',
      'btnUpdateLater', 'btnUpdateDlgNo', 'btnUpdateDlgYes',
      'btnSoundBackup', 'btnSoundRefresh', 'soundFile', 'soundList', 'soundDrop', 'soundGroup', 'soundSearch', 'soundStatus',
      'customSoundName', 'btnCustomSound', 'customSoundFile', 'customSoundList',
      'pinGate', 'pinInput', 'pinError', 'btnPinLogin',
      'pinNew', 'btnPinEnable', 'btnPinDisable', 'btnPinLock', 'pinStatus', 'pinInsecure',
      'sysCpu', 'sysCpuBar', 'sysLoad', 'sysRam', 'sysRamBar', 'sysRamSub', 'sysTemp', 'sysTempSub',
      'sysDisk', 'sysDiskBar', 'sysDiskSub', 'sysRoot', 'sysRootBar', 'sysRootSub', 'hwList', 'sysLight', 'sysLightSub', 'sysUptime', 'sysBoard'
    ].forEach(function (id) { el[id] = document.getElementById(id); });

    buildRing();
    buildSevenSeg();
    restore();
    bind();
    buildMobileTabs();
    initHome();
    initRingMusic();
    initLogo();
    initRingStatePolling();
    initYandexMusic();
    initYmDialog();
    initLyricsPlayer();
    updateVolumeIcons();
    paintRanges();
    every(1000, paintRanges);
    every(30000, refreshAutoBrightness);
    setTimeout(refreshAutoBrightness, 1500);
    document.addEventListener('input', function (event) {
      if (event.target && event.target.type === 'range') paintRange(event.target);
    }, true);
    document.addEventListener('change', function (event) {
      if (event.target && event.target.type === 'range') paintRange(event.target);
    }, true);
    renderAlarmDays();
    loadAlarms(true);
    clockAnimBind();
    renderClockAnimList();
    setInterval(function () {
      if ((State.tab === 'sound' || State.tab === 'home') && !document.hidden) loadAlarms(true);
    }, 5000);
    tickClock();
    setInterval(tickClock, 1000);
    every(130, tickRingAnims);
    setInterval(function () {
      if (State.tab === 'home' && !document.hidden) refreshSystem();
    }, 15000);
    // Клик мимо поля ввода снимает фокус: на Android WebView каретка иногда
    // продолжает мигать после закрытия клавиатуры, и это раздражает.
    document.addEventListener('pointerdown', function (event) {
      var active = document.activeElement;
      if (!active) return;
      var tag = active.tagName;
      if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') return;
      var target = event.target;
      if (!target || target === active) return;
      if (target.closest && target.closest('input,textarea,select,label')) return;
      try { active.blur(); } catch (e) { /* ignore */ }
    }, true);

    renderStatus();
    loadVersion();
    loadCaps();
    loadPanel();
    loadYmProfile();
    loadUpdateInfo(false, false);
    setInterval(function () {
      if (!document.hidden) loadUpdateInfo(false, false);
    }, 6 * 60 * 60 * 1000);
    fillScTypes();
    addScRow('speak');
    enhanceSelects();
    loadAuth();
    initCardDrag();
    initLayoutPresets();
    schedulePack();
    loadRingSpeed();
    syncVolumeFromDevice();
    refreshState();
    scheduleStateRefresh();
    setInterval(function () {
      if (!document.hidden && State.tab === 'system') refreshSystem();
    }, 10000);
    var startTab = (location.hash || '').replace('#', '') ||
      store.get(TAB_KEY, 'home');
    if (!(location.hash || '') && !store.get(START_KEY)) {
      // Новый стартовый экран — «Главная».
      store.set(START_KEY, 1);
      startTab = 'home';
    }
    try { showTab(startTab, false); } finally { document.body.classList.remove('booting'); }
    syncScrollbarPad();
    setTimeout(syncScrollbarPad, 60);
    setTimeout(syncScrollbarPad, 400);
    if (window.scrollTo) window.scrollTo({ top: 0, behavior: 'auto' });
    resumeRebootWatch();
    log('app', 'Пульт запущен', navigator.userAgent);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
