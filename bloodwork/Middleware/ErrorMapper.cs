using Bloodwork.Models.Exceptions;

namespace Bloodwork.Middleware;

/// <summary>
/// Pure exception -&gt; (status, body) mapping, kept independently testable
/// from the middleware pipeline. Mirrors broker's src/lib/errors.ts: real
/// HTTP status codes, a {error, message} JSON body, and the same 401-vs-502
/// split -- only 401 means the caller's own credential is bad; 502 means
/// Google itself was unreachable, which must not look the same to a client
/// deciding whether to drop a stored credential.
/// </summary>
public static class ErrorMapper
{
    public static (int Status, object Body) Map(Exception exception) => exception switch
    {
        BadRequestException e => (400, Body("bad_request", e.Message)),
        UnauthorizedException e => (401, Body("unauthorized", e.Message)),
        NotFoundException e => (404, Body("not_found", e.Message)),
        PayloadTooLargeException e => (413, Body("payload_too_large", e.Message)),
        UnsupportedMediaTypeException e => (415, Body("unsupported_media_type", e.Message)),
        ConfigurationException e => (500, Body("misconfigured", e.Message)),
        UpstreamAuthException e => (502, Body("upstream_auth", e.Message)),
        _ => (500, Body("internal", "Unexpected error.")),
    };

    private static object Body(string error, string message) => new { error, message };
}
