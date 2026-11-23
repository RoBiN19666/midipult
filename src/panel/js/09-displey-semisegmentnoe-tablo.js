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

