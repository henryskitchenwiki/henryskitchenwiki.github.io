namespace HenrysKitchen.Core;

// The shapes the rest of the site works with. They're read-only once loaded:
// the loader builds them from files, and nothing else changes them.

/// <summary>
/// One of Henry's episodes, from data/videos.json. Every video gets a page,
/// whether or not anyone has written up its recipe yet.
/// </summary>
/// <param name="Id">The page's permanent address, e.g. "big-mac" for /recipes/big-mac/. Never changes once published.</param>
/// <param name="Title">The title as it appears on YouTube, minus the "Henry's Kitchen 47 -" prefix.</param>
/// <param name="YoutubeId">The part after watch?v= in the video's address.</param>
/// <param name="Aired">The upload date.</param>
/// <param name="Episode">Henry's episode number, if the video has one. Display only: numbers can repeat.</param>
/// <param name="LengthSeconds">How long the episode runs, used to catch times past the end.</param>
/// <param name="Part2YoutubeId">For two-part episodes that share one page: the second video.</param>
public sealed record Video(
    string Id,
    string Title,
    string YoutubeId,
    DateOnly Aired,
    string? Episode,
    int LengthSeconds,
    string? Part2YoutubeId = null)
{
    public Timecode Length => new(LengthSeconds);
}

/// <summary>A recipe someone has written up, from content/recipes/&lt;id&gt;.md.</summary>
public sealed record Recipe
{
    public required string Id { get; init; }
    public required string Title { get; init; }
    public string? Subtitle { get; init; }
    public required string YoutubeId { get; init; }

    public IReadOnlyList<string> Collections { get; init; } = [];
    public IReadOnlyList<string> MainIngredients { get; init; } = [];
    public IReadOnlyList<string> Holidays { get; init; } = [];

    /// <summary>Where the recipe file says it's filed.</summary>
    public Filing Filing => new(MainIngredients, Collections, Holidays);

    public required RecipeIntro Intro { get; init; }

    public string? Servings { get; init; }
    public IReadOnlyList<RecipeStat> Stats { get; init; } = [];
    public Timecode? IngredientsAt { get; init; }
    public IReadOnlyList<string> Ingredients { get; init; } = [];
    public IReadOnlyList<RecipeStep> Steps { get; init; } = [];
    public IReadOnlyList<Song> Songs { get; init; } = [];

    /// <summary>A site image such as /assets/img/shingle-thumb.jpg; null means use the episode thumbnail.</summary>
    public string? HeroImage { get; init; }
    public IReadOnlyList<string> SearchAliases { get; init; } = [];

    /// <summary>Who wrote it up. Kept for the reviewers; never shown on the site.</summary>
    public string? WrittenUpBy { get; init; }

    /// <summary>The Notes section, in Markdown. Empty if there are none.</summary>
    public string Notes { get; init; } = "";

    /// <summary>Where the recipe came from, e.g. content/recipes/big-mac.md, for error messages.</summary>
    public required string SourcePath { get; init; }
}

/// <summary>Henry's opening words, with when they start and end in the episode.</summary>
/// <param name="Paragraphs">The introduction, one entry per paragraph.</param>
/// <param name="Source">Where the words came from: transcript-panel, manual or caption-file.</param>
public sealed record RecipeIntro(IReadOnlyList<string> Paragraphs, Timecode Start, Timecode? End, string Source);

/// <summary>An extra fact for the recipe card, in Henry's words, e.g. "Food groups: All four".</summary>
public sealed record RecipeStat(string Label, string Value);

/// <summary>One step, and when it starts in the episode (if the writer knew).</summary>
public sealed record RecipeStep(string Text, Timecode? At);

/// <summary>A José Suicidio song heard in or written for the episode.</summary>
public sealed record Song(string Title, string Artist, string? Album, bool HeardInEpisode, string? YoutubeMusic);
