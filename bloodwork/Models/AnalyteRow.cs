namespace Bloodwork.Models;

/// <summary>
/// One parsed analyte row, before it becomes a <see cref="BloodworkResultEntity"/>.
/// Produced by <see cref="Bloodwork.Services.LayoutParser"/>.
/// </summary>
public sealed record AnalyteRow(
    string Analyse,
    string Bezeichnung,
    string Ergebniswert,
    string Flag,
    string Einheit,
    string Ergebnistext,
    string Normbereich);
