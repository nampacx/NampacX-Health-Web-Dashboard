namespace Bloodwork.Services;

/// <summary>
/// Pure header-building logic, mirroring broker's src/lib/cors.ts: an
/// origin-allowlist echo. The origin check is a browser-abuse control, not a
/// security boundary (a non-browser caller can forge Origin trivially); the
/// real boundary is the Google token check in GoogleAuthMiddleware.
///
/// <b>Unlike the broker, this is not the only CORS layer.</b> The broker's rule
/// -- code CORS or platform CORS, never both, since two
/// Access-Control-Allow-Origin headers make a browser reject the response
/// outright -- still holds, and the two layers here stay off each other by
/// answering different requests rather than by one of them being empty:
///
///   - <b>Preflight (OPTIONS)</b> is answered by the platform, from the Function
///     App's own cors.allowedOrigins site config in infra/main.bicep. On Flex
///     Consumption it intercepts every OPTIONS request before user code runs, so
///     BuildPreflightHeaders below only ever takes effect under local
///     `func start`, where there is no platform layer at all.
///   - <b>Actual requests</b> (GET/POST/PUT/DELETE) are answered here. The
///     platform does not add its own Access-Control-Allow-Origin to those, which
///     is why exactly one header is emitted and production works.
///
/// Both lists are fed from the same Bicep parameter (ALLOWED_ORIGINS and
/// siteConfig.cors.allowedOrigins), so they cannot be changed independently by
/// accident -- but they are stored in different places, so a change to one that
/// bypasses that parameter would silently diverge from the other.
/// </summary>
public sealed class CorsService(BloodworkOptions options)
{
    public IReadOnlyDictionary<string, string> BuildHeaders(string? requestOrigin)
    {
        var headers = new Dictionary<string, string> { ["Vary"] = "Origin" };
        if (requestOrigin is not null && options.AllowedOrigins.Contains(requestOrigin, StringComparer.Ordinal))
        {
            headers["Access-Control-Allow-Origin"] = requestOrigin;
        }
        return headers;
    }

    public IReadOnlyDictionary<string, string> BuildPreflightHeaders(string? requestOrigin)
    {
        var headers = new Dictionary<string, string>(BuildHeaders(requestOrigin))
        {
            ["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS",
            ["Access-Control-Allow-Headers"] = "Content-Type, Authorization",
            ["Access-Control-Max-Age"] = "86400",
        };
        return headers;
    }
}
