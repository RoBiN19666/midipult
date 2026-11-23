  /* ─────────── сценарии ─────────── */
  var SC_TYPES = [
    { id: 'speak', label: 'Сказать', hint: 'текст', key: 'text' },
    { id: 'led', label: 'Кольцо: цвет', hint: '#00E676', key: 'color' },
    { id: 'led_off', label: 'Кольцо: погасить', hint: '' },
    { id: 'radio', label: 'Радио', hint: 'Европа Плюс', key: 'name' },
    { id: 'play_sound', label: 'Свой звук', hint: '', key: 'name' },
    { id: 'play_url', label: 'Проиграть ссылку', hint: 'https://… (mp3, m4a, wav)', key: 'url' },
    { id: 'volume', label: 'Громкость', hint: '0–100', key: 'value' },
    { id: 'clock_text', label: 'Текст на дисплей', hint: 'Доброе утро', key: 'text' },
    { id: 'clock_anim', label: 'Анимация дисплея', hint: '', key: 'anim_id' },
    { id: 'clock_anim_stop', label: 'Анимация: стоп', hint: '' },
    { id: 'vpn', label: 'VPN', hint: 'on / off', key: 'on' },
    { id: 'llm', label: 'Нейросеть', hint: 'on / off', key: 'on' },
    { id: 'pause', label: 'Пауза плеера', hint: '' },
    { id: 'sleep', label: 'Пауза, секунд', hint: '1', key: 'seconds' },
    { id: 'http', label: 'HTTP-запрос', hint: 'https://…', key: 'url' }
  ];

  function scTypeById(id) {
    for (var i = 0; i < SC_TYPES.length; i++) if (SC_TYPES[i].id === id) return SC_TYPES[i];
    return SC_TYPES[0];
  }

  function fillScTypes() {
    SC_TYPES.forEach(function (type) {
      if (!scTypeAvailable(type)) return;
      var option = document.createElement('option');
      option.value = type.id;
      option.textContent = type.label;
      el.scType.appendChild(option);
    });
  }

  function populateSoundPicker(picker, selected) {
    while (picker.options.length) picker.remove(0);
    (State.customSounds || []).forEach(function (item) {
      var option = document.createElement('option');
      option.value = item.id;
      option.textContent = item.name;
      picker.appendChild(option);
    });
    if (!(State.customSounds || []).length) {
      var none = document.createElement('option');
      none.value = '';
      none.textContent = 'Сначала добавьте звук';
      picker.appendChild(none);
    }
    if (selected && !Array.prototype.some.call(picker.options,
        function (option) { return option.value === selected; })) {
      var missing = document.createElement('option');
      missing.value = selected;
      missing.textContent = 'Не найден: ' + selected;
      picker.appendChild(missing);
    }
    if (selected) picker.value = selected;
  }

  function refreshSoundPickers() {
    Array.prototype.forEach.call(document.querySelectorAll('#scActions select[data-value]'),
      function (picker) {
        populateSoundPicker(picker, picker.value);
      });
  }

  function clockAnimById(id) {
    var items = clockPresetItems().concat(State.clockAnims || []);
    for (var i = 0; i < items.length; i++) {
      if (items[i].id === id) return items[i];
    }
    return null;
  }

  function populateClockAnimPicker(picker, selected) {
    while (picker.options.length) picker.remove(0);
    var hidden = State.hiddenPresets || [];
    var items = clockPresetItems().filter(function (item) {
      return hidden.indexOf(item.id) < 0;
    }).concat(State.clockAnims || []);
    items.forEach(function (item) {
      var option = document.createElement('option');
      option.value = item.id;
      option.textContent = item.name + (item.preset ? ' · пресет' : '');
      picker.appendChild(option);
    });
    if (!items.length) {
      var none = document.createElement('option');
      none.value = '';
      none.textContent = 'Сначала создайте анимацию';
      picker.appendChild(none);
    }
    if (selected && !Array.prototype.some.call(picker.options,
        function (option) { return option.value === selected; })) {
      var missing = document.createElement('option');
      missing.value = selected;
      missing.textContent = 'Не найдена: ' + selected;
      picker.appendChild(missing);
    }
    if (selected) picker.value = selected;
  }

  function addScRow(typeId, value, action) {
    var type = scTypeById(typeId || el.scType.value);
    var row = document.createElement('div');
    row.className = 'bt-item';
    row.dataset.type = type.id;

    var select = document.createElement('select');
    select.className = 'net-input';
    select.style.maxWidth = '190px';
    SC_TYPES.forEach(function (item) {
      if (!scTypeAvailable(item)) return;
      var option = document.createElement('option');
      option.value = item.id;
      option.textContent = item.label;
      if (item.id === type.id) option.selected = true;
      select.appendChild(option);
    });

    var input = document.createElement('input');
    input.className = 'net-input';
    input.placeholder = type.hint || '';
    input.value = value == null ? '' : value;
    if (type.id === 'clock_text') {
      input.maxLength = 32;
      input.placeholder = 'До 32 символов';
      input.addEventListener('input', function () {
        if (this.value.length > 32) this.value = this.value.slice(0, 32);
      });
    }

    var picker = document.createElement('select');
    picker.className = 'net-input';
    picker.dataset.value = '1';
    picker.hidden = type.id !== 'play_sound';
    populateSoundPicker(picker, type.id === 'play_sound' ? String(value || '') : '');

    var animPicker = document.createElement('select');
    animPicker.className = 'net-input';
    animPicker.dataset.anim = '1';
    animPicker.hidden = type.id !== 'clock_anim';
    populateClockAnimPicker(animPicker,
      type.id === 'clock_anim' ? String(value || '') : '');
    row._clockAnim = action || null;

    var remove = document.createElement('button');
    remove.className = 'btn sm ghost';
    remove.textContent = '×';
    remove.title = 'Убрать действие';
    remove.addEventListener('click', function () { row.remove(); });

    select.addEventListener('change', function () {
      var next = scTypeById(select.value);
      row.dataset.type = next.id;
      input.placeholder = next.hint || '';
      input.value = '';
      input.hidden = next.id === 'play_sound' || next.id === 'clock_anim' || !next.hint;
      picker.hidden = next.id !== 'play_sound';
      animPicker.hidden = next.id !== 'clock_anim';
      row._clockAnim = null;
      if (next.id === 'play_sound') populateSoundPicker(picker, '');
      if (next.id === 'clock_anim') populateClockAnimPicker(animPicker, '');
      setTimeout(refreshDropdowns, 0);
    });
    input.hidden = type.id === 'play_sound' || type.id === 'clock_anim' || !type.hint;

    row.appendChild(select);
    row.appendChild(input);
    row.appendChild(picker);
    row.appendChild(animPicker);
    row.appendChild(remove);
    el.scActions.appendChild(row);
    enhanceSelect(select);
    enhanceSelect(picker);
    enhanceSelect(animPicker);
    setTimeout(refreshDropdowns, 0);
  }

  function collectScActions() {
    var actions = [];
    Array.prototype.forEach.call(el.scActions.children, function (row) {
      var type = scTypeById(row.dataset.type);
      var input = row.querySelector('input');
      var picker = row.querySelector('select[data-value]');
      var value = type.id === 'play_sound'
        ? (picker ? picker.value : '')
        : (input ? input.value.trim() : '');
      var action = { type: type.id };
      if (type.id === 'clock_anim') {
        var animPicker = row.querySelector('select[data-anim]');
        var chosen = clockAnimById(animPicker ? animPicker.value : '') || row._clockAnim;
        if (!chosen || !chosen.frames || !chosen.frames.length) return;
        action.anim_id = (animPicker && animPicker.value) || chosen.id || '';
        action.name = chosen.name || 'Анимация';
        action.frames = chosen.frames;
        action.duration = chosen.duration || 300;
        actions.push(action);
        return;
      }
      if (type.key === 'text') action.text = value;
      else if (type.key === 'color') action.color = value || '#00E676';
      else if (type.key === 'name') action.name = value;
      else if (type.key === 'value') action.value = parseInt(value, 10) || 30;
      else if (type.key === 'seconds') action.seconds = parseFloat(value) || 1;
      else if (type.key === 'on') action.on = /^(on|вкл|1|true|да)$/i.test(value);
      else if (type.key === 'url') action.url = value;
      actions.push(action);
    });
    return actions;
  }

  function renderScBuiltin(items) {
    el.scBuiltin.innerHTML = '';
    (items || []).forEach(function (item) {
      var row = document.createElement('div');
      row.className = 'bt-item';
      var name = document.createElement('span');
      name.className = 'name';
      name.textContent = item.phrase;
      var what = document.createElement('small');
      what.textContent = item.what;
      row.appendChild(name);
      row.appendChild(what);
      el.scBuiltin.appendChild(row);
    });
  }

  function renderScList(items) {
    el.scList.innerHTML = '';
    if (!items || !items.length) {
      el.scList.innerHTML = '<div class="seg-note">своих сценариев пока нет</div>';
      return;
    }
    items.forEach(function (item) {
      var row = document.createElement('div');
      row.className = 'bt-item';
      var name = document.createElement('span');
      name.className = 'name';
      name.textContent = item.name;
      var phrases = document.createElement('small');
      var schedule = item.schedule || {};
      var when = schedule.time ? ' ⏰ ' + schedule.time : '';
      phrases.textContent = (item.phrases || []).join(', ') + when;
      var run = document.createElement('button');
      run.className = 'btn sm ghost';
      run.textContent = 'Запустить';
      run.addEventListener('click', function () { runScenario(item.name); });
      var edit = document.createElement('button');
      edit.className = 'btn sm ghost';
      edit.textContent = 'Изменить';
      edit.addEventListener('click', function () { loadScenarioToEditor(item); });
      var del = document.createElement('button');
      del.className = 'btn sm ghost';
      del.textContent = 'Удалить';
      del.addEventListener('click', function () { deleteScenario(item.name); });
      row.appendChild(name);
      row.appendChild(phrases);
      row.appendChild(run);
      row.appendChild(edit);
      row.appendChild(del);
      el.scList.appendChild(row);
    });
  }

  function loadScenarios() {
    return cgi('scenarios.py', {}, { timeout: 10000, silent: true }).then(function (data) {
      State.scenarios = data.scenarios || [];
      renderScBuiltin(data.builtin || []);
      renderScList(State.scenarios);
    }).catch(function (err) {
      var note = document.createElement('div');
      note.className = 'seg-note';
      note.textContent = 'сценарии: ' + err.message;
      el.scList.innerHTML = '';
      el.scList.appendChild(note);
    });
  }

  function loadScenarioToEditor(item) {
    el.scName.value = item.name || '';
    el.scPhrases.value = (item.phrases || []).join(', ');
    var schedule = item.schedule || {};
    el.scTime.value = schedule.time || '';
    el.scDays.value = (schedule.days || []).join(',');
    var conditions = item.conditions || {};
    el.scCondVpn.value = conditions.vpn || '';
    el.scCondMusic.value = conditions.music || '';
    el.scActions.innerHTML = '';
    (item.actions || []).forEach(function (action) {
      var type = scTypeById(action.type);
      var value = action[type.key || 'text'] != null ? action[type.key] : '';
      if (type.key === 'on') value = action.on ? 'on' : 'off';
      addScRow(action.type, value, action);
    });
  }

  function saveScenario() {
    var name = el.scName.value.trim();
    var phrases = el.scPhrases.value.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    var actions = collectScActions();
    if (name.length < 2) { toast('Название: минимум 2 символа', 'warn'); return; }
    if (!phrases.length) { toast('Добавьте хотя бы одну фразу', 'warn'); return; }
    if (!actions.length) { toast('Добавьте хотя бы одно действие', 'warn'); return; }
    return withBusy(el.btnScSave, function () {
      var schedule = el.scTime.value ? { time: el.scTime.value, days: el.scDays.value } : {};
      var conditions = { vpn: el.scCondVpn.value, music: el.scCondMusic.value };
      return cgi('scenarios.py', { name: name, phrases: phrases, actions: actions,
        schedule: schedule, conditions: conditions }, { timeout: 20000 })
        .then(function (data) {
          State.scenarios = data.scenarios || [];
          renderScList(State.scenarios);
          toast('Сценарий сохранён: ' + name, 'ok');
        }).catch(function (err) {
          toast('Сценарий: ' + err.message, 'bad');
        });
    });
  }

  function runScenario(name) {
    return cgi('scenarios.py', { run: name }, { timeout: 90000 }).then(function (data) {
      var result = data.result || {};
      toast(result.ok ? ('Выполнено: ' + name) : ('Ошибки: ' + (result.errors || []).join('; ')),
        result.ok ? 'ok' : 'bad');
      refreshPlayer(true);
    }).catch(function (err) {
      toast('Сценарий: ' + err.message, 'bad');
    });
  }

  function deleteScenario(name) {
    return cgi('scenarios.py', { delete: name }, { timeout: 15000 }).then(function (data) {
      State.scenarios = data.scenarios || [];
      renderScList(State.scenarios);
      toast('Удалён: ' + name, 'ok');
    }).catch(function (err) {
      toast('Сценарий: ' + err.message, 'bad');
    });
  }

  function clearScenarioEditor() {
    el.scName.value = '';
    el.scPhrases.value = '';
    el.scActions.innerHTML = '';
  }

