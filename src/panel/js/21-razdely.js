  /* ─────────── разделы ─────────── */
  var TABS = ['home', 'display', 'sound', 'ai', 'network', 'scenarios', 'settings', 'system'];
  var TAB_KEY = 'mypult.tab';
  var START_KEY = 'mypult.start-system';

  function loadTabData(name) {
    if (name === 'home') {
      refreshSystem();
      loadAlarms(true);
      refreshPlayer(true);
      syncHomePlayer();
      syncHomeAlarm();
    } else if (name === 'display') {
      loadRingBrightness();
      loadDisplayState();
    } else if (name === 'sound') {
      loadRadio();
      loadVoice();
    } else if (name === 'ai') {
      loadLlm();
    } else if (name === 'network') {
      loadVpn();
      loadBt();
      loadNet();
      loadZb();
      loadIpv6();
    } else if (name === 'settings') {
      loadVoice();
      loadAuth();
      loadSounds();
      loadPanel();
    } else if (name === 'system') {
      loadVoice();
      loadLogs();
      loadSounds();
      refreshSystem();
      loadCharts();
    } else if (name === 'scenarios') {
      loadScenarios();
      loadSounds();
    }
  }

  // Фиксированный шаг сетки: строка 36 px, зазор 12 px. Карточка занимает
  // целое число строк и растягивается на них, поэтому все блоки выровнены
  // по общей вертикальной сетке.
  var PACK_UNIT = 36;
  var PACK_GAP = 12;
  var packTimer = 0;
  var packing = false;
  var cardResizing = false;
  var packObserver = null;


  var INNER_CAPS = { '.log': 240, '.sound-list': 300 };

  function resetInnerCaps(cards) {
    cards.forEach(function (card) {
      Object.keys(INNER_CAPS).forEach(function (selector) {
        Array.prototype.forEach.call(card.querySelectorAll(selector), function (el) {
          el.style.maxHeight = INNER_CAPS[selector] + 'px';
        });
      });
    });
  }

  function fitInnerHeights() {
    Array.prototype.forEach.call(document.querySelectorAll('main.grid > .card'), function (card) {
      if (card.classList.contains('is-hidden')) return;
      var box = card.getBoundingClientRect();
      Array.prototype.forEach.call(card.querySelectorAll('.log, .sound-list'), function (el) {
        var rect = el.getBoundingClientRect();
        // Оставляем место элементам после списка (подписи, итоги, кнопки):
        // иначе список растягивается до низа карточки и обрезает их.
        var after = 0;
        var node = el.nextElementSibling;
        while (node) {
          var nodeStyle = getComputedStyle(node);
          after += node.offsetHeight +
            (parseFloat(nodeStyle.marginTop) || 0) +
            (parseFloat(nodeStyle.marginBottom) || 0);
          node = node.nextElementSibling;
        }
        var available = Math.max(80, Math.round(box.bottom - rect.top - after - 16));
        el.style.maxHeight = available + 'px';
      });
      card.dataset.packH = String(Math.ceil(card.scrollHeight));
    });
  }

  function packCards() {
    if (packing || cardResizing) return;
    if (document.body.classList.contains('card-dragging')) return;
    var grid = document.querySelector('main.grid');
    if (!grid) return;
    packing = true;
    try {
      var cards = Array.prototype.filter.call(grid.children, function (node) {
        return node.classList.contains('card');
      });
      if (!cards.length) return;
      grid.style.gridAutoRows = PACK_UNIT + 'px';
      resetInnerCaps(cards);
      cards.forEach(function (card) {
        if (card.classList.contains('is-hidden')) {
          if (card.dataset.packBox) {
            card.style.height = '';
            delete card.dataset.packBox;
          }
          return;
        }
        // Текущий span и высота — чтобы не трогать карточку без нужды:
        // каждый лишний сброс height вызывал reflow и прыжки прокрутки.
        var currentSpan = parseInt(String(card.style.gridRowEnd || '').replace(/[^0-9]/g, ''), 10) || 0;
        var height;
        var forceFit = !!card.dataset.forceFit;
        if (forceFit) {
          var prevHeight = card.style.height;
          var prevAlign = card.style.alignSelf;
          card.style.height = 'auto';
          card.style.alignSelf = 'start';
          height = Math.ceil(card.getBoundingClientRect().height);
          card.style.height = prevHeight;
          card.style.alignSelf = prevAlign;
          delete card.dataset.forceFit;
        } else {
          // scrollHeight не меньше текущей высоты: карточка растёт, когда
          // содержимому становится тесно, и не «дышит» на каждом опросе.
          height = Math.ceil(card.scrollHeight);
        }
        var span = Math.max(1, Math.ceil((height + PACK_GAP) / (PACK_UNIT + PACK_GAP)));
        var wanted = Number(card.dataset.rows || 0);
        if (wanted > span) span = wanted;
        // Без forceFit карточка не сжимается (чтобы не дёргалась на опросах),
        // но после сворачивания/удаления контента — сжимается до контента
        // или до вручную выставленной высоты.
        if (!forceFit && currentSpan && span < currentSpan) span = currentSpan;
        var box = span * (PACK_UNIT + PACK_GAP) - PACK_GAP;
        var before = Number(card.dataset.packBox || 0);
        if (currentSpan !== span) card.style.gridRowEnd = 'span ' + span;
        if (card.dataset.packBox !== String(box)) {
          card.style.height = box + 'px';
          card.dataset.packBox = String(box);
          if (before && Math.abs(before - box) > 1 && card.animate) {
            card.animate([{ height: before + 'px' }, { height: box + 'px' }],
              { duration: 180, easing: 'ease-out' });
          }
        }
        card.dataset.packH = String(Math.ceil(card.scrollHeight));
      });
      fitInnerHeights();
    } finally {
      packing = false;
    }
  }

  function fitCardToContent(card) {
    if (!card || card.classList.contains('is-hidden')) return;
    var prevHeight = card.style.height;
    var prevAlign = card.style.alignSelf;
    var inner = card.querySelectorAll('.log, .sound-list');
    var prevCaps = [];
    Array.prototype.forEach.call(inner, function (el, index) {
      prevCaps[index] = el.style.maxHeight;
      el.style.maxHeight = (INNER_CAPS[el.classList.contains('log') ? '.log' : '.sound-list']) + 'px';
    });
    card.style.height = 'auto';
    card.style.alignSelf = 'start';
    var height = Math.ceil(card.getBoundingClientRect().height);
    card.style.height = prevHeight;
    card.style.alignSelf = prevAlign;
    Array.prototype.forEach.call(inner, function (el, index) {
      el.style.maxHeight = prevCaps[index];
    });
    var span = Math.max(1, Math.ceil((height + PACK_GAP) / (PACK_UNIT + PACK_GAP)));
    var wanted = Number(card.dataset.rows || 0);
    if (wanted > span) span = wanted;
    var box = span * (PACK_UNIT + PACK_GAP) - PACK_GAP;
    card.style.gridRowEnd = 'span ' + span;
    card.style.height = box + 'px';
    card.dataset.packBox = String(box);
    card.dataset.packH = String(Math.ceil(card.scrollHeight));
  }

  // Раскрытие/сворачивание details внутри карточки: разрешаем карточке
  // и вырасти, и сжаться обратно (forceFit), иначе после сворачивания
  // оставалась пустая высота.
  document.addEventListener('toggle', function (event) {
    var target = event.target;
    if (!target || target.tagName !== 'DETAILS') return;
    var card = target.closest('main.grid > .card');
    if (!card) return;
    card.dataset.forceFit = '1';
    fitCardToContent(card);
    schedulePack();
  }, true);

  function contentChanged() {
    var cards = document.querySelectorAll('main.grid > .card');
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      if (card.classList.contains('is-hidden')) continue;
      var stored = Number(card.dataset.packH || 0);
      if (Math.abs(card.scrollHeight - stored) > 1) return true;
    }
    return false;
  }

  function schedulePack() {
    clearTimeout(packTimer);
    packTimer = setTimeout(packCards, 90);
  }

  function observeCards() {
    if (!window.ResizeObserver) return;
    if (packObserver) packObserver.disconnect();
    packObserver = new ResizeObserver(function () {
      if (!packing && contentChanged()) schedulePack();
    });
    Array.prototype.forEach.call(
      document.querySelectorAll('main.grid > .card'),
      function (card) { packObserver.observe(card); });
    // Раскрыли блок внутри карточки, подгрузился текст или список — высота
    // содержимого меняется, хотя сама карточка ещё нет. Пересобираем сетку.
    var contentObserver = new MutationObserver(function (records) {
      if (packing || cardResizing ||
          document.body.classList.contains('card-dragging')) return;
      records.forEach(function (record) {
        var node = record.target;
        if (node && node.nodeType !== 1) node = node.parentElement;
        var card = node && node.closest ? node.closest('main.grid > .card') : null;
        if (card) card.dataset.forceFit = '1';
      });
      schedulePack();
    });
    var grid = document.querySelector('main.grid');
    if (grid) {
      contentObserver.observe(grid, {
        childList: true,
        subtree: true,
        characterData: false,
        attributes: true,
        attributeFilter: ['open', 'hidden', 'class']
      });
    }
  }

  window.addEventListener('resize', schedulePack);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(schedulePack);

  function showTab(name, save) {
    if (TABS.indexOf(name) < 0) name = 'display';
    document.body.dataset.tab = name;
    Array.prototype.forEach.call(document.querySelectorAll('.card[data-group]'), function (card) {
      card.classList.toggle('is-hidden', card.dataset.group !== name);
    });
    Array.prototype.forEach.call(el.tabs.children, function (btn) {
      btn.setAttribute('aria-pressed', String(btn.dataset.tab === name));
    });
    State.tab = name;
    loadTabData(name);
    if (name === 'network') startBtCardPoll();
    else stopBtCardPoll();
    var activeTab = el.tabs.querySelector('.tab[aria-pressed="true"]');
    var mobileLabel = document.getElementById('mobileTabLabel');
    if (mobileLabel && activeTab) {
      mobileLabel.textContent = activeTab.textContent.trim().replace(/^[^A-Za-zА-Яа-я]+/, '');
    }
    Array.prototype.forEach.call(
      document.querySelectorAll('#mobileTabsMenu [data-tab]'), function (item) {
        item.setAttribute('aria-pressed', String(item.dataset.tab === name));
      });
    var mobileMenu = document.getElementById('mobileTabsMenu');
    var mobileButton = document.getElementById('btnMobileTabs');
    if (mobileMenu) mobileMenu.hidden = true;
    if (mobileButton) mobileButton.setAttribute('aria-expanded', 'false');
    setTimeout(refreshDropdowns, 80);
    schedulePack();
    if (name === 'sound' || name === 'home') startVolumePoll();
    else stopVolumePoll();
    if (name === 'sound' || name === 'home') startPlayerPoll();
    else stopPlayerPoll();
    scheduleStateRefresh();
    if (save !== false) {
      store.set(TAB_KEY, name);
      if (window.scrollTo) window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    if (history.replaceState) history.replaceState(null, '', '#' + name);
  }

