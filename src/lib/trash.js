'use strict';

/**
 * Deleting a report.
 *
 * Nothing is erased: the HTML file (and its sidecar metadata file, if any) is
 * moved into data/trash/ under a timestamped folder. Restoring is a matter of
 * moving the file back into reports/ - the next scan picks it up again.
 */

const fs = require('fs');
const path = require('path');

const config = require('../config');

class DeleteError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

/** Refuse anything that does not resolve to a file inside reports/. */
function resolveInsideReports(relPath) {
  const root = path.resolve(config.reportsDir);
  const target = path.resolve(root, relPath);
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new DeleteError('That file is not inside the reports folder.', 400);
  }
  return target;
}

function timestampFolder() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

/** Moves one report (plus its sidecar) to the trash. Returns where it went. */
function trashReport(relPath) {
  const source = resolveInsideReports(relPath);
  if (!fs.existsSync(source)) {
    throw new DeleteError('That file is no longer on disk.', 404);
  }

  const stamp = timestampFolder();
  const destDir = path.join(config.trashDir, stamp, path.dirname(relPath));
  fs.mkdirSync(destDir, { recursive: true });

  const dest = path.join(destDir, path.basename(relPath));
  try {
    fs.renameSync(source, dest);
  } catch (err) {
    // A rename fails across devices; fall back to copy + unlink.
    if (err.code !== 'EXDEV') throw err;
    fs.copyFileSync(source, dest);
    fs.unlinkSync(source);
  }

  // The sidecar metadata file travels with the report.
  const sidecars = [source.replace(/\.html?$/i, '.json'), source.replace(/\.html?$/i, '.meta.json')];
  const movedSidecars = [];
  for (const sidecar of sidecars) {
    if (!fs.existsSync(sidecar)) continue;
    const sidecarDest = path.join(destDir, path.basename(sidecar));
    try {
      fs.renameSync(sidecar, sidecarDest);
      movedSidecars.push(path.basename(sidecar));
    } catch (err) {
      console.warn(`[postaryx] Could not move ${sidecar}: ${err.message}`);
    }
  }

  // Shown to the user: a path relative to the project when the trash sits
  // inside it, and the absolute path when it does not (a Docker volume, or
  // any TRASH_DIR elsewhere on the machine).
  const relative = path.relative(config.projectRoot, dest);

  return {
    trashPath: dest,
    relTrashPath: relative.startsWith('..') ? dest : relative,
    sidecars: movedSidecars,
  };
}

module.exports = { trashReport, DeleteError };
