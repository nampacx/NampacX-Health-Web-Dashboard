namespace Bloodwork.Services;

/// <summary>
/// Pure header-building logic, mirroring broker's src/lib/cors.ts: an
/// origin-allowlist echo, applied in code rather than the platform's own CORS
/// setting -- both together would emit two Access-Control-Allow-Origin
/// headers, which browsers reject outright. The origin check is a
/// browser-abuse control, not a security boundary (a non-browser caller can
/// forge Origin trivially); the real boundary is the Google token check in
/// GoogleAuthMiddleware.
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
            ["Access-Control-Allow-Methods"] = "GET, POST, PUT, OPTIONS",
            ["Access-Control-Allow-Headers"] = "Content-Type, Authorization",
            ["Access-Control-Max-Age"] = "86400",
        };
        return headers;
    }
}
