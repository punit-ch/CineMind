// testing/loadEsm.js — Load a browser ES module (public/js/...) into plain functions for Node tests.
// Imports are stripped and replaced by injected dependencies, and `export` keywords are removed.
const fs = require('node:fs');
const path = require('node:path');

function loadEsm(relativePath, scope = {}) {
  const file = path.join(__dirname, '..', 'public', 'js', relativePath);
  const names = [];
  const src = fs
    .readFileSync(file, 'utf8')
    .replace(/^import[\s\S]*?from\s+'[^']+';\s*$/gm, '')
    .replace(/^export (async function|function|const|let|class) ([A-Za-z0-9_]+)/gm, (m, kind, name) => {
      names.push(name);
      return `${kind} ${name}`;
    });
  return new Function(...Object.keys(scope), `${src}\nreturn { ${names.join(', ')} };`)(...Object.values(scope));
}

module.exports = { loadEsm };
