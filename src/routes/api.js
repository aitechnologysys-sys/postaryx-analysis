'use strict';

const path = require('path');
const express = require('express');

const config = require('../config');
const {
  getLibrary,
  getReport,
  getCategory,
  searchReports,
  syncLibrary,
  recentUploads,
  removeReport,
  relocateReport,
  reindexReport,
  recordDeletion,
  recentDeletions,
} = require('../lib/library');
const { trashReport, DeleteError } = require('../lib/trash');
const { relocateFile, OrganizeError } = require('../lib/organize');
const { updateSidecar, normalizeTags } = require('../lib/metadata');

const router = express.Router();

/** Strip the internal Map fields before sending a report over the wire. */
function publicReport(report) {
  const { title, slug, url, rawUrl, relPath, categoryName, categorySlug, folderLabel } = report;
  return {
    slug,
    title,
    url,
    rawUrl,
    path: relPath,
    category: categoryName,
    categorySlug,
    folder: folderLabel,
    author: report.author || null,
    date: report.date || null,
    tags: report.tags,
    description: report.description || null,
    size: report.sizeBytes,
    views: report.views,
    lastViewedAt: report.lastViewedAt,
    modified: new Date(report.modifiedValue).toISOString(),
  };
}

router.get('/reports', (req, res) => {
  const query = String(req.query.q || '').trim();
  const reports = query ? searchReports(query) : getLibrary().reports;
  res.json({ count: reports.length, query: query || null, reports: reports.map(publicReport) });
});

router.get('/categories', (req, res) => {
  const library = getLibrary();
  res.json({
    count: library.categories.length,
    categories: library.categories.map((category) => ({
      slug: category.slug,
      name: category.name,
      folder: category.folder,
      description: category.description || null,
      url: `/c/${category.slug}`,
      count: category.count,
      reports: category.reports.map(publicReport),
    })),
  });
});

/** Forces an immediate re-scan of the reports folder into the catalogue. */
router.post('/refresh', (req, res) => {
  const changes = syncLibrary();
  const library = getLibrary();
  res.json({
    ok: true,
    changes,
    reports: library.reports.length,
    categories: library.categories.length,
    scannedAt: new Date(library.scannedAt).toISOString(),
  });
});

/** Recent uploads, newest first. */
router.get('/uploads', (req, res) => {
  res.json({ uploads: recentUploads(req.query.limit) });
});

/** Recent deletions, newest first - each row says where the file went. */
router.get('/deletions', (req, res) => {
  res.json({ deletions: recentDeletions(req.query.limit) });
});

/**
 * Edits one report:
 *   { title }    the name shown in the library
 *   { name }     renames the file on disk
 *   { category } / { newCategory }   moves it to another folder
 *   { tags }     rewrites its tag list
 *
 * The report keeps its URL through all of them. Title and tags are written to
 * the sidecar JSON file next to the report - the HTML is never modified - so
 * they survive a re-scan, a restart and a rebuilt database.
 */
router.patch('/reports/:slug', (req, res) => {
  const report = getReport(req.params.slug);
  if (!report) {
    return res.status(404).json({ ok: false, error: 'That report no longer exists.' });
  }

  const body = req.body || {};
  const name = body.name === undefined ? undefined : String(body.name);
  const newCategory = String(body.newCategory || '').trim();
  let category;
  if (newCategory) category = newCategory;
  else if (body.category !== undefined) category = String(body.category);

  const tags = body.tags === undefined ? undefined : normalizeTags(body.tags);
  const title = body.title === undefined ? undefined : String(body.title).trim();

  if (name === undefined && category === undefined && tags === undefined && title === undefined) {
    return res.status(400).json({ ok: false, error: 'Nothing to change.' });
  }
  if (title !== undefined && !title) {
    return res.status(400).json({ ok: false, error: 'Give the report a name.' });
  }

  try {
    const moved = relocateFile(report.relPath, { name, category });
    if (!moved.unchanged) {
      relocateReport(moved.from, moved.to);
    }

    // Written after any move, so the sidecar lands next to the file.
    const patch = {};
    if (tags !== undefined) patch.tags = tags;
    if (title !== undefined) patch.title = title;
    if (Object.keys(patch).length) {
      updateSidecar(path.join(config.reportsDir, moved.to), patch);
      reindexReport(moved.to);
    }

    const updated = getReport(report.slug);
    res.json({
      ok: true,
      unchanged: moved.unchanged,
      from: moved.from,
      to: moved.to,
      sidecars: moved.sidecars,
      report: updated
        ? {
            slug: updated.slug,
            title: updated.title,
            url: updated.url,
            path: updated.relPath,
            category: updated.categoryName,
            categoryUrl: `/c/${updated.categorySlug}`,
          }
        : null,
    });
  } catch (err) {
    if (err instanceof OrganizeError) {
      return res.status(err.status).json({ ok: false, error: err.message });
    }
    console.error('[postaryx] Rename/move failed:', err);
    res.status(500).json({ ok: false, error: 'Could not move that report.' });
  }
});

/**
 * Deletes a report. The file is moved to the trash folder, not erased, and the
 * row leaves the catalogue straight away.
 */
router.delete('/reports/:slug', (req, res) => {
  const report = getReport(req.params.slug);
  if (!report) {
    return res.status(404).json({ ok: false, error: 'That report no longer exists.' });
  }

  try {
    const { trashPath, relTrashPath, sidecars } = trashReport(report.relPath);
    recordDeletion(report, trashPath);
    removeReport(report.relPath);

    // Send the user somewhere that still exists.
    const category = getCategory(report.categorySlug);
    res.json({
      ok: true,
      deleted: { title: report.title, path: report.relPath, sidecars },
      trashedTo: relTrashPath,
      redirect: category && category.count ? `/c/${category.slug}` : '/',
    });
  } catch (err) {
    if (err instanceof DeleteError) {
      return res.status(err.status).json({ ok: false, error: err.message });
    }
    console.error('[postaryx] Delete failed:', err);
    res.status(500).json({ ok: false, error: 'Could not delete that report.' });
  }
});

router.get('/status', (req, res) => {
  const library = getLibrary();
  res.json({
    ok: true,
    site: config.site.name,
    reportsDir: library.reportsDir,
    reportsDirExists: library.reportsDirExists,
    database: library.dbPath,
    reports: library.reports.length,
    categories: library.categories.length,
    totalViews: library.totalViews,
    lastSync: library.lastSync,
  });
});

module.exports = router;
