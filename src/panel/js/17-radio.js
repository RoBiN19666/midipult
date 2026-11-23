  /* ─────────── радио ─────────── */
  function filterRadio() {
    if (!el.radioChips || !el.radioSearch) return;
    var query = (el.radioSearch.value || '').trim().toLowerCase();
    Array.prototype.forEach.call(el.radioChips.children, function (option) {
      var label = option.querySelector('.radio-label');
      var name = label ? (label.textContent || '').toLowerCase() : '';
      option.hidden = !!query && name.indexOf(query) < 0;
    });
  }

  function placeRadioPop() {
    if (!el.radioPop || !el.btnRadioPick || el.radioPop.hidden) return;
    var rect = el.btnRadioPick.getBoundingClientRect();
    var width = Math.max(220, Math.min(420, rect.width));
    var left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    var below = window.innerHeight - rect.bottom - 12;
    var above = rect.top - 12;
    var up = below < 220 && above > below;
    var height = Math.max(140, Math.min(360, up ? above : below));
    el.radioPop.style.position = 'fixed';
    el.radioPop.style.width = width + 'px';
    el.radioPop.style.left = left + 'px';
    el.radioPop.style.maxHeight = height + 'px';
    el.radioPop.style.overflow = 'auto';
    if (up) {
      el.radioPop.style.top = 'auto';
      el.radioPop.style.bottom = (window.innerHeight - rect.top + 6) + 'px';
    } else {
      el.radioPop.style.top = (rect.bottom + 6) + 'px';
      el.radioPop.style.bottom = 'auto';
    }
  }

  function toggleRadioPop(show) {
    if (!el.radioPop || !el.btnRadioPick) return;
    if (show) placeRadioPop();
    el.radioPop.hidden = !show;
    el.btnRadioPick.setAttribute('aria-expanded', show ? 'true' : 'false');
    if (show) {
      el.radioSearch.value = '';
      filterRadio();
      placeRadioPop();
      focusOnDesktop(el.radioSearch, 30);
    }
  }

  function markRadioChip() {
    var current = State.radio ? State.radio.index : null;
    var station = null;
    if (State.radio && State.radio.stations) {
      State.radio.stations.some(function (item) {
        if (item.index === current) { station = item; return true; }
        return false;
      });
    }
    if (el.radioPickName) {
      el.radioPickName.textContent = station ? station.name : 'Выберите станцию';
    }
    if (el.radioPickCount) {
      el.radioPickCount.textContent = String((State.radio && State.radio.stations || []).length);
    }
    Array.prototype.forEach.call(el.radioChips.children, function (option) {
      var active = parseInt(option.dataset.index, 10) === current;
      option.setAttribute('aria-pressed', String(active));
      option.setAttribute('aria-selected', String(active));
    });
  }

  function renderRadio(stations) {
    if (!State.radio) State.radio = { stations: [], index: null };
    State.radio.stations = stations || [];
    el.radioChips.innerHTML = '';
    State.radio.stations.forEach(function (station) {
      var option = document.createElement('button');
      option.type = 'button';
      option.className = 'alarm-station-item radio-option';
      option.dataset.index = station.index;
      option.setAttribute('role', 'option');
      var label = document.createElement('span');
      label.className = 'radio-label';
      label.textContent = station.name;
      option.appendChild(label);
      if (station.url) {
        option.classList.add('radio-url');
        option.title = 'Поток: ' + station.url;
      } else {
        option.title = 'Алиса: ' + (station.query || station.name);
      }
      if (station.custom) {
        var del = document.createElement('span');
        del.className = 'chip-x';
        del.textContent = '×';
        del.title = 'Удалить канал';
        del.addEventListener('click', function (ev) {
          ev.stopPropagation();
          removeRadio(station.name);
        });
        option.appendChild(del);
      }
      el.radioChips.appendChild(option);
    });
    markRadioChip();
    filterRadio();
  }

  function loadRadio() {
    return cgi('radio.py', {}, { timeout: 8000, silent: true }).then(function (data) {
      renderRadio(data.stations || []);
      if (data.stream && data.stream.playing) {
        el.radioStatus.textContent = 'играет свой поток';
      }
    }).catch(function (err) {
      el.radioStatus.textContent = 'радио: ' + err.message;
    });
  }

  function addRadioStream() {
    var name = el.radioName.value.trim();
    var url = el.radioUrl.value.trim();
    if (name.length < 2) {
      toast('Название потока — минимум 2 символа', 'warn');
      el.radioName.focus();
      return;
    }
    if (!/^https?:\/\/[^\s]+$/.test(url)) {
      toast('Ссылка должна начинаться с http:// или https://', 'warn');
      el.radioUrl.focus();
      return;
    }
    return withBusy(el.btnRadioStream, function () {
      return cgi('radio.py', { add: name, url: url }, { timeout: 15000 }).then(function (data) {
        renderRadio(data.stations || []);
        el.radioName.value = '';
        el.radioUrl.value = '';
        toast('Поток добавлен: ' + name, 'ok');
      }).catch(function (err) {
        toast('Радио: ' + err.message, 'bad');
      });
    });
  }

  function addRadio() {
    var name = el.radioName.value.trim();
    if (name.length < 2) {
      toast('Название канала — минимум 2 символа', 'warn');
      return;
    }
    return withBusy(el.btnRadioAdd, function () {
      return cgi('radio.py', { add: name }, { timeout: 15000 }).then(function (data) {
        renderRadio(data.stations || []);
        el.radioName.value = '';
        toast('Канал добавлен: ' + name, 'ok');
      }).catch(function (err) {
        toast('Радио: ' + err.message, 'bad');
      });
    });
  }

  function removeRadio(name) {
    return cgi('radio.py', { remove: name }, { timeout: 15000 }).then(function (data) {
      renderRadio(data.stations || []);
      toast('Канал удалён: ' + name, 'ok');
    }).catch(function (err) {
      toast('Радио: ' + err.message, 'bad');
    });
  }

  function playRadio(index) {
    return withBusy(null, function () {
      el.radioStatus.textContent = 'включаю…';
      return cgi('radio.py', { index: index }, { timeout: 60000 }).then(function (data) {
        if (State.radio) State.radio.index = index;
        markRadioChip();
        if (data.stream) {
          el.radioStatus.textContent = 'поток: ' +
            (((data.station || {}).name) || 'свой канал');
        } else {
          el.radioStatus.textContent = (data.playing ? 'играет: ' : 'загружено: ') +
            (data.title || 'радио');
        }
        refreshPlayer(true);
      }).catch(function (err) {
        el.radioStatus.textContent = 'не включилось';
        if (err.data && err.data.log) log('radio', 'stream', err.data.log, true);
        toast('Радио: ' + err.message, 'bad');
      });
    });
  }

  function stopRadio() {
    return withBusy(null, function () {
      return cgi('radio.py', { stop: 1 }, { timeout: 15000 }).then(function () {
        if (State.radio) State.radio.index = null;
        markRadioChip();
        el.radioStatus.textContent = 'остановлено';
        refreshPlayer(true);
      }).catch(function (err) {
        toast('Радио: ' + err.message, 'bad');
      });
    });
  }

  function stepRadio(delta) {
    if (!State.radio || !State.radio.stations.length) return;
    var count = State.radio.stations.length;
    var current = State.radio.index === null ? 0 : State.radio.index;
    var next = ((current + delta) % count + count) % count;
    playRadio(next);
  }

