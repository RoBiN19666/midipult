  /* ─────────── интерактивный терминал ─────────── */
  var term = null;
  var termFit = null;
  var termWs = null;
  var termAssets = null;

  function termLoadAssets() {
    if (window.Terminal && window.FitAddon) return Promise.resolve();
    if (termAssets) return termAssets;
    termAssets = new Promise(function (resolve, reject) {
      if (!document.querySelector('link[data-xterm]')) {
        var link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = '/assets/xterm/xterm.css';
        link.dataset.xterm = '1';
        document.head.appendChild(link);
      }
      function addon() {
        var fit = document.createElement('script');
        fit.src = '/assets/xterm/addon-fit.js';
        fit.onload = function () { resolve(); };
        fit.onerror = function () { reject(new Error('не загрузился addon-fit')); };
        document.head.appendChild(fit);
      }
      var script = document.createElement('script');
      script.src = '/assets/xterm/xterm.js';
      script.onload = addon;
      script.onerror = function () { reject(new Error('не загрузился xterm.js')); };
      document.head.appendChild(script);
    });
    return termAssets;
  }

  function termSetStatus(text, kind) {
    if (el.termStatus) el.termStatus.textContent = text;
    if (el.termDlgStatus) el.termDlgStatus.textContent = text;
    if (el.termDlgStatus) el.termDlgStatus.className = 'seg-note' + (kind ? ' ' + kind : '');
  }

  function termSend(payload) {
    if (termWs && termWs.readyState === 1) {
      termWs.send(JSON.stringify(payload));
    }
  }

  function termResize() {
    if (!term || !termFit) return;
    try { termFit.fit(); } catch (e) { return; }
    termSend({ type: 'resize', cols: term.cols, rows: term.rows });
  }

  function termDisconnect() {
    if (termWs) {
      try { termWs.close(); } catch (e) {}
      termWs = null;
    }
  }

  function termConnect() {
    termDisconnect();
    var scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    termSetStatus('подключаюсь…');
    var socket;
    try {
      socket = new WebSocket(scheme + '://' + location.host + '/term');
    } catch (e) {
      termSetStatus('ошибка: ' + e.message, 'bad');
      return;
    }
    termWs = socket;
    socket.onopen = function () {
      termSetStatus('подключено');
      termResize();
      if (term) term.focus();
    };
    socket.onmessage = function (event) {
      if (term) term.write(event.data);
    };
    socket.onerror = function () {
      termSetStatus('нет соединения: включён ли PIN?', 'bad');
    };
    socket.onclose = function () {
      // shell завершился (exit) или соединение пропало — закрываем окно.
      termSetStatus('сессия завершена');
      if (el.termDlg && el.termDlg.open) el.termDlg.close();
    };
  }

  function termEnsureTerm() {
    if (term) return;
    term = new Terminal({
      fontSize: 13,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      cursorBlink: true,
      convertEol: true,
      scrollback: 4000,
      theme: {
        background: '#070a10',
        foreground: '#cfe3ff',
        cursor: '#22d3ee',
        selectionBackground: 'rgba(124,92,255,.35)'
      }
    });
    termFit = new FitAddon.FitAddon();
    term.loadAddon(termFit);
    term.open(el.termHost);
    term.onData(function (data) { termSend({ type: 'input', data: data }); });
    term.onResize(function (size) {
      termSend({ type: 'resize', cols: size.cols, rows: size.rows });
    });
  }

  function termOpen() {
    return termLoadAssets().then(function () {
      if (!el.termDlg) return;
      if (!el.termDlg.open) el.termDlg.showModal();
      termEnsureTerm();
      requestAnimationFrame(function () {
        termResize();
        termConnect();
      });
    }).catch(function (err) {
      termSetStatus('терминал: ' + err.message, 'bad');
    });
  }

  function termFinish() {
    termSend({ type: 'close' });
    termDisconnect();
    termSetStatus('сессия завершена');
    if (term) term.reset();
  }

  function termCloseDialog() {
    termDisconnect();
    if (el.termDlg && el.termDlg.open) el.termDlg.close();
    termSetStatus('не запущен');
  }

  function termInit() {
    if (el.btnTermOpen) el.btnTermOpen.addEventListener('click', termOpen);
    if (el.btnTermFinish) el.btnTermFinish.addEventListener('click', termFinish);
    if (el.btnTermClose) el.btnTermClose.addEventListener('click', termCloseDialog);
    if (el.termDlg) {
      el.termDlg.addEventListener('close', function () { termDisconnect(); });
    }
    window.addEventListener('resize', function () {
      if (el.termDlg && el.termDlg.open) termResize();
    });
  }
