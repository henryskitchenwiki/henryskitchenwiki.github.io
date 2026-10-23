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
///   4. write a page for every episode, plus the Desk's recipe list
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

        // 2. Check.
        var checkedRecipes = RecipeValidator.Validate(loaded, catalog, options.Launch);
        ProblemReport.Print(checkedRecipes.Problems);
        if (checkedRecipes.HasErrors)
        {
            Console.WriteLine("Stopped: fix the errors above, then build again.");
            return 1;
        }

        var recipes = checkedRecipes.Recipes;
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
            var model = new RecipePageModel(video, recipes.GetValueOrDefault(video.YoutubeId), MoreAround(i, videos, recipes), !options.Launch);
            var html = await renderer.RenderAsync<RecipePage>(new Dictionary<string, object?> { [nameof(RecipePage.Model)] = model });
            await WriteFileAsync(options.OutputFolder, $"recipes/{video.Id}/index.html", "<!DOCTYPE html>\n" + StripDoctype(html));
        }

        await WriteFileAsync(options.OutputFolder, "assets/js/recipes-data.js", DeskData(videos, recipes));

        Console.WriteLine($"Done: {videos.Count} recipe pages written to {Path.GetRelativePath(root, options.OutputFolder)}/");
        return 0;
    }

    /// <summary>
    /// "More from Henry’s Kitchen": up to three episodes aired around this one,
    /// nearest first, alternating before and after.
    /// </summary>
    private static List<RecipeCard> MoreAround(int index, IReadOnlyList<Video> videos, IReadOnlyDictionary<string, Recipe> recipes) =>
        new[] { index - 1, index + 1, index - 2, index + 2 }
            .Where(i => i >= 0 && i < videos.Count)
            .Take(3)
            .Select(i =>
            {
                var video = videos[i];
                var title = recipes.GetValueOrDefault(video.YoutubeId)?.Title ?? video.Title;
                var kicker = video.Episode is null ? video.Aired.Year.ToString(System.Globalization.CultureInfo.InvariantCulture) : $"Episode {video.Episode}";
                return new RecipeCard(title, $"/recipes/{video.Id}/", video.YoutubeId, kicker);
            })
            .ToList();

    /// <summary>
    /// The recipe list the Transcription Desk reads (assets/js/recipes-data.js).
    /// Short names keep the file small: t = title, v = YouTube video ID, d = aired date,
    /// e = episode number, s = page id, l = length in seconds, w = 1 if written up.
    /// </summary>
    private static string DeskData(IReadOnlyList<Video> videos, IReadOnlyDictionary<string, Recipe> recipes)
    {
        var entries = videos.Select(v => new Dictionary<string, object?>
        {
            ["t"] = v.Title,
            ["v"] = v.YoutubeId,
            ["d"] = v.Aired.ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture),
            ["e"] = v.Episode ?? "",
            ["s"] = v.Id,
            ["l"] = v.LengthSeconds,
            ["w"] = recipes.ContainsKey(v.YoutubeId) ? 1 : 0,
        });

        // The default encoder escapes characters such as < and & so nothing in a title
        // can break out of the script; UnicodeRanges.All just keeps letters like é readable.
        var json = JsonSerializer.Serialize(entries, new JsonSerializerOptions
        {
            Encoder = JavaScriptEncoder.Create(System.Text.Unicode.UnicodeRanges.All),
        });

        return new StringBuilder()
            .AppendLine("// Written by the site build (src/HenrysKitchen.Build). Do not edit by hand.")
            .AppendLine("// t = title, v = YouTube video ID, d = date, e = Henry's episode number,")
            .AppendLine("// s = page id, l = episode length in seconds, w = 1 if already on the site.")
            .Append("window.HK_RECIPES = ").Append(json).AppendLine(";")
            .ToString();
    }

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
