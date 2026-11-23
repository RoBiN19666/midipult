  /* ─────────── озвучка ─────────── */
  function say() {
    var text = el.ttsText.value.trim();
    if (!text) { toast('Введите текст для озвучки', 'warn'); return; }
    return withBusy(el.btnSay, function () {
      return cgi('speak.py', { text: text }, { timeout: 30000 }).then(function (data) {
        if (data && data.started) toast('Алиса говорит', 'ok');
        else toast('Запрос ушёл, подтверждения нет', 'warn');
      }).catch(function (err) {
        toast('Озвучка: ' + err.message, 'bad');
        if (err.data && err.data.hint) log('speak', 'hint', err.data.hint, true);
      });
    });
  }

