using System.Text.Json;

namespace HenrysKitchen.Core;

/// <summary>The three ways a recipe can be filed.</summary>
public enum CategoryKind
{
    Ingredient,
    Collection,
    Holiday,
}

/// <summary>One category from content/categories.json, e.g. ("beef", "Beef", Ingredient).</summary>
/// <param name="Id">Used in recipe files and page addresses. Never changes once used.</param>
/// <param name="Name">What readers see. Can change any time.</param>
public sealed record Category(string Id, string Name, CategoryKind Kind)
{
    /// <summary>The field name recipe files use for this kind, for messages.</summary>
    public static string FieldName(CategoryKind kind) => kind switch
    {
        CategoryKind.Ingredient => "main_ingredients",
        CategoryKind.Collection => "collections",
        _ => "holidays",
    };
}

/// <summary>Where a recipe is filed, as category ids.</summary>
public sealed record Filing(IReadOnlyList<string> Ingredients, IReadOnlyList<string> Collections, IReadOnlyList<string> Holidays)
{
    public static readonly Filing None = new([], [], []);

    public bool IsEmpty => Ingredients.Count == 0 && Collections.Count == 0 && Holidays.Count == 0;

    public IReadOnlyList<string> Of(CategoryKind kind) => kind switch
    {
        CategoryKind.Ingredient => Ingredients,
        CategoryKind.Collection => Collections,
        _ => Holidays,
    };
}

/// <summary>
/// Every category recipes can be filed under (content/categories.json), plus the first-pass
/// filing for episodes nobody has written up yet (content/filing.json).
/// </summary>
public sealed class CategoryList
{
    public const string CategoriesFile = "content/categories.json";
    public const string FilingFile = "content/filing.json";

    private readonly Dictionary<(CategoryKind, string), Category> _byId;

    public CategoryList(IEnumerable<Category> categories)
    {
        All = categories.ToList();
        _byId = All.ToDictionary(c => (c.Kind, c.Id));
    }

    public IReadOnlyList<Category> All { get; }

    public IEnumerable<Category> OfKind(CategoryKind kind) => All.Where(c => c.Kind == kind);

    public Category? Find(CategoryKind kind, string id) => _byId.GetValueOrDefault((kind, id));

    /// <summary>
    /// The categories a recipe is filed under, most useful first: ingredients, then
    /// holidays, then collections. Ids that aren't on the list are skipped.
    /// </summary>
    public IReadOnlyList<Category> Resolve(Filing filing) =>
        new[] { CategoryKind.Ingredient, CategoryKind.Holiday, CategoryKind.Collection }
            .SelectMany(kind => filing.Of(kind).Select(id => Find(kind, id)))
            .OfType<Category>()
            .ToList();

    /// <summary>
    /// Checks a filing against the list, e.g. "'ground-beef' isn't an ingredient category.
    /// Did you mean beef (Beef)?"
    /// </summary>
    public void Check(Filing filing, string file, List<Problem> problems)
    {
        foreach (var kind in Enum.GetValues<CategoryKind>())
        {
            foreach (var id in filing.Of(kind))
            {
                if (Find(kind, id) is not null)
                {
                    continue;
                }

                var closest = Closest(kind, id);
                var hint = closest is null ? $"See {CategoriesFile} for the list." : $"Did you mean {closest.Id} ({closest.Name})?";
                problems.Add(Problem.Error(file, $"\"{id}\" in {Category.FieldName(kind)} isn't one of the categories. {hint}"));
            }
        }

        if (filing.Ingredients.Count > 3)
        {
            problems.Add(Problem.Warning(file, $"Filed under {filing.Ingredients.Count} ingredients; three at most keeps the ingredient pages useful."));
        }
    }

    /// <summary>The category whose id or name is closest to some text, if any is reasonably close.</summary>
    private Category? Closest(CategoryKind kind, string text)
    {
        var wanted = Simplify(text);
        return OfKind(kind)
            .Select(c => (Category: c, Score: Math.Min(Distance(wanted, Simplify(c.Id)), Distance(wanted, Simplify(c.Name)))))
            .Where(x => x.Score <= Math.Max(2, wanted.Length / 3) || Simplify(x.Category.Id).Contains(wanted) || wanted.Contains(Simplify(x.Category.Id)))
            .OrderBy(x => x.Score)
            .Select(x => x.Category)
            .FirstOrDefault();
    }

    private static string Simplify(string text) =>
        new(text.ToLowerInvariant().Where(char.IsLetterOrDigit).ToArray());

    private static int Distance(string a, string b)
    {
        var previous = Enumerable.Range(0, b.Length + 1).ToArray();
        for (var i = 1; i <= a.Length; i++)
        {
            var current = new int[b.Length + 1];
            current[0] = i;
            for (var j = 1; j <= b.Length; j++)
            {
                var cost = a[i - 1] == b[j - 1] ? 0 : 1;
                current[j] = Math.Min(Math.Min(previous[j] + 1, current[j - 1] + 1), previous[j - 1] + cost);
            }

            previous = current;
        }

        return previous[b.Length];
    }

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    /// <summary>Reads content/categories.json. Problems (bad ids, repeats) are added to the list.</summary>
    public static CategoryList Load(string repoRoot, List<Problem> problems)
    {
        var path = Path.Combine(repoRoot, CategoriesFile);
        CategoriesLayout? file;
        try
        {
            file = JsonSerializer.Deserialize<CategoriesLayout>(File.ReadAllText(path), JsonOptions);
        }
        catch (Exception ex) when (ex is IOException or JsonException)
        {
            problems.Add(Problem.Error(CategoriesFile, $"Couldn't be read: {ex.Message}"));
            return new CategoryList([]);
        }

        var categories = new List<Category>();
        void Add(IEnumerable<CategoryEntry?>? entries, CategoryKind kind)
        {
            foreach (var entry in entries ?? [])
            {
                var id = entry?.Id?.Trim() ?? "";
                var name = entry?.Name?.Trim() ?? "";
                if (!System.Text.RegularExpressions.Regex.IsMatch(id, "^[a-z0-9]+(-[a-z0-9]+)*$") || name.Length == 0)
                {
                    problems.Add(Problem.Error(CategoriesFile, $"Each {kind.ToString().ToLowerInvariant()} needs an id (lowercase words joined by hyphens) and a name. Check \"{id}\"."));
                    continue;
                }

                if (categories.Any(c => c.Kind == kind && c.Id == id))
                {
                    problems.Add(Problem.Error(CategoriesFile, $"\"{id}\" is listed twice."));
                    continue;
                }

                categories.Add(new Category(id, name, kind));
            }
        }

        Add(file?.Ingredients, CategoryKind.Ingredient);
        Add(file?.Collections, CategoryKind.Collection);
        Add(file?.Holidays, CategoryKind.Holiday);
        return new CategoryList(categories);
    }

    /// <summary>
    /// Reads content/filing.json: where each episode is filed, by page id, for episodes
    /// whose recipe isn't written up (or doesn't say). A missing file means none.
    /// </summary>
    public Dictionary<string, Filing> LoadFiling(string repoRoot, VideoCatalog catalog, List<Problem> problems)
    {
        var result = new Dictionary<string, Filing>(StringComparer.Ordinal);
        var path = Path.Combine(repoRoot, FilingFile);
        if (!File.Exists(path))
        {
            return result;
        }

        FilingLayout? file;
        try
        {
            file = JsonSerializer.Deserialize<FilingLayout>(File.ReadAllText(path), new JsonSerializerOptions
            {
                PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
            });
        }
        catch (Exception ex) when (ex is IOException or JsonException)
        {
            problems.Add(Problem.Error(FilingFile, $"Couldn't be read: {ex.Message} Check for a missing comma or quote mark."));
            return result;
        }

        var pageIds = catalog.Videos.Select(v => v.Id).ToHashSet(StringComparer.Ordinal);
        foreach (var (pageId, entry) in file?.Episodes ?? new Dictionary<string, FilingEntry?>())
        {
            if (!pageIds.Contains(pageId))
            {
                problems.Add(Problem.Error(FilingFile, $"\"{pageId}\" isn't an episode's page id (see data/videos.json)."));
                continue;
            }

            var filing = new Filing(Clean(entry?.MainIngredients), Clean(entry?.Collections), Clean(entry?.Holidays));
            Check(filing, FilingFile, problems);
            result[pageId] = filing;
        }

        return result;
    }

    private static List<string> Clean(IEnumerable<string?>? ids) =>
        (ids ?? []).Select(id => id?.Trim() ?? "").Where(id => id.Length > 0).ToList();

    private sealed record CategoryEntry(string? Id, string? Name);

    private sealed record CategoriesLayout(List<CategoryEntry?>? Ingredients, List<CategoryEntry?>? Collections, List<CategoryEntry?>? Holidays);

    private sealed record FilingEntry(List<string?>? MainIngredients, List<string?>? Collections, List<string?>? Holidays);

    private sealed record FilingLayout(Dictionary<string, FilingEntry?>? Episodes);
}
