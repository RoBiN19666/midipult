  /* ─────────── VPN ─────────── */
  function renderVpn(data) {
    State.vpn = data;
    var status = data.running
      ? ('включён' + (data.tun ? ' · tun0' : ' · tun0 нет'))
      : (data.url_set ? 'выключен' : 'не настроено');
    el.vpnStatus.textContent = status;
    renderVpnButton();
    el.vpnAutostart.checked = !!data.autostart;
    if (data.url_hint) el.vpnUrl.placeholder = data.url_hint;

    var servers = data.servers || [];
    var previous = el.vpnServer.value;
    el.vpnServer.innerHTML = '';
    servers.forEach(function (server) {
      var option = document.createElement('option');
      option.value = String(server.index);
      option.textContent = (server.name || ('сервер ' + (server.index + 1))) +
        ' · ' + (server.type || '');
      el.vpnServer.appendChild(option);
    });
    el.vpnServer.disabled = !servers.length;
    if (servers.length) {
      var exists = false;
      for (var i = 0; i < el.vpnServer.options.length; i++) {
        if (el.vpnServer.options[i].value === previous) exists = true;
      }
      el.vpnServer.value = exists ? previous : String(data.selected || 0);
    }
  }

  function loadVpn() {
    return cgi('vpn.py', { info: 1 }, { timeout: 10000, silent: true })
      .then(renderVpn)
      .catch(function (err) { el.vpnStatus.textContent = 'VPN: ' + err.message; });
  }

  function saveVpn() {
    var url = el.vpnUrl.value.trim();
    if (!url) { toast('Вставьте ссылку на подписку', 'warn'); return; }
    return withBusy(el.btnVpnSave, function () {
      el.vpnStatus.textContent = 'скачиваю подписку…';
      return cgi('vpn.py', { url: url }, { timeout: 90000 }).then(function (data) {
        toast('Подписка: ' + data.servers.length + ' серверов', 'ok');
        el.vpnUrl.value = '';
        return loadVpn();
      }).catch(function (err) {
        el.vpnStatus.textContent = 'ошибка подписки';
        toast('VPN: ' + err.message, 'bad');
      });
    });
  }

  function renderVpnButton() {
    var button = el.btnVpnToggle;
    if (!button) return;
    var data = State.vpn || {};
    var running = !!data.running;
    var busy = !!State.vpnBusy;
    button.classList.toggle('primary', !running);
    button.classList.toggle('danger', running);
    button.classList.toggle('is-busy', busy);
    button.textContent = busy
      ? (State.vpnBusy === 'stop' ? 'Выключаю…' : 'Включаю…')
      : (running ? 'Выключить' : 'Включить');
    button.disabled = busy || (!running && !data.url_set);
    button.setAttribute('aria-busy', busy ? 'true' : 'false');
  }

  function toggleVpn() {
    var button = el.btnVpnToggle;
    if (!button || State.vpnBusy || button.dataset.busy === '1') return;
    var data = State.vpn || {};
    var running = !!data.running;
    if (!running && !data.url_set) return;
    var index = parseInt(el.vpnServer.value, 10) || 0;
    State.vpnBusy = running ? 'stop' : 'start';
    button.dataset.busy = '1';
    renderVpnButton();
    el.vpnStatus.textContent = running ? 'выключаю…' : 'поднимаю туннель…';
    busyStart();
    var request = running
      ? cgi('vpn.py', { stop: 1 }, { timeout: 30000 })
      : cgi('vpn.py', { start: 1, index: index }, { timeout: 240000 });
    return request.then(function () {
      if (!running) {
        el.vpnLog.hidden = true;
        toast('VPN включён', 'ok');
      } else {
        toast('VPN выключен', 'ok');
      }
      State.vpn = Object.assign({}, State.vpn || {}, { running: !running });
      renderVpnButton();
      return loadVpn();
    }).catch(function (err) {
      if (!running) {
        var details = err.data && err.data.log;
        if (details) {
          el.vpnLog.hidden = false;
          el.vpnLog.textContent = details;
        }
      }
      if (State.vpn) renderVpn(State.vpn);
      el.vpnStatus.textContent = running ? 'ошибка остановки' : 'ошибка запуска';
      toast('VPN: ' + err.message, 'bad');
    }).then(function () {
      State.vpnBusy = null;
      delete button.dataset.busy;
      busyEnd();
      renderVpnButton();
    });
  }

