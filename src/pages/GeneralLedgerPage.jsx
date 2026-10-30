// General Ledger — every journal line, by account (Core Ledger PRD §3).
//
// The Journal Entry page is where transactions are made and checked: one entry,
// all its lines, debits equal to credits. This page answers the other question
// — what has happened to an account, and what it now holds — by reading the
// same lines regrouped. It is a read model: nothing is typed into it.
// Reclassifying from the GL (§3.5) is off the page for now — an open item.
// Its pieces (buildReclassification, ReclassDialog) stay for when it returns.
//
// Laid out the way a GL is read and exported: one block per account in
// chart-of-accounts code order, each with its opening balance, the period's
// lines by date with a running balance, and its closing balance. Picking an
// account narrows the page to its block. Every line names its partner (vendor,
// customer or payee) so an exported ledger can be traced line by line.
// There is no per-account summary here: that is the Trial Balance (§0, §6),
// which links into this page by account.
//
// Every filter (§3.4) stacks across both. Only posted lines move a balance;
// draft and pending lines show, tagged, when the user asks for them.
// The ledger logic lives in lib/generalLedger.js; the slide-over, dialog and
// popovers in GlPanels.jsx.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useJournalEntries } from "../state/JournalEntriesContext";
import { useCurrentUser } from "../state/CurrentUserContext";
import { useAccountingSettings } from "../state/AccountingSettingsContext";
import { useBills } from "../state/BillsContext";
import { useInvoices } from "../state/InvoicesContext";
import { DIM_BY_KEY } from "../data/seed/dimensions";
import { TODAY } from "../lib/clock";
import { formatDateEn } from "../lib/format";
import { periodPresets, monthLabel, rangeLabel } from "../lib/reportPeriods";
import { downloadCsv, reportHeader } from "../lib/reportExport";
import { downloadXlsx, colName } from "../lib/xlsxExport";
import { isoOf } from "../lib/journalLifecycle";
import {
  glLines, lineMatches, lineSearchText, accountLedger, accountMeta, activeFilterCount,
  EMPTY_FILTERS, GROUP_BY_KEY,
} from "../lib/generalLedger";
import { JE_SOURCE_LABEL, STATUS_LABEL, STATUS_BADGE_CLASS, useJournalActions } from "./journalEntryShared";
import {
  GlEntryDrawer, FiltersPopover, ColumnsPopover, usePopoverClose, FILTER_DIMS, fmtAmt, fmtBal,
} from "./GlPanels";
import "./modules.css";
import "./invoices-ledger.css";
import "./general-ledger.css";

const pad = (n) => String(n).padStart(2, "0");
const CURRENT_YM = `${TODAY.getFullYear()}-${pad(TODAY.getMonth() + 1)}`;
const lastDay = (ym) => new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).getUTCDate();
const EXPORT_CAP = 100000;

// Where a line came from: the kind of document (Source) and its number
// (Source no.), the way Accurate's and Odoo's ledgers split them. The number
// is the drill-down anchor (§3.3 source_transaction_id). A payment or receipt
// carries the bill or invoice it settles; a reversal or reclassification the
// entry it corrects.
const SOURCE_TYPE = {
  bill: "Bill", ap_bill: "Bill",
  bill_payment: "Bill payment", payment: "Bill payment",
  invoice: "Invoice", invoice_payment: "Invoice payment",
  reversal: "Reversal", reclassification: "Reclassification",
  schedule: "Fixed asset", inventory_movement: "Inventory",
};
const sourceType = (l) => SOURCE_TYPE[l.reference_type] || (l.source === "manual" ? "Journal entry" : JE_SOURCE_LABEL[l.source]);
const sourceNo = (l) => (l.reference_type === "manual" ? l.reference : l.reference_id || l.reference) || "";

// Columns of the ledger. Grouped by account, the account is each block's
// header, so it is not a column; ungrouped (Group by: None), it is, and the
// running balance goes — a balance across accounts means nothing. `opt` ones
// are switched on in Columns.
const LINE_COLUMNS = [
  { key: "date", label: "Date", w: "84px" },
  { key: "entry", label: "Entry", w: "108px" },
  { key: "account", label: "Account", w: "minmax(170px, 1fr)", flat: true },
  { key: "source", label: "Source", w: "104px" },
  { key: "sourceNo", label: "Source no.", w: "100px", opt: true },
  { key: "party", label: "Partner", w: "minmax(140px, .8fr)", opt: true },
  { key: "desc", label: "Description", w: "minmax(190px, 1.4fr)" },
  ...FILTER_DIMS.map((k) => ({ key: `dim:${k}`, label: DIM_BY_KEY[k]?.label || k, w: "100px", opt: true })),
  { key: "status", label: "Status", w: "104px", opt: true },
  { key: "currency", label: "Currency", w: "64px", opt: true },
  { key: "debit", label: "Debit", w: "116px", num: true },
  { key: "credit", label: "Credit", w: "116px", num: true },
  { key: "balance", label: "Balance", w: "128px", num: true, grouped: true },
];
// Lines across accounts, in the order they happened.
const byDate = (a, b) => a.date.localeCompare(b.date) || a.je_number.localeCompare(b.je_number) || a.lineIndex - b.lineIndex;
// Source no., Partner and Currency show by default and can be switched off;
// the Report export follows what is shown. Status is off by default, like
// Odoo, Xero and Accurate: the ledger shows posted lines unless Filters →
// Status asks for more, and an unposted line then carries its own badge. The
// key is versioned so an earlier saved choice doesn't hide the new defaults.
const DEFAULT_SHOWN = ["sourceNo", "party", "currency"];
const COLS_KEY = "klay.gl.columns.v3";
function loadShown() {
  try {
    const v = JSON.parse(window.localStorage.getItem(COLS_KEY));
    return Array.isArray(v) ? v : DEFAULT_SHOWN;
  } catch { return DEFAULT_SHOWN; }
}

// ── Account picker ───────────────────────────────────────────────────────
// The chosen account sits in a box — what it is, its code and where it
// closed — and opens a searchable list by account number. Same idea as the
// bank-account cards on Bank Reconciliation, sized for a chart of accounts.
function AccountPicker({ accounts, value, onChange, periodLbl }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef(null);
  usePopoverClose(open, ref, useCallback(() => setOpen(false), []));

  // An account with no activity in the period is not in the list, but is
  // still the one chosen.
  const current = accounts.find((s) => s.meta.code === value) || (value ? { meta: accountMeta(value), closing: null } : null);
  const needle = q.trim().toLowerCase();
  // One list by account number, the order the ledger itself runs in.
  const items = accounts.filter((s) => !needle || `${s.meta.code} ${s.meta.name}`.toLowerCase().includes(needle));
  const pick = (code) => { onChange(code); setOpen(false); setQ(""); };

  return (
    <div className="gl-picker" ref={ref}>
      <button type="button" className={`gl-acct-box${open ? " open" : ""}`} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {current ? (
          <>
            <span className="gl-acct-badge" style={{ background: GROUP_BY_KEY[current.meta.group].color }}>
              {GROUP_BY_KEY[current.meta.group].lbl.slice(0, 1)}
            </span>
            <span className="gl-acct-box-id">
              <span className="gl-acct-box-name">{current.meta.name}</span>
              <span className="gl-acct-box-meta">{current.meta.code} · {GROUP_BY_KEY[current.meta.group].lbl}</span>
            </span>
            <span className="gl-acct-box-amt">
              <span className="gl-acct-box-amt-lbl">Closing · {periodLbl}</span>
              {current.closing == null ? "No activity" : `Rp ${fmtBal(current.closing)}`}
            </span>
          </>
        ) : (
          <>
            <span className="gl-acct-badge all">∑</span>
            <span className="gl-acct-box-id">
              <span className="gl-acct-box-name">All accounts</span>
              <span className="gl-acct-box-meta">{accounts.length} with activity in {periodLbl}</span>
            </span>
          </>
        )}
        <svg className="gl-acct-chev" viewBox="0 0 12 12" aria-hidden><path d="M3 4.5L6 7.5 9 4.5" /></svg>
      </button>

      {open && (
        <div className="gl-acct-pop" role="listbox">
          <div className="lg-search gl-acct-pop-search">
            <svg viewBox="0 0 16 16" aria-hidden><circle cx="7" cy="7" r="5" /><path d="M11 11l3 3" /></svg>
            <input autoFocus placeholder="Search code or name…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="gl-acct-pop-list">
            {!needle && (
              <button type="button" className={`gl-acct-item${!current ? " selected" : ""}`} onClick={() => pick("")}>
                <span className="gl-acct-badge sm all">∑</span>
                <span className="gl-acct-item-name">All accounts</span>
              </button>
            )}
            {items.length === 0 && <div className="gl-empty">No account matches “{q}”.</div>}
            {items.map((s) => {
              const g = GROUP_BY_KEY[s.meta.group];
              return (
                <button
                  key={s.meta.code}
                  type="button"
                  role="option"
                  aria-selected={value === s.meta.code}
                  className={`gl-acct-item${value === s.meta.code ? " selected" : ""}`}
                  onClick={() => pick(s.meta.code)}
                >
                  <span className="gl-code">{s.meta.code}</span>
                  <span className="gl-acct-dot" style={{ background: g.color }} title={g.lbl} />
                  <span className="gl-acct-item-name">{s.meta.name}</span>
                  <span className="gl-acct-item-amt">{fmtBal(s.closing)}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// One popover button (Filters, Columns, Export) with its panel.
function PopButton({ label, badge, icon, children, disabled, title, align = "left" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  usePopoverClose(open, ref, useCallback(() => setOpen(false), []));
  return (
    <div className={`gl-popwrap ${align}`} ref={ref}>
      <button type="button" className={`lg-btn-ghost gl-popbtn${open ? " open" : ""}`} disabled={disabled} title={title} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {icon}{label}{badge ? <span className="gl-badge-count">{badge}</span> : null}
      </button>
      {open && (typeof children === "function" ? children(() => setOpen(false)) : children)}
    </div>
  );
}

// Period: a preset, a month that has postings, or a custom range. The URL
// keeps `period` (a preset key, YYYY-MM, or "custom" with from/to), so links
// from the Trial Balance and P&L (?period=YYYY-MM) land on the right month.
function resolvePeriod(period, params, presets) {
  const preset = presets.find((p) => p.key === period);
  if (preset) return { from: preset.from, to: preset.to, label: preset.label === "Year to date" ? `Year to date ${preset.from.slice(0, 4)}` : preset.label };
  if (/^\d{4}-\d{2}$/.test(period)) return { from: `${period}-01`, to: `${period}-${pad(lastDay(period))}`, label: monthLabel(`${period}-01`) };
  const ytd = /^ytd-(\d{4})$/.exec(period);
  if (ytd) return { from: `${ytd[1]}-01-01`, to: `${ytd[1]}-12-31`, label: `Year to date ${ytd[1]}` };
  if (period === "custom") {
    const from = params.get("from") || `${CURRENT_YM}-01`;
    const to = params.get("to") || isoOf(TODAY);
    return from <= to ? { from, to, label: rangeLabel(from, to) } : { from: to, to: from, label: rangeLabel(to, from) };
  }
  return { from: `${CURRENT_YM}-01`, to: `${CURRENT_YM}-${pad(lastDay(CURRENT_YM))}`, label: monthLabel(`${CURRENT_YM}-01`) };
}

// What the filters say, for the export header.
function describeFilters(f) {
  const out = [];
  if (f.statuses.length > 1) out.push(`Status: ${f.statuses.map((s) => STATUS_LABEL[s]).join(", ")}`);
  if (f.types.length) out.push(`Type: ${f.types.map((t) => GROUP_BY_KEY[t].lbl).join(", ")}`);
  if (f.codeFrom || f.codeTo) out.push(`Codes: ${f.codeFrom || "…"}–${f.codeTo || "…"}`);
  if (f.sources.length) out.push(`Source: ${f.sources.map((s) => JE_SOURCE_LABEL[s]).join(", ")}`);
  if (f.min !== "" || f.max !== "") out.push(`Amount: ${f.min || "0"}–${f.max || "any"}`);
  if (f.party) out.push(`Partner: ${f.party}`);
  for (const [k, v] of Object.entries(f.dims)) if (v) out.push(`${DIM_BY_KEY[k]?.label || k}: ${v}`);
  if (f.hideReversed) out.push("Reversals hidden");
  return out.join("; ");
}

export default function GeneralLedgerPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { entries } = useJournalEntries();
  const { user, hasCapability } = useCurrentUser();
  const { fiscalYearStart, baseCurrency } = useAccountingSettings();
  const { bills } = useBills();
  const { invoices } = useInvoices();

  const [toast, setToast] = useState("");
  const toastTmr = useRef(null);
  const showToast = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTmr.current);
    toastTmr.current = setTimeout(() => setToast(""), 4200);
  }, []);
  const { sourceOf } = useJournalActions({ showToast });

  const actor = user?.name || "You";
  const canExport = hasCapability("gl.export");

  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [shown, setShown] = useState(loadShown);
  useEffect(() => { try { window.localStorage.setItem(COLS_KEY, JSON.stringify(shown)); } catch { /* per-viewer nicety only */ } }, [shown]);
  const [drawer, setDrawer] = useState(null); // { je_number, line }

  const setParam = (patch) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k); }
    setParams(next, { replace: true });
  };

  // Every line the ledger can show, then the filters — dates aside, since the
  // period decides what is opening balance and what is movement.
  const allLines = useMemo(() => glLines(entries, { bills, invoices, baseCurrency }), [entries, bills, invoices, baseCurrency]);
  const lines = useMemo(() => allLines.filter((l) => lineMatches(l, filters)), [allLines, filters]);

  const presets = useMemo(() => periodPresets({ fiscalYearStart }), [fiscalYearStart]);
  const months = useMemo(
    () => [...new Set(allLines.filter((l) => l.status === "posted").map((l) => l.date.slice(0, 7)))].filter((ym) => ym <= CURRENT_YM).sort().reverse(),
    [allLines],
  );
  const period = params.get("period") || CURRENT_YM;
  const { from, to, label: periodLbl } = resolvePeriod(period, params, presets);
  const account = params.get("account") || "";
  const view = account ? "account" : "lines";
  // Group by: Account (the default — the GL as it is read and exported) or
  // None, one list by date across accounts for questions like "every posting
  // over Rp 150M in December". Kept in the URL; one account is always its block.
  const flat = view !== "account" && params.get("group") === "none";
  const q = search.trim().toLowerCase();

  const parties = useMemo(() => [...new Set(allLines.map((l) => l.party).filter(Boolean))].sort(), [allLines]);
  const filterCount = activeFilterCount(filters);

  // Every account's block in code order — also the account picker's list.
  const ledger = useMemo(() => accountLedger(lines, { from, to }), [lines, from, to]);

  // ── One account ────────────────────────────────────────────────────────
  // Its block, or an empty one when it has nothing in the period.
  const accountView = useMemo(() => {
    if (!account) return null;
    return ledger.find((b) => b.meta.code === account) || {
      meta: accountMeta(account, allLines.find((l) => l.code === account)?.name),
      opening: 0, debit: 0, credit: 0, unposted: 0, rows: [], count: 0, closing: 0,
    };
  }, [account, ledger, allLines]);

  // ── The blocks shown, after search ─────────────────────────────────────
  // Search keeps the matching lines of each block (their balances stay the
  // ones the full ledger gives them) and drops blocks with none.
  const blocks = useMemo(() => {
    const base = view === "account" ? [accountView] : ledger;
    if (!q) return base;
    const kept = base.map((b) => ({ ...b, rows: b.rows.filter((l) => lineSearchText(l).includes(q)) }));
    return view === "account" ? kept : kept.filter((b) => b.rows.length > 0);
  }, [view, accountView, ledger, q]);
  const lineRows = useMemo(() => {
    const rows = blocks.flatMap((b) => b.rows);
    return flat ? rows.sort(byDate) : rows;
  }, [blocks, flat]);
  const lineTotals = lineRows.reduce(
    (t, l) => (l.status === "posted" ? { ...t, dc: t.dc + l.dc, cc: t.cc + l.cc } : { ...t, unposted: t.unposted + 1 }),
    { dc: 0, cc: 0, unposted: 0 },
  );
  // Filters and search that keep some lines of an entry and drop others: with
  // one on, the totals cover matching lines only and needn't balance.
  const cutsEntries = !!(q || filters.types.length || filters.codeFrom || filters.codeTo || filters.min !== "" || filters.max !== ""
    || filters.party || Object.values(filters.dims).some(Boolean));

  const cols = LINE_COLUMNS.filter((c) => (!c.opt || shown.includes(c.key)) && !(c.flat && !flat) && !(c.grouped && flat));
  const grid = { gridTemplateColumns: cols.map((c) => c.w).join(" ") };
  const statusCol = cols.some((c) => c.key === "status");
  const optionalCols = LINE_COLUMNS.filter((c) => c.opt);

  // ── Export (§3.5) ──────────────────────────────────────────────────────
  // Two layouts, the way the ledgers we benchmark against offer them:
  //   • Report — the screen as a document: each account's header, opening
  //     balance, lines and closing balance. Excel, or PDF through print.
  //   • Data   — one row per journal line, with the account, partner and
  //     currency on every row and the account's opening balance as a column
  //     (as Accurate does) instead of opening / closing rows, so a sheet can
  //     be filtered, summed and pivoted. Excel or CSV.
  // What is exported is chosen with the page's own controls — period, account,
  // filters, search — not by ticking rows. "Everything" is every posted line
  // in the ledger, data layout.
  const money = (c) => (c ? c / 100 : null);
  const bal = (c) => (c == null ? null : c / 100);
  // Ledger amounts are in the base currency; a foreign-currency line also
  // gets its rate and its amounts in that currency (Accurate's "Prime").
  const orig = (c, l) => (c ? Math.round(c / l.rate) / 100 : null);
  const scopeLabel = view === "account" ? `${periodLbl} · ${accountView.meta.code} ${accountView.meta.name}` : `${periodLbl} · all accounts${flat ? ", by date" : ""}`;
  const fileBase = (mode) => `general-ledger_${mode === "all" ? "all" : account || "all-accounts"}_${mode === "all" ? isoOf(TODAY) : `${from}_${to}`}`;
  const tooBig = () => showToast(`Over ${EXPORT_CAP.toLocaleString("id-ID")} rows — narrow the period or filters to export this view.`);

  function exportHeader(scope, withFilters) {
    const desc = describeFilters(filters);
    return [
      ...reportHeader({ report: "General Ledger", period: scope, runBy: actor }),
      ...(withFilters && desc ? [[`Filters: ${desc}`]] : []),
      ...(withFilters && q ? [[`Search: ${search.trim()}`]] : []),
    ];
  }

  // Data layout. Columns: { label, value(row), kind: "date" | "num" | text, w }.
  function dataExport(mode) {
    const everything = mode === "all";
    const ledgerBlocks = everything
      ? accountLedger(allLines.filter((l) => l.status === "posted"), { from: "0000-01-01", to: "9999-12-31" })
      : blocks;
    const rows = ledgerBlocks.flatMap((b) => b.rows.map((l) => ({ l, opening: b.opening })));
    if (flat && !everything) rows.sort((a, b) => byDate(a.l, b.l));
    const lines = rows.map((r) => r.l);
    const dimKeys = [...new Set(lines.flatMap((l) => Object.keys(l.dims)))];
    const anyUnposted = lines.some((l) => l.status !== "posted");
    const L = (f) => (r) => f(r.l);
    const columns = [
      { label: "Account code", value: L((l) => l.code), w: 12 },
      { label: "Account name", value: L((l) => l.name), w: 30 },
      { label: "Account type", value: L((l) => GROUP_BY_KEY[l.meta.group].lbl), w: 12 },
      { label: "Date", value: L((l) => l.date), kind: "date", w: 11 },
      { label: "Entry", value: L((l) => l.je_number), w: 14 },
      { label: "Source", value: L(sourceType), w: 15 },
      { label: "Source no.", value: L(sourceNo), w: 14 },
      { label: "Partner", value: L((l) => l.party), w: 28 },
      { label: "Partner type", value: L((l) => l.partyKind), w: 12 },
      { label: "Description", value: L((l) => l.desc), w: 40 },
      ...dimKeys.map((k) => ({ label: DIM_BY_KEY[k]?.label || k, value: L((l) => l.dims[k] || ""), w: 14 })),
      ...(anyUnposted ? [{ label: "Status", value: L((l) => STATUS_LABEL[l.status]), w: 14 }] : []),
      { label: "Currency", value: L((l) => l.currency), w: 9 },
      { label: "Rate", value: L((l) => l.rate), kind: "num", w: 11 },
      { label: "Debit (original)", value: L((l) => orig(l.dc, l)), kind: "num", w: 16 },
      { label: "Credit (original)", value: L((l) => orig(l.cc, l)), kind: "num", w: 16 },
      { label: `Debit (${baseCurrency})`, value: L((l) => money(l.dc)), kind: "num", w: 18 },
      { label: `Credit (${baseCurrency})`, value: L((l) => money(l.cc)), kind: "num", w: 18 },
      ...(everything ? [] : [{ label: "Opening balance", value: (r) => r.opening / 100, kind: "num", w: 18 }]),
      { label: "Balance", value: L((l) => bal(l.balance)), kind: "num", w: 18 },
    ];
    return { header: exportHeader(everything ? "All posted lines" : scopeLabel, !everything), columns, rows };
  }

  function runDataExport(mode, format) {
    const data = dataExport(mode);
    if (data.rows.length > EXPORT_CAP) { tooBig(); return; }
    const header = [...data.header, [`${data.rows.length} lines`]];
    if (format === "csv") downloadCsv(`${fileBase(mode)}.csv`, { ...data, header });
    else {
      const top = header.length + 2; // header block, blank row, column headings
      downloadXlsx(`${fileBase(mode)}.xlsx`, {
        sheet: "General Ledger",
        rows: [
          ...header.map((r, i) => (i === 0 ? [{ v: r[0], s: "bold" }] : i === 1 ? [{ v: r[0], s: "title" }] : r)),
          [],
          data.columns.map((c) => ({ v: c.label, s: c.kind === "num" ? "headNum" : "head" })),
          ...data.rows.map((r) => data.columns.map((c) => ({ v: c.value(r), s: c.kind || "text" }))),
        ],
        widths: data.columns.map((c) => c.w),
        freeze: top,
        filter: top,
      });
    }
    showToast(`Exported ${data.rows.length} lines`);
  }

  // Report layout, Excel: the screen's columns, each account as a block. As in
  // DualEntry, totals are live formulas — a closing row sums its account's
  // posted lines and rolls the opening balance forward, the last row sums the
  // closing rows — so they follow if someone edits a figure in the sheet.
  // Ungrouped, it is the lines by date with one total row.
  const REPORT_W = { date: 11, entry: 14, account: 34, source: 15, sourceNo: 14, party: 28, desc: 44, status: 12, currency: 9, debit: 18, credit: 18, balance: 18 };
  function runReportExcel() {
    if (lineRows.length > EXPORT_CAP) { tooBig(); return; }
    const at = Object.fromEntries(cols.map((c, i) => [c.key, i]));
    const D = colName(at.debit), C = colName(at.credit), B = colName(at.balance);
    // SUM over row numbers, as ranges of consecutive rows ("H9:H12,H14").
    // Excel takes up to 255 arguments; beyond that the plain value stands.
    const sumOf = (col, nums) => {
      const parts = [];
      for (let i = 0; i < nums.length; i++) {
        let j = i;
        while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
        parts.push(i === j ? `${col}${nums[i]}` : `${col}${nums[i]}:${col}${nums[j]}`);
        i = j;
      }
      return parts.length && parts.length <= 255 ? `SUM(${parts.join(",")})` : undefined;
    };
    const row = (cells, s = "text", formulas = {}) => cols.map((c) => {
      const v = cells[c.key] ?? null;
      return { v, s: c.num ? (s === "bold" ? "numBold" : "num") : s, f: formulas[c.key] };
    });
    const valueOf = (c, l) => {
      if (c.key.startsWith("dim:")) return { v: l.dims[c.key.slice(4)] || "" };
      switch (c.key) {
        case "date": return { v: l.date, s: "date" };
        case "entry": return { v: l.je_number };
        case "account": return { v: `${l.code}  ${l.name}` };
        case "source": return { v: sourceType(l) };
        case "sourceNo": return { v: sourceNo(l) };
        case "party": return { v: l.party };
        case "desc": return { v: l.status !== "posted" && at.status == null ? `${l.desc} [${STATUS_LABEL[l.status]}]` : l.desc };
        case "status": return { v: STATUS_LABEL[l.status] };
        case "currency": return { v: l.currency };
        case "debit": return { v: money(l.dc), s: "num" };
        case "credit": return { v: money(l.cc), s: "num" };
        case "balance": return { v: bal(l.balance), s: "num" };
        default: return { v: null };
      }
    };
    const header = exportHeader(scopeLabel, true);
    const out = [
      ...header.map((r, i) => (i === 0 ? [{ v: r[0], s: "bold" }] : i === 1 ? [{ v: r[0], s: "title" }] : r)),
      [],
      cols.map((c) => ({ v: c.label, s: c.num ? "headNum" : "head" })),
    ];
    let totalD = 0, totalC = 0;
    const closingRows = [];
    if (flat) {
      const posted = [];
      for (const l of lineRows) {
        out.push(cols.map((c) => valueOf(c, l)));
        if (l.status === "posted") { posted.push(out.length); totalD += l.dc; totalC += l.cc; }
      }
      out.push(row({ desc: "Total", debit: totalD / 100, credit: totalC / 100 }, "bold", { debit: sumOf(D, posted), credit: sumOf(C, posted) }));
    }
    for (const b of flat ? [] : blocks) {
      const g = GROUP_BY_KEY[b.meta.group];
      out.push([{ v: `${b.meta.code}  ${b.meta.name}`, s: "bold" }, { v: `${g.lbl} · ${b.meta.creditNormal ? "credit-normal" : "debit-normal"}`, s: "muted" }]);
      out.push(row({ desc: `Opening balance · ${formatDateEn(from)}`, balance: b.opening / 100 }, "muted"));
      const openRow = out.length;
      // Draft and pending lines are listed but left out of the sums, as on screen.
      const posted = [];
      for (const l of b.rows) {
        out.push(cols.map((c) => valueOf(c, l)));
        if (l.status === "posted") posted.push(out.length);
      }
      const closeRow = out.length + 1;
      const [plus, minus] = b.meta.creditNormal ? [C, D] : [D, C];
      // A search keeps only some of an account's lines while its closing stays
      // the whole account's: there the figures go in as values, not sums.
      const whole = b.rows.length === b.count;
      out.push(row(
        { desc: `Closing balance · ${formatDateEn(to)}`, debit: b.debit / 100, credit: b.credit / 100, balance: b.closing / 100 },
        "bold",
        whole ? { debit: sumOf(D, posted), credit: sumOf(C, posted), balance: `${B}${openRow}+${plus}${closeRow}-${minus}${closeRow}` } : {},
      ));
      out.push([]);
      closingRows.push(closeRow);
      totalD += b.debit; totalC += b.credit;
    }
    if (!flat && blocks.length > 1) {
      out.push(row(
        { desc: "Total, all accounts", debit: totalD / 100, credit: totalC / 100 },
        "bold",
        { debit: sumOf(D, closingRows), credit: sumOf(C, closingRows) },
      ));
    }
    downloadXlsx(`${fileBase("visible")}_report.xlsx`, {
      sheet: "General Ledger",
      rows: out,
      widths: cols.map((c) => REPORT_W[c.key] || 14),
      freeze: header.length + 2,
    });
    showToast(flat ? `Exported ${lineRows.length} lines` : `Exported ${blocks.length} account${blocks.length === 1 ? "" : "s"}, ${lineRows.length} lines`);
  }

  // Report layout, PDF: the print dialog (which saves to PDF) on a print-only
  // table of the same blocks, landscape. Mounted only while printing.
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    if (!printing) return;
    window.print();
    setPrinting(false);
  }, [printing]);

  // ── Rendering ──────────────────────────────────────────────────────────
  function lineTags(l) {
    return (
      <>
        {l.status !== "posted" && !statusCol && <span className={`badge badge-${STATUS_BADGE_CLASS[l.status]} gl-inline-badge`}>{STATUS_LABEL[l.status]}</span>}
        {l.reversed_by && <span className="gl-tag rev" title={`Reversed by ${l.reversed_by}`}>Reversed</span>}
        {l.reversal_of && <span className="gl-tag rev" title={`Reverses ${l.reversal_of}`}>Reversal</span>}
        {l.reclass_of && <span className="gl-tag reclass" title={`Reclassifies ${l.reclass_of.je_number} line ${l.reclass_of.line + 1}`}>Reclass</span>}
        {l.reclass_open && <span className="gl-tag reclass" title={`Reclassification ${l.reclass_open} is waiting for approval`}>Reclass pending</span>}
        {!l.meta.inCoa && <span className="gl-tag" title="Posted to a code that is not in the chart of accounts">Not in CoA</span>}
      </>
    );
  }
  const openDrawer = (l) => setDrawer({ je_number: l.je_number, line: l.lineIndex });

  function cell(c, l) {
    const unposted = l.status !== "posted";
    switch (c.key) {
      case "date": return <span key={c.key} className="gl-date">{formatDateEn(l.date)}</span>;
      case "entry": return <span key={c.key}><button type="button" className="gl-link mono" onClick={() => openDrawer(l)}>{l.je_number}</button></span>;
      case "source": return <span key={c.key} className="gl-ellip">{sourceType(l)}</span>;
      case "sourceNo": return (
        <span key={c.key} className="gl-src">
          {sourceNo(l) ? <button type="button" className="gl-link gl-src-link mono" onClick={() => openDrawer(l)}>{sourceNo(l)}</button> : <span className="gl-muted">—</span>}
        </span>
      );
      case "currency": return (
        <span key={c.key} className="gl-ccy" title={l.rate !== 1 ? `${l.currency} ${((l.dc || l.cc) / 100 / l.rate).toLocaleString("id-ID", { maximumFractionDigits: 2 })} @ ${l.rate.toLocaleString("id-ID")}` : undefined}>
          {l.currency}
        </span>
      );
      case "account": return (
        <span key={c.key} className="gl-acct">
          <button type="button" className="gl-link mono gl-code-link" onClick={() => { setParam({ account: l.code }); setSearch(""); }}>{l.code}</button>
          <span className="gl-name">{l.name}</span>
        </span>
      );
      case "desc": return <span key={c.key} className="gl-desc" title={l.memo}><span className="gl-desc-text">{l.desc}</span>{lineTags(l)}</span>;
      case "party": return (
        <span key={c.key} className="gl-ellip" title={l.party ? `${l.partyKind ? `${l.partyKind} · ` : ""}${l.party}` : undefined}>
          {l.party || <span className="gl-muted">—</span>}
        </span>
      );
      case "status": return <span key={c.key}><span className={`badge badge-${STATUS_BADGE_CLASS[l.status]}`}>{STATUS_LABEL[l.status]}</span></span>;
      case "debit": return <span key={c.key} className={`num${unposted ? " gl-unposted" : ""}`}>{fmtAmt(l.dc)}</span>;
      case "credit": return <span key={c.key} className={`num${unposted ? " gl-unposted" : ""}`}>{fmtAmt(l.cc)}</span>;
      case "balance": return <span key={c.key} className="num">{l.balance == null ? <span className="gl-muted" title="Not posted — doesn't move the balance">—</span> : fmtBal(l.balance)}</span>;
      default:
        if (c.key.startsWith("dim:")) return <span key={c.key} className="gl-ellip">{l.dims[c.key.slice(4)] || "—"}</span>;
        return <span key={c.key} />;
    }
  }

  const spanRow = (key, label, value, extra = {}, cls = "") => (
    <div key={key} className={`gl-row gl-line-row gl-bal-row${cls}`} style={grid}>
      {cols.map((c) => {
        if (c.key === "desc") return <span key={c.key}>{label}</span>;
        if (c.key === "balance") return <span key={c.key} className="num strong">{value}</span>;
        if (extra[c.key] != null) return <span key={c.key} className="num">{extra[c.key]}</span>;
        return <span key={c.key} />;
      })}
    </div>
  );

  function lineRow(l) {
    return (
      <div key={l.key} className={`gl-row gl-line-row${l.status !== "posted" ? " is-unposted" : ""}`} style={grid}>
        {cols.map((c) => cell(c, l))}
      </div>
    );
  }

  // One line in the print-only report table.
  const printLine = (l) => (
    <tr key={l.key}>
      {cols.map((c) => {
        const v = c.key.startsWith("dim:") ? l.dims[c.key.slice(4)] || "" : {
          date: formatDateEn(l.date), entry: l.je_number, account: `${l.code}  ${l.name}`, source: sourceType(l), sourceNo: sourceNo(l),
          party: l.party, status: STATUS_LABEL[l.status], currency: l.currency,
          desc: l.status !== "posted" && !statusCol ? `${l.desc} [${STATUS_LABEL[l.status]}]` : l.desc,
          debit: l.dc ? fmtAmt(l.dc) : "", credit: l.cc ? fmtAmt(l.cc) : "",
          balance: l.balance == null ? "—" : fmtBal(l.balance),
        }[c.key];
        return <td key={c.key} className={c.num ? "num" : ["date", "entry", "sourceNo"].includes(c.key) ? "nowrap" : ""}>{v}</td>;
      })}
    </tr>
  );

  // The blocks as rows — header (across accounts only), opening, lines,
  // closing. Every line of every block: the ledger is read whole. Ungrouped,
  // just the lines by date.
  const renderRows = flat ? lineRows.map(lineRow) : [];
  for (const b of flat ? [] : blocks) {
    const g = GROUP_BY_KEY[b.meta.group];
    if (view !== "account") {
      renderRows.push(
        <div key={`h:${b.meta.code}`} className="gl-block-head">
          <button type="button" className="gl-link mono gl-code-link" onClick={() => { setParam({ account: b.meta.code }); setSearch(""); }}>{b.meta.code}</button>
          <span className="gl-block-name">{b.meta.name}</span>
          <span className="gl-type"><span className="gl-acct-dot" style={{ background: g.color }} />{g.lbl}</span>
          <span className="gl-block-side">{b.meta.creditNormal ? "Credit-normal" : "Debit-normal"}</span>
        </div>,
      );
    }
    renderRows.push(spanRow(`o:${b.meta.code}`, `Opening balance · ${formatDateEn(from)}`, fmtBal(b.opening)));
    renderRows.push(...b.rows.map(lineRow));
    if (view === "account" && b.rows.length === 0) {
      renderRows.push(
        <div key={`e:${b.meta.code}`} className="gl-empty">
          No postings to this account in {periodLbl}{filterCount || q ? " that match." : "."}
        </div>,
      );
    }
    renderRows.push(spanRow(
      `c:${b.meta.code}`,
      <>Closing balance · {formatDateEn(to)}{b.unposted ? <span className="gl-unposted-note"> · {fmtBal(b.unposted)} not yet posted</span> : null}</>,
      fmtBal(b.closing),
      { debit: fmtAmt(b.debit), credit: fmtAmt(b.credit) },
      " gl-close-row",
    ));
  }

  return (
    <div className="lg-page">
      <div className="lg-scroll-container">
        <div className="lg-head lg-head-plain no-print">
          <div className="lg-head-top">
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1 className="lg-title">General Ledger</h1>
              <p className="gl-sub">
                Every journal line, by account in code order, then by date. Entries are created and posted on the{" "}
                <button type="button" className="gl-link" onClick={() => navigate("/journal-entry")}>Journal Entry</button> page;
                balances by account are on the{" "}
                <button type="button" className="gl-link" onClick={() => navigate("/trial-balance")}>Trial Balance</button>.
              </p>
            </div>
            <div className="lg-head-actions">
              <PopButton
                align="right"
                label="Export"
                disabled={!canExport}
                title={canExport ? undefined : "Your role can read the ledger but not export it"}
                icon={<svg viewBox="0 0 12 12"><path d="M6 1.5v6M3.5 5L6 7.5 8.5 5M2 10h8" /></svg>}
              >
                {(close) => (
                  <div className="gl-pop gl-export" role="menu">
                    <div className="gl-pop-lbl">This view</div>
                    <div className="gl-pop-hint">
                      {view === "account" ? `${accountView.meta.code} ${accountView.meta.name}` : "All accounts"} · {periodLbl}
                      {filterCount ? `, ${filterCount} filter${filterCount > 1 ? "s" : ""}` : ""}{q ? ", searched" : ""}
                    </div>
                    <div className="gl-export-kind">
                      <span className="gl-export-name">Report</span>
                      <span className="gl-export-what">{flat ? "As on screen — lines by date across accounts, with a total" : "As on screen — account headers, opening and closing balances"}</span>
                    </div>
                    <div className="gl-export-btns">
                      <button type="button" className="gl-menu-item" onClick={() => { close(); runReportExcel(); }}>Excel (.xlsx)</button>
                      <button type="button" className="gl-menu-item" onClick={() => { close(); setPrinting(true); }}>PDF / Print</button>
                    </div>
                    <div className="gl-export-kind">
                      <span className="gl-export-name">Data</span>
                      <span className="gl-export-what">One row per line, account and partner on every row — for filters and pivots</span>
                    </div>
                    <div className="gl-export-btns">
                      <button type="button" className="gl-menu-item" onClick={() => { close(); runDataExport("visible", "xlsx"); }}>Excel (.xlsx)</button>
                      <button type="button" className="gl-menu-item" onClick={() => { close(); runDataExport("visible", "csv"); }}>CSV</button>
                    </div>
                    <div className="gl-pop-lbl gl-pop-lbl-gap">Everything</div>
                    <div className="gl-pop-hint">Every posted line, all accounts and dates · data layout</div>
                    <div className="gl-export-btns">
                      <button type="button" className="gl-menu-item" onClick={() => { close(); runDataExport("all", "xlsx"); }}>Excel (.xlsx)</button>
                      <button type="button" className="gl-menu-item" onClick={() => { close(); runDataExport("all", "csv"); }}>CSV</button>
                    </div>
                  </div>
                )}
              </PopButton>
            </div>
          </div>
        </div>

        <div className="gl-wrap no-print">
          <div className="gl-controls">
            <label className="gl-field">
              <span>Period</span>
              <select value={period} onChange={(e) => {
                const v = e.target.value;
                setParam(v === "custom" ? { period: v, from, to } : { period: v, from: "", to: "" });
              }}>
                {presets.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
                <optgroup label="Month">
                  {months.map((ym) => <option key={ym} value={ym}>{monthLabel(`${ym}-01`)}</option>)}
                  {!months.includes(period) && /^\d{4}-\d{2}$/.test(period) && <option value={period}>{monthLabel(`${period}-01`)}</option>}
                </optgroup>
                {/^ytd-\d{4}$/.test(period) && <option value={period}>{periodLbl}</option>}
                <option value="custom">Custom range…</option>
              </select>
            </label>
            {period === "custom" && (
              <div className="gl-field">
                <span>From – to</span>
                <div className="gl-range">
                  <input type="date" value={from} onChange={(e) => e.target.value && setParam({ from: e.target.value })} />
                  <input type="date" value={to} onChange={(e) => e.target.value && setParam({ to: e.target.value })} />
                </div>
              </div>
            )}
            <div className="gl-field gl-field-grow">
              <span>Account</span>
              <AccountPicker
                accounts={ledger}
                value={account}
                periodLbl={periodLbl}
                onChange={(code) => { setParam({ account: code }); setSearch(""); }}
              />
            </div>
          </div>

          <div className="gl-toolbar">
            <PopButton
              label="Filters"
              badge={filterCount}
              icon={<svg viewBox="0 0 12 12"><path d="M1.5 2.5h9L7 6.5V10L5 9V6.5z" /></svg>}
            >
              <FiltersPopover filters={filters} onChange={setFilters} parties={parties} />
            </PopButton>
            <PopButton label="Columns" icon={<svg viewBox="0 0 12 12"><rect x="1.5" y="2" width="9" height="8" rx="1" /><path d="M4.5 2v8M7.5 2v8" /></svg>}>
              <ColumnsPopover columns={optionalCols} shown={shown} onChange={setShown} />
            </PopButton>
            {view !== "account" && (
              <div className="gl-seg" role="group" aria-label="Group by">
                <span className="gl-seg-lbl">Group by</span>
                <button type="button" className={!flat ? "on" : ""} aria-pressed={!flat} onClick={() => setParam({ group: "" })}>Account</button>
                <button type="button" className={flat ? "on" : ""} aria-pressed={flat} onClick={() => setParam({ group: "none" })}
                  title="One list by date across accounts — no opening, closing or running balance">None</button>
              </div>
            )}
            {filterCount > 0 && (
              <button type="button" className="gl-clear" onClick={() => setFilters(EMPTY_FILTERS)}>Clear filters</button>
            )}
            <div className="lg-search gl-search">
              <svg viewBox="0 0 16 16" aria-hidden><circle cx="7" cy="7" r="5" /><path d="M11 11l3 3" /></svg>
              <input
                placeholder="Search entry, account, description, partner…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          <div className="gl-card">
            {view === "account" && (
              <div className="gl-acct-head">
                {/* The picker above already names the account; this row is
                    the way back and the direction its balance reads in. */}
                <button type="button" className="gl-back" onClick={() => setParam({ account: "" })}>← All accounts</button>
                <div className="gl-acct-sub">
                  {accountView.meta.creditNormal ? "Credit-normal" : "Debit-normal"} · {periodLbl}
                </div>
              </div>
            )}
            <div className="gl-row gl-head gl-line-row" style={grid}>
              {cols.map((c) => <span key={c.key} className={c.num ? "num" : ""}>{c.label}</span>)}
            </div>
            {(flat ? lineRows.length === 0 : blocks.length === 0) && (
              <div className="gl-empty">
                No lines in {periodLbl}{filterCount || q ? " that match." : "."}
              </div>
            )}
            {renderRows}
          </div>
        </div>
        {printing && (
          <div className="gl-print print-only">
            <div className="gl-print-head">
              {exportHeader(scopeLabel, true).map((r, i) => (
                i === 1 ? <h1 key={i}>{r[0]}</h1> : <div key={i} className={i === 0 ? "co" : "meta"}>{r[0]}</div>
              ))}
            </div>
            <table className="gl-print-table">
              <thead>
                <tr>{cols.map((c) => <th key={c.key} className={c.num ? "num" : ""}>{c.label}</th>)}</tr>
              </thead>
              <tbody>
                {!flat && blocks.map((b) => {
                  const balCells = (label, figures, cls) => (
                    <tr key={`${cls}:${b.meta.code}`} className={cls}>
                      {cols.map((c) => (
                        <td key={c.key} className={c.num ? "num" : ""}>{c.key === "desc" ? label : figures[c.key] ?? ""}</td>
                      ))}
                    </tr>
                  );
                  return [
                    <tr key={`h:${b.meta.code}`} className="acct">
                      <td colSpan={cols.length}>
                        {b.meta.code}  {b.meta.name}
                        <span className="side">{GROUP_BY_KEY[b.meta.group].lbl} · {b.meta.creditNormal ? "credit-normal" : "debit-normal"}</span>
                      </td>
                    </tr>,
                    balCells(`Opening balance · ${formatDateEn(from)}`, { balance: fmtBal(b.opening) }, "bal"),
                    ...b.rows.map(printLine),
                    balCells(`Closing balance · ${formatDateEn(to)}`, { debit: fmtAmt(b.debit), credit: fmtAmt(b.credit), balance: fmtBal(b.closing) }, "close"),
                  ];
                })}
                {flat && lineRows.map(printLine)}
                {flat && (
                  <tr className="grand">
                    {cols.map((c) => (
                      <td key={c.key} className={c.num ? "num" : ""}>
                        {c.key === "desc" ? "Total" : c.key === "debit" ? fmtAmt(lineTotals.dc) : c.key === "credit" ? fmtAmt(lineTotals.cc) : ""}
                      </td>
                    ))}
                  </tr>
                )}
                {!flat && blocks.length > 1 && (
                  <tr className="grand">
                    {cols.map((c) => (
                      <td key={c.key} className={c.num ? "num" : ""}>
                        {c.key === "desc" ? "Total, all accounts"
                          : c.key === "debit" ? fmtAmt(blocks.reduce((n, b) => n + b.debit, 0))
                            : c.key === "credit" ? fmtAmt(blocks.reduce((n, b) => n + b.credit, 0)) : ""}
                      </td>
                    ))}
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>{/* /lg-scroll-container */}

      {/* ── Sticky footer — the same bar as Journal Entries and the Trial
          Balance: what is shown, and whether it ties. ───────────────────── */}
      <div className="lg-footer no-print">
        <div className="lg-footer-left">
          <span>Showing <span className="lg-footer-num">{lineRows.length.toLocaleString("id-ID")}</span> lines</span>
          {lineTotals.unposted > 0 && (
            <>
              <span className="lg-footer-sep">·</span>
              <span className="lg-footer-draft-split">{lineTotals.unposted} not yet posted, left out of the totals</span>
            </>
          )}
          <span className="lg-footer-sep">·</span>
          {view === "account" ? (
            <span>{accountView.meta.code} {accountView.meta.name} · {accountView.meta.creditNormal ? "credit-normal" : "debit-normal"}</span>
          ) : cutsEntries ? (
            <span title="Filters or search keep only some lines of an entry, so these totals needn't balance">Filtered — totals cover matching lines</span>
          ) : (
            <span style={{ color: lineTotals.dc === lineTotals.cc ? "var(--color-success-text)" : "var(--color-danger-text)" }}>
              {lineTotals.dc === lineTotals.cc ? "✓ Balanced" : `Variance Rp ${fmtAmt(Math.abs(lineTotals.dc - lineTotals.cc))}`}
            </span>
          )}
        </div>
        <div className="lg-footer-right">
          {view === "account" ? (
            <>
              <span className="lg-footer-lbl">Opening</span>
              <span className="lg-footer-total">Rp {fmtBal(accountView.opening)}</span>
              <span className="lg-footer-sep">→</span>
              <span className="lg-footer-lbl">Closing</span>
              <span className="lg-footer-total">Rp {fmtBal(accountView.closing)}</span>
            </>
          ) : (
            <>
              <span className="lg-footer-lbl">Debit</span>
              <span className="lg-footer-total">Rp {fmtAmt(lineTotals.dc)}</span>
              <span className="lg-footer-sep">·</span>
              <span className="lg-footer-lbl">Credit</span>
              <span className="lg-footer-total">Rp {fmtAmt(lineTotals.cc)}</span>
            </>
          )}
        </div>
      </div>

      {drawer && (
        <GlEntryDrawer
          target={drawer}
          entries={entries}
          bills={bills}
          invoices={invoices}
          sourceOf={sourceOf}
          onJump={(n) => setDrawer({ je_number: n, line: null })}
          onOpenEntry={(n, line) => navigate(`/journal-entry/${encodeURIComponent(n)}${line != null ? `?line=${line}` : ""}`)}
          onClose={() => setDrawer(null)}
        />
      )}
      {toast && <div className="gl-toast" role="status">{toast}</div>}
    </div>
  );
}
