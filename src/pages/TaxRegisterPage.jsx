// Reports → Tax Register.
//
// Every tax line for a masa pajak (tax month), one row per document and tax,
// with DPP, rate and tax amount: the end-of-month recap GKB builds by hand
// today, exportable to Excel. lib/taxRegister.js builds the rows and the
// column list; this page totals them, checks them against the ledger and
// filters the table.
//
// PPN rows are dated by the posting date of the bill or invoice; PPh rows by
// the payment, because Klay recognises withholding when a bill is paid.

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useBills } from "../state/BillsContext";
import { useInvoices } from "../state/InvoicesContext";
import { useVendors } from "../state/VendorsContext";
import { useCustomers } from "../state/CustomersContext";
import { useJournalEntries } from "../state/JournalEntriesContext";
import { useCurrentUser } from "../state/CurrentUserContext";
import { COMPANY } from "../data/seed/company";
import { formatDateEn } from "../lib/format";
import { monthLabel, periodPresets, recentMonthEnds, todayIso } from "../lib/reportPeriods";
import { downloadCsv, reportHeader, exportName, printReport } from "../lib/reportExport";
import { TAX_TYPE_BY_KEY, TAX_REGISTER_COLUMNS, buildTaxRegister, totalsByType, masaLabel } from "../lib/taxRegister";
import "./modules.css";
import "./invoices-ledger.css";
import "./cashflow-report.css";
import "./profit-loss.css";
import "./tax-register.css";

const num = (v) => (v == null ? "—" : Math.abs(v) < 0.005 ? "—" : (v < 0 ? "(" : "") + Math.abs(v).toLocaleString("id-ID") + (v < 0 ? ")" : ""));
const rp = (v) => (v < 0 ? "(Rp " : "Rp ") + Math.abs(v || 0).toLocaleString("id-ID") + (v < 0 ? ")" : "");
const rate = (v) => (v == null ? "—" : `${v.toLocaleString("id-ID")}%`);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const ALL = "all";

// The months a masa can be picked from: this month to date, then the eleven before it.
function masaOptions() {
  return [todayIso(), ...recentMonthEnds(11)].map((d, i) => ({
    value: d.slice(0, 7),
    label: i === 0 ? `${monthLabel(d)} · to date` : monthLabel(d),
  }));
}

// Export menu: Excel (CSV) and Print / PDF — same as Profit & Loss.
function ExportMenu({ onCsv, onPrint }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);
  const pick = (fn) => { setOpen(false); fn(); };
  return (
    <div className="lg-meta-btn-wrap" ref={ref}>
      <button type="button" className="lg-btn-brand" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
        Export
      </button>
      {open && (
        <div className="lg-popover" role="menu">
          <div className="lg-popover-list">
            <button type="button" role="menuitem" className="lg-popover-item" onClick={() => pick(onCsv)}>Excel (CSV)</button>
            <button type="button" role="menuitem" className="lg-popover-item" onClick={() => pick(onPrint)}>Print / PDF</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function TaxRegisterPage() {
  const navigate = useNavigate();
  const { bills } = useBills();
  const { invoices } = useInvoices();
  const { vendors } = useVendors();
  const { customers } = useCustomers();
  const { entries } = useJournalEntries();
  const { user } = useCurrentUser();

  // ── Parameters ────────────────────────────────────────────────────────────
  const months = useMemo(masaOptions, []);
  const lastMonth = periodPresets().find((p) => p.key === "last_month").from.slice(0, 7);
  const [ym, setYm] = useState(lastMonth);
  const [typeFilter, setTypeFilter] = useState(ALL);
  const [search, setSearch] = useState("");

  // ── Rows ──────────────────────────────────────────────────────────────────
  const allRows = useMemo(
    () => buildTaxRegister({ ym, bills, invoices, vendors, customers, entries }),
    [ym, bills, invoices, vendors, customers, entries],
  );
  // The masa's posted lines — what the summary totals. The table narrows them further.
  const masaRows = useMemo(() => allRows.filter((r) => r.posted), [allRows]);
  const totals = useMemo(() => totalsByType(masaRows), [masaRows]);

  // A type the new masa doesn't have falls back to all.
  const activeType = totals.some((t) => t.type === typeFilter) ? typeFilter : ALL;
  const q = search.trim().toLowerCase();
  const searched = useMemo(() => (q
    ? masaRows.filter((r) => [r.party, r.npwp, r.docNo, r.ref, r.jeNumber, r.taxDocNo, r.memo].some((v) => v && v.toLowerCase().includes(q)))
    : masaRows), [masaRows, q]);
  const rows = activeType === ALL ? searched : searched.filter((r) => r.type === activeType);
  const groups = totalsByType(rows).map((t) => ({ ...t, rows: rows.filter((r) => r.type === t.type) }));
  const pills = [
    { k: ALL, lbl: "All", count: searched.length },
    ...totals.map((t) => ({ k: t.type, lbl: TAX_TYPE_BY_KEY[t.type].label, count: searched.filter((r) => r.type === t.type).length })),
  ];

  const screenCols = TAX_REGISTER_COLUMNS.filter((c) => c.screen !== false);
  // A subtotal's label runs across every column before the first amount.
  const labelSpan = Math.max(1, screenCols.findIndex((c) => c.num));
  const masaText = monthLabel(`${ym}-01`);
  const resetFilters = () => { setTypeFilter(ALL); setSearch(""); };

  // ── Export ────────────────────────────────────────────────────────────────
  const filterText = [
    activeType !== ALL && TAX_TYPE_BY_KEY[activeType].label,
    q && `matching "${search.trim()}"`,
  ].filter(Boolean).join(" · ") || "All tax types";

  const exportCsv = () => {
    // The lines, then a total per tax type below them — kept apart so the
    // lines stay a clean list for a pivot table.
    const totalRows = groups.map((t) => ({ total: true, type: t.type, label: `Total ${TAX_TYPE_BY_KEY[t.type].label}`, count: t.count, dpp: t.noDpp === t.count ? null : t.dpp, tax: t.tax }));
    const columns = TAX_REGISTER_COLUMNS.map((c) => ({
      label: c.label,
      value: (r) => {
        if (r.blank) return "";
        if (!r.total) return c.value(r);
        if (c.key === "type") return r.label;
        if (c.key === "docNo") return plural(r.count, "line");
        if (c.key === "dpp") return r.dpp;
        if (c.key === "tax") return r.tax;
        if (c.key === "account") return TAX_TYPE_BY_KEY[r.type].account || "";
        return "";
      },
    }));
    downloadCsv(exportName("tax-register", ym), {
      header: reportHeader({ report: "Tax Register", period: `Masa ${masaLabel(ym)} · ${filterText}`, runBy: user?.name }),
      columns,
      rows: [...rows, ...(totalRows.length ? [{ blank: true }] : []), ...totalRows],
    });
  };

  // ── Cells ─────────────────────────────────────────────────────────────────
  const cell = (c, r) => {
    switch (c.key) {
      case "type": return <span className={`tr-type tr-type-${TAX_TYPE_BY_KEY[r.type]?.side}`}>{TAX_TYPE_BY_KEY[r.type]?.label}</span>;
      case "docNo": return (
        <div className="tr-doc">
          {r.link
            ? <button type="button" className="pl-amt-link tr-doc-no" onClick={() => navigate(r.link)}>{r.docNo}</button>
            : <span className="tr-doc-no">{r.docNo}</span>}
          <span className="tr-sub">
            {r.source}{r.ref && r.ref !== r.docNo ? ` · ${r.ref}` : ""}{r.source === "Payment" && r.jeNumber ? ` · ${r.jeNumber}` : ""}
          </span>
        </div>
      );
      case "docDate": return formatDateEn(r.docDate);
      case "postingDate": return r.postingDate ? formatDateEn(r.postingDate) : <span className="tr-muted">—</span>;
      case "party":
        if (r.party) {
          const to = r.partyId ? `/${r.partyKind === "customer" ? "customers" : "vendors"}/${r.partyId}` : null;
          return to ? <button type="button" className="tr-party" onClick={() => navigate(to)}>{r.party}</button> : r.party;
        }
        return <span className="tr-muted" title="Manual journal — no vendor or customer on it">{r.memo || "—"}</span>;
      case "npwp": return r.npwp ? <span className="tr-mono">{r.npwp}</span> : <span className="tr-muted">—</span>;
      case "taxDocNo": return r.taxDocNo ? <span className="tr-mono">{r.taxDocNo}</span> : <span className="tr-muted">—</span>;
      case "dpp": return num(r.dpp);
      case "rate": return rate(r.rate);
      case "tax": return num(r.tax);
      case "account": return r.account
        ? <button type="button" className="pl-amt-link tr-mono" title={`Open ${r.account} in the General Ledger (${masaText})`} onClick={() => navigate(`/general-ledger?account=${r.account}&period=${ym}`)}>{r.account}</button>
        : "—";
      default: return c.value(r);
    }
  };

  return (
    <div className="lg-page pl-page tr-page">
      <div className="lg-scroll-container">
        {/* ── Print header ─────────────────────────────────────────────── */}
        <div className="print-only pl-print-head">
          <div className="pl-print-co">{COMPANY.legalName}</div>
          <div className="pl-print-title">Tax Register</div>
          <div className="pl-print-period">Masa {masaLabel(ym)} ({masaText}) · {filterText}</div>
        </div>

        {/* ── Header + summary ─────────────────────────────────────────── */}
        <div className="lg-head lg-head-plain no-print">
          <div className="lg-head-top">
            <div style={{ flex: 1, minWidth: 0 }}>
              <button type="button" className="cfr-back" onClick={() => navigate("/reports")}>← Reports</button>
              <h1 className="lg-title">Tax Register</h1>
              <p className="cfr-lede">
                Every PPN and PPh line for masa {masaText}, per vendor and document. PPN is dated by the posting date;
                PPh by the payment date, when Klay recognises the withholding.
              </p>
            </div>
            <div className="lg-head-actions">
              <select className="pl-select tr-masa" value={ym} onChange={(e) => setYm(e.target.value)} aria-label="Masa pajak">
                {months.map((m) => <option key={m.value} value={m.value}>Masa {m.label}</option>)}
              </select>
              <ExportMenu onCsv={exportCsv} onPrint={printReport} />
            </div>
          </div>

          {totals.length > 0 && (
            <div className="lg-kpi-strip tr-kpis" style={{ gridTemplateColumns: `repeat(${totals.length}, minmax(0, 1fr))` }}>
              {totals.map((t) => {
                const on = activeType === t.type;
                return (
                  <button
                    key={t.type}
                    type="button"
                    className={`lg-kpi-cell tr-kpi${on ? " active" : ""}`}
                    aria-pressed={on}
                    title={on ? "Show all tax types" : `Show only ${TAX_TYPE_BY_KEY[t.type].label}`}
                    onClick={() => setTypeFilter(on ? ALL : t.type)}
                  >
                    <div className="lg-kpi-lbl">{TAX_TYPE_BY_KEY[t.type].label}</div>
                    <div className="lg-kpi-val">{rp(t.tax)}</div>
                    <div className="lg-kpi-sub">
                      {plural(t.count, "line")} · {t.noDpp === t.count ? "no DPP" : `DPP ${rp(t.dpp)}`}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="lg-table-wrap pl-wrap">
          {/* ── Lines ───────────────────────────────────────────────────── */}
          <div className="lg-card pl-card">
            <div className="lg-pills-row no-print">
              {pills.map((p) => (
                <button key={p.k} type="button" className={`lg-pill${activeType === p.k ? " active" : ""}`} onClick={() => setTypeFilter(p.k)}>
                  {p.lbl}
                  <span className="lg-pill-count">{p.count}</span>
                </button>
              ))}
            </div>
            <div className="lg-filter-row no-print">
              <div className="lg-search">
                <svg viewBox="0 0 14 14"><circle cx="6" cy="6" r="3.5" /><path d="M9 9l3 3" strokeLinecap="round" /></svg>
                <input placeholder="Search vendor, customer, NPWP or document no.…" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              {(activeType !== ALL || q) && (
                <div className="lg-filter-meta">
                  <button type="button" className="lg-reset-all" onClick={resetFilters}>Reset all</button>
                </div>
              )}
            </div>

            {rows.length === 0 ? (
              <div className="pl-empty">No tax lines for {masaText}{activeType !== ALL || q ? " with these filters" : ""}.</div>
            ) : (
              <div className="pl-table-scroll">
                <table className="pl-table tr-table">
                  <thead>
                    <tr>
                      {screenCols.map((c) => (
                        <th key={c.key} className={c.num ? "pl-num" : ""} title={c.key === "postingDate" ? "PPN: when the bill or invoice posted. PPh: the payment date." : undefined}>
                          {c.label.replace(/ \((Rp|%)\)$/, "")}{c.num && c.key !== "rate" && <span className="pl-th-unit"> (Rp)</span>}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map((g) => (
                      <Fragment key={g.type}>
                        {activeType === ALL && (
                          <tr className="pl-row-heading tr-group">
                            <td colSpan={screenCols.length}>{TAX_TYPE_BY_KEY[g.type].label} <span className="pl-sec-count">{plural(g.count, "line")}</span></td>
                          </tr>
                        )}
                        {g.rows.map((r) => (
                          <tr key={r.id} className="tr-row">
                            {screenCols.map((c) => (
                              <td key={c.key} className={`${c.num ? "pl-num" : ""} tr-c-${c.key}`}>{cell(c, r)}</td>
                            ))}
                          </tr>
                        ))}
                        <tr className="pl-row-subtotal minor">
                          <td colSpan={labelSpan}>Total {TAX_TYPE_BY_KEY[g.type].label}</td>
                          {screenCols.slice(labelSpan).map((c) => (
                            <td key={c.key} className={c.num ? "pl-num" : ""}>
                              {c.key === "dpp" ? (g.noDpp === g.count ? "—" : num(g.dpp)) : c.key === "tax" ? num(g.tax) : ""}
                            </td>
                          ))}
                        </tr>
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <p className="pl-foot">
            Posted lines only. DPP is the tax base. Manual journals show their memo in place of a vendor.
          </p>
        </div>
      </div>
    </div>
  );
}
