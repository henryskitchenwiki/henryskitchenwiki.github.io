// Runs the searches in search-cases.json against a built site and reports any
// that don't find what they should. Check runs this on every pull request.
//
//   node tests/search/run-search-tests.js _site
//
// Exit code 0 means every case passed.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const site = path.resolve(process.argv[2] || '_site');
const indexFile = path.join(site, 'assets/js/search-index.js');
const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(indexFile, 'utf8'), sandbox);
const recipes = sandbox.window.HK_SEARCH_INDEX;

const HKSearch = require(path.join(site, 'assets/js/search-engine.js'));
const search = HKSearch.create(recipes);
const { cases } = JSON.parse(fs.readFileSync(path.join(__dirname, 'search-cases.json'), 'utf8'));
const known = new Set(recipes.map((r) => r.id));

let failed = 0;
for (const c of cases) {
  const { matches, closeMatches } = search.search(c.query);
  const ids = matches.map((r) => r.id);
  const problems = [];
  for (const id of [c.top, ...(c.includes || [])].filter(Boolean)) {
    if (!known.has(id)) problems.push(`"${id}" isn't a recipe page id`);
  }
  if (c.top && ids[0] !== c.top) problems.push(`expected ${c.top} first, got ${ids[0] || 'nothing'}`);
  for (const id of c.includes || []) {
    if (!ids.includes(id)) problems.push(`expected ${id} in the results`);
  }

  if (problems.length) {
    failed++;
    const shown = ids.slice(0, 5).join(', ') || '(none)';
    const close = closeMatches.slice(0, 3).map((r) => r.id).join(', ') || '(none)';
    console.log(`FAIL "${c.query}": ${problems.join('; ')}\n     results: ${shown}\n     close: ${close}`);
    if (process.env.GITHUB_ACTIONS === 'true') {
      console.log(`::error file=tests/search/search-cases.json::Search "${c.query}": ${problems.join('; ')}`);
    }
  } else {
    console.log(`ok   "${c.query}"`);
  }
}

console.log(`\n${cases.length - failed} of ${cases.length} searches passed.`);
process.exit(failed ? 1 : 0);
