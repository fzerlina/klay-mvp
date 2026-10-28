// General Ledger read model — Core Ledger PRD §3.
//
// The GL never holds data of its own: it is every journal line, flattened and
// regrouped. This module builds those lines once (glLines), filters them with
// the PRD's stackable filters (§3.4, AND logic), and rolls them up per account
// (accountSummary). It also writes the one thing the GL may start: a
// reclassification journal (§3.5) — never an edit to the original.
//
// Amounts are carried in whole cents (integers), so sums never pick up
// floating-point drift (§3.6 Precision). Divide by 100 only to display.
//
// Status (§3.3): only POSTED lines move a balance. Draft and pending lines can
// be shown when the user asks (§4.5 "visible with DRAFT tag if the user opts
// in"), but they sit beside the balances, never inside them — otherwise the
// ledger would stop agreeing with the trial balance.

import { COA_BY_CODE } from "../data/seed/coa";
import { dimensionsForAccount, sampleDimensionValue } from "../data/seed/dimensions";
import { entrySource } from "../pages/journalEntryShared";
import { withEvent } from "./journalLifecycle";

export const toCents = (n) => Math.round((Number(n) || 0) * 100);

// Statuses a GL line can carry. Void, deleted and scheduled entries never
// reach the ledger.
export const GL_STATUSES = [
  { key: "posted", label: "Posted" },
  { key: "pending", label: "Pending review" },
  { key: "draft", label: "Draft" },
];
const GL_STATUS_KEYS = new Set(GL_STATUSES.map((s) => s.key));

// Account classes for the type filter and column, in statement order. Contra
// accounts sit with the accounts they reduce.
export const ACCOUNT_GROUPS = [
  { k: "asset",     lbl: "Assets",      color: "#2B5FD9" },
  { k: "liability", lbl: "Liabilities", color: "#B7660B" },
  { k: "equity",    lbl: "Equity",      color: "#7A4FC4" },
  { k: "revenue",   lbl: "Revenue",     color: "#1F8A55" },
  { k: "expense",   lbl: "Expenses",    color: "#C0392B" },
  { k: "other",     lbl: "Other",       color: "#6B7280" },
];
export const GROUP_BY_KEY = Object.fromEntries(ACCOUNT_GROUPS.map((g) => [g.k, g]));
export function groupOf(type) {
  if (type === "asset" || type === "contra_asset") return "asset";
  if (type === "revenue" || type === "contra_revenue") return "revenue";
  if (type === "liability" || type === "equity" || type === "expense") return type;
  return "other";
}

// Accounts are read in their normal direction: a debit-normal account (assets,
// expenses) grows with debits, a credit-normal one (liabilities, equity,
// revenue) with credits.
export function accountMeta(code, fallbackName) {
  const a = COA_BY_CODE[code];
  return {
    code,
    name: a?.name || fallbackName || code,
    creditNormal: a ? a.normal_balance === "credit" : false,
    inCoa: !!a,
    group: groupOf(a?.type),
  };
}
export const signed = (meta, debit, credit) => (meta.creditNormal ? credit - debit : debit - credit);

// A line's dimension tags: its own, or — for entries that predate per-line
// tagging — the value simulated on the dimensions its account carries. Same
// key as the Journal Entry page (lib/dimensionUsage.js), so both show the same.
export function lineDimensions(je, l) {
  const keys = new Set([...dimensionsForAccount(COA_BY_CODE[l.account_code]), ...Object.keys(l.dimensions || {})]);
  const out = {};
  for (const k of keys) {
    const v = l.dimensions?.[k] ?? sampleDimensionValue(k, `${je.je_number}|${l.account_code}|${k}`);
    if (v && v !== "—") out[k] = v;
  }
  return out;
}

// Vendor or customer behind a line: the line's payee, an older entry's header
// payee, or the bill / invoice the entry came from.
function partyOf(je, l, { billsById, invoicesById }) {
  if (l.payee?.name) return l.payee.name;
  if (je.payee?.name) return je.payee.name;
  const id = je.reference_id;
  if (id && billsById[id]) return billsById[id].vendorName;
  if (id && invoicesById[id]) return invoicesById[id].customerName;
  return "";
}

// Every journal line the GL can show, oldest first. `billsById` /
// `invoicesById` resolve the party on module-written entries.
export function glLines(entries, { bills = [], invoices = [] } = {}) {
  const billsById = Object.fromEntries(bills.map((b) => [b.id, b]));
  const invoicesById = Object.fromEntries(invoices.map((i) => [i.id, i]));
  // An open reclassification shows on the line it moves, so nobody starts a
  // second one while the first waits for approval.
  const reclassOpen = new Map();
  for (const je of entries) {
    if (je.reclass_of && (je.status === "pending" || je.status === "draft")) {
      reclassOpen.set(`${je.reclass_of.je_number}:${je.reclass_of.line}`, je.je_number);
    }
  }
  const out = [];
  for (const je of entries) {
    if (!GL_STATUS_KEYS.has(je.status)) continue;
    const source = entrySource(je);
    (je.lines || []).forEach((l, i) => {
      const meta = accountMeta(l.account_code, l.account_name);
      out.push({
        key: `${je.je_number}:${i}`,
        lineIndex: i,
        date: je.je_date,
        je_number: je.je_number,
        status: je.status,
        memo: je.memo,
        desc: l.description || je.memo,
        code: l.account_code,
        name: meta.name,
        meta,
        dc: toCents(l.debit),
        cc: toCents(l.credit),
        source,
        reference_type: je.reference_type || "manual",
        reference_id: je.reference_id || null,
        party: partyOf(je, l, { billsById, invoicesById }),
        payee: l.payee || null,
        dims: lineDimensions(je, l),
        reversed_by: je.reversed_by || null,
        reversal_of: je.reversal_of || null,
        reclass_of: je.reclass_of || null,
        reclass_open: reclassOpen.get(`${je.je_number}:${i}`) || null,
      });
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.je_number.localeCompare(b.je_number) || a.lineIndex - b.lineIndex);
}

// ── Filters (§3.4) ──────────────────────────────────────────────────────
// Every filter narrows; an empty one lets everything through.
export const EMPTY_FILTERS = {
  statuses: ["posted"],
  types: [],
  codeFrom: "",
  codeTo: "",
  sources: [],
  min: "",
  max: "",
  party: "",
  dims: {},
  hideReversed: false,
};

// How many filters differ from the default — for the Filters button badge.
export function activeFilterCount(f) {
  let n = 0;
  if (f.statuses.length !== 1 || f.statuses[0] !== "posted") n += 1;
  if (f.types.length) n += 1;
  if (f.codeFrom || f.codeTo) n += 1;
  if (f.sources.length) n += 1;
  if (f.min !== "" || f.max !== "") n += 1;
  if (f.party) n += 1;
  n += Object.values(f.dims).filter(Boolean).length;
  if (f.hideReversed) n += 1;
  return n;
}

// Code ranges compare on digits, so "4000–5999", "4–5" and "4-1100–4-1400"
// all work: a bound matches every code that starts at or within it.
const digits = (s) => String(s || "").replace(/\D/g, "");
function inCodeRange(code, from, to) {
  const c = digits(code);
  const f = digits(from);
  const t = digits(to);
  if (f && c.slice(0, f.length) < f) return false;
  if (t && c.slice(0, t.length) > t) return false;
  return true;
}

// A line passes when it meets every filter. Dates are the caller's (the period
// decides what is opening balance and what is movement).
export function lineMatches(l, f) {
  if (!f.statuses.includes(l.status)) return false;
  if (f.types.length && !f.types.includes(l.meta.group)) return false;
  if ((f.codeFrom || f.codeTo) && !inCodeRange(l.code, f.codeFrom, f.codeTo)) return false;
  if (f.sources.length && !f.sources.includes(l.source)) return false;
  const amt = Math.max(l.dc, l.cc);
  if (f.min !== "" && amt < toCents(f.min)) return false;
  if (f.max !== "" && amt > toCents(f.max)) return false;
  if (f.party && l.party !== f.party) return false;
  for (const [k, v] of Object.entries(f.dims)) if (v && l.dims[k] !== v) return false;
  if (f.hideReversed && (l.reversed_by || l.reversal_of)) return false;
  return true;
}

// Free-text search over what a line says about itself.
export function lineSearchText(l) {
  return `${l.je_number} ${l.desc} ${l.memo} ${l.code} ${l.name} ${l.party} ${l.reference_id || ""}`.toLowerCase();
}

// ── Per-account roll-up ────────────────────────────────────────────────
// Opening = posted movement before `from`; debit / credit = posted movement in
// the period; unposted = draft and pending movement in the period (signed in
// the account's direction), shown in its own column.
export function accountSummary(lines, { from, to, order }) {
  const by = new Map();
  for (const l of lines) {
    if (l.date > to) continue;
    if (!by.has(l.code)) by.set(l.code, { meta: l.meta, opening: 0, debit: 0, credit: 0, unposted: 0, count: 0 });
    const s = by.get(l.code);
    if (l.status !== "posted") {
      if (l.date >= from) { s.unposted += signed(s.meta, l.dc, l.cc); s.count += 1; }
      continue;
    }
    if (l.date < from) s.opening += signed(s.meta, l.dc, l.cc);
    else { s.debit += l.dc; s.credit += l.cc; s.count += 1; }
  }
  return [...by.values()]
    .map((s) => ({ ...s, closing: s.opening + signed(s.meta, s.debit, s.credit) }))
    .filter((s) => s.count > 0 || s.opening !== 0)
    .sort((a, b) => (order.get(a.meta.code) ?? 1e6) - (order.get(b.meta.code) ?? 1e6) || a.meta.code.localeCompare(b.meta.code));
}

// ── Quick reclassification (§3.5) ──────────────────────────────────────
// The original line is never touched. A new two-line journal takes the amount
// off the old account (or cost centre) and books it to the new one, same side,
// same payee. Partial amounts are allowed (§8 OQ4). It goes in for approval
// like any manual journal: whoever starts it cannot also post it.
export function buildReclassification(line, { toCode, amountCents, toDims, date, reason, jeNumber, by, today }) {
  const debitSide = line.dc > 0;
  const amt = amountCents / 100;
  const side = (onDebit) => (onDebit ? { debit: amt, credit: 0 } : { debit: 0, credit: amt });
  const target = COA_BY_CODE[toCode];
  const payee = line.payee ? { payee: line.payee } : {};
  const draft = {
    je_number: jeNumber,
    je_date: date,
    status: "draft",
    memo: `Reclassify ${line.je_number} line ${line.lineIndex + 1} — ${reason}`,
    reference_type: "reclassification",
    reference_id: line.je_number,
    reclass_of: { je_number: line.je_number, line: line.lineIndex },
    created_by: by, created_date: today,
    posted_by: null, posted_date: null,
    lines: [
      {
        account_code: line.code,
        account_name: line.name,
        ...side(!debitSide),
        description: `Reclass out: ${line.desc}`,
        dimensions: { ...line.dims },
        ...payee,
      },
      {
        account_code: toCode,
        account_name: target?.name || toCode,
        ...side(debitSide),
        description: `Reclass in: ${line.desc}`,
        dimensions: { ...toDims },
        ...payee,
      },
    ],
  };
  return withEvent(draft, "created", by, `Reclassification from the General Ledger (${line.je_number} line ${line.lineIndex + 1})`);
}
