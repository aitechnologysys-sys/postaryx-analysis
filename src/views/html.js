'use strict';

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (char) => ESCAPES[char]);
}

function escapeAttr(value) {
  return escapeHtml(value);
}

/** Small helper so views can drop optional blocks with `when(cond, html)`. */
function when(condition, html) {
  return condition ? html : '';
}

module.exports = { escapeHtml, escapeAttr, when };
