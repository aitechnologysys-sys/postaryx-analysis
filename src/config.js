'use strict';

const path = require('path');

const projectRoot = path.resolve(__dirname, '..');

function resolveFromRoot(value, fallback) {
  if (!value) return path.join(projectRoot, fallback);
  return path.isAbsolute(value) ? value : path.resolve(projectRoot, value);
}

module.exports = {
  projectRoot,
  // Where the HTML reports live. Override with REPORTS_DIR.
  reportsDir: resolveFromRoot(process.env.REPORTS_DIR, 'reports'),
  // SQLite index. The files stay the source of truth - this is the catalogue
  // built from them, plus the things a folder cannot store (view counts,
  // upload history, stable URLs).
  dbPath: resolveFromRoot(process.env.DB_PATH, path.join('data', 'library.db')),
  // Deleted reports are moved here instead of being erased, so a mistake is a
  // "mv" away from being undone.
  trashDir: resolveFromRoot(process.env.TRASH_DIR, path.join('data', 'trash')),
  publicDir: path.join(projectRoot, 'public'),
  port: Number(process.env.PORT || 4000),
  host: process.env.HOST || '0.0.0.0',
  // Folder scan results are cached this long (ms) so a busy dashboard does not
  // re-read every file on every request. New files show up automatically once
  // the cache expires, or immediately via the "Rescan" button.
  scanCacheMs: Number(process.env.SCAN_CACHE_MS || 2000),
  site: {
    name: 'Postaryx Internal Analysis',
    shortName: 'Postaryx',
    tagline: 'Internal analysis library',
  },
};
