using System.Text.RegularExpressions;

namespace HenrysKitchen.Core;

/// <summary>
/// One rule for how recipe titles appear on the site, whatever the YouTube title or
/// the writer typed: "How to Make a Big Mac" shows as "Big Mac", "Meatloaf For One"
/// as "Meatloaf for One". Henry's full YouTube title stays searchable.
/// Straight quotes become curly ones, matching the rest of the site.
/// </summary>
public static partial class TitleRules
{
    // Short words that stay lowercase inside a title (but not at the start).
    private static readonly HashSet<string> SmallWords = new(StringComparer.OrdinalIgnoreCase)
    {
        "a", "an", "and", "as", "at", "but", "by", "for", "from", "in", "into", "of", "on", "or", "the", "to", "with", "w/",
    };

    /// <summary>The title as shown on the site.</summary>
    public static string Display(string title)
    {
        var text = Whitespace().Replace(title.Trim(), " ");
        text = HowToMake().Replace(text, "");
        text = TrailingRecipe().Replace(text, "");
        text = LeadingArticle().Replace(text, "");
        text = text.Replace('\'', '’');
        text = StraightQuotes().Replace(text, "“$1”");

        var words = text.Split(' ');
        for (var i = 0; i < words.Length; i++)
        {
            var word = words[i];
            if (word.Length == 0)
            {
                continue;
            }

            // A small word after a colon or dash starts a new phrase, so it keeps its capital.
            var startsPhrase = i == 0 || words[i - 1].EndsWith(':') || words[i - 1] == "-";
            if (SmallWords.Contains(word) && !startsPhrase)
            {
                words[i] = word.ToLowerInvariant();
            }
            else if (char.IsLower(word[0]))
            {
                words[i] = char.ToUpperInvariant(word[0]) + word[1..];
            }
        }

        var result = string.Join(' ', words);
        return result.Length > 0 ? result : title.Trim();
    }

    /// <summary>
    /// The title used for A–Z order: no "Henry’s" at the start, so Henry’s Anytime Chili
    /// files under A.
    /// </summary>
    public static string SortKey(string displayTitle) =>
        HenrysPrefix().Replace(displayTitle, "");

    [GeneratedRegex(@"\s+")]
    private static partial Regex Whitespace();

    [GeneratedRegex(@"^(how to( make)?|make)\s+", RegexOptions.IgnoreCase)]
    private static partial Regex HowToMake();

    [GeneratedRegex("\"([^\"]*)\"")]
    private static partial Regex StraightQuotes();

    [GeneratedRegex(@"\s+recipe$", RegexOptions.IgnoreCase)]
    private static partial Regex TrailingRecipe();

    [GeneratedRegex(@"^(a|an|the)\s+(?=\S)", RegexOptions.IgnoreCase)]
    private static partial Regex LeadingArticle();

    [GeneratedRegex(@"^henry['’]s\s+", RegexOptions.IgnoreCase)]
    private static partial Regex HenrysPrefix();
}
