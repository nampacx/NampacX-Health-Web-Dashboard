using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Middleware;
using Microsoft.Extensions.Logging;

namespace Bloodwork.Middleware;

/// <summary>
/// Outermost middleware (registered first in Program.cs) so it also catches
/// exceptions thrown by GoogleAuthMiddleware -- an auth failure must come
/// back as the standard {error, message} JSON body, not an unhandled-
/// exception 500.
///
/// Only applies its catch-and-map behavior to HTTP-triggered functions: the
/// queue-triggered document processor has no HTTP response to shape, and
/// swallowing its exceptions here would silently break the Functions queue
/// extension's built-in retry/poison-queue handling.
/// </summary>
public sealed class ErrorHandlingMiddleware(ILogger<ErrorHandlingMiddleware> logger) : IFunctionsWorkerMiddleware
{
    public async Task Invoke(FunctionContext context, FunctionExecutionDelegate next)
    {
        var isHttpTrigger = context.FunctionDefinition.InputBindings.Values.Any(b => b.Type == "httpTrigger");
        if (!isHttpTrigger)
        {
            await next(context);
            return;
        }

        try
        {
            await next(context);
        }
        catch (Exception ex)
        {
            // Never log request bodies or token values -- only the error shape.
            logger.LogError(ex, "{ExceptionType}: {Message}", ex.GetType().Name, ex.Message);
            var (status, body) = ErrorMapper.Map(ex);
            context.GetInvocationResult().Value = new ObjectResult(body) { StatusCode = status };
        }
    }
}
