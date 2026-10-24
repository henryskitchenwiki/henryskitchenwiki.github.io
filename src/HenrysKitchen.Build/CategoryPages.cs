using System.Globalization;
using HenrysKitchen.Core;

namespace HenrysKitchen.Build;

/// <summary>
/// Addresses and contents for the category pages and the Recipes hub:
///   /recipes/                          the hub: every category, and All Recipes A–Z
///   /recipes/ingredient/beef/          one page per category
///   /recipes/collection/dinner-for-one/
///   /recipes/holiday/thanksgiving/
/// </summary>
public static class CategoryPages
{
    public const string HubUrl = "/recipes/";

    /// <summary>Folder names under /recipes/ used by category pages, so no recipe can use them as its id.</summary>
    public static readonly IReadOnlySet<string> ReservedIds = new HashSet<string> { "ingredient", "collection", "holiday" };

    public static string Folder(CategoryKind kind) => kind switch
    {
        CategoryKind.Ingredient => "ingredient",
        CategoryKind.Collection => "collection",
        _ => "holiday",
    };

    public static string UrlFor(Category category) => $"/recipes/{Folder(category.Kind)}/{category.Id}/";

    /// <summary>Where each kind sits on the hub page, e.g. /recipes/#ingredients.</summary>
    public static string HubSectionUrl(CategoryKind kind) => kind switch
    {
        CategoryKind.Ingredient => "/recipes/#ingredients",
        CategoryKind.Collection => "/recipes/#collections",
        _ => "/recipes/#holidays",
    };

    /// <summary>
    /// The recipe cards for a category: written-up recipes first, then the rest,
    /// newest first within each.
    /// </summary>
    public static IReadOnlyList<RecipeCard> CardsFor(Category category, SiteData site) =>
        site.Videos
            .Where(v => site.FiledUnder(v).Contains(category))
            .OrderByDescending(v => site.RecipeFor(v) is not null)
            .ThenByDescending(v => v.Aired)
            .Select(v => new RecipeCard(
                site.DisplayTitle(v),
                $"/recipes/{v.Id}/",
                v.YoutubeId,
                v.Episode is null ? v.Aired.ToString("MMM d, yyyy", CultureInfo.InvariantCulture) : $"Episode {v.Episode}"))
            .ToList();
}

/// <summary>What a category page shows.</summary>
public sealed record CategoryPageModel(Category Category, IReadOnlyList<RecipeCard> Cards, bool NoIndex);

/// <summary>What the Recipes hub shows: each category with how many recipes it has.</summary>
public sealed record RecipesHubModel(IReadOnlyList<(Category Category, int Count)> Categories, int Total, bool NoIndex);
