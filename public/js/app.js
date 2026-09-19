/* Postaryx Internal Analysis - small progressive-enhancement layer. */
(function () {
  'use strict';

  var root = document.documentElement;

  /* ----------------------------------------------------------- theme --- */
  function toggleTheme() {
    var current =
      root.getAttribute('data-theme') ||
      (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    var next = current === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try {
      localStorage.setItem('postaryx-theme', next);
    } catch (err) {
      /* private mode - the theme just won't be remembered */
    }
  }

  document.addEventListener('click', function (event) {
    var themeButton = event.target.closest('[data-theme-toggle]');
    if (themeButton) toggleTheme();

    var menuButton = event.target.closest('[data-menu]');
    if (menuButton) document.querySelector('.shell').classList.toggle('nav-open');

    if (event.target.closest('[data-backdrop]')) {
      document.querySelector('.shell').classList.remove('nav-open');
    }

    var rescan = event.target.closest('[data-rescan]');
    if (rescan) {
      event.preventDefault();
      rescan.disabled = true;
      var label = rescan.textContent;
      rescan.textContent = 'Scanning...';
      fetch('/api/refresh', { method: 'POST' })
        .then(function () { window.location.reload(); })
        .catch(function () {
          rescan.disabled = false;
          rescan.textContent = label;
        });
    }
  });

  /* ---------------------------------------------------------- search --- */
  var input = document.querySelector('[data-search-input]');
  var cards = Array.prototype.slice.call(document.querySelectorAll('[data-card]'));
  var sections = Array.prototype.slice.call(document.querySelectorAll('[data-section]'));
  var noResults = document.querySelector('[data-no-results]');

  function filter(value) {
    var terms = value.toLowerCase().split(/\s+/).filter(Boolean);
    var visible = 0;

    cards.forEach(function (card) {
      var haystack = card.getAttribute('data-search') || '';
      var match = terms.every(function (term) { return haystack.indexOf(term) !== -1; });
      card.hidden = !match;
      if (match) visible += 1;
    });

    sections.forEach(function (section) {
      // "Recently updated" duplicates cards, so hide it while searching.
      if (section.hasAttribute('data-recent') && terms.length) {
        section.hidden = true;
        return;
      }
      var shown = section.querySelectorAll('[data-card]:not([hidden])').length;
      section.hidden = section.querySelectorAll('[data-card]').length > 0 && shown === 0;
    });

    if (noResults) noResults.hidden = visible > 0 || !terms.length;
  }

  if (input && cards.length) {
    input.addEventListener('input', function () { filter(input.value); });
    // On the dashboard the filtering is live, so Enter should not reload.
    // On a category page Enter submits and searches the whole library.
    var form = input.closest('form');
    if (form && window.location.pathname === '/') {
      form.addEventListener('submit', function (event) {
        event.preventDefault();
        filter(input.value);
      });
    }
    if (input.value) filter(input.value);
  }

  /* ---------------------------------------------------------- upload --- */
  var uploadForm = document.querySelector('[data-upload-form]');

  if (uploadForm) {
    var drop = uploadForm.querySelector('[data-drop]');
    var fileInput = uploadForm.querySelector('[data-files]');
    var fileList = uploadForm.querySelector('[data-file-list]');
    var categorySelect = uploadForm.querySelector('[data-category]');
    var newCategoryField = uploadForm.querySelector('[data-new-category]');
    var newCategoryInput = uploadForm.querySelector('[data-new-category-input]');
    var submitButton = uploadForm.querySelector('[data-upload-submit]');
    var status = uploadForm.querySelector('[data-upload-status]');
    var progress = uploadForm.querySelector('[data-progress]');
    var progressBar = uploadForm.querySelector('[data-progress-bar]');
    var result = document.querySelector('[data-upload-result]');

    function formatSize(bytes) {
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
      return (bytes / 1024 / 1024).toFixed(1) + ' MB';
    }

    function isReport(name) {
      return /\.html?$/i.test(name);
    }

    function renderFileList() {
      var files = Array.prototype.slice.call(fileInput.files || []);
      fileList.innerHTML = files
        .map(function (file) {
          return (
            '<li><span class="file-name">' + file.name + '</span>' +
            '<span class="file-kind">' + (isReport(file.name) ? 'report' : 'asset') + '</span>' +
            '<span class="file-size">' + formatSize(file.size) + '</span></li>'
          );
        })
        .join('');
      fileList.hidden = files.length === 0;

      // Pre-fill the report name when a single HTML file is chosen.
      var titleInput = uploadForm.querySelector('input[name="title"]');
      var reports = files.filter(function (file) { return isReport(file.name); });
      if (titleInput && !titleInput.value && reports.length === 1) {
        titleInput.placeholder = reports[0].name.replace(/\.html?$/i, '');
      }
      setStatus('');
    }

    function setStatus(message, isError) {
      status.textContent = message || '';
      status.classList.toggle('is-error', Boolean(isError));
    }

    fileInput.addEventListener('change', renderFileList);

    ['dragenter', 'dragover'].forEach(function (name) {
      drop.addEventListener(name, function (event) {
        event.preventDefault();
        drop.classList.add('is-over');
      });
    });

    ['dragleave', 'drop'].forEach(function (name) {
      drop.addEventListener(name, function () { drop.classList.remove('is-over'); });
    });

    drop.addEventListener('drop', function (event) {
      event.preventDefault();
      if (event.dataTransfer && event.dataTransfer.files.length) {
        fileInput.files = event.dataTransfer.files;
        renderFileList();
      }
    });

    drop.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        fileInput.click();
      }
    });

    categorySelect.addEventListener('change', function () {
      var creating = categorySelect.value === '__new__';
      newCategoryField.hidden = !creating;
      if (creating) newCategoryInput.focus();
      else newCategoryInput.value = '';
    });

    uploadForm.addEventListener('submit', function (event) {
      event.preventDefault();

      var files = Array.prototype.slice.call(fileInput.files || []);
      if (!files.length) return setStatus('Choose at least one file.', true);
      if (!files.some(function (file) { return isReport(file.name); })) {
        return setStatus('Add at least one .html file.', true);
      }
      if (categorySelect.value === '__new__' && !newCategoryInput.value.trim()) {
        return setStatus('Name the new category.', true);
      }

      var uploadTagRoot = uploadForm.querySelector('[data-tag-editor]');
      if (uploadTagRoot && tagEditors.get(uploadTagRoot)) tagEditors.get(uploadTagRoot).flushPending();

      var data = new FormData(uploadForm);
      if (categorySelect.value === '__new__') data.set('category', '');

      var request = new XMLHttpRequest();
      request.open('POST', '/api/upload');

      request.upload.addEventListener('progress', function (event) {
        if (!event.lengthComputable) return;
        progress.hidden = false;
        progressBar.style.width = Math.round((event.loaded / event.total) * 100) + '%';
      });

      request.addEventListener('load', function () {
        submitButton.disabled = false;
        submitButton.textContent = 'Upload report';
        progress.hidden = true;
        progressBar.style.width = '0';

        var payload = {};
        try { payload = JSON.parse(request.responseText); } catch (err) { payload = {}; }

        if (request.status >= 200 && request.status < 300 && payload.ok) {
          showResult(payload);
          uploadForm.reset();
          fileInput.value = '';
          fileList.hidden = true;
          fileList.innerHTML = '';
          newCategoryField.hidden = true;
          setStatus('');
        } else {
          setStatus(payload.error || 'Upload failed.', true);
        }
      });

      request.addEventListener('error', function () {
        submitButton.disabled = false;
        submitButton.textContent = 'Upload report';
        progress.hidden = true;
        setStatus('Upload failed - is the server still running?', true);
      });

      submitButton.disabled = true;
      submitButton.textContent = 'Uploading...';
      setStatus('');
      request.send(data);
    });

    function showResult(payload) {
      var reports = payload.reports || [];
      var assets = payload.assets || [];
      var failed = payload.failed || [];

      var html = '<h3>Uploaded to ' + payload.category + '</h3><ul>';
      reports.forEach(function (report) {
        html += '<li><a href="' + report.url + '">' + (report.title || report.savedAs) + '</a>';
        if (report.status === 'renamed') {
          html += ' <span class="muted">saved as ' + report.savedAs + ' (name was taken)</span>';
        } else if (report.status === 'replaced') {
          html += ' <span class="muted">replaced the existing file</span>';
        }
        html += '</li>';
      });
      assets.forEach(function (asset) {
        html += '<li class="muted">' + asset.savedAs + ' (saved next to the report)</li>';
      });
      failed.forEach(function (item) {
        html += '<li class="muted">' + item.file + ' failed: ' + item.reason + '</li>';
      });
      html += '</ul>';
      if (payload.categoryUrl) {
        html += '<p><a href="' + payload.categoryUrl + '">Open the category</a></p>';
      }

      result.innerHTML = html;
      result.hidden = false;
      result.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  /* ------------------------------------------------------ tag editor --- */
  /**
   * Turns a [data-tag-editor] block into chips you can add to, edit and
   * remove. The hidden input keeps the comma-separated value, so forms and
   * dialogs read it the same way a plain text input would.
   */
  function initTagEditor(root) {
    var hidden = root.querySelector('[data-tag-value]');
    var list = root.querySelector('[data-tag-list]');
    var entry = root.querySelector('[data-tag-input]');

    var tags = (hidden.value || '')
      .split(',')
      .map(function (tag) { return tag.trim(); })
      .filter(Boolean);

    function sync() {
      hidden.value = tags.join(', ');
      list.innerHTML = tags
        .map(function (tag, index) {
          return (
            '<span class="tag-chip">' +
            '<button type="button" class="tag-chip-label" data-tag-edit="' + index + '" ' +
            'title="Click to edit">' + escapeText(tag) + '</button>' +
            '<button type="button" class="tag-chip-remove" data-tag-remove="' + index + '" ' +
            'aria-label="Remove ' + escapeText(tag) + '">×</button></span>'
          );
        })
        .join('');
      list.hidden = tags.length === 0;
    }

    function addFrom(value) {
      value
        .split(',')
        .map(function (tag) { return tag.trim(); })
        .filter(Boolean)
        .forEach(function (tag) {
          var exists = tags.some(function (item) {
            return item.toLowerCase() === tag.toLowerCase();
          });
          if (!exists && tags.length < 12) tags.push(tag);
        });
      entry.value = '';
      sync();
    }

    entry.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' || event.key === ',') {
        event.preventDefault();
        if (entry.value.trim()) addFrom(entry.value);
      } else if (event.key === 'Backspace' && !entry.value && tags.length) {
        // Backspace on an empty box pulls the last tag back for editing.
        entry.value = tags.pop();
        sync();
      }
    });

    // Typing a comma pastes as a separator too.
    entry.addEventListener('input', function () {
      if (entry.value.indexOf(',') !== -1) addFrom(entry.value);
    });

    entry.addEventListener('blur', function () {
      if (entry.value.trim()) addFrom(entry.value);
    });

    list.addEventListener('click', function (event) {
      var remove = event.target.closest('[data-tag-remove]');
      if (remove) {
        tags.splice(Number(remove.getAttribute('data-tag-remove')), 1);
        sync();
        entry.focus();
        return;
      }
      var edit = event.target.closest('[data-tag-edit]');
      if (edit) {
        var index = Number(edit.getAttribute('data-tag-edit'));
        if (entry.value.trim()) addFrom(entry.value);
        entry.value = tags.splice(index, 1)[0];
        sync();
        entry.focus();
        entry.select();
      }
    });

    root.addEventListener('click', function (event) {
      if (event.target === root) entry.focus();
    });

    sync();

    return {
      value: function () { return tags.slice(); },
      flushPending: function () { if (entry.value.trim()) addFrom(entry.value); },
      setTags: function (next) {
        tags = (next || []).slice();
        entry.value = '';
        sync();
      },
    };
  }

  function escapeText(value) {
    return String(value).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  }

  var tagEditors = new WeakMap();
  Array.prototype.forEach.call(document.querySelectorAll('[data-tag-editor]'), function (root) {
    tagEditors.set(root, initTagEditor(root));
  });

  /* ------------------------------------------------- manage a report --- */
  /**
   * One set of dialogs serves every report on the page. Opening a menu item
   * fills them in from the data on that report's menu, so the dashboard, the
   * category pages and the viewer all share this code.
   */
  var dialogs = {
    tags: document.querySelector('[data-tags-dialog]'),
    rename: document.querySelector('[data-rename-dialog]'),
    move: document.querySelector('[data-move-dialog]'),
    'delete': document.querySelector('[data-delete-dialog]'),
  };

  var target = null;
  var reportTagEditor = dialogs.tags
    ? tagEditors.get(dialogs.tags.querySelector('[data-tag-editor]'))
    : null;

  function openDialog(dialog) {
    var error = dialog.querySelector('[data-modal-error]');
    if (error) {
      error.hidden = true;
      error.textContent = '';
    }
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }

  function closeDialog(dialog) {
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
  }

  function showDialogError(dialog, message) {
    var error = dialog.querySelector('[data-modal-error]');
    if (!error) return;
    error.textContent = message;
    error.hidden = false;
  }

  function setBusy(dialog, busy) {
    Array.prototype.forEach.call(dialog.querySelectorAll('button'), function (button) {
      button.disabled = busy;
    });
  }

  /** Close any open "..." menu when the click lands elsewhere. */
  document.addEventListener('click', function (event) {
    Array.prototype.forEach.call(document.querySelectorAll('[data-report-menu][open]'), function (menu) {
      if (!menu.contains(event.target)) menu.open = false;
    });
  });

  /* --- opening ------------------------------------------------------- */
  document.addEventListener('click', function (event) {
    var trigger = event.target.closest('[data-manage]');
    if (!trigger) return;

    var host = trigger.closest('[data-report]');
    if (!host) return;

    event.preventDefault();
    try {
      target = JSON.parse(host.getAttribute('data-report'));
    } catch (err) {
      return;
    }

    var menu = trigger.closest('[data-report-menu]');
    if (menu) menu.open = false;

    var kind = trigger.getAttribute('data-manage');
    var dialog = dialogs[kind];
    if (!dialog) return;

    Array.prototype.forEach.call(dialog.querySelectorAll('[data-manage-title]'), function (slot) {
      slot.textContent = target.title;
    });

    if (kind === 'tags' && reportTagEditor) {
      reportTagEditor.setTags(target.tags);
    }

    if (kind === 'rename') {
      dialog.querySelector('[data-rename-input]').value = target.title;
      dialog.querySelector('[data-rename-current]').textContent = target.file;
      dialog.querySelector('[data-rename-file]').checked = false;
      dialog.querySelector('[data-rename-preview-wrap]').hidden = true;
      updateRenamePreview();
    }

    if (kind === 'move') {
      var select = dialog.querySelector('[data-move-select]');
      var folder = target.folder.split('/')[0];
      select.value = folder;
      // A report in an unlisted folder falls back to the root option.
      if (select.selectedIndex === -1) select.value = '';
      dialog.querySelector('[data-move-new]').hidden = true;
      dialog.querySelector('[data-move-new-input]').value = '';
      updateMovePreview();
    }

    if (kind === 'delete') {
      dialog.querySelector('[data-delete-path]').textContent = target.relPath;
    }

    openDialog(dialog);

    if (kind === 'rename') {
      var input = dialog.querySelector('[data-rename-input]');
      input.focus();
      input.select();
    } else if (kind === 'tags') {
      dialog.querySelector('[data-tag-input]').focus();
    }
  });

  /* --- shared dialog chrome ------------------------------------------ */
  Object.keys(dialogs).forEach(function (kind) {
    var dialog = dialogs[kind];
    if (!dialog) return;

    dialog.addEventListener('click', function (event) {
      if (event.target === dialog) closeDialog(dialog);
      if (event.target.closest('[data-close-dialog]')) closeDialog(dialog);
    });
  });

  /* --- live previews -------------------------------------------------- */
  /** Mirrors the file-name cleaning the server does, for the preview. */
  function fileNameFrom(value) {
    return value
      .replace(/\.html?$/i, '')
      .replace(/[\\/]/g, ' ')
      .replace(/[<>:"|?*]/g, '')
      .replace(/^[.\s]+/, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function updateRenamePreview() {
    if (!dialogs.rename || !target) return;
    var value = dialogs.rename.querySelector('[data-rename-input]').value;
    var name = fileNameFrom(value) || 'untitled';
    var folder = target.folder ? target.folder + '/' : '';
    dialogs.rename.querySelector('[data-rename-preview]').textContent = folder + name + target.ext;
  }

  function chosenCategory() {
    var select = dialogs.move.querySelector('[data-move-select]');
    return select.value === '__new__'
      ? dialogs.move.querySelector('[data-move-new-input]').value.trim()
      : select.value;
  }

  function updateMovePreview() {
    if (!dialogs.move || !target) return;
    var folder = chosenCategory();
    dialogs.move.querySelector('[data-move-preview]').textContent =
      (folder ? folder + '/' : '') + target.file;
  }

  if (dialogs.rename) {
    var renameFileBox = dialogs.rename.querySelector('[data-rename-file]');
    renameFileBox.addEventListener('change', function () {
      dialogs.rename.querySelector('[data-rename-preview-wrap]').hidden = !renameFileBox.checked;
      updateRenamePreview();
    });
    dialogs.rename.querySelector('[data-rename-input]').addEventListener('input', updateRenamePreview);
    dialogs.rename.querySelector('[data-rename-input]').addEventListener('keydown', function (event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        dialogs.rename.querySelector('[data-confirm="rename"]').click();
      }
    });
  }

  if (dialogs.move) {
    var moveSelect = dialogs.move.querySelector('[data-move-select]');
    var moveNewInput = dialogs.move.querySelector('[data-move-new-input]');
    moveSelect.addEventListener('change', function () {
      var creating = moveSelect.value === '__new__';
      dialogs.move.querySelector('[data-move-new]').hidden = !creating;
      if (creating) moveNewInput.focus();
      else moveNewInput.value = '';
      updateMovePreview();
    });
    moveNewInput.addEventListener('input', updateMovePreview);
  }

  /* --- confirming ------------------------------------------------------ */
  function send(dialog, button, request, onDone) {
    var label = button.textContent;
    setBusy(dialog, true);
    button.textContent = 'Working...';

    fetch('/api/reports/' + encodeURIComponent(target.slug), request)
      .then(function (response) {
        return response.json().then(function (payload) {
          return { ok: response.ok, payload: payload };
        });
      })
      .then(function (result) {
        if (result.ok && result.payload.ok) return onDone(result.payload);
        throw new Error(result.payload.error || 'That did not work.');
      })
      .catch(function (err) {
        setBusy(dialog, false);
        button.textContent = label;
        showDialogError(dialog, err.message);
      });
  }

  function patch(dialog, button, body, onDone) {
    send(
      dialog,
      button,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      onDone || function () { window.location.reload(); }
    );
  }

  document.addEventListener('click', function (event) {
    var button = event.target.closest('[data-confirm]');
    if (!button || !target) return;
    var kind = button.getAttribute('data-confirm');
    var dialog = dialogs[kind];

    if (kind === 'tags' && reportTagEditor) {
      reportTagEditor.flushPending();
      patch(dialog, button, { tags: reportTagEditor.value() });
      return;
    }

    if (kind === 'rename') {
      var title = dialog.querySelector('[data-rename-input]').value.trim();
      if (!title) return showDialogError(dialog, 'Give the report a name.');

      var body = { title: title };
      // Renaming the file too is opt-in; the display name alone is the default.
      if (dialog.querySelector('[data-rename-file]').checked) {
        var fileName = fileNameFrom(title);
        if (!fileName) return showDialogError(dialog, 'That name cannot be used for a file.');
        body.name = fileName;
      }
      patch(dialog, button, body);
      return;
    }

    if (kind === 'move') {
      var select = dialog.querySelector('[data-move-select]');
      if (select.value === '__new__' && !chosenCategory()) {
        return showDialogError(dialog, 'Name the new category.');
      }
      patch(dialog, button, { category: chosenCategory() });
      return;
    }

    if (kind === 'delete') {
      send(dialog, button, { method: 'DELETE' }, function (payload) {
        // On a report page there is nothing left to show; elsewhere, refresh.
        if (window.location.pathname.indexOf('/r/') === 0) {
          window.location.href = payload.redirect || '/';
        } else {
          window.location.reload();
        }
      });
    }
  });

  /* ------------------------------------------------------- shortcuts --- */
  document.addEventListener('keydown', function (event) {
    var typing = /^(input|textarea|select)$/i.test((event.target.tagName || ''));
    if (event.key === '/' && !typing && input) {
      event.preventDefault();
      input.focus();
      input.select();
    }
    if (event.key === 'Escape') {
      if (document.activeElement === input) {
        input.value = '';
        filter('');
        input.blur();
      }
      var shell = document.querySelector('.shell');
      if (shell) shell.classList.remove('nav-open');
    }
  });
})();
