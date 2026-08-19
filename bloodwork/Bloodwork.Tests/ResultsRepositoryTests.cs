using Azure;
using Azure.Data.Tables;
using Bloodwork.Models;
using Bloodwork.Models.Exceptions;
using Bloodwork.Services;
using Moq;
using Xunit;

namespace Bloodwork.Tests;

public class ResultsRepositoryTests
{
    [Fact]
    public async Task WriteRowsAsync_UsesReportDateAsPartitionKeyAndAnalyseAsRowKey()
    {
        var table = new Mock<TableClient>();
        var written = new List<BloodworkResultEntity>();
        table
            .Setup(t => t.UpsertEntityAsync(It.IsAny<BloodworkResultEntity>(), TableUpdateMode.Replace, It.IsAny<CancellationToken>()))
            .Callback<BloodworkResultEntity, TableUpdateMode, CancellationToken>((e, _, _) => written.Add(e))
            .ReturnsAsync(Mock.Of<Response>());

        var repository = new ResultsRepository(table.Object);
        var rows = new List<AnalyteRow>
        {
            new("TESTOA", "Testosteron", "539", "", "ng/dl", "", "197 - 670"),
        };

        await repository.WriteRowsAsync("2026-08-10", rows, "doc-1");

        var entity = Assert.Single(written);
        Assert.Equal("2026-08-10", entity.PartitionKey);
        Assert.Equal("TESTOA", entity.RowKey);
        Assert.Equal("doc-1", entity.SourceDocumentId);
        Assert.False(entity.Corrected);
    }

    [Fact]
    public async Task WriteRowsAsync_RepeatedAnalyteCodeInOneDocument_GetsNumberedSuffix()
    {
        var table = new Mock<TableClient>();
        var written = new List<BloodworkResultEntity>();
        table
            .Setup(t => t.UpsertEntityAsync(It.IsAny<BloodworkResultEntity>(), TableUpdateMode.Replace, It.IsAny<CancellationToken>()))
            .Callback<BloodworkResultEntity, TableUpdateMode, CancellationToken>((e, _, _) => written.Add(e))
            .ReturnsAsync(Mock.Of<Response>());

        var repository = new ResultsRepository(table.Object);
        var rows = new List<AnalyteRow>
        {
            new("GLYKOH", "HBA1c", "27,90", "", "mmol/mol", "", "< 39"),
            new("GLYKOH", "HBA1c (re-test)", "26,10", "", "mmol/mol", "", "< 39"),
        };

        await repository.WriteRowsAsync("2026-08-10", rows, "doc-1");

        Assert.Equal(2, written.Count);
        Assert.Equal("GLYKOH", written[0].RowKey);
        Assert.Equal("GLYKOH#2", written[1].RowKey);
    }

    [Fact]
    public async Task WriteRowsAsync_ForbiddenRowKeyCharacters_AreSanitized()
    {
        var table = new Mock<TableClient>();
        var written = new List<BloodworkResultEntity>();
        table
            .Setup(t => t.UpsertEntityAsync(It.IsAny<BloodworkResultEntity>(), TableUpdateMode.Replace, It.IsAny<CancellationToken>()))
            .Callback<BloodworkResultEntity, TableUpdateMode, CancellationToken>((e, _, _) => written.Add(e))
            .ReturnsAsync(Mock.Of<Response>());

        var repository = new ResultsRepository(table.Object);
        var rows = new List<AnalyteRow> { new("BAD/#?CODE", "Something", "1", "", "u", "", "0-1") };

        await repository.WriteRowsAsync("2026-08-10", rows, "doc-1");

        var entity = Assert.Single(written);
        Assert.DoesNotContain('/', entity.RowKey);
        Assert.DoesNotContain('#', entity.RowKey);
        Assert.DoesNotContain('?', entity.RowKey);
    }

    [Fact]
    public async Task CorrectAsync_AppliesPatchAndMarksCorrected_UsingMergeMode()
    {
        var table = new Mock<TableClient>();
        var existing = new BloodworkResultEntity
        {
            PartitionKey = "2026-08-10",
            RowKey = "TESTOA",
            Ergebniswert = "539",
            ETag = new ETag("*"),
        };
        table
            .Setup(t => t.GetEntityAsync<BloodworkResultEntity>("2026-08-10", "TESTOA", null, It.IsAny<CancellationToken>()))
            .ReturnsAsync(Response.FromValue(existing, Mock.Of<Response>()));

        BloodworkResultEntity? updated = null;
        TableUpdateMode? modeUsed = null;
        table
            .Setup(t => t.UpdateEntityAsync(It.IsAny<BloodworkResultEntity>(), It.IsAny<ETag>(), It.IsAny<TableUpdateMode>(), It.IsAny<CancellationToken>()))
            .Callback<BloodworkResultEntity, ETag, TableUpdateMode, CancellationToken>((e, _, mode, _) =>
            {
                updated = e;
                modeUsed = mode;
            })
            .ReturnsAsync(Mock.Of<Response>());

        var repository = new ResultsRepository(table.Object);
        var result = await repository.CorrectAsync("2026-08-10", "TESTOA", new Dictionary<string, string> { ["ergebniswert"] = "540" });

        Assert.Equal(TableUpdateMode.Merge, modeUsed);
        Assert.Equal("540", updated!.Ergebniswert);
        Assert.True(updated.Corrected);
        Assert.False(string.IsNullOrEmpty(updated.CorrectedAt));
        Assert.Same(updated, result);
    }

    [Fact]
    public async Task CorrectAsync_UnknownRow_ThrowsNotFound()
    {
        var table = new Mock<TableClient>();
        table
            .Setup(t => t.GetEntityAsync<BloodworkResultEntity>("2026-08-10", "MISSING", null, It.IsAny<CancellationToken>()))
            .ThrowsAsync(new RequestFailedException(404, "not found"));

        var repository = new ResultsRepository(table.Object);

        await Assert.ThrowsAsync<NotFoundException>(
            () => repository.CorrectAsync("2026-08-10", "MISSING", new Dictionary<string, string> { ["ergebniswert"] = "1" }));
    }
}
