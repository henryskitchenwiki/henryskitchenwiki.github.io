using HenrysKitchen.Core;

namespace HenrysKitchen.Build;

/// <summary>
/// Everything the build has read and checked, with the small lookups every page needs:
/// an episode's recipe (if written up), where it's filed, and its title as shown.
/// </summary>
public sealed class SiteData
{
    public required VideoCatalog Catalog { get; init; }

    /// <summary>Written-up recipes, by YouTube video ID.</summary>
    public required IReadOnlyDictionary<string, Recipe> Recipes { get; init; }

    public required CategoryList Categories { get; init; }

    /// <summary>The first-pass filing from content/filing.json, by page id.</summary>
    public required IReadOnlyDictionary<string, Filing> FilingByPageId { get; init; }

    public IReadOnlyList<Video> Videos => Catalog.Videos;

    public Recipe? RecipeFor(Video video) => Recipes.GetValueOrDefault(video.YoutubeId);

    /// <summary>
    /// Where an episode is filed: its recipe file's filing if it has any, otherwise
    /// the first pass in content/filing.json.
    /// </summary>
    public Filing FilingFor(Video video) =>
        RecipeFor(video) is { Filing: { IsEmpty: false } own }
            ? own
            : FilingByPageId.GetValueOrDefault(video.Id) ?? Filing.None;

    /// <summary>The categories an episode is filed under, most useful first.</summary>
    public IReadOnlyList<Category> FiledUnder(Video video) => Categories.Resolve(FilingFor(video));

    /// <summary>The title as shown on the site (see TitleRules).</summary>
    public string DisplayTitle(Video video) => TitleRules.Display(RecipeFor(video)?.Title ?? video.Title);

    public RecipePageModel PageModel(Video video, IReadOnlyList<RecipeCard> more, bool noIndex) =>
        new(video, RecipeFor(video), FiledUnder(video), more, noIndex);
}
