  /* ─────────── сеть ─────────── */
  function request(url, opts) {
    opts = opts || {};
    var method = opts.method || 'POST';
    var body = opts.body === undefined ? null : opts.body;
    var timeout = opts.timeout || 12000;
    var outside = opts.signal || null;

    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, timeout);
    var onOutsideAbort = function () { ctrl.abort(); };
    if (outside) {
      if (outside.aborted) ctrl.abort();
      else outside.addEventListener('abort', onOutsideAbort);
    }

    var init = {
      method: method,
      signal: ctrl.signal,
      cache: 'no-store',
      headers: { 'Accept': 'application/json', 'X-Requested-With': 'MidiPult' }
    };
    if (body !== null) {
      init.headers['Content-Type'] = 'application/json; charset=utf-8';
      init.body = JSON.stringify(body);
    }

    return fetch(url, init).then(function (res) {
      return res.text().then(function (text) {
        var data = null;
        if (text) { try { data = JSON.parse(text); } catch (e) { data = { raw: text }; } }
        if (!res.ok) {
          var msg = (data && (data.error || data.message)) || ('HTTP ' + res.status);
          throw ApiError(msg, res.status, data);
        }
        return data === null ? {} : data;
      });
    }).catch(function (err) {
      if (err && err.name === 'ApiError') throw err;
      if (err && err.name === 'AbortError') {
        if (outside && outside.aborted) throw ApiError('Отменено', 0);
        throw ApiError('Превышено время ожидания', 0);
      }
      throw ApiError('Нет связи с устройством', 0);
    }).finally(function () {
      clearTimeout(timer);
      if (outside) outside.removeEventListener('abort', onOutsideAbort);
    });
  }

