namespace Bloodwork.Services;

/// <summary>
/// Holds the caller's verified Google subject id for the lifetime of one
/// function invocation. Registered scoped (Program.cs); the isolated worker
/// gives middleware and the function handler it wraps the same DI scope per
/// invocation, so GoogleAuthMiddleware can set this once and every
/// HTTP-triggered function downstream reads the same instance instead of
/// re-deriving identity from the request.
/// </summary>
public sealed class CallerContext
{
    public string? GoogleSub { get; set; }

    public string RequireGoogleSub() =>
        GoogleSub ?? throw new InvalidOperationException(
            "CallerContext.GoogleSub was not set -- GoogleAuthMiddleware did not run before this handler.");
}
