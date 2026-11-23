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

