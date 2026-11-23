  /* ─────────── файлы ─────────── */
  var filesCurrent = '/data/mypult';
  var filesEditing = '';

  function filesSize(bytes) {
    var n = Number(bytes) || 0;
    if (n < 1024) return n + ' Б';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' КБ';
    return (n / (1024 * 1024)).toFixed(1) + ' МБ';
  }

  function filesDate(ts) {
    try { return new Date(ts * 1000).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }
    catch (e) { return ''; }
  }

  function filesRaw(path, download) {
    return '/cgi-bin/files.py?action=raw&path=' + encodeURIComponent(path) +
      (download ? '&download=1' : '');
  }

  function filesSetNote(text) {
    if (el.filesNote) el.filesNote.textContent = text || '';
  }

  function filesLoad(path) {
    var target = path || filesCurrent || '/data/mypult';
    filesSetNote('Читаю…');
    return cgi('files.py', { action: 'list', path: target }, { timeout: 15000, silent: true })
      .then(function (data) {
        filesCurrent = data.path || target;
        if (el.filesPath) el.filesPath.value = filesCurrent;
        filesSetNote(data.can_write ?
          'Запись разрешена: /data/mypult и /tmp' :
          'Только чтение. Запись разрешена в /data/mypult и /tmp.');
        if (el.filesRoots) {
          el.filesRoots.textContent = '';
          (data.roots || []).forEach(function (root) {
            var b = document.createElement('button');
            b.type = 'button';
            b.textContent = root.label || root.path;
            b.title = root.path;
            b.addEventListener('click', function () { filesLoad(root.path); });
            el.filesRoots.appendChild(b);
          });
        }
        if (!el.filesList) return;
        el.filesList.textContent = '';
        if (!data.items || !data.items.length) {
          var empty = document.createElement('div');
          empty.className = 'files-empty';
          empty.textContent = 'Пусто';
          el.filesList.appendChild(empty);
          return;
        }
        data.items.forEach(function (item) {
          var row = document.createElement('div');
          row.className = 'files-row';
          var ico = document.createElement('span');
          ico.className = 'files-ico';
          ico.textContent = item.kind === 'dir' ? '▸' : '·';
          var name = document.createElement('div');
          name.className = 'files-name';
          name.textContent = item.name;
          var meta = document.createElement('span');
          meta.className = 'files-meta';
          meta.style.display = 'block';
          meta.style.color = 'var(--muted)';
          meta.style.fontSize = '10px';
          meta.textContent = item.kind === 'dir' ? 'папка' : filesSize(item.size) + ' · ' + filesDate(item.mtime);
          name.appendChild(meta);
          if (item.link) {
            var link = document.createElement('small');
            link.textContent = 'симлинк';
            name.appendChild(link);
          }
          name.addEventListener('click', function () {
            if (item.kind === 'dir') filesLoad(item.path);
            else filesOpenFile(item);
          });
          row.appendChild(ico);
          row.appendChild(name);
          if (item.locked) {
            var lock = document.createElement('span');
            lock.className = 'files-lock';
            lock.textContent = '🔒';
            lock.title = 'Секретный файл';
            row.appendChild(lock);
          }
          var actions = document.createElement('div');
          actions.className = 'files-act';
          if (item.kind === 'file' && !item.locked) {
            var dl = document.createElement('button');
            dl.type = 'button';
            dl.textContent = '↓';
            dl.title = 'Скачать';
            dl.addEventListener('click', function (event) {
              event.stopPropagation();
              window.open(filesRaw(item.path, true), '_blank');
            });
            actions.appendChild(dl);
            var edit = document.createElement('button');
            edit.type = 'button';
            edit.textContent = '✎';
            edit.title = 'Открыть / изменить';
            edit.addEventListener('click', function (event) {
              event.stopPropagation();
              filesOpenFile(item);
            });
            actions.appendChild(edit);
          }
          if (item.writable && !item.locked) {
            var del = document.createElement('button');
            del.type = 'button';
            del.textContent = '×';
            del.title = 'Удалить';
            del.addEventListener('click', function (event) {
              event.stopPropagation();
              if (!window.confirm('Удалить «' + item.name + '»?')) return;
              cgi('files.py', { action: 'delete', path: item.path }, { timeout: 15000 })
                .then(function () { toast('Удалено', 'ok'); filesLoad(filesCurrent); })
                .catch(function (err) { toast('Файлы: ' + err.message, 'bad'); });
            });
            actions.appendChild(del);
          }
          row.appendChild(actions);
          el.filesList.appendChild(row);
        });
      })
      .catch(function (err) {
        filesSetNote('Ошибка: ' + err.message);
        if (el.filesList) {
          el.filesList.textContent = '';
          var box = document.createElement('div');
          box.className = 'files-empty';
          box.textContent = err.message;
          el.filesList.appendChild(box);
        }
        throw err;
      });
  }

  function filesOpenFile(item) {
    cgi('files.py', { action: 'read', path: item.path }, { timeout: 15000, silent: true })
      .then(function (data) {
        if (data.binary) {
          window.open(filesRaw(item.path, false), '_blank');
          return;
        }
        filesEditing = item.path;
        if (el.filesEditorName) el.filesEditorName.textContent = item.name;
        if (el.filesText) el.filesText.value = data.text || '';
        if (el.filesEditor) el.filesEditor.hidden = false;
        if (el.filesText) el.filesText.focus();
      })
      .catch(function (err) { toast('Файлы: ' + err.message, 'bad'); });
  }

  function filesOpen() {
    if (!el.filesDlg) return;
    if (typeof el.filesDlg.showModal === 'function') el.filesDlg.showModal();
    else el.filesDlg.setAttribute('open', '');
    if (el.filesEditor) el.filesEditor.hidden = true;
    filesLoad(filesCurrent);
  }

  function filesCloseEditor() {
    filesEditing = '';
    if (el.filesEditor) el.filesEditor.hidden = true;
  }

  function filesSave() {
    if (!filesEditing) return;
    cgi('files.py', { action: 'write', path: filesEditing, text: el.filesText.value },
      { timeout: 15000 })
      .then(function () { toast('Файл сохранён', 'ok'); filesCloseEditor(); filesLoad(filesCurrent); })
      .catch(function (err) { toast('Файлы: ' + err.message, 'bad'); });
  }

  function filesUploadFile(file) {
    if (!file) return;
    var url = '/cgi-bin/files.py?action=upload&path=' + encodeURIComponent(filesCurrent) +
      '&name=' + encodeURIComponent(file.name);
    filesSetNote('Загружаю ' + file.name + '…');
    fetch(url, {
      method: 'POST',
      headers: { 'X-Requested-With': 'MidiPult' },
      body: file
    }).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
        return data;
      });
    }).then(function () {
      toast('Файл загружен', 'ok');
      filesLoad(filesCurrent);
    }).catch(function (err) {
      filesSetNote('Ошибка: ' + err.message);
      toast('Файлы: ' + err.message, 'bad');
    });
  }

  function filesMkdir() {
    var name = window.prompt('Имя новой папки');
    if (!name) return;
    cgi('files.py', { action: 'mkdir', path: filesCurrent, name: name }, { timeout: 15000 })
      .then(function () { filesLoad(filesCurrent); })
      .catch(function (err) { toast('Файлы: ' + err.message, 'bad'); });
  }

  function filesRename() {
    if (!filesEditing) return;
    var name = window.prompt('Новое имя', filesEditing.split('/').pop());
    if (!name) return;
    cgi('files.py', { action: 'rename', path: filesEditing, name: name }, { timeout: 15000 })
      .then(function () { filesCloseEditor(); filesLoad(filesCurrent); })
      .catch(function (err) { toast('Файлы: ' + err.message, 'bad'); });
  }

