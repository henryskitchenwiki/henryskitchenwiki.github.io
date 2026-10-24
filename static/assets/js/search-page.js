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
    if (results.suggestion) {
      $('did-you-mean-link').textContent = results.suggestion;
      $('did-you-mean-link').href = '/search/?q=' + encodeURIComponent(results.suggestion);
      $('did-you-mean').hidden = false;
    }
    $('results-heading').textContent = 'Results for “' + query + '”';
    document.title = 'Results for ' + query + ' | Henry’s Kitchen';
  } else {
    matches = recipes.slice().sort((a, b) => a.title.localeCompare(b.title));
    $('results-heading').textContent = 'All Recipes A–Z';
    document.title = 'All Recipes A–Z | Henry’s Kitchen';
  }

  $('results-count').textContent = matches.length
    ? matches.length + (matches.length === 1 ? ' recipe' : ' recipes')
    : (closeMatches.length ? 'No exact matches' : '');
  fill($('results'), matches);
  fill($('close-results'), closeMatches.slice(0, 12));
  $('close-section').hidden = closeMatches.length === 0;
  $('no-results').hidden = matches.length + closeMatches.length > 0;

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
    kicker.textContent = r.e ? 'Episode ' + r.e : r.d.slice(0, 4);

    const link = document.createElement('a');
    link.className = 'card-title';
    link.href = linkFor(r);
    link.textContent = r.title;

    item.append(thumb, kicker, link);
    return item;
  }
})();
