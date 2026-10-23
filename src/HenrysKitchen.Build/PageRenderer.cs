using Microsoft.AspNetCore.Components;
using Microsoft.AspNetCore.Components.Web;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace HenrysKitchen.Build;

/// <summary>
/// Turns a Razor component (a .razor page in Components/) into a finished HTML string,
/// using .NET's built-in HtmlRenderer. One renderer is reused for every page.
/// </summary>
internal sealed class PageRenderer : IAsyncDisposable
{
    private readonly ServiceProvider _services;
    private readonly HtmlRenderer _renderer;

    public PageRenderer()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        _services = services.BuildServiceProvider();
        _renderer = new HtmlRenderer(_services, _services.GetRequiredService<ILoggerFactory>());
    }

    /// <summary>Renders one page.</summary>
    /// <typeparam name="TPage">The page component, e.g. RecipePage.</typeparam>
    /// <param name="parameters">The page's [Parameter] values, by name.</param>
    public Task<string> RenderAsync<TPage>(IDictionary<string, object?> parameters)
        where TPage : IComponent =>
        _renderer.Dispatcher.InvokeAsync(async () =>
        {
            var output = await _renderer.RenderComponentAsync<TPage>(ParameterView.FromDictionary(parameters));
            return output.ToHtmlString();
        });

    public async ValueTask DisposeAsync()
    {
        await _renderer.DisposeAsync();
        await _services.DisposeAsync();
    }
}
