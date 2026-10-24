/* Henry's Kitchen search.
 *
 * Finds recipes from what people type, using the MiniSearch library
 * (assets/js/vendor/minisearch.js) over the index the site build writes
 * (assets/js/search-index.js). Runs entirely in the reader's browser.
 *
 * What it does on top of MiniSearch:
 *   - searches every part of a recipe, with the title counting most
 *   - ignores capitals, accents, apostrophes and the * in Shi*t
 *   - treats plurals and singulars alike (raviolis / ravioli, potatoes / potato)
 *   - finds "FrenchToast" from "french toast" and the other way round
 *   - finds recipes by episode number ("70", "ep 70", "episode 70")
 *   - splits results into recipes matching every word and close matches
 *
 * Works in the browser (window.HKSearch) and in Node, for tests/search.
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./vendor/minisearch.js'));
  } else {
    root.HKSearch = factory(root.MiniSearch);
  }
})(typeof self !== 'undefined' ? self : this, function (MiniSearch) {
  'use strict';

  // How much a match in each part of a recipe counts. Title matters most.
  const FIELD_WEIGHTS = {
    title: 8,
    aliases: 6,
    filing: 4,
    subtitle: 3,
    ingredients: 3,
    intro: 1,
    steps: 1,
  };

  // Words too common to help find anything. They're ignored in both recipes and searches.
  const STOP_WORDS = new Set([
    'a', 'an', 'and', 'the', 'of', 'with', 'for', 'to', 'in', 'on', 'or', 'at', 'by', 'from',
    'how', 'make', 'making', 'made', 'recipe', 'recipes', 'henry', 'henrys', 'kitchen',
  ]);

  const EPISODE_SEARCH = /^(?:ep(?:isode)?\.?\s*#?\s*)?(\d{1,4})$/i;

  /** Lowercase, without accents, apostrophes or asterisks: "Henry’s Shi*t" -> "henrys shit". */
  function simplify(text) {
    return String(text || '')
      .normalize('NFKD').replace(/[̀-ͯ]/g, '')
      .replace(/['’*]/g, '')
      .replace(/&/g, ' and ')
      .toLowerCase();
  }

  /** Splits joined-up words: "FrenchToast" -> "French Toast". */
  function splitCamelCase(text) {
    return String(text || '').replace(/([a-z])([A-Z])/g, '$1 $2');
  }

  function words(text) {
    return simplify(splitCamelCase(text)).split(/[^a-z0-9]+/).filter(Boolean);
  }

  /**
   * One word to the form it's stored and searched in: no stop words, and plurals
   * made singular so "raviolis" finds "ravioli". The same rules run on recipes
   * and searches, so they only have to be consistent, not perfect English.
   */
  function stem(word) {
    if (STOP_WORDS.has(word)) return null;
    if (word.length <= 3 || /^\d+$/.test(word)) return word;
    if (word.endsWith('ies')) return word.slice(0, -1);                 // cookies -> cookie
    if (word.endsWith('oes')) return word.slice(0, -2);                 // potatoes -> potato
    if (/(ch|sh|ss|x|z)es$/.test(word)) return word.slice(0, -2);       // sandwiches -> sandwich
    if (/[^su]s$/.test(word)) return word.slice(0, -1);              // raviolis -> ravioli
    return word;
  }

  /**
   * Splits a field into words. Titles also get each pair of neighbouring words
   * joined up, so a search for "frenchtoast" finds "French Toast".
   */
  function tokenize(text, field) {
    const list = words(text);
    if (field !== 'title') return list;
    const pairs = [];
    for (let i = 0; i < list.length - 1; i++) pairs.push(list[i] + list[i + 1]);
    return list.concat(pairs);
  }

  /** The words of a search as the index sees them, without repeats. */
  function searchTerms(query) {
    return [...new Set(words(query).map(stem).filter(Boolean))];
  }

  /**
   * Builds a search over the recipe list from assets/js/search-index.js.
   * Each recipe has: id (page id), title, plus text fields, and display details
   * v (video ID), e (episode), d (date).
   */
  function create(recipes) {
    const index = new MiniSearch({
      fields: Object.keys(FIELD_WEIGHTS),
      storeFields: ['title', 'v', 'e', 'd'],
      tokenize,
      processTerm: stem,
      searchOptions: {
        boost: FIELD_WEIGHTS,
        // Partial words count too ("toast" finds "toasted"), but only from four letters,
        // so short words like "pie" don't match "pieces".
        prefix: (term) => term.length >= 4,
        combineWith: 'OR',
      },
    });
    index.addAll(recipes);

    /**
     * Returns { matches, closeMatches }: recipes matching every word of the search,
     * best first, then recipes matching only some of them.
     */
    function search(query) {
      const text = String(query || '').trim();
      const episode = text.match(EPISODE_SEARCH);
      if (episode) {
        const number = String(Number(episode[1]));
        const byEpisode = recipes.filter((r) => r.e === number).map(toResult);
        if (byEpisode.length) return { matches: byEpisode, closeMatches: [] };
      }

      const wanted = searchTerms(text);
      if (!wanted.length) return { matches: [], closeMatches: [] };

      const matches = [];
      const closeMatches = [];
      for (const hit of index.search(text)) {
        const found = new Set(hit.queryTerms);
        (wanted.every((term) => found.has(term)) ? matches : closeMatches).push(toResult(hit));
      }
      return { matches, closeMatches };
    }

    return { search };
  }

  function toResult(r) {
    return { id: r.id, title: r.title, v: r.v, e: r.e, d: r.d };
  }

  return { create, searchTerms };
});
