# Henry’s Kitchen

The recipe website for Henry Phillips’ *Henry’s Kitchen*, kept by The Users.
Live at **https://henryskitchenwiki.github.io**. This site is not operated by Henry Phillips.

Everything here is stored and run on GitHub. Nobody needs to install anything to keep
the site going: recipes go in through pull requests, and GitHub builds and publishes the site.

## How a recipe gets onto the site

1. A writer fills in the **Transcription Desk** (`/desk/` on the site) and clicks
   **Send to the Kitchen**. That opens a pull request adding `content/recipes/<id>.md`.
   Writers without a GitHub account save the file and post it in the writers’ Discord
   channel instead, and a reviewer uploads it.
2. GitHub runs the **Check** workflow on the pull request. If something is wrong
   (a time that isn’t a time, a step past the end of the episode, a misspelled field)
   the pull request shows a red ✗, and the reason appears next to the file.
3. A reviewer reads it, fills in where it’s filed (`main_ingredients`, `collections`,
   `holidays`), and merges.
4. The **Publish site** workflow builds the site and publishes it. The page is live a
   few minutes later.

## What’s in the repo

| Folder | What it is | Who changes it |
|---|---|---|
| `content/recipes/` | One file per written-up recipe, e.g. `big-mac.md` | Writers, through the Desk |
| `content/_templates/` | A blank recipe file, for writing one by hand | Rarely |
| `content/categories.json` | Every category a recipe can be filed under: main ingredients, collections, holidays | Site maintainers |
| `content/filing.json` | Where each episode is filed until its recipe is written up (a first pass from the titles) | Anyone; correct freely |
| `content/home.json` | Which recipe is featured at the top of the home page | Site maintainers |
| `content/search/search-words.json` | Words that mean the same thing in a search, e.g. fry / fries | Anyone who finds a search that misses |
| `data/videos.json` | Every Henry’s Kitchen recipe episode: title, date, length | The weekly YouTube check (coming); otherwise by hand, carefully |
| `static/` | Hand-written pages (About, search, the Desk), styles, scripts, images | Site maintainers |
| `src/HenrysKitchen.Core/` | The rules: what a recipe is, reading recipe files, checking them | Site maintainers |
| `src/HenrysKitchen.Build/` | The build: turns all of the above into the finished site | Site maintainers |
| `tests/HenrysKitchen.Tests/` | Automated tests for the rules | Site maintainers |
| `tests/search/` | Searches the site should handle, checked on every pull request | Anyone who finds a search that misses |
| `tools/` | One-off helpers, such as rebuilding the copy of the MiniSearch library | Rarely |
| `.github/workflows/` | **Check** (every pull request) and **Publish site** (every merge) | Rarely |

The finished site is written to `_site/`, which is never committed: GitHub builds it fresh every time.

Every episode in `data/videos.json` gets a page at `/recipes/<id>/`. Until someone writes
up its recipe, the page shows placeholder text with a dashed underline.

## Working on the site yourself

You need the [.NET 10 SDK](https://dotnet.microsoft.com/download). Visual Studio 2026 is
optional; any editor works.

```
dotnet test                                   # run the tests
dotnet run --project src/HenrysKitchen.Build  # build the site into _site/
dotnet serve -d _site -o                      # look at it in your browser
node tests/search/run-search-tests.js _site   # check the search (needs Node.js)
```

`dotnet serve` is a small tool for viewing the site locally:
`dotnet tool install --global dotnet-serve`. Opening the HTML files directly doesn’t work,
because the pages use addresses that start with `/`.

In Visual Studio, set **HenrysKitchen.Build** as the startup project and press F5.

Build options:

- `--check` checks the content and reports problems without writing the site.
- `--launch` is for the public launch: it lets search engines list the site and refuses
  to publish any `[[placeholder]]` text. Until launch, every page asks search engines to stay away.

## Common changes

- **Change how recipe pages look:** `src/HenrysKitchen.Build/Components/RecipePage.razor`
  (layout) and `static/assets/css/site.css` (styles). What a page shows is worked out in
  `RecipePageModel.cs`.
- **Change the home page:** `Components/HomePage.razor`. The Latest and the Recipe Box fill
  themselves (`HomePageModel.cs`); the featured recipe is set in `content/home.json`.
- **How titles are shown:** `TitleRules.cs` in Core. "How to Make a Big Mac" shows as "Big Mac";
  Henry’s full title stays searchable.
- **Change the header or footer:** `Components/SiteLayout.razor`, and the copies in the
  hand-written pages under `static/`.
- **Add a check for recipe files:** `RecipeLoader.cs` for checks on a single file,
  `RecipeValidator.cs` for checks against the episode list. Add a test in
  `tests/HenrysKitchen.Tests/RecipeTests.cs` for it.
- **Add a field to recipe files:** add it to `RecipeFile` in `RecipeLoader.cs`, to `Recipe`
  in `Models.cs`, to the template in `content/_templates/`, and to the Desk
  (`static/desk/desk.js`, `buildFile`).

## Categories

Recipes are filed by main ingredient (up to three), collection and holiday, using only the
categories in `content/categories.json`; Check fails on anything else and suggests the closest
one. An `id` there is used in recipe files and page addresses, so don't change it once used;
the `name` is what readers see.

Each category with recipes gets a page (`/recipes/ingredient/beef/`, `/recipes/collection/dinner-for-one/`,
`/recipes/holiday/thanksgiving/`), and `/recipes/` lists them all. Written-up recipes come first on
category pages. Episode ids can't be `ingredient`, `collection` or `holiday`.

Writers file a recipe in the Desk's "Where it’s filed" section, which starts from the episode's
entry in `content/filing.json`. Once a recipe file has its own filing, that takes over.

## Search

The search page runs in the reader’s browser. The build writes `assets/js/search-index.js`
with the text of every recipe (title, description, ingredients, Henry’s introduction, steps,
filing and `search_aliases`). `static/assets/js/search-engine.js` searches it using
[MiniSearch](https://github.com/lucaong/minisearch), a copy of which is kept in
`static/assets/js/vendor/` so the site doesn’t depend on another server.

- **A search finds the wrong thing?** Add the search and the recipe it should find to
  `tests/search/search-cases.json`, then adjust `search-engine.js` until the tests pass:
  `node tests/search/run-search-tests.js _site` after building.
- **Another name for a dish** goes in that recipe’s `search_aliases`.
- **Words that mean the same thing** (donut / doughnut, fry / fries) go in
  `content/search/search-words.json`, one word per entry. Keep groups to true stand-ins:
  putting “pie” with “cake” would make every pie search show cakes.
- Small typos in longer words are forgiven, and the page offers “Did you mean…?”
  using words that appear somewhere on the site.
- **Updating MiniSearch:** see the instructions at the top of `tools/build-minisearch.mjs`.

## Placeholder text

In any content file, `[[double square brackets]]` mark stand-in text. The site shows it with a
dashed underline (and “(placeholder)” for screen readers). It’s fine while building; the launch
build refuses to publish it.
