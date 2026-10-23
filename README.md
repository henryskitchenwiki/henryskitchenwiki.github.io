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
| `data/videos.json` | Every Henry’s Kitchen recipe episode: title, date, length | The weekly YouTube check (coming); otherwise by hand, carefully |
| `static/` | Hand-written pages (home, About, search, the Desk), styles, scripts, images | Site maintainers |
| `src/HenrysKitchen.Core/` | The rules: what a recipe is, reading recipe files, checking them | Site maintainers |
| `src/HenrysKitchen.Build/` | The build: turns all of the above into the finished site | Site maintainers |
| `tests/HenrysKitchen.Tests/` | Automated tests for the rules | Site maintainers |
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
- **Change the header or footer:** `Components/SiteLayout.razor`, and the copies in the
  hand-written pages under `static/`.
- **Add a check for recipe files:** `RecipeLoader.cs` for checks on a single file,
  `RecipeValidator.cs` for checks against the episode list. Add a test in
  `tests/HenrysKitchen.Tests/RecipeTests.cs` for it.
- **Add a field to recipe files:** add it to `RecipeFile` in `RecipeLoader.cs`, to `Recipe`
  in `Models.cs`, to the template in `content/_templates/`, and to the Desk
  (`static/desk/desk.js`, `buildFile`).

## Placeholder text

In any content file, `[[double square brackets]]` mark stand-in text. The site shows it with a
dashed underline (and “(placeholder)” for screen readers). It’s fine while building; the launch
build refuses to publish it.
