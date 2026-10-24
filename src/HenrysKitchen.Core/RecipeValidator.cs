namespace HenrysKitchen.Core;

/// <summary>
/// Checks recipes against the rest of the site: the episode exists, the page address
/// matches the episode's, no two files cover the same episode, and every time falls
/// inside the episode. <see cref="RecipeLoader"/> has already checked each file on its own.
/// </summary>
public static class RecipeValidator
{
    /// <summary>What the check found.</summary>
    /// <param name="Recipes">Recipes good enough to publish, keyed by YouTube video ID.</param>
    public sealed record Result(IReadOnlyDictionary<string, Recipe> Recipes, IReadOnlyList<Problem> Problems)
    {
        public bool HasErrors => Problems.Any(p => p.Severity == Severity.Error);
    }

    /// <param name="loaded">Every recipe file, as read by <see cref="RecipeLoader"/>.</param>
    /// <param name="catalog">Henry's episodes.</param>
    /// <param name="launch">
    /// True for the public launch: [[placeholder]] text becomes an error instead of a note,
    /// so nothing unfinished goes out by accident.
    /// </param>
    /// <param name="categories">The category list; when given, filing must use its categories.</param>
    public static Result Validate(IEnumerable<RecipeLoader.Result> loaded, VideoCatalog catalog, bool launch = false, CategoryList? categories = null)
    {
        var problems = new List<Problem>();
        var recipes = new Dictionary<string, Recipe>(StringComparer.Ordinal);

        foreach (var file in loaded)
        {
            problems.AddRange(file.Problems);
            if (file.Recipe is not { } recipe)
            {
                continue;
            }

            var before = problems.Count(p => p.Severity == Severity.Error);
            CheckRecipe(recipe, catalog, launch, categories, problems);

            if (recipes.TryGetValue(recipe.YoutubeId, out var other))
            {
                problems.Add(Problem.Error(recipe.SourcePath,
                    $"{other.SourcePath} is already the recipe for this episode. Keep one and delete the other."));
                continue;
            }

            if (problems.Count(p => p.Severity == Severity.Error) == before)
            {
                recipes.Add(recipe.YoutubeId, recipe);
            }
        }

        return new Result(recipes, problems);
    }

    private static void CheckRecipe(Recipe recipe, VideoCatalog catalog, bool launch, CategoryList? categories, List<Problem> problems)
    {
        var file = recipe.SourcePath;
        void Error(string message) => problems.Add(Problem.Error(file, message));
        void Note(string message) => problems.Add(Problem.Warning(file, message));

        var video = catalog.FindByYoutubeId(recipe.YoutubeId);
        if (video is null)
        {
            Error($"There's no Henry's Kitchen episode with the youtube_id \"{recipe.YoutubeId}\" in data/videos.json. Check it against the video's address.");
            return;
        }

        if (recipe.Id != video.Id)
        {
            Error($"This episode's page is /recipes/{video.Id}/, so the file should be named {video.Id}.md with id: {video.Id}");
        }

        categories?.Check(recipe.Filing, file, problems);

        // Every time has to fall inside the episode.
        var times = new List<(string Label, Timecode? Time)>
        {
            ("The introduction's start", recipe.Intro.Start),
            ("The introduction's end", recipe.Intro.End),
            ("The ingredient list's time", recipe.IngredientsAt),
        };
        times.AddRange(recipe.Steps.Select((step, i) => ($"Step {i + 1}'s time", step.At)));
        foreach (var (label, time) in times)
        {
            if (time is { } t && t.TotalSeconds > video.LengthSeconds)
            {
                Error($"{label} ({t}) is past the end of the episode ({video.Length}).");
            }
        }

        // Placeholders: fine while we build, not at launch.
        if (AllText(recipe).Any(PlaceholderText.HasPlaceholder))
        {
            var message = "Has [[placeholder]] text that still needs replacing.";
            if (launch)
            {
                Error(message);
            }
            else
            {
                Note(message);
            }
        }

        // Notes for the reviewer; none of these stop the site being published.
        if (recipe.MainIngredients.Count == 0 && recipe.Collections.Count == 0 && recipe.Holidays.Count == 0)
        {
            Note("Not filed yet. Add main_ingredients (and collections or holidays if they fit) so it shows up in the Recipe Box.");
        }

        if (recipe.Intro.End is null)
        {
            Note("The introduction has no end time.");
        }

        var untimed = recipe.Steps.Count(s => s.At is null);
        if (untimed > 0)
        {
            Note($"{untimed} of {recipe.Steps.Count} steps have no time, so they won't get a \"Watch this step\" button.");
        }
    }

    /// <summary>Every piece of text a reader will see, for the placeholder check.</summary>
    private static IEnumerable<string?> AllText(Recipe recipe)
    {
        yield return recipe.Title;
        yield return recipe.Subtitle;
        yield return recipe.Servings;
        yield return recipe.Notes;
        foreach (var text in recipe.Intro.Paragraphs) yield return text;
        foreach (var text in recipe.Ingredients) yield return text;
        foreach (var step in recipe.Steps) yield return step.Text;
        foreach (var stat in recipe.Stats)
        {
            yield return stat.Label;
            yield return stat.Value;
        }

        foreach (var song in recipe.Songs)
        {
            yield return song.Title;
            yield return song.Album;
        }
    }
}
