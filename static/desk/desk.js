/* Transcription Desk
 *
 * A writing tool for turning a Henry's Kitchen episode into a recipe file.
 * Everything runs in the writer's browser: no server, no API key, no AI.
 *
 *   1. Pick a recipe        -> fills in the facts we already know (title, video, date)
 *   2. Watch                -> YouTube player with nudge buttons and keyboard shortcuts
 *   3. Paste the transcript -> writer copies YouTube's "Show transcript" panel by hand
 *   4-9. Fill in the recipe -> drafts save automatically in this browser
 *   10. Send to the Kitchen -> opens GitHub's "new file" page with the recipe pre-filled
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
  const $ = (id) => document.getElementById(id);

  let current = null;     // the recipe being written up
  let player = null;      // YouTube player, once ready
  let segments = [];      // transcript lines: { time: seconds or null, text }
  let lastAnchor = -1;    // for shift-click selection of transcript lines
  let lastTimeScope = null;

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
    filterPicker();
  }

  function chooseRecipe(videoId) {
    if (current) saveDraft();
    current = recipes.find((r) => r.v === videoId) || null;
    clearForm();
    if (!current) { $('recipe-facts').textContent = ''; return; }

    storageSet(LAST_RECIPE_KEY, current.v);
    const url = new URL(window.location.href);
    url.searchParams.set('v', current.v);
    history.replaceState(null, '', url);

    $('recipe-facts').textContent =
      (current.e ? `Episode ${current.e} · ` : '') +
      `Aired ${current.d} · ${formatTime(current.l)} long · File name: ${current.s}.md`;
    if (current.w) {
      $('recipe-facts').textContent += ' · This one is already on the site. To suggest changes, mention it in the writers’ channel on Discord first.';
    }
    $('title').value = current.t.replace(/^how to make\s+/i, '');
    loadVideo(current.v);
    $('get-transcript').href = 'https://www.youtube.com/watch?v=' + encodeURIComponent(current.v);
    restoreDraft();
    if ($('steps').children.length === 0) addStep();
    updatePreview();
  }

  function clearForm() {
    for (const id of ['title', 'subtitle', 'intro-start', 'intro-end', 'intro-text',
      'ingredients-at', 'servings', 'ingredients', 'notes', 'transcript-paste']) {
      $(id).value = '';
      $(id).classList.remove('is-bad');
    }
    $('intro-source').value = 'transcript-panel';
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
      li.append(text);
      li.addEventListener('click', (e) => onSegmentClick(e, i, check));
      box.append(li);
    });
    $('segment-actions').hidden = list.length === 0;
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
    const steps = $('steps').children;
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
    Array.from($('steps').children).forEach((item, i) => {
      const n = i + 1;
      item.querySelector('.step-number').textContent = n;
      item.querySelector('.step-text').setAttribute('aria-label', `Step ${n}`);
      item.querySelector('.step-time').setAttribute('aria-label', `Step ${n} starts at`);
    });
  }

  function onStepTool(button) {
    const item = button.closest('.step-item');
    const action = button.dataset.step;
    if (action === 'remove') item.remove();
    if (action === 'up' && item.previousElementSibling) item.after(item.previousElementSibling);
    if (action === 'down' && item.nextElementSibling) item.before(item.nextElementSibling);
    renumberSteps();
    changed();
  }

  function addSong(song) {
    const item = $('song-template').content.firstElementChild.cloneNode(true);
    if (song) {
      item.querySelector('.song-title').value = song.title || '';
      item.querySelector('.song-album').value = song.album || '';
      item.querySelector('.song-link').value = song.link || '';
      item.querySelector('.song-heard').checked = Boolean(song.heard);
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
      steps: Array.from($('steps').children).map((item) => ({
        text: item.querySelector('.step-text').value.replace(/\s+/g, ' ').trim(),
        at: item.querySelector('.step-time').value.trim()
      })).filter((s) => s.text || s.at),
      songs: Array.from($('songs').children).map((item) => ({
        title: item.querySelector('.song-title').value.trim(),
        album: item.querySelector('.song-album').value.trim(),
        link: item.querySelector('.song-link').value.trim(),
        heard: item.querySelector('.song-heard').checked
      })).filter((s) => s.title),
      notes: $('notes').value.trim()
    };
  }

  // ---- Checking ------------------------------------------------------------
  /** Returns { problems: [], warnings: [] }. Problems block sending; warnings don't. */
  function check(form) {
    const problems = [];
    const warnings = [];
    if (!current) problems.push('Pick a recipe at the top of the page first.');
    if (!form.title) problems.push('The recipe needs a title.');
    if (!form.handle) problems.push('Add your name in the community (in “4. The recipe”) so we know who to thank.');
    if (!form.introParagraphs.length) problems.push('Add Henry’s introduction.');
    if (!form.ingredients.length) problems.push('Add at least one ingredient.');
    if (!form.steps.some((s) => s.text)) problems.push('Add at least one step.');
    if (/\[\[|\]\]/.test(JSON.stringify(form))) problems.push('Remove the [[ ]] placeholder marks before sending.');

    const length = current ? current.l : Infinity;
    const timeChecks = [
      ['intro-start', form.introStart, 'Introduction start'],
      ['intro-end', form.introEnd, 'Introduction end'],
      ['ingredients-at', form.ingredientsAt, 'Ingredients time']
    ];
    for (const [id, value, label] of timeChecks) {
      const ok = checkTime(value, label, length, problems);
      $(id).classList.toggle('is-bad', !ok);
    }
    Array.from($('steps').children).forEach((item, i) => {
      const box = item.querySelector('.step-time');
      box.classList.toggle('is-bad', !checkTime(box.value, `Step ${i + 1} time`, length, problems));
    });

    const start = parseTime(form.introStart);
    const end = parseTime(form.introEnd);
    if (start !== null && end !== null && end <= start) problems.push('The introduction has to end after it starts.');
    if (!form.introEnd) warnings.push('No end time for the introduction yet.');

    const untimed = form.steps.filter((s) => s.text && !s.at).length;
    if (untimed) warnings.push(`${untimed} step${untimed === 1 ? ' has' : 's have'} no time, so ${untimed === 1 ? 'it won’t get' : 'they won’t get'} a “Watch this step” button. That’s fine if you’re not sure.`);
    const times = form.steps.map((s) => parseTime(s.at)).filter((t) => t !== null && !Number.isNaN(t));
    if (times.some((t, i) => i > 0 && t < times[i - 1])) warnings.push('Some step times go backwards. Double-check the order of the steps.');
    for (const song of form.songs) {
      if (song.link && !/^https:\/\/music\.youtube\.com\//.test(song.link)) problems.push(`The link for “${song.title}” should start with https://music.youtube.com/`);
    }
    return { problems, warnings };
  }

  function checkTime(value, label, length, problems) {
    const seconds = parseTime(value);
    if (seconds === null) return true;
    if (Number.isNaN(seconds)) { problems.push(`${label} “${value}” isn’t a time. Use minutes:seconds, like 1:42.`); return false; }
    if (seconds > length) { problems.push(`${label} ${value} is past the end of the episode (${formatTime(length)}).`); return false; }
    return true;
  }

  function showCheck(result) {
    const box = $('check-results');
    box.replaceChildren();
    const heading = document.createElement('p');
    if (!result.problems.length) {
      heading.className = 'check-ok';
      heading.textContent = result.warnings.length ? 'Looks good! A couple of things you might want to know:' : 'Looks good! Your recipe is ready to send.';
    } else {
      heading.className = 'check-problem';
      heading.textContent = 'Almost there. Just a few things to fix first:';
    }
    box.append(heading);
    const list = document.createElement('ul');
    list.className = 'check-list';
    for (const text of result.problems) list.append(listItem(text, 'check-problem'));
    for (const text of result.warnings) list.append(listItem(text, 'check-warning'));
    if (list.children.length) box.append(list);
  }

  function listItem(text, className) {
    const li = document.createElement('li');
    const tag = document.createElement('span');
    tag.className = className;
    tag.textContent = className === 'check-problem' ? 'To fix: ' : 'Good to know: ';
    li.append(tag, document.createTextNode(text));
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
      '# ── Where it’s filed ── (the reviewers fill these in)',
      'collections: []',
      'main_ingredients: []',
      'holidays: []',
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
    lines.push('', '# ── Recipe card ──', form.servings ? `servings: ${q(form.servings)}` : 'servings:', 'stats: []',
      `ingredients_at: ${q(form.ingredientsAt)}`);
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
        lines.push(`  - title: ${q(song.title)}`, '    artist: "José Suicidio"', `    album: ${q(song.album)}`,
          `    heard_in_episode: ${song.heard}`, `    youtube_music: ${q(song.link)}`);
      }
    } else {
      lines.push('songs: []');
    }
    lines.push('', '# ── Extras ──', 'hero_image: ""', 'search_aliases: []',
      `written_up_by: ${q(toHandle(form.handle))}`, '---');
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
    const fullUrl = `${REPO_NEW_FILE_URL}?filename=${encodeURIComponent(filename)}&value=${encodeURIComponent(file)}`;
    saveDraft();

    if (fullUrl.length <= MAX_URL_LENGTH) {
      window.open(fullUrl, '_blank', 'noopener');
      showNextSteps('GitHub is open in a new tab with your recipe filled in. Over there:', [
        'If GitHub asks you to sign in, sign in. If your recipe isn’t filled in afterwards, come back here and click Send to the Kitchen again.',
        'If GitHub offers to “Fork this repository”, click it. That just makes your own copy to send the recipe from.',
        'Scroll down and click the green Propose new file button.',
        'On the next page, click the green Create pull request button (it may appear twice; click it both times).',
        'That’s it! Royal Flush will read it and let you know if anything needs a tweak.'
      ]);
      return;
    }
    // Too long to fit in a web address: copy it instead and open an empty page to paste into.
    const copied = await copyText(file);
    window.open(`${REPO_NEW_FILE_URL}?filename=${encodeURIComponent(filename)}`, '_blank', 'noopener');
    showNextSteps('Your recipe is too long to send in one go, so there’s one extra step. In the GitHub tab:', [
      copied
        ? 'Click in the big empty box and paste (Ctrl+V, or Cmd+V on a Mac). Your recipe has already been copied for you.'
        : 'Come back here, open “Peek at the recipe file”, click Copy file, then paste it into the big empty box on GitHub.',
      'Scroll down and click the green Propose new file button.',
      'On the next page, click the green Create pull request button.',
      'That’s it! Royal Flush will read it and let you know if anything needs a tweak.'
    ]);
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
    showNextSteps('Your recipe is saved as ' + current.s + '.md. Next:', [
      'Find the file in your Downloads folder.',
      'Post it in the writers’ channel on Discord (drag the file into the message box), or send it to Royal Flush directly.',
      'That’s it! He’ll add it to the site and let you know if anything needs a tweak.'
    ]);
  }

  /** A short heading and a numbered list of what to do next. */
  function showNextSteps(heading, steps) {
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
    box.append(p, list);
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // ---- Drafts --------------------------------------------------------------
  function saveDraft() {
    if (!current) return;
    const form = readForm();
    form.introText = $('intro-text').value;
    form.ingredientsText = $('ingredients').value;
    form.allSteps = Array.from($('steps').children).map((item) => ({
      text: item.querySelector('.step-text').value, at: item.querySelector('.step-time').value
    }));
    form.transcript = $('transcript-paste').value;
    form.savedAt = new Date().toISOString();
    const saved = storageSet(DRAFT_PREFIX + current.v, JSON.stringify(form));
    storageSet(HANDLE_KEY, form.handle);
    $('draft-status').textContent = saved
      ? `Draft saved in this browser at ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`
      : 'Drafts can’t be saved in this browser, so finish this one before closing the page.';
  }

  function restoreDraft() {
    $('handle').value = $('handle').value || storageGet(HANDLE_KEY) || '';
    let draft = null;
    try { draft = JSON.parse(storageGet(DRAFT_PREFIX + current.v) || 'null'); } catch (e) { draft = null; }
    if (!draft) { $('draft-status').textContent = ''; return; }
    $('title').value = draft.title || $('title').value;
    $('subtitle').value = draft.subtitle || '';
    $('handle').value = draft.handle || $('handle').value;
    $('intro-start').value = draft.introStart || '';
    $('intro-end').value = draft.introEnd || '';
    $('intro-source').value = draft.introSource || 'transcript-panel';
    $('intro-text').value = draft.introText || '';
    $('ingredients-at').value = draft.ingredientsAt || '';
    $('servings').value = draft.servings || '';
    $('ingredients').value = draft.ingredientsText || '';
    $('notes').value = draft.notes || '';
    for (const step of draft.allSteps || []) addStep(step.text, step.at);
    for (const song of draft.songs || []) addSong(song);
    if (draft.transcript) {
      $('transcript-paste').value = draft.transcript;
      readTranscript();
    }
    $('draft-status').textContent = `Picked up your draft from ${new Date(draft.savedAt).toLocaleString()}.`;
  }

  function clearDraft() {
    if (!current) return;
    if (!window.confirm('Start this recipe over? Your draft for it will be deleted.')) return;
    storageRemove(DRAFT_PREFIX + current.v);
    const videoId = current.v;
    current = null;   // so chooseRecipe doesn't save the old draft back
    chooseRecipe(videoId);
    $('draft-status').textContent = 'Started over.';
  }

  let saveTimer = 0;
  function changed() {
    updatePreview();
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
        $('transcript-status').textContent = 'Welcome back! Paste the transcript into the box (Ctrl+V, or Cmd+V on a Mac).';
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
      if (button.dataset.tidy) {
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

  wire();
  fillPicker();
})();
