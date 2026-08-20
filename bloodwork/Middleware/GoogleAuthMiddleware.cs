using Bloodwork.Models.Exceptions;
using Bloodwork.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Middleware;

namespace Bloodwork.Middleware;

/// <summary>
/// Applied only to HTTP-triggered functions (see Program.cs's UseWhen).
///
/// Adds CORS response headers to the live HttpContext.Response *before*
/// calling next(), so they are present on both success and error responses
/// (headers set after the handler runs are not reliably honored, especially
/// once an exception has propagated). Short-circuits OPTIONS preflight
/// requests without checking auth. Otherwise verifies the caller's Google
/// access token before the wrapped handler ever runs, so an unauthenticated
/// multi-megabyte upload is rejected before its body is ever buffered. The
/// verified subject id is stashed on FunctionContext.Items (via
/// CallerContext) for every downstream function to scope its data access to.
///
/// Three separate questions, in this order:
///
///   0. Rate -- has this caller already had its share? RequestRateLimiter
///      answers it, and it has to answer FIRST: verifying a token costs an
///      outbound call to Google, so a limit applied after authentication would
///      be a limit applied after the expense it exists to bound.
///   1. Authentication -- did this caller sign in through our OAuth client?
///      GoogleTokenVerifier answers it, and *any* Google account can answer
///      yes, because the client id and this app's URL are both public.
///   2. Authorization -- is this account allowed in at all? UsersRepository
///      answers it from the bloodworkUsers allowlist. An account nobody has
///      seen before is recorded as unapproved and refused.
///
/// The gate sits here rather than in the data function so it covers every
/// route uniformly. Gating only the read would leave upload open, and an
/// unapproved account could still push lab reports into the storage account
/// and spend Document Intelligence quota -- which is most of what there is to
/// abuse here.
/// </summary>
public sealed class GoogleAuthMiddleware(
    CorsService cors,
    GoogleTokenVerifier tokenVerifier,
    UsersRepository users,
    RequestRateLimiter rateLimiter) : IFunctionsWorkerMiddleware
{
    public async Task Invoke(FunctionContext context, FunctionExecutionDelegate next)
    {
        var httpContext = context.GetHttpContext()
            ?? throw new InvalidOperationException("GoogleAuthMiddleware ran for a non-HTTP-triggered function.");

        var origin = httpContext.Request.Headers.Origin.FirstOrDefault();
        var isPreflight = HttpMethods.IsOptions(httpContext.Request.Method);

        var corsHeaders = isPreflight ? cors.BuildPreflightHeaders(origin) : cors.BuildHeaders(origin);
        foreach (var (name, value) in corsHeaders)
        {
            httpContext.Response.Headers[name] = value;
        }

        if (isPreflight)
        {
            // This code path never actually runs against the deployed app on
            // Azure: proven by temporarily making it throw unconditionally
            // and observing the client still get a clean 204 with no trace of
            // the exception. On Flex Consumption (and, per Microsoft's own
            // docs, App Service generally) the platform's own CORS handling
            // -- driven by the Function App's `cors.allowedOrigins` site
            // config, set in main.bicep -- intercepts and answers every
            // OPTIONS preflight before user code ever sees the request, full
            // stop; no IActionResult shape or direct HttpContext.Response
            // write from here can change that response. This branch only
            // matters for `func start` locally, where there is no such
            // platform layer and this is the only thing that answers
            // preflight at all -- keep it correct for that case.
            context.GetInvocationResult().Value = new StatusCodeResult(StatusCodes.Status204NoContent);
            return;
        }

        // Before the token is even read, let alone verified: everything below
        // this line costs either an outbound call to Google or a round-trip to
        // Table Storage, and none of it is worth spending on a caller that has
        // already had its allowance. Preflight is exempt because it never
        // reaches any of that (and, on Azure, never reaches this code at all).
        var clientKey = RequestRateLimiter.ClientKeyFrom(
            httpContext.Request.Headers["X-Forwarded-For"].FirstOrDefault(),
            httpContext.Connection.RemoteIpAddress?.ToString());
        if (!rateLimiter.TryAcquire(clientKey, out var retryAfter))
        {
            // Set on the live response rather than left to ErrorMapper: the
            // error contract is a {error, message} JSON body, and Retry-After is
            // a header, so it has to go on here alongside the CORS ones -- for
            // the same reason they do.
            httpContext.Response.Headers.RetryAfter =
                Math.Max(1, (int)Math.Ceiling(retryAfter.TotalSeconds)).ToString();
            throw new TooManyRequestsException("Too many requests. Try again shortly.");
        }

        var authHeader = httpContext.Request.Headers.Authorization.FirstOrDefault();
        if (authHeader is null || !authHeader.StartsWith("Bearer ", StringComparison.Ordinal))
        {
            throw new UnauthorizedException("Missing Authorization header.");
        }

        var caller = await tokenVerifier.VerifyAsync(authHeader["Bearer ".Length..]);

        // 403, not 401: the credential is perfectly good and signing in again
        // will not change the answer, so the SPA must not read this as an
        // expired session and bounce the user back through Google.
        if (!await users.IsApprovedAsync(caller.Sub, caller.Email))
        {
            throw new ForbiddenException(
                "This Google account is not approved to use this app yet. The request has been recorded -- ask the owner to approve it.");
        }

        CallerContext.SetGoogleSub(context, caller.Sub);

        await next(context);
    }
}
