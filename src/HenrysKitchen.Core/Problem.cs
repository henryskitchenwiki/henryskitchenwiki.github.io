namespace HenrysKitchen.Core;

/// <summary>How serious a problem is.</summary>
public enum Severity
{
    /// <summary>Worth knowing, but the site can still be published.</summary>
    Warning,

    /// <summary>Must be fixed before the site can be published.</summary>
    Error,
}

/// <summary>
/// Something wrong (or worth a look) in a content file. Messages are written for
/// the person who wrote the recipe, not for a programmer.
/// </summary>
/// <param name="File">The file it's about, relative to the repo, e.g. content/recipes/big-mac.md.</param>
public sealed record Problem(Severity Severity, string File, string Message)
{
    public static Problem Error(string file, string message) => new(Severity.Error, file, message);

    public static Problem Warning(string file, string message) => new(Severity.Warning, file, message);

    public override string ToString() => $"{(Severity == Severity.Error ? "Error" : "Note")}: {File}: {Message}";
}
