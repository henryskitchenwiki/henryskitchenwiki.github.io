using HenrysKitchen.Core;

namespace HenrysKitchen.Tests;

public class PlaceholderTextTests
{
    [Fact]
    public void Splits_placeholders_out_of_a_sentence()
    {
        var parts = PlaceholderText.Split("Meet [[Brisket]], our [[friend]].");

        PlaceholderText.Part[] expected =
        [
            new("Meet ", false),
            new("Brisket", true),
            new(", our ", false),
            new("friend", true),
            new(".", false),
        ];
        Assert.Equal(expected, parts);
    }

    [Fact]
    public void Leaves_ordinary_text_alone()
    {
        var part = Assert.Single(PlaceholderText.Split("Shi*t on a Shingle"));
        Assert.False(part.IsPlaceholder);
        Assert.False(PlaceholderText.HasPlaceholder("Shi*t on a Shingle"));
    }

    [Fact]
    public void Treats_an_unclosed_bracket_as_text()
    {
        var part = Assert.Single(PlaceholderText.Split("A [[half-finished thought"));
        Assert.Equal("A [[half-finished thought", part.Text);
    }
}
