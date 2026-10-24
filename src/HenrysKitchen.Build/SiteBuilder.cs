using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using HenrysKitchen.Build.Components;
using HenrysKitchen.Core;

namespace HenrysKitchen.Build;

/// <summary>
/// Builds the whole site, start to finish:
///   1. read data/videos.json and content/recipes/*.md
///   2. check them, and stop if anything has to be fixed
///   3. copy static/ (hand-written pages, styles, scripts, images, the Desk)
///   4. write the home page, a page for every episode, the category pages and Recipes hub,
///      the Desk's recipe list and the search index
/// </summary>
internal static class SiteBuilder
{
    public static async Task<int> RunAsync(BuildOptions options)
    {
        var root = options.RepoRoot;
        Console.WriteLine($"Building Henry’s Kitchen from {root}");

        // 1. Read.
        VideoCatalog catalog;
        try
        {
            catalog = VideoCatalog.Load(Path.Combine(root, "data", "videos.json"));
        }
        catch (Exception ex) when (ex is IOException or InvalidDataException or JsonException)
        {
            Console.Error.WriteLine($"Couldn't read data/videos.json: {ex.Message}");
            return 1;
        }

        var loaded = RecipeLoader.LoadFolder(Path.Combine(root, "content", "recipes"), root);
        var searchWords = SearchIndex.LoadWords(root, out var wordProblems);
        var categoryProblems = new List<Problem>();
        var categories = CategoryList.Load(root, categoryProblems);
        var filing = categories.LoadFiling(root, catalog, categoryProblems);

        // 2. Check.
        var checkedRecipes = RecipeValidator.Validate(loaded, catalog, options.Launch, categories);
        var problems = checkedRecipes.Problems.Concat(wordProblems).Concat(categoryProblems).ToList();
        ProblemReport.Print(problems);
        if (problems.Any(p => p.Severity == Severity.Error))
        {
            Console.WriteLine("Stopped: fix the errors above, then build again.");
            return 1;
        }

        // Category pages live under /recipes/ingredient/ and so on, so no episode may use those ids.
        var clash = catalog.Videos.FirstOrDefault(v => CategoryPages.ReservedIds.Contains(v.Id));
        if (clash is not null)
        {
            Console.Error.WriteLine($"data/videos.json: the page id \"{clash.Id}\" is used for category pages. Give that episode a different id.");
            return 1;
        }

        var site = new SiteData
        {
            Catalog = catalog,
            Recipes = checkedRecipes.Recipes,
            Categories = categories,
            FilingByPageId = filing,
        };
        var recipes = site.Recipes;
        var homeProblems = new List<Problem>();
        var home = HomePageModel.Create(root, site, !options.Launch, homeProblems);
        if (home is null)
        {
            ProblemReport.Print(homeProblems);
            Console.WriteLine("Stopped: fix the errors above, then build again.");
            return 1;
        }

        Console.WriteLine($"{catalog.Videos.Count} episodes, {recipes.Count} written up, {catalog.Videos.Count - recipes.Count} still needed.");
        if (options.CheckOnly)
        {
            Console.WriteLine("Check finished. Nothing was written (--check).");
            return 0;
        }

        // 3. Start a fresh copy of the site.
        if (!PrepareOutputFolder(options))
        {
            return 2;
        }

        CopyFolder(Path.Combine(root, "static"), options.OutputFolder);

        // 4. Write the pages.
        await using var renderer = new PageRenderer();
        var videos = catalog.Videos;
        for (var i = 0; i < videos.Count; i++)
        {
            var video = videos[i];
            var model = site.PageModel(video, MoreAround(i, site), !options.Launch);
            var html = await renderer.RenderAsync<RecipePage>(new Dictionary<string, object?> { [nameof(RecipePage.Model)] = model });
            await WriteFileAsync(options.OutputFolder, $"recipes/{video.Id}/index.html", "<!DOCTYPE html>\n" + StripDoctype(html));
        }

        // Category pages and the Recipes hub.
        var hubEntries = new List<(Category Category, int Count)>();
        foreach (var category in site.Categories.All)
        {
            var cards = CategoryPages.CardsFor(category, site);
            hubEntries.Add((category, cards.Count));
            if (cards.Count == 0)
            {
                continue;
            }

            var categoryHtml = await renderer.RenderAsync<CategoryPage>(new Dictionary<string, object?>
            {
                [nameof(CategoryPage.Model)] = new CategoryPageModel(category, cards, !options.Launch),
            });
            await WriteFileAsync(options.OutputFolder, CategoryPages.UrlFor(category).Trim('/') + "/index.html", "<!DOCTYPE html>\n" + StripDoctype(categoryHtml));
        }

        var hubHtml = await renderer.RenderAsync<RecipesHub>(new Dictionary<string, object?>
        {
            [nameof(RecipesHub.Model)] = new RecipesHubModel(hubEntries, videos.Count, !options.Launch),
        });
        await WriteFileAsync(options.OutputFolder, "recipes/index.html", "<!DOCTYPE html>\n" + StripDoctype(hubHtml));

        var homeHtml = await renderer.RenderAsync<HomePage>(new Dictionary<string, object?> { [nameof(HomePage.Model)] = home });
        await WriteFileAsync(options.OutputFolder, "index.html", "<!DOCTYPE html>\n" + StripDoctype(homeHtml));

        await WriteFileAsync(options.OutputFolder, "assets/js/recipes-data.js", DeskData(site));
        await WriteFileAsync(options.OutputFolder, "assets/js/search-index.js", SearchIndex.Write(site, searchWords));

        Console.WriteLine($"Done: {videos.Count} recipe pages written to {Path.GetRelativePath(root, options.OutputFolder)}/");
        return 0;
    }

    /// <summary>
    /// "More from Henry’s Kitchen": up to three episodes aired around this one,
    /// nearest first, alternating before and after.
    /// </summary>
    private static List<RecipeCard> MoreAround(int index, SiteData site) =>
        new[] { index - 1, index + 1, index - 2, index + 2 }
            .Where(i => i >= 0 && i < site.Videos.Count)
            .Take(3)
            .Select(i =>
            {
                var video = site.Videos[i];
                var title = site.DisplayTitle(video);
                var kicker = video.Episode is null
                    ? video.Aired.ToString("MMM d, yyyy", System.Globalization.CultureInfo.InvariantCulture)
                    : $"Episode {video.Episode}";
                return new RecipeCard(title, $"/recipes/{video.Id}/", video.YoutubeId, kicker);
            })
            .ToList();

    /// <summary>
    /// The recipe list the Transcription Desk reads (assets/js/recipes-data.js).
    /// Short names keep the file small: t = title, v = YouTube video ID, d = aired date,
    /// e = episode number, s = page id, l = length in seconds, w = 1 if written up,
    /// f = where it's filed ({ i: ingredients, c: collections, h: holidays }).
    /// It also carries the category list, for the Desk's filing section.
    /// </summary>
    private static string DeskData(SiteData site)
    {
        var entries = site.Videos.Select(v =>
        {
            var filing = site.FilingFor(v);
            return new Dictionary<string, object?>
            {
                ["t"] = site.DisplayTitle(v),
                ["v"] = v.YoutubeId,
                ["d"] = v.Aired.ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture),
                ["e"] = v.Episode ?? "",
                ["s"] = v.Id,
                ["l"] = v.LengthSeconds,
                ["w"] = site.RecipeFor(v) is null ? 0 : 1,
                ["f"] = new Dictionary<string, IReadOnlyList<string>>
                {
                    ["i"] = filing.Ingredients,
                    ["c"] = filing.Collections,
                    ["h"] = filing.Holidays,
                },
            };
        });

        var categories = new Dictionary<string, object>
        {
            ["ingredients"] = CategoryEntries(site.Categories, CategoryKind.Ingredient),
            ["collections"] = CategoryEntries(site.Categories, CategoryKind.Collection),
            ["holidays"] = CategoryEntries(site.Categories, CategoryKind.Holiday),
        };

        // The default encoder escapes characters such as < and & so nothing in a title
        // can break out of the script; UnicodeRanges.All just keeps letters like é readable.
        var jsonOptions = new JsonSerializerOptions
        {
            Encoder = JavaScriptEncoder.Create(System.Text.Unicode.UnicodeRanges.All),
        };

        return new StringBuilder()
            .AppendLine("// Written by the site build (src/HenrysKitchen.Build). Do not edit by hand.")
            .AppendLine("// t = title, v = YouTube video ID, d = date, e = Henry's episode number,")
            .AppendLine("// s = page id, l = episode length in seconds, w = 1 if already on the site,")
            .AppendLine("// f = where it's filed (i = ingredients, c = collections, h = holidays).")
            .Append("window.HK_RECIPES = ").Append(JsonSerializer.Serialize(entries, jsonOptions)).AppendLine(";")
            .Append("window.HK_CATEGORIES = ").Append(JsonSerializer.Serialize(categories, jsonOptions)).AppendLine(";")
            .ToString();
    }

    private static List<Dictionary<string, string>> CategoryEntries(CategoryList list, CategoryKind kind) =>
        list.OfKind(kind).Select(c => new Dictionary<string, string> { ["id"] = c.Id, ["name"] = c.Name }).ToList();

    /// <summary>
    /// Empties the output folder. As a safety catch it only ever deletes a folder inside
    /// the repo that isn't one of the repo's own folders.
    /// </summary>
    private static bool PrepareOutputFolder(BuildOptions options)
    {
        var output = Path.TrimEndingDirectorySeparator(options.OutputFolder);
        var root = Path.TrimEndingDirectorySeparator(options.RepoRoot);
        string[] protectedFolders = ["static", "content", "data", "src", "tests", ".github", ".git"];
        var relative = Path.GetRelativePath(root, output);
        var insideRepo = !relative.StartsWith("..", StringComparison.Ordinal) && !Path.IsPathRooted(relative) && relative != ".";
        var firstPart = relative.Split(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)[0];

        if (!insideRepo || protectedFolders.Contains(firstPart, StringComparer.OrdinalIgnoreCase))
        {
            Console.Error.WriteLine($"Won't write the site to {output}: choose a new folder inside the repo, such as _site.");
            return false;
        }

        if (Directory.Exists(output))
        {
            Directory.Delete(output, recursive: true);
        }

        Directory.CreateDirectory(output);
        return true;
    }

    private static void CopyFolder(string from, string to)
    {
        foreach (var file in Directory.EnumerateFiles(from, "*", SearchOption.AllDirectories))
        {
            var target = Path.Combine(to, Path.GetRelativePath(from, file));
            Directory.CreateDirectory(Path.GetDirectoryName(target)!);
            File.Copy(file, target, overwrite: true);
        }
    }

    private static async Task WriteFileAsync(string outputFolder, string relativePath, string contents)
    {
        var path = Path.Combine(outputFolder, relativePath);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        await File.WriteAllTextAsync(path, contents, new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
    }

    /// <summary>
    /// The renderer writes the page's &lt;!DOCTYPE html&gt; in its own style; this
    /// removes it so every page starts with the same standard line.
    /// </summary>
    private static string StripDoctype(string html)
    {
        var trimmed = html.TrimStart();
        return trimmed.StartsWith("<!DOCTYPE", StringComparison.OrdinalIgnoreCase)
            ? trimmed[(trimmed.IndexOf('>') + 1)..].TrimStart()
            : trimmed;
    }
}
