  /* ─────────── API-обёртки ─────────── */
  function luna(path, body, opts) {
    opts = opts || {};
    return request('/cgi-bin/luna.py?path=' + encodeURIComponent(path), {
      body: body || {},
      timeout: opts.timeout || 12000,
      signal: opts.signal
    }).then(function (data) {
      State.luna = true;
      renderStatus();
      log('luna', path, data);
      return data;
    }).catch(function (err) {
      if (err.status === 0) { State.luna = false; renderStatus(); }
      log('luna', path, err.message, true);
      throw err;
    });
  }

  function cgi(script, params, opts) {
    opts = opts || {};
    return request('/cgi-bin/' + script, {
      body: params || {},
      timeout: opts.timeout || 12000,
      signal: opts.signal
    }).then(function (data) {
      if (!opts.silent) log('cgi', script, data);
      return data;
    }).catch(function (err) {
      if (!opts.silent) log('cgi', script, err.message, true);
      throw err;
    });
  }

