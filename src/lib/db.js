'use strict';

/**
 * The SQLite catalogue.
 *
 * The HTML files in reports/ remain the source of truth: this database is the
 * index built from them by scanning the folder, plus the few things a folder
 * cannot hold - stable report URLs, view counts and upload history. Deleting
 * data/library.db loses nothing but the counters; it is rebuilt on the next
 * start.
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const config = require('./../config');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS categories (
  id          INTEGER PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  folder      TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reports (
  id            INTEGER PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE,
  rel_path      TEXT NOT NULL UNIQUE,
  file_name     TEXT NOT NULL,
  folder        TEXT NOT NULL DEFAULT '',
  category_id   INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  title         TEXT NOT NULL,
  author        TEXT NOT NULL DEFAULT '',
  date_text     TEXT NOT NULL DEFAULT '',
  date_value    INTEGER NOT NULL DEFAULT 0,
  tags          TEXT NOT NULL DEFAULT '',
  description   TEXT NOT NULL DEFAULT '',
  sort_order    INTEGER NOT NULL DEFAULT 0,
  size_bytes    INTEGER NOT NULL DEFAULT 0,
  mtime_ms      REAL NOT NULL DEFAULT 0,
  search_text   TEXT NOT NULL DEFAULT '',
  views         INTEGER NOT NULL DEFAULT 0,
  last_viewed_at TEXT,
  first_seen_at TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS reports_category_idx ON reports (category_id);
CREATE INDEX IF NOT EXISTS reports_search_idx   ON reports (search_text);

CREATE TABLE IF NOT EXISTS uploads (
  id          INTEGER PRIMARY KEY,
  file_name   TEXT NOT NULL,
  rel_path    TEXT NOT NULL,
  category    TEXT NOT NULL DEFAULT '',
  kind        TEXT NOT NULL,
  status      TEXT NOT NULL,
  size_bytes  INTEGER NOT NULL DEFAULT 0,
  uploaded_by TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS deletions (
  id          INTEGER PRIMARY KEY,
  title       TEXT NOT NULL,
  rel_path    TEXT NOT NULL,
  category    TEXT NOT NULL DEFAULT '',
  trash_path  TEXT NOT NULL,
  size_bytes  INTEGER NOT NULL DEFAULT 0,
  views       INTEGER NOT NULL DEFAULT 0,
  deleted_by  TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

let db;

function open() {
  if (db) return db;

  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
  db = new Database(config.dbPath);

  // WAL keeps reads fast while a scan is writing; foreign keys keep a report
  // from pointing at a category that no longer exists.
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);

  return db;
}

function getSetting(key, fallback = null) {
  const row = open().prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

function setSetting(key, value) {
  open()
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value`
    )
    .run(key, String(value));
}

function close() {
  if (db) {
    db.close();
    db = undefined;
  }
}

module.exports = { open, getSetting, setSetting, close };
