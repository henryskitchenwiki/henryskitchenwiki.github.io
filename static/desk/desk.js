/* Transcription Desk
 *
 * A writing tool for turning a Henry's Kitchen episode into a recipe file.
 * Everything runs in the writer's browser: no server, no API key, no AI.
 *
 *   1. Pick a recipe        -> fills in the facts we already know (title, video, date)
 *   2. Watch                -> YouTube player with nudge buttons and keyboard shortcuts
 *   3. Paste the transcript -> writer copies YouTube's "Show transcript" panel by hand
 *   4-9. Fill in the recipe -> drafts save automatically in this browser
 *   10. Where it's filed    -> tick boxes from the category list
 *   11. Send to the Kitchen -> a new recipe opens GitHub's "new file" page, filled in;
 *                              an edit copies the file and opens GitHub's edit page to paste into
 *
 * Recipes already on the site open as an edit: the Desk loads the published version
 * from /assets/data/recipes/<id>.json (written by the site build, SiteBuilder/RecipeData.cs).
 * Fields the Desk has no boxes for (extra stats, hero image, search aliases, the
 * original writer) come along in its "keep" section and go back into the file untouched.
 *
 * Rules this file follows:
 *   - Text typed or pasted by people is only ever placed with textContent/value,
 *     never innerHTML, so nothing pasted can run as code.
 *   - Browser storage can be missing or blocked, so every use is wrapped in try/catch
 *     and the Desk still works without it (drafts just won't be remembered).
 */
(function () {
  'use strict';

  // ---- Settings ------------------------------------------------------------
  const REPO_NEW_FILE_URL = 'https://github.com/henryskitchenwiki/henryskitchenwiki.github.io/new/main';
  const REPO_EDIT_URL = 'https://github.com/henryskitchenwiki/henryskitchenwiki.github.io/edit/main/';
  const SITE_VERSION_FOLDER = '/assets/data/recipes/';
  const IS_MAC = /Mac|iPhone|iPad/.test(navigator.userAgent);
  const PULL_REQUESTS_URL = 'https://github.com/henryskitchenwiki/henryskitchenwiki.github.io/pulls?q=is%3Apr+author%3A%40me';
  const ONE_COLUMN = window.matchMedia('(max-width: 980px)');   // matches desk.css
  const UNDO_SECONDS = 8;
  const RECIPE_FOLDER = 'content/recipes/';
  const MAX_URL_LENGTH = 7500;          // longer links can be cut off by browsers or GitHub
  const NUDGE_SECONDS = 3;
  const SLOW_SPEED = 0.75;
  const DRAFT_PREFIX = 'hk-desk-draft:';
  const HANDLE_KEY = 'hk-desk-handle';
  const LAST_RECIPE_KEY = 'hk-desk-last';

  // Common mishearings in YouTube's automatic captions. Add to this list as we find more.
  const CAPTION_FIXES = [
    [/\bworcester sauce\b/gi, 'Worcestershire sauce'],
    [/\bwooster sauce\b/gi, 'Worcestershire sauce'],
    [/\bchip beef\b/gi, 'chipped beef'],
    [/\bhenry['’]?s kitchen\b/gi, 'Henry’s Kitchen'],
    [/\bjose suicidio\b/gi, 'José Suicidio']
  ];

  const recipes = (window.HK_RECIPES || []).slice().sort((a, b) => a.d.localeCompare(b.d));

  // Categories to file under, from content/categories.json (via the site build).
  // i = main ingredients, c = collections, h = holidays.
  const CATEGORIES = window.HK_CATEGORIES || { ingredients: [], collections: [], holidays: [] };
  const FILING_KINDS = { i: CATEGORIES.ingredients, c: CATEGORIES.collections, h: CATEGORIES.holidays };
  const $ = (id) => document.getElementById(id);

  let current = null;     // the recipe being written up
  let player = null;      // YouTube player, once ready
  let segments = [];      // transcript lines: { time: seconds or null, text }
  let lastAnchor = -1;    // for shift-click selection of transcript lines
  let lastTimeScope = null;
  let dirty = false;      // true once the writer changes something, so just looking never saves a draft

  // For recipes already on the site (current.w):
  let siteVersion = null; // the published version, in the same shape as a draft
  let siteHash = '';      // a fingerprint of it, so a draft knows which version it was based on

  // ---- Small helpers -------------------------------------------------------
  function storageGet(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }
  function storageSet(key, value) {
    try { window.localStorage.setItem(key, value); return true; } catch (e) { return false; }
  }
  function storageRemove(key) {
    try { window.localStorage.removeItem(key); } catch (e) { /* nothing to do */ }
  }

  /** "1:42", "01:02:03" or "102" -> seconds. Returns null for blank, NaN for nonsense. */
  function parseTime(text) {
    const value = String(text || '').trim();
    if (!value) return null;
    if (/^\d+$/.test(value)) return Number(value);
    const match = value.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
    if (!match) return NaN;
    const [, hours, minutes, seconds] = match;
    if (Number(seconds) > 59 || (hours && Number(minutes) > 59)) return NaN;
    return Number(hours || 0) * 3600 + Number(minutes) * 60 + Number(seconds);
  }

  /** seconds -> "1:42" (or "1:02:03" past an hour). */
  function formatTime(totalSeconds) {
    const s = Math.max(0, Math.floor(totalSeconds));
    const hours = Math.floor(s / 3600);
    const minutes = Math.floor((s % 3600) / 60);
    const seconds = String(s % 60).padStart(2, '0');
    return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
  }

  /** Writer's name -> the handle used in the file, e.g. "Royal Flush" -> "royal-flush". */
  function toHandle(name) {
    return String(name || '').trim().toLowerCase()
      .normalize('NFKD').replace(/[̀-ͯ]/g, '')
      .replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  /** Clean up caption text without changing Henry's words. */
  function tidy(text) {
    let out = String(text || '')
      .replace(/\[(music|applause|laughter|♪+)\]/gi, ' ')
      .replace(/♪/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/\s+([,.!?;:])/g, '$1')
      .replace(/(\w)'(\w)/g, '$1’$2')
      .trim();
    for (const [pattern, replacement] of CAPTION_FIXES) out = out.replace(pattern, replacement);
    // Capital letter at the start of each paragraph.
    return out.replace(/(^|\n\n)([a-z])/g, (m, gap, letter) => gap + letter.toUpperCase());
  }

  function tidyLines(text) {
    return String(text || '').split('\n')
      .map((line) => tidy(line).replace(/^[-•*]\s*/, ''))
      .filter(Boolean)
      .join('\n');
  }

  /** "2020-01-10" -> "Jan 10, 2020", like the rest of the site. */
  function friendlyDate(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  /** The step boxes, without any "Step removed · Undo" lines between them. */
  function stepItems() {
    return Array.from($('steps').querySelectorAll(':scope > .step-item'));
  }

  /** Nothing to watch or fill in until a recipe is picked. */
  function setLocked(locked) {
    for (const part of document.querySelectorAll('[data-needs-recipe]')) {
      part.inert = locked;
      part.classList.toggle('is-locked', locked);
    }
  }

  /** The draft line in the header (and in the docked player on small screens). */
  function setDraftStatus(text) {
    $('draft-status').textContent = text;
    $('dock-status').textContent = text;
  }

  // ---- 1. Pick a recipe ----------------------------------------------------
  /** Lowercase, without apostrophes, asterisks or accents, so "henrys" finds "Henry’s". */
  function searchable(text) {
    return String(text || '').toLowerCase()
      .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .replace(/['’*]/g, '');
  }

  /** True when every word typed is in the title, or is the episode number. */
  function matches(recipe, words) {
    const title = searchable(recipe.t);
    return words.every((word) => title.includes(word) || word === String(recipe.e).toLowerCase());
  }

  function optionLabel(r) {
    return (r.w ? '✓ On the site · ' : '') + (r.e ? `Ep ${r.e} · ` : '') + r.t + ` (${r.d.slice(0, 4)})`;
  }

  let searchResults = [];   // recipes matching the search box, newest first

  /** Rebuilds the dropdown from the search box and the "still need writing up" tick box. */
  function filterPicker() {
    const pick = $('recipe-pick');
    const words = searchable($('recipe-search').value).replace(/^ep(isode)?\s*/, '').split(/\s+/).filter(Boolean);
    const neededOnly = $('still-needed').checked;
    const shown = recipes.slice().reverse()
      .filter((r) => matches(r, words) && (!neededOnly || !r.w));
    searchResults = shown;

    pick.replaceChildren(new Option(shown.length ? 'Choose a recipe…' : 'No recipes match that search', ''));
    // Keep the recipe being written up in the list, so the dropdown never looks blank while working.
    if (current && !shown.includes(current)) pick.add(new Option(optionLabel(current), current.v));
    for (const r of shown) pick.add(new Option(optionLabel(r), r.v));
    pick.value = current ? current.v : '';

    const done = recipes.filter((r) => r.w).length;
    $('recipe-count').textContent = words.length || neededOnly
      ? `(${shown.length} of ${recipes.length} shown)`
      : `(${recipes.length} recipes · ${done} on the site · ${recipes.length - done} still needed)`;

    // Exactly one match: open it straight away.
    if (words.length && shown.length === 1 && shown[0] !== current) {
      pick.value = shown[0].v;
      chooseRecipe(shown[0].v);
    }
  }

  function fillPicker() {
    const pick = $('recipe-pick');
    pick.addEventListener('change', () => chooseRecipe(pick.value));
    $('recipe-search').addEventListener('input', filterPicker);
    $('still-needed').addEventListener('change', filterPicker);
    // Enter in the search box opens the first match instead of submitting anything.
    $('recipe-search').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const first = searchResults[0];
      if (first && first !== current) { pick.value = first.v; chooseRecipe(first.v); }
    });

    const fromAddress = new URLSearchParams(window.location.search).get('v');
    const start = recipes.some((r) => r.v === fromAddress) ? fromAddress : storageGet(LAST_RECIPE_KEY);
    if (start && recipes.some((r) => r.v === start)) chooseRecipe(start);
    else chooseRecipe(null);
    filterPicker();
  }

  function chooseRecipe(videoId) {
    if (current) saveDraft();
    current = recipes.find((r) => r.v === videoId) || null;
    dirty = false;
    siteVersion = null;
    siteHash = '';
    clearForm();
    showEditStatus('');
    setLocked(!current);
    if (!current) { $('recipe-facts').textContent = 'Pick a recipe to start.'; setDraftStatus(''); return; }

    storageSet(LAST_RECIPE_KEY, current.v);
    const url = new URL(window.location.href);
    url.searchParams.set('v', current.v);
    history.replaceState(null, '', url);

    $('recipe-facts').textContent =
      current.t + ' · ' + (current.e ? `Episode ${current.e} · ` : '') +
      `Aired ${friendlyDate(current.d)} · ${formatTime(current.l)} long · File name: ${current.s}.md`;
    $('title').value = current.t.replace(/^how to make\s+(?:(?:a|an|the)\s+)?/i, '');
    loadVideo(current.v);
    $('get-transcript').href = 'https://www.youtube.com/watch?v=' + encodeURIComponent(current.v);
    setFiling(current.f);
    $('handle').value = $('handle').value || storageGet(HANDLE_KEY) || '';
    showSendMode();

    if (current.w) {
      openSiteVersion(current);
    } else {
      const draft = readDraft();
      if (draft) {
        fillForm(draft);
        setDraftStatus(`Picked up your draft from ${when(draft.savedAt)}`);
      } else {
        setDraftStatus('');
      }
      if (stepItems().length === 0) addStep();
      updatePreview();
    }
  }

  // ---- Editing a recipe that's already on the site ------------------------
  /**
   * Loads the published version and decides what to show:
   *   - no draft                          -> the version on the site
   *   - a draft based on that version     -> the draft (the writer's edit in progress)
   *   - an older draft (from before it    -> the version on the site, with a button to
   *     was published, or before someone      use the draft instead
   *     else's edit)
   */
  async function openSiteVersion(recipe) {
    const form = $('recipe-form');
    form.inert = true;   // nothing to type into until we know which version to show
    showEditStatus('Loading the version on the site…');
    let text = null;
    try {
      const response = await fetch(SITE_VERSION_FOLDER + encodeURIComponent(recipe.s) + '.json', { cache: 'no-cache' });
      if (response.ok) text = await response.text();
    } catch (e) {
      text = null;
    }
    if (current !== recipe) return;   // the writer picked another recipe while this loaded
    form.inert = false;

    const draft = readDraft();
    try { siteVersion = text ? JSON.parse(text) : null; } catch (e) { siteVersion = null; }
    if (!siteVersion) {
      // Without the published version an edit could drop parts of the recipe, so sending waits for it.
      if (draft) fillForm(draft);
      showEditStatus('Couldn’t load the version on the site. Reload the page to try again.');
    } else {
      siteHash = fingerprint(text);
      if (draft && draft.basedOn === siteHash) {
        fillForm(draft);
        showEditStatus(`Editing your changes from ${when(draft.savedAt)}.`, 'Load the version on the site', clearDraft);
      } else {
        fillForm(siteVersion);
        if (draft) showEditStatus(`Editing the version on the site. You also have a draft from ${when(draft.savedAt)}.`, 'Use my draft instead', useOldDraft);
        else showEditStatus('Editing the version on the site.');
      }
    }
    if (stepItems().length === 0) addStep();
    updatePreview();
  }

  /** Swaps the version on the site for the writer's older draft. */
  function useOldDraft() {
    const draft = readDraft();
    if (!draft) return;
    fillForm(draft);
    changed();
    showEditStatus(`Editing your changes from ${when(draft.savedAt)}.`, 'Load the version on the site', clearDraft);
  }

  /** The line under the recipe facts, with an optional button. Empty text hides it. */
  function showEditStatus(text, buttonText, onClick) {
    $('edit-status-text').textContent = text;
    $('edit-status').hidden = !text;
    const button = $('edit-status-button');
    button.hidden = !buttonText;
    button.textContent = buttonText || '';
    button.onclick = onClick || null;
  }

  /** Wording that changes between writing a new recipe and editing one. */
  function showSendMode() {
    const editing = Boolean(current && current.w);
    $('send').textContent = editing ? 'Send my changes' : 'Send to the Kitchen';
    $('send-about').textContent = editing
      ? 'Opens the recipe on GitHub, with your version copied to paste in.'
      : 'Opens GitHub with your recipe filled in.';
    $('clear-draft').textContent = editing ? 'Undo my changes' : 'Start this recipe over';
  }

  /** A short fingerprint of some text (FNV-1a). Only used to tell versions apart, not for security. */
  function fingerprint(text) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16);
  }

  function when(iso) {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? 'earlier' : date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  function clearForm() {
    for (const id of ['title', 'subtitle', 'intro-start', 'intro-end', 'intro-text',
      'ingredients-at', 'servings', 'ingredients', 'notes', 'transcript-paste']) {
      $(id).value = '';
      $(id).classList.remove('is-bad');
    }
    $('intro-source').value = 'transcript-panel';
    setFiling(null);
    $('steps').replaceChildren();
    $('songs').replaceChildren();
    $('check-results').replaceChildren();
    $('send-results').replaceChildren();
    $('transcript-status').textContent = '';
    setSegments([]);
  }

  // ---- 2. Watch: the YouTube player ----------------------------------------
  let apiRequested = false;
  let pendingVideo = null;

  function loadVideo(videoId) {
    if (player && player.loadVideoById) { player.cueVideoById(videoId); return; }
    pendingVideo = videoId;
    if (apiRequested) return;
    apiRequested = true;
    window.onYouTubeIframeAPIReady = createPlayer;
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.onerror = () => showVideoNote('The video player couldn’t load. Check your connection, or watch on YouTube in another tab and type times by hand.');
    document.head.appendChild(script);
  }

  function createPlayer() {
    player = new window.YT.Player('yt-player', {
      host: 'https://www.youtube-nocookie.com',
      videoId: pendingVideo,
      // cc_load_policy turns captions on, so writers can read along while typing by ear.
      playerVars: { rel: 0, modestbranding: 1, playsinline: 1, cc_load_policy: 1, cc_lang_pref: 'en' },
      events: { onReady: () => { player.ready = true; } }
    });
    window.setInterval(tick, 250);
  }

  function showVideoNote(message) {
    const note = document.createElement('p');
    note.className = 'video-note';
    note.textContent = message;
    $('yt-player').replaceWith(note);
  }

  function now() {
    return player && player.ready ? player.getCurrentTime() : null;
  }

  function seek(seconds) {
    if (!player || !player.ready) return;
    player.seekTo(Math.max(0, seconds), true);
  }

  function togglePlay() {
    if (!player || !player.ready) return;
    if (player.getPlayerState() === window.YT.PlayerState.PLAYING) player.pauseVideo();
    else player.playVideo();
  }

  function nudge(seconds) {
    const t = now();
    if (t !== null) seek(t + seconds);
  }

  function toggleSpeed() {
    if (!player || !player.ready) return;
    const slow = player.getPlaybackRate() !== SLOW_SPEED;
    player.setPlaybackRate(slow ? SLOW_SPEED : 1);
    document.querySelector('[data-action="speed"]').setAttribute('aria-pressed', String(slow));
  }

  /** Runs four times a second: updates the clock and highlights the line being spoken. */
  let lastShown = -1;
  function tick() {
    const t = now();
    if (t === null) return;
    const whole = Math.floor(t);
    if (whole === lastShown) return;
    lastShown = whole;
    $('clock').textContent = formatTime(whole);
    const items = $('segments').children;
    let active = -1;
    segments.forEach((seg, i) => { if (seg.time !== null && seg.time <= whole) active = i; });
    for (let i = 0; i < items.length; i++) items[i].classList.toggle('is-now', i === active);
  }

  // ---- Stamping times ------------------------------------------------------
  function stampInto(input) {
    const t = now();
    if (t === null || !input) return;
    input.value = formatTime(t);
    input.classList.remove('is-bad');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  /** The time box that belongs to whatever the writer is working in. */
  function timeBoxForFocus() {
    const active = document.activeElement;
    if (active && active.classList.contains('time')) return active;
    const scope = (active && active.closest('[data-time-scope]')) || lastTimeScope;
    return scope ? scope.querySelector('.time') : null;
  }

  // ---- 3. The transcript ---------------------------------------------------
  /**
   * Reads text copied from YouTube's transcript panel. Handles the layouts we've seen:
   *   0:14                    0:14 hello everybody      0:14
   *   14 seconds              0:17 welcome to...        hello everybody
   *   hello everybody
   * Lines without a time are joined onto the line before.
   */
  function parseTranscript(raw) {
    const timeOnly = /^(?:\d+:)?\d{1,2}:\d{2}$/;
    const timeThenText = /^((?:\d+:)?\d{1,2}:\d{2})\s+(.+)$/;
    const spokenTime = /^(?:\d+ hours?,?\s*)?(?:\d+ minutes?,?\s*)?(?:\d+ seconds?)?$/i;
    const result = [];
    let open = null;

    for (const rawLine of String(raw).split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      let match;
      if (timeOnly.test(line)) {
        open = { time: parseTime(line), text: '' };
        result.push(open);
      } else if ((match = line.match(timeThenText))) {
        open = { time: parseTime(match[1]), text: match[2] };
        result.push(open);
      } else if (open && !open.text && spokenTime.test(line)) {
        continue;   // the "14 seconds" line screen readers use; not part of what Henry said
      } else if (open) {
        open.text = open.text ? `${open.text} ${line}` : line;
      } else {
        open = { time: null, text: line };
        result.push(open);
      }
    }
    return result.filter((seg) => seg.text);
  }

  function setSegments(list) {
    segments = list;
    lastAnchor = -1;
    const box = $('segments');
    box.replaceChildren();
    list.forEach((seg, i) => {
      const li = document.createElement('li');
      const check = document.createElement('input');
      check.type = 'checkbox';
      check.setAttribute('aria-label', `Select line ${i + 1}`);
      li.append(check);
      if (seg.time !== null) {
        const jump = document.createElement('button');
        jump.type = 'button';
        jump.className = 'seg-time';
        jump.textContent = formatTime(seg.time);
        jump.setAttribute('aria-label', `Play from ${formatTime(seg.time)}`);
        jump.addEventListener('click', (e) => { e.stopPropagation(); seek(seg.time); });
        li.append(jump);
      }
      const text = document.createElement('span');
      text.className = 'seg-text';
      text.textContent = seg.text;
      const used = document.createElement('span');
      used.className = 'seg-used';
      li.append(text, used);
      li.addEventListener('click', (e) => onSegmentClick(e, i, check));
      box.append(li);
    });
    $('segment-actions').hidden = list.length === 0;
    markUsedLines();
  }

  /** Letters and numbers only, for comparing transcript lines with what's in the form. */
  function plain(text) {
    return searchable(tidy(text)).replace(/[^a-z0-9]+/g, ' ').trim();
  }

  /**
   * Greys out transcript lines that are already in the recipe and says where:
   * Intro, Ingredients or Step 2. It compares the words, so it stays right when
   * steps are moved, edited or removed, and after a draft is reopened.
   */
  function markUsedLines() {
    const items = $('segments').children;
    if (!items.length) return;
    const places = [
      ['Intro', plain($('intro-text').value)],
      ['Ingredients', plain($('ingredients').value)],
      ...stepItems().map((item, i) => [`Step ${i + 1}`, plain(item.querySelector('.step-text').value)])
    ];
    segments.forEach((seg, i) => {
      if (seg.plain === undefined) seg.plain = plain(seg.text);
      const words = seg.plain;
      const found = words.length >= 3 ? places.find(([, text]) => ` ${text} `.includes(` ${words} `)) : null;
      items[i].classList.toggle('is-used', Boolean(found));
      items[i].querySelector('.seg-used').textContent = found ? found[0] : '';
    });
  }

  function onSegmentClick(event, index, check) {
    const items = $('segments').children;
    if (event.target !== check) check.checked = !check.checked;
    if (event.shiftKey && lastAnchor >= 0) {
      const [from, to] = [Math.min(lastAnchor, index), Math.max(lastAnchor, index)];
      for (let i = from; i <= to; i++) items[i].querySelector('input').checked = check.checked;
    }
    lastAnchor = index;
    for (const li of items) li.classList.toggle('is-selected', li.querySelector('input').checked);
  }

  function selectedSegments() {
    const items = Array.from($('segments').children);
    const picked = [];
    items.forEach((li, i) => { if (li.querySelector('input').checked) picked.push(i); });
    return picked;
  }

  function clearSelection() {
    for (const li of $('segments').children) {
      li.querySelector('input').checked = false;
      li.classList.remove('is-selected');
    }
  }

  function requireSelection() {
    const picked = selectedSegments();
    if (!picked.length) $('transcript-status').textContent = 'Tick one or more lines first.';
    return picked;
  }

  function useAsIntro() {
    const picked = requireSelection();
    if (!picked.length) return;
    const first = segments[picked[0]];
    const after = segments[picked[picked.length - 1] + 1];
    $('intro-text').value = tidy(picked.map((i) => segments[i].text).join(' '));
    if (first.time !== null) $('intro-start').value = formatTime(first.time);
    if (after && after.time !== null) $('intro-end').value = formatTime(after.time);
    $('intro-source').value = 'transcript-panel';
    clearSelection();
    changed();
    $('intro-text').focus();
  }

  function useAsStep() {
    const picked = requireSelection();
    if (!picked.length) return;
    const first = segments[picked[0]];
    const text = tidy(picked.map((i) => segments[i].text).join(' '));
    // Reuse an empty step box if there is one at the end.
    const steps = stepItems();
    const last = steps[steps.length - 1];
    const item = last && !last.querySelector('.step-text').value.trim() ? last : addStep();
    item.querySelector('.step-text').value = text;
    if (first.time !== null) item.querySelector('.step-time').value = formatTime(first.time);
    clearSelection();
    changed();
  }

  function useAsIngredients() {
    const picked = requireSelection();
    if (!picked.length) return;
    const box = $('ingredients');
    const lines = picked.map((i) => tidy(segments[i].text));
    box.value = [box.value.trim(), ...lines].filter(Boolean).join('\n');
    const first = segments[picked[0]];
    if (!$('ingredients-at').value && first.time !== null) $('ingredients-at').value = formatTime(first.time);
    clearSelection();
    changed();
  }

  // ---- 10. Where it's filed -------------------------------------------------
  /** Builds the tick boxes from the category list, once. */
  function buildFilingBoxes() {
    for (const group of document.querySelectorAll('.filing-group')) {
      const kind = group.dataset.kind;
      const boxes = document.createElement('div');
      boxes.className = 'filing-boxes';
      for (const category of FILING_KINDS[kind] || []) {
        const label = document.createElement('label');
        label.className = 'filing-box';
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.value = category.id;
        box.dataset.kind = kind;
        label.append(box, document.createTextNode(' ' + category.name));
        boxes.append(label);
      }
      group.append(boxes);
    }
  }

  /** Ticks the boxes for a filing ({ i, c, h } of category ids); null unticks everything. */
  function setFiling(filing) {
    for (const box of document.querySelectorAll('.filing-boxes input')) {
      box.checked = Boolean(filing && (filing[box.dataset.kind] || []).includes(box.value));
    }
  }

  function getFiling() {
    const filing = { i: [], c: [], h: [] };
    for (const box of document.querySelectorAll('.filing-boxes input:checked')) filing[box.dataset.kind].push(box.value);
    return filing;
  }

  // ---- 7. Steps and 8. songs -----------------------------------------------
  function addStep(text, at) {
    const item = $('step-template').content.firstElementChild.cloneNode(true);
    item.querySelector('.step-text').value = text || '';
    item.querySelector('.step-time').value = at || '';
    $('steps').append(item);
    renumberSteps();
    return item;
  }

  function renumberSteps() {
    stepItems().forEach((item, i) => {
      const n = i + 1;
      item.querySelector('.step-number').textContent = n;
      item.querySelector('.step-text').setAttribute('aria-label', `Step ${n}`);
      item.querySelector('.step-time').setAttribute('aria-label', `Step ${n} starts at`);
      item.querySelector('.step-remove').setAttribute('aria-label', `Remove step ${n}`);
    });
  }

  function onStepTool(button) {
    const item = button.closest('.step-item');
    const action = button.dataset.step;
    if (action === 'remove') removeStep(item);
    if (action === 'up') { const before = previousStep(item); if (before) before.before(item); }
    if (action === 'down') { const after = nextStep(item); if (after) after.after(item); }
    if (action !== 'remove') button.focus();
    renumberSteps();
    changed();
  }

  function previousStep(item) {
    let el = item.previousElementSibling;
    while (el && !el.classList.contains('step-item')) el = el.previousElementSibling;
    return el;
  }

  function nextStep(item) {
    let el = item.nextElementSibling;
    while (el && !el.classList.contains('step-item')) el = el.nextElementSibling;
    return el;
  }

  /** Swaps a step for a "Step 3 removed · Undo" line, which goes away on its own after a few seconds. */
  function removeStep(item) {
    const number = stepItems().indexOf(item) + 1;
    const note = document.createElement('li');
    note.className = 'step-removed';
    const undo = document.createElement('button');
    undo.type = 'button';
    undo.className = 'btn btn-small btn-link';
    undo.textContent = 'Undo';
    note.append(document.createTextNode(`Step ${number} removed.`), undo);
    item.replaceWith(note);
    undo.focus();   // so keyboard users aren't dropped at the top of the page
    const timer = window.setTimeout(() => note.remove(), UNDO_SECONDS * 1000);
    undo.addEventListener('click', () => {
      window.clearTimeout(timer);
      note.replaceWith(item);
      renumberSteps();
      changed();
      item.querySelector('.step-text').focus();
    });
  }

  function addSong(song) {
    const item = $('song-template').content.firstElementChild.cloneNode(true);
    if (song) {
      item.querySelector('.song-title').value = song.title || '';
      item.querySelector('.song-album').value = song.album || '';
      item.querySelector('.song-link').value = song.link || '';
      item.querySelector('.song-heard').checked = Boolean(song.heard);
      if (song.artist) item.dataset.artist = song.artist;
    }
    $('songs').append(item);
    return item;
  }

  // ---- Reading the form ----------------------------------------------------
  function readForm() {
    const paragraphs = $('intro-text').value.split(/\n\s*\n/).map((p) => p.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean);
    return {
      title: $('title').value.trim(),
      subtitle: $('subtitle').value.trim(),
      handle: $('handle').value.trim(),
      introStart: $('intro-start').value.trim(),
      introEnd: $('intro-end').value.trim(),
      introSource: $('intro-source').value,
      introParagraphs: paragraphs,
      ingredientsAt: $('ingredients-at').value.trim(),
      servings: $('servings').value.trim(),
      ingredients: $('ingredients').value.split('\n').map((s) => s.trim()).filter(Boolean),
      steps: stepItems().map((item) => ({
        text: item.querySelector('.step-text').value.replace(/\s+/g, ' ').trim(),
        at: item.querySelector('.step-time').value.trim()
      })).filter((s) => s.text || s.at),
      songs: Array.from($('songs').children).map((item) => ({
        title: item.querySelector('.song-title').value.trim(),
        album: item.querySelector('.song-album').value.trim(),
        link: item.querySelector('.song-link').value.trim(),
        heard: item.querySelector('.song-heard').checked,
        artist: item.dataset.artist || 'José Suicidio'
      })).filter((s) => s.title),
      notes: $('notes').value.trim(),
      filing: getFiling()
    };
  }

  // ---- Checking ------------------------------------------------------------
  /**
   * Returns { problems: [], warnings: [] }, each item { text, target }. The target is
   * the box to fix, so the list can take the writer straight there. Problems block
   * sending; warnings don't.
   */
  function check(form) {
    const problems = [];
    const warnings = [];
    const problem = (text, target) => problems.push({ text, target: target || null });
    const warning = (text, target) => warnings.push({ text, target: target || null });
    const steps = stepItems();

    if (!current) problem('Pick a recipe at the top of the page first.', $('recipe-search'));
    if (current && current.w && !siteVersion) problem('The version on the site didn’t load. Reload the page and try again.');
    if (!form.title) problem('The recipe needs a title.', $('title'));
    if (!form.handle) problem('Add your name.', $('handle'));
    if (!form.introParagraphs.length) problem('Add Henry’s introduction.', $('intro-text'));
    if (!form.ingredients.length) problem('Add at least one ingredient.', $('ingredients'));
    if (!form.steps.some((s) => s.text)) problem('Add at least one step.', steps[0] ? steps[0].querySelector('.step-text') : $('add-step'));
    const marked = Array.from(document.querySelectorAll('#recipe-form .field')).find((box) => /\[\[|\]\]/.test(box.value));
    if (marked) problem('Remove the [[ ]] placeholder marks before sending.', marked);

    const length = current ? current.l : Infinity;
    const timeBoxes = [
      [$('intro-start'), 'Introduction start'],
      [$('intro-end'), 'Introduction end'],
      [$('ingredients-at'), 'Ingredients time'],
      ...steps.map((item, i) => [item.querySelector('.step-time'), `Step ${i + 1} time`])
    ];
    for (const [box, label] of timeBoxes) {
      const text = timeProblem(box.value.trim(), label, length);
      box.classList.toggle('is-bad', Boolean(text));
      if (text) problem(text, box);
    }

    const start = parseTime(form.introStart);
    const end = parseTime(form.introEnd);
    if (start !== null && end !== null && end <= start) problem('The introduction has to end after it starts.', $('intro-end'));
    if (!form.introEnd) warning('No end time for the introduction yet.', $('intro-end'));
    const firstIngredientBox = document.querySelector('.filing-group[data-kind="i"] input');
    if (!form.filing.i.length) warning('Not filed under a main ingredient.', firstIngredientBox);
    if (form.filing.i.length > 3) warning('More than 3 main ingredients.', firstIngredientBox);

    const untimed = steps.filter((item) => item.querySelector('.step-text').value.trim() && !item.querySelector('.step-time').value.trim());
    if (untimed.length) warning(`${untimed.length} step${untimed.length === 1 ? ' has' : 's have'} no time.`, untimed[0].querySelector('.step-time'));
    let previous = null;
    for (const item of steps) {
      const box = item.querySelector('.step-time');
      const t = parseTime(box.value);
      if (t === null || Number.isNaN(t)) continue;
      if (previous !== null && t < previous) { warning('Some step times are out of order.', box); break; }
      previous = t;
    }
    for (const item of $('songs').children) {
      const title = item.querySelector('.song-title').value.trim();
      const link = item.querySelector('.song-link');
      if (title && link.value.trim() && !/^https:\/\/music\.youtube\.com\//.test(link.value.trim())) {
        problem(`The link for “${title}” should start with https://music.youtube.com/`, link);
      }
    }
    return { problems, warnings };
  }

  /** What's wrong with a time box, or '' if it's fine (blank is fine). */
  function timeProblem(value, label, length) {
    const seconds = parseTime(value);
    if (seconds === null) return '';
    if (Number.isNaN(seconds)) return `${label} “${value}” isn’t a time. Use minutes:seconds, like 1:42.`;
    if (seconds > length) return `${label} ${value} is past the end of the episode (${formatTime(length)}).`;
    return '';
  }

  function showCheck(result) {
    const box = $('check-results');
    box.replaceChildren();
    const heading = document.createElement('p');
    if (!result.problems.length) {
      heading.className = 'check-ok';
      heading.textContent = result.warnings.length ? 'Ready to send. A few notes:' : 'Ready to send.';
    } else {
      heading.className = 'check-problem';
      heading.textContent = 'Fix these first:';
    }
    box.append(heading);
    const list = document.createElement('ul');
    list.className = 'check-list';
    for (const item of result.problems) list.append(checkItem(item, 'check-problem'));
    for (const item of result.warnings) list.append(checkItem(item, 'check-warning'));
    if (list.children.length) box.append(list);
  }

  /** One line of the check. With a target it's a button that goes to the box to fix. */
  function checkItem(item, className) {
    if (!item.target) return listItem(item.text, className);
    const li = document.createElement('li');
    li.className = className;
    const jump = document.createElement('button');
    jump.type = 'button';
    jump.className = 'check-jump';
    jump.textContent = item.text;
    jump.addEventListener('click', () => {
      item.target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      item.target.focus({ preventScroll: true });
    });
    li.append(jump);
    return li;
  }

  function listItem(text, className) {
    const li = document.createElement('li');
    li.className = className;
    li.textContent = text;
    return li;
  }

  // ---- Writing the recipe file ---------------------------------------------
  /** A YAML string in double quotes, safe for any text Henry might say. */
  function q(text) {
    return '"' + String(text)
      .replace(/\\/g, '\\\\').replace(/"/g, '\\"')
      .replace(/\t/g, ' ').replace(/[\r\n]+/g, ' ') + '"';
  }

  function buildFile(form) {
    if (!current) return '';
    const lines = [
      '---',
      '# ── Identity ──',
      `id: ${current.s}`,
      `title: ${q(form.title)}`,
      `subtitle: ${q(form.subtitle)}`,
      '',
      '# ── Source video ──',
      `youtube_id: ${q(current.v)}`,
      `episode: ${current.e || ''}`,
      `aired: ${current.d}`,
      'series: henrys-kitchen',
      '',
      '# ── Where it’s filed ──',
      `collections: [${form.filing.c.map(q).join(', ')}]`,
      `main_ingredients: [${form.filing.i.map(q).join(', ')}]`,
      `holidays: [${form.filing.h.map(q).join(', ')}]`,
      '',
      '# ── Henry’s introduction ──',
      'intro:',
      `  start: ${q(form.introStart || '0:00')}`,
      `  end: ${q(form.introEnd)}`,
      `  source: ${form.introSource}`,
      '  text: |'
    ];
    if (form.introParagraphs.length) {
      form.introParagraphs.forEach((p, i) => {
        if (i > 0) lines.push('');
        lines.push('    ' + p);
      });
    } else {
      lines.push('    ');
    }
    // Parts the Desk has no boxes for come from the version on the site, unchanged.
    const keep = (current.w && siteVersion && siteVersion.keep) || {};
    lines.push('', '# ── Recipe card ──', form.servings ? `servings: ${q(form.servings)}` : 'servings:');
    if (keep.stats && keep.stats.length) {
      lines.push('stats:');
      for (const stat of keep.stats) lines.push(`  - label: ${q(stat.label)}`, `    value: ${q(stat.value)}`);
    } else {
      lines.push('stats: []');
    }
    lines.push(`ingredients_at: ${q(form.ingredientsAt)}`);
    if (form.ingredients.length) {
      lines.push('ingredients:');
      for (const item of form.ingredients) lines.push(`  - ${q(item)}`);
    } else {
      lines.push('ingredients: []');
    }
    const steps = form.steps.filter((s) => s.text);
    if (steps.length) {
      lines.push('steps:');
      for (const step of steps) lines.push(`  - text: ${q(step.text)}`, `    at: ${q(step.at)}`);
    } else {
      lines.push('steps: []');
    }
    lines.push('', '# ── Songs ──');
    if (form.songs.length) {
      lines.push('songs:');
      for (const song of form.songs) {
        lines.push(`  - title: ${q(song.title)}`, `    artist: ${q(song.artist)}`, `    album: ${q(song.album)}`,
          `    heard_in_episode: ${song.heard}`, `    youtube_music: ${q(song.link)}`);
      }
    } else {
      lines.push('songs: []');
    }
    // written_up_by stays with whoever first wrote the recipe up.
    lines.push('', '# ── Extras ──', `hero_image: ${q(keep.heroImage || '')}`,
      `search_aliases: [${(keep.searchAliases || []).map(q).join(', ')}]`,
      `written_up_by: ${q(keep.writtenUpBy || toHandle(form.handle))}`, '---');
    if (form.notes) lines.push('', form.notes);
    return lines.join('\n') + '\n';
  }

  function updatePreview() {
    $('file-preview').textContent = buildFile(readForm());
  }

  // ---- 10. Sending ---------------------------------------------------------
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Runs the check before sending or saving. Shows any problems and returns false
   * if there's something to fix, so writers never send a recipe that won't build.
   */
  function readyToGo(form) {
    const result = check(form);
    showCheck(result);
    $('send-results').replaceChildren();
    if (!result.problems.length) return true;
    $('check-results').scrollIntoView({ behavior: 'smooth', block: 'center' });
    return false;
  }

  async function send() {
    const form = readForm();
    if (!readyToGo(form)) return;
    const file = buildFile(form);
    const filename = RECIPE_FOLDER + current.s + '.md';
    saveDraft();
    if (current.w) { await sendEdit(file, filename); return; }

    const fullUrl = `${REPO_NEW_FILE_URL}?filename=${encodeURIComponent(filename)}&value=${encodeURIComponent(file)}`;
    const alreadyThere = 'If GitHub says the file already exists, someone has just added this recipe. Reload the Desk in a few minutes and it will open as an edit.';
    if (fullUrl.length <= MAX_URL_LENGTH) {
      window.open(fullUrl, '_blank', 'noopener');
      showNextSteps('In the GitHub tab:', [
        'Sign in if asked.',
        'If asked to fork the repository, click Fork.',
        'Click Propose new file.',
        'Click Create pull request, then Create pull request again.'
      ], alreadyThere, true);
      return;
    }
    // Too long to fit in a web address: copy it instead and open an empty page to paste into.
    // The copy starts before the new tab opens, while this page still has focus.
    const copying = copyText(file);
    window.open(`${REPO_NEW_FILE_URL}?filename=${encodeURIComponent(filename)}`, '_blank', 'noopener');
    const copied = await copying;
    showNextSteps('This recipe is too long to send in one go. In the GitHub tab:', [
      copied
        ? 'Paste the recipe into the big empty box (it’s already copied).'
        : 'Come back here, open “See the recipe file”, click Copy file, and paste it into the big empty box.',
      'Click Propose new file.',
      'Click Create pull request, then Create pull request again.'
    ], alreadyThere, true);
  }

  /**
   * GitHub's edit page can't be filled in from a link, so the Desk copies the
   * whole file and the writer pastes it over the old one.
   */
  async function sendEdit(file, filename) {
    const copying = copyText(file);
    window.open(REPO_EDIT_URL + filename, '_blank', 'noopener');
    const copied = await copying;
    const keys = IS_MAC ? '⌘A, then ⌘V' : 'Ctrl+A, then Ctrl+V';
    showNextSteps('In the GitHub tab:', [
      'Sign in if asked.',
      'If asked to fork the repository, click Fork this repository.',
      copied
        ? `Click in the file, then select everything and paste (${keys}). Your version is already copied.`
        : `Come back here, open “See the recipe file” and click Copy file. Then click in the file on GitHub, select everything and paste (${keys}).`,
      'Click Commit changes, then Propose changes.',
      'Click Create pull request, then Create pull request again.'
    ], '', true);
  }

  function download() {
    const form = readForm();
    if (!readyToGo(form)) return;
    saveDraft();
    const blob = new Blob([buildFile(form)], { type: 'text/markdown;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = current.s + '.md';
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    showNextSteps('Saved as ' + current.s + '.md. Post it in the writers’ channel on Discord.', []);
  }

  /** A short heading and a numbered list of what to do next. */
  function showNextSteps(heading, steps, note, trackLink) {
    const box = $('send-results');
    box.replaceChildren();
    const p = document.createElement('p');
    p.className = 'check-ok';
    p.textContent = heading;
    const list = document.createElement('ol');
    list.className = 'check-list';
    for (const text of steps) {
      const li = document.createElement('li');
      li.textContent = text;
      list.append(li);
    }
    box.append(p);
    if (steps.length) box.append(list);
    if (trackLink) {
      const track = document.createElement('p');
      track.className = 'hint';
      const link = document.createElement('a');
      link.href = PULL_REQUESTS_URL;
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = 'your pull requests';
      track.append('Check whether it’s been merged in ', link, '.');
      box.append(track);
    }
    if (note) {
      const extra = document.createElement('p');
      extra.className = 'hint';
      extra.textContent = note;
      box.append(extra);
    }
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // ---- Drafts --------------------------------------------------------------
  function saveDraft() {
    if (!current || !dirty) return;
    // An edit is only saved once the version on the site has loaded, so a draft
    // always knows which version it was based on.
    if (current.w && !siteVersion) return;
    const form = readForm();
    form.introText = $('intro-text').value;
    form.ingredientsText = $('ingredients').value;
    form.allSteps = stepItems().map((item) => ({
      text: item.querySelector('.step-text').value, at: item.querySelector('.step-time').value
    }));
    form.transcript = $('transcript-paste').value;
    form.savedAt = new Date().toISOString();
    if (current.w) form.basedOn = siteHash;
    const saved = storageSet(DRAFT_PREFIX + current.v, JSON.stringify(form));
    storageSet(HANDLE_KEY, form.handle);
    setDraftStatus(saved
      ? `Draft saved ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
      : 'Drafts can’t be saved in this browser, so finish before closing the page');
    // Once the writer starts changing the version on the site, an older draft is replaced.
    if (current.w && $('edit-status-button').onclick === useOldDraft) showEditStatus('Editing the version on the site.');
  }

  function readDraft() {
    try { return JSON.parse(storageGet(DRAFT_PREFIX + current.v) || 'null'); } catch (e) { return null; }
  }

  /** Fills the form from a draft or from the version on the site (they share a shape). */
  function fillForm(data) {
    $('title').value = data.title || $('title').value;
    $('subtitle').value = data.subtitle || '';
    if (data.handle) $('handle').value = data.handle;
    $('intro-start').value = data.introStart || '';
    $('intro-end').value = data.introEnd || '';
    $('intro-source').value = data.introSource || 'transcript-panel';
    $('intro-text').value = data.introText || '';
    $('ingredients-at').value = data.ingredientsAt || '';
    $('servings').value = data.servings || '';
    $('ingredients').value = data.ingredientsText || '';
    $('notes').value = data.notes || '';
    if (data.filing) setFiling(data.filing);
    $('steps').replaceChildren();
    for (const step of data.allSteps || []) addStep(step.text, step.at);
    $('songs').replaceChildren();
    for (const song of data.songs || []) addSong(song);
    // The site version has no transcript, so a transcript already pasted stays.
    if (data.transcript) {
      $('transcript-paste').value = data.transcript;
      readTranscript();
    }
    for (const box of document.querySelectorAll('.is-bad')) box.classList.remove('is-bad');
  }

  function clearDraft() {
    if (!current) return;
    const question = current.w
      ? 'Go back to the version on the site? Your changes will be deleted.'
      : 'Start this recipe over? Your draft for it will be deleted.';
    if (!window.confirm(question)) return;
    storageRemove(DRAFT_PREFIX + current.v);
    const videoId = current.v;
    current = null;   // so chooseRecipe doesn't save the old draft back
    chooseRecipe(videoId);
    setDraftStatus('Started over');
  }

  let saveTimer = 0;
  function changed() {
    dirty = true;
    updatePreview();
    markUsedLines();
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(saveDraft, 600);
  }

  function readTranscript() {
    const list = parseTranscript($('transcript-paste').value);
    setSegments(list);
    const timed = list.filter((s) => s.time !== null).length;
    $('transcript-status').textContent = list.length
      ? `${list.length} lines read${timed < list.length ? ` (${list.length - timed} without a time)` : ''}. Tick lines, then choose where they go.`
      : 'Nothing to read yet. Paste the transcript first.';
  }

  // ---- Wiring it all up ----------------------------------------------------
  function wire() {
    // After "Get the transcript", put the cursor in the paste box when the writer comes back,
    // so all they have to do is paste.
    let awayForTranscript = false;
    $('get-transcript').addEventListener('click', (e) => {
      if (!current) { e.preventDefault(); $('transcript-status').textContent = 'Pick a recipe first.'; return; }
      awayForTranscript = true;
    });
    window.addEventListener('focus', () => {
      if (!awayForTranscript) return;
      awayForTranscript = false;
      if (!$('transcript-paste').value.trim()) {
        $('transcript-paste').focus();
        $('transcript-status').textContent = 'Paste the transcript here.';
      }
    });

    document.addEventListener('click', (e) => {
      const button = e.target.closest('button');
      if (!button) return;
      if (button.dataset.action === 'back') nudge(-NUDGE_SECONDS);
      if (button.dataset.action === 'forward') nudge(NUDGE_SECONDS);
      if (button.dataset.action === 'toggle') togglePlay();
      if (button.dataset.action === 'speed') toggleSpeed();
      if (button.classList.contains('stamp')) stampInto(button.parentElement.querySelector('.time'));
      if (button.dataset.step) onStepTool(button);
      if (button.dataset.song === 'remove') { button.closest('.song-item').remove(); changed(); }
      if (button.dataset.tidy === 'steps') {
        // Tidies every step box at once.
        for (const box of $('steps').querySelectorAll('.step-text')) box.value = tidy(box.value);
        changed();
      } else if (button.dataset.tidy) {
        const box = $(button.dataset.tidy);
        box.value = button.dataset.tidy === 'ingredients' ? tidyLines(box.value) : tidy(box.value);
        changed();
      }
    });

    $('read-transcript').addEventListener('click', () => { readTranscript(); changed(); });
    $('transcript-paste').addEventListener('paste', () => window.setTimeout(() => { readTranscript(); changed(); }, 0));
    $('use-intro').addEventListener('click', useAsIntro);
    $('use-step').addEventListener('click', useAsStep);
    $('use-ingredients').addEventListener('click', useAsIngredients);
    $('clear-selection').addEventListener('click', clearSelection);
    $('add-step').addEventListener('click', () => { addStep().querySelector('.step-text').focus(); changed(); });
    $('add-song').addEventListener('click', () => { addSong().querySelector('.song-title').focus(); changed(); });
    $('check').addEventListener('click', () => showCheck(check(readForm())));
    $('send').addEventListener('click', send);
    $('download-file').addEventListener('click', download);
    $('copy-file').addEventListener('click', async (e) => {
      const ok = await copyText(buildFile(readForm()));
      e.target.textContent = ok ? 'Copied' : 'Couldn’t copy; select the text above instead';
      window.setTimeout(() => { e.target.textContent = 'Copy file'; }, 2500);
    });
    $('clear-draft').addEventListener('click', clearDraft);

    const form = $('recipe-form');
    form.addEventListener('input', changed);
    form.addEventListener('change', changed);
    form.addEventListener('submit', (e) => e.preventDefault());

    // Remember which part of the form the writer was last in, for Alt+T.
    document.addEventListener('focusin', (e) => {
      const scope = e.target.closest && e.target.closest('[data-time-scope]');
      if (scope) lastTimeScope = scope;
    });

    // Shortcuts use the physical key (e.code) so Alt+letter works on Mac keyboards too.
    document.addEventListener('keydown', (e) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const actions = {
        KeyP: togglePlay,
        KeyJ: () => nudge(-NUDGE_SECONDS),
        KeyL: () => nudge(NUDGE_SECONDS),
        KeyS: toggleSpeed,
        KeyT: () => stampInto(timeBoxForFocus())
      };
      const action = actions[e.code];
      if (!action) return;
      e.preventDefault();
      action();
    });

    window.addEventListener('beforeunload', () => { if (current) saveDraft(); });
  }

  // ---- Docking the player on one-column screens --------------------------
  /**
   * On phones and tablets the form is below the video, so once the player scrolls
   * off the top it docks there as a small bar. The slot keeps the player's height
   * so the page doesn't jump. The player is moved with CSS only: moving the iframe
   * in the page would reload the video.
   */
  function watchDock() {
    const slot = $('player-slot');
    const dock = $('player-dock');
    if (!('IntersectionObserver' in window)) return;
    let offTop = false;
    const update = () => {
      const docked = offTop && ONE_COLUMN.matches && Boolean(current);
      if (docked === dock.classList.contains('is-docked')) return;
      slot.style.height = docked ? slot.offsetHeight + 'px' : '';
      dock.classList.toggle('is-docked', docked);
    };
    new IntersectionObserver(([entry]) => {
      // Only dock once the player has gone off the top, not while it's still below.
      offTop = !entry.isIntersecting && entry.boundingClientRect.top < 0;
      update();
    }, { threshold: 0 }).observe(slot);
    ONE_COLUMN.addEventListener('change', update);
  }

  // The header stays at the top on wide screens; the sticky left column sits just below it.
  const header = document.querySelector('.desk-site-header');
  if ('ResizeObserver' in window) {
    new ResizeObserver(() => document.documentElement.style.setProperty('--desk-head', header.offsetHeight + 'px')).observe(header);
  }

  if (IS_MAC) for (const key of document.querySelectorAll('.alt-key')) key.textContent = 'Option';
  buildFilingBoxes();
  wire();
  watchDock();
  fillPicker();
})();
