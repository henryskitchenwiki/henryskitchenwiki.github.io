using HenrysKitchen.Core;

namespace HenrysKitchen.Tests;

public class TimecodeTests
{
    [Theory]
    [InlineData("0:00", 0)]
    [InlineData("0:52", 52)]
    [InlineData("1:42", 102)]
    [InlineData("12:05", 725)]
    [InlineData("1:02:03", 3723)]
    [InlineData("102", 102)]
    [InlineData(" 1:42 ", 102)]
    public void Reads_times_people_write(string text, int expectedSeconds)
    {
        Assert.True(Timecode.TryParse(text, out var time));
        Assert.Equal(expectedSeconds, time.TotalSeconds);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("9:99")]
    [InlineData("1:2")]
    [InlineData("1:60:00")]
    [InlineData("one minute")]
    [InlineData("-5")]
    public void Refuses_things_that_are_not_times(string? text)
    {
        Assert.False(Timecode.TryParse(text, out _));
    }

    [Theory]
    [InlineData(0, "0:00")]
    [InlineData(52, "0:52")]
    [InlineData(725, "12:05")]
    [InlineData(3723, "1:02:03")]
    public void Writes_times_the_way_people_read_them(int seconds, string expected)
    {
        Assert.Equal(expected, new Timecode(seconds).ToString());
    }
}
