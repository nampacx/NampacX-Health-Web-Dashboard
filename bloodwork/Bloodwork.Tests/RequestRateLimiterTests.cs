using Bloodwork.Services;
using Xunit;

namespace Bloodwork.Tests;

public class RequestRateLimiterTests
{
    private static BloodworkOptions Options(int requests, int windowSeconds) => new()
    {
        GoogleClientId = "client-id",
        AllowedOrigins = ["http://localhost:5173"],
        StorageConnectionString = "UseDevelopmentStorage=true",
        DocumentIntelligenceEndpoint = "https://example.cognitiveservices.azure.com",
        MaxUploadBytes = BloodworkOptions.DefaultMaxUploadBytes,
        RateLimitRequests = requests,
        RateLimitWindow = TimeSpan.FromSeconds(windowSeconds),
        MaxResultRows = BloodworkOptions.DefaultMaxResultRows,
    };

    [Fact]
    public void TryAcquire_AllowsUpToTheLimitThenRefuses()
    {
        var limiter = new RequestRateLimiter(Options(3, 60), new FakeTimeProvider());

        Assert.True(limiter.TryAcquire("1.2.3.4", out _));
        Assert.True(limiter.TryAcquire("1.2.3.4", out _));
        Assert.True(limiter.TryAcquire("1.2.3.4", out _));
        Assert.False(limiter.TryAcquire("1.2.3.4", out var retryAfter));
        Assert.True(retryAfter > TimeSpan.Zero);
    }

    [Fact]
    public void TryAcquire_CountsEachClientSeparately()
    {
        var limiter = new RequestRateLimiter(Options(1, 60), new FakeTimeProvider());

        Assert.True(limiter.TryAcquire("1.2.3.4", out _));
        // One caller exhausting its allowance must not lock everyone else out --
        // that would turn the limiter into the denial of service it prevents.
        Assert.True(limiter.TryAcquire("5.6.7.8", out _));
        Assert.False(limiter.TryAcquire("1.2.3.4", out _));
    }

    [Fact]
    public void TryAcquire_AllowsAgainOnceTheWindowHasPassed()
    {
        var time = new FakeTimeProvider();
        var limiter = new RequestRateLimiter(Options(1, 60), time);

        Assert.True(limiter.TryAcquire("1.2.3.4", out _));
        Assert.False(limiter.TryAcquire("1.2.3.4", out _));

        time.Advance(TimeSpan.FromSeconds(60));

        Assert.True(limiter.TryAcquire("1.2.3.4", out _));
    }

    [Fact]
    public void TryAcquire_RetryAfterShrinksAsTheWindowRunsDown()
    {
        var time = new FakeTimeProvider();
        var limiter = new RequestRateLimiter(Options(1, 60), time);

        Assert.True(limiter.TryAcquire("1.2.3.4", out _));
        Assert.False(limiter.TryAcquire("1.2.3.4", out var immediately));

        time.Advance(TimeSpan.FromSeconds(45));
        Assert.False(limiter.TryAcquire("1.2.3.4", out var later));

        Assert.True(later < immediately);
        Assert.True(later <= TimeSpan.FromSeconds(15));
    }

    [Fact]
    public void ClientKeyFrom_TakesTheLastForwardedForEntry()
    {
        // App Service APPENDS the address it observed to whatever the caller
        // sent, so the last entry is the platform's own observation and every
        // entry before it is caller-controlled text. Reading the first would let
        // anyone spend somebody else's allowance, or dodge their own, by sending
        // a header.
        var key = RequestRateLimiter.ClientKeyFrom("203.0.113.9, 198.51.100.4:41234", "10.0.0.1");

        Assert.Equal("198.51.100.4", key);
    }

    [Fact]
    public void ClientKeyFrom_ForgedHeaderCannotSplitOneClientIntoMany()
    {
        var forged = RequestRateLimiter.ClientKeyFrom("attacker-chosen-1, 198.51.100.4:1", "10.0.0.1");
        var forgedAgain = RequestRateLimiter.ClientKeyFrom("attacker-chosen-2, 198.51.100.4:2", "10.0.0.1");

        Assert.Equal(forged, forgedAgain);
    }

    [Theory]
    // Bracketed IPv6 keeps its brackets and loses its port.
    [InlineData("[2001:db8::1]:443", "[2001:db8::1]")]
    // A bare IPv6 address is full of colons and must not be cut at one of them.
    [InlineData("2001:db8::1", "2001:db8::1")]
    [InlineData("198.51.100.4", "198.51.100.4")]
    public void ClientKeyFrom_StripsPortsWithoutMangingAddresses(string forwardedFor, string expected)
    {
        Assert.Equal(expected, RequestRateLimiter.ClientKeyFrom(forwardedFor, null));
    }

    [Fact]
    public void ClientKeyFrom_NoHeader_FallsBackToTheConnectionAddress()
    {
        Assert.Equal("10.0.0.1", RequestRateLimiter.ClientKeyFrom(null, "10.0.0.1"));
    }

    [Fact]
    public void ClientKeyFrom_NothingAtAll_SharesOneBucketRatherThanEscaping()
    {
        // Unattributable traffic is still counted; it just shares a bucket. The
        // alternative -- a null key that skips the limit -- would be a documented
        // way around it.
        Assert.Equal("unknown", RequestRateLimiter.ClientKeyFrom(null, null));
    }
}
