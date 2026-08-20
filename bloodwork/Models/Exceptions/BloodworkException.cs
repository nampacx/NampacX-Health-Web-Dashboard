namespace Bloodwork.Models.Exceptions;

/// <summary>
/// Base for every error that <see cref="Bloodwork.Middleware.ErrorHandlingMiddleware"/>
/// knows how to map to a real HTTP status and a <c>{error, message}</c> JSON body.
/// Anything else surfaces as a generic 500.
/// </summary>
public abstract class BloodworkException(string message) : Exception(message);

/// <summary>Malformed request -- 400. Never means the caller's credential is bad.</summary>
public sealed class BadRequestException(string message) : BloodworkException(message);

/// <summary>Missing/invalid/expired Google access token, or a token issued for a different client -- 401.</summary>
public sealed class UnauthorizedException(string message) : BloodworkException(message);

/// <summary>Google's tokeninfo endpoint was unreachable -- 502. Distinct from 401: this is not the caller's fault.</summary>
public sealed class UpstreamAuthException(string message) : BloodworkException(message);

/// <summary>
/// The caller's token is valid, but the account behind it is not on the
/// bloodworkUsers allowlist -- 403. Deliberately distinct from 401: the
/// credential is fine and re-authenticating will not help, so the SPA must not
/// treat this as an expired session and bounce the user back through sign-in.
/// </summary>
public sealed class ForbiddenException(string message) : BloodworkException(message);

/// <summary>Unknown documentId, or no row at the given date/analyte -- 404.</summary>
public sealed class NotFoundException(string message) : BloodworkException(message);

/// <summary>Upload Content-Type isn't one of the supported document types -- 415.</summary>
public sealed class UnsupportedMediaTypeException(string message) : BloodworkException(message);

/// <summary>Upload exceeds the configured size limit -- 413.</summary>
public sealed class PayloadTooLargeException(string message) : BloodworkException(message);

/// <summary>
/// The caller has spent its request allowance for the current window -- 429.
///
/// Every route is <c>AuthorizationLevel.Anonymous</c> behind a public URL, and
/// authenticating a request costs an outbound call to Google, so the limit is
/// applied before authentication rather than after: an unauthenticated flood has
/// to be cheap to refuse, or it is an amplifier pointed at Google's tokeninfo
/// endpoint and at this app's own per-execution bill.
/// </summary>
public sealed class TooManyRequestsException(string message) : BloodworkException(message);

/// <summary>
/// Startup configuration is missing or invalid -- 500 ("misconfigured") if it
/// were ever thrown mid-request, though in practice <c>BloodworkOptions.Load</c>
/// runs once at host startup and an invalid config simply fails the app to
/// start, which is the more honest failure mode for a personal-scale app.
/// </summary>
public sealed class ConfigurationException(string message) : BloodworkException(message);

/// <summary>
/// A pipeline-internal, non-HTTP-facing failure raised by
/// <see cref="Bloodwork.Services.LayoutParser"/>. <see cref="Code"/> lets
/// <c>ProcessDocumentFunction</c> treat every ParseException as permanent
/// (retrying can't fix a header row that was never there) without string-matching
/// on <see cref="Exception.Message"/>.
/// </summary>
public sealed class ParseException(string code, string message) : BloodworkException(message)
{
    public string Code { get; } = code;
}
