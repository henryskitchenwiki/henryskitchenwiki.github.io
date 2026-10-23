// Henry's Kitchen site build.
//
//   dotnet run --project src/HenrysKitchen.Build              build the site into _site/
//   dotnet run --project src/HenrysKitchen.Build -- --check   check content only, write nothing
//   dotnet run --project src/HenrysKitchen.Build -- --launch  public launch build (see BuildOptions)
//
// Exit code 0 means success; 1 means a content problem (listed in the output); 2 means bad options.

using HenrysKitchen.Build;

BuildOptions options;
try
{
    options = BuildOptions.Parse(args);
}
catch (ArgumentException ex)
{
    Console.Error.WriteLine(ex.Message);
    Console.Error.WriteLine("Options: --root <repo folder>  --out <output folder>  --check  --launch");
    return 2;
}

return await SiteBuilder.RunAsync(options);
