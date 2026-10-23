namespace HenrysKitchen.Build;

/// <summary>What the build was asked to do, from the command line.</summary>
/// <param name="RepoRoot">The repo folder (the one with HenrysKitchen.sln in it).</param>
/// <param name="OutputFolder">Where the finished site goes. Emptied and rewritten on every build.</param>
/// <param name="CheckOnly">Check the content and report problems, but don't write the site.</param>
/// <param name="Launch">
/// The public launch build: lets search engines list the site, and treats any
/// [[placeholder]] text as an error so nothing unfinished goes out.
/// Until launch, every page asks search engines to stay away (noindex).
/// </param>
public sealed record BuildOptions(string RepoRoot, string OutputFolder, bool CheckOnly, bool Launch)
{
    /// <summary>The site's public address, used for link previews.</summary>
    public const string SiteUrl = "https://henryskitchenwiki.github.io";

    public static BuildOptions Parse(string[] args)
    {
        string? root = null;
        string? output = null;
        var checkOnly = false;
        var launch = false;

        for (var i = 0; i < args.Length; i++)
        {
            switch (args[i])
            {
                case "--root":
                    root = NextValue(args, ref i);
                    break;
                case "--out":
                    output = NextValue(args, ref i);
                    break;
                case "--check":
                    checkOnly = true;
                    break;
                case "--launch":
                    launch = true;
                    break;
                default:
                    throw new ArgumentException($"Unknown option: {args[i]}");
            }
        }

        root = Path.GetFullPath(root ?? FindRepoRoot());
        output = Path.GetFullPath(output ?? Path.Combine(root, "_site"));
        return new BuildOptions(root, output, checkOnly, launch);
    }

    private static string NextValue(string[] args, ref int i)
    {
        if (i + 1 >= args.Length)
        {
            throw new ArgumentException($"{args[i]} needs a folder after it.");
        }

        return args[++i];
    }

    /// <summary>
    /// Walks up from the current folder (or the program's folder, when started from
    /// Visual Studio) until it finds HenrysKitchen.sln.
    /// </summary>
    private static string FindRepoRoot()
    {
        foreach (var start in new[] { Directory.GetCurrentDirectory(), AppContext.BaseDirectory })
        {
            for (var dir = new DirectoryInfo(start); dir is not null; dir = dir.Parent)
            {
                if (File.Exists(Path.Combine(dir.FullName, "HenrysKitchen.sln")))
                {
                    return dir.FullName;
                }
            }
        }

        throw new ArgumentException("Couldn't find the repo folder (the one with HenrysKitchen.sln). Run from inside it, or pass --root.");
    }
}
