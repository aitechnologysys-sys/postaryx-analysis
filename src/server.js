'use strict';

const fs = require('fs');
const express = require('express');

const config = require('./config');
const { getLibrary } = require('./lib/library');
const { close: closeDb } = require('./lib/db');
const pageRoutes = require('./routes/pages');
const apiRoutes = require('./routes/api');
const uploadRoutes = require('./routes/upload');
const { notFoundPage } = require('./views/pages');

const app = express();

app.disable('x-powered-by');
app.set('etag', 'strong');
app.use(express.json({ limit: '256kb' }));

// --- Static assets for the dashboard itself -------------------------------
app.use(
  express.static(config.publicDir, {
    maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0,
  })
);

// --- The raw report files -------------------------------------------------
// Served as-is so every image, stylesheet, script and chart inside a report
// keeps working, including relative links to files next to it.
app.use(
  '/files',
  express.static(config.reportsDir, {
    index: false,
    dotfiles: 'ignore',
    etag: true,
    maxAge: 0,
    setHeaders(res) {
      // These are internal documents: never let a browser or proxy cache a
      // stale version after someone updates the file.
      res.setHeader('Cache-Control', 'no-cache');
    },
  })
);

// --- Pages and API --------------------------------------------------------
app.use('/api', uploadRoutes);
app.use('/api', apiRoutes);
app.use('/', pageRoutes);

app.get('/healthz', (req, res) => res.json({ ok: true }));

// --- Fallbacks ------------------------------------------------------------
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ ok: false, error: 'Not found' });
  }
  res.status(404).send(notFoundPage(getLibrary(), 'That page does not exist.'));
});

app.use((err, req, res, next) => {
  console.error('[postaryx] Request failed:', err);
  if (res.headersSent) return next(err);
  if (req.path.startsWith('/api/')) {
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
  res.status(500).send(notFoundPage(getLibrary(), 'Something went wrong while rendering this page.'));
});

function start() {
  if (!fs.existsSync(config.reportsDir)) {
    try {
      fs.mkdirSync(config.reportsDir, { recursive: true });
      console.log(`[postaryx] Created reports folder: ${config.reportsDir}`);
    } catch (err) {
      console.warn(`[postaryx] Could not create ${config.reportsDir}: ${err.message}`);
    }
  }

  const library = getLibrary({ force: true });
  const server = app.listen(config.port, config.host, () => {
    const shown = config.host === '0.0.0.0' ? 'localhost' : config.host;
    console.log('');
    console.log(`  ${config.site.name}`);
    console.log(`  ➜  http://${shown}:${config.port}`);
    console.log(`  ➜  Reports folder: ${config.reportsDir}`);
    console.log(
      `  ➜  Indexed ${library.reports.length} report(s) in ${library.categories.length} category(ies)`
    );
    console.log(`  ➜  Catalogue: ${config.dbPath}`);
    console.log('');
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[postaryx] Port ${config.port} is already in use. Try: PORT=4100 npm start`);
      process.exit(1);
    }
    throw err;
  });

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () =>
      server.close(() => {
        closeDb();
        process.exit(0);
      })
    );
  }

  return server;
}

if (require.main === module) start();

module.exports = { app, start };
