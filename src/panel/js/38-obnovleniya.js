  /* ─────────── обновления ─────────── */
  var UPDATE_DISMISS_KEY = 'updateDismissedVersion';
  var UPDATE_PROMPT_KEY = 'updatePrompted';

  function updateDismissed(version) {
    return !!version && String(store.get(UPDATE_DISMISS_KEY, '')) === String(version);
  }

  function formatUpdateTime(seconds) {
    if (!seconds) return '';
    try {
      return new Date(seconds * 1000).toLocaleString('ru-RU', {
        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
      });
    } catch (e) {
      return '';
    }
  }

  function versionCmp(a, b) {
    var left = String(a || '').split('.');
    var right = String(b || '').split('.');
    for (var i = 0; i < 3; i++) {
      var x = parseInt(left[i], 10) || 0;
      var y = parseInt(right[i], 10) || 0;
      if (x !== y) return x - y;
    }
    return 0;
  }

  function renderUpdateInfo(data) {
    State.updateInfo = data || null;
    if (el.updChannel) el.updChannel.value = (data && data.channel) || 'stable';
    var current = (data && data.current) || State.version || '—';
    var installedBeta = !!(data && data.installed_prerelease);
    var downgrade = !!(installedBeta && data && !data.prerelease && data.latest &&
      versionCmp(current, data.latest) > 0);
    el.updCurrent.textContent = 'v' + current + (installedBeta ? ' · бета' : '');
    if (data && data.checked_at) {
      el.updChecked.textContent = 'проверено ' + formatUpdateTime(data.checked_at);
    } else {
      el.updChecked.textContent = '';
    }
    el.btnUpdateApply.disabled = !(data && data.update_available) || State.updateRunning;
    if (!data || !data.update_available) {
      el.updNew.hidden = true;
      el.updHint.textContent = '';
      el.btnUpdateApply.textContent = 'Обновить';
      if (data && data.error) {
        el.updState.textContent = data.error;
      } else if (data && data.latest) {
        el.updState.textContent = versionCmp(current, data.latest) > 0
          ? 'Локально v' + current + ' — новее последнего релиза v' + data.latest
          : 'Установлена последняя версия: v' + data.latest;
      } else {
        el.updState.textContent = 'Проверка недоступна';
      }
      return;
    }
    el.updNew.hidden = false;
    el.updNewTitle.textContent = downgrade
      ? 'Возврат на стабильную версию v' + data.latest +
        (data.published_at ? ' · ' + formatUpdateTime(Date.parse(data.published_at) / 1000) : '')
      : 'Доступна версия v' + data.latest +
        (data.prerelease ? ' (бета)' : '') +
        (data.published_at ? ' · ' + formatUpdateTime(Date.parse(data.published_at) / 1000) : '');
    el.updNotes.textContent = data.body || 'Описание изменений не приложено.';
    el.updState.textContent = downgrade
      ? 'Сейчас бета v' + current + ' · стабильная v' + data.latest
      : 'Есть обновление: v' + current + ' → v' + data.latest;
    el.btnUpdateApply.textContent = downgrade ? 'Вернуться на стабильную' : 'Обновить';
    el.updHint.textContent = updateDismissed(data.latest) ? 'уведомление отключено' : '';
  }

  function showUpdateDialog(data) {
    if (!data || !data.update_available) return;
    State.updateInfo = data;
    el.updateDlgVer.textContent = 'v' + data.latest + (data.prerelease ? ' (бета)' : '');
    el.updateDlgFrom.textContent = 'Сейчас: v' + data.current +
      (data.published_at ? ' · опубликовано ' + formatUpdateTime(Date.parse(data.published_at) / 1000) : '');
    el.updateDlgNotes.textContent = data.body || 'Описание изменений не приложено.';
    el.updateDismiss.checked = updateDismissed(data.latest);
    if (typeof el.updateDlg.showModal === 'function') {
      if (!el.updateDlg.open) el.updateDlg.showModal();
    } else {
      el.updateDlg.setAttribute('open', '');
    }
  }

  function closeUpdateDialog() {
    if (typeof el.updateDlg.close === 'function') {
      try { el.updateDlg.close(); } catch (e) {}
    } else {
      el.updateDlg.removeAttribute('open');
    }
  }

  function maybePromptUpdate(data) {
    if (!data || !data.update_available) return;
    // С беты на более старую стабильную — не навязываем окном, только в карточке.
    if (data.installed_prerelease && !data.prerelease &&
        versionCmp(data.current, data.latest) > 0) return;
    if (updateDismissed(data.latest) || State.updateRunning) return;
    var prompted = store.get(UPDATE_PROMPT_KEY, {}) || {};
    var today = new Date().toISOString().slice(0, 10);
    if (prompted.version === data.latest && prompted.date === today) return;
    store.set(UPDATE_PROMPT_KEY, { version: data.latest, date: today });
    showUpdateDialog(data);
  }

  function loadUpdateInfo(force, manual) {
    el.updState.textContent = force ? 'Проверяю GitHub…' : 'Проверяю обновления…';
    var payload = force ? { check: 1 } : { info: 1 };
    return cgi('update.py', payload, { timeout: 25000, silent: true }).then(function (data) {
      renderUpdateInfo(data);
      if (manual) {
        if (data.update_available) showUpdateDialog(data);
        else toast('Обновлений нет', 'ok');
      } else {
        maybePromptUpdate(data);
      }
      return data;
    }).catch(function (err) {
      el.updState.textContent = 'Не удалось проверить: ' + err.message;
      if (manual) toast('Обновления: ' + err.message, 'bad');
    });
  }

  function setUpdateChannel(value) {
    return cgi('update.py', { channel: value }, { timeout: 25000 }).then(function (data) {
      renderUpdateInfo(data);
      toast(value === 'beta' ? 'Канал: бета' : 'Канал: стабильный', 'ok');
    }).catch(function (err) {
      toast('Канал: ' + err.message, 'bad');
      loadUpdateInfo(true);
    });
  }

  function rollbackUpdate() {
    if (!window.confirm('Откатить последнее обновление? Панель перезапустится.')) return;
    if (State.updateRunning) return;
    State.updateRunning = true;
    el.updState.textContent = 'Запускаю откат…';
    return cgi('update.py', { rollback: 1 }, { timeout: 30000, silent: true })
      .then(function () { pollUpdateStatus(0); })
      .catch(function (err) {
        State.updateRunning = false;
        el.updState.textContent = 'Откат не запущен: ' + err.message;
        toast('Откат: ' + err.message, 'bad');
      });
  }

  function pollUpdateStatus(attempt) {
    return cgi('update.py', { status: 1 }, { timeout: 8000, silent: true }).then(function (data) {
      var status = data.status || {};
      var state = status.state || 'idle';
      if (state === 'done') {
        el.updState.textContent = (status.rolled_back ? 'Откат выполнен' : 'Обновление установлено')
          + '. Перезагружаю панель…';
        setTimeout(function () { location.reload(); }, 2400);
        return;
      }
      if (state === 'error') {
        State.updateRunning = false;
        el.btnUpdateApply.disabled = false;
        el.updState.textContent = 'Ошибка обновления: ' + (status.error || 'неизвестно') +
          (status.rolled_back ? ' · выполнен откат' : '');
        toast('Обновление не установлено', 'bad');
        return;
      }
      if (state === 'queued' || state === 'downloading' || state === 'installing' || state === 'rollback') {
        el.updState.textContent = status.message ||
          (state === 'downloading' ? 'Скачиваю архив…' : 'Устанавливаю…');
        window.setTimeout(function () { pollUpdateStatus(attempt + 1); }, 2500);
        return;
      }
      // После перезапуска lighttpd статус может быть временно недоступен.
      if (State.updateRunning) {
        if (attempt < 30) window.setTimeout(function () { pollUpdateStatus(attempt + 1); }, 2500);
        else {
          State.updateRunning = false;
          el.btnUpdateApply.disabled = false;
          el.updState.textContent = 'Панель перезапускается. Проверьте обновление вручную.';
        }
      }
    }).catch(function () {
      if (State.updateRunning && attempt < 30) {
        window.setTimeout(function () { pollUpdateStatus(attempt + 1); }, 2500);
      } else if (State.updateRunning) {
        State.updateRunning = false;
        el.btnUpdateApply.disabled = false;
        el.updState.textContent = 'Панель перезапускается. Проверьте обновление вручную.';
      }
    });
  }

  function startUpdate() {
    if (State.updateRunning) return;
    var info = State.updateInfo;
    if (!info || !info.update_available) {
      toast('Нет доступного обновления', 'warn');
      return;
    }
    if (el.updateDismiss.checked) store.set(UPDATE_DISMISS_KEY, info.latest);
    closeUpdateDialog();
    State.updateRunning = true;
    el.btnUpdateApply.disabled = true;
    el.updState.textContent = 'Запускаю обновление…';
    return cgi('update.py', { apply: 1 }, { timeout: 20000, silent: true }).then(function () {
      pollUpdateStatus(0);
    }).catch(function (err) {
      State.updateRunning = false;
      el.btnUpdateApply.disabled = false;
      el.updState.textContent = 'Не удалось запустить: ' + err.message;
      toast('Обновление: ' + err.message, 'bad');
    });
  }

