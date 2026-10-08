// utils/validate.js — Small input helpers (also used to blunt prompt injection)

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    this.expose = true;
  }
}

// Collapse whitespace, strip control chars / backticks / braces, cap length
const cleanText = (value, max = 120) =>
  String(value ?? '')
    .replace(/[\u0000-\u001f\u007f`{}<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

// Clean a list of short strings; drops empties and duplicates
const cleanList = (value, { maxItems = 10, maxLen = 80 } = {}) => {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((v) => cleanText(v, maxLen)).filter(Boolean))].slice(0, maxItems);
};

const toInt = (value, fallback, { min = 1, max = 1000 } = {}) => {
  const n = parseInt(value, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(Math.max(n, min), max);
};

module.exports = { HttpError, cleanText, cleanList, toInt };
