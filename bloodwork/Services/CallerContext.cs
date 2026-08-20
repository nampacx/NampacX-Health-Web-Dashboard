using Microsoft.Azure.Functions.Worker;

namespace Bloodwork.Services;

/// <summary>
/// Carries the caller's verified Google subject id from GoogleAuthMiddleware
/// to the HTTP-triggered function handler that runs after it, via
/// FunctionContext.Items -- the isolated worker's documented mechanism for
/// sharing data within the scope of one invocation.
///
/// A DI-registered scoped service was tried first (set in the middleware,
/// constructor-injected into the function) on the assumption that scoped
/// services match one function execution end to end. That shipped a 500 on
/// every authenticated request: middleware and the function handler resolve
/// their constructor dependencies from different scope instances in
/// practice, so the value set in GoogleAuthMiddleware was invisible to the
/// function. FunctionContext.Items does not have that problem -- middleware
/// and handler are both handed the same FunctionContext for the invocation.
/// </summary>
public static class CallerContext
{
    private const string GoogleSubKey = "GoogleSub";

    public static void SetGoogleSub(FunctionContext context, string sub) => context.Items[GoogleSubKey] = sub;

    public static string RequireGoogleSub(FunctionContext context) =>
        context.Items.TryGetValue(GoogleSubKey, out var value) && value is string sub
            ? sub
            : throw new InvalidOperationException(
                "GoogleSub was not set on FunctionContext.Items -- GoogleAuthMiddleware did not run before this handler.");
}
