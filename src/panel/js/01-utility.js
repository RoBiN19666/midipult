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

