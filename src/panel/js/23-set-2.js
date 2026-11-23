  /* ─────────── сеть ─────────── */
  function renderNet(data) {
    State.net = data;
    var parts = [];
    parts.push(data.connected ? ('подключено к ' + (data.ssid || '?')) : ('не подключено (' + (data.state || '?') + ')'));
    if (data.ip) parts.push(data.ip);
    if (data.signal != null) parts.push(data.signal + ' dBm');
    el.netStatus.textContent = parts.join(' · ');

    if (el.netDetails) {
      var details = [];
      if (data.gateway) details.push('шлюз ' + data.gateway);
      if (data.mac) details.push('MAC ' + data.mac);
      if (data.dns && data.dns.length) details.push('DNS ' + data.dns.join(', '));
      el.netDetails.textContent = details.join(' · ');
      if (el.netDns && !el.netDns.value && data.dns && data.dns.length) {
        el.netDns.value = data.dns.join(', ');
      }
    }
  }

  function renderNetSaved(saved) {
    el.netList.innerHTML = '';
    saved.forEach(function (net) {
      var row = document.createElement('div');
      row.className = 'bt-item';
      var name = document.createElement('span');
      name.className = 'name';
      name.textContent = net.ssid;
      var mark = document.createElement('small');
      var current = State.net && net.ssid === State.net.ssid;
      mark.textContent = current ? 'текущая' : 'сохранена';
      row.appendChild(name);
      row.appendChild(mark);
      if (!current) {
        var connect = document.createElement('button');
        connect.className = 'btn sm ghost';
        connect.textContent = 'Подключить';
        connect.addEventListener('click', function () { netConnectSaved(net.id); });
        row.appendChild(connect);
      }
      var forget = document.createElement('button');
      forget.className = 'btn sm ghost';
      forget.textContent = 'Забыть';
      forget.addEventListener('click', function () { netForget(net.ssid); });
      row.appendChild(forget);
      el.netList.appendChild(row);
    });
  }

  function netConnectSaved(id) {
    return withBusy(null, function () {
      el.netStatus.textContent = 'подключаюсь к сохранённой сети…';
      return cgi('network.py', { action: 'connect_saved', id: id }, { timeout: 60000 })
        .then(function (data) {
          renderNet(data);
          renderNetSaved(data.saved || []);
          toast(data.connected ? ('Подключено: ' + data.ssid) : 'Не удалось, вернул прежнюю сеть',
            data.connected ? 'ok' : 'warn');
        }).catch(function (err) {
          toast('Сеть: ' + err.message, 'bad');
        });
    });
  }

  function netForget(ssid) {
    return withBusy(null, function () {
      return cgi('network.py', { action: 'forget', ssid: ssid }, { timeout: 20000 })
        .then(function (data) {
          renderNet(data);
          renderNetSaved(data.saved || []);
          toast('Сеть забыта: ' + ssid, 'ok');
        }).catch(function (err) {
          toast('Сеть: ' + err.message, 'bad');
        });
    });
  }

  function netDnsApply() {
    var servers = el.netDns.value.trim();
    if (!servers) {
      toast('Введите DNS через запятую', 'warn');
      return;
    }
    return withBusy(el.btnNetDns, function () {
      return cgi('network.py', { action: 'dns', servers: servers }, { timeout: 45000 })
        .then(function (data) {
          renderNet(data);
          toast('DNS: ' + (data.dns || []).join(', '), 'ok');
        }).catch(function (err) {
          toast('DNS: ' + err.message, 'bad');
        });
    });
  }

  function netDnsReset() {
    return withBusy(el.btnNetDnsReset, function () {
      return cgi('network.py', { action: 'dns_reset' }, { timeout: 45000 })
        .then(function (data) {
          renderNet(data);
          toast('DNS возвращён к штатному', 'ok');
        }).catch(function (err) {
          toast('DNS: ' + err.message, 'bad');
        });
    });
  }

  function loadNet() {
    return cgi('network.py', {}, { timeout: 15000, silent: true }).then(function (data) {
      renderNet(data);
      renderNetSaved(data.saved || []);
    }).catch(function (err) {
      el.netStatus.textContent = 'Сеть: ' + err.message;
    });
  }

  function netScan() {
    if (State.netScanning) return Promise.resolve();
    State.netScanning = true;
    if (!beginScan(el.btnNetScan, el.netStatus, 'Сканирую Wi-Fi')) {
      State.netScanning = false;
      return Promise.resolve();
    }
    showScanSkeleton(el.netList, 4);
    return cgi('network.py', { action: 'scan' }, { timeout: 30000 }).then(function (data) {
      renderNet(data.state || {});
      el.netList.innerHTML = '';
      (data.networks || []).forEach(function (net) {
        var row = document.createElement('div');
        row.className = 'bt-item';
        var name = document.createElement('span');
        name.className = 'name';
        name.textContent = (net.secure ? '🔒 ' : '') + net.ssid;
        var sig = document.createElement('small');
        sig.textContent = net.signal + ' dBm';
        var btn = document.createElement('button');
        btn.className = 'btn sm ghost';
        btn.textContent = 'Подключить';
        btn.addEventListener('click', function () { netConnect(net); });
        row.appendChild(name);
        row.appendChild(sig);
        row.appendChild(btn);
        el.netList.appendChild(row);
      });
      if (!data.networks || !data.networks.length) {
        el.netList.innerHTML = '<div class="seg-note">сети не найдены — попробуйте ещё раз</div>';
      }
      toast('Wi-Fi: найдено ' + ((data.networks || []).length) + ' сетей', 'ok');
    }).catch(function (err) {
      el.netStatus.textContent = 'Сеть: ' + err.message;
      if (!el.netList.children.length) {
        el.netList.innerHTML = '<div class="seg-note">не удалось просканировать — попробуйте ещё раз</div>';
      }
      toast('Сеть: ' + err.message, 'bad');
    }).finally(function () {
      State.netScanning = false;
      endScan(el.btnNetScan, el.netStatus);
    });
  }

  function netConnect(net) {
    var psk = el.netPsk.value;
    if (net.secure && !psk) {
      toast('Введите пароль Wi-Fi в поле выше', 'warn');
      el.netPsk.focus();
      return;
    }
    return withBusy(null, function () {
      el.netStatus.textContent = 'подключаюсь к ' + net.ssid + '…';
      return cgi('network.py', { action: 'connect', ssid: net.ssid, psk: psk }, { timeout: 70000 })
        .then(function (data) {
          renderNet(data);
          el.netPsk.value = '';
          toast(data.connected ? ('Подключено: ' + data.ssid) : 'Не удалось, вернул прежнюю сеть',
            data.connected ? 'ok' : 'warn');
        }).catch(function (err) {
          toast('Сеть: ' + err.message, 'bad');
          loadNet();
        });
    });
  }

