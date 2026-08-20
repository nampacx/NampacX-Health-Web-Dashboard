using Bloodwork.Services;
using Xunit;

namespace Bloodwork.Tests;

public class TokenVerificationCacheTests
{
    private const string Token = "ya29.a0ARrdaM-not-a-real-token-0123456789";

    [Fact]
    public void Get_AfterSet_ReturnsTheSameCaller()
    {
        var cache = new TokenVerificationCache(new FakeTimeProvider());
        cache.Set(Token, new VerifiedCaller("sub-1", "someone@example.com"), TimeSpan.FromHours(1));

        var cached = cache.Get(Token);

        Assert.Equal("sub-1", cached!.Sub);
        Assert.Equal("someone@example.com", cached.Email);
    }

    [Fact]
    public void Get_DifferentToken_IsAMiss()
    {
        var cache = new TokenVerificationCache(new FakeTimeProvider());
        cache.Set(Token, new VerifiedCaller("sub-1", null), TimeSpan.FromHours(1));

        Assert.Null(cache.Get(Token + "-different"));
    }

    [Fact]
    public void Get_PastTheCeiling_IsAMissEvenWhileTheTokenItselfLives()
    {
        var time = new FakeTimeProvider();
        var cache = new TokenVerificationCache(time);
        // A token with an hour left on it is still only trusted for a minute
        // without re-asking Google. That ceiling is what bounds how long a
        // revoked token keeps working.
        cache.Set(Token, new VerifiedCaller("sub-1", null), TimeSpan.FromHours(1));

        time.Advance(TokenVerificationCache.MaxLifetime - TimeSpan.FromSeconds(1));
        Assert.NotNull(cache.Get(Token));

        time.Advance(TimeSpan.FromSeconds(1));
        Assert.Null(cache.Get(Token));
    }

    [Fact]
    public void Get_PastTheTokensOwnExpiry_IsAMissBeforeTheCeiling()
    {
        var time = new FakeTimeProvider();
        var cache = new TokenVerificationCache(time);
        // The shorter of the two wins: caching a token for longer than it lives
        // would keep accepting one that Google has already stopped honouring.
        cache.Set(Token, new VerifiedCaller("sub-1", null), TimeSpan.FromSeconds(10));

        time.Advance(TimeSpan.FromSeconds(10));

        Assert.Null(cache.Get(Token));
    }

    [Fact]
    public void Set_TokenWithNoLifeLeft_IsNotCachedAtAll()
    {
        var cache = new TokenVerificationCache(new FakeTimeProvider());

        cache.Set(Token, new VerifiedCaller("sub-1", null), TimeSpan.Zero);

        Assert.Null(cache.Get(Token));
    }

    [Fact]
    public void Set_UnknownLifetime_FallsBackToTheCeilingRatherThanForever()
    {
        var time = new FakeTimeProvider();
        var cache = new TokenVerificationCache(time);
        // tokeninfo's expires_in is absent or unparseable. "No expiry given"
        // must not read as "never expires".
        cache.Set(Token, new VerifiedCaller("sub-1", null), null);

        time.Advance(TokenVerificationCache.MaxLifetime);

        Assert.Null(cache.Get(Token));
    }
}
