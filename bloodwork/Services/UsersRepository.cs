using Azure;
using Azure.Data.Tables;
using Bloodwork.Models;
using Microsoft.Extensions.DependencyInjection;

namespace Bloodwork.Services;

/// <summary>
/// The allowlist behind <see cref="Bloodwork.Middleware.GoogleAuthMiddleware"/>'s
/// approval gate.
///
/// Verifying a Google token only proves the caller signed in through this app's
/// OAuth client -- and that client's consent screen is reachable by any Google
/// account, since <c>GOOGLE_CLIENT_ID</c> and the Function App URL are both public
/// by design. This table is what turns "signed in" into "allowed in".
///
/// Deliberately write-poor: the only mutation it performs is inserting an
/// unapproved row for an account it has never seen. There is no ApproveAsync, no
/// admin route, and no configuration value that grants access -- approval happens
/// by editing the row in the portal or Storage Explorer. Code that cannot grant
/// access cannot be tricked into granting it.
/// </summary>
public sealed class UsersRepository([FromKeyedServices("users")] TableClient table)
{
    private const string PartitionKey = "user";

    /// <summary>
    /// True only when a row exists for this account <i>and</i> carries
    /// <c>Approved = true</c>.
    ///
    /// An account nobody has seen before is registered as unapproved and denied.
    /// That registration is the whole point of doing this on first request rather
    /// than rejecting outright: a first sign-in is a request to be let in, and it
    /// needs to leave a row in front of whoever does the approving. It also means
    /// the reviewer sees a real account with an email attached rather than being
    /// asked to type a subject id they have no way to obtain.
    /// </summary>
    public async Task<bool> IsApprovedAsync(string sub, string? email, CancellationToken ct = default)
    {
        try
        {
            var response = await table.GetEntityAsync<BloodworkUserEntity>(PartitionKey, sub, cancellationToken: ct);
            return response.Value.Approved;
        }
        catch (RequestFailedException ex) when (ex.Status == 404)
        {
            await RegisterAsync(sub, email, ct);
            return false;
        }
    }

    private async Task RegisterAsync(string sub, string? email, CancellationToken ct)
    {
        var entity = new BloodworkUserEntity
        {
            PartitionKey = PartitionKey,
            RowKey = sub,
            Approved = false,
            Email = email,
            FirstSeenAt = DateTimeOffset.UtcNow.ToString("O"),
        };

        try
        {
            // AddEntityAsync, never UpsertEntityAsync. An upsert here would
            // rewrite Approved = false over a row that had just been approved by
            // hand, if the 404 above ever lost a race with that approval -- so the
            // one moment an admin acts on this table would be the one moment it
            // could be undone. Insert-or-nothing has no such window.
            await table.AddEntityAsync(entity, ct);
        }
        catch (RequestFailedException ex) when (ex.Status == 409)
        {
            // Two requests from a brand-new account raced (the SPA loads results
            // and polls a job at the same time). The other one inserted the row;
            // this caller is unapproved either way, so there is nothing to do and
            // nothing to report.
        }
    }
}
