using System.Text.Json;
using System.Text.Json.Serialization;
using Bloodwork.Models.Exceptions;

namespace Bloodwork.Services;

/// <summary>
/// A caller whose access token Google has confirmed was issued to this app's
/// OAuth client.
///
/// <c>Sub</c> is the only field anything authorizes on. It is Google's stable,
/// immutable per-account id, and it is what every job, every result row and every
/// approval row is keyed to.
///
/// <c>Email</c> is display-only, and best-effort -- absent when the token carries
/// no email scope. It exists solely so a human reading the <c>bloodworkUsers</c>
/// table can tell whose account a 21-digit subject id belongs to before approving
/// it. <b>Never authorize on it:</b> a Google account's email address can change,
/// and a Workspace address can be reassigned to a different person entirely.
/// </summary>
public sealed record VerifiedCaller(string Sub, string? Email);

/// <summary>
/// Verifies the Google OAuth access token the SPA already holds (from the
/// existing implicit-flow sign-in -- see src/auth/google/googleAuth.ts) by
/// calling Google's tokeninfo endpoint and checking the audience. This is a
/// plain outbound HTTPS call, not local JWT signature verification -- the
/// token itself is an opaque access token, not a JWT.
///
/// Verification answers "did this caller sign in through our OAuth client?" and
/// nothing more. Any Google account can answer yes, since the client id and the
/// Function App URL are both public by design, so it is <i>authentication only</i>
/// -- <see cref="UsersRepository"/> is what decides who is actually let in.
///
/// The token this receives is deliberately <b>not</b> the one the SPA uses
/// against health.googleapis.com. That token carries every
/// <c>googlehealth.*.readonly</c> scope the app requests, and handing it to this
/// service would mean a compromise here yielded the caller's entire Google Health
/// history, readable from anywhere for the rest of the token's life. The SPA mints
/// a second token scoped to <c>userinfo.email</c> alone and sends that one instead --
/// see <c>src/auth/google/googleAuth.ts</c>'s <c>IDENTITY_SCOPES</c>. Nothing here
/// enforces that (a token is opaque, and its scopes are the SPA's to choose), so
/// the constraint lives at the point where the token is requested; this comment
/// exists so a future change to the client does not quietly widen it back.
///
/// Two costs are managed here rather than paid per request. A structurally
/// impossible token is rejected without spending a call at all, and a successful
/// verification is remembered for a short while in
/// <see cref="TokenVerificationCache"/>.
/// </summary>
public sealed class GoogleTokenVerifier(HttpClient httpClient, BloodworkOptions options, TokenVerificationCache cache)
{
    /// <summary>
    /// Google's access tokens are opaque, so there is no format to validate
    /// against -- but they are URL-safe ASCII, and this bounds what is worth
    /// spending an outbound call on. Rejecting here is purely a cost control:
    /// anything that gets past it is still verified by Google, and nothing is
    /// ever accepted on the strength of its shape.
    /// </summary>
    private const int MinTokenLength = 20;
    private const int MaxTokenLength = 2048;

    private static bool IsStructurallyImpossible(string accessToken)
    {
        if (accessToken.Length is < MinTokenLength or > MaxTokenLength)
        {
            return true;
        }
        foreach (var c in accessToken)
        {
            var allowed = c is >= 'A' and <= 'Z' or >= 'a' and <= 'z' or >= '0' and <= '9'
                || c is '-' or '.' or '_' or '~' or '+' or '/' or '=';
            if (!allowed)
            {
                return true;
            }
        }
        return false;
    }

    /// <summary>
    /// Returns the verified caller's Google subject id (<c>sub</c>), so callers can
    /// scope stored data to it, plus their email address where the token's scopes
    /// expose one. Documented tokeninfo responses show <c>sub</c> present on access
    /// tokens without an <c>openid</c> scope, and this app never requests one --
    /// confirm that holds against a real response (log the token's own <c>sub</c>
    /// once, not the raw body -- see the no-raw-logging note below) before trusting
    /// this in production; if it's ever absent, that must fail closed (see the throw
    /// below), never silently scope data to an empty string.
    /// </summary>
    public async Task<VerifiedCaller> VerifyAsync(string accessToken, CancellationToken cancellationToken = default)
    {
        if (IsStructurallyImpossible(accessToken))
        {
            throw new UnauthorizedException("Malformed access token.");
        }

        if (cache.Get(accessToken) is { } cached)
        {
            return cached;
        }

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
        var sub = body.Sub;
        if (string.IsNullOrEmpty(sub))
        {
            throw new UnauthorizedException("Google tokeninfo response did not include a subject id.");
        }

        // A missing email is normal, not an error: it only means the granted
        // scopes did not include one. Nothing authorizes on it, so there is
        // nothing to fail closed about.
        var caller = new VerifiedCaller(sub, string.IsNullOrWhiteSpace(body.Email) ? null : body.Email);

        // expires_in is documented as seconds-remaining and arrives as a JSON
        // string, not a number. An absent or unparseable value caches for the
        // default ceiling rather than being treated as "never expires".
        var remaining = int.TryParse(body.ExpiresIn, out var seconds) && seconds > 0
            ? TimeSpan.FromSeconds(seconds)
            : (TimeSpan?)null;
        cache.Set(accessToken, caller, remaining);

        return caller;
    }

    private sealed class TokenInfoResponse
    {
        [JsonPropertyName("aud")]
        public string? Aud { get; set; }

        [JsonPropertyName("sub")]
        public string? Sub { get; set; }

        [JsonPropertyName("email")]
        public string? Email { get; set; }

        [JsonPropertyName("expires_in")]
        public string? ExpiresIn { get; set; }

        [JsonPropertyName("error")]
        public string? Error { get; set; }

        [JsonPropertyName("error_description")]
        public string? ErrorDescription { get; set; }
    }
}
