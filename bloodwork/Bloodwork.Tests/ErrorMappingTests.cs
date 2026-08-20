using System.Text.Json;
using Bloodwork.Middleware;
using Bloodwork.Models.Exceptions;
using Xunit;

namespace Bloodwork.Tests;

public class ErrorMappingTests
{
    [Theory]
    [InlineData(typeof(BadRequestException), 400, "bad_request")]
    [InlineData(typeof(UnauthorizedException), 401, "unauthorized")]
    [InlineData(typeof(ForbiddenException), 403, "forbidden")]
    [InlineData(typeof(NotFoundException), 404, "not_found")]
    [InlineData(typeof(PayloadTooLargeException), 413, "payload_too_large")]
    [InlineData(typeof(UnsupportedMediaTypeException), 415, "unsupported_media_type")]
    [InlineData(typeof(TooManyRequestsException), 429, "too_many_requests")]
    [InlineData(typeof(UpstreamAuthException), 502, "upstream_auth")]
    public void Map_KnownExceptionTypes_ReturnsDocumentedStatusAndErrorCode(Type exceptionType, int expectedStatus, string expectedError)
    {
        var exception = (Exception)Activator.CreateInstance(exceptionType, "boom")!;

        var (status, body) = ErrorMapper.Map(exception);

        Assert.Equal(expectedStatus, status);
        var json = JsonSerializer.Serialize(body);
        using var doc = JsonDocument.Parse(json);
        Assert.Equal(expectedError, doc.RootElement.GetProperty("error").GetString());
        Assert.Equal("boom", doc.RootElement.GetProperty("message").GetString());
    }

    [Fact]
    public void Map_Forbidden_IsDistinctFrom401()
    {
        // The SPA's stored Google token is still good when this fires -- an
        // unapproved account re-signing-in gets the same answer. Collapsing
        // this into 401 would send the user round the sign-in loop forever.
        var (forbidden, _) = ErrorMapper.Map(new ForbiddenException("not approved"));
        var (unauthorized, _) = ErrorMapper.Map(new UnauthorizedException("bad token"));

        Assert.Equal(403, forbidden);
        Assert.Equal(401, unauthorized);
    }

    [Fact]
    public void Map_Configuration_Returns500WithoutEchoingTheMessage()
    {
        // Not in the theory above, which asserts every other type round-trips its
        // own message: a ConfigurationException's message names the configuration
        // key that is missing or malformed, and that is internal detail about this
        // deployment rather than anything a caller can act on.
        //
        // In practice BloodworkOptions.Load runs once at host startup, so an
        // invalid config fails the app to start and this mapping cannot fire
        // mid-request today. It is pinned because the mapping is there waiting for
        // the first configuration value that is read lazily.
        var (status, body) = ErrorMapper.Map(new ConfigurationException("Missing required configuration value 'GOOGLE_CLIENT_ID'."));

        Assert.Equal(500, status);
        var json = JsonSerializer.Serialize(body);
        using var doc = JsonDocument.Parse(json);
        Assert.Equal("misconfigured", doc.RootElement.GetProperty("error").GetString());
        Assert.Equal("The service is misconfigured.", doc.RootElement.GetProperty("message").GetString());
        Assert.DoesNotContain("GOOGLE_CLIENT_ID", json);
    }

    [Fact]
    public void Map_TooManyRequests_IsDistinctFrom403()
    {
        // Both mean "no", and the SPA has to tell them apart: 403 is permanent
        // until a human approves the account, 429 clears on its own.
        var (throttled, _) = ErrorMapper.Map(new TooManyRequestsException("slow down"));
        var (forbidden, _) = ErrorMapper.Map(new ForbiddenException("not approved"));

        Assert.Equal(429, throttled);
        Assert.Equal(403, forbidden);
    }

    [Fact]
    public void Map_UnknownException_Returns500Internal()
    {
        var (status, body) = ErrorMapper.Map(new InvalidOperationException("something else"));

        Assert.Equal(500, status);
        var json = JsonSerializer.Serialize(body);
        using var doc = JsonDocument.Parse(json);
        Assert.Equal("internal", doc.RootElement.GetProperty("error").GetString());
        // The generic path never leaks the raw exception message to the caller.
        Assert.Equal("Unexpected error.", doc.RootElement.GetProperty("message").GetString());
    }

    [Fact]
    public void Map_ParseException_ReturnsInternalNotItsOwnStatus()
    {
        // ParseException is pipeline-internal (only ever handled inside
        // ProcessDocumentFunction's own catch block) -- it must never reach
        // an HTTP caller, so ErrorMapper deliberately has no case for it and
        // it falls through to the generic 500.
        var (status, body) = ErrorMapper.Map(new ParseException("no_analyte_rows", "nothing survived"));

        Assert.Equal(500, status);
        var json = JsonSerializer.Serialize(body);
        using var doc = JsonDocument.Parse(json);
        Assert.Equal("internal", doc.RootElement.GetProperty("error").GetString());
    }
}
