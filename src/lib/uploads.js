'use strict';

/**
 * Saving uploaded files into the reports folder.
 *
 * An upload is nothing more than "write this file into that category folder" -
 * once the file is on disk the normal folder scan picks it up like any report
 * that was copied in by hand.
 */

const fs = require('fs');
const path = require('path');

const config = require('../config');

const REPORT_EXT = new Set(['.html', '.htm']);

// Files a report may need next to it. Anything else is rejected.
const ASSET_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.avif', '.ico',
  '.css', '.js', '.json', '.csv', '.pdf', '.txt', '.woff', '.woff2', '.ttf',
]);

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_FILES = 40;

class UploadError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

/** Strip anything that could escape the reports folder or break a file name. */
function safeName(value) {
  return String(value || '')
    .replace(/[\\/]/g, ' ')
    .replace(/[\u0000-\u001f<>:"|?*]/g, '')
    .replace(/^[.\s]+/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

function isReportFile(fileName) {
  return REPORT_EXT.has(path.extname(fileName).toLowerCase());
}

function assertAllowed(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  if (!REPORT_EXT.has(ext) && !ASSET_EXT.has(ext)) {
    throw new UploadError(`"${fileName}" is not an allowed file type.`);
  }
}

/** Resolve the destination and refuse anything outside the reports folder. */
function resolveTarget(category, fileName) {
  const folder = safeName(category);
  const name = safeName(fileName);
  if (!name) throw new UploadError('A file needs a name.');

  const dir = folder ? path.join(config.reportsDir, folder) : config.reportsDir;
  const target = path.resolve(dir, name);
  const root = path.resolve(config.reportsDir);
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new UploadError('Invalid destination folder.');
  }
  return { dir, target, folder, name };
}

/** "Report.html" -> "Report-2.html" when the name is already taken. */
function uniquePath(target) {
  const dir = path.dirname(target);
  const ext = path.extname(target);
  const base = path.basename(target, ext);
  let candidate = target;
  let n = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${base}-${n}${ext}`);
    n += 1;
  }
  return candidate;
}

function cleanMetadata(input = {}) {
  const tags = String(input.tags || '')
    .split(/[,;|]/)
    .map((tag) => tag.trim())
    .filter(Boolean);

  const meta = {};
  if (input.title && String(input.title).trim()) meta.title = String(input.title).trim();
  if (input.author && String(input.author).trim()) meta.author = String(input.author).trim();
  if (input.date && String(input.date).trim()) meta.date = String(input.date).trim();
  if (input.description && String(input.description).trim()) {
    meta.description = String(input.description).trim();
  }
  if (tags.length) meta.tags = tags;
  return meta;
}

/**
 * Writes the uploaded files and returns one result per file.
 * Metadata (when given) is written to a sidecar JSON file so the uploaded
 * HTML is never modified.
 */
function saveUpload({ files, category, metadata = {}, overwrite = false }) {
  if (!files || !files.length) throw new UploadError('Choose at least one file to upload.');
  if (files.length > MAX_FILES) throw new UploadError(`Too many files (max ${MAX_FILES}).`);

  // Reject unknown file types before anything is written to disk.
  for (const file of files) assertAllowed(file.originalname);

  const reportFiles = files.filter((file) => isReportFile(file.originalname));
  if (!reportFiles.length) {
    throw new UploadError('Add at least one .html file - assets alone cannot be a report.');
  }

  const meta = cleanMetadata(metadata);
  // A title only makes sense when a single report is uploaded.
  const sharedMeta = { ...meta };
  if (reportFiles.length > 1) delete sharedMeta.title;

  const folder = safeName(category);
  const dir = folder ? path.join(config.reportsDir, folder) : config.reportsDir;
  fs.mkdirSync(dir, { recursive: true });

  const results = [];
  for (const file of files) {
    const { target } = resolveTarget(category, file.originalname);
    const exists = fs.existsSync(target);
    const finalPath = exists && !overwrite ? uniquePath(target) : target;

    try {
      fs.writeFileSync(finalPath, file.buffer);
    } catch (err) {
      results.push({
        file: file.originalname,
        status: 'failed',
        reason: err.message,
      });
      continue;
    }

    const relPath = path
      .relative(config.reportsDir, finalPath)
      .split(path.sep)
      .join('/');

    const isReport = isReportFile(finalPath);
    if (isReport && Object.keys(sharedMeta).length) {
      const sidecar = finalPath.replace(/\.html?$/i, '.json');
      try {
        fs.writeFileSync(sidecar, `${JSON.stringify(sharedMeta, null, 2)}\n`);
      } catch (err) {
        console.warn(`[postaryx] Could not write metadata for ${relPath}: ${err.message}`);
      }
    }

    results.push({
      file: file.originalname,
      savedAs: path.basename(finalPath),
      relPath,
      kind: isReport ? 'report' : 'asset',
      status: exists ? (overwrite ? 'replaced' : 'renamed') : 'created',
      bytes: file.size,
    });
  }

  return { folder, results };
}

module.exports = {
  saveUpload,
  safeName,
  isReportFile,
  UploadError,
  MAX_FILE_BYTES,
  MAX_FILES,
  REPORT_EXT,
  ASSET_EXT,
};
