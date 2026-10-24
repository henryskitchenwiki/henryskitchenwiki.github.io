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
 *   - also finds related words from content/search-words.json ("fry" finds "fries")
 *   - forgives small typos in longer words, and suggests the right spelling
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

  /** How many letters a word can be off by and still match: none for short words. */
  function typoAllowance(term) {
    if (term.length >= 8) return 2;
    if (term.length >= 5) return 1;
    return 0;
  }

  /** The number of single-letter changes to turn one word into another, stopping early past max. */
  function editDistance(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const current = [i];
      let best = i;
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
        best = Math.min(best, current[j]);
      }
      if (best > max) return max + 1;
      previous = current;
    }
    return previous[b.length];
  }

  /**
   * Builds a search over the recipe list from assets/js/search-index.js.
   * Each recipe has: id (page id), title, plus text fields, and display details
   * v (video ID), e (episode), d (date).
   *
   * relatedWords is the list from content/search-words.json: groups of words
   * that mean the same thing, e.g. ["fry", "fries"]. A search for one also finds
   * the others, counting a little less than the word typed.
   */
  function create(recipes, relatedWords) {
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

    // Related words: each word (as stored) -> the other words in its group.
    const related = new Map();
    for (const group of relatedWords || []) {
      const stems = [...new Set(group.flatMap(words).map(stem).filter(Boolean))];
      for (const word of stems) {
        const others = related.get(word) || new Set();
        for (const other of stems) if (other !== word) others.add(other);
        related.set(word, others);
      }
    }

    // Every word used anywhere on the site, with how often, for "Did you mean".
    const vocabulary = new Map();
    for (const r of recipes) {
      for (const field of Object.keys(FIELD_WEIGHTS)) {
        for (const word of words(r[field])) {
          if (word.length >= 4 && !/\d/.test(word)) vocabulary.set(word, (vocabulary.get(word) || 0) + 1);
        }
      }
    }
    const knownStems = new Set([...vocabulary.keys()].map(stem).filter(Boolean));

    /**
     * Returns { matches, closeMatches, suggestion }: recipes matching every word of
     * the search (best first), recipes matching only some of them, and a corrected
     * spelling of the search when a word looks mistyped (otherwise null).
     */
    function search(query) {
      const text = String(query || '').trim();
      const episode = text.match(EPISODE_SEARCH);
      if (episode) {
        const number = String(Number(episode[1]));
        const byEpisode = recipes.filter((r) => r.e === number).map(toResult);
        if (byEpisode.length) return { matches: byEpisode, closeMatches: [], suggestion: null };
      }

      const wanted = searchTerms(text);
      if (!wanted.length) return { matches: [], closeMatches: [], suggestion: null };

      // Each word typed, plus its related words. A word counts as found if any of them matched.
      const accepts = new Map(wanted.map((term) => [term, new Set([term, ...(related.get(term) || [])])]));
      const extra = [...new Set(wanted.flatMap((term) => [...accepts.get(term)]))].filter((t) => !wanted.includes(t));

      const hits = index.search([...wanted, ...extra].join(' '), {
        // Related words count a little under half as much as the words typed.
        boostTerm: (term) => (wanted.includes(term) ? 1 : 0.4),
        // Small typos are forgiven in longer words the person typed.
        fuzzy: (term) => (wanted.includes(term) ? typoAllowance(term) || false : false),
        // Related words must match whole: "bread" finds "toast" but not "toasted".
        prefix: (term) => wanted.includes(term) && term.length >= 4,
      });

      const matches = [];
      const closeMatches = [];
      for (const hit of hits) {
        const found = new Set(hit.queryTerms);
        const all = wanted.every((term) => [...accepts.get(term)].some((t) => found.has(t)));
        (all ? matches : closeMatches).push(toResult(hit));
      }
      return { matches, closeMatches, suggestion: suggestSpelling(text) };
    }

    /** "worchestershire sauce" -> "worcestershire sauce", or null if every word is known. */
    function suggestSpelling(text) {
      let changed = false;
      const corrected = words(text).map((word) => {
        const allowance = typoAllowance(word);
        const stemmed = stem(word);
        if (!allowance || !stemmed || vocabulary.has(word) || knownStems.has(stemmed) || related.has(stemmed)) return word;
        let best = null;
        let bestDistance = allowance + 1;
        for (const [candidate, count] of vocabulary) {
          const distance = editDistance(word, candidate, allowance);
          if (distance < bestDistance || (distance === bestDistance && best && count > vocabulary.get(best))) {
            best = candidate;
            bestDistance = distance;
          }
        }
        if (!best || bestDistance > allowance) return word;
        changed = true;
        return best;
      });
      return changed ? corrected.join(' ') : null;
    }

    return { search };
  }

  function toResult(r) {
    return { id: r.id, title: r.title, v: r.v, e: r.e, d: r.d };
  }

  return { create, searchTerms };
});
