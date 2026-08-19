using Azure.AI.DocumentIntelligence;
using Bloodwork.Models.Exceptions;
using Bloodwork.Services;
using System.ClientModel.Primitives;
using Xunit;

namespace Bloodwork.Tests;

public class LayoutParserTests
{
    private static AnalyzeResult LoadFixture(string relativePath) =>
        ModelReaderWriter.Read<AnalyzeResult>(BinaryData.FromBytes(File.ReadAllBytes(relativePath)))!;

    [Fact]
    public void Parse_RealisticLabReport_ExtractsReportDateFromVomNotDatum()
    {
        var result = LoadFixture("Fixtures/LabReportLayout.fixture.json");

        var (reportDate, _) = new LayoutParser().Parse(result);

        // The fixture's header line carries both "Datum: 14.08.2026" (the
        // print date) and "vom 10.08.2026" (the report date) -- vom must win.
        Assert.Equal("2026-08-10", reportDate);
    }

    [Fact]
    public void Parse_RealisticLabReport_FindsHeaderRowNotAtIndexZero()
    {
        // The fixture deliberately puts a merged title cell at RowIndex 0
        // and the real header at RowIndex 1, mirroring what DI returns for
        // a bordered PDF table with a title row above the header.
        var result = LoadFixture("Fixtures/LabReportLayout.fixture.json");

        var (_, rows) = new LayoutParser().Parse(result);

        Assert.NotEmpty(rows);
    }

    [Fact]
    public void Parse_RealisticLabReport_ExcludesSectionSeparatorAndEmptyRows_LeavingExactCount()
    {
        var result = LoadFixture("Fixtures/LabReportLayout.fixture.json");

        var (_, rows) = new LayoutParser().Parse(result);

        // 29 rows in the source table: 2 "****" section-separator rows and
        // 2 rows with neither a result value nor free text (GFR60, LGVU)
        // are excluded, leaving 25 real analyte rows.
        Assert.Equal(25, rows.Count);
        Assert.DoesNotContain(rows, r => r.Analyse.StartsWith("****"));
        Assert.DoesNotContain(rows, r => r.Analyse == "GFR60");
        Assert.DoesNotContain(rows, r => r.Analyse == "LGVU");
    }

    [Fact]
    public void Parse_RealisticLabReport_MapsOneRowsFullFieldSetCorrectly()
    {
        var result = LoadFixture("Fixtures/LabReportLayout.fixture.json");

        var (_, rows) = new LayoutParser().Parse(result);

        var testoa = Assert.Single(rows, r => r.Analyse == "TESTOA");
        Assert.Equal("Testosteron", testoa.Bezeichnung);
        Assert.Equal("539", testoa.Ergebniswert);
        Assert.Equal("", testoa.Flag);
        Assert.Equal("ng/dl", testoa.Einheit);
        Assert.Equal("", testoa.Ergebnistext);
        Assert.Equal("197 - 670", testoa.Normbereich);
    }

    [Fact]
    public void Parse_RealisticLabReport_KeepsFreeTextOnlyRowWithNoNumericResult()
    {
        var result = LoadFixture("Fixtures/LabReportLayout.fixture.json");

        var (_, rows) = new LayoutParser().Parse(result);

        // IGF1 has an empty Ergebniswert but a non-empty Ergebnistext
        // ("FOLGT") -- it must survive the empty-row filter, which only
        // drops rows where *both* are empty.
        var igf1 = Assert.Single(rows, r => r.Analyse == "IGF1");
        Assert.Equal("FOLGT", igf1.Ergebnistext);
    }

    [Fact]
    public void Parse_NoHeaderRowMatches_ThrowsResultsTableNotFound()
    {
        var result = BuildAnalyzeResult(
            content: "some report vom 01.01.2026",
            tables:
            [
                BuildTable(
                    ("Foo", "Bar", "Baz", "Qux", "Quux", "Corge", "Grault"),
                    [("1", "2", "3", "4", "5", "6", "7")])
            ]);

        var ex = Assert.Throws<ParseException>(() => new LayoutParser().Parse(result));
        Assert.Equal("results_table_not_found", ex.Code);
    }

    [Fact]
    public void Parse_NoReportDateInContent_ThrowsReportDateNotFound()
    {
        var result = BuildAnalyzeResult(
            content: "no date pattern here at all",
            tables:
            [
                BuildTable(
                    ("Analyse", "Bezeichnung", "Ergebniswert", "+/-", "Einheit", "Ergebnistext", "Normbereich"),
                    [("ABC", "Something", "1", "", "u", "", "0-1")])
            ]);

        var ex = Assert.Throws<ParseException>(() => new LayoutParser().Parse(result));
        Assert.Equal("report_date_not_found", ex.Code);
    }

    [Fact]
    public void Parse_TableMatchesButNoRowsSurviveFiltering_ThrowsNoAnalyteRows()
    {
        var result = BuildAnalyzeResult(
            content: "report vom 01.01.2026",
            tables:
            [
                BuildTable(
                    ("Analyse", "Bezeichnung", "Ergebniswert", "+/-", "Einheit", "Ergebnistext", "Normbereich"),
                    [("****", "separator only", "", "", "", "", "")])
            ]);

        var ex = Assert.Throws<ParseException>(() => new LayoutParser().Parse(result));
        Assert.Equal("no_analyte_rows", ex.Code);
    }

    private static AnalyzeResult BuildAnalyzeResult(string content, IEnumerable<DocumentTable> tables)
    {
        var json = System.Text.Json.JsonSerializer.Serialize(new
        {
            apiVersion = "2024-11-30",
            modelId = "prebuilt-layout",
            stringIndexType = "textElements",
            content,
            pages = Array.Empty<object>(),
            tables = tables.Select(TableToJson).ToArray(),
        });
        return ModelReaderWriter.Read<AnalyzeResult>(BinaryData.FromString(json))!;
    }

    private static object TableToJson(DocumentTable table) => new
    {
        rowCount = table.RowCount,
        columnCount = table.ColumnCount,
        cells = table.Cells.Select(c => new { rowIndex = c.RowIndex, columnIndex = c.ColumnIndex, content = c.Content }),
    };

    private static DocumentTable BuildTable((string, string, string, string, string, string, string) header, IReadOnlyList<(string, string, string, string, string, string, string)> dataRows)
    {
        var headerValues = new[] { header.Item1, header.Item2, header.Item3, header.Item4, header.Item5, header.Item6, header.Item7 };
        var cells = new List<object>();
        for (var col = 0; col < headerValues.Length; col++)
        {
            cells.Add(new { rowIndex = 0, columnIndex = col, content = headerValues[col] });
        }
        for (var rowIndex = 0; rowIndex < dataRows.Count; rowIndex++)
        {
            var row = dataRows[rowIndex];
            var values = new[] { row.Item1, row.Item2, row.Item3, row.Item4, row.Item5, row.Item6, row.Item7 };
            for (var col = 0; col < values.Length; col++)
            {
                cells.Add(new { rowIndex = rowIndex + 1, columnIndex = col, content = values[col] });
            }
        }

        var json = System.Text.Json.JsonSerializer.Serialize(new
        {
            rowCount = dataRows.Count + 1,
            columnCount = headerValues.Length,
            cells,
        });
        return ModelReaderWriter.Read<DocumentTable>(BinaryData.FromString(json))!;
    }
}
