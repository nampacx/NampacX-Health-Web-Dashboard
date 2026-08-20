using Azure;
using Azure.Data.Tables;

namespace Bloodwork.Models;

/// <summary>
/// A row in the <c>bloodworkUsers</c> table -- one per Google account that has
/// ever presented a valid access token to this app. A constant PartitionKey
/// ("user") is deliberate for the same reason <see cref="BloodworkJobEntity"/>
/// uses one: a personal-scale app has tens of these, so splitting the partition
/// would be complexity with no benefit, and it makes the table trivial to eyeball
/// in Storage Explorer or the portal.
///
/// Rows are created automatically by <see cref="Bloodwork.Services.UsersRepository"/>,
/// always with <see cref="Approved"/> false. <b>Nothing in this app ever writes
/// Approved = true.</b> Approving someone is a manual edit of this row, and the
/// absence of a write path is the point: there is no endpoint to find, no
/// privilege-escalation bug to write, and no way for a parsing or authorization
/// slip elsewhere to grant access.
/// </summary>
public sealed class BloodworkUserEntity : ITableEntity
{
    public string PartitionKey { get; set; } = "user";

    /// <summary>
    /// The caller's Google subject id -- the same value <see cref="BloodworkJobEntity.Sub"/>
    /// and <see cref="BloodworkResultEntity.Sub"/> carry, so a row here joins to a
    /// user's data by eye.
    /// </summary>
    public string RowKey { get; set; } = string.Empty;

    public DateTimeOffset? Timestamp { get; set; }
    public ETag ETag { get; set; }

    /// <summary>
    /// Flipped to true by hand, in the portal or Storage Explorer. Written as
    /// false exactly once, at registration, and never written again by this app.
    /// </summary>
    public bool Approved { get; set; }

    /// <summary>
    /// Display-only, and best-effort: absent when the token was issued without an
    /// email scope. It exists so whoever approves a request can tell which person
    /// a 21-digit subject id belongs to -- approving a row you cannot identify is
    /// not a decision, it is a coin flip.
    ///
    /// <b>Never authorize on this.</b> A Google account's email address can change,
    /// and a Workspace address can be reassigned to a different person entirely;
    /// only <see cref="RowKey"/> (the <c>sub</c>) is stable and unique forever.
    /// </summary>
    public string? Email { get; set; }

    /// <summary>ISO 8601. When this account first presented a valid token.</summary>
    public string FirstSeenAt { get; set; } = string.Empty;
}
