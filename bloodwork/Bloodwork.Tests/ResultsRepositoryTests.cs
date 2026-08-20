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
    private static Mock<TableClient> CapturingTable(List<BloodworkResultEntity> written)
    {
        var table = new Mock<TableClient>();
        table
            .Setup(t => t.UpsertEntityAsync(It.IsAny<BloodworkResultEntity>(), TableUpdateMode.Replace, It.IsAny<CancellationToken>()))
            .Callback<BloodworkResultEntity, TableUpdateMode, CancellationToken>((e, _, _) => written.Add(e))
            .ReturnsAsync(Mock.Of<Response>());
        return table;
    }

    [Fact]
    public async Task WriteRowsAsync_PartitionsByOwner_AndKeysRowsByDateAndAnalyte()
    {
        var written = new List<BloodworkResultEntity>();
        var repository = new ResultsRepository(CapturingTable(written).Object);
        var rows = new List<AnalyteRow>
        {
            new("TESTOA", "Testosteron", "539", "", "ng/dl", "", "197 - 670"),
        };

        await repository.WriteRowsAsync("2026-08-10", rows, "doc-1", "user-sub-1");

        var entity = Assert.Single(written);
        Assert.Equal("user-sub-1", entity.PartitionKey);
        Assert.Equal("2026-08-10|TESTOA", entity.RowKey);
        Assert.Equal("2026-08-10", entity.ReportDate);
        Assert.Equal("doc-1", entity.SourceDocumentId);
        Assert.Equal("user-sub-1", entity.Sub);
        Assert.False(entity.Corrected);
    }

    [Fact]
    public async Task WriteRowsAsync_TwoAccountsSameDateSameAnalyte_ProduceDistinctKeys()
    {
        var written = new List<BloodworkResultEntity>();
        var repository = new ResultsRepository(CapturingTable(written).Object);
        var rows = new List<AnalyteRow>
        {
            new("TESTOA", "Testosteron", "539", "", "ng/dl", "", "197 - 670"),
        };

        // The regression this key layout exists for. Lab short codes are shared
        // across every patient of a lab and report dates cluster on weekdays, so
        // this collision used to happen by accident: both rows landed on
        // ("2026-08-10", "TESTOA") and the second upsert silently replaced the
        // first, Sub included, wiping the earlier account's row with no error
        // anywhere.
        await repository.WriteRowsAsync("2026-08-10", rows, "doc-1", "user-sub-1");
        await repository.WriteRowsAsync("2026-08-10", rows, "doc-2", "user-sub-2");

        Assert.Equal(2, written.Count);
        Assert.NotEqual(
            (written[0].PartitionKey, written[0].RowKey),
            (written[1].PartitionKey, written[1].RowKey));
    }

    [Fact]
    public async Task WriteRowsAsync_SameAnalyteOnDifferentDates_StaysDistinctWithinOnePartition()
    {
        var written = new List<BloodworkResultEntity>();
        var repository = new ResultsRepository(CapturingTable(written).Object);
        var rows = new List<AnalyteRow>
        {
            new("TESTOA", "Testosteron", "539", "", "ng/dl", "", "197 - 670"),
        };

        // A partition is now one caller's whole history rather than one report,
        // so the date has to be inside the RowKey -- without it, every report a
        // person ever uploaded would overwrite the last on the shared code.
        await repository.WriteRowsAsync("2026-08-10", rows, "doc-1", "user-sub-1");
        await repository.WriteRowsAsync("2026-02-03", rows, "doc-2", "user-sub-1");

        Assert.Equal("user-sub-1", written[0].PartitionKey);
        Assert.Equal("user-sub-1", written[1].PartitionKey);
        Assert.NotEqual(written[0].RowKey, written[1].RowKey);
    }

    [Fact]
    public async Task WriteRowsAsync_RepeatedAnalyteCodeInOneDocument_GetsNumberedSuffix()
    {
        var written = new List<BloodworkResultEntity>();
        var repository = new ResultsRepository(CapturingTable(written).Object);
        var rows = new List<AnalyteRow>
        {
            new("GLYKOH", "HBA1c", "27,90", "", "mmol/mol", "", "< 39"),
            new("GLYKOH", "HBA1c (re-test)", "26,10", "", "mmol/mol", "", "< 39"),
        };

        await repository.WriteRowsAsync("2026-08-10", rows, "doc-1", "user-sub-1");

        Assert.Equal(2, written.Count);
        Assert.Equal("2026-08-10|GLYKOH", written[0].RowKey);
        Assert.Equal("2026-08-10|GLYKOH-2", written[1].RowKey);
    }

    [Fact]
    public async Task WriteRowsAsync_ForbiddenRowKeyCharacters_AreSanitized()
    {
        var written = new List<BloodworkResultEntity>();
        var repository = new ResultsRepository(CapturingTable(written).Object);
        var rows = new List<AnalyteRow> { new("BAD/#?CODE", "Something", "1", "", "u", "", "0-1") };

        await repository.WriteRowsAsync("2026-08-10", rows, "doc-1", "user-sub-1");

        var entity = Assert.Single(written);
        Assert.DoesNotContain('/', entity.RowKey);
        Assert.DoesNotContain('#', entity.RowKey);
        Assert.DoesNotContain('?', entity.RowKey);
    }

    [Fact]
    public async Task WriteRowsAsync_SeparatorInAnalyteCode_IsSanitizedSoTheSplitStaysUnambiguous()
    {
        var written = new List<BloodworkResultEntity>();
        var repository = new ResultsRepository(CapturingTable(written).Object);
        var rows = new List<AnalyteRow> { new("A|B", "Something", "1", "", "u", "", "0-1") };

        await repository.WriteRowsAsync("2026-08-10", rows, "doc-1", "user-sub-1");

        var entity = Assert.Single(written);
        Assert.Equal("2026-08-10|A_B", entity.RowKey);
        // The round-trip the whole public contract rests on: what the API hands
        // back is exactly what PUT takes in its {analyte} route segment.
        Assert.Equal("A_B", ResultsRepository.AnalyteKeyOf(entity.RowKey));
    }

    [Theory]
    [InlineData("2026-08-10|TESTOA", "TESTOA")]
    [InlineData("2026-08-10|GLYKOH-2", "GLYKOH-2")]
    // A key with no separator can only be a pre-migration row; returning it
    // whole is the honest answer, and beats throwing on data that predates the
    // layout.
    [InlineData("TESTOA", "TESTOA")]
    public void AnalyteKeyOf_ReturnsTheAnalyteHalf(string rowKey, string expected)
    {
        Assert.Equal(expected, ResultsRepository.AnalyteKeyOf(rowKey));
    }

    [Fact]
    public async Task CorrectAsync_AppliesPatchAndMarksCorrected_UsingMergeMode()
    {
        var table = new Mock<TableClient>();
        var existing = new BloodworkResultEntity
        {
            PartitionKey = "user-sub-1",
            RowKey = "2026-08-10|TESTOA",
            ReportDate = "2026-08-10",
            Ergebniswert = "539",
            Sub = "user-sub-1",
            ETag = new ETag("*"),
        };
        table
            .Setup(t => t.GetEntityAsync<BloodworkResultEntity>("user-sub-1", "2026-08-10|TESTOA", null, It.IsAny<CancellationToken>()))
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
        var result = await repository.CorrectAsync("2026-08-10", "TESTOA", "user-sub-1", new Dictionary<string, string> { ["ergebniswert"] = "540" });

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
            .Setup(t => t.GetEntityAsync<BloodworkResultEntity>("user-sub-1", "2026-08-10|MISSING", null, It.IsAny<CancellationToken>()))
            .ThrowsAsync(new RequestFailedException(404, "not found"));

        var repository = new ResultsRepository(table.Object);

        await Assert.ThrowsAsync<NotFoundException>(
            () => repository.CorrectAsync("2026-08-10", "MISSING", "user-sub-1", new Dictionary<string, string> { ["ergebniswert"] = "1" }));
    }

    [Fact]
    public async Task CorrectAsync_AnotherCallersRow_IsNotEvenLookedUpInTheirPartition()
    {
        var table = new Mock<TableClient>();
        // user-sub-1's row exists, in user-sub-1's partition.
        table
            .Setup(t => t.GetEntityAsync<BloodworkResultEntity>("user-sub-1", "2026-08-10|TESTOA", null, It.IsAny<CancellationToken>()))
            .ReturnsAsync(Response.FromValue(
                new BloodworkResultEntity
                {
                    PartitionKey = "user-sub-1",
                    RowKey = "2026-08-10|TESTOA",
                    ReportDate = "2026-08-10",
                    Ergebniswert = "539",
                    Sub = "user-sub-1",
                    ETag = new ETag("*"),
                },
                Mock.Of<Response>()));
        // Someone else asking for the same date and analyte looks in THEIR OWN
        // partition, where there is nothing.
        table
            .Setup(t => t.GetEntityAsync<BloodworkResultEntity>("someone-elses-sub", "2026-08-10|TESTOA", null, It.IsAny<CancellationToken>()))
            .ThrowsAsync(new RequestFailedException(404, "not found"));

        var repository = new ResultsRepository(table.Object);

        // Reads exactly like the row not existing, not a distinct "forbidden" --
        // confirming a row exists under another account is its own leak.
        await Assert.ThrowsAsync<NotFoundException>(
            () => repository.CorrectAsync("2026-08-10", "TESTOA", "someone-elses-sub", new Dictionary<string, string> { ["ergebniswert"] = "1" }));

        table.Verify(t => t.UpdateEntityAsync(It.IsAny<BloodworkResultEntity>(), It.IsAny<ETag>(), It.IsAny<TableUpdateMode>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task CorrectAsync_RowWhoseSubDisagreesWithItsPartition_StillThrowsNotFound()
    {
        var table = new Mock<TableClient>();
        var existing = new BloodworkResultEntity
        {
            PartitionKey = "user-sub-1",
            RowKey = "2026-08-10|TESTOA",
            ReportDate = "2026-08-10",
            Ergebniswert = "539",
            Sub = "somebody-else",
            ETag = new ETag("*"),
        };
        table
            .Setup(t => t.GetEntityAsync<BloodworkResultEntity>("user-sub-1", "2026-08-10|TESTOA", null, It.IsAny<CancellationToken>()))
            .ReturnsAsync(Response.FromValue(existing, Mock.Of<Response>()));

        var repository = new ResultsRepository(table.Object);

        // Unreachable through the current write path -- Sub and PartitionKey are
        // written from the same value. Pinned anyway: the ownership assertion is
        // what keeps the mutation guarded if the key layout is ever revisited.
        await Assert.ThrowsAsync<NotFoundException>(
            () => repository.CorrectAsync("2026-08-10", "TESTOA", "user-sub-1", new Dictionary<string, string> { ["ergebniswert"] = "1" }));

        table.Verify(t => t.UpdateEntityAsync(It.IsAny<BloodworkResultEntity>(), It.IsAny<ETag>(), It.IsAny<TableUpdateMode>(), It.IsAny<CancellationToken>()), Times.Never);
    }
}
