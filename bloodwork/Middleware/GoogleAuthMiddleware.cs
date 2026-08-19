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
            // NOT StatusCodeResult(204): on Azure (confirmed on Flex Consumption,
            // not reproducible against a local `func start`) the ASP.NET Core
            // integration's response-conversion path for a bodyless
            // StatusCodeResult drops every header set on HttpContext.Response
            // beforehand, including the CORS ones just added above -- the
            // preflight comes back a bare "204 No Content" with nothing else,
            // which every browser then treats as a failed preflight. ObjectResult
            // is the same shape ErrorHandlingMiddleware already uses for the 401
            // path below, and that one reliably keeps its headers.
            context.GetInvocationResult().Value = new ObjectResult(null) { StatusCode = StatusCodes.Status204NoContent };
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
