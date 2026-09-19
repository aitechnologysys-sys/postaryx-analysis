'use strict';

/**
 * Optional report metadata.
 *
 * A report can describe itself in three ways (highest priority first):
 *
 *   1. A sidecar JSON file next to it:  "Competitor Analysis.json"
 *        { "title": "...", "author": "...", "date": "...", "tags": ["..."] }
 *   2. <meta> tags inside the HTML file itself:
 *        <meta name="author" content="Marketing Team">
 *        <meta name="date" content="September 2026">
 *        <meta name="tags" content="Competitor, Social Media">
 *        <meta name="description" content="...">
 *   3. Nothing at all - then the file name is used.
 */

const fs = require('fs');
const path = require('path');

// Only the beginning of each file is read for metadata, so huge reports
// (embedded images, big charts) stay cheap to index.
const HEAD_BYTES = 256 * 1024;

function readHead(filePath, bytes = HEAD_BYTES) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const size = fs.fstatSync(fd).size;
    const length = Math.min(size, bytes);
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, 0);
    return buffer.toString('utf8');
  } catch (err) {
    return '';
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  middot: '\u00b7', bull: '\u2022', mdash: '\u2014', ndash: '\u2013', hellip: '\u2026',
  lsquo: '\u2018', rsquo: '\u2019', ldquo: '\u201c', rdquo: '\u201d', times: '\u00d7',
  deg: '\u00b0', trade: '\u2122', copy: '\u00a9', reg: '\u00ae', euro: '\u20ac',
  pound: '\u00a3', laquo: '\u00ab', raquo: '\u00bb', dagger: '\u2020', prime: '\u2032',
  '#39': "'", '#x27': "'",
};

function decodeEntities(value) {
  return String(value).replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, name) => {
    const key = name.toLowerCase();
    if (ENTITIES[key] !== undefined) return ENTITIES[key];
    if (key[0] === '#') {
      const code = key[1] === 'x' ? parseInt(key.slice(2), 16) : parseInt(key.slice(1), 10);
      if (Number.isFinite(code)) return String.fromCodePoint(code);
    }
    return match;
  });
}

function attr(tag, name) {
  const re = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i');
  const match = tag.match(re);
  if (!match) return '';
  return decodeEntities(match[2] ?? match[3] ?? match[4] ?? '').trim();
}

function normalizeTags(value) {
  if (!value) return [];
  const list = Array.isArray(value) ? value : String(value).split(/[,;|]/);
  return list.map((t) => String(t).trim()).filter(Boolean).slice(0, 12);
}

function collapse(text) {
  return String(text).replace(/\s+/g, ' ').trim();
}

/** First readable sentence of the report, used when no description is given. */
function excerptFromBody(html) {
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)/i);
  const body = bodyMatch ? bodyMatch[1] : html;
  const text = collapse(
    decodeEntities(
      body
        .replace(/<(script|style|svg|noscript)[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
    )
  );
  if (!text) return '';
  return text.length > 220 ? `${text.slice(0, 217).trimEnd()}...` : text;
}

/** Aliases so teams can write metadata the way that feels natural. */
const FIELD_ALIASES = {
  title: ['title', 'report-title', 'report_name', 'report-name', 'name'],
  author: ['author', 'created-by', 'created_by', 'report-author', 'owner', 'team'],
  date: ['date', 'report-date', 'created', 'created-on', 'published', 'dc.date'],
  tags: ['tags', 'keywords', 'tag'],
  description: ['description', 'summary', 'subtitle'],
  category: ['category', 'folder'],
  order: ['order', 'sort'],
};

function pick(source, field) {
  for (const key of FIELD_ALIASES[field]) {
    const value = source[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return '';
}

/** True when the field is present at all - including an explicit empty value. */
function hasField(source, field) {
  return FIELD_ALIASES[field].some((key) => Object.prototype.hasOwnProperty.call(source, key));
}

function pickRaw(source, field) {
  for (const key of FIELD_ALIASES[field]) {
    if (Object.prototype.hasOwnProperty.call(source, key)) return source[key];
  }
  return undefined;
}

function parseHtml(html) {
  const meta = {};
  const metaTags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of metaTags) {
    const name = (attr(tag, 'name') || attr(tag, 'property') || attr(tag, 'itemprop')).toLowerCase();
    if (!name) continue;
    const content = attr(tag, 'content');
    if (content) meta[name.replace(/^og:/, '')] = content;
  }

  const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const h1Tag = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);

  return {
    title: collapse(
      pick(meta, 'title') ||
        (titleTag ? decodeEntities(titleTag[1].replace(/<[^>]+>/g, '')) : '') ||
        (h1Tag ? decodeEntities(h1Tag[1].replace(/<[^>]+>/g, '')) : '')
    ),
    author: collapse(pick(meta, 'author')),
    date: collapse(pick(meta, 'date')),
    tags: normalizeTags(pick(meta, 'tags')),
    description: collapse(pick(meta, 'description')) || excerptFromBody(html),
    category: collapse(pick(meta, 'category')),
    order: pick(meta, 'order'),
  };
}

/** "Competitor Analysis.html" -> "Competitor Analysis.json" / ".meta.json" */
function readSidecar(filePath) {
  const base = filePath.replace(/\.html?$/i, '');
  for (const candidate of [`${base}.json`, `${base}.meta.json`]) {
    try {
      const raw = fs.readFileSync(candidate, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.warn(`[postaryx] Could not read metadata file ${candidate}: ${err.message}`);
      }
    }
  }
  return {};
}

/**
 * Merges fields into the report's sidecar JSON file, creating it if needed.
 * The HTML file is never touched.
 */
function updateSidecar(filePath, patch) {
  const base = filePath.replace(/\.html?$/i, '');
  const preferred = `${base}.json`;
  const alternate = `${base}.meta.json`;
  const target = !fs.existsSync(preferred) && fs.existsSync(alternate) ? alternate : preferred;

  let current = {};
  try {
    current = JSON.parse(fs.readFileSync(target, 'utf8'));
    if (!current || typeof current !== 'object') current = {};
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn(`[postaryx] Replacing unreadable ${target}: ${err.message}`);
    }
  }

  const next = { ...current, ...patch };
  // Drop keys that were cleared, but keep an empty tag list - it is a choice.
  for (const [key, value] of Object.entries(next)) {
    if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) {
      delete next[key];
    }
  }

  fs.writeFileSync(target, `${JSON.stringify(next, null, 2)}\n`);
  return target;
}

function titleFromFileName(filePath) {
  return collapse(
    path
      .basename(filePath)
      .replace(/\.html?$/i, '')
      .replace(/[_-]+/g, ' ')
  );
}

/** Merge every metadata source for one report file. */
function readReportMetadata(filePath) {
  const html = readHead(filePath);
  const fromHtml = parseHtml(html);
  const sidecar = readSidecar(filePath);

  const merged = {
    title:
      collapse(pick(sidecar, 'title')) || fromHtml.title || titleFromFileName(filePath),
    author: collapse(pick(sidecar, 'author')) || fromHtml.author || '',
    date: collapse(pick(sidecar, 'date')) || fromHtml.date || '',
    // An explicit "tags": [] in the sidecar means "no tags", and must win over
    // whatever <meta> tags the HTML happens to carry.
    tags: hasField(sidecar, 'tags') ? normalizeTags(pickRaw(sidecar, 'tags')) : fromHtml.tags,
    description: collapse(pick(sidecar, 'description')) || fromHtml.description || '',
    category: collapse(pick(sidecar, 'category')) || fromHtml.category || '',
    order: Number(pick(sidecar, 'order') || fromHtml.order || 0) || 0,
  };

  // A generic <title> should not beat the file name.
  if (/^(document|untitled|index|report)$/i.test(merged.title)) {
    merged.title = titleFromFileName(filePath);
  }
  return merged;
}

/** Optional "_category.json" describing a folder. */
function readFolderMetadata(dirPath) {
  for (const candidate of ['_category.json', '_folder.json']) {
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(dirPath, candidate), 'utf8'));
      if (parsed && typeof parsed === 'object') {
        return {
          name: collapse(parsed.name || parsed.title || ''),
          description: collapse(parsed.description || ''),
          order: Number(parsed.order || 0) || 0,
        };
      }
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.warn(`[postaryx] Could not read ${candidate} in ${dirPath}: ${err.message}`);
      }
    }
  }
  return { name: '', description: '', order: 0 };
}

module.exports = {
  readReportMetadata,
  readFolderMetadata,
  updateSidecar,
  titleFromFileName,
  normalizeTags,
  decodeEntities,
};
