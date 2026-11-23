  /* ─────────── версия ─────────── */
  function loadVersion() {
    return fetch('/version.json', { cache: 'no-store' }).then(function (res) {
      if (!res.ok) throw new Error('нет version.json');
      return res.json();
    }).then(function (data) {
      State.version = data.version || null;
      el.verTag.textContent = 'v' + (data.version || '?');
      el.verLine.textContent = [data.version && ('v' + data.version), data.date]
        .filter(Boolean).join(' · ');
      log('app', 'версия', data.version + ' / ' + data.date);
    }).catch(function () {
      el.verTag.textContent = 'v?';
      log('app', 'version.json недоступен', null, true);
    });
  }

