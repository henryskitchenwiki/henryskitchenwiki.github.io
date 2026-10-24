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
  if (query) {
    fill($('results'), matches);
  } else {
    fillAtoZ(matches);
  }
  fill($('close-results'), closeMatches.slice(0, 12));
  $('close-section').hidden = closeMatches.length === 0;
  $('no-results').hidden = matches.length + closeMatches.length > 0;

  /** A–Z order ignores "How to Make", "Henry's", "a/an/the" and quote marks at the start of a title. */
  function sortKey(title) {
    return title
      .replace(/^how to( make)?\s+/i, '')
      .replace(/^henry['\u2019]s\s+/i, '')
      .replace(/^(a|an|the)\s+/i, '')
      .replace(/^[^A-Za-z0-9]+/, '');
  }

  /** "Episode 47", or the date for episodes without a number: "Mar 17, 2026". */
  function label(r) {
    if (r.e) return 'Episode ' + r.e;
    const [y, m, d] = r.d.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  /**
   * All Recipes A–Z: a section per letter, and a bar of letters to jump to.
   * Titles starting with a number go under "#".
   */
  function fillAtoZ(items) {
    const groups = new Map();
    for (const r of items) {
      const first = sortKey(r.title).charAt(0).toUpperCase();
      const letter = /[A-Z]/.test(first) ? first : '#';
      if (!groups.has(letter)) groups.set(letter, []);
      groups.get(letter).push(r);
    }

    const bar = $('letters');
    for (const letter of ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ']) {
      const has = groups.has(letter);
      const item = document.createElement(has ? 'a' : 'span');
      item.textContent = letter;
      if (has) item.href = '#letter-' + (letter === '#' ? 'num' : letter);
      else item.setAttribute('aria-hidden', 'true');
      bar.appendChild(item);
    }
    bar.hidden = false;

    for (const [letter, recipesForLetter] of [...groups].sort((a, b) => a[0].localeCompare(b[0]))) {
      const heading = document.createElement('h2');
      heading.className = 'letter-heading';
      heading.id = 'letter-' + (letter === '#' ? 'num' : letter);
      heading.textContent = letter;
      const list = document.createElement('ul');
      list.className = 'results';
      fill(list, recipesForLetter);
      $('az').append(heading, list);
    }
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

    const text = document.createElement('div');
    text.className = 'card-text';
    text.append(kicker, link);
    item.append(thumb, text);
    return item;
  }
})();
