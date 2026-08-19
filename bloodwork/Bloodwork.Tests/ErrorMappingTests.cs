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
    [InlineData(typeof(NotFoundException), 404, "not_found")]
    [InlineData(typeof(PayloadTooLargeException), 413, "payload_too_large")]
    [InlineData(typeof(UnsupportedMediaTypeException), 415, "unsupported_media_type")]
    [InlineData(typeof(ConfigurationException), 500, "misconfigured")]
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
