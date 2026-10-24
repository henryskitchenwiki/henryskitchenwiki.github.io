using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using HenrysKitchen.Core;

namespace HenrysKitchen.Build;

/// <summary>
/// Writes assets/js/search-index.js: the text the search page looks through.
/// Written-up recipes include everything a reader might search for (ingredients,
/// Henry's introduction, steps, filing, hidden search aliases); episodes nobody
/// has written up yet have just their title. The searching itself happens in
/// static/assets/js/search-engine.js.
/// </summary>
internal static class SearchIndex
{
    public static string Write(IReadOnlyList<Video> videos, IReadOnlyDictionary<string, Recipe> recipes)
    {
        var entries = videos.Select(video =>
        {
            var recipe = recipes.GetValueOrDefault(video.YoutubeId);
            return new Dictionary<string, object?>
            {
                ["id"] = video.Id,
                ["title"] = recipe?.Title ?? video.Title,
                ["subtitle"] = recipe?.Subtitle ?? "",
                ["aliases"] = Join(recipe?.SearchAliases),
                ["filing"] = Join(Filing(recipe)),
                ["ingredients"] = Join(recipe?.Ingredients),
                ["intro"] = Join(recipe?.Intro.Paragraphs),
                ["steps"] = Join(recipe?.Steps.Select(s => s.Text)),
                // Shown on the results, not searched.
                ["v"] = video.YoutubeId,
                ["e"] = video.Episode ?? "",
                ["d"] = video.Aired.ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture),
            };
        });

        // The default encoder escapes characters such as < and & so nothing in a recipe
        // can break out of the script; UnicodeRanges.All keeps letters like é readable.
        var json = JsonSerializer.Serialize(entries, new JsonSerializerOptions
        {
            Encoder = JavaScriptEncoder.Create(System.Text.Unicode.UnicodeRanges.All),
        });

        return new StringBuilder()
            .AppendLine("// Written by the site build (src/HenrysKitchen.Build/SearchIndex.cs). Do not edit by hand.")
            .Append("window.HK_SEARCH_INDEX = ").Append(json).AppendLine(";")
            .ToString();
    }

    /// <summary>Where a recipe is filed, as readable words: "beef", "dinner for one", "thanksgiving".</summary>
    private static IEnumerable<string> Filing(Recipe? recipe) =>
        recipe is null
            ? Enumerable.Empty<string>()
            : recipe.MainIngredients.Concat(recipe.Collections).Concat(recipe.Holidays)
                .Select(slug => slug.Replace('-', ' '));

    private static string Join(IEnumerable<string>? parts) =>
        parts is null ? "" : string.Join(" \n", parts);
}
