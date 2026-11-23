  /* ─────────── логи ─────────── */
  function loadLogs() {
    return cgi('logs.py', { name: el.logName.value, lines: 200 }, { timeout: 10000, silent: true })
      .then(function (data) {
        el.logsBox.textContent = stripAnsi(data.text || '(пусто)');
        el.logsBox.scrollTop = el.logsBox.scrollHeight;
      }).catch(function (err) {
        el.logsBox.textContent = 'Логи: ' + err.message;
      });
  }

