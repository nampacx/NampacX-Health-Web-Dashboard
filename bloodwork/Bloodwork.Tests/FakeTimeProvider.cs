namespace Bloodwork.Tests;

/// <summary>
/// A clock the tests move by hand. Hand-rolled rather than pulled in from
/// Microsoft.Extensions.TimeProvider.Testing: two members is less than a package
/// reference is worth, and both things under test here (a fixed window and a
/// cache lifetime) need nothing but "what time is it" and "make it later".
///
/// Real time would mean either sleeping for a window or asserting on inequalities
/// loose enough to pass whatever happened -- and a rate limiter that is only
/// tested loosely is one whose off-by-one lets an extra request through.
/// </summary>
internal sealed class FakeTimeProvider(DateTimeOffset? start = null) : TimeProvider
{
    private DateTimeOffset now = start ?? new DateTimeOffset(2026, 8, 20, 12, 0, 0, TimeSpan.Zero);

    public override DateTimeOffset GetUtcNow() => now;

    public void Advance(TimeSpan by) => now += by;
}
