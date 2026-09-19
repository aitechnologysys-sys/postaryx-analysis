'use strict';

/**
 * Renaming and moving a report.
 *
 * Both are the same operation - the file (and its sidecar metadata file) moves
 * to a new path inside reports/ - so they share one implementation. The
 * catalogue keeps the report's slug and view count afterwards, which is what
 * lets a link that was pasted into Slack survive a rename.
 */

const fs = require('fs');
const path = require('path');

const config = require('../config');
const { safeName } = require('./uploads');

class OrganizeError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function insideReports(target) {
  const root = path.resolve(config.reportsDir);
  const resolved = path.resolve(root, target);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new OrganizeError('That destination is outside the reports folder.');
  }
  return resolved;
}

function toPosix(p) {
  return p.split(path.sep).join('/');
}

function moveOne(from, to) {
  try {
    fs.renameSync(from, to);
  } catch (err) {
    // Renaming across devices is not allowed; copy and remove instead.
    if (err.code !== 'EXDEV') throw err;
    fs.copyFileSync(from, to);
    fs.unlinkSync(from);
  }
}

/**
 * Moves and/or renames one report.
 *
 * @param {string} relPath   current path, relative to reports/
 * @param {object} changes   { name } new file name (extension optional),
 *                           { category } destination folder ('' = reports root)
 */
function relocateFile(relPath, changes = {}) {
  const source = insideReports(relPath);
  if (!fs.existsSync(source)) {
    throw new OrganizeError('That file is no longer on disk.', 404);
  }

  const ext = path.extname(relPath) || '.html';
  const currentDir = path.posix.dirname(relPath) === '.' ? '' : path.posix.dirname(relPath);
  const currentBase = path.basename(relPath, ext);

  // A new name keeps the original extension whether or not one was typed.
  let base = currentBase;
  if (changes.name !== undefined && changes.name !== null && String(changes.name).trim() !== '') {
    base = safeName(String(changes.name).replace(/\.html?$/i, ''));
    if (!base) throw new OrganizeError('That name cannot be used for a file.');
  }

  const folder =
    changes.category === undefined || changes.category === null
      ? currentDir
      : safeName(String(changes.category));

  const relTarget = folder ? `${folder}/${base}${ext}` : `${base}${ext}`;
  const target = insideReports(relTarget);

  if (target === source) {
    return { unchanged: true, from: relPath, to: relPath, sidecars: [] };
  }
  if (fs.existsSync(target)) {
    throw new OrganizeError(
      `"${base}${ext}" already exists in ${folder || 'the reports root'}.`,
      409
    );
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });
  moveOne(source, target);

  // The sidecar metadata file follows, renamed to match.
  const sidecars = [];
  for (const suffix of ['.json', '.meta.json']) {
    const from = source.replace(/\.html?$/i, suffix);
    if (!fs.existsSync(from)) continue;
    const to = target.replace(/\.html?$/i, suffix);
    try {
      moveOne(from, to);
      sidecars.push(path.basename(to));
    } catch (err) {
      console.warn(`[postaryx] Could not move ${from}: ${err.message}`);
    }
  }

  // An emptied category folder is tidied away, but never one with files left.
  if (currentDir && currentDir !== folder) {
    try {
      const old = path.join(config.reportsDir, currentDir);
      if (fs.readdirSync(old).length === 0) fs.rmdirSync(old);
    } catch (err) {
      /* the folder is not empty, or not ours to remove - leave it */
    }
  }

  return {
    unchanged: false,
    from: relPath,
    to: toPosix(path.relative(config.reportsDir, target)),
    sidecars,
  };
}

module.exports = { relocateFile, OrganizeError };
