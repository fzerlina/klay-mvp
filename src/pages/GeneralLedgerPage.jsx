// General Ledger — every POSTED journal line, by account.
//
// The Journal Entry page is where transactions are made and checked: one entry,
// all its lines, debits equal to credits. This page answers the other question
// — what has happened to an account and what it now holds — so it reads the
// same lines regrouped by account, each account carrying its own opening
// balance, running balance and closing balance. It is read-only; entries are
// created on the Journal Entry page, and every line here links back to its
// entry.
//
// Two views:
//   • All accounts — one row per account that moved: opening, debits, credits,
//     closing. The column totals tie to the trial balance.
//   • One account — its opening balance, every line in the period with a
//     running balance, and its closing balance.
//
// Only posted entries count. A draft or pending entry has not reached the
// ledger yet, and showing it here would make the ledger disagree with the
// trial balance.

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useJournalEntries } from "../state/JournalEntriesContext";
import { COA, COA_BY_CODE } from "../data/seed/coa";
import { TODAY } from "../lib/clock";
import { formatDateEn } from "../lib/format";
import "./modules.css";
import "./invoices-ledger.css";
import "./general-ledger.css";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (ym) => `${MONTHS[parseInt(ym.slice(5, 7), 10) - 1]} ${ym.slice(0, 4)}`;
const pad = (n) => String(n).padStart(2, "0");
const CURRENT_YM = `${TODAY.getFullYear()}-${pad(TODAY.getMonth() + 1)}`;

const fmt = (n) => (n ? Math.round(n).toLocaleString("id-ID") : "—");
// A balance on its wrong side (an asset in credit) is shown in brackets, the
// way a ledger printout shows it.
const fmtBal = (n) => (Math.round(n) === 0 ? "0" : n < 0 ? `(${Math.round(-n).toLocaleString("id-ID")})` : Math.round(n).toLocaleString("id-ID"));

// Accounts are read in their normal direction: a debit-normal account (assets,
// expenses) grows with debits, a credit-normal one (liabilities, equity,
// revenue) with credits.
function accountMeta(code, fallbackName) {
  const a = COA_BY_CODE[code];
  return {
    code,
    name: a?.name || fallbackName || code,
    creditNormal: a ? a.normal_balance === "credit" : false,
    inCoa: !!a,
    group: groupOf(a?.type),
  };
}

// The account picker groups by what an account is, in statement order.
// Contra accounts sit with the accounts they reduce.
const GROUPS = [
  { k: "asset",     lbl: "Assets",      color: "#2B5FD9" },
  { k: "liability", lbl: "Liabilities", color: "#B7660B" },
  { k: "equity",    lbl: "Equity",      color: "#7A4FC4" },
  { k: "revenue",   lbl: "Revenue",     color: "#1F8A55" },
  { k: "expense",   lbl: "Expenses",    color: "#C0392B" },
  { k: "other",     lbl: "Other",       color: "#6B7280" },
];
const GROUP_BY_KEY = Object.fromEntries(GROUPS.map((g) => [g.k, g]));
function groupOf(type) {
  if (type === "asset" || type === "contra_asset") return "asset";
  if (type === "revenue" || type === "contra_revenue") return "revenue";
  if (type === "liability" || type === "equity" || type === "expense") return type;
  return "other";
}

// ── Account picker ───────────────────────────────────────────────────────
// The chosen account sits in a box — what it is, its code and where it
// closed — and opens a searchable list grouped by type. Same idea as the
// bank-account cards on Bank Reconciliation, sized for a chart of accounts.
function AccountPicker({ accounts, value, onChange, periodLbl }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);

  // An account with no activity in the period is not in the list, but is
  // still the one chosen.
  const current = accounts.find((s) => s.meta.code === value) || (value ? { meta: accountMeta(value), closing: null } : null);
  const needle = q.trim().toLowerCase();
  const groups = GROUPS
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
const signed = (meta, debit, credit) => (meta.creditNormal ? credit - debit : debit - credit);

// Period: one month, or the year to date.
function periodRange(p) {
  if (p.startsWith("ytd-")) {
    const y = p.slice(4);
    return { from: `${y}-01-01`, to: `${y}-12-31` };
  }
  return { from: `${p}-01`, to: `${p}-31` };
}

export default function GeneralLedgerPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { entries } = useJournalEntries();

  // Every posted line, flattened once.
  const lines = useMemo(() => {
    const out = [];
    for (const je of entries) {
      if (je.status !== "posted") continue;
      (je.lines || []).forEach((l, i) => {
        out.push({
          key: `${je.je_number}:${i}`,
          lineIndex: i,
          date: je.je_date,
          je_number: je.je_number,
          memo: je.memo,
          desc: l.description || je.memo,
          code: l.account_code,
          name: l.account_name,
          debit: l.debit || 0,
          credit: l.credit || 0,
        });
      });
    }
    return out.sort((a, b) => a.date.localeCompare(b.date) || a.je_number.localeCompare(b.je_number) || a.lineIndex - b.lineIndex);
  }, [entries]);

  // Months that have postings, newest first, plus the year to date.
  const periods = useMemo(() => {
    const yms = [...new Set(lines.map((l) => l.date.slice(0, 7)))].filter((ym) => ym <= CURRENT_YM).sort().reverse();
    const year = CURRENT_YM.slice(0, 4);
    return [{ v: `ytd-${year}`, lbl: `Year to date ${year}` }, ...yms.map((ym) => ({ v: ym, lbl: monthLabel(ym) }))];
  }, [lines]);

  const period = params.get("period") || CURRENT_YM;
  const account = params.get("account") || "";
  const [search, setSearch] = useState("");
  const setParam = (k, v) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v); else next.delete(k);
    setParams(next, { replace: true });
  };

  const { from, to } = periodRange(period);

  // Per-account opening (everything before the period), movements in the
  // period, and closing.
  const summary = useMemo(() => {
    const by = new Map();
    for (const l of lines) {
      if (l.date > to) continue;
      if (!by.has(l.code)) by.set(l.code, { meta: accountMeta(l.code, l.name), opening: 0, debit: 0, credit: 0, count: 0 });
      const s = by.get(l.code);
      if (l.date < from) s.opening += signed(s.meta, l.debit, l.credit);
      else { s.debit += l.debit; s.credit += l.credit; s.count += 1; }
    }
    // Chart order, so the list reads assets → liabilities → … like the CoA.
    const order = new Map(COA.filter((a) => a.code).map((a, i) => [a.code, i]));
    return [...by.values()]
      .map((s) => ({ ...s, closing: s.opening + signed(s.meta, s.debit, s.credit) }))
      .filter((s) => s.count > 0 || Math.round(s.opening) !== 0)
      .sort((a, b) => (order.get(a.meta.code) ?? 1e6) - (order.get(b.meta.code) ?? 1e6) || a.meta.code.localeCompare(b.meta.code));
  }, [lines, from, to]);

  const q = search.trim().toLowerCase();

  // ── One account ────────────────────────────────────────────────────────
  const accountView = useMemo(() => {
    if (!account) return null;
    const meta = accountMeta(account, lines.find((l) => l.code === account)?.name);
    let opening = 0;
    const rows = [];
    for (const l of lines) {
      if (l.code !== account || l.date > to) continue;
      if (l.date < from) { opening += signed(meta, l.debit, l.credit); continue; }
      rows.push(l);
    }
    let bal = opening;
    const withBal = rows.map((l) => { bal += signed(meta, l.debit, l.credit); return { ...l, balance: bal }; });
    const visible = q ? withBal.filter((l) => `${l.je_number} ${l.desc} ${l.memo}`.toLowerCase().includes(q)) : withBal;
    return {
      meta, opening, closing: bal, rows: visible, all: withBal,
      debit: rows.reduce((s, l) => s + l.debit, 0),
      credit: rows.reduce((s, l) => s + l.credit, 0),
    };
  }, [account, lines, from, to, q]);

  const visibleSummary = q && !account
    ? summary.filter((s) => `${s.meta.code} ${s.meta.name}`.toLowerCase().includes(q))
    : summary;
  const totals = summary.reduce((t, s) => ({ debit: t.debit + s.debit, credit: t.credit + s.credit }), { debit: 0, credit: 0 });

  const periodLbl = periods.find((p) => p.v === period)?.lbl || monthLabel(period);

  function exportCsv() {
    const esc = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    let rows;
    if (accountView) {
      rows = [["Date", "Entry", "Description", "Debit", "Credit", "Balance"],
        ["", "", "Opening balance", "", "", Math.round(accountView.opening)],
        ...accountView.all.map((l) => [l.date, l.je_number, l.desc, l.debit || "", l.credit || "", Math.round(l.balance)]),
        ["", "", "Closing balance", accountView.debit, accountView.credit, Math.round(accountView.closing)]];
    } else {
      rows = [["Account", "Name", "Opening", "Debit", "Credit", "Closing"],
        ...summary.map((s) => [s.meta.code, s.meta.name, Math.round(s.opening), s.debit, s.credit, Math.round(s.closing)]),
        ["", "Total", "", totals.debit, totals.credit, ""]];
    }
    const blob = new Blob(["﻿" + rows.map((r) => r.map(esc).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `klay-gl-${account || "all-accounts"}-${period}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="lg-page">
      <div className="lg-scroll-container">
        <div className="lg-head lg-head-plain">
          <div className="lg-head-top">
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1 className="lg-title">General Ledger</h1>
              <p className="gl-sub">
                Every posted journal line, by account. Entries are created and posted on the{" "}
                <button type="button" className="gl-link" onClick={() => navigate("/journal-entry")}>Journal Entry</button> page.
              </p>
            </div>
            <div className="lg-head-actions">
              <button className="lg-btn-brand" onClick={exportCsv}>
                <svg viewBox="0 0 12 12"><path d="M6 1.5v6M3.5 5L6 7.5 8.5 5M2 10h8" /></svg>
                Export CSV
              </button>
            </div>
          </div>
        </div>

        <div className="gl-wrap">
          <div className="gl-controls">
            <label className="gl-field">
              <span>Period</span>
              <select value={period} onChange={(e) => setParam("period", e.target.value)}>
                {periods.map((p) => <option key={p.v} value={p.v}>{p.lbl}</option>)}
              </select>
            </label>
            <div className="gl-field gl-field-grow">
              <span>Account</span>
              <AccountPicker
                accounts={summary}
                value={account}
                periodLbl={periodLbl}
                onChange={(code) => { setParam("account", code); setSearch(""); }}
              />
            </div>
            <div className="lg-search gl-search">
              <svg viewBox="0 0 16 16" aria-hidden><circle cx="7" cy="7" r="5" /><path d="M11 11l3 3" /></svg>
              <input
                placeholder={account ? "Search entry or description…" : "Search account…"}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          {!accountView ? (
            <div className="gl-card">
              <div className="gl-row gl-head gl-sum-row">
                <span>Account</span>
                <span className="num">Opening</span>
                <span className="num">Debit</span>
                <span className="num">Credit</span>
                <span className="num">Closing</span>
              </div>
              {visibleSummary.length === 0 && <div className="gl-empty">No account moved in {periodLbl}.</div>}
              {visibleSummary.map((s) => (
                <button key={s.meta.code} type="button" className="gl-row gl-sum-row gl-click" onClick={() => setParam("account", s.meta.code)}>
                  <span className="gl-acct">
                    <span className="gl-code">{s.meta.code}</span>
                    <span className="gl-name">{s.meta.name}</span>
                    {!s.meta.inCoa && <span className="gl-tag" title="Posted to a code that is not in the chart of accounts">Not in CoA</span>}
                  </span>
                  <span className="num">{fmtBal(s.opening)}</span>
                  <span className="num">{fmt(s.debit)}</span>
                  <span className="num">{fmt(s.credit)}</span>
                  <span className="num strong">{fmtBal(s.closing)}</span>
                </button>
              ))}
              <div className="gl-row gl-sum-row gl-total">
                <span>Total · {periodLbl}</span>
                <span />
                <span className="num">{fmt(totals.debit)}</span>
                <span className="num">{fmt(totals.credit)}</span>
                <span className={`num gl-tie${Math.round(totals.debit) === Math.round(totals.credit) ? " ok" : " off"}`}>
                  {Math.round(totals.debit) === Math.round(totals.credit) ? "Balanced" : `Out by ${fmt(Math.abs(totals.debit - totals.credit))}`}
                </span>
              </div>
            </div>
          ) : (
            <div className="gl-card">
              <div className="gl-acct-head">
                {/* The picker above already names the account; this row is
                    the way back and the direction its balance reads in. */}
                <button type="button" className="gl-back" onClick={() => setParam("account", "")}>← All accounts</button>
                <div className="gl-acct-sub">
                  {accountView.meta.creditNormal ? "Credit-normal" : "Debit-normal"} · {periodLbl}
                </div>
              </div>
              <div className="gl-row gl-head gl-line-row">
                <span>Date</span>
                <span>Entry</span>
                <span>Description</span>
                <span className="num">Debit</span>
                <span className="num">Credit</span>
                <span className="num">Balance</span>
              </div>
              <div className="gl-row gl-line-row gl-bal-row">
                <span />
                <span />
                <span>Opening balance</span>
                <span />
                <span />
                <span className="num strong">{fmtBal(accountView.opening)}</span>
              </div>
              {accountView.rows.length === 0 && <div className="gl-empty">No postings to this account in {periodLbl}.</div>}
              {accountView.rows.map((l) => (
                <div key={l.key} className="gl-row gl-line-row">
                  <span className="gl-date">{formatDateEn(l.date)}</span>
                  <span>
                    <button type="button" className="gl-link mono" onClick={() => navigate(`/journal-entry?je=${l.je_number}&line=${l.lineIndex}`)}>
                      {l.je_number}
                    </button>
                  </span>
                  <span className="gl-desc" title={l.memo}>{l.desc}</span>
                  <span className="num">{fmt(l.debit)}</span>
                  <span className="num">{fmt(l.credit)}</span>
                  <span className="num">{fmtBal(l.balance)}</span>
                </div>
              ))}
              <div className="gl-row gl-line-row gl-bal-row gl-total">
                <span />
                <span />
                <span>Closing balance</span>
                <span className="num">{fmt(accountView.debit)}</span>
                <span className="num">{fmt(accountView.credit)}</span>
                <span className="num strong">{fmtBal(accountView.closing)}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
