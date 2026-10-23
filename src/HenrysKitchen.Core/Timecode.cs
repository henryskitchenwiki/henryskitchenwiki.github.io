using System.Globalization;
using System.Text.RegularExpressions;

namespace HenrysKitchen.Core;

/// <summary>
/// A point in an episode, such as 1:42. Recipe files write times as minutes:seconds
/// (or hours:minutes:seconds past an hour); this type reads and writes that format.
/// </summary>
public readonly partial record struct Timecode(int TotalSeconds)
{
    /// <summary>
    /// Reads "1:42", "1:02:03" or a plain number of seconds such as "102".
    /// Returns false for anything else, including blank text.
    /// </summary>
    public static bool TryParse(string? text, out Timecode timecode)
    {
        timecode = default;
        var value = text?.Trim();
        if (string.IsNullOrEmpty(value))
        {
            return false;
        }

        if (int.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out var plainSeconds))
        {
            timecode = new Timecode(plainSeconds);
            return true;
        }

        var match = TimePattern().Match(value);
        if (!match.Success)
        {
            return false;
        }

        var hours = match.Groups["h"].Success ? int.Parse(match.Groups["h"].Value, CultureInfo.InvariantCulture) : 0;
        var minutes = int.Parse(match.Groups["m"].Value, CultureInfo.InvariantCulture);
        var seconds = int.Parse(match.Groups["s"].Value, CultureInfo.InvariantCulture);

        // Seconds always stop at 59; minutes only do when there's an hour in front.
        if (seconds > 59 || (match.Groups["h"].Success && minutes > 59))
        {
            return false;
        }

        timecode = new Timecode(hours * 3600 + minutes * 60 + seconds);
        return true;
    }

    /// <summary>Writes the time the way people read it: 1:42, or 1:02:03 past an hour.</summary>
    public override string ToString()
    {
        var hours = TotalSeconds / 3600;
        var minutes = TotalSeconds % 3600 / 60;
        var seconds = TotalSeconds % 60;
        return hours > 0
            ? $"{hours}:{minutes:00}:{seconds:00}"
            : $"{minutes}:{seconds:00}";
    }

    [GeneratedRegex(@"^(?:(?<h>\d+):)?(?<m>\d{1,2}):(?<s>\d{2})$")]
    private static partial Regex TimePattern();
}
