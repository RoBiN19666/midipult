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

