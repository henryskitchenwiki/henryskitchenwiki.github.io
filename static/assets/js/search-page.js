/* The search page (/search/).
 *
 *   /search/?q=french+toast   results for a search
 *   /search/                  every recipe, A to Z
 *   /search/?surprise=1       a random recipe
 *
 * The searching is done by search-engine.js over window.HK_SEARCH_INDEX
 * (written by the site build). Results are built with DOM methods, never
 * innerHTML, so titles always show as plain text.
 */
(function () {
  'use strict';

  const recipes = window.HK_SEARCH_INDEX || [];
  const params = new URLSearchParams(window.location.search);
  const linkFor = (r) => '/recipes/' + encodeURIComponent(r.id) + '/';
  const $ = (id) => document.getElementById(id);

  if (params.has('surprise') && recipes.length) {
    const pick = recipes[Math.floor(Math.random() * recipes.length)];
    window.location.replace(linkFor(pick));
    return;
  }

  const query = (params.get('q') || '').trim();
  $('q').value = query;

  let matches;
  let closeMatches = [];
  if (query) {
    const results = window.HKSearch.create(recipes, window.HK_SEARCH_WORDS).search(query);
    ({ matches, closeMatches } = results);
    // Only offer a different spelling when nothing matched every word.
    if (results.suggestion && matches.length === 0) {
      $('did-you-mean-link').textContent = results.suggestion;
      $('did-you-mean-link').href = '/search/?q=' + encodeURIComponent(results.suggestion);
      $('did-you-mean').hidden = false;
    }
    $('results-heading').textContent = 'Results for “' + query + '”';
    document.title = 'Results for ' + query + ' | Henry’s Kitchen';
  } else {
    matches = recipes.slice().sort((a, b) => sortKey(a.title).localeCompare(sortKey(b.title)));
    $('results-heading').textContent = 'All Recipes A–Z';
    document.title = 'All Recipes A–Z | Henry’s Kitchen';
  }

  $('results-count').textContent = matches.length
    ? matches.length + (matches.length === 1 ? ' recipe' : ' recipes')
    : (closeMatches.length ? 'No exact matches' : 'No recipes found');
  fill($('results'), matches);
  fill($('close-results'), closeMatches.slice(0, 12));
  $('close-section').hidden = closeMatches.length === 0;
  $('no-results').hidden = matches.length + closeMatches.length > 0;

  /** A–Z order ignores "How to Make", "Henry's" and "a/an/the" at the start of a title. */
  function sortKey(title) {
    return title
      .replace(/^how to( make)?\s+/i, '')
      .replace(/^henry['\u2019]s\s+/i, '')
      .replace(/^(a|an|the)\s+/i, '');
  }

  /** "Episode 47", or the date for episodes without a number: "Mar 17, 2026". */
  function label(r) {
    if (r.e) return 'Episode ' + r.e;
    const [y, m, d] = r.d.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function fill(list, items) {
    for (const r of items) list.appendChild(card(r));
  }

  function card(r) {
    const item = document.createElement('li');
    item.className = 'card';

    const thumb = document.createElement('div');
    thumb.className = 'thumb';
    const img = document.createElement('img');
    img.src = 'https://i.ytimg.com/vi/' + encodeURIComponent(r.v) + '/mqdefault.jpg';
    img.alt = '';
    img.width = 320;
    img.height = 180;
    img.loading = 'lazy';
    thumb.appendChild(img);

    const kicker = document.createElement('div');
    kicker.className = 'kicker';
    kicker.textContent = label(r);

    const link = document.createElement('a');
    link.className = 'card-title';
    link.href = linkFor(r);
    link.textContent = r.title;

    item.append(thumb, kicker, link);
    return item;
  }
})();
