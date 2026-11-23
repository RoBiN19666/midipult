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

