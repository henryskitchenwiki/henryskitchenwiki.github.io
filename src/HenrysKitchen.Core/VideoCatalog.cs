using System.Globalization;
using System.Text.Json;

namespace HenrysKitchen.Core;

/// <summary>
/// The list of Henry's Kitchen recipe episodes, read from data/videos.json.
/// The weekly YouTube check adds new episodes to that file; people don't edit it by hand.
/// </summary>
public sealed class VideoCatalog
{
    private readonly Dictionary<string, Video> _byYoutubeId;

    public VideoCatalog(IEnumerable<Video> videos)
    {
        // Oldest first, so "neighbouring" episodes on a page are the ones aired around it.
        Videos = videos.OrderBy(v => v.Aired).ThenBy(v => v.Id, StringComparer.Ordinal).ToList();
        _byYoutubeId = Videos.ToDictionary(v => v.YoutubeId, StringComparer.Ordinal);
    }

    /// <summary>Every recipe episode, oldest first.</summary>
    public IReadOnlyList<Video> Videos { get; }

    public Video? FindByYoutubeId(string youtubeId) =>
        _byYoutubeId.GetValueOrDefault(youtubeId);

    /// <summary>Reads data/videos.json.</summary>
    /// <exception cref="InvalidDataException">The file is missing fields or has duplicates.</exception>
    public static VideoCatalog Load(string path)
    {
        using var stream = File.OpenRead(path);
        var entries = JsonSerializer.Deserialize<List<VideoEntry>>(stream, JsonOptions)
            ?? throw new InvalidDataException($"{path} is empty.");

        var videos = entries.Select((entry, index) => entry.ToVideo(path, index)).ToList();

        var duplicate = videos.GroupBy(v => v.Id).FirstOrDefault(g => g.Count() > 1)
            ?? videos.GroupBy(v => v.YoutubeId).FirstOrDefault(g => g.Count() > 1);
        if (duplicate is not null)
        {
            throw new InvalidDataException($"{path} lists \"{duplicate.Key}\" more than once.");
        }

        return new VideoCatalog(videos);
    }

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    /// <summary>One entry as it's stored in the JSON file.</summary>
    private sealed record VideoEntry(
        string? Id,
        string? Title,
        string? YoutubeId,
        string? Aired,
        string? Episode,
        int LengthSeconds,
        string? Part2YoutubeId)
    {
        public Video ToVideo(string path, int index)
        {
            if (string.IsNullOrWhiteSpace(Id) || string.IsNullOrWhiteSpace(Title) || string.IsNullOrWhiteSpace(YoutubeId))
            {
                throw new InvalidDataException($"{path}: entry {index + 1} needs an id, title and youtubeId.");
            }

            if (!DateOnly.TryParseExact(Aired, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var aired))
            {
                throw new InvalidDataException($"{path}: \"{Id}\" needs an aired date like 2020-03-11.");
            }

            return new Video(Id, Title, YoutubeId, aired, string.IsNullOrWhiteSpace(Episode) ? null : Episode,
                LengthSeconds, string.IsNullOrWhiteSpace(Part2YoutubeId) ? null : Part2YoutubeId);
        }
    }
}
