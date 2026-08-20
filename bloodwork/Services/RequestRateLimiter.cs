using System.Collections.Concurrent;

namespace Bloodwork.Services;

/// <summary>
/// A fixed-window per-client request limiter, applied in
/// <see cref="Bloodwork.Middleware.GoogleAuthMiddleware"/> <i>before</i> the
/// caller is authenticated.
///
/// Order is the whole point. Every route is <c>AuthorizationLevel.Anonymous</c>
/// behind a URL that is public by design, and authenticating one request costs
/// an outbound call to Google's tokeninfo endpoint. Without a limit in front of
/// that, anyone on the internet can send <c>Authorization: Bearer &lt;anything&gt;</c>
/// as fast as they like and make this app call Google on their behalf -- an
/// amplifier pointed at both Google (which answers by rate-limiting this app's
/// egress IP, breaking sign-in for real users) and at a per-execution-billed
/// Flex Consumption plan.
///
/// In-process, so the limit is per instance rather than per app: with
/// <c>maximumInstanceCount: 40</c> the effective ceiling is up to 40x what is
/// configured. That is deliberate -- a shared counter would mean a round-trip to
/// storage per request, which is the very cost this exists to avoid. It bounds
/// the damage; an edge limiter (Front Door or APIM) is what would bound it
/// exactly, and this does not pretend to replace one.
/// </summary>
public sealed class RequestRateLimiter(BloodworkOptions options, TimeProvider? timeProvider = null)
{
    private readonly TimeProvider clock = timeProvider ?? TimeProvider.System;
    private readonly ConcurrentDictionary<string, Window> windows = new(StringComparer.Ordinal);

    /// <summary>
    /// Bounds the dictionary itself. Each distinct client key costs an entry, and
    /// the key is derived from a caller-influenced header, so an attacker rotating
    /// source addresses would otherwise grow this without limit -- the limiter
    /// would become the memory-exhaustion primitive it exists to prevent. Stale
    /// windows are swept when this is crossed.
    /// </summary>
    private const int MaxTrackedClients = 10_000;

    /// <summary>
    /// True when the request may proceed. On false, <paramref name="retryAfter"/>
    /// is how long is left of the current window.
    /// </summary>
    public bool TryAcquire(string clientKey, out TimeSpan retryAfter)
    {
        var now = clock.GetUtcNow();

        if (windows.Count > MaxTrackedClients)
        {
            Sweep(now);
        }

        // TryGetValue then TryAdd, deliberately not GetOrAdd: GetOrAdd cannot say
        // whether it inserted or found, so the freshly inserted window would fall
        // through to the increment below and the very first request of a window
        // would spend two of the allowance.
        //
        // Every mutation is a compare-and-swap against the exact instance that was
        // read, and Window is immutable, so a lost race is retried rather than
        // silently overwriting a count another thread had just raised. The loop
        // only ever repeats when a competing writer won, and that writer made
        // progress, so it terminates.
        while (true)
        {
            if (windows.TryGetValue(clientKey, out var existing))
            {
                // A window that has run out is replaced wholesale rather than
                // reset in place, for the same compare-and-swap reason.
                if (now - existing.StartedAt >= options.RateLimitWindow)
                {
                    if (windows.TryUpdate(clientKey, new Window(now, 1), existing))
                    {
                        retryAfter = TimeSpan.Zero;
                        return true;
                    }
                    continue;
                }

                if (existing.Count >= options.RateLimitRequests)
                {
                    retryAfter = options.RateLimitWindow - (now - existing.StartedAt);
                    if (retryAfter < TimeSpan.Zero) retryAfter = TimeSpan.Zero;
                    return false;
                }

                if (windows.TryUpdate(clientKey, existing with { Count = existing.Count + 1 }, existing))
                {
                    retryAfter = TimeSpan.Zero;
                    return true;
                }
                continue;
            }

            if (windows.TryAdd(clientKey, new Window(now, 1)))
            {
                retryAfter = TimeSpan.Zero;
                return true;
            }
        }
    }

    private void Sweep(DateTimeOffset now)
    {
        foreach (var (key, window) in windows)
        {
            if (now - window.StartedAt >= options.RateLimitWindow)
            {
                // TryRemove(KeyValuePair) so a window that was replaced between the
                // read above and this call is not thrown away along with its count.
                ((System.Collections.Generic.ICollection<KeyValuePair<string, Window>>)windows)
                    .Remove(new KeyValuePair<string, Window>(key, window));
            }
        }
    }

    /// <summary>
    /// The address to count against, from the request as App Service presents it.
    ///
    /// <b>The last <c>X-Forwarded-For</c> entry, not the first.</b> The usual
    /// "first entry is the client" rule is for proxies that prepend; App Service
    /// <i>appends</i> the address it actually observed to whatever the caller
    /// sent, so the first entry here is caller-controlled text and the last is the
    /// platform's own observation. Reading the first would let anyone spend
    /// somebody else's allowance -- or dodge their own -- by sending a header.
    ///
    /// <c>RemoteIpAddress</c> is the fallback for local <c>func start</c>, where
    /// nothing sets the header. A request with neither is counted under a single
    /// shared key rather than waved through: unattributable traffic should share
    /// one bucket, not escape the limit.
    /// </summary>
    public static string ClientKeyFrom(string? forwardedFor, string? remoteAddress)
    {
        if (!string.IsNullOrWhiteSpace(forwardedFor))
        {
            var entries = forwardedFor.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
            if (entries.Length > 0)
            {
                return StripPort(entries[^1]);
            }
        }
        return string.IsNullOrWhiteSpace(remoteAddress) ? "unknown" : remoteAddress;
    }

    /// <summary>
    /// App Service's entries carry a port ("1.2.3.4:5678"). A bracketed IPv6
    /// address ends at the bracket; a bare one is full of colons and is left
    /// alone, since stripping at the last colon would mangle it.
    /// </summary>
    private static string StripPort(string entry)
    {
        var bracket = entry.LastIndexOf(']');
        if (bracket >= 0)
        {
            return entry[..(bracket + 1)];
        }
        var firstColon = entry.IndexOf(':');
        return firstColon >= 0 && firstColon == entry.LastIndexOf(':') ? entry[..firstColon] : entry;
    }

    private sealed record Window(DateTimeOffset StartedAt, int Count);
}
