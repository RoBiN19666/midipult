  /* ─────────── кривая автояркости ─────────── */
  var curvePoints = [];
  var curveDrag = null;
  var curveBound = false;

  function curveDefaults() {
    var lo = Number(State.displayMin) || 10;
    var hi = Number(State.displayMax) || 170;
    return [[0, lo], [50, Math.round((lo + hi) / 2)], [200, hi]];
  }

  function curveResize() {
    var canvas = el.curveCanvas;
    if (!canvas) return;
    var dpr = window.devicePixelRatio || 1;
    var cssW = Math.max(240, Math.round(canvas.clientWidth || 320));
    var cssH = 190;
    var pixelW = Math.round(cssW * dpr);
    var pixelH = Math.round(cssH * dpr);
    if (canvas.width !== pixelW || canvas.height !== pixelH) {
      canvas.width = pixelW;
      canvas.height = pixelH;
    }
    canvas.style.height = cssH + 'px';
  }

  function curveGeom() {
    var canvas = el.curveCanvas;
    return {
      width: canvas.clientWidth || 320,
      height: canvas.clientHeight || 190,
      left: 44, right: 16, top: 18, bottom: 30,
      maxLux: 10000, maxLevel: 255
    };
  }

  function curveLuxToX(lux, g) {
    var span = Math.log10(g.maxLux + 1);
    var ratio = Math.min(1, Math.log10(Math.max(0, lux) + 1) / span);
    return g.left + (g.width - g.left - g.right) * ratio;
  }

  function curveXToLux(x, g) {
    var span = g.width - g.left - g.right;
    var ratio = span <= 0 ? 0 : (x - g.left) / span;
    ratio = Math.max(0, Math.min(1, ratio));
    return Math.max(0, Math.round(Math.pow(10, ratio * Math.log10(g.maxLux + 1)) - 1));
  }

  function curveLevelToY(level, g) {
    var span = g.height - g.top - g.bottom;
    var ratio = Math.min(1, Math.max(0, level / g.maxLevel));
    return g.top + span * (1 - ratio);
  }

  function curveYToLevel(y, g) {
    var span = g.height - g.top - g.bottom;
    var ratio = span <= 0 ? 0 : (g.height - g.bottom - y) / span;
    ratio = Math.max(0, Math.min(1, ratio));
    return Math.max(10, Math.min(255, Math.round(ratio * g.maxLevel)));
  }

  function curveDraw() {
    var canvas = el.curveCanvas;
    if (!canvas) return;
    curveResize();
    var ctx = canvas.getContext('2d');
    var dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var g = curveGeom();
    var axis = 'rgba(255,255,255,.16)';
    var grid = 'rgba(255,255,255,.055)';
    ctx.clearRect(0, 0, g.width, g.height);
    ctx.font = '10px sans-serif';
    ctx.lineWidth = 1;
    ctx.fillStyle = 'rgba(255,255,255,.5)';
    ctx.textAlign = 'left';
    ctx.fillText('яркость', 8, 11);
    ctx.textAlign = 'right';
    ctx.fillText('lux', g.width - 16, 11);
    ctx.textAlign = 'start';

    var luxTicks = [0, 10, 100, 1000, 10000];
    var levelTicks = [10, 100, 255];
    luxTicks.forEach(function (lux) {
      var x = curveLuxToX(lux, g);
      ctx.strokeStyle = grid;
      ctx.beginPath();
      ctx.moveTo(x, g.top);
      ctx.lineTo(x, g.height - g.bottom);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,.42)';
      ctx.textAlign = lux === 0 ? 'left' : (lux === g.maxLux ? 'right' : 'center');
      ctx.fillText(lux ? String(lux) : '0', x, g.height - 8);
    });
    levelTicks.forEach(function (level) {
      var y = curveLevelToY(level, g);
      ctx.strokeStyle = grid;
      ctx.beginPath();
      ctx.moveTo(g.left, y);
      ctx.lineTo(g.width - g.right, y);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,.42)';
      ctx.textAlign = 'right';
      ctx.fillText(String(level), g.left - 7, y + 3);
    });
    ctx.strokeStyle = axis;
    ctx.beginPath();
    ctx.moveTo(g.left, g.top);
    ctx.lineTo(g.left, g.height - g.bottom);
    ctx.lineTo(g.width - g.right, g.height - g.bottom);
    ctx.stroke();

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
      var active = point === curveDragPoint();
      ctx.beginPath();
      ctx.arc(x, y, active ? 6 : 4.5, 0, Math.PI * 2);
      ctx.fillStyle = active ? '#ffffff' : '#ffdb4d';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#0b0e16';
      ctx.stroke();
    });
  }

  function curveDragPoint() {
    return curveDrag ? curveDrag.point : null;
  }

  function curveCanvasPos(event) {
    var canvas = el.curveCanvas;
    var rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left,
             y: event.clientY - rect.top };
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
    window.addEventListener('resize', function () {
      if (el.curveDlg && el.curveDlg.open) curveDraw();
    });
    // ПКМ по точке удаляет её; ЛКМ по пустому месту — добавляет.
    canvas.addEventListener('contextmenu', function (event) {
      event.preventDefault();
      var index = curvePointIndexAt(curveCanvasPos(event));
      if (index < 0) return;
      if (curvePoints.length <= 2) {
        toast('Нужно минимум две точки', 'warn');
        return;
      }
      curvePoints.splice(index, 1);
      curveDrag = null;
      curveRender();
      curveDraw();
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

  function curveShow() {
    curvePoints = (State.displayCurve || []).map(function (pair) {
      return [Number(pair[0]) || 0, Number(pair[1]) || 10];
    });
    if (!curvePoints.length) curvePoints = curveDefaults();
    curveBindCanvas();
    curveRender();
    if (el.curveDlg && el.curveDlg.showModal) el.curveDlg.showModal();
    // Ширина канваса известна только после показа диалога: иначе первый
    // кадр растягивается из дефолтных 300 px и выглядит мутным.
    requestAnimationFrame(function () {
      curveDraw();
    });
  }

  function curveOpen() {
    // Всегда берём кривую с сервера: в State она могла остаться от
    // предыдущего ответа без поля display_curve.
    return cgi('display.py', {}, { timeout: 8000, silent: true }).then(function (data) {
      if (data && data.auto && Array.isArray(data.auto.display_curve) &&
          data.auto.display_curve.length) {
        State.displayCurve = data.auto.display_curve;
      }
      curveShow();
    }).catch(function () {
      curveShow();
    });
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
