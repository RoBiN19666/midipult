  /* ─────────── индикация панели (Station 2) ─────────── */
  function renderPanel(data) {
    if (!el.cardPanel) return;
    var supported = !!(data && data.supported);
    el.cardPanel.hidden = !supported;
    if (!supported) return;
    var max = data.max || 255;
    var current = data.current == null ? max : data.current;
    el.panelBright.max = max;
    el.panelBright.value = current;
    el.panelBrightVal.textContent = current + ' / ' + max;
    el.panelStatus.textContent = data.off ? 'панель погашена' : 'светится';
  }

  function loadPanel() {
    return cgi('panel.py', {}, { timeout: 8000, silent: true }).then(function (data) {
      State.panel = data;
      renderPanel(data);
    }).catch(function () {
      if (el.cardPanel) el.cardPanel.hidden = true;
    });
  }

  function setPanel(payload) {
    return cgi('panel.py', payload, { timeout: 8000 }).then(function (data) {
      State.panel = data;
      renderPanel(data);
      return data;
    }).catch(function (err) {
      toast('Панель: ' + err.message, 'bad');
    });
  }

