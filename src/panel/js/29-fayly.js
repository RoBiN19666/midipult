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

  function filesKind(item) {
    var ext = '';
    var match = /\.([a-z0-9]+)$/i.exec(item.name || '');
    if (match) ext = match[1].toLowerCase();
    if (item.kind === 'dir') return 'dir';
    if (['zip', 'tar', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar', 'zst', 'deb', 'ipk', 'apk'].indexOf(ext) >= 0) return 'archive';
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'heic', 'avif'].indexOf(ext) >= 0) return 'image';
    if (['mp3', 'ogg', 'opus', 'wav', 'flac', 'm4a', 'aac', 'wma'].indexOf(ext) >= 0) return 'audio';
    if (['mp4', 'mkv', 'avi', 'mov', 'webm', 'm4v'].indexOf(ext) >= 0) return 'video';
    if (['txt', 'md', 'log', 'csv', 'conf', 'cfg', 'ini', 'json', 'xml', 'yaml', 'yml', 'toml', 'env', 'service', 'sh', 'py', 'js', 'css', 'html', 'htm', 'sql'].indexOf(ext) >= 0) return 'text';
    if (['c', 'h', 'cpp', 'hpp', 'go', 'rs', 'java', 'kt', 'lua', 'php'].indexOf(ext) >= 0) return 'code';
    return 'file';
  }

  function filesIcon(item) {
    var kind = filesKind(item);
    var paths = {
      dir: '<path d="M3 7.2A2.2 2.2 0 0 1 5.2 5H9l2 2h7.8A2.2 2.2 0 0 1 21 9.2v8.6A2.2 2.2 0 0 1 18.8 20H5.2A2.2 2.2 0 0 1 3 17.8z"/>',
      file: '<path d="M6.5 3.5h7L18 8v12.5h-11.5z"/><path d="M13.5 3.5V8H18"/>',
      text: '<path d="M6.5 3.5h7L18 8v12.5h-11.5z"/><path d="M13.5 3.5V8H18"/><path d="M9 12h6M9 15.4h6M9 18.8h3.6"/>',
      archive: '<rect x="4.5" y="4" width="15" height="16" rx="2"/><path d="M12 4v4M12 10v2M12 14v2M12 18v1M9.4 5.5h5.2"/>',
      image: '<rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="9" cy="10" r="1.5"/><path d="M4.8 17l4.2-4.2 3.3 3.3 2.4-2.4L19.2 18"/>',
      audio: '<path d="M9 18V6.5l9-2v11.3"/><circle cx="6.8" cy="18" r="2.3"/><circle cx="15.8" cy="15.8" r="2.3"/>',
      video: '<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="M10.5 9.5l4.5 2.5-4.5 2.5z"/>',
      code: '<path d="M8 8l-4 4 4 4M16 8l4 4-4 4M13.5 6l-3 12"/>'
    };
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      (paths[kind] || paths.file) + '</svg>';
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
          ico.className = 'files-ico is-' + filesKind(item);
          ico.innerHTML = filesIcon(item);
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

