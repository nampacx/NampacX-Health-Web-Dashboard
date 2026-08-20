using Azure;
using Azure.Data.Tables;
using Bloodwork.Models;
using Bloodwork.Services;
using Moq;
using Xunit;

namespace Bloodwork.Tests;

public class UsersRepositoryTests
{
    private static Mock<TableClient> TableReturning(BloodworkUserEntity? existing)
    {
        var table = new Mock<TableClient>();
        var setup = table.Setup(t => t.GetEntityAsync<BloodworkUserEntity>(
            "user", "user-sub-1", null, It.IsAny<CancellationToken>()));

        if (existing is null)
        {
            setup.ThrowsAsync(new RequestFailedException(404, "not found"));
        }
        else
        {
            setup.ReturnsAsync(Response.FromValue(existing, Mock.Of<Response>()));
        }

        return table;
    }

    private static BloodworkUserEntity Row(bool approved) => new()
    {
        PartitionKey = "user",
        RowKey = "user-sub-1",
        Approved = approved,
        Email = "someone@example.com",
        FirstSeenAt = "2026-08-20T09:00:00.0000000+00:00",
        ETag = new ETag("*"),
    };

    [Fact]
    public async Task IsApprovedAsync_ApprovedRow_ReturnsTrue()
    {
        var table = TableReturning(Row(approved: true));

        var repository = new UsersRepository(table.Object);

        Assert.True(await repository.IsApprovedAsync("user-sub-1", "someone@example.com"));
        // An existing row is read only -- nothing about a normal request touches it.
        table.Verify(t => t.AddEntityAsync(It.IsAny<BloodworkUserEntity>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task IsApprovedAsync_ExistingButUnapprovedRow_ReturnsFalseAndDoesNotRewriteIt()
    {
        var table = TableReturning(Row(approved: false));

        var repository = new UsersRepository(table.Object);

        Assert.False(await repository.IsApprovedAsync("user-sub-1", "someone@example.com"));
        // Re-registering on every request would be pointless writes, and an
        // upsert would be worse -- see RegisterAsync's own comment.
        table.Verify(t => t.AddEntityAsync(It.IsAny<BloodworkUserEntity>(), It.IsAny<CancellationToken>()), Times.Never);
        table.Verify(t => t.UpsertEntityAsync(It.IsAny<BloodworkUserEntity>(), It.IsAny<TableUpdateMode>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task IsApprovedAsync_UnknownAccount_RegistersItUnapprovedAndDenies()
    {
        var table = TableReturning(null);
        BloodworkUserEntity? captured = null;
        table
            .Setup(t => t.AddEntityAsync(It.IsAny<BloodworkUserEntity>(), It.IsAny<CancellationToken>()))
            .Callback<BloodworkUserEntity, CancellationToken>((entity, _) => captured = entity)
            .ReturnsAsync(Mock.Of<Response>());

        var repository = new UsersRepository(table.Object);

        Assert.False(await repository.IsApprovedAsync("user-sub-1", "someone@example.com"));

        Assert.NotNull(captured);
        Assert.Equal("user", captured!.PartitionKey);
        Assert.Equal("user-sub-1", captured.RowKey);
        Assert.Equal("someone@example.com", captured.Email);
        Assert.False(string.IsNullOrEmpty(captured.FirstSeenAt));
        // The one invariant this whole feature rests on: the app only ever
        // writes Approved = false. Approval is a manual edit, so there is no
        // code path to escalate through.
        Assert.False(captured.Approved);
    }

    [Fact]
    public async Task IsApprovedAsync_UnknownAccountWithNoEmailScope_StillRegisters()
    {
        var table = TableReturning(null);
        BloodworkUserEntity? captured = null;
        table
            .Setup(t => t.AddEntityAsync(It.IsAny<BloodworkUserEntity>(), It.IsAny<CancellationToken>()))
            .Callback<BloodworkUserEntity, CancellationToken>((entity, _) => captured = entity)
            .ReturnsAsync(Mock.Of<Response>());

        var repository = new UsersRepository(table.Object);

        // A token without an email scope is a perfectly valid token -- the
        // missing address costs the reviewer some context, it must not cost
        // the caller their registration.
        Assert.False(await repository.IsApprovedAsync("user-sub-1", null));
        Assert.NotNull(captured);
        Assert.Null(captured!.Email);
    }

    [Fact]
    public async Task IsApprovedAsync_ConcurrentFirstRequests_LosesTheRaceQuietly()
    {
        var table = TableReturning(null);
        table
            .Setup(t => t.AddEntityAsync(It.IsAny<BloodworkUserEntity>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new RequestFailedException(409, "entity already exists"));

        var repository = new UsersRepository(table.Object);

        // The SPA loads results and polls a job at the same time, so a brand-new
        // account's very first two requests race by default. The loser must
        // still get a clean "not approved", never a 500.
        Assert.False(await repository.IsApprovedAsync("user-sub-1", "someone@example.com"));
    }

    [Fact]
    public async Task IsApprovedAsync_StorageFailureThatIsNotNotFound_Propagates()
    {
        var table = new Mock<TableClient>();
        table
            .Setup(t => t.GetEntityAsync<BloodworkUserEntity>("user", "user-sub-1", null, It.IsAny<CancellationToken>()))
            .ThrowsAsync(new RequestFailedException(503, "storage unavailable"));

        var repository = new UsersRepository(table.Object);

        // Fail closed. A storage blip must surface as a 500, never be swallowed
        // into a bare "false" (which would silently register a real user again)
        // and certainly never into a "true".
        await Assert.ThrowsAsync<RequestFailedException>(() => repository.IsApprovedAsync("user-sub-1", "someone@example.com"));
    }
}
