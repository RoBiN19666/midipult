  /* ─────────── бэкап ─────────── */
  function downloadBackup() {
    // По умолчанию ключи API и подписка VPN не попадают в файл: панель
    // работает по HTTP, а копию легко переслать. Полная — только по выбору.
    return askConfirm('Скачать копию вместе с ключами API и подпиской VPN? «Отмена» — скачать без секретов.', { yes: 'С ключами', danger: false }).then(function (full) {
      return cgi('backup.py', full ? { full: 1 } : {}, { timeout: 20000 }).then(function (data) {
        var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        var link = document.createElement('a');
        var stamp = new Date().toISOString().slice(0, 10);
        link.href = URL.createObjectURL(blob);
        link.download = 'mypult-backup-' + stamp + (full ? '-full' : '') + '.json';
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(function () { URL.revokeObjectURL(link.href); }, 3000);
        toast(full ? 'Бэкап с ключами скачан' : 'Бэкап скачан без ключей', 'ok');
      }).catch(function (err) { toast('Бэкап: ' + err.message, 'bad'); });
    });
  }

  function restoreBackup(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var parsed;
      try {
        parsed = JSON.parse(String(reader.result));
      } catch (err) {
        toast('Файл не JSON', 'bad');
        return;
      }
      var payload = parsed && parsed.data ? parsed.data : parsed;
      askConfirm('Восстановить настройки из файла? Текущие будут заменены.', { yes: 'Восстановить' }).then(function (ok) {
        if (!ok) return;
        return cgi('backup.py', { data: payload }, { timeout: 30000 }).then(function (data) {
          var done = (data.restored || []).join(', ') || 'ничего';
          var msg = 'Восстановлено: ' + done;
          if (data.skipped && data.skipped.length) msg += ' · пропущено с маской: ' + data.skipped.join(', ');
          toast(msg, 'ok');
          setTimeout(function () { location.reload(); }, 1200);
        }).catch(function (err) { toast('Восстановление: ' + err.message, 'bad'); });
      });
    };
    reader.readAsText(file);
  }

