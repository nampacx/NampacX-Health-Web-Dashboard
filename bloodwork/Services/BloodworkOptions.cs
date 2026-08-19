using Bloodwork.Models.Exceptions;
using Microsoft.Extensions.Configuration;

namespace Bloodwork.Services;

/// <summary>
/// App configuration, loaded once at host startup via <see cref="Load"/> --
/// same "fail loudly" posture as broker's <c>loadConfig()</c>, except an
/// invalid deployment here fails the whole app to start rather than 500ing
/// per request.
/// </summary>
public sealed class BloodworkOptions
{
    public required string GoogleClientId { get; init; }
    public required IReadOnlyList<string> AllowedOrigins { get; init; }

    /// <summary>Set in Azure; null locally when STORAGE_CONNECTION_STRING is used instead.</summary>
    public string? StorageAccountName { get; init; }

    /// <summary>Azurite connection string for local dev; null in Azure, where identity-based access is used instead.</summary>
    public string? StorageConnectionString { get; init; }

    public required string DocumentIntelligenceEndpoint { get; init; }

    /// <summary>Local-dev-only fast path; absent in Azure, where the Function's managed identity is used instead.</summary>
    public string? DocumentIntelligenceKey { get; init; }

    public required long MaxUploadBytes { get; init; }

    public const long DefaultMaxUploadBytes = 20 * 1024 * 1024;

    public static BloodworkOptions Load(IConfiguration config)
    {
        var storageAccountName = Trim(config["STORAGE_ACCOUNT_NAME"]);
        var storageConnectionString = Trim(config["STORAGE_CONNECTION_STRING"]);
        if (storageAccountName is null && storageConnectionString is null)
        {
            throw new ConfigurationException(
                "Either STORAGE_ACCOUNT_NAME or STORAGE_CONNECTION_STRING must be set.");
        }

        var maxUploadBytesSetting = config["MAX_UPLOAD_BYTES"];
        long maxUploadBytes = DefaultMaxUploadBytes;
        if (!string.IsNullOrWhiteSpace(maxUploadBytesSetting) && !long.TryParse(maxUploadBytesSetting, out maxUploadBytes))
        {
            throw new ConfigurationException($"MAX_UPLOAD_BYTES ('{maxUploadBytesSetting}') is not a valid integer.");
        }

        return new BloodworkOptions
        {
            GoogleClientId = Require(config, "GOOGLE_CLIENT_ID"),
            AllowedOrigins = Require(config, "ALLOWED_ORIGINS")
                .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries),
            StorageAccountName = storageAccountName,
            StorageConnectionString = storageConnectionString,
            DocumentIntelligenceEndpoint = Require(config, "DOCUMENT_INTELLIGENCE_ENDPOINT"),
            DocumentIntelligenceKey = Trim(config["DOCUMENT_INTELLIGENCE_KEY"]),
            MaxUploadBytes = maxUploadBytes,
        };
    }

    private static string Require(IConfiguration config, string key) =>
        Trim(config[key]) ?? throw new ConfigurationException($"Missing required configuration value '{key}'.");

    private static string? Trim(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
