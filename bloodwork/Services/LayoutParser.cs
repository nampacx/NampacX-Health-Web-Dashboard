using System.Text.RegularExpressions;
using Azure.AI.DocumentIntelligence;
using Bloodwork.Models;
using Bloodwork.Models.Exceptions;

namespace Bloodwork.Services;

/// <summary>
/// Matches the results table structurally -- by scanning for a header row
/// whose cells match a known set of German column names -- rather than
/// hardcoding cell coordinates, since Document Intelligence's prebuilt-layout
/// model returns one table per page and a merged title row above the real
/// header is common. Mirrors this repo's existing preference (see
/// src/api/google/normalize.ts) for structural parsing over per-format
/// special-casing.
/// </summary>
public sealed partial class LayoutParser
{
    // "analyse" duplicated in the field list under both its header spelling
    // and its output field name -- Analyse is both.
    private static readonly string[] HeaderNames =
        ["analyse", "bezeichnung", "ergebniswert", "+/-", "einheit", "ergebnistext", "normbereich"];

    private static readonly string[] FieldNames =
        ["Analyse", "Bezeichnung", "Ergebniswert", "Flag", "Einheit", "Ergebnistext", "Normbereich"];

    // Tolerant of 1-2 OCR-mangled header cells (of 7) rather than requiring
    // an exact match on all of them.
    private const int MinHeaderMatches = 5;

    // A merged title cell above the real header row is common in DI table
    // extraction from bordered PDF tables, so the header search isn't
    // limited to RowIndex 0.
    private const int MaxHeaderRowScan = 3;

    public (string ReportDate, IReadOnlyList<AnalyteRow> Rows) Parse(AnalyzeResult result)
    {
        // "vom DD.MM.YYYY" is the date the lab attributes the results to;
        // the document's separate "Datum:" line is just when the page was
        // printed/rendered, which could be a reprint. Matched against the
        // full concatenated document text -- simplest and most robust to the
        // exact visual position of the header line -- rather than per-page,
        // per-line bounding-box parsing.
        var reportDate = ExtractReportDate(result.Content);
        if (reportDate is null)
        {
            throw new ParseException(
                "report_date_not_found",
                "Could not locate \"vom DD.MM.YYYY\" in the document text.");
        }

        var rows = new List<AnalyteRow>();
        var matchedAnyTable = false;

        // A multi-page report restates the header row on each page -- DI
        // returns one Tables entry per page -- so every table is scanned,
        // not just the first.
        foreach (var table in result.Tables)
        {
            var headerRowIndex = FindHeaderRowIndex(table);
            if (headerRowIndex is null)
            {
                continue;
            }
            matchedAnyTable = true;

            var columnMap = BuildColumnMap(table, headerRowIndex.Value);
            var dataRowIndices = table.Cells
                .Select(c => c.RowIndex)
                .Where(r => r > headerRowIndex.Value)
                .Distinct()
                .OrderBy(r => r);

            foreach (var rowIndex in dataRowIndices)
            {
                var row = MapRow(table, rowIndex, columnMap);
                if (row is null)
                {
                    continue;
                }

                // Section-separator rows carry an "ID: ..." label rather
                // than an analyte, e.g. "**** ID: 676, LA(Vorlaeufiger
                // Befund) - Labor Dr. Gaertner".
                if (row.Analyse.StartsWith("****", StringComparison.Ordinal))
                {
                    continue;
                }

                // Nothing to record for a row with neither a result value
                // nor a free-text result.
                if (string.IsNullOrWhiteSpace(row.Ergebniswert) && string.IsNullOrWhiteSpace(row.Ergebnistext))
                {
                    continue;
                }

                rows.Add(row);
            }
        }

        if (!matchedAnyTable)
        {
            throw new ParseException(
                "results_table_not_found",
                "Could not locate the results table by its column headers.");
        }
        if (rows.Count == 0)
        {
            throw new ParseException(
                "no_analyte_rows",
                "Results table found but no analyte rows survived filtering.");
        }

        return (reportDate, rows);
    }

    private static string? ExtractReportDate(string content)
    {
        var match = ReportDatePattern().Match(content);
        if (!match.Success)
        {
            return null;
        }

        var day = match.Groups[1].Value;
        var month = match.Groups[2].Value;
        var year = match.Groups[3].Value;
        // Built manually from the three capture groups -- no locale-dependent
        // DateTime.Parse of a "DD.MM.YYYY" string.
        return year + "-" + month + "-" + day;
    }

    private static int? FindHeaderRowIndex(DocumentTable table)
    {
        for (var rowIndex = 0; rowIndex < MaxHeaderRowScan; rowIndex++)
        {
            var cellsInRow = table.Cells.Where(c => c.RowIndex == rowIndex).ToList();
            if (cellsInRow.Count == 0)
            {
                continue;
            }

            var matches = cellsInRow.Count(c => HeaderNames.Contains(Normalize(c.Content)));
            if (matches >= MinHeaderMatches)
            {
                return rowIndex;
            }
        }
        return null;
    }

    private static Dictionary<int, string> BuildColumnMap(DocumentTable table, int headerRowIndex)
    {
        var map = new Dictionary<int, string>();
        foreach (var cell in table.Cells.Where(c => c.RowIndex == headerRowIndex))
        {
            var normalized = Normalize(cell.Content);
            var headerIndex = Array.IndexOf(HeaderNames, normalized);
            if (headerIndex >= 0)
            {
                map[cell.ColumnIndex] = FieldNames[headerIndex];
            }
        }
        return map;
    }

    private static AnalyteRow? MapRow(DocumentTable table, int rowIndex, Dictionary<int, string> columnMap)
    {
        var values = new Dictionary<string, string>();
        foreach (var cell in table.Cells.Where(c => c.RowIndex == rowIndex))
        {
            if (columnMap.TryGetValue(cell.ColumnIndex, out var field))
            {
                values[field] = cell.Content?.Trim() ?? string.Empty;
            }
        }

        if (!values.TryGetValue("Analyse", out var analyse) || string.IsNullOrWhiteSpace(analyse))
        {
            return null;
        }

        return new AnalyteRow(
            Analyse: analyse,
            Bezeichnung: values.GetValueOrDefault("Bezeichnung", string.Empty),
            Ergebniswert: values.GetValueOrDefault("Ergebniswert", string.Empty),
            Flag: values.GetValueOrDefault("Flag", string.Empty),
            Einheit: values.GetValueOrDefault("Einheit", string.Empty),
            Ergebnistext: values.GetValueOrDefault("Ergebnistext", string.Empty),
            Normbereich: values.GetValueOrDefault("Normbereich", string.Empty));
    }

    private static string Normalize(string? s) => (s ?? string.Empty).Trim().ToLowerInvariant();

    [GeneratedRegex(@"vom\s+(\d{2})\.(\d{2})\.(\d{4})")]
    private static partial Regex ReportDatePattern();
}
