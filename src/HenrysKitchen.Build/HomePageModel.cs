using System.Globalization;
using System.Text.Json;
using HenrysKitchen.Core;

namespace HenrysKitchen.Build;

/// <summary>
/// What the home page shows, worked out by the build so it stays current:
/// the featured recipe (chosen in content/home.json), the five newest episodes,
/// and a few written-up recipes for the Recipe Box.
/// </summary>
public sealed class HomePageModel
{
    public const string SettingsFile = "content/home.json";
    private const int LatestCount = 5;
    private const int RecipeBoxCount = 4;

    public required RecipePageModel Featured { get; init; }
    public required IReadOnlyList<LatestItem> Latest { get; init; }
    public required IReadOnlyList<RecipeCard> RecipeBox { get; init; }
    public required bool NoIndex { get; init; }

    /// <summary>One line in The Latest: "Episode 103 · Aug 5, 2026", title, link.</summary>
    public sealed record LatestItem(string Title, string Url, string YoutubeId, string? Episode, string Date);

    /// <summary>
    /// Builds the home page. Returns null and adds a problem if content/home.json names
    /// a recipe that doesn't exist or isn't written up.
    /// </summary>
    public static HomePageModel? Create(string repoRoot, SiteData site, bool noIndex, List<Problem> problems)
    {
        var featuredId = ReadFeaturedId(repoRoot, problems);
        var featuredVideo = site.Videos.FirstOrDefault(v => v.Id == featuredId);
        var featuredRecipe = featuredVideo is null ? null : site.RecipeFor(featuredVideo);
        if (featuredVideo is null || featuredRecipe is null)
        {
            problems.Add(Problem.Error(SettingsFile, $"\"{featuredId}\" isn't a written-up recipe, so it can't be featured. Use the page id of one that is, e.g. shit-on-a-shingle."));
            return null;
        }

        var latest = site.Videos
            .OrderByDescending(v => v.Aired)
            .Take(LatestCount)
            .Select(v => new LatestItem(
                site.DisplayTitle(v),
                $"/recipes/{v.Id}/", v.YoutubeId, v.Episode,
                v.Aired.ToString("MMM d, yyyy", CultureInfo.InvariantCulture)))
            .ToList();

        // Newest written-up recipes, apart from the featured one.
        var box = site.Videos
            .Where(v => v.Id != featuredId && site.RecipeFor(v) is not null)
            .OrderByDescending(v => v.Aired)
            .Take(RecipeBoxCount)
            .Select(v =>
            {
                var model = site.PageModel(v, [], noIndex);
                var kicker = model.Filed?.Name ?? (v.Episode is null ? model.AiredText : $"Episode {v.Episode}");
                return new RecipeCard(model.Title, model.PageUrl, v.YoutubeId, kicker);
            })
            .ToList();

        return new HomePageModel
        {
            Featured = site.PageModel(featuredVideo, [], noIndex),
            Latest = latest,
            RecipeBox = box,
            NoIndex = noIndex,
        };
    }

    private static string ReadFeaturedId(string repoRoot, List<Problem> problems)
    {
        var path = Path.Combine(repoRoot, SettingsFile);
        try
        {
            using var doc = JsonDocument.Parse(File.ReadAllText(path));
            if (doc.RootElement.TryGetProperty("featured", out var value) && value.GetString() is { Length: > 0 } id)
            {
                return id;
            }
        }
        catch (Exception ex) when (ex is IOException or JsonException)
        {
            problems.Add(Problem.Error(SettingsFile, $"Couldn't be read: {ex.Message}"));
        }

        return "";
    }
}
