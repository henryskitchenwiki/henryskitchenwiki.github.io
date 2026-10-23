using HenrysKitchen.Core;

namespace HenrysKitchen.Tests;

/// <summary>Reading recipe files and checking them against the episode list.</summary>
public class RecipeTests
{
    private const string BigMacPath = "content/recipes/big-mac.md";

    /// <summary>A small but complete recipe file, in the shape the Transcription Desk writes.</summary>
    private const string GoodRecipe = """
        ---
        id: big-mac
        title: "How to Make a Big Mac"
        subtitle: "Just like mom used to get."
        youtube_id: "a_T50htsd_U"
        episode: 47
        aired: 2020-03-11
        series: henrys-kitchen
        collections: []
        main_ingredients: [beef]
        holidays: []
        intro:
          start: "0:06"
          end: "0:32"
          source: transcript-panel
          text: |
            Hello and welcome to Henry’s Kitchen.

            Today: the Big Mac.
        servings: "1"
        stats: []
        ingredients_at: "0:39"
        ingredients:
          - "Two meat patties"
          - "One middle bun"
        steps:
          - text: "Make the special sauce."
            at: "0:32"
          - text: "Assemble Big Mac."
            at: ""
        songs:
          - title: "God Help Me"
            artist: "José Suicidio"
            album: "Let's Get Suicidal"
            heard_in_episode: true
            youtube_music: "https://music.youtube.com/watch?v=Q6PzixgZgV0"
        hero_image: ""
        search_aliases: []
        written_up_by: "royal-flush"
        ---
        Henry uses a sharpie to cut the middle bun.
        """;

    private static readonly VideoCatalog Catalog = new(
    [
        new Video("big-mac", "How to Make a Big Mac", "a_T50htsd_U", new DateOnly(2020, 3, 11), "47", 321),
        new Video("meatloaf-for-one", "Meatloaf For One", "pogGsYY64wE", new DateOnly(2014, 1, 1), "20", 400),
    ]);

    [Fact]
    public void Reads_a_complete_recipe()
    {
        var result = RecipeLoader.Load(GoodRecipe, BigMacPath);

        Assert.Empty(result.Problems);
        var recipe = Assert.IsType<Recipe>(result.Recipe);
        Assert.Equal("big-mac", recipe.Id);
        Assert.Equal("How to Make a Big Mac", recipe.Title);
        Assert.Equal(new[] { "Hello and welcome to Henry’s Kitchen.", "Today: the Big Mac." }, recipe.Intro.Paragraphs);
        Assert.Equal(6, recipe.Intro.Start.TotalSeconds);
        Assert.Equal(32, recipe.Intro.End?.TotalSeconds);
        Assert.Equal(2, recipe.Ingredients.Count);
        Assert.Equal(32, recipe.Steps[0].At?.TotalSeconds);
        Assert.Null(recipe.Steps[1].At);
        Assert.Equal(new[] { "beef" }, recipe.MainIngredients);
        Assert.True(Assert.Single(recipe.Songs).HeardInEpisode);
        Assert.Null(recipe.HeroImage);
        Assert.Equal("Henry uses a sharpie to cut the middle bun.", recipe.Notes);
    }

    [Fact]
    public void A_good_recipe_passes_the_site_check()
    {
        var result = RecipeValidator.Validate([RecipeLoader.Load(GoodRecipe, BigMacPath)], Catalog);

        Assert.False(result.HasErrors);
        Assert.True(result.Recipes.ContainsKey("a_T50htsd_U"));
        // One step has no time: that's a note for the reviewer, not an error.
        Assert.Contains(result.Problems, p => p.Severity == Severity.Warning && p.Message.Contains("no time"));
    }

    [Fact]
    public void Times_must_be_times()
    {
        var result = RecipeLoader.Load(GoodRecipe.Replace("at: \"0:32\"", "at: \"9:99\""), BigMacPath);

        Assert.Null(result.Recipe);
        Assert.Contains(result.Problems, p => p.Message.Contains("Step 1's time \"9:99\" isn't a time"));
    }

    [Fact]
    public void Times_must_be_inside_the_episode()
    {
        var file = RecipeLoader.Load(GoodRecipe.Replace("at: \"0:32\"", "at: \"7:00\""), BigMacPath);
        var result = RecipeValidator.Validate([file], Catalog);

        Assert.True(result.HasErrors);
        Assert.Contains(result.Problems, p => p.Message.Contains("past the end of the episode (5:21)"));
        Assert.Empty(result.Recipes);
    }

    [Fact]
    public void The_file_name_must_match_the_id()
    {
        var result = RecipeLoader.Load(GoodRecipe, "content/recipes/big-mac-2.md");

        Assert.Contains(result.Problems, p => p.Message.Contains("doesn't match the file name"));
    }

    [Fact]
    public void The_episode_must_exist()
    {
        var file = RecipeLoader.Load(GoodRecipe.Replace("a_T50htsd_U", "not-a-video"), BigMacPath);
        var result = RecipeValidator.Validate([file], Catalog);

        Assert.Contains(result.Problems, p => p.Severity == Severity.Error && p.Message.Contains("not-a-video"));
    }

    [Fact]
    public void Two_files_for_one_episode_is_an_error()
    {
        var first = RecipeLoader.Load(GoodRecipe, BigMacPath);
        var second = first with { Recipe = first.Recipe! with { SourcePath = "content/recipes/copy.md" } };
        var result = RecipeValidator.Validate([first, second], Catalog);

        Assert.Contains(result.Problems, p => p.File == "content/recipes/copy.md" && p.Message.Contains("already the recipe"));
    }

    [Fact]
    public void A_misspelled_field_is_caught()
    {
        var result = RecipeLoader.Load(GoodRecipe.Replace("servings:", "servingz:"), BigMacPath);

        Assert.Null(result.Recipe);
        Assert.Contains(result.Problems, p => p.Message.Contains("\"servingz\" isn't one of the recipe's fields"));
    }

    [Fact]
    public void Placeholders_are_a_note_now_and_an_error_at_launch()
    {
        var file = RecipeLoader.Load(GoodRecipe.Replace("Just like mom used to get.", "[[A one-line description]]"), BigMacPath);

        Assert.False(RecipeValidator.Validate([file], Catalog).HasErrors);
        Assert.True(RecipeValidator.Validate([file], Catalog, launch: true).HasErrors);
    }

    [Fact]
    public void A_file_without_dashes_is_explained()
    {
        var result = RecipeLoader.Load("id: big-mac", BigMacPath);

        Assert.Null(result.Recipe);
        Assert.Contains(result.Problems, p => p.Message.Contains("three dashes"));
    }
}
