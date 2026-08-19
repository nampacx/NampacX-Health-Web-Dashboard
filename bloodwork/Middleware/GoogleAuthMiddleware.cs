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
/// multi-megabyte upload is rejected before its body is ever buffered.
/// </summary>
public sealed class GoogleAuthMiddleware(CorsService cors, GoogleTokenVerifier tokenVerifier) : IFunctionsWorkerMiddleware
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
            // NOT a 204 (confirmed on Azure's real Flex Consumption app, not
            // reproducible against a local `func start`): a bodyless 204
            // response -- regardless of which IActionResult produces it --
            // comes back over the wire with every header set on
            // HttpContext.Response stripped, including the CORS ones just
            // added above, so the preflight fails and the whole API becomes
            // unreachable from a browser. HTTP 204 forbids a body by spec, so
            // once the status is 204 nothing can carry a body through and this
            // can't be fixed by changing the result type. A 2xx with an actual
            // body is what ErrorHandlingMiddleware's (working) error responses
            // all have in common, so preflight gets a trivial one too.
            context.GetInvocationResult().Value = new ObjectResult(new { }) { StatusCode = StatusCodes.Status200OK };
            return;
        }

        var authHeader = httpContext.Request.Headers.Authorization.FirstOrDefault();
        if (authHeader is null || !authHeader.StartsWith("Bearer ", StringComparison.Ordinal))
        {
            throw new UnauthorizedException("Missing Authorization header.");
        }

        await tokenVerifier.VerifyAsync(authHeader["Bearer ".Length..]);

        await next(context);
    }
}
