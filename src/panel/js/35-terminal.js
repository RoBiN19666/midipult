  /* ─────────── терминал ─────────── */
  var TERM_KEY = 'mypult.term.sid';
  var TERM_HIST = 'mypult.term.history';
  var termCwd = '/data/myweb';
  var termBusy = false;
  var termHistory = [];
  var termHistIndex = 0;
  var termSid = '';

  function termInitSid() {
    try {
      termSid = localStorage.getItem(TERM_KEY) || '';
    } catch (e) {}
    if (!/^[a-z0-9]{8,32}$/.test(termSid)) {
      var stamp = Date.now().toString(36) + Math.floor((window.performance && performance.now ? performance.now() : 0) * 1000).toString(36);
      termSid = ('t' + stamp).replace(/[^a-z0-9]/g, '').slice(0, 24);
      try { localStorage.setItem(TERM_KEY, termSid); } catch (e) {}
    }
    try {
      var saved = JSON.parse(localStorage.getItem(TERM_HIST) || '[]');
      if (Array.isArray(saved)) termHistory = saved.slice(-100);
    } catch (e) { termHistory = []; }
    termHistIndex = termHistory.length;
  }

  function termShortCwd() {
    if (termCwd === '/data/myweb') return '~';
    return termCwd || '/';
  }

  function termPrompt() {
    if (el.termPrompt) el.termPrompt.textContent = 'root@midi:' + termShortCwd() + '#';
  }

  function termScroll() {
    if (el.termOut) el.termOut.scrollTop = el.termOut.scrollHeight;
  }

  function termAppend(text, cls) {
    if (!el.termOut || !text) return;
    var node = document.createElement(cls ? 'span' : 'span');
    if (cls) node.className = cls;
    node.textContent = text;
    el.termOut.appendChild(node);
    if (el.termOut.textContent.length > 240000) {
      el.termOut.textContent = el.termOut.textContent.slice(-160000);
    }
    termScroll();
  }

  function termClear() {
    if (el.termOut) el.termOut.textContent = '';
    termPrompt();
  }

  function termHistorySave(cmd) {
    if (!cmd) return;
    if (termHistory[termHistory.length - 1] !== cmd) termHistory.push(cmd);
    termHistory = termHistory.slice(-100);
    try { localStorage.setItem(TERM_HIST, JSON.stringify(termHistory)); } catch (e) {}
    termHistIndex = termHistory.length;
  }

  function termRun() {
    if (termBusy || !el.termInput) return;
    var cmd = (el.termInput.value || '').trim();
    if (!cmd) return;
    if (cmd === 'clear' || cmd === 'cls') {
      el.termInput.value = '';
      termClear();
      return;
    }
    termBusy = true;
    el.termInput.value = '';
    el.termInput.disabled = true;
    if (el.btnTermRun) el.btnTermRun.disabled = true;
    termAppend((el.termOut && el.termOut.textContent ? '\n' : '') +
      'root@midi:' + termShortCwd() + '# ' + cmd + '\n', 'term-cmd');
    termHistorySave(cmd);
    return cgi('terminal.py', { cmd: cmd, sid: termSid }, { timeout: 40000 })
      .then(function (data) {
        if (data && typeof data.cwd === 'string' && data.cwd) termCwd = data.cwd;
        var out = (data && data.out) || '';
        if (out) termAppend(out.replace(/\s+$/, '\n'));
        if (data && typeof data.code === 'number' && data.code !== 0) {
          termAppend('[код ' + data.code + ']\n', 'term-code');
        }
        termPrompt();
      })
      .catch(function (err) {
        termAppend('ошибка: ' + err.message + '\n', 'term-code');
      })
      .then(function () {
        termBusy = false;
        if (el.termInput) {
          el.termInput.disabled = false;
          el.termInput.focus();
        }
        if (el.btnTermRun) el.btnTermRun.disabled = false;
      });
  }

  function termKeydown(event) {
    if (event.key === 'Enter') {
      event.preventDefault();
      termRun();
      return;
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      if (!termHistory.length) return;
      event.preventDefault();
      if (event.key === 'ArrowUp') termHistIndex = Math.max(0, termHistIndex - 1);
      else termHistIndex = Math.min(termHistory.length, termHistIndex + 1);
      if (el.termInput) {
        el.termInput.value = termHistIndex >= termHistory.length
          ? '' : termHistory[termHistIndex];
        var end = el.termInput.value.length;
        try { el.termInput.setSelectionRange(end, end); } catch (e) {}
      }
    }
  }

  function termInit() {
    termInitSid();
    termPrompt();
    if (el.termOut && !el.termOut.textContent) {
      el.termOut.textContent = '';
    }
    cgi('terminal.py', { sid: termSid }, { timeout: 8000, silent: true })
      .then(function (data) {
        if (data && data.cwd) {
          termCwd = data.cwd;
          termPrompt();
        }
      }).catch(function () { /* сервер ответит при первой команде */ });
  }
