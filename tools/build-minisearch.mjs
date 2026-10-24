// Rebuilds static/assets/js/vendor/minisearch.js from MiniSearch's official source.
//
// MiniSearch (https://github.com/lucaong/minisearch, MIT licence) is the search
// library behind the site's search page. We keep a copy in the repo so the site
// never depends on another server. To update it:
//
//   git clone --depth 1 --branch <version tag> https://github.com/lucaong/minisearch ../minisearch
//   node tools/build-minisearch.mjs ../minisearch
//
// Needs Node 22.13 or later (for its built-in TypeScript type stripping).
// The script removes the TypeScript types and joins the modules into one file
// that works in the browser and in Node (for tests/search). Nothing else changes.

import { stripTypeScriptTypes } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const sourceFolder = process.argv[2];
if (!sourceFolder) {
  console.error('Usage: node tools/build-minisearch.mjs <folder with the MiniSearch source>');
  process.exit(1);
}

const version = JSON.parse(readFileSync(join(sourceFolder, 'package.json'), 'utf8')).version;
const commit = execFileSync('git', ['-C', sourceFolder, 'rev-parse', '--short=8', 'HEAD']).toString().trim();

// Each module runs in its own scope (they reuse some helper names) and hands back what it exports.
const modules = [
  { file: 'SearchableMap/TreeIterator.ts', name: 'TreeIteratorModule', imports: '', exports: '{ TreeIterator, ENTRIES, KEYS, VALUES, LEAF }' },
  { file: 'SearchableMap/fuzzySearch.ts', name: 'fuzzySearchModule', imports: 'const { LEAF } = TreeIteratorModule;', exports: '{ fuzzySearch }' },
  { file: 'SearchableMap/SearchableMap.ts', name: 'SearchableMapModule', imports: 'const { TreeIterator, ENTRIES, KEYS, VALUES, LEAF } = TreeIteratorModule; const { fuzzySearch } = fuzzySearchModule;', exports: '{ SearchableMap }' },
  { file: 'MiniSearch.ts', name: 'MiniSearchModule', imports: 'const { SearchableMap } = SearchableMapModule;', exports: '{ MiniSearch }' },
];

let body = '';
for (const m of modules) {
  let js = stripTypeScriptTypes(readFileSync(join(sourceFolder, 'src', m.file), 'utf8'), { mode: 'transform' });
  js = js
    .replace(/^import[^\n]*\n/gm, '')
    .replace(/^export \{[^}]*\}\s*;?\s*$/gm, '')
    .replace(/^export default (?=class)/gm, '')
    .replace(/^export default \w+\s*;?\s*$/gm, '')
    .replace(/^export (?=(const|function|class|let) )/gm, '');
  body += `\n// ---- ${m.file} ----\nconst ${m.name} = (() => {\n${m.imports}\n${js}\nreturn ${m.exports};\n})();\n`;
}

const out = `/*!
 * MiniSearch ${version} (https://github.com/lucaong/minisearch)
 * Copyright Luca Ongaro. MIT License: https://github.com/lucaong/minisearch/blob/master/LICENSE.txt
 *
 * Built for Henry's Kitchen by tools/build-minisearch.mjs from the official source
 * (commit ${commit}): TypeScript types removed and modules joined into one file.
 */
(function (root) {
'use strict';
${body}
const MiniSearch = MiniSearchModule.MiniSearch;
if (typeof module === 'object' && module.exports) { module.exports = MiniSearch; } else { root.MiniSearch = MiniSearch; }
})(typeof self !== 'undefined' ? self : this);
`;

const target = new URL('../static/assets/js/vendor/minisearch.js', import.meta.url);
writeFileSync(target, out);
console.log(`Wrote MiniSearch ${version} (${commit}) to static/assets/js/vendor/minisearch.js`);
