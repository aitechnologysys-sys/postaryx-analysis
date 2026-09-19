'use strict';

const config = require('../config');
const { layout, viewerLayout } = require('./layout');
const { escapeHtml, when } = require('./html');

function tagChips(tags) {
  if (!tags || !tags.length) return '';
  return `<div class="tags">${tags
    .map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`)
    .join('')}</div>`;
}

/**
 * Tag editor. The real value lives in the hidden input (comma separated), so
 * it submits with a normal form and is read back by the dialogs.
 */
function tagEditor(tags, { name = 'tags', id = 'tag-editor' } = {}) {
  return `
    <div class="tag-editor" data-tag-editor>
      <input type="hidden" name="${escapeHtml(name)}" id="${escapeHtml(id)}"
             value="${escapeHtml((tags || []).join(', '))}" data-tag-value>
      <div class="tag-chips" data-tag-list></div>
      <input type="text" class="tag-entry" data-tag-input
             placeholder="Type a tag and press Enter" autocomplete="off" spellcheck="false">
    </div>
    <p class="field-help tag-help">
      Press Enter or comma to add · click a tag to edit it · × to remove
    </p>`;
}


/** The data every manage dialog needs about one report. */
function reportData(report) {
  const ext = (report.fileName.match(/\.html?$/i) || ['.html'])[0];
  return JSON.stringify({
    slug: report.slug,
    title: report.title,
    file: report.fileName,
    base: report.fileName.slice(0, -ext.length),
    ext,
    folder: report.folder,
    relPath: report.relPath,
    category: report.categoryName,
    tags: report.tags,
  });
}

/** The "..." menu shown on a card and in the report viewer. */
function manageMenu(report, { label = '⋯', className = 'icon-button', wrapperClass = '' } = {}) {
  return `
    <details class="menu ${wrapperClass}" data-report-menu data-report="${escapeHtml(reportData(report))}">
      <summary class="${className}" title="Manage this report" aria-label="Manage ${escapeHtml(
        report.title
      )}">${label}</summary>
      <div class="menu-panel">
        <button class="menu-item" type="button" data-manage="tags">Edit tags…</button>
        <button class="menu-item" type="button" data-manage="rename">Rename…</button>
        <button class="menu-item" type="button" data-manage="move">Move to…</button>
        <button class="menu-item is-danger" type="button" data-manage="delete">Delete…</button>
      </div>
    </details>`;
}

/**
 * One set of dialogs per page, filled in from whichever report's menu was
 * used. Rendered on the dashboard, the category pages and the viewer.
 */
function manageDialogs(library) {
  const options = (library ? library.categories : [])
    .map(
      (category) =>
        `<option value="${escapeHtml(category.folder)}">${escapeHtml(category.name)}</option>`
    )
    .join('');

  return `
    <dialog class="modal" data-tags-dialog aria-labelledby="tags-title">
      <h2 class="modal-title" id="tags-title">Edit tags</h2>
      <p class="modal-text">
        Tags for <strong data-manage-title></strong>. They are saved in a small JSON file next to
        the report — the HTML itself is not changed.
      </p>
      ${tagEditor([], { name: 'report-tags', id: 'report-tags' })}
      <p class="modal-error" data-modal-error hidden></p>
      <div class="modal-actions">
        <button class="ghost-button" type="button" data-close-dialog>Cancel</button>
        <button class="primary-button" type="button" data-confirm="tags">Save tags</button>
      </div>
    </dialog>

    <dialog class="modal" data-rename-dialog aria-labelledby="rename-title">
      <h2 class="modal-title" id="rename-title">Rename report</h2>
      <p class="modal-text">
        The name shown in the library for <strong data-manage-title></strong>. It is saved in a
        JSON file next to the report, so it survives a reload, a re-scan and a restart.
      </p>
      <label class="field">
        <span class="field-label">Report name</span>
        <input type="text" data-rename-input autocomplete="off">
      </label>
      <label class="checkbox">
        <input type="checkbox" data-rename-file>
        <span>Also rename the file on disk (currently <code data-rename-current></code>)</span>
      </label>
      <p class="modal-file" data-rename-preview-wrap hidden>
        <code>reports/<span data-rename-preview></span></code>
      </p>
      <p class="modal-error" data-modal-error hidden></p>
      <div class="modal-actions">
        <button class="ghost-button" type="button" data-close-dialog>Cancel</button>
        <button class="primary-button" type="button" data-confirm="rename">Rename</button>
      </div>
    </dialog>

    <dialog class="modal" data-move-dialog aria-labelledby="move-title">
      <h2 class="modal-title" id="move-title">Move report</h2>
      <p class="modal-text">
        Pick the category <strong data-manage-title></strong> belongs in. The file moves to that
        folder and the link keeps working.
      </p>
      <label class="field">
        <span class="field-label">Category</span>
        <select data-move-select>
          ${options}
          <option value="">Uncategorized (reports root)</option>
          <option value="__new__">+ New category…</option>
        </select>
      </label>
      <label class="field" data-move-new hidden>
        <span class="field-label">New category name</span>
        <input type="text" data-move-new-input placeholder="e.g. Customer Research" autocomplete="off">
      </label>
      <p class="modal-file"><code>reports/<span data-move-preview></span></code></p>
      <p class="modal-error" data-modal-error hidden></p>
      <div class="modal-actions">
        <button class="ghost-button" type="button" data-close-dialog>Cancel</button>
        <button class="primary-button" type="button" data-confirm="move">Move report</button>
      </div>
    </dialog>

    <dialog class="modal" data-delete-dialog aria-labelledby="delete-title">
      <h2 class="modal-title" id="delete-title">Are you sure?</h2>
      <p class="modal-text">
        This deletes <strong data-manage-title></strong> from the library.
      </p>
      <p class="modal-file"><code>reports/<span data-delete-path></span></code></p>
      <p class="modal-note">
        The file is moved to the trash folder rather than erased, so it can be restored if this
        was a mistake.
      </p>
      <p class="modal-error" data-modal-error hidden></p>
      <div class="modal-actions">
        <button class="ghost-button" type="button" data-close-dialog>No, keep it</button>
        <button class="danger-button" type="button" data-confirm="delete">Yes, delete it</button>
      </div>
    </dialog>`;
}

function searchIndexOf(report) {
  return [
    report.title,
    report.fileName,
    report.categoryName,
    report.folderLabel,
    report.author,
    report.date,
    report.description,
    report.tags.join(' '),
  ]
    .join(' ')
    .toLowerCase();
}

function reportCard(report, { showCategory = true } = {}) {
  const meta = [
    when(report.author, `<span class="meta-item">${escapeHtml(report.author)}</span>`),
    when(report.date, `<span class="meta-item">${escapeHtml(report.date)}</span>`),
    when(!report.date, `<span class="meta-item">Updated ${escapeHtml(report.modified)}</span>`),
  ].join('');

  return `
    <div class="card" data-card data-search="${escapeHtml(searchIndexOf(report))}">
      <a class="card-link" href="${escapeHtml(report.url)}">
        ${when(showCategory, `<span class="card-kicker">${escapeHtml(report.categoryName)}</span>`)}
        <h3 class="card-title">${escapeHtml(report.title)}</h3>
        ${when(report.description, `<p class="card-text">${escapeHtml(report.description)}</p>`)}
        <div class="card-meta">${meta}</div>
        ${tagChips(report.tags)}
      </a>
      ${manageMenu(report, { className: 'icon-button card-menu-button', wrapperClass: 'card-menu' })}
    </div>`;
}

function emptyState(library) {
  const dir = escapeHtml(library.reportsDir);
  if (!library.reportsDirExists) {
    return `
      <div class="empty">
        <h2>The reports folder is missing</h2>
        <p>Create this folder and drop your HTML reports inside it:</p>
        <pre><code>${dir}</code></pre>
      </div>`;
  }
  return `
    <div class="empty">
      <h2>No reports yet</h2>
      <p>Add an HTML file to a folder inside:</p>
      <pre><code>${dir}/Product Analysis/Competitor Analysis.html</code></pre>
      <p>The folder name becomes the category, and the file appears here automatically.</p>
      <p>Or <a class="link" href="/upload">upload one from the browser</a>.</p>
      <button class="primary-button" type="button" data-rescan>Rescan folder</button>
    </div>`;
}

function statsRow(library) {
  const stats = [
    { label: 'Reports', value: library.reports.length },
    { label: 'Categories', value: library.categories.length },
    { label: 'Tags', value: library.tagCount },
    { label: 'Views', value: library.totalViews },
  ];
  return `<div class="stats">${stats
    .map(
      (stat) => `
      <div class="stat">
        <span class="stat-value">${stat.value}</span>
        <span class="stat-label">${escapeHtml(stat.label)}</span>
      </div>`
    )
    .join('')}</div>`;
}

function homePage(library, query, results) {
  const hasQuery = Boolean(query);

  // With ?q= the page is rendered server-side as a flat result list; while the
  // user types, the same cards are filtered in the browser (public/js/app.js).
  const resultsSection = `
      <section class="section" data-section>
        <div class="section-head">
          <h2 class="section-title">Results for &ldquo;${escapeHtml(query)}&rdquo;</h2>
          <span class="section-count">${(results || []).length} found</span>
        </div>
        <div class="grid">
          ${(results || []).map((report) => reportCard(report)).join('')}
        </div>
      </section>`;

  const sections = library.categories
    .map(
      (category) => `
      <section class="section" data-section>
        <div class="section-head">
          <h2 class="section-title">
            <a href="/c/${escapeHtml(category.slug)}">${escapeHtml(category.name)}</a>
          </h2>
          <span class="section-count">${category.count} report${category.count === 1 ? '' : 's'}</span>
        </div>
        ${when(category.description, `<p class="section-text">${escapeHtml(category.description)}</p>`)}
        <div class="grid">
          ${category.reports.map((report) => reportCard(report, { showCategory: false })).join('')}
        </div>
      </section>`
    )
    .join('');

  const body = `
    <div class="page-head">
      <div>
        <p class="eyebrow">${escapeHtml(config.site.tagline)}</p>
        <h1 class="page-title">${escapeHtml(config.site.name)}</h1>
        <p class="page-text">Every analysis report the team publishes, read straight from the shared folders.</p>
      </div>
      <div class="head-actions">
        ${statsRow(library)}
        <a class="primary-button" href="/upload" style="margin-top:0">Upload report</a>
      </div>
    </div>

    ${when(
      library.recent.length && !hasQuery,
      `<section class="section" data-section data-recent>
        <div class="section-head">
          <h2 class="section-title">Recently updated</h2>
        </div>
        <div class="grid">
          ${library.recent.map((report) => reportCard(report)).join('')}
        </div>
      </section>`
    )}

    ${hasQuery ? resultsSection : sections}
    ${when(!library.reports.length, emptyState(library))}
    <p class="no-results" data-no-results hidden>No reports match your search.</p>
    ${manageDialogs(library)}`;

  return layout({ title: null, library, body, active: 'all', query });
}

function categoryPage(library, category) {
  const body = `
    <div class="page-head">
      <div>
        <p class="eyebrow"><a href="/">All reports</a> / ${escapeHtml(category.name)}</p>
        <h1 class="page-title">${escapeHtml(category.name)}</h1>
        <p class="page-text">${escapeHtml(
          category.description || `${category.count} report${category.count === 1 ? '' : 's'} in this category.`
        )}</p>
      </div>
      <div class="head-actions">
        <a class="primary-button" href="/upload?category=${escapeHtml(category.slug)}" style="margin-top:0">Upload to ${escapeHtml(category.name)}</a>
      </div>
    </div>
    <section class="section" data-section>
      <div class="grid">
        ${category.reports.map((report) => reportCard(report, { showCategory: false })).join('')}
      </div>
    </section>
    <p class="no-results" data-no-results hidden>No reports match your search.</p>
    ${manageDialogs(library)}`;

  return layout({ title: category.name, library, body, active: category.slug });
}

function reportPage(report, library) {
  const meta = [
    when(report.author, `<span class="viewer-meta-item"><b>Created by</b> ${escapeHtml(report.author)}</span>`),
    when(report.date, `<span class="viewer-meta-item"><b>Date</b> ${escapeHtml(report.date)}</span>`),
    when(
      !report.date,
      `<span class="viewer-meta-item"><b>Updated</b> ${escapeHtml(report.modified)}</span>`
    ),
    `<span class="viewer-meta-item"><b>Folder</b> ${escapeHtml(report.folderLabel)}</span>`,
    when(
      report.views > 0,
      `<span class="viewer-meta-item"><b>Opened</b> ${report.views} time${report.views === 1 ? '' : 's'}</span>`
    ),
  ].join('');

  const body = `
    <header class="viewer-bar">
      <a class="viewer-home" href="/" title="All reports" aria-label="Postaryx - all reports">
        <img class="on-light" src="/logos/08_Postaryx_App_Icon_Light_Transparent.svg" alt="Postaryx">
        <img class="on-dark" src="/logos/07_Postaryx_App_Icon_Dark_Transparent.svg" alt="" aria-hidden="true">
      </a>
      <a class="back-button" href="/c/${escapeHtml(report.categorySlug)}">
        <span aria-hidden="true">←</span> ${escapeHtml(report.categoryName)}
      </a>
      <div class="viewer-heading">
        <h1 class="viewer-title">${escapeHtml(report.title)}</h1>
        <div class="viewer-meta">${meta}${tagChips(report.tags)}</div>
      </div>
      <div class="viewer-actions">
        <a class="ghost-button" href="${escapeHtml(report.rawUrl)}" target="_blank" rel="noopener">Open original ↗</a>
        ${manageMenu(report, { label: 'Manage ▾', className: 'ghost-button' })}
        <button class="icon-button" type="button" data-theme-toggle aria-label="Toggle theme">◐</button>
      </div>
    </header>


    ${manageDialogs(library)}

    <iframe
      class="viewer-frame"
      src="${escapeHtml(report.rawUrl)}"
      title="${escapeHtml(report.title)}"
      referrerpolicy="no-referrer"
    ></iframe>`;

  return viewerLayout({ title: report.title, body });
}


function uploadPage(library, preselect) {
  const options = library.categories
    .map(
      (category) =>
        `<option value="${escapeHtml(category.folder)}"${
          preselect === category.slug ? ' selected' : ''
        }>${escapeHtml(category.name)}</option>`
    )
    .join('');

  const body = `
    <div class="page-head">
      <div>
        <p class="eyebrow"><a href="/">All reports</a> / Upload</p>
        <h1 class="page-title">Upload a report</h1>
        <p class="page-text">Add an HTML report to a category. It is saved straight into the
        reports folder, so it behaves exactly like a file copied in by hand.</p>
      </div>
    </div>

    <form class="upload-form" data-upload-form enctype="multipart/form-data" method="post" action="/api/upload">
      <div class="upload-drop" data-drop tabindex="0">
        <input class="upload-input" type="file" name="files" multiple
               accept=".html,.htm,.png,.jpg,.jpeg,.gif,.svg,.webp,.css,.js,.json,.csv,.pdf" data-files>
        <p class="upload-drop-title">Drag HTML files here, or <span class="link">browse</span></p>
        <p class="upload-drop-note">
          Images, CSS and other files the report needs can be added in the same upload -
          they are saved next to it.
        </p>
      </div>

      <ul class="upload-list" data-file-list hidden></ul>

      <div class="field-row">
        <label class="field">
          <span class="field-label">Category</span>
          <select name="category" data-category>
            ${options}
            <option value="">Uncategorized (reports root)</option>
            <option value="__new__">+ New category...</option>
          </select>
        </label>
        <label class="field" data-new-category hidden>
          <span class="field-label">New category name</span>
          <input type="text" name="newCategory" placeholder="e.g. Customer Research" data-new-category-input>
        </label>
      </div>

      <details class="upload-details">
        <summary>Optional report information (name, author, date, tags)</summary>
        <p class="field-help">
          Saved as a small JSON file next to the report, so the HTML itself is never changed.
          Leave empty to use whatever is inside the file.
        </p>
        <div class="field-row">
          <label class="field">
            <span class="field-label">Report name</span>
            <input type="text" name="title" placeholder="Instagram Competitor Analysis">
          </label>
          <label class="field">
            <span class="field-label">Created by</span>
            <input type="text" name="author" placeholder="Marketing Team">
          </label>
        </div>
        <div class="field-row">
          <label class="field">
            <span class="field-label">Date</span>
            <input type="text" name="date" placeholder="September 2026">
          </label>
          <div class="field">
            <span class="field-label">Tags</span>
            ${tagEditor([], { name: 'tags', id: 'upload-tags' })}
          </div>
        </div>
        <label class="field">
          <span class="field-label">Short description</span>
          <textarea name="description" rows="2" placeholder="One or two lines shown on the card."></textarea>
        </label>
      </details>

      <label class="checkbox">
        <input type="checkbox" name="overwrite">
        <span>Replace a file with the same name (otherwise it is saved as <code>name-2.html</code>)</span>
      </label>

      <div class="upload-actions">
        <button class="primary-button" type="submit" data-upload-submit>Upload report</button>
        <a class="ghost-button" href="/">Cancel</a>
        <span class="upload-status" data-upload-status></span>
      </div>

      <div class="progress" data-progress hidden><div class="progress-bar" data-progress-bar></div></div>
    </form>

    <div class="upload-result" data-upload-result hidden></div>`;

  return layout({ title: 'Upload a report', library, body, active: 'upload' });
}

function notFoundPage(library, message) {
  const body = `
    <div class="empty">
      <h2>Not found</h2>
      <p>${escapeHtml(message || 'That report or category is no longer in the reports folder.')}</p>
      <a class="primary-button" href="/">Back to all reports</a>
    </div>`;
  return layout({ title: 'Not found', library, body, active: '' });
}

module.exports = { homePage, categoryPage, reportPage, uploadPage, notFoundPage };
