  /* ─────────── zigbee ─────────── */
  function loadZb() {
    return cgi('zigbee.py', {}, { timeout: 12000, silent: true }).then(function (data) {
      State.zb = data;
      var shorts = (data.devices || []).map(function (item) { return item.short; });
      el.zbStatus.textContent = 'радио ' + (data.radio ? 'активно' : 'выключено') +
        ' · сеть ' + (data.network ? 'сформирована' : 'не сформирована') +
        ' · записей устройств: ' + (data.count || 0) +
        (shorts.length ? ' · ' + shorts.join(', ') : '');
    }).catch(function (err) {
      el.zbStatus.textContent = 'Zigbee: ' + err.message;
    });
  }

  function sendZb() {
    var text = el.zbCommand.value.trim();
    if (!text) {
      toast('Введите команду, например «включи лампу»', 'warn');
      return;
    }
    return withBusy(el.btnZbSend, function () {
      return cgi('zigbee.py', { text: text }, { timeout: 30000 }).then(function () {
        el.zbCommand.value = '';
        toast('Передано Алисе', 'ok');
        refreshPlayer(true);
      }).catch(function (err) {
        toast('Zigbee: ' + err.message, 'bad');
      });
    });
  }

