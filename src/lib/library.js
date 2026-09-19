'use strict';

/**
 * The library: keeps the SQLite catalogue in step with the reports folder and
 * answers every query the dashboard makes.
 *
 * The folders are still the source of truth - drop an .html file in and it is
 * indexed on the next request. The database holds the catalogue built from
 * them, so pages are served by SQL instead of by re-reading every file, and it
 * keeps what a folder cannot: stable URLs, view counts and upload history.
 */

const fs = require('fs');
const path = require('path');

const config = require('../config');
const { open, setSetting, getSetting } = require('./db');
const { slugify, uniqueSlug } = require('./slugify');
const { readReportMetadata, readFolderMetadata } = require('./metadata');

const HTML_EXT = /\.html?$/i;
const IGNORED_DIRS = new Set(['node_modules', '.git', '.svn', '__MACOSX']);
const UNCATEGORIZED = 'Uncategorized';

// Ordering is shared by every query: an explicit "order" first, then the most
// recent report, then the title.
const REPORT_ORDER = `
  ORDER BY CASE WHEN r.sort_order > 0 THEN r.sort_order ELSE 999999 END,
           CASE WHEN r.date_value > 0 THEN r.date_value ELSE r.mtime_ms END DESC,
           r.title COLLATE NOCASE`;

const REPORT_SELECT = `
  SELECT r.*, c.name AS category_name, c.slug AS category_slug
    FROM reports r
    LEFT JOIN categories c ON c.id = r.category_id`;

// Bumped whenever metadata parsing changes, so already-indexed reports are
// re-read instead of keeping results from the previous parser.
const PARSER_VERSION = '2';

let lastSyncAt = 0;

/* -------------------------------------------------------------- scanning -- */

function toPosix(p) {
  return p.split(path.sep).join('/');
}

function encodePath(relPath) {
  return relPath.split('/').map(encodeURIComponent).join('/');
}

function walk(dir, relDir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    console.warn(`[postaryx] Cannot read folder ${dir}: ${err.message}`);
    return out;
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const abs = path.join(dir, entry.name);
    const rel = relDir ? `${relDir}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      out.dirs.push({ abs, rel: toPosix(rel) });
      walk(abs, rel, out);
    } else if (entry.isFile() && HTML_EXT.test(entry.name)) {
      let stat;
      try {
        stat = fs.statSync(abs);
      } catch (err) {
        continue;
      }
      out.files.push({ abs, rel: toPosix(rel), size: stat.size, mtimeMs: stat.mtimeMs });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ sync -- */

function ensureCategory(db, { folder, name, description, sortOrder }) {
  const existing = db.prepare('SELECT * FROM categories WHERE folder = ?').get(folder);
  if (existing) {
    db.prepare('UPDATE categories SET name = ?, description = ?, sort_order = ? WHERE id = ?').run(
      name,
      description,
      sortOrder,
      existing.id
    );
    return existing.id;
  }

  const taken = new Set(db.prepare('SELECT slug FROM categories').all().map((row) => row.slug));
  const slug = uniqueSlug(slugify(name), taken);
  const info = db
    .prepare(
      `INSERT INTO categories (slug, folder, name, description, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(slug, folder, name, description, sortOrder, new Date().toISOString());
  return info.lastInsertRowid;
}

function searchTextFor(meta, relPath, categoryName) {
  return [meta.title, relPath, categoryName, meta.author, meta.date, meta.description, meta.tags.join(' ')]
    .join(' ')
    .toLowerCase();
}

/**
 * Walks the reports folder and writes what changed into the catalogue.
 * Only files whose size or modification time changed are re-parsed.
 */
function syncLibrary() {
  const db = open();
  const root = config.reportsDir;
  const exists = fs.existsSync(root);
  const found = exists ? walk(root, '', { files: [], dirs: [] }) : { files: [], dirs: [] };

  // Folder descriptions come from the optional _category.json files.
  const folderMeta = new Map();
  for (const dir of found.dirs) {
    if (dir.rel.includes('/')) continue; // only top-level folders are categories
    folderMeta.set(dir.rel, readFolderMetadata(dir.abs));
  }

  // A parser change invalidates every cached parse.
  if (getSetting('parser_version') !== PARSER_VERSION) {
    db.prepare('UPDATE reports SET mtime_ms = 0').run();
    setSetting('parser_version', PARSER_VERSION);
  }

  const known = new Map(
    db
      .prepare('SELECT id, rel_path, size_bytes, mtime_ms, slug FROM reports')
      .all()
      .map((row) => [row.rel_path, row])
  );

  const insert = db.prepare(`
    INSERT INTO reports (slug, rel_path, file_name, folder, category_id, title, author,
                         date_text, date_value, tags, description, sort_order, size_bytes,
                         mtime_ms, search_text, first_seen_at, updated_at)
    VALUES (@slug, @relPath, @fileName, @folder, @categoryId, @title, @author,
            @dateText, @dateValue, @tags, @description, @sortOrder, @sizeBytes,
            @mtimeMs, @searchText, @now, @now)`);

  const update = db.prepare(`
    UPDATE reports
       SET file_name = @fileName, folder = @folder, category_id = @categoryId, title = @title,
           author = @author, date_text = @dateText, date_value = @dateValue, tags = @tags,
           description = @description, sort_order = @sortOrder, size_bytes = @sizeBytes,
           mtime_ms = @mtimeMs, search_text = @searchText, updated_at = @now
     WHERE rel_path = @relPath`);

  const touchCategory = db.prepare('UPDATE reports SET category_id = ? WHERE rel_path = ?');

  const stats = { added: 0, updated: 0, removed: 0, unchanged: 0 };
  const categoryIds = new Map();
  const seenPaths = new Set();

  const run = db.transaction(() => {
    for (const file of found.files) {
      seenPaths.add(file.rel);
      const previous = known.get(file.rel);
      const unchanged =
        previous && previous.size_bytes === file.size && previous.mtime_ms === file.mtimeMs;

      const segments = file.rel.split('/');
      const fileName = segments.pop();
      const folder = segments.join('/');
      const topFolder = segments[0] || '';

      if (unchanged) {
        // The file did not change, but its folder's _category.json may have.
        const meta = folderMeta.get(topFolder) || {};
        const name = meta.name || topFolder || UNCATEGORIZED;
        const key = `${topFolder}::${name}`;
        if (!categoryIds.has(key)) {
          categoryIds.set(
            key,
            ensureCategory(db, {
              folder: topFolder,
              name,
              description: meta.description || '',
              sortOrder: meta.order || 0,
            })
          );
        }
        touchCategory.run(categoryIds.get(key), file.rel);
        stats.unchanged += 1;
        continue;
      }

      const parsed = readReportMetadata(file.abs);
      const categoryName = parsed.category || folderMeta.get(topFolder)?.name || topFolder || UNCATEGORIZED;
      const categoryKey = `${topFolder}::${categoryName}`;
      if (!categoryIds.has(categoryKey)) {
        const meta = folderMeta.get(topFolder) || {};
        categoryIds.set(
          categoryKey,
          ensureCategory(db, {
            folder: topFolder,
            name: categoryName,
            description: meta.description || '',
            sortOrder: meta.order || 0,
          })
        );
      }

      const parsedDate = parsed.date ? Date.parse(parsed.date) : NaN;
      const row = {
        relPath: file.rel,
        fileName,
        folder,
        categoryId: categoryIds.get(categoryKey),
        title: parsed.title,
        author: parsed.author,
        dateText: parsed.date,
        dateValue: Number.isFinite(parsedDate) ? parsedDate : 0,
        tags: parsed.tags.join(', '),
        description: parsed.description,
        sortOrder: parsed.order || 0,
        sizeBytes: file.size,
        mtimeMs: file.mtimeMs,
        searchText: searchTextFor(parsed, file.rel, categoryName),
        now: new Date().toISOString(),
      };

      if (previous) {
        update.run(row);
        stats.updated += 1;
      } else {
        // Slugs are assigned once and then kept, so links stay valid.
        const taken = new Set(db.prepare('SELECT slug FROM reports').all().map((r) => r.slug));
        row.slug = uniqueSlug(slugify(`${folder.split('/').join('-')}-${fileName.replace(HTML_EXT, '')}`), taken);
        insert.run(row);
        stats.added += 1;
      }
    }

    // Files that are gone leave the catalogue too.
    for (const relPath of known.keys()) {
      if (!seenPaths.has(relPath)) {
        db.prepare('DELETE FROM reports WHERE rel_path = ?').run(relPath);
        stats.removed += 1;
      }
    }

    // Drop categories that no longer hold anything.
    db.prepare('DELETE FROM categories WHERE id NOT IN (SELECT DISTINCT category_id FROM reports WHERE category_id IS NOT NULL)').run();
  });

  run();

  lastSyncAt = Date.now();
  setSetting('last_sync', new Date(lastSyncAt).toISOString());
  return stats;
}

/* ----------------------------------------------------------------- reads -- */

function formatDate(value) {
  return new Date(value).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function rowToReport(row) {
  const folder = row.folder || '';
  const tags = row.tags ? row.tags.split(',').map((tag) => tag.trim()).filter(Boolean) : [];

  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    fileName: row.file_name,
    relPath: row.rel_path,
    folder,
    folderLabel: folder ? folder.split('/').join(' / ') : 'Reports root',
    categoryName: row.category_name || UNCATEGORIZED,
    categorySlug: row.category_slug || slugify(UNCATEGORIZED),
    author: row.author || '',
    date: row.date_text || '',
    dateValue: row.date_value || 0,
    tags,
    description: row.description || '',
    order: row.sort_order || 0,
    sizeBytes: row.size_bytes,
    sizeLabel: `${Math.max(1, Math.round(row.size_bytes / 1024))} KB`,
    modifiedValue: row.mtime_ms,
    modified: formatDate(row.mtime_ms),
    views: row.views || 0,
    lastViewedAt: row.last_viewed_at || null,
    url: `/r/${row.slug}`,
    rawUrl: `/files/${encodePath(row.rel_path)}`,
  };
}

/** Re-scans when the cached scan is older than SCAN_CACHE_MS. */
function ensureFresh(force) {
  if (force || Date.now() - lastSyncAt > config.scanCacheMs) syncLibrary();
}

function getLibrary(options = {}) {
  ensureFresh(options.force);
  const db = open();

  const reports = db.prepare(`${REPORT_SELECT} ${REPORT_ORDER}`).all().map(rowToReport);

  const categoryRows = db
    .prepare(
      `SELECT c.*, COUNT(r.id) AS count
         FROM categories c
         LEFT JOIN reports r ON r.category_id = c.id
        GROUP BY c.id
        ORDER BY CASE WHEN c.sort_order > 0 THEN c.sort_order ELSE 999999 END,
                 c.name COLLATE NOCASE`
    )
    .all();

  const byCategoryId = new Map();
  for (const report of reports) {
    if (!byCategoryId.has(report.categorySlug)) byCategoryId.set(report.categorySlug, []);
    byCategoryId.get(report.categorySlug).push(report);
  }

  const categories = categoryRows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    folder: row.folder,
    description: row.description || '',
    order: row.sort_order,
    count: row.count,
    reports: byCategoryId.get(row.slug) || [],
  }));

  const tags = new Set();
  for (const report of reports) {
    for (const tag of report.tags) tags.add(tag.toLowerCase());
  }

  const totalViews = db.prepare('SELECT COALESCE(SUM(views), 0) AS total FROM reports').get().total;

  return {
    reportsDir: config.reportsDir,
    reportsDirExists: fs.existsSync(config.reportsDir),
    dbPath: config.dbPath,
    scannedAt: lastSyncAt,
    lastSync: getSetting('last_sync'),
    reports,
    categories,
    recent: reports
      .slice()
      .sort((a, b) => (b.dateValue || b.modifiedValue) - (a.dateValue || a.modifiedValue))
      .slice(0, 6),
    tagCount: tags.size,
    totalViews,
  };
}

function getReport(slug) {
  ensureFresh();
  const row = open()
    .prepare(`${REPORT_SELECT} WHERE r.slug = ?`)
    .get(String(slug || '').toLowerCase());
  return row ? rowToReport(row) : null;
}

function getReportByPath(relPath) {
  const row = open().prepare(`${REPORT_SELECT} WHERE r.rel_path = ?`).get(relPath);
  return row ? rowToReport(row) : null;
}

function getCategory(slug) {
  ensureFresh();
  const db = open();
  const row = db
    .prepare('SELECT * FROM categories WHERE slug = ?')
    .get(String(slug || '').toLowerCase());
  if (!row) return null;

  const reports = db
    .prepare(`${REPORT_SELECT} WHERE r.category_id = ? ${REPORT_ORDER}`)
    .all(row.id)
    .map(rowToReport);

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    folder: row.folder,
    description: row.description || '',
    order: row.sort_order,
    count: reports.length,
    reports,
  };
}

/** Plain-text search over title, path, author, tags and description. */
function searchReports(query) {
  ensureFresh();
  const terms = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return getLibrary().reports;

  const where = terms.map(() => 'r.search_text LIKE ?').join(' AND ');
  const params = terms.map((term) => `%${term}%`);
  return open()
    .prepare(`${REPORT_SELECT} WHERE ${where} ${REPORT_ORDER}`)
    .all(...params)
    .map(rowToReport);
}

/** Counted when a report is opened, so "most read" is possible later. */
function recordView(slug) {
  open()
    .prepare('UPDATE reports SET views = views + 1, last_viewed_at = ? WHERE slug = ?')
    .run(new Date().toISOString(), slug);
}

/** Upload history - the "uploaded_by" column is ready for when login exists. */
function recordUploads(entries, { category = '', uploadedBy = '' } = {}) {
  const db = open();
  const insert = db.prepare(
    `INSERT INTO uploads (file_name, rel_path, category, kind, status, size_bytes, uploaded_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const now = new Date().toISOString();
  db.transaction(() => {
    for (const entry of entries) {
      if (!entry.relPath) continue;
      insert.run(
        entry.file,
        entry.relPath,
        category,
        entry.kind,
        entry.status,
        entry.bytes || 0,
        uploadedBy,
        now
      );
    }
  })();
}

/** Removes one report from the catalogue without waiting for the next scan. */
function removeReport(relPath) {
  open().prepare('DELETE FROM reports WHERE rel_path = ?').run(relPath);
  open()
    .prepare(
      `DELETE FROM categories
        WHERE id NOT IN (SELECT DISTINCT category_id FROM reports WHERE category_id IS NOT NULL)`
    )
    .run();
}

/**
 * Points an existing catalogue row at the file's new path, then re-indexes it.
 * Zeroing mtime_ms makes the next sync treat the file as changed, so its title
 * and category are re-read - while the row (and therefore the slug, the view
 * count and the URL people already have) stays the same one.
 */
function relocateReport(oldRelPath, newRelPath) {
  if (oldRelPath === newRelPath) return;
  open()
    .prepare('UPDATE reports SET rel_path = ?, mtime_ms = 0 WHERE rel_path = ?')
    .run(newRelPath, oldRelPath);
  syncLibrary();
}

/**
 * Forces one report to be re-read on the next sync. Editing a sidecar file
 * does not change the HTML file's timestamp, so the scan would otherwise
 * consider it unchanged.
 */
function reindexReport(relPath) {
  open().prepare('UPDATE reports SET mtime_ms = 0 WHERE rel_path = ?').run(relPath);
  syncLibrary();
}

/** Deletion history - "deleted_by" is ready for when login exists. */
function recordDeletion(report, trashPath, { deletedBy = '' } = {}) {
  open()
    .prepare(
      `INSERT INTO deletions (title, rel_path, category, trash_path, size_bytes, views, deleted_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      report.title,
      report.relPath,
      report.categoryName,
      trashPath,
      report.sizeBytes,
      report.views,
      deletedBy,
      new Date().toISOString()
    );
}

function recentDeletions(limit = 20) {
  return open()
    .prepare('SELECT * FROM deletions ORDER BY id DESC LIMIT ?')
    .all(Math.min(Number(limit) || 20, 200));
}

function recentUploads(limit = 20) {
  return open()
    .prepare('SELECT * FROM uploads ORDER BY id DESC LIMIT ?')
    .all(Math.min(Number(limit) || 20, 200));
}

module.exports = {
  syncLibrary,
  getLibrary,
  getReport,
  getReportByPath,
  getCategory,
  searchReports,
  recordView,
  recordUploads,
  recentUploads,
  removeReport,
  relocateReport,
  reindexReport,
  recordDeletion,
  recentDeletions,
};
