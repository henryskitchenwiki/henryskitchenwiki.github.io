using HenrysKitchen.Core;

namespace HenrysKitchen.Tests;

public class TitleRulesTests
{
    [Theory]
    [InlineData("How to Make a Big Mac", "Big Mac")]
    [InlineData("How to make Delicious Nutty Chocolate Truffles", "Delicious Nutty Chocolate Truffles")]
    [InlineData("Meatloaf For One", "Meatloaf for One")]
    [InlineData("Shi*t On a Shingle", "Shi*t on a Shingle")]
    [InlineData("How to Make Henry's Anytime Chili for One", "Henry’s Anytime Chili for One")]
    [InlineData("Delicious Chocolate Donut Recipe", "Delicious Chocolate Donut")]
    [InlineData("Make BJ's Famous Pizookie", "BJ’s Famous Pizookie")]
    [InlineData("the Viral Flat Croissant", "Viral Flat Croissant")]
    [InlineData("Henry's \"Quiche Henry\"", "Henry’s “Quiche Henry”")]
    [InlineData("Bonus Thanksgiving Episode: The Pie", "Bonus Thanksgiving Episode: The Pie")]
    [InlineData("Thanksgiving Special - The Veggieducken", "Thanksgiving Special - The Veggieducken")]
    public void Shows_titles_one_consistent_way(string title, string expected)
    {
        Assert.Equal(expected, TitleRules.Display(title));
    }

    [Fact]
    public void Sorts_Henrys_recipes_by_the_dish()
    {
        Assert.Equal("Anytime Chili for One", TitleRules.SortKey("Henry’s Anytime Chili for One"));
    }
}
