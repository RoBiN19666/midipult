  /* ─────────── кастомные выпадающие списки ─────────── */
  var ddCounter = 0;
  var ddPlacers = [];

  function refreshDropdowns() {
    Array.prototype.forEach.call(ddPlacers, function (fn) {
      try { fn(); } catch (e) {}
    });
  }

  function enhanceSelect(select) {
    if (!select || select.dataset.ddReady === '1' || select.multiple) return;
    var host = select.parentElement;
    if (!host) return;
    select.dataset.ddReady = '1';
    if (window.getComputedStyle(host).position === 'static') host.classList.add('dd-host');
    select.classList.add('dd-native');
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');

    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'dd-btn';
    button.dataset.ddFor = select.id || '';
    button.setAttribute('role', 'combobox');
    button.setAttribute('aria-haspopup', 'listbox');
    button.setAttribute('aria-expanded', 'false');
    var text = document.createElement('span');
    text.className = 'dd-text';
    button.appendChild(text);

    var panel = document.createElement('div');
    panel.className = 'dd-panel';
    panel.id = 'dd-panel-' + (++ddCounter);
    panel.setAttribute('role', 'listbox');
    button.setAttribute('aria-controls', panel.id);
    document.body.appendChild(panel);
    host.appendChild(button);

    var open = false;
    var active = 0;

    function options() {
      return Array.prototype.slice.call(select.options);
    }

    function place() {
      var r = select.getBoundingClientRect();
      button.style.left = select.offsetLeft + 'px';
      button.style.top = select.offsetTop + 'px';
      button.style.width = r.width + 'px';
      button.style.height = r.height + 'px';
      if (!open) return;
      var width = Math.min(Math.max(r.width, 140), window.innerWidth - 16);
      var left = Math.min(Math.max(8, r.left), window.innerWidth - width - 8);
      var want = Math.min(panel.scrollHeight || 0, 320);
      var below = r.bottom + 6;
      var spaceBelow = window.innerHeight - below - 8;
      var spaceAbove = r.top - 8;
      var height = Math.max(80, Math.min(want || 160, 320));
      var top = below;
      panel.style.width = width + 'px';
      panel.style.left = left + 'px';
      if (!(spaceBelow >= Math.min(height, 160) || spaceBelow >= spaceAbove)) {
        top = r.top - height - 6;
      }
      top = Math.max(8, Math.min(top, window.innerHeight - height - 8));
      panel.style.top = top + 'px';
      panel.style.maxHeight = height + 'px';
    }

    function setActive(index) {      var opts = options();
      if (!opts.length) return;
      active = Math.max(0, Math.min(index, opts.length - 1));
      Array.prototype.forEach.call(panel.children, function (item, i) {
        item.classList.toggle('active', i === active);
        item.setAttribute('aria-selected', String(i === select.selectedIndex));
      });
      var item = panel.children[active];
      if (item && item.scrollIntoView) item.scrollIntoView({ block: 'nearest' });
      button.setAttribute('aria-activedescendant', panel.id + '-opt-' + active);
    }

    function render() {
      panel.innerHTML = '';
      options().forEach(function (opt, i) {
        var item = document.createElement('div');
        item.className = 'dd-opt';
        item.id = panel.id + '-opt-' + i;
        item.setAttribute('role', 'option');
        item.setAttribute('aria-selected', String(i === select.selectedIndex));
        item.textContent = opt.text;
        item.addEventListener('click', function () { pick(i); });
        item.addEventListener('mousemove', function () { setActive(i); });
        panel.appendChild(item);
      });
      setActive(select.selectedIndex >= 0 ? select.selectedIndex : 0);
    }

    function pick(index) {
      var opts = options();
      if (index < 0 || index >= opts.length) return;
      select.selectedIndex = index;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      sync();
      close();
      button.focus();
    }

    function outside(ev) {
      if (panel.contains(ev.target) || button.contains(ev.target)) return;
      close();
    }

    function close() {
      if (!open) return;
      open = false;
      panel.classList.remove('open');
      button.setAttribute('aria-expanded', 'false');
      document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    }

    function openPanel() {
      if (button.disabled || open) return;
      render();
      panel.classList.add('open');
      open = true;
      button.setAttribute('aria-expanded', 'true');
      place();
      document.addEventListener('pointerdown', outside, true);
      window.addEventListener('resize', place);
      window.addEventListener('scroll', place, true);
    }

    function sync() {
      var idx = select.selectedIndex;
      text.textContent = idx >= 0 ? select.options[idx].text : '';
      var hidden = !!select.hidden;
      button.style.display = hidden ? 'none' : '';
      button.title = text.textContent;
      if (hidden) close();
      button.disabled = !!select.disabled;
      if (button.disabled) close();
      if (open) { render(); place(); }
      else { place(); }
    }

    button.addEventListener('click', function () {
      if (open) close(); else openPanel();
    });

    button.addEventListener('keydown', function (ev) {
      var opts = options();
      if (!opts.length) return;
      var key = ev.key;
      if (!open && (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Enter' || key === ' ')) {
        ev.preventDefault();
        openPanel();
        return;
      }
      if (!open) return;
      if (key === 'ArrowDown') { ev.preventDefault(); setActive(active + 1); }
      else if (key === 'ArrowUp') { ev.preventDefault(); setActive(active - 1); }
      else if (key === 'Home') { ev.preventDefault(); setActive(0); }
      else if (key === 'End') { ev.preventDefault(); setActive(opts.length - 1); }
      else if (key === 'Enter' || key === ' ') { ev.preventDefault(); pick(active); }
      else if (key === 'Escape') { ev.preventDefault(); close(); }
      else if (key === 'Tab') { close(); }
      else if (key.length === 1) {
        var ch = key.toLowerCase();
        for (var i = 1; i <= opts.length; i++) {
          var idx = (active + i) % opts.length;
          if (opts[idx].text.toLowerCase().charAt(0) === ch) { setActive(idx); break; }
        }
      }
    });

    select.addEventListener('change', sync);
    ddPlacers.push(function () { sync(); place(); });
    if (typeof MutationObserver === 'function') {
      new MutationObserver(sync).observe(select, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'hidden'] });
    }
    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(place).observe(select);
      new ResizeObserver(place).observe(host);
    }
    window.addEventListener('resize', place);

    sync();
    setTimeout(place, 0);
  }

  function enhanceSelects() {
    Array.prototype.forEach.call(document.querySelectorAll('select'), enhanceSelect);
  }

