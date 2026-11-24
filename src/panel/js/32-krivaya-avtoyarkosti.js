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
