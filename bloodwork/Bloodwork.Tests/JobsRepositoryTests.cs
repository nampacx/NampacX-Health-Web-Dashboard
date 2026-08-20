using Azure;
using Azure.Data.Tables;
using Bloodwork.Models;
using Bloodwork.Models.Exceptions;
using Bloodwork.Services;
using Moq;
using Xunit;

namespace Bloodwork.Tests;

public class JobsRepositoryTests
{
    [Fact]
    public async Task CreateAsync_WritesEntityWithPendingStatusAndJobPartition()
    {
        var table = new Mock<TableClient>();
        BloodworkJobEntity? captured = null;
        table
            .Setup(t => t.AddEntityAsync(It.IsAny<BloodworkJobEntity>(), It.IsAny<CancellationToken>()))
            .Callback<BloodworkJobEntity, CancellationToken>((entity, _) => captured = entity)
            .ReturnsAsync(Mock.Of<Response>());

        var repository = new JobsRepository(table.Object);
        await repository.CreateAsync("doc-1", "doc-1.pdf", "application/pdf", "user-sub-1");

        Assert.NotNull(captured);
        Assert.Equal("job", captured!.PartitionKey);
        Assert.Equal("doc-1", captured.RowKey);
        Assert.Equal("pending", captured.Status);
        Assert.Equal("doc-1.pdf", captured.BlobName);
        Assert.Equal("application/pdf", captured.ContentType);
        Assert.Equal("user-sub-1", captured.Sub);
        Assert.False(string.IsNullOrEmpty(captured.CreatedAt));
    }

    [Fact]
    public async Task GetAsync_UnknownDocumentId_ThrowsNotFound()
    {
        var table = new Mock<TableClient>();
        table
            .Setup(t => t.GetEntityAsync<BloodworkJobEntity>("job", "missing", null, It.IsAny<CancellationToken>()))
            .ThrowsAsync(new RequestFailedException(404, "not found"));

        var repository = new JobsRepository(table.Object);

        await Assert.ThrowsAsync<NotFoundException>(() => repository.GetAsync("missing"));
    }

    [Fact]
    public async Task MarkCompletedAsync_SetsStatusReportDateAndRowCount_UsingReplaceMode()
    {
        var table = new Mock<TableClient>();
        var existing = new BloodworkJobEntity { PartitionKey = "job", RowKey = "doc-1", Status = "processing", ETag = new ETag("*") };
        table
            .Setup(t => t.GetEntityAsync<BloodworkJobEntity>("job", "doc-1", null, It.IsAny<CancellationToken>()))
            .ReturnsAsync(Response.FromValue(existing, Mock.Of<Response>()));

        BloodworkJobEntity? updated = null;
        TableUpdateMode? modeUsed = null;
        table
            .Setup(t => t.UpdateEntityAsync(It.IsAny<BloodworkJobEntity>(), It.IsAny<ETag>(), It.IsAny<TableUpdateMode>(), It.IsAny<CancellationToken>()))
            .Callback<BloodworkJobEntity, ETag, TableUpdateMode, CancellationToken>((e, _, mode, _) =>
            {
                updated = e;
                modeUsed = mode;
            })
            .ReturnsAsync(Mock.Of<Response>());

        var repository = new JobsRepository(table.Object);
        await repository.MarkCompletedAsync("doc-1", "2026-08-10", 25);

        Assert.Equal(TableUpdateMode.Replace, modeUsed);
        Assert.NotNull(updated);
        Assert.Equal("completed", updated!.Status);
        Assert.Equal("2026-08-10", updated.ReportDate);
        Assert.Equal(25, updated.RowCount);
    }

    [Fact]
    public async Task MarkFailedAsync_SetsStatusCodeAndMessage()
    {
        var table = new Mock<TableClient>();
        var existing = new BloodworkJobEntity { PartitionKey = "job", RowKey = "doc-1", Status = "processing", ETag = new ETag("*") };
        table
            .Setup(t => t.GetEntityAsync<BloodworkJobEntity>("job", "doc-1", null, It.IsAny<CancellationToken>()))
            .ReturnsAsync(Response.FromValue(existing, Mock.Of<Response>()));

        BloodworkJobEntity? updated = null;
        table
            .Setup(t => t.UpdateEntityAsync(It.IsAny<BloodworkJobEntity>(), It.IsAny<ETag>(), It.IsAny<TableUpdateMode>(), It.IsAny<CancellationToken>()))
            .Callback<BloodworkJobEntity, ETag, TableUpdateMode, CancellationToken>((e, _, _, _) => updated = e)
            .ReturnsAsync(Mock.Of<Response>());

        var repository = new JobsRepository(table.Object);
        await repository.MarkFailedAsync("doc-1", "results_table_not_found", "header row not found");

        Assert.Equal("failed", updated!.Status);
        Assert.Equal("results_table_not_found", updated.ErrorCode);
        Assert.Equal("header row not found", updated.ErrorMessage);
    }
}
