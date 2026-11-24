  /* ─────────── кривая автояркости ─────────── */
  var curvePoints = [];
  var curveDrag = null;
  var curveBound = false;

  function curveDefaults() {
    var lo = Number(State.displayMin) || 10;
    var hi = Number(State.displayMax) || 170;
    return [[0, lo], [50, Math.round((lo + hi) / 2)], [200, hi]];
  }

  function curveGeom() {
    var canvas = el.curveCanvas;
    return {
      width: canvas.width, height: canvas.height, pad: 26,
      maxLux: 10000, maxLevel: 255
    };
  }

  function curveLuxToX(lux, g) {
    var span = Math.log10(g.maxLux + 1);
    return g.pad + (g.width - g.pad - 10) *
      Math.min(1, Math.log10(Math.max(0, lux) + 1) / span);
  }

  function curveXToLux(x, g) {
    var span = g.width - g.pad - 10;
    var ratio = span <= 0 ? 0 : (x - g.pad) / span;
    ratio = Math.max(0, Math.min(1, ratio));
    return Math.max(0, Math.round(Math.pow(10, ratio * Math.log10(g.maxLux + 1)) - 1));
  }

  function curveLevelToY(level, g) {
    return g.height - g.pad - (g.height - g.pad - 12) *
      Math.min(1, Math.max(0, level) / g.maxLevel);
  }

  function curveYToLevel(y, g) {
    var span = g.height - g.pad - 12;
    var ratio = span <= 0 ? 0 : (g.height - g.pad - y) / span;
    ratio = Math.max(0, Math.min(1, ratio));
    return Math.max(10, Math.min(255, Math.round(ratio * g.maxLevel)));
  }

  function curveDraw() {
    var canvas = el.curveCanvas;
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    var g = curveGeom();
    ctx.clearRect(0, 0, g.width, g.height);
    ctx.strokeStyle = 'rgba(255,255,255,.08)';
    ctx.fillStyle = 'rgba(255,255,255,.45)';
    ctx.font = '10px sans-serif';
    ctx.lineWidth = 1;
    [0, 10, 100, 1000, 10000].forEach(function (lux) {
      var x = curveLuxToX(lux, g);
      ctx.beginPath();
      ctx.moveTo(x, 12);
      ctx.lineTo(x, g.height - g.pad);
      ctx.stroke();
      ctx.fillText(lux ? String(lux) : '0', x - 6, g.height - 8);
    });
    [10, 100, 255].forEach(function (level) {
      var y = curveLevelToY(level, g);
      ctx.beginPath();
      ctx.moveTo(g.pad, y);
      ctx.lineTo(g.width - 10, y);
      ctx.stroke();
      ctx.fillText(String(level), 2, y + 3);
    });
    var points = curvePoints.slice().sort(function (a, b) { return a[0] - b[0]; });
    if (!points.length) return;
    ctx.strokeStyle = '#8b7bff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    points.forEach(function (point, index) {
      var x = curveLuxToX(point[0], g);
      var y = curveLevelToY(point[1], g);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    points.forEach(function (point) {
      var x = curveLuxToX(point[0], g);
      var y = curveLevelToY(point[1], g);
      ctx.fillStyle = point === curveDragPoint() ? '#ffffff' : '#ffdb4d';
      ctx.beginPath();
      ctx.arc(x, y, point === curveDragPoint() ? 6 : 4, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function curveDragPoint() {
    return curveDrag ? curveDrag.point : null;
  }

  function curveCanvasPos(event) {
    var canvas = el.curveCanvas;
    var rect = canvas.getBoundingClientRect();
    var scaleX = canvas.width / rect.width;
    var scaleY = canvas.height / rect.height;
    return { x: (event.clientX - rect.left) * scaleX,
             y: (event.clientY - rect.top) * scaleY };
  }

  function curvePointIndexAt(pos) {
    var g = curveGeom();
    var best = -1;
    var bestDist = 14;
    curvePoints.forEach(function (point, index) {
      var dx = curveLuxToX(point[0], g) - pos.x;
      var dy = curveLevelToY(point[1], g) - pos.y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < bestDist) {
        best = index;
        bestDist = dist;
      }
    });
    return best;
  }

  function curveMovePoint(pos) {
    if (!curveDrag) return;
    var g = curveGeom();
    var point = curveDrag.point;
    point[0] = Math.max(0, Math.min(100000, curveXToLux(pos.x, g)));
    point[1] = curveYToLevel(pos.y, g);
    curvePoints.sort(function (a, b) { return a[0] - b[0]; });
    curveDraw();
  }

  function curveAddAt(pos) {
    if (curvePoints.length >= 16) {
      toast('Больше 16 точек не нужно', 'warn');
      return;
    }
    var g = curveGeom();
    var point = [Math.max(0, Math.min(100000, curveXToLux(pos.x, g))),
                 curveYToLevel(pos.y, g)];
    curvePoints.push(point);
    curvePoints.sort(function (a, b) { return a[0] - b[0]; });
    curveDrag = { point: point };
    curveRender();
    curveDraw();
  }

  function curveBindCanvas() {
    if (curveBound || !el.curveCanvas) return;
    curveBound = true;
    var canvas = el.curveCanvas;
    canvas.addEventListener('pointerdown', function (event) {
      event.preventDefault();
      var pos = curveCanvasPos(event);
      var index = curvePointIndexAt(pos);
      if (index >= 0) {
        curveDrag = { point: curvePoints[index] };
      } else {
        curveAddAt(pos);
      }
      if (canvas.setPointerCapture) canvas.setPointerCapture(event.pointerId);
      curveDraw();
    });
    canvas.addEventListener('pointermove', function (event) {
      if (!curveDrag) {
        canvas.style.cursor = curvePointIndexAt(curveCanvasPos(event)) >= 0
          ? 'grab' : 'crosshair';
        return;
      }
      canvas.style.cursor = 'grabbing';
      curveMovePoint(curveCanvasPos(event));
    });
    function finish() {
      if (!curveDrag) return;
      curveDrag = null;
      canvas.style.cursor = 'crosshair';
      curvePoints.sort(function (a, b) { return a[0] - b[0]; });
      curveRender();
      curveDraw();
    }
    canvas.addEventListener('pointerup', finish);
    canvas.addEventListener('pointercancel', finish);
    window.addEventListener('pointerup', finish);
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
        point[0] = lx;
        point[1] = lv;
        curvePoints.sort(function (a, b) { return a[0] - b[0]; });
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
    curveBindCanvas();
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
