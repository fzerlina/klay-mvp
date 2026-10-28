// General Ledger — every journal line, by account (Core Ledger PRD §3).
//
// The Journal Entry page is where transactions are made and checked: one entry,
// all its lines, debits equal to credits. This page answers the other question
// — what has happened to an account, and what it now holds — by reading the
// same lines regrouped. It is a read model: nothing is typed into it. The one
// thing it can start is a reclassification, and that is a new journal sent for
// approval, never an edit (§3.5).
//
// Two views:
//   • All accounts — every line in the period across accounts, for questions
//     like "every posting over Rp 150M in December" (§3.2, the Auditor).
//   • One account  — its opening balance, each line with a running balance,
//     and its closing balance.
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
import { useClosePeriod } from "../state/ClosePeriodContext";
import { useAccountingSettings } from "../state/AccountingSettingsContext";
import { useBills } from "../state/BillsContext";
import { useInvoices } from "../state/InvoicesContext";
import { COA } from "../data/seed/coa";
import { DIM_BY_KEY } from "../data/seed/dimensions";
import { TODAY } from "../lib/clock";
import { formatDateEn } from "../lib/format";
import { periodPresets, monthLabel, rangeLabel } from "../lib/reportPeriods";
import { downloadCsv, reportHeader } from "../lib/reportExport";
import { downloadXlsx } from "../lib/xlsxExport";
import { canSubmit, withEvent, isoOf } from "../lib/journalLifecycle";
import {
  glLines, lineMatches, lineSearchText, accountSummary, accountMeta, signed, activeFilterCount,
  buildReclassification, EMPTY_FILTERS, GROUP_BY_KEY, ACCOUNT_GROUPS,
} from "../lib/generalLedger";
import { JE_SOURCE_LABEL, STATUS_LABEL, STATUS_BADGE_CLASS, useJournalActions } from "./journalEntryShared";
import {
  GlEntryDrawer, ReclassDialog, FiltersPopover, ColumnsPopover, usePopoverClose, FILTER_DIMS, fmtAmt, fmtBal,
} from "./GlPanels";
import "./modules.css";
import "./invoices-ledger.css";
import "./general-ledger.css";

const pad = (n) => String(n).padStart(2, "0");
const CURRENT_YM = `${TODAY.getFullYear()}-${pad(TODAY.getMonth() + 1)}`;
const lastDay = (ym) => new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).getUTCDate();
const PAGE = 200;
const EXPORT_CAP = 100000;
const COA_ORDER = new Map(COA.filter((a) => a.code).map((a, i) => [a.code, i]));

// Where a line came from, as the Source column says it. The id is the
// drill-down anchor (§3.3 source_transaction_id).
function sourceText(l) {
  const id = l.reference_id;
  switch (l.reference_type) {
    case "bill": case "ap_bill": return `Bill ${id || ""}`.trim();
    case "bill_payment": case "payment": return `Payment ${id || ""}`.trim();
    case "invoice": return `Invoice ${id || ""}`.trim();
    case "invoice_payment": return `Receipt ${id || ""}`.trim();
    case "reversal": return "Reversal";
    case "reclassification": return "Reclass";
    default: return JE_SOURCE_LABEL[l.source] || "Manual";
  }
}

// Columns of the line views. `opt` ones are switched on in Columns; `all`
// shows only across accounts, `one` only inside one account.
const LINE_COLUMNS = [
  { key: "date", label: "Date", w: "84px" },
  { key: "entry", label: "Entry", w: "108px" },
  { key: "source", label: "Source", w: "112px" },
  { key: "account", label: "Account", w: "minmax(170px, 1fr)", all: true },
  { key: "type", label: "Account type", w: "92px", opt: true, all: true },
  { key: "desc", label: "Description", w: "minmax(190px, 1.4fr)" },
  { key: "party", label: "Vendor / customer", w: "minmax(140px, .8fr)", opt: true },
  ...FILTER_DIMS.map((k) => ({ key: `dim:${k}`, label: DIM_BY_KEY[k]?.label || k, w: "100px", opt: true })),
  { key: "status", label: "Status", w: "104px", opt: true },
  { key: "debit", label: "Debit", w: "116px", num: true },
  { key: "credit", label: "Credit", w: "116px", num: true },
  { key: "balance", label: "Balance", w: "128px", num: true, one: true },
];
// The PRD's default-visible extras (§3.3 Primary layer).
const DEFAULT_SHOWN = ["type", "status"];
const COLS_KEY = "klay.gl.columns";
function loadShown() {
  try {
    const v = JSON.parse(window.localStorage.getItem(COLS_KEY));
    return Array.isArray(v) ? v : DEFAULT_SHOWN;
  } catch { return DEFAULT_SHOWN; }
}

// ── Account picker ───────────────────────────────────────────────────────
// The chosen account sits in a box — what it is, its code and where it
// closed — and opens a searchable list grouped by type. Same idea as the
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
  const groups = ACCOUNT_GROUPS
    .map((g) => ({
      ...g,
      items: accounts.filter((s) => s.meta.group === g.k && (!needle || `${s.meta.code} ${s.meta.name}`.toLowerCase().includes(needle))),
    }))
    .filter((g) => g.items.length > 0);
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
            {groups.length === 0 && <div className="gl-empty">No account matches “{q}”.</div>}
            {groups.map((g) => (
              <div key={g.k} className="gl-acct-group">
                <div className="gl-acct-group-head">
                  <span><span className="gl-acct-dot" style={{ background: g.color }} />{g.lbl}</span>
                  <span className="gl-acct-group-count">{g.items.length}</span>
                </div>
                {g.items.map((s) => (
                  <button
                    key={s.meta.code}
                    type="button"
                    role="option"
                    aria-selected={value === s.meta.code}
                    className={`gl-acct-item${value === s.meta.code ? " selected" : ""}`}
                    onClick={() => pick(s.meta.code)}
                  >
                    <span className="gl-code">{s.meta.code}</span>
                    <span className="gl-acct-item-name">{s.meta.name}</span>
                    <span className="gl-acct-item-amt">{fmtBal(s.closing)}</span>
                  </button>
                ))}
              </div>
            ))}
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
  if (f.party) out.push(`Party: ${f.party}`);
  for (const [k, v] of Object.entries(f.dims)) if (v) out.push(`${DIM_BY_KEY[k]?.label || k}: ${v}`);
  if (f.hideReversed) out.push("Reversals hidden");
  return out.join("; ");
}

export default function GeneralLedgerPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { entries, addJournalEntry, peekNextJeNumber } = useJournalEntries();
  const { user, hasCapability } = useCurrentUser();
  const { closedThrough } = useClosePeriod();
  const { fiscalYearStart } = useAccountingSettings();
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
  const canReclass = hasCapability("gl.reclassify");

  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [shown, setShown] = useState(loadShown);
  useEffect(() => { try { window.localStorage.setItem(COLS_KEY, JSON.stringify(shown)); } catch { /* per-viewer nicety only */ } }, [shown]);
  const [drawer, setDrawer] = useState(null); // { je_number, line }
  const [reclass, setReclass] = useState(null); // a GL line
  const [limit, setLimit] = useState(PAGE);

  const setParam = (patch) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k); }
    setParams(next, { replace: true });
  };

  // Every line the ledger can show, then the filters — dates aside, since the
  // period decides what is opening balance and what is movement.
  const allLines = useMemo(() => glLines(entries, { bills, invoices }), [entries, bills, invoices]);
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
  const q = search.trim().toLowerCase();

  // Start the list from the top whenever what it shows changes.
  useEffect(() => { setLimit(PAGE); }, [from, to, account, view, filters, q]);

  const parties = useMemo(() => [...new Set(allLines.map((l) => l.party).filter(Boolean))].sort(), [allLines]);
  const filterCount = activeFilterCount(filters);

  // Each account's closing, for the account picker.
  const summary = useMemo(() => accountSummary(lines, { from, to, order: COA_ORDER }), [lines, from, to]);

  // ── One account ────────────────────────────────────────────────────────
  const accountView = useMemo(() => {
    if (!account) return null;
    const meta = accountMeta(account, allLines.find((l) => l.code === account)?.name);
    let opening = 0;
    const rows = [];
    for (const l of lines) {
      if (l.code !== account || l.date > to) continue;
      if (l.date < from) { if (l.status === "posted") opening += signed(meta, l.dc, l.cc); continue; }
      rows.push(l);
    }
    let bal = opening;
    let debit = 0, credit = 0, unposted = 0;
    const withBal = rows.map((l) => {
      if (l.status !== "posted") { unposted += signed(meta, l.dc, l.cc); return { ...l, balance: null }; }
      bal += signed(meta, l.dc, l.cc);
      debit += l.dc; credit += l.cc;
      return { ...l, balance: bal };
    });
    return { meta, opening, closing: bal, debit, credit, unposted, all: withBal };
  }, [account, allLines, lines, from, to]);

  // ── All lines (or one account's) after search ──────────────────────────
  const lineRows = useMemo(() => {
    const base = view === "account" ? accountView.all : lines.filter((l) => l.date >= from && l.date <= to);
    return q ? base.filter((l) => lineSearchText(l).includes(q)) : base;
  }, [view, accountView, lines, from, to, q]);
  const lineTotals = lineRows.reduce(
    (t, l) => (l.status === "posted" ? { ...t, dc: t.dc + l.dc, cc: t.cc + l.cc } : { ...t, unposted: t.unposted + 1 }),
    { dc: 0, cc: 0, unposted: 0 },
  );
  // Filters and search that keep some lines of an entry and drop others: with
  // one on, the totals cover matching lines only and needn't balance.
  const cutsEntries = !!(q || filters.types.length || filters.codeFrom || filters.codeTo || filters.min !== "" || filters.max !== ""
    || filters.party || Object.values(filters.dims).some(Boolean));

  const cols = LINE_COLUMNS.filter((c) => (!c.opt || shown.includes(c.key)) && !(c.all && view === "account") && !(c.one && view !== "account"));
  const grid = { gridTemplateColumns: [...cols.map((c) => c.w), ...(canReclass ? ["32px"] : [])].join(" ") };
  const statusCol = cols.some((c) => c.key === "status");
  const optionalCols = LINE_COLUMNS.filter((c) => c.opt && !(c.all && view === "account"));

  // ── Export (§3.5) ──────────────────────────────────────────────────────
  // Visible = this view with its period, filters and search; All = every
  // posted line in the ledger, every column. CSV or Excel, with a row count.
  function exportData(mode) {
    const money = (c) => (c ? c / 100 : null);
    let columns;
    let rows;
    let scope;
    if (mode === "all") {
      scope = "All posted lines";
      const dimKeys = [...new Set(allLines.flatMap((l) => Object.keys(l.dims)))];
      rows = allLines.filter((l) => l.status === "posted");
      columns = [
        { label: "Date", value: (l) => l.date },
        { label: "Entry", value: (l) => l.je_number },
        { label: "Source", value: (l) => sourceText(l) },
        { label: "Account", value: (l) => l.code },
        { label: "Account name", value: (l) => l.name },
        { label: "Account type", value: (l) => GROUP_BY_KEY[l.meta.group].lbl },
        { label: "Description", value: (l) => l.desc },
        { label: "Vendor / customer", value: (l) => l.party },
        ...dimKeys.map((k) => ({ label: DIM_BY_KEY[k]?.label || k, value: (l) => l.dims[k] || "" })),
        { label: "Debit", value: (l) => money(l.dc) },
        { label: "Credit", value: (l) => money(l.cc) },
      ];
    } else {
      scope = view === "account" ? `${periodLbl} · ${accountView.meta.code} ${accountView.meta.name}` : `${periodLbl} · all lines`;
      const valueOf = {
        date: (l) => l.date, entry: (l) => l.je_number, source: (l) => sourceText(l),
        account: (l) => `${l.code} ${l.name}`, type: (l) => GROUP_BY_KEY[l.meta.group].lbl,
        desc: (l) => l.desc, party: (l) => l.party, status: (l) => STATUS_LABEL[l.status],
        debit: (l) => money(l.dc), credit: (l) => money(l.cc), balance: (l) => (l.balance == null ? null : l.balance / 100),
      };
      columns = cols.map((c) => ({ label: c.label, value: c.key.startsWith("dim:") ? (l) => l.dims[c.key.slice(4)] || "" : valueOf[c.key] }));
      rows = lineRows;
      if (view === "account") {
        const blank = Object.fromEntries(cols.map((c) => [c.key, null]));
        const special = (desc, balance, extra = {}) => ({ __row: { ...blank, desc, balance, ...extra } });
        columns = columns.map((c, i) => ({ ...c, value: (r) => (r.__row ? r.__row[cols[i].key] : c.value(r)) }));
        rows = [
          special("Opening balance", accountView.opening / 100),
          ...lineRows,
          special("Closing balance", accountView.closing / 100, { debit: accountView.debit / 100, credit: accountView.credit / 100 }),
        ];
      }
    }
    if (rows.length > EXPORT_CAP) return null;
    const desc = describeFilters(filters);
    const header = [
      ...reportHeader({ report: "General Ledger", period: scope, runBy: actor }),
      ...(mode === "visible" && desc ? [[`Filters: ${desc}`]] : []),
      ...(mode === "visible" && q ? [[`Search: ${search.trim()}`]] : []),
      [`${rows.length} rows`],
    ];
    return { header, columns, rows };
  }

  function runExport(mode, format) {
    const data = exportData(mode);
    if (!data) { showToast(`Over ${EXPORT_CAP.toLocaleString("id-ID")} rows — narrow the period or filters to export this view.`); return; }
    const base = `general-ledger_${mode === "all" ? "all" : account || "all-accounts"}_${mode === "all" ? isoOf(TODAY) : `${from}_${to}`}`;
    if (format === "csv") downloadCsv(`${base}.csv`, data);
    else {
      downloadXlsx(`${base}.xlsx`, {
        sheet: "General Ledger",
        rows: [...data.header, [], data.columns.map((c) => c.label), ...data.rows.map((r) => data.columns.map((c) => c.value(r)))],
      });
    }
    showToast(`Exported ${data.rows.length} rows`);
  }

  // ── Reclassification (§3.5) ────────────────────────────────────────────
  const today = isoOf(TODAY);
  const previewReclass = (line) => (p) => {
    const entry = buildReclassification(line, { ...p, jeNumber: peekNextJeNumber(), by: actor, today });
    return { entry, check: canSubmit(entry, { closedThrough }) };
  };
  function confirmReclass(line, p) {
    const { entry, check } = previewReclass(line)(p);
    if (!check.ok) { showToast(check.reason); return; }
    addJournalEntry(withEvent({ ...entry, status: "pending" }, "submitted", actor));
    setReclass(null);
    showToast(`${entry.je_number} sent for approval — the ledger shows the move once it posts`);
  }
  function reclassBlock(l) {
    if (l.status !== "posted") return "Only a posted line can be reclassified.";
    if (l.reversed_by || l.reversal_of) return "Part of a reversal — reclassify neither half.";
    if (l.reclass_open) return `Already being reclassified by ${l.reclass_open}.`;
    return null;
  }

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
      case "source": return <span key={c.key} className="gl-src"><button type="button" className="gl-link gl-src-link" onClick={() => openDrawer(l)}>{sourceText(l)}</button></span>;
      case "account": return (
        <span key={c.key} className="gl-acct">
          <button type="button" className="gl-link mono gl-code-link" onClick={() => setParam({ account: l.code })}>{l.code}</button>
          <span className="gl-name">{l.name}</span>
        </span>
      );
      case "type": return <span key={c.key} className="gl-type"><span className="gl-acct-dot" style={{ background: GROUP_BY_KEY[l.meta.group].color }} />{GROUP_BY_KEY[l.meta.group].lbl}</span>;
      case "desc": return <span key={c.key} className="gl-desc" title={l.memo}><span className="gl-desc-text">{l.desc}</span>{lineTags(l)}</span>;
      case "party": return <span key={c.key} className="gl-ellip">{l.party || "—"}</span>;
      case "status": return <span key={c.key}><span className={`badge badge-${STATUS_BADGE_CLASS[l.status]}`}>{STATUS_LABEL[l.status]}</span></span>;
      case "debit": return <span key={c.key} className={`num${unposted ? " gl-unposted" : ""}`}>{fmtAmt(l.dc)}</span>;
      case "credit": return <span key={c.key} className={`num${unposted ? " gl-unposted" : ""}`}>{fmtAmt(l.cc)}</span>;
      case "balance": return <span key={c.key} className="num">{l.balance == null ? <span className="gl-muted" title="Not posted — doesn't move the balance">—</span> : fmtBal(l.balance)}</span>;
      default:
        if (c.key.startsWith("dim:")) return <span key={c.key} className="gl-ellip">{l.dims[c.key.slice(4)] || "—"}</span>;
        return <span key={c.key} />;
    }
  }

  const spanRow = (label, value, extra = {}) => (
    <div className="gl-row gl-line-row gl-bal-row" style={grid}>
      {cols.map((c) => {
        if (c.key === "desc") return <span key={c.key}>{label}</span>;
        if (c.key === "balance") return <span key={c.key} className="num strong">{value}</span>;
        if (extra[c.key] != null) return <span key={c.key} className="num">{extra[c.key]}</span>;
        return <span key={c.key} />;
      })}
      {canReclass && <span />}
    </div>
  );

  const shownRows = lineRows.slice(0, limit);

  return (
    <div className="lg-page">
      <div className="lg-scroll-container">
        <div className="lg-head lg-head-plain">
          <div className="lg-head-top">
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1 className="lg-title">General Ledger</h1>
              <p className="gl-sub">
                Every journal line, in date order. Entries are created and posted on the{" "}
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
                    <div className="gl-pop-hint">{periodLbl}{filterCount ? `, ${filterCount} filter${filterCount > 1 ? "s" : ""}` : ""}{q ? ", searched" : ""}</div>
                    <button type="button" className="gl-menu-item" onClick={() => { close(); runExport("visible", "xlsx"); }}>Excel (.xlsx)</button>
                    <button type="button" className="gl-menu-item" onClick={() => { close(); runExport("visible", "csv"); }}>CSV</button>
                    <div className="gl-pop-lbl gl-pop-lbl-gap">Everything</div>
                    <div className="gl-pop-hint">Every posted line, all accounts and dates</div>
                    <button type="button" className="gl-menu-item" onClick={() => { close(); runExport("all", "xlsx"); }}>Excel (.xlsx)</button>
                    <button type="button" className="gl-menu-item" onClick={() => { close(); runExport("all", "csv"); }}>CSV</button>
                  </div>
                )}
              </PopButton>
            </div>
          </div>
        </div>

        <div className="gl-wrap">
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
                accounts={summary}
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
            {filterCount > 0 && (
              <button type="button" className="gl-clear" onClick={() => setFilters(EMPTY_FILTERS)}>Clear filters</button>
            )}
            <div className="lg-search gl-search">
              <svg viewBox="0 0 16 16" aria-hidden><circle cx="7" cy="7" r="5" /><path d="M11 11l3 3" /></svg>
              <input
                placeholder="Search entry, account, description, party…"
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
              {canReclass && <span />}
            </div>
            {view === "account" && spanRow("Opening balance", fmtBal(accountView.opening))}
            {lineRows.length === 0 && (
              <div className="gl-empty">
                {view === "account" ? `No postings to this account in ${periodLbl}` : `No lines in ${periodLbl}`}
                {filterCount || q ? " that match." : "."}
              </div>
            )}
            {shownRows.map((l) => {
              const block = canReclass ? reclassBlock(l) : null;
              return (
                <div key={l.key} className={`gl-row gl-line-row${l.status !== "posted" ? " is-unposted" : ""}`} style={grid}>
                  {cols.map((c) => cell(c, l))}
                  {canReclass && (
                    <span className="gl-act">
                      {l.status === "posted" && (
                        <button type="button" className="gl-act-btn" disabled={!!block} title={block || "Reclassify this line"} aria-label="Reclassify this line" onClick={() => setReclass(l)}>
                          <svg viewBox="0 0 16 16"><path d="M2 5h9l-2.5-2.5M14 11H5l2.5 2.5" /></svg>
                        </button>
                      )}
                    </span>
                  )}
                </div>
              );
            })}
            {lineRows.length > limit && (
              <div className="gl-more">
                Showing {limit.toLocaleString("id-ID")} of {lineRows.length.toLocaleString("id-ID")} lines
                <button type="button" className="gl-link" onClick={() => setLimit((n) => n + PAGE)}>Show {Math.min(PAGE, lineRows.length - limit)} more</button>
              </div>
            )}
            {view === "account" && spanRow(
              <>Closing balance{accountView.unposted ? <span className="gl-unposted-note"> · {fmtBal(accountView.unposted)} not yet posted</span> : null}</>,
              fmtBal(accountView.closing),
              { debit: fmtAmt(accountView.debit), credit: fmtAmt(accountView.credit) },
            )}
          </div>
        </div>
      </div>{/* /lg-scroll-container */}

      {/* ── Sticky footer — the same bar as Journal Entries and the Trial
          Balance: what is shown, and whether it ties. ───────────────────── */}
      <div className="lg-footer">
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
      {reclass && (
        <ReclassDialog
          line={reclass}
          closedThrough={closedThrough}
          nextNumber={peekNextJeNumber()}
          preview={previewReclass(reclass)}
          onClose={() => setReclass(null)}
          onConfirm={(p) => confirmReclass(reclass, p)}
        />
      )}
      {toast && <div className="gl-toast" role="status">{toast}</div>}
    </div>
  );
}
