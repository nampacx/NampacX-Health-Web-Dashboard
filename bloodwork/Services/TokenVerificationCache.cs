using System.Collections.Concurrent;
using System.Security.Cryptography;

namespace Bloodwork.Services;

/// <summary>
/// Short-lived memory of tokens Google has already vouched for, so a burst of
/// requests carrying one token costs one call to tokeninfo rather than one per
/// request. The SPA polls a running upload every 3 seconds for up to 80
/// attempts, and reloads results on top of that, so this is the ordinary case
/// rather than an adversarial one.
///
/// Registered as a singleton on purpose: <see cref="GoogleTokenVerifier"/> is a
/// typed <c>HttpClient</c> and therefore transient, so a cache held on the
/// verifier itself would be discarded after every single request and never hit.
///
/// <b>The raw token is never stored, or used as a key.</b> Entries are keyed by
/// its SHA-256, so a memory dump of this process yields a set of hashes rather
/// than a set of live Google credentials. Only successful verifications are
/// cached -- a rejection must stay cheap to change its mind about, since a token
/// can be revoked but never un-revoked.
/// </summary>
public sealed class TokenVerificationCache(TimeProvider? timeProvider = null)
{
    private readonly TimeProvider clock = timeProvider ?? TimeProvider.System;
    private readonly ConcurrentDictionary<string, Entry> entries = new(StringComparer.Ordinal);

    /// <summary>
    /// The longest a verification is trusted without re-asking Google, whatever
    /// the token's own remaining lifetime. A token revoked mid-session stays
    /// usable for at most this long, which is the price of not calling Google on
    /// every request; a minute is short enough that revocation is still prompt
    /// and long enough to collapse a poll loop into a handful of calls.
    /// </summary>
    public static readonly TimeSpan MaxLifetime = TimeSpan.FromSeconds(60);

    /// <summary>Bounds the dictionary against a caller cycling through tokens.</summary>
    private const int MaxEntries = 10_000;

    public VerifiedCaller? Get(string accessToken)
    {
        var key = KeyFor(accessToken);
        if (!entries.TryGetValue(key, out var entry))
        {
            return null;
        }
        if (clock.GetUtcNow() >= entry.ExpiresAt)
        {
            entries.TryRemove(key, out _);
            return null;
        }
        return entry.Caller;
    }

    /// <summary>
    /// Caches a verified caller for <c>min(MaxLifetime, remaining token lifetime)</c>.
    /// A token whose own lifetime has already run out is not cached at all --
    /// there is nothing left to save a call on.
    /// </summary>
    public void Set(string accessToken, VerifiedCaller caller, TimeSpan? remainingTokenLifetime)
    {
        var lifetime = remainingTokenLifetime is { } remaining && remaining < MaxLifetime
            ? remaining
            : MaxLifetime;
        if (lifetime <= TimeSpan.Zero)
        {
            return;
        }

        var now = clock.GetUtcNow();
        if (entries.Count >= MaxEntries)
        {
            Sweep(now);
        }
        entries[KeyFor(accessToken)] = new Entry(caller, now + lifetime);
    }

    private void Sweep(DateTimeOffset now)
    {
        foreach (var (key, entry) in entries)
        {
            if (now >= entry.ExpiresAt)
            {
                ((System.Collections.Generic.ICollection<KeyValuePair<string, Entry>>)entries)
                    .Remove(new KeyValuePair<string, Entry>(key, entry));
            }
        }
    }

    private static string KeyFor(string accessToken) =>
        Convert.ToHexStringLower(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(accessToken)));

    private sealed record Entry(VerifiedCaller Caller, DateTimeOffset ExpiresAt);
}
