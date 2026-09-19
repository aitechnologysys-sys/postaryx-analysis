'use strict';

const express = require('express');
const multer = require('multer');

const { syncLibrary, getReportByPath, recordUploads } = require('../lib/library');
const {
  saveUpload,
  UploadError,
  MAX_FILE_BYTES,
  MAX_FILES,
} = require('../lib/uploads');

const router = express.Router();

// Files are small internal documents, so they are buffered in memory and
// written once validated - no temp files to clean up.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES },
});

router.post('/upload', (req, res, next) => {
  upload.array('files', MAX_FILES)(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        ok: false,
        error: `Each file must be under ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB.`,
      });
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(413).json({ ok: false, error: `Up to ${MAX_FILES} files per upload.` });
    }
    return res.status(400).json({ ok: false, error: err.message });
  });
}, (req, res) => {
  try {
    const body = req.body || {};
    // "New category" wins over the dropdown when it was filled in.
    const category = String(body.newCategory || body.category || '').trim();

    const { folder, results } = saveUpload({
      files: req.files,
      category,
      overwrite: body.overwrite === 'on' || body.overwrite === 'true',
      metadata: {
        title: body.title,
        author: body.author,
        date: body.date,
        tags: body.tags,
        description: body.description,
      },
    });

    // Index the new files straight away so the response can link to them.
    syncLibrary();
    recordUploads(results, { category: folder });

    const enriched = results.map((result) => {
      const report = result.relPath && result.kind === 'report' ? getReportByPath(result.relPath) : null;
      return report
        ? { ...result, url: report.url, title: report.title, slug: report.slug }
        : result;
    });

    const reports = enriched.filter((item) => item.kind === 'report');
    const firstReport = reports.length ? getReportByPath(reports[0].relPath) : null;

    res.json({
      ok: true,
      category: folder || 'Uncategorized',
      categoryUrl: firstReport ? `/c/${firstReport.categorySlug}` : null,
      uploaded: results.length,
      reports,
      assets: enriched.filter((item) => item.kind === 'asset'),
      failed: enriched.filter((item) => item.status === 'failed'),
    });
  } catch (err) {
    if (err instanceof UploadError) {
      return res.status(err.status).json({ ok: false, error: err.message });
    }
    console.error('[postaryx] Upload failed:', err);
    res.status(500).json({ ok: false, error: 'Could not save the upload.' });
  }
});

module.exports = router;
