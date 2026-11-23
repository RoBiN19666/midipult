  /* ─────────── нейросеть ─────────── */
  function syncVolumeFromDevice() {
    if (State.volumeDragging || volPending) return Promise.resolve();
    // Только что громкость меняли аппаратными кнопками Android — не
    // перебиваем её устаревшим ответом опроса.
    if (Date.now() - volumeRemoteAt < 1500) return Promise.resolve();
    return cgi('volume.py', {}, { timeout: 6000, silent: true }).then(function (data) {
      if (data && typeof data.level === 'number' && data.level !== State.volume) {
        setVolumeUI(data.level);
      }
    }).catch(function () { /* тихо */ });
  }

  var volumePollTimer = null;

  function stopVolumePoll() {
    if (volumePollTimer) clearInterval(volumePollTimer);
    volumePollTimer = null;
  }

  function startVolumePoll() {
    stopVolumePoll();
    syncVolumeFromDevice();
    volumePollTimer = setInterval(function () {
      if (!document.hidden && (State.tab === 'sound' || State.tab === 'home')) syncVolumeFromDevice();
    }, 5000);
  }

  function fillProviderSelect() {
    var list = (State.llm && State.llm.providers) || [];
    var current = (State.llm && State.llm.provider) || 'openai';
    el.llmProviderSelect.innerHTML = '';
    list.forEach(function (provider) {
      var option = document.createElement('option');
      option.value = provider.id;
      option.textContent = provider.title;
      if (provider.id === current) option.selected = true;
      el.llmProviderSelect.appendChild(option);
    });
  }

  function currentProvider() {
    var list = (State.llm && State.llm.providers) || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === State.llm.provider) return list[i];
    }
    return null;
  }

  function toggleCustomModel() {
    el.llmModelCustomWrap.hidden = el.llmModel.value !== '__custom';
  }

  function fillModels(selected) {
    var provider = currentProvider();
    el.llmModel.innerHTML = '';
    (provider ? provider.models : []).forEach(function (name) {
      var option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      el.llmModel.appendChild(option);
    });
    var custom = document.createElement('option');
    custom.value = '__custom';
    custom.textContent = 'Другая модель…';
    el.llmModel.appendChild(custom);

    if (selected) {
      var found = false;
      for (var i = 0; i < el.llmModel.options.length; i++) {
        if (el.llmModel.options[i].value === selected) found = true;
      }
      if (found) {
        el.llmModel.value = selected;
      } else if (selected) {
        el.llmModel.value = '__custom';
        el.llmModelCustom.value = selected;
      }
    }
    toggleCustomModel();
    if (provider && provider.base_url) el.llmBase.value = provider.base_url;
  }

  function selectProvider(id) {
    State.llm.provider = id;
    fillProviderSelect();
    fillModels('');
  }

  function renderProfileChips() {
    var list = (State.llm && State.llm.profiles) || [];
    el.llmProfiles.innerHTML = '';
    list.forEach(function (profile) {
      var chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.textContent = profile.name;
      chip.dataset.id = profile.id;
      chip.setAttribute('aria-pressed', profile.id === State.llm.active ? 'true' : 'false');
      el.llmProfiles.appendChild(chip);
    });
    if (!list.length) {
      el.llmProfiles.innerHTML = '<span class="seg-note">профилей пока нет — добавьте первый</span>';
    }
  }

  function findProfile(id) {
    var list = (State.llm && State.llm.profiles) || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i];
    }
    return null;
  }

  function updateLlmStatus() {
    if (!State.llm) return;
    var active = findProfile(State.llm.active);
    el.llmActive.textContent = active
      ? ('активный: ' + active.name + (active.key_set ? ', ключ есть' : ', ключа нет'))
      : 'профиль не выбран';
    el.llmStatus.textContent = State.llm.enabled
      ? 'Голосовые вопросы: вкл · текст работает всегда'
      : 'Голосовые вопросы: выкл · текст работает всегда';
  }

  function applyProfile(profile) {
    if (!State.llm) return;
    State.llm.active = profile ? profile.id : null;
    if (profile) {
      State.llm.provider = profile.provider || 'openai';
      el.llmName.value = profile.name || '';
      fillModels(profile.model || '');
      el.llmBase.value = profile.base_url || '';
      el.llmKey.value = '';
      el.llmKey.placeholder = profile.key_set ? 'ключ сохранён, можно заменить' : 'ключ не задан';
    } else {
      State.llm.provider = 'openai';
      el.llmName.value = '';
      fillModels('');
      el.llmKey.value = '';
      el.llmKey.placeholder = 'хранится на колонке';
    }
    fillProviderSelect();
    renderProfileChips();
    updateLlmStatus();
  }

  function selectProfile(id) {
    applyProfile(findProfile(id));
  }

  function newProfile() {
    if (!State.llm) return;
    applyProfile(null);
    el.llmName.focus();
    toast('Новый профиль: заполните название, провайдера и ключ', 'ok');
  }

  function applyLlmInfo(data) {
    State.llm = {
      providers: data.providers || [],
      profiles: data.profiles || [],
      active: data.active || null,
      enabled: !!(data.voice_enabled !== undefined ? data.voice_enabled : data.enabled),
      provider: 'openai',
      chats: data.chats || [],
      activeChat: data.active_chat || null
    };
    el.llmEnabled.checked = !!(data.voice_enabled !== undefined ? data.voice_enabled : data.enabled);
    if (el.llmLength) {
      var length = String(data.max_tokens || 260);
      el.llmLength.value = length;
      if (!el.llmLength.value) el.llmLength.value = '260';
    }
    if (el.llmChat) {
      var chatName = data.active_chat_name || 'Чат 1';
      el.llmChat.textContent = chatName;
      el.llmChat.title = chatName;
    }
    var activeChatInfo = State.llm.chats.filter(function (c) { return c.id === State.llm.activeChat; })[0];
    setChatHistoryCount(activeChatInfo ? activeChatInfo.messages : null);
    loadChatHistory();
    if (el.llmSystem) {
      el.llmSystem.value = data.system_prompt || '';
      el.llmSystemStatus.textContent = data.system_prompt ? 'Свой промпт' : 'Стандартный промпт';
    }
    if (el.llmSearch) {
      el.llmSearch.checked = !!data.web_search;
      var mode = data.search_mode || null;
      el.llmSearch.disabled = !mode;
      el.llmSearch.title = mode ? '' : 'У активного провайдера нет встроенного поиска';
      var label = mode === 'openrouter' ? 'родной OpenRouter'
        : mode === 'openai' ? 'родной OpenAI'
          : mode === 'anthropic' ? 'родной Anthropic'
            : mode === 'searx' ? 'свой SearXNG'
              : 'поиск недоступен';
      el.llmSearchStatus.textContent = data.web_search
        ? ('вкл · ' + label) : label;
    }
    if (el.llmFollowUp) {
      el.llmFollowUp.checked = !!data.follow_up;
    }
    if (el.llmSearchUrl && document.activeElement !== el.llmSearchUrl) {
      el.llmSearchUrl.value = data.search_url || '';
    }
    applyLlmContext(data);
    applyProfile(findProfile(data.active));
    updateLlmStatus();
    // Кастомный dropdown мог отрисоваться до ответа llm.py — синхронизируем
    // подпись с только что установленными значениями (длина ответа и т.п.).
    refreshDropdowns();
  }

  /* История активного чата: блок раскрывается по клику, данные берутся из
     llm.py?history=1. Пока блок открыт и виден, он обновляется раз в 15 с —
     так появляются вопросы, заданные голосом. */
  function pluralMessages(n) {
    var m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return 'сообщение';
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'сообщения';
    return 'сообщений';
  }

  function setChatHistoryCount(n) {
    if (!el.llmHistoryCount) return;
    el.llmHistoryCount.textContent = typeof n === 'number' ? (n + ' ' + pluralMessages(n)) : '';
  }

  function assistantLabel() {
    var profile = State.llm && findProfile(State.llm.active);
    return (profile && profile.name) || 'Нейросеть';
  }

  function chatTime(ts) {
    var date = new Date(Number(ts) * 1000);
    if (isNaN(date.getTime())) return '';
    var now = new Date();
    var hm = ('0' + date.getHours()).slice(-2) + ':' + ('0' + date.getMinutes()).slice(-2);
    if (date.toDateString() === now.toDateString()) return hm;
    return ('0' + date.getDate()).slice(-2) + '.' + ('0' + (date.getMonth() + 1)).slice(-2) + ' ' + hm;
  }

  function renderChatHistory(data) {
    var messages = data.messages || [];
    var signature = (data.chat_id || '') + '|' + JSON.stringify(messages);
    setChatHistoryCount(messages.length);
    if (signature === State.chatHistorySig) return;
    State.chatHistorySig = signature;
    var box = el.llmHistory;
    box.textContent = '';
    if (!messages.length) {
      var empty = document.createElement('div');
      empty.className = 'chat-log-empty';
      empty.textContent = 'В этом чате пока нет сообщений.';
      box.appendChild(empty);
      return;
    }
    var who = assistantLabel();
    messages.forEach(function (msg) {
      var item = document.createElement('div');
      item.className = 'chat-msg ' + (msg.role === 'user' ? 'user' : 'assistant');
      var label = document.createElement('span');
      label.className = 'chat-msg-who';
      label.textContent = (msg.role === 'user' ? 'Вы' : who)
        + (msg.ts ? ' · ' + chatTime(msg.ts) : '');
      item.appendChild(label);
      item.appendChild(document.createTextNode(msg.content));
      box.appendChild(item);
    });
    box.scrollTop = box.scrollHeight;
  }

  function loadChatHistory(force) {
    if (!el.llmHistoryBox) return Promise.resolve();
    if (force) State.chatHistorySig = null;
    return cgi('llm.py', { history: 1 }, { timeout: 10000, silent: true })
      .then(renderChatHistory)
      .catch(function (err) {
        State.chatHistorySig = null;
        el.llmHistory.textContent = '';
        var fail = document.createElement('div');
        fail.className = 'chat-log-empty';
        fail.textContent = 'Не удалось загрузить историю: ' + err.message;
        el.llmHistory.appendChild(fail);
      });
  }

  function pollChatHistory() {
    var box = el.llmHistoryBox;
    if (!box || document.hidden || box.offsetParent === null) return;
    loadChatHistory();
  }

  function switchChat(payload) {
    return cgi('llm.py', payload, { timeout: 15000 }).then(function (data) {
      applyLlmInfo(data);
      toast('Чат: ' + (data.active_chat_name || '—'), 'ok');
    }).catch(function (err) {
      toast('Чат: ' + err.message, 'bad');
    });
  }

  function openChatRename() {
    var active = State.llm && State.llm.activeChat;
    if (!active || !el.chatRenameDlg) return;
    el.chatRenameInput.value = el.llmChat ? el.llmChat.textContent : '';
    if (typeof el.chatRenameDlg.showModal === 'function') {
      try { el.chatRenameDlg.showModal(); } catch (e) { return; }
    }
    setTimeout(function () { el.chatRenameInput.focus(); el.chatRenameInput.select(); }, 0);
  }

  function closeChatRename() {
    try { el.chatRenameDlg.close(); } catch (e) {}
  }

  function saveChatRename() {
    var active = State.llm && State.llm.activeChat;
    if (!active) return;
    var name = (el.chatRenameInput.value || '').trim();
    if (!name) { el.chatRenameInput.focus(); return; }
    return cgi('llm.py', { chat_rename: active, chat_name: name }, { timeout: 10000 }).then(function (data) {
      applyLlmInfo(data);
      closeChatRename();
      toast('Чат переименован: ' + (data.active_chat_name || name), 'ok');
    }).catch(function (err) {
      toast('Имя чата: ' + err.message, 'bad');
    });
  }

  function loadLlm() {
    return cgi('llm.py', { info: 1 }, { timeout: 8000, silent: true }).then(function (data) {
      applyLlmInfo(data);
    }).catch(function (err) {
      el.llmStatus.textContent = 'LLM недоступна: ' + err.message;
    });
  }

  /* Местоположение и часовой пояс: модель сама не знает ни даты, ни города,
     llm.py дописывает их к system prompt. Пока пояс не сохранён, подставляем
     пояс браузера — пользователь видит его и сохраняет одной кнопкой. */
  function browserTimezone() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { return ''; }
  }

  function fillTimezoneList() {
    if (!el.llmTimezoneList || el.llmTimezoneList.childElementCount) return;
    var zones = [];
    try { if (Intl.supportedValuesOf) zones = Intl.supportedValuesOf('timeZone'); } catch (e) {}
    var own = browserTimezone();
    if (own && zones.indexOf(own) < 0) zones.unshift(own);
    var frag = document.createDocumentFragment();
    zones.forEach(function (name) {
      var opt = document.createElement('option');
      opt.value = name;
      frag.appendChild(opt);
    });
    el.llmTimezoneList.appendChild(frag);
  }

  function applyLlmContext(data) {
    if (!el.llmLocation) return;
    fillTimezoneList();
    // Пояс станции может быть UTC, поэтому при первом открытии сохраняем пояс
    // браузера сами — иначе модель видит неверное местное время.
    if (!data.timezone && !State.llmTzAutosaved) {
      var detected = browserTimezone();
      if (detected) {
        State.llmTzAutosaved = true;
        cgi('llm.py', { timezone: detected }, { timeout: 10000, silent: true })
          .then(applyLlmInfo)
          .catch(function () {});
      }
    }
    var editing = document.activeElement === el.llmLocation || document.activeElement === el.llmTimezone;
    if (!editing) {
      el.llmLocation.value = data.location || '';
      el.llmTimezone.value = data.timezone || browserTimezone();
    }
    var saved = !!data.timezone;
    el.llmContextStatus.textContent = saved
      ? (data.context || '')
      : 'Пояс не сохранён — используется местное время станции. Проверьте поля и нажмите «Сохранить место».';
  }

  function saveLlmContext() {
    var payload = {
      location: el.llmLocation.value.trim(),
      timezone: el.llmTimezone.value.trim()
    };
    return withBusy(el.btnLlmContext, function () {
      return cgi('llm.py', payload, { timeout: 15000 }).then(function (data) {
        el.llmLocation.blur();
        el.llmTimezone.blur();
        applyLlmInfo(data);
        toast('Местоположение сохранено', 'ok');
      }).catch(function (err) {
        toast('Местоположение: ' + err.message, 'bad');
      });
    });
  }

  function saveLlmSystem() {
    var value = el.llmSystem.value.trim();
    return cgi('llm.py', { system_prompt: value }, { timeout: 15000 }).then(function (data) {
      applyLlmInfo(data);
      toast(value ? 'Промпт сохранён' : 'Вернул стандартный промпт', 'ok');
    }).catch(function (err) {
      toast('Промпт: ' + err.message, 'bad');
    });
  }

  function toggleLlmEnabled() {
    var on = el.llmEnabled.checked ? 1 : 0;
    return cgi('llm.py', { voice_enabled: on }, { timeout: 15000 }).then(function (data) {
      applyLlmInfo(data);
      toast(on ? 'Голосовые вопросы включены' : 'Голосовые вопросы выключены', 'ok');
    }).catch(function (err) {
      el.llmEnabled.checked = !el.llmEnabled.checked;
      toast('Голосовые вопросы: ' + err.message, 'bad');
    });
  }

  function toggleLlmSearch() {
    var on = el.llmSearch.checked ? 1 : 0;
    return cgi('llm.py', { web_search: on }, { timeout: 15000 }).then(function (data) {
      applyLlmInfo(data);
      toast(on ? 'Поиск в интернете включён' : 'Поиск в интернете выключен', 'ok');
    }).catch(function (err) {
      el.llmSearch.checked = !el.llmSearch.checked;
      toast('Поиск: ' + err.message, 'bad');
    });
  }

  function toggleFollowUp() {
    var on = el.llmFollowUp.checked ? 1 : 0;
    return cgi('llm.py', { follow_up: on }, { timeout: 15000 }).then(function (data) {
      applyLlmInfo(data);
      toast(on ? 'Продолжение разговора включено' : 'Продолжение разговора выключено', 'ok');
    }).catch(function (err) {
      el.llmFollowUp.checked = !el.llmFollowUp.checked;
      toast('Продолжение: ' + err.message, 'bad');
    });
  }

  function saveLlmSearchUrl() {
    var url = el.llmSearchUrl.value.trim();
    return cgi('llm.py', { search_url: url }, { timeout: 15000 }).then(function (data) {
      applyLlmInfo(data);
      toast(url ? 'SearXNG сохранён' : 'По умолчанию — Bing', 'ok');
    }).catch(function (err) {
      toast('SearXNG: ' + err.message, 'bad');
    });
  }

  function saveLlm() {
    var model = el.llmModel.value === '__custom'
      ? el.llmModelCustom.value.trim()
      : el.llmModel.value;
    var name = el.llmName.value.trim();
    if (name.length < 2) {
      toast('Название профиля: минимум 2 символа', 'warn');
      return;
    }
    var payload = {
      name: name,
      provider: (State.llm && State.llm.provider) || 'openai',
      model: model,
      base_url: el.llmBase.value.trim(),
      voice_enabled: el.llmEnabled.checked ? 1 : 0
    };
    if (State.llm && State.llm.active) payload.profile_id = State.llm.active;
    var key = el.llmKey.value.trim();
    if (key) payload.key = key;

    return withBusy(el.btnLlmSave, function () {
      return cgi('llm.py', payload, { timeout: 15000 }).then(function (data) {
        el.llmKey.value = '';
        applyLlmInfo(data);
        toast('Профиль сохранён: ' + name, 'ok');
      }).catch(function (err) {
        toast('LLM: ' + err.message, 'bad');
      });
    });
  }

  function renderLlmSources(items, note) {
    if (!el.llmSources) return;
    el.llmSources.innerHTML = '';
    if (!items || !items.length) {
      var empty = !!note;
      el.llmSources.hidden = !empty;
      if (empty) el.llmSources.textContent = 'Поиск: ' + note;
      return;
    }
    el.llmSources.hidden = false;
    var head = document.createElement('div');
    head.className = 'seg-note';
    head.textContent = 'Источники:';
    el.llmSources.appendChild(head);
    items.forEach(function (item) {
      var link = document.createElement('a');
      link.className = 'llm-source';
      link.href = item.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = item.title || item.url;
      link.title = item.url;
      el.llmSources.appendChild(link);
    });
  }

  function askLlm(voice) {
    var prompt = el.llmPrompt.value.trim();
    if (!prompt) { toast('Введите запрос', 'warn'); return; }
    var button = voice && el.btnLlmAskSay ? el.btnLlmAskSay : el.btnLlmAsk;
    return withBusy(button, function () {
      el.llmAnswer.textContent = 'Думаю…';
      el.llmAnswer.classList.remove('empty');
      return cgi('llm.py', { prompt: prompt }, { timeout: 95000 }).then(function (data) {
        State.llmAnswer = data.answer || '';
        el.llmAnswer.textContent = '';
        el.llmAnswer.classList.add('empty');
        el.llmPrompt.value = '';
        renderLlmSources(data.sources, data.search_note);
        var tokens = data.usage && data.usage.total_tokens
          ? ' · ' + data.usage.total_tokens + ' токенов' : '';
        el.llmMeta.textContent = [data.provider, data.model].filter(Boolean).join(' · ') + tokens;
        loadChatHistory(true);
        if (voice && State.llmAnswer) {
          return cgi('speak.py', { text: State.llmAnswer.slice(0, 1900) }, { timeout: 40000 })
            .then(function (res) {
              toast(res && res.started ? 'Алиса читает ответ' : 'Ответ отправлен', 'ok');
            })
            .catch(function (err) {
              toast('Озвучка: ' + err.message, 'bad');
            });
        }
      }).catch(function (err) {
        el.llmAnswer.textContent = 'Ошибка: ' + err.message;
        el.llmAnswer.classList.remove('empty');
        toast('Нейросеть: ' + err.message, 'bad');
      });
    });
  }

  function loadIpv6() {
    return cgi('ipv6.py', {}, { timeout: 10000, silent: true }).then(function (data) {
      if (!data.supported) {
        el.netIpv6.checked = false;
        el.netIpv6.disabled = true;
        el.ipv6Status.textContent = 'IPv6 не поддерживается ядром';
        return;
      }
      el.netIpv6.checked = !data.disabled;
      el.ipv6Status.textContent = data.disabled
        ? 'выключен · используется IPv4'
        : 'включён · при отсутствии IPv6 возможны задержки';
    }).catch(function (err) {
      el.ipv6Status.textContent = 'IPv6: ' + err.message;
    });
  }

  function toggleIpv6() {
    var disabled = !el.netIpv6.checked;
    el.ipv6Status.textContent = disabled ? 'выключаю…' : 'включаю…';
    cgi('ipv6.py', { disabled: disabled }, { timeout: 15000 }).then(function (data) {
      el.netIpv6.checked = !data.disabled;
      el.ipv6Status.textContent = data.disabled
        ? 'выключен · используется IPv4'
        : 'включён · при отсутствии IPv6 возможны задержки';
      toast(data.disabled ? 'IPv6 выключен' : 'IPv6 включён',
        data.disabled ? 'ok' : 'warn');
    }).catch(function (err) {
      el.netIpv6.checked = !el.netIpv6.checked;
      el.ipv6Status.textContent = 'IPv6: ' + err.message;
      toast('IPv6: ' + err.message, 'bad');
    });
  }

