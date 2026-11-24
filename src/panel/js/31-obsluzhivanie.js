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

