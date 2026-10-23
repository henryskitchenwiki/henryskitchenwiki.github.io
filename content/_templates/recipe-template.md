---
# ═══════════════════════════════════════════════════════════════════
#  HENRY'S KITCHEN: RECIPE TEMPLATE
#  1. Copy this file and rename it to the recipe's id, e.g. meatloaf-for-one.md
#  2. Fill in each field. Anything marked (optional) can be left blank.
#  3. Keep Henry's own words wherever possible. Fix spelling and punctuation only.
#  4. Times are minutes:seconds from the start of the video, e.g. "1:42".
#  5. Text containing * or : must stay inside "double quotes".
# ═══════════════════════════════════════════════════════════════════

# ── Identity ── the id becomes the page address and must NEVER change once published
id: ""                       # lowercase words joined by hyphens, e.g. meatloaf-for-one
title: ""                    # as Henry titles it, e.g. "Meatloaf for One"
subtitle: ""                 # (optional) one short line, ideally Henry's words

# ── Source video ──
youtube_id: ""               # the part after watch?v= in the video address
episode:                     # (optional) Henry's episode number, if the video gives one
aired:                       # upload date, YYYY-MM-DD
series: henrys-kitchen       # henrys-kitchen | masterclass | special

# ── Where it's filed ──
collections: []              # (optional) e.g. [dinner-for-one]
main_ingredients: []         # 1–3 from the ingredient list, e.g. [beef], [chicken, pasta]
holidays: []                 # (optional) e.g. [thanksgiving], [halloween]

# ── Henry's introduction ── copied from YouTube's "Show transcript" panel
intro:
  start: "0:00"
  end: ""                    # when the introduction ends
  source: transcript-panel   # transcript-panel | manual (typed by ear) | caption-file
  text: |
    First paragraph of Henry's introduction.

    Second paragraph, if there is one.

# ── Recipe card ──
servings:                    # (optional) leave blank if Henry doesn't say
stats: []                    # (optional) extra card facts in Henry's words, e.g.
                             #   - label: Food groups
                             #     value: All four
ingredients_at: ""           # (optional) when Henry lists the ingredients
ingredients:                 # as Henry says them, in his order
  - ""
steps:                       # as Henry says them; leave "at" blank if unsure
  - text: ""
    at: ""

# ── Songs ── (optional) José Suicidio tracks heard in or written for this episode
songs: []
#  - title: ""
#    artist: José Suicidio
#    album: ""
#    heard_in_episode: true      # true = plays in the video
#    youtube_music: ""           # (optional) link from his YouTube Music page

# ── Extras ──
hero_image: ""               # (optional) blank = use the episode thumbnail
search_aliases: []           # (optional) hidden; other ways people describe this one
written_up_by: ""            # your community name, e.g. royal-flush (never shown on the site)
---

<!-- (optional) NOTES: anything below this line appears under "Notes" on the
     recipe card. Keep it short, factual, and deadpan. Delete this comment. -->
