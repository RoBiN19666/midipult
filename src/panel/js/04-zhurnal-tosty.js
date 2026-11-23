  /* ─────────── журнал / тосты ─────────── */
  var logs = [];

  function log(kind, title, detail, isErr) {
    logs.unshift({ t: new Date(), kind: kind, title: title, detail: detail, err: !!isErr });
    if (logs.length > 100) logs.pop();
    renderLog();
  }

  function renderLog() {
    if (!el.logBox) return;
    if (!logs.length) { el.logBox.textContent = 'Журнал пуст.'; return; }
    el.logBox.textContent = logs.map(function (item) {
      var t = pad(item.t.getHours()) + ':' + pad(item.t.getMinutes()) + ':' + pad(item.t.getSeconds());
      var line = t + '  [' + item.kind + '] ' + item.title;
      if (item.detail !== undefined && item.detail !== null) {
        var d = typeof item.detail === 'string' ? item.detail : JSON.stringify(item.detail);
        if (d && d.length > 400) d = d.slice(0, 400) + '…';
        line += ' → ' + d;
      }
      return (item.err ? '✖ ' : '· ') + line;
    }).join('\n');
  }

  function toast(message, kind) {
    var node = document.createElement('div');
    node.className = 'toast' + (kind ? ' ' + kind : '');
    node.textContent = message;
    el.toasts.appendChild(node);
    setTimeout(function () {
      node.style.transition = 'opacity .3s, transform .3s';
      node.style.opacity = '0';
      node.style.transform = 'translateY(8px)';
      setTimeout(function () { node.remove(); }, 320);
    }, 3200);
  }

