  /* ─────────── статус ─────────── */
  function setPill(kind, text) {
    el.pill.className = 'pill' + (kind ? ' ' + kind : '');
    el.pillText.textContent = text;
  }

  function renderStatus() {
    if (State.busy > 0) { setPill('busy', 'Отправка…'); }
    else if (State.luna === false) { setPill('bad', 'Luna недоступна'); }
    else if (State.luna === true && State.glagol === false) { setPill('warn', 'Luna в сети · Glagol offline'); }
    else if (State.luna === true) { setPill('ok', 'В сети'); }
    else { setPill('', 'Проверка…'); }

    el.offlineBanner.classList.toggle('show', State.luna === false);

    var parts = [];
    parts.push('Luna ' + (State.luna === null ? '?' : State.luna ? '✓' : '✕'));
    parts.push('Glagol ' + (State.glagol === null ? '?' : State.glagol ? '✓' : '✕'));
    var tts = State.services && typeof State.services.tts === 'boolean' ? State.services.tts : null;
    if (tts !== null) parts.push('IPC ' + (tts ? '✓' : '✕'));
    el.netLine.textContent = parts.join(' · ');
    el.footStatus.textContent = State.luna === null ? '—' :
      (State.luna ? 'шлюз 8099 доступен' : 'шлюз 8099 недоступен');
  }

  function renderServices() {
    var s = State.services || {};
    var rows = [
      ['Luna :8099', s.luna],
      ['Glagol :1961', s.glagol],
      ['IPC :9875', s.tts],
      ['amixer', s.amixer],
      ['websocket-client', s.websocket]
    ];
    el.svcState.innerHTML = '';
    rows.forEach(function (row) {
      var node = document.createElement('span');
      node.textContent = row[0] + ' ' + (row[1] === true ? '✓' : row[1] === false ? '✕' : '?');
      if (row[1] === true) node.className = 'on';
      if (row[1] === false) node.className = 'off';
      el.svcState.appendChild(node);
    });
  }

  function busyStart() { State.busy += 1; renderStatus(); }
  function busyEnd() { State.busy = Math.max(0, State.busy - 1); renderStatus(); }

  function withBusy(button, fn) {
    if (button && button.dataset.busy === '1') return Promise.resolve();
    if (button) { button.dataset.busy = '1'; button.disabled = true; }
    busyStart();
    return Promise.resolve().then(fn).finally(function () {
      if (button) { delete button.dataset.busy; button.disabled = false; }
      busyEnd();
    });
  }

