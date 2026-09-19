'use strict';

const express = require('express');

const {
  getLibrary,
  getReport,
  getCategory,
  searchReports,
  recordView,
} = require('../lib/library');
const { homePage, categoryPage, reportPage, uploadPage, notFoundPage } = require('../views/pages');

const router = express.Router();

router.get('/', (req, res) => {
  const library = getLibrary();
  const query = String(req.query.q || '').trim();
  res.send(homePage(library, query, query ? searchReports(query) : []));
});

router.get('/upload', (req, res) => {
  res.send(uploadPage(getLibrary(), String(req.query.category || '')));
});

router.get('/c/:slug', (req, res) => {
  const library = getLibrary();
  const category = getCategory(req.params.slug);
  if (!category) {
    return res.status(404).send(notFoundPage(library, 'That category does not exist.'));
  }
  res.send(categoryPage(library, category));
});

router.get('/r/:slug', (req, res) => {
  const report = getReport(req.params.slug);
  if (!report) {
    return res.status(404).send(notFoundPage(getLibrary(), 'That report does not exist.'));
  }
  recordView(report.slug);
  res.send(reportPage(report, getLibrary()));
});

module.exports = router;
