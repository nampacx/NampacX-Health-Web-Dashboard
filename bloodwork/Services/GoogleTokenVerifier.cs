using System.Text.Json;
using System.Text.Json.Serialization;
using Bloodwork.Models.Exceptions;

namespace Bloodwork.Services;

/// <summary>
/// Verifies the Google OAuth access token the SPA already holds (from the
/// existing implicit-flow sign-in -- see src/auth/google/googleAuth.ts) by
/// calling Google's tokeninfo endpoint and checking the audience. This is a
/// plain outbound HTTPS call, not local JWT signature verification -- the
/// token itself is an opaque access token, not a JWT.
/// </summary>
public sealed class GoogleTokenVerifier(HttpClient httpClient, BloodworkOptions options)
{
    /// <summary>
    /// Returns the verified caller's Google subject id (<c>sub</c>) so callers
    /// can scope stored data to it. Documented tokeninfo responses show
    /// <c>sub</c> present on access tokens without an <c>openid</c> scope, and
    /// this app never requests one -- confirm that holds against a real
    /// response (log the token's own <c>sub</c> once, not the raw body -- see
    /// the no-raw-logging note below) before trusting this in production; if
    /// it's ever absent, that must fail closed (see the throw below), never
    /// silently scope data to an empty string.
    /// </summary>
    public async Task<string> VerifyAsync(string accessToken, CancellationToken cancellationToken = default)
    {
        HttpResponseMessage response;
        try
        {
            response = await httpClient.GetAsync(
                $"https://oauth2.googleapis.com/tokeninfo?access_token={Uri.EscapeDataString(accessToken)}",
                cancellationToken);
        }
        catch (HttpRequestException)
        {
            // Never the caller's fault -- Google itself is unreachable.
            throw new UpstreamAuthException("Could not reach Google to verify the access token.");
        }

        if (!response.IsSuccessStatusCode)
        {
            throw new UnauthorizedException("Google rejected the access token.");
        }

        // Never log the raw response -- it can carry the caller's Google account details.
        var raw = await response.Content.ReadAsStringAsync(cancellationToken);
        var body = JsonSerializer.Deserialize<TokenInfoResponse>(raw)
            ?? throw new UnauthorizedException("Google returned an empty tokeninfo response.");

        if (body.Error is not null)
        {
            throw new UnauthorizedException($"Google token invalid: {body.ErrorDescription ?? body.Error}");
        }

        if (!string.Equals(body.Aud, options.GoogleClientId, StringComparison.Ordinal))
        {
            throw new UnauthorizedException("Access token was issued for a different client.");
        }

        // Fail closed rather than falling back to an empty/shared owner id --
        // that would silently pool every such caller's rows into one bucket.
        if (string.IsNullOrEmpty(body.Sub))
        {
            throw new UnauthorizedException("Google tokeninfo response did not include a subject id.");
        }

        return body.Sub;
    }

    private sealed class TokenInfoResponse
    {
        [JsonPropertyName("aud")]
        public string? Aud { get; set; }

        [JsonPropertyName("sub")]
        public string? Sub { get; set; }

        [JsonPropertyName("error")]
        public string? Error { get; set; }

        [JsonPropertyName("error_description")]
        public string? ErrorDescription { get; set; }
    }
}
