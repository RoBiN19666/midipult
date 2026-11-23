  /* ─────────── bluetooth ─────────── */
  function showScanSkeleton(list, count) {
    list.innerHTML = '';
    for (var i = 0; i < count; i++) {
      var row = document.createElement('div');
      row.className = 'bt-item scan-skeleton';
      var name = document.createElement('span');
      name.className = 'sk-name';
      var state = document.createElement('span');
      state.className = 'sk-state';
      var button = document.createElement('span');
      button.className = 'sk-btn';
      row.appendChild(name);
      row.appendChild(state);
      row.appendChild(button);
      list.appendChild(row);
    }
  }

  function beginScan(button, status, text) {
    if (!button) return false;
    button.dataset.scanLabel = button.textContent;
    button.disabled = true;
    button.classList.add('is-scanning');
    button.textContent = 'Сканирую…';
    status.textContent = text;
    status.classList.add('scanning-text');
    return true;
  }

  function endScan(button, status) {
    if (button) {
      button.disabled = false;
      button.classList.remove('is-scanning');
      button.textContent = button.dataset.scanLabel || 'Сканировать';
    }
    if (status) status.classList.remove('scanning-text');
  }

  function btRow(item, onAction) {
    var row = document.createElement('div');
    row.className = 'bt-item';
    var name = document.createElement('span');
    name.className = 'name';
    name.textContent = item.name || item.mac;
    var state = document.createElement('small');
    state.textContent = item.connected ? 'подключено' : (item.paired ? 'сопряжено' : '');
    var btn = document.createElement('button');
    btn.className = 'btn sm ghost';
    btn.textContent = item.connected ? 'Отключить' : 'Подключить';
    btn.addEventListener('click', function () { onAction(item); });
    row.appendChild(name);
    row.appendChild(state);
    row.appendChild(btn);
    return row;
  }

  function renderBt(data) {
    State.bt = data;
    el.btnBtPower.textContent = data.powered ? 'Bluetooth: вкл' : 'Bluetooth: выкл';
    el.btnBtPairMode.textContent = data.discoverable ? 'Сопряжение: вкл' : 'Сопряжение: выкл';
    el.btStatus.textContent = (data.powered ? 'адаптер включён' : 'адаптер выключен') +
      ' · ' + (data.discoverable ? 'видим для сопряжения' : 'скрыт') +
      (data.audio ? ' · A2DP-приёмник активен' : ' · bluealsa не запущен');
    el.btDevices.innerHTML = '';
    (data.devices || []).forEach(function (item) {
      el.btDevices.appendChild(btRow(item, function (device) {
        btAction({ action: device.connected ? 'disconnect' : 'connect', mac: device.mac });
      }));
    });
    if (!data.devices || !data.devices.length) {
      el.btDevices.innerHTML = '<div class="seg-note">устройств пока нет — включите «Режим сопряжения» и ищите колонку с телефона</div>';
    }
  }

  function loadBt() {
    return cgi('bluetooth.py', {}, { timeout: 12000, silent: true }).then(renderBt).catch(function (err) {
      el.btStatus.textContent = 'Bluetooth: ' + err.message;
    });
  }

  // Телефон подключается со своей стороны, поэтому карточку надо опрашивать:
  // иначе состояние видно только после перезагрузки страницы.
  var btCardTimer = null;

  function startBtCardPoll() {
    if (btCardTimer) return;
    btCardTimer = setInterval(function () {
      if (State.tab !== 'network' || document.hidden || State.btScanning) return;
      loadBt();
    }, 4000);
  }

  function stopBtCardPoll() {
    if (btCardTimer) clearInterval(btCardTimer);
    btCardTimer = null;
  }

  function btScan() {
    if (State.btScanning) return Promise.resolve();
    State.btScanning = true;
    if (!beginScan(el.btnBtScan, el.btStatus, 'Сканирую Bluetooth')) {
      State.btScanning = false;
      return Promise.resolve();
    }
    showScanSkeleton(el.btDevices, 3);
    return cgi('bluetooth.py', { action: 'scan' }, { timeout: 45000 }).then(function (data) {
      renderBt(data);
      if (!data.devices || !data.devices.length) {
        el.btDevices.innerHTML = '<div class="seg-note">устройств не найдено. Включите «Режим сопряжения» и ищите колонку с телефона.</div>';
      }
      toast('Bluetooth: найдено ' + ((data.devices || []).length) + ' устройств', 'ok');
    }).catch(function (err) {
      el.btStatus.textContent = 'Bluetooth: ' + err.message;
      if (!el.btDevices.children.length) {
        el.btDevices.innerHTML = '<div class="seg-note">не удалось просканировать — попробуйте ещё раз</div>';
      }
      toast('Bluetooth: ' + err.message, 'bad');
    }).finally(function () {
      State.btScanning = false;
      endScan(el.btnBtScan, el.btStatus);
    });
  }

  function btAction(payload) {
    return withBusy(null, function () {
      return cgi('bluetooth.py', payload, { timeout: 45000 }).then(function (data) {
        renderBt(data);
        toast('Bluetooth обновлён', 'ok');
        // Соединение могло не удержаться: перепроверяем фактический статус.
        window.setTimeout(function () {
          if (State.tab === 'network') loadBt();
        }, 2500);
      }).catch(function (err) {
        toast('Bluetooth: ' + err.message, 'bad');
      });
    });
  }

