using HenrysKitchen.Core;

namespace HenrysKitchen.Tests;

public class CategoryTests
{
    private static readonly CategoryList List = new(
    [
        new Category("beef", "Beef", CategoryKind.Ingredient),
        new Category("chicken-turkey", "Chicken & Turkey", CategoryKind.Ingredient),
        new Category("dinner-for-one", "Dinner for One", CategoryKind.Collection),
        new Category("thanksgiving", "Thanksgiving", CategoryKind.Holiday),
    ]);

    [Fact]
    public void Accepts_categories_on_the_list()
    {
        var problems = new List<Problem>();
        List.Check(new Filing(["beef"], ["dinner-for-one"], ["thanksgiving"]), "content/recipes/x.md", problems);

        Assert.Empty(problems);
    }

    [Theory]
    [InlineData("ground-beef", "beef")]
    [InlineData("chicken", "chicken-turkey")]
    [InlineData("beeef", "beef")]
    public void Suggests_the_closest_category(string typed, string suggested)
    {
        var problems = new List<Problem>();
        List.Check(new Filing([typed], [], []), "content/recipes/x.md", problems);

        var problem = Assert.Single(problems);
        Assert.Equal(Severity.Error, problem.Severity);
        Assert.Contains($"Did you mean {suggested}", problem.Message);
    }

    [Fact]
    public void Lists_ingredients_first_then_holidays_then_collections()
    {
        var filed = List.Resolve(new Filing(["beef"], ["dinner-for-one"], ["thanksgiving"]));

        Assert.Equal(new[] { "beef", "thanksgiving", "dinner-for-one" }, filed.Select(c => c.Id));
    }

    [Fact]
    public void A_category_on_the_wrong_list_is_caught()
    {
        var problems = new List<Problem>();
        List.Check(new Filing(["thanksgiving"], [], []), "content/recipes/x.md", problems);

        Assert.Contains(problems, p => p.Message.Contains("isn't one of the categories"));
    }
}
