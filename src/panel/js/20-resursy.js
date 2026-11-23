  /* ─────────── ресурсы ─────────── */
  function loadLevel(percent) {
    if (percent == null) return '';
    if (percent >= 85) return 'bad';
    if (percent >= 65) return 'warn';
    return '';
  }

  function fmtMb(kb) {
    return Math.round(kb / 1024) + ' МБ';
  }

  function fmtUptime(seconds) {
    if (seconds == null) return '—';
    var days = Math.floor(seconds / 86400);
    var hours = Math.floor((seconds % 86400) / 3600);
    var mins = Math.floor((seconds % 3600) / 60);
    if (days) return days + ' д ' + hours + ' ч';
    if (hours) return hours + ' ч ' + mins + ' м';
    return mins + ' мин';
  }

  function renderHardware(items) {
    if (!el.hwList) return;
    el.hwList.innerHTML = '';
    if (!items || !items.length) {
      var empty = document.createElement('div');
      empty.className = 'seg-note';
      empty.textContent = 'Характеристики недоступны.';
      el.hwList.appendChild(empty);
      return;
    }
    items.forEach(function (item) {
      var row = document.createElement('div');
      row.className = 'hw-item';
      var label = document.createElement('span');
      label.className = 'hw-label';
      label.textContent = item.label;
      var value = document.createElement('span');
      value.className = 'hw-value';
      value.textContent = item.value || '—';
      var src = document.createElement('span');
      src.className = 'hw-src' + (item.source === 'wiki' ? ' wiki' : '');
      src.textContent = item.source === 'wiki' ? 'вики' : 'система';
      src.title = item.source === 'wiki'
        ? 'Linux не отдаёт это значение; взято из статьи hackalice.me'
        : 'Прочитано из /proc или /sys';
      row.appendChild(label);
      row.appendChild(value);
      row.appendChild(src);
      el.hwList.appendChild(row);
    });
  }

  function refreshSystem() {
    if (document.hidden || (State.tab !== 'system' && State.tab !== 'home')) {
      return Promise.resolve();
    }
    return fetch('/state?full=1', { cache: 'no-store', credentials: 'same-origin' })
      .then(function (res) {
        if (!res.ok) throw new Error('state ' + res.status);
        return res.json();
      })
      .then(function (state) {
        if (state.system && Object.keys(state.system).length) return state.system;
        return cgi('system.py', {}, { timeout: 8000, silent: true });
      })
      .catch(function () {
        return cgi('system.py', {}, { timeout: 8000, silent: true });
      })
      .then(function (data) {
      var cpu = data.cpu || {};
      el.sysCpu.textContent = (cpu.percent == null) ? '—' : cpu.percent + '%';
      el.sysCpuBar.style.width = (cpu.percent || 0) + '%';
      el.sysCpuBar.className = loadLevel(cpu.percent);
      el.sysLoad.textContent = cpu.load ? ('load ' + cpu.load.join(' · ')) : '';

      var mem = data.memory || {};
      el.sysRam.textContent = (mem.percent == null) ? '—' : mem.percent + '%';
      el.sysRamBar.style.width = (mem.percent || 0) + '%';
      el.sysRamBar.className = loadLevel(mem.percent);
      el.sysRamSub.textContent = mem.total_kb
        ? (fmtMb(mem.used_kb) + ' из ' + fmtMb(mem.total_kb))
        : '';

      var temp = data.temperature || {};
      var hot = temp.hottest;
      el.sysTemp.textContent = hot ? (hot.c + '°C') : '—';
      el.sysTempSub.textContent = hot ? hot.name : 'датчик не найден';

      function paintDisk(disk, valueEl, barEl, subEl) {
        if (!disk) {
          valueEl.textContent = '—';
          subEl.textContent = 'нет данных';
          return;
        }
        valueEl.textContent = disk.percent + '%';
        barEl.style.width = disk.percent + '%';
        barEl.className = loadLevel(disk.percent);
        var free = disk.free_mb >= 1024
          ? (Math.round(disk.free_mb / 102.4) / 10) + ' ГБ'
          : Math.round(disk.free_mb) + ' МБ';
        var total = disk.total_mb >= 1024
          ? (Math.round(disk.total_mb / 102.4) / 10) + ' ГБ'
          : Math.round(disk.total_mb) + ' МБ';
        subEl.textContent = 'свободно ' + free + ' из ' + total;
      }

      var disks = {};
      (data.disk || []).forEach(function (item) { disks[item.mount] = item; });
      paintDisk(disks['/data'], el.sysDisk, el.sysDiskBar, el.sysDiskSub);
      paintDisk(disks['/'], el.sysRoot, el.sysRootBar, el.sysRootSub);
      renderHardware(data.hardware);

      var light = data.light;
      if (light) {
        var unit = light.unit === 'lux' ? 'lx' : (light.unit || '');
        el.sysLight.textContent = Math.round(light.value) + (unit ? ' ' + unit : '');
        el.sysLightSub.textContent = light.name || 'датчик света';
      } else {
        el.sysLight.textContent = '—';
        el.sysLightSub.textContent = 'нет датчика';
      }
      el.sysUptime.textContent = fmtUptime(data.uptime_s);
      el.sysBoard.textContent = data.board || '';
      syncHomeStats(data);
    }).catch(function () { /* тихо */ });
  }

