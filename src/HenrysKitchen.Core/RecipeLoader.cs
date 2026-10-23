using System.Text.RegularExpressions;
using YamlDotNet.Core;
using YamlDotNet.Serialization;
using YamlDotNet.Serialization.NamingConventions;

namespace HenrysKitchen.Core;

/// <summary>
/// Reads recipe files (content/recipes/*.md). Each file is a block of YAML between
/// two "---" lines, followed by optional Notes in Markdown.
///
/// This class only checks that a file is well-formed on its own: required fields are
/// there, times are times, and so on. Checks that need the whole site (does the video
/// exist, are two files about the same episode) are in <see cref="RecipeValidator"/>.
/// </summary>
public static partial class RecipeLoader
{
    private static readonly IDeserializer Yaml = new DeserializerBuilder()
        .WithNamingConvention(UnderscoredNamingConvention.Instance)
        .Build();

    private static readonly HashSet<string> IntroSources = ["transcript-panel", "manual", "caption-file"];

    /// <summary>The result of reading one file: the recipe (if it could be read) and anything wrong with it.</summary>
    public sealed record Result(Recipe? Recipe, IReadOnlyList<Problem> Problems);

    /// <summary>Reads every .md file in a folder, in name order.</summary>
    /// <param name="folder">The full path to content/recipes.</param>
    /// <param name="repoRoot">The repo folder, so messages can show short paths.</param>
    public static IReadOnlyList<Result> LoadFolder(string folder, string repoRoot)
    {
        if (!Directory.Exists(folder))
        {
            return [];
        }

        return Directory.EnumerateFiles(folder, "*.md")
            .Order(StringComparer.Ordinal)
            .Select(path => Load(File.ReadAllText(path), ToRepoPath(path, repoRoot)))
            .ToList();
    }

    /// <summary>Reads one recipe from its text.</summary>
    /// <param name="text">The whole file.</param>
    /// <param name="sourcePath">Where it came from, e.g. content/recipes/big-mac.md. The file name must match the id.</param>
    public static Result Load(string text, string sourcePath)
    {
        var problems = new List<Problem>();
        void Error(string message) => problems.Add(Problem.Error(sourcePath, message));

        if (!TrySplitFrontMatter(text, out var yaml, out var body))
        {
            Error("The recipe needs to start with a line of three dashes (---), then its details, then another --- line.");
            return new Result(null, problems);
        }

        RecipeFile? file;
        try
        {
            file = Yaml.Deserialize<RecipeFile?>(yaml);
        }
        catch (YamlException ex)
        {
            // The YAML keeps the opening --- as a blank line, so its line numbers match the file's.
            var line = ex.Start.Line;
            var unknownField = UnknownField().Match(ex.ToString());
            if (unknownField.Success)
            {
                Error($"Line {line}: \"{unknownField.Groups["name"].Value}\" isn't one of the recipe's fields. Check its spelling against the recipe template.");
            }
            else
            {
                var detail = LocationPrefix().Replace((ex.InnerException ?? ex).Message, "").Split('\n')[0];
                Error($"Line {line} couldn't be read. Check for a missing quote mark, or text containing a colon or * that isn't in \"double quotes\". (Details: {detail})");
            }

            return new Result(null, problems);
        }

        if (file is null)
        {
            Error("The recipe details between the --- lines are empty.");
            return new Result(null, problems);
        }

        var id = Clean(file.Id);
        var expectedId = Path.GetFileNameWithoutExtension(sourcePath);
        if (id is null)
        {
            Error("The recipe needs an id.");
        }
        else if (!IdPattern().IsMatch(id))
        {
            Error($"The id \"{id}\" should be lowercase words joined by hyphens, like big-mac.");
        }
        else if (id != expectedId)
        {
            Error($"The id \"{id}\" doesn't match the file name. Rename the file to {id}.md, or change the id to {expectedId}.");
        }

        var title = Clean(file.Title);
        if (title is null)
        {
            Error("The recipe needs a title.");
        }

        var youtubeId = Clean(file.YoutubeId);
        if (youtubeId is null)
        {
            Error("The recipe needs a youtube_id (the part after watch?v= in the video's address).");
        }

        // Henry's introduction.
        var introText = file.Intro?.Text ?? "";
        var paragraphs = ParagraphBreak().Split(introText)
            .Select(p => WhiteSpace().Replace(p, " ").Trim())
            .Where(p => p.Length > 0)
            .ToList();
        if (paragraphs.Count == 0)
        {
            Error("Henry's introduction is empty.");
        }

        var introStart = ReadTime(file.Intro?.Start, "The introduction's start", problems, sourcePath) ?? new Timecode(0);
        var introEnd = ReadTime(file.Intro?.End, "The introduction's end", problems, sourcePath);
        if (introEnd is { } end && end.TotalSeconds <= introStart.TotalSeconds)
        {
            Error($"The introduction ends ({end}) before it starts ({introStart}).");
        }

        var source = Clean(file.Intro?.Source) ?? "transcript-panel";
        if (!IntroSources.Contains(source))
        {
            Error($"The introduction's source \"{source}\" should be transcript-panel, manual or caption-file.");
        }

        // The recipe card.
        var ingredients = CleanList(file.Ingredients);
        if (ingredients.Count == 0)
        {
            Error("The recipe needs at least one ingredient.");
        }

        var steps = new List<RecipeStep>();
        foreach (var (step, index) in (file.Steps ?? []).Select((s, i) => (s, i)))
        {
            var stepText = Clean(step?.Text);
            if (stepText is null)
            {
                continue;
            }

            var at = ReadTime(step?.At, $"Step {index + 1}'s time", problems, sourcePath);
            steps.Add(new RecipeStep(WhiteSpace().Replace(stepText, " "), at));
        }

        if (steps.Count == 0)
        {
            Error("The recipe needs at least one step.");
        }

        var stats = (file.Stats ?? [])
            .Where(s => Clean(s?.Label) is not null && Clean(s?.Value) is not null)
            .Select(s => new RecipeStat(Clean(s!.Label)!, Clean(s.Value)!))
            .ToList();

        var songs = new List<Song>();
        foreach (var song in file.Songs ?? [])
        {
            var songTitle = Clean(song?.Title);
            if (songTitle is null)
            {
                continue;
            }

            var link = Clean(song!.YoutubeMusic);
            if (link is not null && !link.StartsWith("https://music.youtube.com/", StringComparison.Ordinal))
            {
                Error($"The link for \"{songTitle}\" should start with https://music.youtube.com/");
                link = null;
            }

            songs.Add(new Song(songTitle, Clean(song.Artist) ?? "José Suicidio", Clean(song.Album), song.HeardInEpisode, link));
        }

        var heroImage = Clean(file.HeroImage);
        if (heroImage is not null && !heroImage.StartsWith("/assets/img/", StringComparison.Ordinal))
        {
            Error($"The hero_image \"{heroImage}\" should be a picture in the site's image folder, starting with /assets/img/");
            heroImage = null;
        }

        var ingredientsAt = ReadTime(file.IngredientsAt, "The ingredient list's time", problems, sourcePath);

        if (problems.Any(p => p.Severity == Severity.Error) || id is null || title is null || youtubeId is null)
        {
            return new Result(null, problems);
        }

        var recipe = new Recipe
        {
            Id = id,
            Title = title,
            Subtitle = Clean(file.Subtitle),
            YoutubeId = youtubeId,
            Collections = CleanList(file.Collections),
            MainIngredients = CleanList(file.MainIngredients),
            Holidays = CleanList(file.Holidays),
            Intro = new RecipeIntro(paragraphs, introStart, introEnd, source),
            Servings = Clean(file.Servings),
            Stats = stats,
            IngredientsAt = ingredientsAt,
            Ingredients = ingredients,
            Steps = steps,
            Songs = songs,
            HeroImage = heroImage,
            SearchAliases = CleanList(file.SearchAliases),
            WrittenUpBy = Clean(file.WrittenUpBy),
            Notes = HtmlComment().Replace(body, "").Trim(),
            SourcePath = sourcePath,
        };
        return new Result(recipe, problems);
    }

    /// <summary>Separates the YAML between the --- lines from the Markdown after them.</summary>
    internal static bool TrySplitFrontMatter(string text, out string yaml, out string body)
    {
        yaml = body = "";
        var lines = text.TrimStart('﻿').Replace("\r\n", "\n", StringComparison.Ordinal).Split('\n');
        if (lines.Length == 0 || lines[0].Trim() != "---")
        {
            return false;
        }

        var closing = Array.FindIndex(lines, 1, line => line.Trim() == "---");
        if (closing < 0)
        {
            return false;
        }

        // Keep the opening line as a blank so YAML line numbers match the file's.
        yaml = "\n" + string.Join('\n', lines[1..closing]);
        body = string.Join('\n', lines[(closing + 1)..]);
        return true;
    }

    private static Timecode? ReadTime(string? text, string label, List<Problem> problems, string sourcePath)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            return null;
        }

        if (Timecode.TryParse(text, out var time))
        {
            return time;
        }

        problems.Add(Problem.Error(sourcePath, $"{label} \"{text.Trim()}\" isn't a time. Use minutes:seconds, like 1:42."));
        return null;
    }

    private static string? Clean(string? text) =>
        string.IsNullOrWhiteSpace(text) ? null : text.Trim();

    private static List<string> CleanList(IEnumerable<string?>? items) =>
        (items ?? []).Select(Clean).OfType<string>().ToList();

    private static string ToRepoPath(string path, string repoRoot) =>
        Path.GetRelativePath(repoRoot, path).Replace('\\', '/');

    [GeneratedRegex("^[a-z0-9]+(?:-[a-z0-9]+)*$")]
    private static partial Regex IdPattern();

    [GeneratedRegex(@"\n\s*\n")]
    private static partial Regex ParagraphBreak();

    [GeneratedRegex(@"\s+")]
    private static partial Regex WhiteSpace();

    [GeneratedRegex("Property '(?<name>[^']+)' not found")]
    private static partial Regex UnknownField();

    [GeneratedRegex(@"^\(Line: [^)]*\) - \(Line: [^)]*\): ")]
    private static partial Regex LocationPrefix();

    [GeneratedRegex("<!--.*?-->", RegexOptions.Singleline)]
    private static partial Regex HtmlComment();

    // ---- The file's layout, exactly as written in YAML ----------------------
    // Field names map from snake_case: youtube_id -> YoutubeId. A field the class
    // doesn't know about is an error, which catches typos like "ingredient:".
    // Everything is read as text first so a stray value gives a friendly message
    // instead of a crash.

    private sealed class RecipeFile
    {
        public string? Id { get; set; }
        public string? Title { get; set; }
        public string? Subtitle { get; set; }
        public string? YoutubeId { get; set; }
        public string? Episode { get; set; }
        public string? Aired { get; set; }
        public string? Series { get; set; }
        public List<string?>? Collections { get; set; }
        public List<string?>? MainIngredients { get; set; }
        public List<string?>? Holidays { get; set; }
        public IntroFile? Intro { get; set; }
        public string? Servings { get; set; }
        public List<StatFile?>? Stats { get; set; }
        public string? IngredientsAt { get; set; }
        public List<string?>? Ingredients { get; set; }
        public List<StepFile?>? Steps { get; set; }
        public List<SongFile?>? Songs { get; set; }
        public string? HeroImage { get; set; }
        public List<string?>? SearchAliases { get; set; }
        public string? WrittenUpBy { get; set; }
    }

    private sealed class IntroFile
    {
        public string? Start { get; set; }
        public string? End { get; set; }
        public string? Source { get; set; }
        public string? Text { get; set; }
    }

    private sealed class StatFile
    {
        public string? Label { get; set; }
        public string? Value { get; set; }
    }

    private sealed class StepFile
    {
        public string? Text { get; set; }
        public string? At { get; set; }
    }

    private sealed class SongFile
    {
        public string? Title { get; set; }
        public string? Artist { get; set; }
        public string? Album { get; set; }
        public bool HeardInEpisode { get; set; }
        public string? YoutubeMusic { get; set; }
    }
}
