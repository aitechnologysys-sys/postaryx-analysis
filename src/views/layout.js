'use strict';

const config = require('../config');
const { escapeHtml, when } = require('./html');

function sidebar(library, active) {
  const categories = library.categories
    .map(
      (category) => `
        <a class="nav-item${active === category.slug ? ' is-active' : ''}" href="/c/${escapeHtml(category.slug)}">
          <span class="nav-item-label">${escapeHtml(category.name)}</span>
          <span class="nav-count">${category.count}</span>
        </a>`
    )
    .join('');

  return `
    <aside class="sidebar" id="sidebar" data-sidebar>
      <a class="brand" href="/" aria-label="${escapeHtml(config.site.name)}">
        <img class="brand-logo on-light" src="/logos/02_Postaryx_Main_Logo_Light.svg"
             alt="${escapeHtml(config.site.shortName)}" width="361" height="68">
        <img class="brand-logo on-dark" src="/logos/01_Postaryx_Main_Logo_Dark.svg"
             alt="" aria-hidden="true" width="361" height="68">
        <span class="brand-caption">${escapeHtml(config.site.tagline)}</span>
      </a>

      <nav class="nav">
        <a class="nav-item${active === 'all' ? ' is-active' : ''}" href="/">
          <span class="nav-item-label">All reports</span>
          <span class="nav-count">${library.reports.length}</span>
        </a>
        <a class="nav-item${active === 'upload' ? ' is-active' : ''}" href="/upload">
          <span class="nav-item-label">Upload a report</span>
          <span class="nav-plus" aria-hidden="true">+</span>
        </a>
        <p class="nav-label">Categories</p>
        ${categories || '<p class="nav-empty">No folders yet</p>'}
      </nav>

      <div class="sidebar-foot">
        <button class="ghost-button" type="button" data-rescan>Rescan folder</button>
        <p class="sidebar-note">Reports are read straight from the <code>reports/</code> folder.</p>
      </div>
    </aside>`;
}

function topbar(query) {
  return `
    <header class="topbar">
      <button class="icon-button only-mobile" type="button" data-menu aria-label="Toggle navigation">☰</button>
      <form class="search" action="/" method="get" role="search">
        <span class="search-icon" aria-hidden="true">⌕</span>
        <input
          id="search"
          class="search-input"
          type="search"
          name="q"
          value="${escapeHtml(query || '')}"
          placeholder="Search reports, tags, teams..."
          autocomplete="off"
          data-search-input
        >
        <kbd class="search-hint">/</kbd>
      </form>
      <button class="icon-button" type="button" data-theme-toggle aria-label="Toggle theme">◐</button>
    </header>`;
}

/** Standard dashboard shell: sidebar + topbar + content. */
function layout({ title, library, body, active = 'all', query = '' }) {
  const pageTitle = title ? `${title} · ${config.site.name}` : config.site.name;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(pageTitle)}</title>
<link rel="stylesheet" href="/css/styles.css">
<link rel="icon" href="/favicon.ico" sizes="32x32">
<link rel="icon" type="image/png" href="/favicon.png" sizes="48x48">
<link rel="apple-touch-icon" href="/favicon.png">
<script>
  // Set the theme before paint so there is no flash.
  try {
    var t = localStorage.getItem('postaryx-theme');
    if (t) document.documentElement.setAttribute('data-theme', t);
  } catch (e) {}
</script>
</head>
<body>
  <div class="shell">
    ${sidebar(library, active)}
    <div class="backdrop" data-backdrop></div>
    <main class="main">
      ${topbar(query)}
      <div class="content">
        ${body}
      </div>
    </main>
  </div>
  <script src="/js/app.js"></script>
</body>
</html>`;
}

/** Minimal shell used by the report viewer (no sidebar, full-height iframe). */
function viewerLayout({ title, body }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · ${escapeHtml(config.site.name)}</title>
<link rel="stylesheet" href="/css/styles.css">
<link rel="icon" href="/favicon.ico" sizes="32x32">
<link rel="icon" type="image/png" href="/favicon.png" sizes="48x48">
<link rel="apple-touch-icon" href="/favicon.png">
<script>
  try {
    var t = localStorage.getItem('postaryx-theme');
    if (t) document.documentElement.setAttribute('data-theme', t);
  } catch (e) {}
</script>
</head>
<body class="viewer-body">
  ${body}
  <script src="/js/app.js"></script>
</body>
</html>`;
}

module.exports = { layout, viewerLayout, when };
