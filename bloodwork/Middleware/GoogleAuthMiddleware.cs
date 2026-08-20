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
/// verified subject id is stashed on CallerContext for every downstream
/// function to scope its data access to.
/// </summary>
public sealed class GoogleAuthMiddleware(CorsService cors, GoogleTokenVerifier tokenVerifier, CallerContext callerContext) : IFunctionsWorkerMiddleware
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

        var authHeader = httpContext.Request.Headers.Authorization.FirstOrDefault();
        if (authHeader is null || !authHeader.StartsWith("Bearer ", StringComparison.Ordinal))
        {
            throw new UnauthorizedException("Missing Authorization header.");
        }

        callerContext.GoogleSub = await tokenVerifier.VerifyAsync(authHeader["Bearer ".Length..]);

        await next(context);
    }
}
