// Report export — shared by the financial reports.
//
//   downloadCsv  An Excel-friendly CSV: a few header lines (company, report,
//                period, run date, run by), a blank line, then the table. A
//                UTF-8 BOM so Excel reads "Rp" and accents correctly; numbers
//                written plain (no thousands separators) so they stay numbers.
//   printReport  The browser's print dialog, which also saves to PDF. The
//                print stylesheet (index.css) hides the sidebar and controls,
//                and shows .print-only report headers.

import { COMPANY } from "../data/seed/company";

const cell = (v) => {
  if (v == null) return "";
  const s = typeof v === "number" ? String(Math.round(v * 100) / 100) : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function reportHeader({ report, period, runBy }) {
  const runAt = new Date().toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  return [
    [COMPANY.legalName],
    [report],
    period ? [period] : null,
    [`Run ${runAt}${runBy ? ` by ${runBy}` : ""}`],
  ].filter(Boolean);
}

// columns: [{ label, value(row) }]
export function downloadCsv(filename, { header = [], columns, rows }) {
  const lines = [
    ...header.map((r) => r.map(cell).join(",")),
    ...(header.length ? [""] : []),
    columns.map((c) => cell(c.label)).join(","),
    ...rows.map((r) => columns.map((c) => cell(c.value(r))).join(",")),
  ];
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function printReport() {
  window.print();
}

// "trial-balance_2025-01-01_2025-04-23.csv"
export const exportName = (slug, ...parts) => `${[slug, ...parts].filter(Boolean).join("_")}.csv`;
