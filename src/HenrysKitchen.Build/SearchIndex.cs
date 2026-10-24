using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using HenrysKitchen.Core;

namespace HenrysKitchen.Build;

/// <summary>
/// Writes assets/js/search-index.js: the text the search page looks through.
/// Written-up recipes include everything a reader might search for (ingredients,
/// Henry's introduction, steps, filing, hidden search aliases); episodes nobody
/// has written up yet have just their title. It also carries the related-words
/// list from content/search/search-words.json. The searching itself happens in
/// static/assets/js/search-engine.js.
/// </summary>
internal static class SearchIndex
{
    public const string WordsFile = "content/search/search-words.json";

    public static string Write(IReadOnlyList<Video> videos, IReadOnlyDictionary<string, Recipe> recipes, IReadOnlyList<IReadOnlyList<string>> searchWords)
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
        var jsonOptions = new JsonSerializerOptions
        {
            Encoder = JavaScriptEncoder.Create(System.Text.Unicode.UnicodeRanges.All),
        };

        return new StringBuilder()
            .AppendLine("// Written by the site build (src/HenrysKitchen.Build/SearchIndex.cs). Do not edit by hand.")
            .Append("window.HK_SEARCH_INDEX = ").Append(JsonSerializer.Serialize(entries, jsonOptions)).AppendLine(";")
            .Append("window.HK_SEARCH_WORDS = ").Append(JsonSerializer.Serialize(searchWords, jsonOptions)).AppendLine(";")
            .ToString();
    }

    /// <summary>
    /// Reads the related-words list (content/search/search-words.json). A missing file
    /// just means no related words; a broken one is reported as a problem.
    /// </summary>
    public static IReadOnlyList<IReadOnlyList<string>> LoadWords(string repoRoot, out List<Problem> problems)
    {
        problems = [];
        var path = Path.Combine(repoRoot, WordsFile);
        if (!File.Exists(path))
        {
            return [];
        }

        WordsFileLayout? file;
        try
        {
            file = JsonSerializer.Deserialize<WordsFileLayout>(File.ReadAllText(path), new JsonSerializerOptions(JsonSerializerDefaults.Web));
        }
        catch (JsonException ex)
        {
            problems.Add(Problem.Error(WordsFile, $"Couldn't be read: {ex.Message} Check for a missing comma or quote mark."));
            return [];
        }

        var groups = new List<IReadOnlyList<string>>();
        var seen = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        foreach (var (group, number) in (file?.Groups ?? []).Select((g, i) => (g, i + 1)))
        {
            var words = (group ?? []).Select(w => w?.Trim() ?? "").Where(w => w.Length > 0).ToList();
            if (words.Count < 2)
            {
                problems.Add(Problem.Error(WordsFile, $"Group {number} needs at least two words."));
                continue;
            }

            foreach (var word in words)
            {
                if (!word.All(char.IsLetterOrDigit))
                {
                    problems.Add(Problem.Error(WordsFile, $"Group {number}: \"{word}\" should be a single word. Other names for a dish go in that recipe's search_aliases."));
                }
                else if (seen.TryGetValue(word, out var other))
                {
                    problems.Add(Problem.Error(WordsFile, $"\"{word}\" is in group {other} and group {number}. Merge them or remove one."));
                }
                else
                {
                    seen.Add(word, number);
                }
            }

            groups.Add(words);
        }

        return groups;
    }

    /// <summary>The file's layout: { "about": "...", "groups": [["fry", "fries"], ...] }.</summary>
    private sealed record WordsFileLayout(string? About, List<List<string?>?>? Groups);

    /// <summary>Where a recipe is filed, as readable words: "beef", "dinner for one", "thanksgiving".</summary>
    private static IEnumerable<string> Filing(Recipe? recipe) =>
        recipe is null
            ? Enumerable.Empty<string>()
            : recipe.MainIngredients.Concat(recipe.Collections)
                // Holidays also count as "holiday", so the home page's Holidays circle finds them.
                .Concat(recipe.Holidays.Select(h => h + " holiday"))
                .Select(slug => slug.Replace('-', ' '));

    private static string Join(IEnumerable<string>? parts) =>
        parts is null ? "" : string.Join(" \n", parts);
}
