  /* ─────────── порядок карточек ─────────── */
  function initCardDrag() {
    var main = document.querySelector('main');
    var cards = Array.prototype.slice.call(document.querySelectorAll('main .card'));

    function groupCards(card) {
      return Array.prototype.filter.call(
        document.querySelectorAll('main .card'),
        function (item) { return item.dataset.group === card.dataset.group; });
    }

    function updateMoveButtons() {
      cards.forEach(function (card) {
        var box = card.querySelector('.card-move');
        if (!box) return;
        var siblings = groupCards(card);
        var index = siblings.indexOf(card);
        box.children[0].disabled = index <= 0;
        box.children[1].disabled = index < 0 || index >= siblings.length - 1;
      });
    }

    function moveCard(card, direction) {
      var siblings = groupCards(card);
      var target = siblings[siblings.indexOf(card) + direction];
      if (!target) return;
      main.insertBefore(card, direction < 0 ? target : target.nextSibling);
      saveCardOrder();
      updateMoveButtons();
    }

    function layoutRect(card) {
      var parent = card.offsetParent || main;
      var parentBox = parent.getBoundingClientRect();
      return {
        left: parentBox.left + card.offsetLeft,
        top: parentBox.top + card.offsetTop,
        right: parentBox.left + card.offsetLeft + card.offsetWidth,
        bottom: parentBox.top + card.offsetTop + card.offsetHeight,
        width: card.offsetWidth,
        height: card.offsetHeight
      };
    }

    function cardPlacement(card, x, y) {
      var box = card.getBoundingClientRect();
      var middle = box.top + box.height / 2;
      if (y < middle) return false;
      if (y > middle) return true;
      return x > box.left + box.width / 2;
    }

    function pointerTarget(x, y, drag) {
      var node = document.elementFromPoint(x, y);
      var found = node && node.closest ? node.closest('.card') : null;
      if (found && found !== drag && found.dataset.group === drag.dataset.group) {
        return { card: found, after: cardPlacement(found, x, y) };
      }
      var best = null;
      var bestDistance = Infinity;
      groupCards(drag).forEach(function (card) {
        if (card === drag) return;
        var box = card.getBoundingClientRect();
        var dx = x < box.left ? box.left - x : (x > box.right ? x - box.right : 0);
        var dy = y < box.top ? box.top - y : (y > box.bottom ? y - box.bottom : 0);
        var distance = dx * dx + dy * dy;
        if (distance < bestDistance) {
          bestDistance = distance;
          best = card;
        }
      });
      return best ? { card: best, after: cardPlacement(best, x, y) } : null;
    }

    var cardAnimations = new WeakMap();

    function reorderAnimated(drag, target, after) {
      if (!target || target === drag) return;
      var siblings = groupCards(drag);
      var order = siblings.filter(function (card) { return card !== drag; });
      var targetIndex = order.indexOf(target);
      if (targetIndex < 0) return;
      var desired = targetIndex + (after ? 1 : 0);
      var current = siblings.indexOf(drag);
      if (desired === current) return;

      var first = {};
      siblings.forEach(function (card) {
        first[card.dataset.cardId] = card.getBoundingClientRect();
      });
      var reference = order[desired] || null;
      if (reference) {
        main.insertBefore(drag, reference);
      } else {
        var last = order[order.length - 1];
        main.insertBefore(drag, last ? last.nextSibling : null);
      }

      groupCards(drag).forEach(function (card) {
        if (card === drag) return;
        var previous = cardAnimations.get(card);
        if (previous) {
          try { previous.cancel(); } catch (e) { /* уже завершена */ }
        }
        var a = first[card.dataset.cardId];
        var b = card.getBoundingClientRect();
        if (!a) return;
        var dx = a.left - b.left;
        var dy = a.top - b.top;
        if (!dx && !dy) return;
        var anim = card.animate([
          { transform: 'translate3d(' + dx + 'px,' + dy + 'px,0)' },
          { transform: 'translate3d(0,0,0)' }
        ], {
          duration: 190,
          easing: 'cubic-bezier(.2,.7,.2,1)'
        });
        cardAnimations.set(card, anim);
        anim.onfinish = function () {
          if (cardAnimations.get(card) === anim) cardAnimations.delete(card);
        };
      });
    }

    function beginPointerDrag(card, event) {
      if (event.pointerType && event.pointerType !== 'mouse') return;
      if (event.button !== 0 || !event.target.closest || event.target.closest('.card-move, .card-resize')) return;
      event.preventDefault();
      var startX = event.clientX;
      var startY = event.clientY;
      var active = false;
      var ghost = null;
      var offsetX = 0;
      var offsetY = 0;
      var frame = 0;
      var latest = null;
      var lastTarget = null;
      var lastAfter = false;

      function stopFrame() {
        if (frame) {
          cancelAnimationFrame(frame);
          frame = 0;
        }
      }

      function finish() {
        stopFrame();
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', finish);
        document.removeEventListener('pointercancel', finish);
        if (!active) return;
        if (ghost) ghost.remove();
        card.classList.remove('dragging');
        document.body.classList.remove('card-dragging');
        State.dragCard = null;
        saveCardOrder();
        updateMoveButtons();
        schedulePack();
      }

      function processMove() {
        frame = 0;
        if (!active || !latest || !ghost) return;
        ghost.style.transform = 'translate3d(' + (latest.x - offsetX) + 'px,' +
          (latest.y - offsetY) + 'px,0) rotate(.45deg) scale(1.012)';
        if (latest.y < 90) window.scrollBy(0, -16);
        if (latest.y > window.innerHeight - 90) window.scrollBy(0, 16);
        var underNode = document.elementFromPoint(latest.x, latest.y);
        var under = underNode && underNode.closest ? underNode.closest('.card') : null;
        var target;
        if (under === card && lastTarget) {
          target = { card: lastTarget, after: lastAfter };
        } else {
          target = pointerTarget(latest.x, latest.y, card);
        }
        if (target && (target.card !== lastTarget || target.after !== lastAfter)) {
          reorderAnimated(card, target.card, target.after);
          lastTarget = target.card;
          lastAfter = target.after;
        }
      }

      function onMove(move) {
        move.preventDefault();
        latest = { x: move.clientX, y: move.clientY };
        if (!active) {
          if (Math.abs(move.clientX - startX) + Math.abs(move.clientY - startY) < 6) return;
          active = true;
          State.dragCard = card;
          var startRect = card.getBoundingClientRect();
          offsetX = move.clientX - startRect.left;
          offsetY = move.clientY - startRect.top;
          ghost = card.cloneNode(true);
          Array.prototype.forEach.call(ghost.querySelectorAll('[id]'), function (node) {
            node.removeAttribute('id');
          });
          ghost.classList.add('card-ghost');
          ghost.style.width = startRect.width + 'px';
          ghost.style.height = startRect.height + 'px';
          ghost.style.transform = 'translate3d(' + startRect.left + 'px,' +
            startRect.top + 'px,0) rotate(.45deg) scale(1.012)';
          document.body.appendChild(ghost);
          card.classList.add('dragging');
          document.body.classList.add('card-dragging');
        }
        if (!frame) frame = requestAnimationFrame(processMove);
      }

      document.addEventListener('pointermove', onMove, { passive: false });
      document.addEventListener('pointerup', finish);
      document.addEventListener('pointercancel', finish);
    }

    cards.forEach(function (card, index) {
      var head = card.querySelector('h2');
      if (!head) return;
      card.dataset.cardId = head.id || ((head.textContent.trim() || 'card') + '-' + index);
      card.dataset.legacyCardId = (head.textContent.trim() || 'card') + '-' + index;
      head.draggable = false;
      head.addEventListener('pointerdown', function (event) {
        beginPointerDrag(card, event);
      });
      var controls = document.createElement('div');
      controls.className = 'card-move';
      var up = document.createElement('button');
      up.type = 'button';
      up.textContent = '↑';
      up.title = 'Поднять карточку';
      up.setAttribute('aria-label', 'Поднять карточку');
      var down = document.createElement('button');
      down.type = 'button';
      down.textContent = '↓';
      down.title = 'Опустить карточку';
      down.setAttribute('aria-label', 'Опустить карточку');
      up.addEventListener('click', function (event) {
        event.stopPropagation();
        moveCard(card, -1);
      });
      down.addEventListener('click', function (event) {
        event.stopPropagation();
        moveCard(card, 1);
      });
      controls.appendChild(up);
      controls.appendChild(down);
      var header = document.createElement('div');
      header.className = 'card-head';
      card.insertBefore(header, head);
      header.appendChild(head);
      header.appendChild(controls);
      var resize = document.createElement('button');
      resize.type = 'button';
      resize.className = 'card-resize';
      resize.title = 'Потяните за угол: ширина и высота (двойной клик — сброс)';
      resize.setAttribute('aria-label', 'Изменить ширину и высоту карточки');
      card.appendChild(resize);
      resize.addEventListener('pointerdown', function (event) {
        beginResize(card, event);
      });
      resize.addEventListener('dblclick', function (event) {
        event.preventDefault();
        event.stopPropagation();
        var spans = loadMap(SPANS_KEY);
        delete spans[card.dataset.cardId];
        saveMap(SPANS_KEY, spans);
        var rowsMap = loadMap(ROWS_KEY);
        delete rowsMap[card.dataset.cardId];
        saveMap(ROWS_KEY, rowsMap);
        delete card.dataset.rows;
        card.style.gridColumn = '';
        card.style.gridRowEnd = '';
        schedulePack();
      });
    });

    var saved = [];
    try { saved = JSON.parse(localStorage.getItem('mypult-cards') || '[]'); } catch (e) {}
    if (saved.length) {
      var map = {};
      var legacy = {};
      cards.forEach(function (card) {
        map[card.dataset.cardId] = card;
        if (card.dataset.legacyCardId) legacy[card.dataset.legacyCardId] = card;
        (card.dataset.legacyCardIds || '').split(',').forEach(function (id) {
          if (id) legacy[id] = card;
        });
      });
      saved.forEach(function (id) {
        var card = map[id] || legacy[id];
        // «Сервисы музыки» — новая объединённая карточка: не тащим её в конец
        // из старого сохранённого порядка, оставляем рядом с плеером и радио.
        if (!card || card.dataset.cardId === 'providers') return;
        main.appendChild(card);
      });
      // Новые карточки, которых ещё нет в сохранённом порядке, ставим в конец
      // своей группы, а не оставляем вверху.
      cards.forEach(function (card) {
        var id = card.dataset.cardId;
        if (!id || saved.indexOf(id) >= 0) return;
        var group = card.dataset.group;
        var last = null;
        Array.prototype.forEach.call(main.querySelectorAll('.card[data-group="' + group + '"]'),
          function (other) { if (other !== card) last = other; });
        if (last) main.insertBefore(card, last.nextSibling);
        else main.appendChild(card);
      });
    }
    updateMoveButtons();

    /* ---------- размер карточек: тянем за угол ---------- */
    var SPANS_KEY = 'mypult-card-spans';
    var ROWS_KEY = 'mypult-card-rows';

    function loadMap(key) {
      try {
        return JSON.parse(localStorage.getItem(key) || '{}') || {};
      } catch (e) {
        return {};
      }
    }

    function saveMap(key, map) {
      try { localStorage.setItem(key, JSON.stringify(map)); } catch (e) {}
    }

    function minSpan(card) {
      if (card.classList.contains('c-media')) return 5;
      if (card.classList.contains('c-alarm')) return 4;
      if (card.classList.contains('c-radio')) return 4;
      if (card.classList.contains('c-voice')) return 5;
      return 3;
    }

    function contentRows(card) {
      var style = card.style;
      var prevAlign = style.alignSelf;
      var prevHeight = style.height;
      var inner = card.querySelectorAll('.log, .sound-list');
      var prevCaps = [];
      Array.prototype.forEach.call(inner, function (el, index) {
        prevCaps[index] = el.style.maxHeight;
        el.style.maxHeight = (INNER_CAPS[el.classList.contains('log') ? '.log' : '.sound-list']) + 'px';
      });
      style.alignSelf = 'start';
      style.height = 'auto';
      var height = Math.ceil(card.getBoundingClientRect().height);
      style.alignSelf = prevAlign;
      style.height = prevHeight;
      Array.prototype.forEach.call(inner, function (el, index) {
        el.style.maxHeight = prevCaps[index];
      });
      return Math.max(1, Math.ceil((height + PACK_GAP) / (PACK_UNIT + PACK_GAP)));
    }

    function applySizes() {
      var desktop = window.innerWidth > 760;
      var spans = loadMap(SPANS_KEY);
      var rowsMap = loadMap(ROWS_KEY);
      cards.forEach(function (card) {
        var min = minSpan(card);
        var span = desktop ? parseInt(spans[card.dataset.cardId], 10) : 0;
        card.style.gridColumn = (span >= min && span <= 12) ? 'span ' + span : '';
        var rows = desktop ? parseInt(rowsMap[card.dataset.cardId], 10) : 0;
        if (rows >= 1 && rows <= 20) card.dataset.rows = String(rows);
        else delete card.dataset.rows;
      });
    }

    window.PultLayout = {
      mode: function () {
        return window.innerWidth > 760 ? 'wide' : 'phone';
      },
      capture: function () {
        var order = Array.prototype.map.call(
          document.querySelectorAll('main .card'),
          function (card) { return card.dataset.cardId; }
        ).filter(Boolean);
        return {
          order: order,
          spans: loadMap(SPANS_KEY),
          rows: loadMap(ROWS_KEY)
        };
      },
      apply: function (layout) {
        if (!layout) return;
        var byId = {};
        Array.prototype.forEach.call(cards, function (card) {
          if (card.dataset.cardId) byId[card.dataset.cardId] = card;
        });
        var order = Array.isArray(layout.order) ? layout.order : [];
        order.forEach(function (id) {
          var card = byId[id];
          if (card && card.dataset.cardId !== 'providers') main.appendChild(card);
        });
        Array.prototype.forEach.call(cards, function (card) {
          var id = card.dataset.cardId;
          if (id && order.indexOf(id) < 0) main.appendChild(card);
        });
        saveMap(SPANS_KEY, layout.spans || {});
        saveMap(ROWS_KEY, layout.rows || {});
        applySizes();
        saveCardOrder();
        updateMoveButtons();
        schedulePack();
      }
    };

    function beginResize(card, event) {
      if (window.innerWidth <= 760 || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      var grid = card.parentElement;
      var gridStyle = getComputedStyle(grid);
      var columns = (gridStyle.gridTemplateColumns || '').split(' ').filter(Boolean).length || 12;
      var gap = parseFloat(gridStyle.columnGap) || 12;
      var columnWidth = (grid.clientWidth - gap * (columns - 1)) / columns;
      var rect = card.getBoundingClientRect();
      var min = minSpan(card);
      var span = Math.max(min, Math.min(columns,
        Math.round((rect.width + gap) / (columnWidth + gap))));
      var startRows = Math.max(1, Math.round((rect.height + gap) / (PACK_UNIT + PACK_GAP)));
      var startX = event.clientX;
      var startY = event.clientY;
      var startSpan = span;
      var rows = startRows;
      cardResizing = true;
      card.classList.add('resizing');
      document.body.classList.add('card-resizing');

      function onMove(moveEvent) {
        span = Math.max(min, Math.min(columns,
          Math.round(startSpan + (moveEvent.clientX - startX) / (columnWidth + gap))));
        card.style.gridColumn = 'span ' + span;
        var minRows = contentRows(card);
        rows = Math.max(minRows, Math.min(20, Math.round(startRows +
          (moveEvent.clientY - startY) / (PACK_UNIT + PACK_GAP))));
        card.dataset.rows = String(rows);
        card.style.gridRowEnd = 'span ' + rows;
        card.style.height = (rows * (PACK_UNIT + PACK_GAP) - PACK_GAP) + 'px';
      }

      function onUp() {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('pointercancel', onUp);
        card.classList.remove('resizing');
        document.body.classList.remove('card-resizing');
        cardResizing = false;
        card.dataset.forceFit = '1';
        var spans = loadMap(SPANS_KEY);
        spans[card.dataset.cardId] = span;
        saveMap(SPANS_KEY, spans);
        var rowsMap = loadMap(ROWS_KEY);
        rowsMap[card.dataset.cardId] = rows;
        saveMap(ROWS_KEY, rowsMap);
        schedulePack();
      }

      document.addEventListener('pointermove', onMove, { passive: false });
      document.addEventListener('pointerup', onUp);
      document.addEventListener('pointercancel', onUp);
    }

    applySizes();
    window.addEventListener('resize', function () {
      applySizes();
      schedulePack();
    });
    observeCards();

    function clearCardDropTarget() {
      Array.prototype.forEach.call(main.querySelectorAll('.card.drop-before,.card.drop-after'),
        function (card) { card.classList.remove('drop-before', 'drop-after'); });
      State.dropCard = null;
      State.dropAfter = false;
    }

    function cardDropPlacement(card, event) {
      var box = card.getBoundingClientRect();
      var y = event.clientY;
      if (y < box.top + box.height * 0.25) return false;
      if (y > box.top + box.height * 0.75) return true;
      return event.clientX > box.left + box.width / 2;
    }

    function nearestDropTarget(event) {
      var drag = State.dragCard;
      if (!drag) return null;
      var cards = Array.prototype.filter.call(
        main.querySelectorAll('.card[data-group="' + drag.dataset.group + '"]'),
        function (card) {
          return card !== drag && !card.classList.contains('is-hidden') &&
            card.getBoundingClientRect().height > 0;
        });
      var best = null;
      var bestDistance = Infinity;
      cards.forEach(function (card) {
        var box = card.getBoundingClientRect();
        var dx = event.clientX < box.left ? box.left - event.clientX :
          (event.clientX > box.right ? event.clientX - box.right : 0);
        var dy = event.clientY < box.top ? box.top - event.clientY :
          (event.clientY > box.bottom ? event.clientY - box.bottom : 0);
        var distance = dx * dx + dy * dy;
        if (distance < bestDistance) {
          bestDistance = distance;
          best = card;
        }
      });
      if (!best) return null;
      var box = best.getBoundingClientRect();
      var after = event.clientY > box.top + box.height / 2;
      return { card: best, after: after };
    }

    function useDropTarget(target) {
      if (!target || !target.card) return false;
      if (State.dropCard === target.card && State.dropAfter === target.after) return true;
      clearCardDropTarget();
      State.dropCard = target.card;
      State.dropAfter = target.after;
      target.card.classList.add(target.after ? 'drop-after' : 'drop-before');
      return true;
    }

    main.addEventListener('dragover', function (event) {
      if (!State.dragCard) return;
      var card = event.target.closest ? event.target.closest('.card') : null;
      if (card === State.dragCard) card = null;
      if (card && card.dataset.group !== State.dragCard.dataset.group) card = null;
      var target = card
        ? { card: card, after: cardDropPlacement(card, event) }
        : nearestDropTarget(event);
      if (!target) {
        clearCardDropTarget();
        return;
      }
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      useDropTarget(target);
    });
    main.addEventListener('dragleave', function (event) {
      if (!event.relatedTarget || !main.contains(event.relatedTarget)) clearCardDropTarget();
    });
    main.addEventListener('drop', function (event) {
      if (!State.dragCard) return;
      event.preventDefault();
      var card = State.dropCard;
      var after = State.dropAfter;
      if (!card) {
        var target = nearestDropTarget(event);
        card = target && target.card;
        after = target && target.after;
      }
      if (card && card !== State.dragCard &&
          card.dataset.group === State.dragCard.dataset.group) {
        main.insertBefore(State.dragCard, after ? card.nextSibling : card);
      }
      State.dragCard = null;
      clearCardDropTarget();
      saveCardOrder();
      updateMoveButtons();
    });
  }

  function saveCardOrder() {
    var ids = Array.prototype.map.call(document.querySelectorAll('main .card'),
      function (card) { return card.dataset.cardId; }).filter(Boolean);
    try { localStorage.setItem('mypult-cards', JSON.stringify(ids)); } catch (e) {}
  }

