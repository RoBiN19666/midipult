  /* ─────────── положение меню ─────────── */
  var MENU_POS_KEY = 'mypult.menuPos';
  var MENU_POSITIONS = ['top', 'bottom', 'left', 'right'];

  function applyMenuPosition(value) {
    var pos = MENU_POSITIONS.indexOf(value) >= 0 ? value : 'top';
    document.body.dataset.menu = pos;
    try { localStorage.setItem(MENU_POS_KEY, pos); } catch (e) {}
    if (el.menuPosition) el.menuPosition.value = pos;
  }

  function menuPositionInit() {
    var saved = 'top';
    try { saved = localStorage.getItem(MENU_POS_KEY) || 'top'; } catch (e) {}
    applyMenuPosition(saved);
    if (el.menuPosition) {
      el.menuPosition.addEventListener('change', function () {
        applyMenuPosition(this.value);
      });
    }
  }
