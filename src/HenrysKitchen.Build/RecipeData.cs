using System.Text.Encodings.Web;
using System.Text.Json;
using HenrysKitchen.Core;

namespace HenrysKitchen.Build;

/// <summary>
/// Writes assets/data/recipes/&lt;id&gt;.json for every written-up recipe, so the
/// Transcription Desk can open a recipe that's already on the site and edit it.
/// The shape matches the Desk's own drafts. Fields the Desk has no boxes for
/// (extra stats, a hero image, search aliases, who wrote it up) travel along
/// under "keep" so an edit never drops them.
/// </summary>
internal static class RecipeData
{
    public const string Folder = "assets/data/recipes";

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        Encoder = JavaScriptEncoder.Create(System.Text.Unicode.UnicodeRanges.All),
        WriteIndented = false,
    };

    public static string ToJson(Recipe recipe)
    {
        var data = new Dictionary<string, object?>
        {
            ["title"] = recipe.Title,
            ["subtitle"] = recipe.Subtitle ?? "",
            ["introStart"] = recipe.Intro.Start.ToString(),
            ["introEnd"] = recipe.Intro.End?.ToString() ?? "",
            ["introSource"] = recipe.Intro.Source,
            ["introText"] = string.Join("\n\n", recipe.Intro.Paragraphs),
            ["ingredientsAt"] = recipe.IngredientsAt?.ToString() ?? "",
            ["servings"] = recipe.Servings ?? "",
            ["ingredientsText"] = string.Join("\n", recipe.Ingredients),
            ["allSteps"] = recipe.Steps.Select(s => new Dictionary<string, string>
            {
                ["text"] = s.Text,
                ["at"] = s.At?.ToString() ?? "",
            }).ToList(),
            ["songs"] = recipe.Songs.Select(s => new Dictionary<string, object?>
            {
                ["title"] = s.Title,
                ["artist"] = s.Artist,
                ["album"] = s.Album ?? "",
                ["link"] = s.YoutubeMusic ?? "",
                ["heard"] = s.HeardInEpisode,
            }).ToList(),
            ["notes"] = recipe.Notes,
            ["filing"] = new Dictionary<string, IReadOnlyList<string>>
            {
                ["i"] = recipe.MainIngredients,
                ["c"] = recipe.Collections,
                ["h"] = recipe.Holidays,
            },
            ["keep"] = new Dictionary<string, object?>
            {
                ["stats"] = recipe.Stats.Select(s => new Dictionary<string, string> { ["label"] = s.Label, ["value"] = s.Value }).ToList(),
                ["heroImage"] = recipe.HeroImage ?? "",
                ["searchAliases"] = recipe.SearchAliases,
                ["writtenUpBy"] = recipe.WrittenUpBy ?? "",
            },
        };

        return JsonSerializer.Serialize(data, JsonOptions);
    }
}
