namespace HenrysKitchen.Core;

/// <summary>
/// Text in content files can mark a stand-in with double square brackets, e.g.
/// "[[Kitchen Friend]]". The site shows these with a dashed underline so readers
/// can tell they aren't final, and the launch build refuses to publish them.
/// </summary>
public static class PlaceholderText
{
    private const string Open = "[[";
    private const string Close = "]]";

    /// <summary>One piece of a sentence: either ordinary text or a placeholder.</summary>
    public readonly record struct Part(string Text, bool IsPlaceholder);

    /// <summary>True if the text contains any [[placeholder]] marks.</summary>
    public static bool HasPlaceholder(string? text) =>
        text is not null && text.Contains(Open, StringComparison.Ordinal);

    /// <summary>
    /// Splits "Meet [[Brisket]], our friend" into "Meet ", "Brisket" (placeholder), ", our friend".
    /// An unclosed "[[" is treated as ordinary text.
    /// </summary>
    public static IReadOnlyList<Part> Split(string? text)
    {
        var parts = new List<Part>();
        if (string.IsNullOrEmpty(text))
        {
            return parts;
        }

        var position = 0;
        while (position < text.Length)
        {
            var start = text.IndexOf(Open, position, StringComparison.Ordinal);
            var end = start < 0 ? -1 : text.IndexOf(Close, start + Open.Length, StringComparison.Ordinal);
            if (start < 0 || end < 0)
            {
                parts.Add(new Part(text[position..], false));
                break;
            }

            if (start > position)
            {
                parts.Add(new Part(text[position..start], false));
            }

            parts.Add(new Part(text[(start + Open.Length)..end], true));
            position = end + Close.Length;
        }

        return parts;
    }
}
