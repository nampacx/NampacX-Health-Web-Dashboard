using System.Net;
using Bloodwork.Models.Exceptions;
using Bloodwork.Services;
using Xunit;

namespace Bloodwork.Tests;

public class GoogleTokenVerifierTests
{
    private static BloodworkOptions Options(string googleClientId = "expected-client-id") => new()
    {
        GoogleClientId = googleClientId,
        AllowedOrigins = ["http://localhost:5173"],
        StorageConnectionString = "UseDevelopmentStorage=true",
        DocumentIntelligenceEndpoint = "https://example.cognitiveservices.azure.com",
        MaxUploadBytes = BloodworkOptions.DefaultMaxUploadBytes,
        RateLimitRequests = BloodworkOptions.DefaultRateLimitRequests,
        RateLimitWindow = TimeSpan.FromSeconds(BloodworkOptions.DefaultRateLimitWindowSeconds),
        MaxResultRows = BloodworkOptions.DefaultMaxResultRows,
    };

    private static GoogleTokenVerifier BuildVerifier(HttpStatusCode status, string body, BloodworkOptions? options = null, TokenVerificationCache? cache = null)
    {
        var handler = new StubHttpMessageHandler(status, body);
        var httpClient = new HttpClient(handler);
        return new GoogleTokenVerifier(httpClient, options ?? Options(), cache ?? new TokenVerificationCache());
    }

    private static GoogleTokenVerifier BuildVerifierThatThrows(BloodworkOptions? options = null)
    {
        var handler = new ThrowingHttpMessageHandler();
        var httpClient = new HttpClient(handler);
        return new GoogleTokenVerifier(httpClient, options ?? Options(), new TokenVerificationCache());
    }

    /// <summary>
    /// Long enough and plain enough to get past the structural pre-check, so a
    /// test that means to exercise the tokeninfo call is not accidentally
    /// answered before the call happens.
    /// </summary>
    private const string PlausibleToken = "ya29.a0ARrdaM-not-a-real-token-0123456789";

    [Fact]
    public async Task VerifyAsync_MatchingAudience_ReturnsSubject()
    {
        var verifier = BuildVerifier(HttpStatusCode.OK, """{"aud":"expected-client-id","sub":"10769150350006150715113082367","expires_in":"3599"}""");

        var caller = await verifier.VerifyAsync(PlausibleToken);

        Assert.Equal("10769150350006150715113082367", caller.Sub);
    }

    [Fact]
    public async Task VerifyAsync_EmailScopeGranted_ReturnsEmailAlongsideSubject()
    {
        var verifier = BuildVerifier(HttpStatusCode.OK, """{"aud":"expected-client-id","sub":"10769150350006150715113082367","email":"someone@example.com","email_verified":"true"}""");

        var caller = await verifier.VerifyAsync(PlausibleToken);

        // Display-only, so whoever approves a bloodworkUsers row can tell whose
        // account it is. Authorization is on Sub and only ever on Sub.
        Assert.Equal("someone@example.com", caller.Email);
    }

    [Fact]
    public async Task VerifyAsync_NoEmailScope_ReturnsNullEmailWithoutFailing()
    {
        var verifier = BuildVerifier(HttpStatusCode.OK, """{"aud":"expected-client-id","sub":"10769150350006150715113082367"}""");

        var caller = await verifier.VerifyAsync(PlausibleToken);

        // A token with no email scope is a valid token. Nothing authorizes on
        // the address, so there is nothing here to fail closed about.
        Assert.Null(caller.Email);
        Assert.Equal("10769150350006150715113082367", caller.Sub);
    }

    [Fact]
    public async Task VerifyAsync_WrongAudience_ThrowsUnauthorized()
    {
        var verifier = BuildVerifier(HttpStatusCode.OK, """{"aud":"someone-elses-client-id","sub":"10769150350006150715113082367"}""");

        await Assert.ThrowsAsync<UnauthorizedException>(() => verifier.VerifyAsync(PlausibleToken));
    }

    [Fact]
    public async Task VerifyAsync_MissingSubject_ThrowsUnauthorized()
    {
        var verifier = BuildVerifier(HttpStatusCode.OK, """{"aud":"expected-client-id","expires_in":"3599"}""");

        await Assert.ThrowsAsync<UnauthorizedException>(() => verifier.VerifyAsync(PlausibleToken));
    }

    [Fact]
    public async Task VerifyAsync_TokeninfoErrorBody_ThrowsUnauthorized()
    {
        var verifier = BuildVerifier(HttpStatusCode.OK, """{"error":"invalid_token","error_description":"Invalid Value"}""");

        var ex = await Assert.ThrowsAsync<UnauthorizedException>(() => verifier.VerifyAsync(PlausibleToken));
        Assert.Contains("Invalid Value", ex.Message);
    }

    [Fact]
    public async Task VerifyAsync_NonSuccessStatus_ThrowsUnauthorized()
    {
        var verifier = BuildVerifier(HttpStatusCode.BadRequest, """{"error":"invalid_token"}""");

        await Assert.ThrowsAsync<UnauthorizedException>(() => verifier.VerifyAsync(PlausibleToken));
    }

    [Fact]
    public async Task VerifyAsync_NetworkFailure_ThrowsUpstreamAuth_NotUnauthorized()
    {
        var verifier = BuildVerifierThatThrows();

        // Google being unreachable is never the caller's fault -- must not
        // collapse into the same 401 a bad token gets.
        await Assert.ThrowsAsync<UpstreamAuthException>(() => verifier.VerifyAsync(PlausibleToken));
    }

    [Theory]
    [InlineData("")]
    [InlineData("short")]
    // A space cannot appear in a Google access token, and neither can any of the
    // characters an injection attempt would need.
    [InlineData("ya29.token with a space in it padded out to length")]
    [InlineData("ya29.<script>alert(1)</script>padding-padding-padding")]
    public async Task VerifyAsync_StructurallyImpossibleToken_ThrowsWithoutCallingGoogle(string token)
    {
        var handler = new CountingHttpMessageHandler(HttpStatusCode.OK, """{"aud":"expected-client-id","sub":"sub-1"}""");
        var verifier = new GoogleTokenVerifier(new HttpClient(handler), Options(), new TokenVerificationCache());

        await Assert.ThrowsAsync<UnauthorizedException>(() => verifier.VerifyAsync(token));

        // The point is the zero, not the throw. Every route is anonymous behind a
        // public URL, so anything that reaches tokeninfo is an outbound call an
        // unauthenticated stranger got this app to make.
        Assert.Equal(0, handler.Calls);
    }

    [Fact]
    public async Task VerifyAsync_OverlongToken_ThrowsWithoutCallingGoogle()
    {
        var handler = new CountingHttpMessageHandler(HttpStatusCode.OK, """{"aud":"expected-client-id","sub":"sub-1"}""");
        var verifier = new GoogleTokenVerifier(new HttpClient(handler), Options(), new TokenVerificationCache());

        await Assert.ThrowsAsync<UnauthorizedException>(() => verifier.VerifyAsync(new string('a', 4096)));

        Assert.Equal(0, handler.Calls);
    }

    [Fact]
    public async Task VerifyAsync_RepeatedWithTheSameToken_CallsGoogleOnce()
    {
        var handler = new CountingHttpMessageHandler(
            HttpStatusCode.OK, """{"aud":"expected-client-id","sub":"sub-1","expires_in":"3599"}""");
        var verifier = new GoogleTokenVerifier(new HttpClient(handler), Options(), new TokenVerificationCache());

        // The SPA polls a running upload every 3 seconds for up to 80 attempts
        // and reloads results on top of that; one upload used to be ~80 calls to
        // Google for one unchanging token.
        for (var i = 0; i < 5; i++)
        {
            Assert.Equal("sub-1", (await verifier.VerifyAsync(PlausibleToken)).Sub);
        }

        Assert.Equal(1, handler.Calls);
    }

    [Fact]
    public async Task VerifyAsync_RejectedToken_IsNotCached()
    {
        var handler = new CountingHttpMessageHandler(HttpStatusCode.OK, """{"error":"invalid_token"}""");
        var verifier = new GoogleTokenVerifier(new HttpClient(handler), Options(), new TokenVerificationCache());

        await Assert.ThrowsAsync<UnauthorizedException>(() => verifier.VerifyAsync(PlausibleToken));
        await Assert.ThrowsAsync<UnauthorizedException>(() => verifier.VerifyAsync(PlausibleToken));

        // A token can be revoked but never un-revoked, so caching a "no" would
        // only ever be wrong in the direction of locking someone out.
        Assert.Equal(2, handler.Calls);
    }

    [Fact]
    public async Task VerifyAsync_DistinctTokens_AreCachedSeparately()
    {
        var handler = new CountingHttpMessageHandler(
            HttpStatusCode.OK, """{"aud":"expected-client-id","sub":"sub-1","expires_in":"3599"}""");
        var verifier = new GoogleTokenVerifier(new HttpClient(handler), Options(), new TokenVerificationCache());

        await verifier.VerifyAsync(PlausibleToken);
        await verifier.VerifyAsync(PlausibleToken + "-other");

        Assert.Equal(2, handler.Calls);
    }

    private sealed class StubHttpMessageHandler(HttpStatusCode status, string body) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var response = new HttpResponseMessage(status)
            {
                Content = new StringContent(body),
            };
            return Task.FromResult(response);
        }
    }

    private sealed class CountingHttpMessageHandler(HttpStatusCode status, string body) : HttpMessageHandler
    {
        public int Calls { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Calls++;
            return Task.FromResult(new HttpResponseMessage(status) { Content = new StringContent(body) });
        }
    }

    private sealed class ThrowingHttpMessageHandler : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            throw new HttpRequestException("simulated network failure");
        }
    }
}
