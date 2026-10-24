using System.Globalization;
using HenrysKitchen.Core;
using Markdig;

namespace HenrysKitchen.Build;

/// <summary>
/// Everything a recipe page shows, worked out ahead of time so the Razor page
/// (Components/RecipePage.razor) only has to lay it out.
/// A page always has a <see cref="Video"/>; it has a <see cref="Recipe"/> once
/// someone has written it up. Until then it shows placeholder text.
/// </summary>
public sealed class RecipePageModel
{
    private static readonly MarkdownPipeline NotesPipeline = new MarkdownPipelineBuilder()
        .DisableHtml()   // Notes are plain Markdown; raw HTML is shown as text, never run.
        .Build();

    /// <param name="filedUnder">Where it's filed, most useful first (see SiteData.FiledUnder).</param>
    public RecipePageModel(Video video, Recipe? recipe, IReadOnlyList<Category> filedUnder, IReadOnlyList<RecipeCard> more, bool noIndex)
    {
        Video = video;
        Recipe = recipe;
        FiledUnder = filedUnder;
        More = more;
        NoIndex = noIndex;
    }

    public Video Video { get; }
    public Recipe? Recipe { get; }
    public IReadOnlyList<Category> FiledUnder { get; }
    public IReadOnlyList<RecipeCard> More { get; }
    public bool NoIndex { get; }

    public bool IsWrittenUp => Recipe is not null;

    /// <summary>The title as shown on the site (see TitleRules): "Big Mac", not "How to Make a Big Mac".</summary>
    public string Title => TitleRules.Display(Recipe?.Title ?? Video.Title);

    public string PageUrl => $"/recipes/{Video.Id}/";

    /// <summary>The site image for the recipe, or the episode's YouTube thumbnail.</summary>
    public string ImageUrl => Recipe?.HeroImage ?? $"https://i.ytimg.com/vi/{Video.YoutubeId}/hqdefault.jpg";

    /// <summary>The same picture as a full address, for link previews.</summary>
    public string ShareImageUrl => ImageUrl.StartsWith('/') ? BuildOptions.SiteUrl + ImageUrl : ImageUrl;

    public string ImageAlt => Recipe?.HeroImage is not null
        ? $"{Title}, from Henry’s Kitchen"
        : $"Episode thumbnail for {Title}";

    /// <summary>"From Henry’s Kitchen, Episode 47" (or without the number for episodes that don't have one).</summary>
    public string FromLine => Video.Episode is null ? "From Henry’s Kitchen" : $"From Henry’s Kitchen, Episode {Video.Episode}";

    public string AiredText => Video.Aired.ToString("MMMM d, yyyy", CultureInfo.InvariantCulture);

    /// <summary>The text search engines and link previews show.</summary>
    public string Description
    {
        get
        {
            var episode = Video.Episode is null ? "" : $" Episode {Video.Episode}";
            var subtitle = Recipe?.Subtitle is { } s && !PlaceholderText.HasPlaceholder(s) ? s.TrimEnd('.') + ". " : "";
            return subtitle.Length > 0
                ? $"{subtitle}From Henry’s Kitchen{episode}."
                : $"{Title}, from Henry’s Kitchen{episode}.";
        }
    }

    /// <summary>The main category, for the breadcrumb and card labels, e.g. Beef. Null if not filed.</summary>
    public Category? Filed => FiledUnder.Count > 0 ? FiledUnder[0] : null;

    /// <summary>"By Ingredient", "By Holiday" or "Collections", for the breadcrumb.</summary>
    public static string SectionName(CategoryKind kind) => kind switch
    {
        CategoryKind.Ingredient => "By Ingredient",
        CategoryKind.Holiday => "By Holiday",
        _ => "Collections",
    };

    /// <summary>The Notes section as HTML, or null when there are no notes.</summary>
    public string? NotesHtml =>
        Recipe is { Notes: var notes } && !string.IsNullOrWhiteSpace(notes)
            ? Markdown.ToHtml(notes, NotesPipeline)
            : null;
}

/// <summary>A small card linking to another recipe, used in "More from Henry’s Kitchen".</summary>
public sealed record RecipeCard(string Title, string Url, string YoutubeId, string Kicker);
