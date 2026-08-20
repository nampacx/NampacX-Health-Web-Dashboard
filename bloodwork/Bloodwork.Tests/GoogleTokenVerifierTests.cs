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
    };

    private static GoogleTokenVerifier BuildVerifier(HttpStatusCode status, string body, BloodworkOptions? options = null)
    {
        var handler = new StubHttpMessageHandler(status, body);
        var httpClient = new HttpClient(handler);
        return new GoogleTokenVerifier(httpClient, options ?? Options());
    }

    private static GoogleTokenVerifier BuildVerifierThatThrows(BloodworkOptions? options = null)
    {
        var handler = new ThrowingHttpMessageHandler();
        var httpClient = new HttpClient(handler);
        return new GoogleTokenVerifier(httpClient, options ?? Options());
    }

    [Fact]
    public async Task VerifyAsync_MatchingAudience_ReturnsSubject()
    {
        var verifier = BuildVerifier(HttpStatusCode.OK, """{"aud":"expected-client-id","sub":"10769150350006150715113082367","expires_in":"3599"}""");

        var caller = await verifier.VerifyAsync("some-token");

        Assert.Equal("10769150350006150715113082367", caller.Sub);
    }

    [Fact]
    public async Task VerifyAsync_EmailScopeGranted_ReturnsEmailAlongsideSubject()
    {
        var verifier = BuildVerifier(HttpStatusCode.OK, """{"aud":"expected-client-id","sub":"10769150350006150715113082367","email":"someone@example.com","email_verified":"true"}""");

        var caller = await verifier.VerifyAsync("some-token");

        // Display-only, so whoever approves a bloodworkUsers row can tell whose
        // account it is. Authorization is on Sub and only ever on Sub.
        Assert.Equal("someone@example.com", caller.Email);
    }

    [Fact]
    public async Task VerifyAsync_NoEmailScope_ReturnsNullEmailWithoutFailing()
    {
        var verifier = BuildVerifier(HttpStatusCode.OK, """{"aud":"expected-client-id","sub":"10769150350006150715113082367"}""");

        var caller = await verifier.VerifyAsync("some-token");

        // A token with no email scope is a valid token. Nothing authorizes on
        // the address, so there is nothing here to fail closed about.
        Assert.Null(caller.Email);
        Assert.Equal("10769150350006150715113082367", caller.Sub);
    }

    [Fact]
    public async Task VerifyAsync_WrongAudience_ThrowsUnauthorized()
    {
        var verifier = BuildVerifier(HttpStatusCode.OK, """{"aud":"someone-elses-client-id","sub":"10769150350006150715113082367"}""");

        await Assert.ThrowsAsync<UnauthorizedException>(() => verifier.VerifyAsync("some-token"));
    }

    [Fact]
    public async Task VerifyAsync_MissingSubject_ThrowsUnauthorized()
    {
        var verifier = BuildVerifier(HttpStatusCode.OK, """{"aud":"expected-client-id","expires_in":"3599"}""");

        await Assert.ThrowsAsync<UnauthorizedException>(() => verifier.VerifyAsync("some-token"));
    }

    [Fact]
    public async Task VerifyAsync_TokeninfoErrorBody_ThrowsUnauthorized()
    {
        var verifier = BuildVerifier(HttpStatusCode.OK, """{"error":"invalid_token","error_description":"Invalid Value"}""");

        var ex = await Assert.ThrowsAsync<UnauthorizedException>(() => verifier.VerifyAsync("bad-token"));
        Assert.Contains("Invalid Value", ex.Message);
    }

    [Fact]
    public async Task VerifyAsync_NonSuccessStatus_ThrowsUnauthorized()
    {
        var verifier = BuildVerifier(HttpStatusCode.BadRequest, """{"error":"invalid_token"}""");

        await Assert.ThrowsAsync<UnauthorizedException>(() => verifier.VerifyAsync("bad-token"));
    }

    [Fact]
    public async Task VerifyAsync_NetworkFailure_ThrowsUpstreamAuth_NotUnauthorized()
    {
        var verifier = BuildVerifierThatThrows();

        // Google being unreachable is never the caller's fault -- must not
        // collapse into the same 401 a bad token gets.
        await Assert.ThrowsAsync<UpstreamAuthException>(() => verifier.VerifyAsync("some-token"));
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

    private sealed class ThrowingHttpMessageHandler : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            throw new HttpRequestException("simulated network failure");
        }
    }
}
