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

