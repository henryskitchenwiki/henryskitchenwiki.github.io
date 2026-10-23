using HenrysKitchen.Core;

namespace HenrysKitchen.Build;

/// <summary>
/// Prints content problems. On GitHub they're also written as "annotations", which
/// show up on the pull request next to the file, so the writer sees exactly what to fix.
/// </summary>
internal static class ProblemReport
{
    private static readonly bool OnGitHub =
        string.Equals(Environment.GetEnvironmentVariable("GITHUB_ACTIONS"), "true", StringComparison.OrdinalIgnoreCase);

    public static void Print(IReadOnlyList<Problem> problems)
    {
        foreach (var problem in problems.OrderByDescending(p => p.Severity).ThenBy(p => p.File, StringComparer.Ordinal))
        {
            if (OnGitHub)
            {
                var kind = problem.Severity == Severity.Error ? "error" : "warning";
                Console.WriteLine($"::{kind} file={problem.File}::{Escape(problem.Message)}");
            }
            else
            {
                Console.WriteLine(problem);
            }
        }
    }

    /// <summary>GitHub's annotation format reserves %, carriage returns and new lines.</summary>
    private static string Escape(string message) =>
        message.Replace("%", "%25", StringComparison.Ordinal)
               .Replace("\r", "%0D", StringComparison.Ordinal)
               .Replace("\n", "%0A", StringComparison.Ordinal);
}
