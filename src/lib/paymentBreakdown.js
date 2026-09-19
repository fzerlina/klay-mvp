// Typed payment breakdown.
//
// A bill is almost never paid off by one transfer of exactly the invoiced
// amount. Some of it is withheld for the tax office, some is a discount, some
// is a rounding difference, some is netted against what the counterparty owes
// us. Every Indonesian SMB tool models that as a single anonymous "deduction"
// box — or, in Accurate's case, teaches users to dump it in the discount-account
// field — which means the ledger records that money moved but never why.
//
// Here every rupiah that closes off a bill is either cash out of a named source
// account or a deduction booked to a named GL account. `to_vendor` is the only
// component that actually leaves the bank, so it is also the amount that ends up
// in a bank file and the amount bank reconciliation will later look for on the
// statement.
//
// Shape:
//   {
//     method: "bank" | "cash" | "giro",
//     sourceAccountId: string | null,   // OUR account the money comes out of
//     giroNumber: string,               // giro only
//     to_vendor: number,
//     deductions: [{ id, amount, account }],   // account = COA code
//   }
//
// Deductions were once a fixed set of keys (withholding / discount / write_off
// / …), one row each at most. That could not express two write-offs to two
// accounts, and it made the ACCOUNT an invisible consequence of the label
// rather than the thing being chosen. Now the account IS the classification:
// one row per deduction, as many rows as the payment needs.

import { COA } from "../data/seed/coa";

export const PAYMENT_METHODS = [
  {
    key: "bank", label: "Bank transfer",
    hint: "Leaves the account immediately and appears on the next statement.",
  },
  {
    key: "cash", label: "Cash",
    hint: "Paid out of a petty-cash float. No bank statement line to reconcile against.",
  },
  {
    key: "giro", label: "Giro",
    hint: "A post-dated cheque. The bill is relieved now; the bank balance moves when the giro clears.",
  },
];
export const PAYMENT_METHOD_BY_KEY = Object.fromEntries(PAYMENT_METHODS.map((m) => [m.key, m]));

// Where withheld tax lands. Named here because two things key off it: the
// bukti potong callout in the modal, and the default deduction a bill's PPh
// pre-fills into.
export const WITHHOLDING_ACCOUNT = "2-2300";

// Every leaf account, for the deduction account picker. A deduction can in
// principle hit any account, so the picker searches all of them rather than a
// curated subset that would be wrong for somebody.
export const DEDUCTION_ACCOUNTS = COA.filter((a) => a.type !== "group" && a.is_active);
export const accountByCode = (code) => DEDUCTION_ACCOUNTS.find((a) => a.code === code) || null;
export const accountLabel = (code) => {
  const a = accountByCode(code);
  return a ? `${a.code} · ${a.name}` : code || "";
};

// The handful of treatments that come up on nearly every payment, offered
// first in the picker so the common case is one click rather than a search.
// This is a shortcut into the full list, NOT a restriction on it.
export const COMMON_DEDUCTION_ACCOUNTS = [
  { code: WITHHOLDING_ACCOUNT, hint: "Kept back from the vendor and owed to the tax office — creates a bukti potong obligation." },
  { code: "1-5200", hint: "An advance already paid to this vendor, applied against this bill." },
  { code: "4-2300", hint: "A discount the vendor agreed to, or a small rounding difference so the bill closes cleanly." },
  { code: "1-2300", hint: "Netted against an invoice this counterparty owes us." },
  { code: "6-4000", hint: "A balance we have decided not to pay and not to chase." },
].filter((s) => accountByCode(s.code));

let seq = 0;
export const newDeduction = (patch = {}) => ({ id: `d${++seq}`, amount: 0, account: "", ...patch });

export function emptyBreakdown() {
  return { method: "bank", sourceAccountId: null, giroNumber: "", to_vendor: 0, deductions: [] };
}

// The split a payment starts from: clear the whole open balance, withholding
// whatever PPh the bill already carries. Everything else is zero until someone
// deliberately adds a row.
export function defaultBreakdown({ remaining = 0, pph23 = 0 } = {}, patch = {}) {
  const b = emptyBreakdown();
  const withheld = Math.min(pph23 || 0, remaining);
  if (withheld > 0) b.deductions = [newDeduction({ amount: withheld, account: WITHHOLDING_ACCOUNT })];
  b.to_vendor = Math.max(0, remaining - withheld);
  return { ...b, ...patch };
}

const num = (n) => Number(n) || 0;

export const deductionsOf = (b) => (Array.isArray(b?.deductions) ? b.deductions : []);
export const deductionTotal = (b) => deductionsOf(b).reduce((s, d) => s + num(d.amount), 0);

// What the bill is relieved by — cash plus every deduction.
export const breakdownTotal = (b) => num(b?.to_vendor) + deductionTotal(b);

// What leaves the bank.
export const cashOut = (b) => num(b?.to_vendor);

// Deductions carrying a value — used to render only the lines in play.
export const activeDeductions = (b) => deductionsOf(b).filter((d) => num(d.amount) !== 0);

// Tax withheld, read off the accounts rather than off a label: a deduction is
// withholding because of where it is booked, not because of what it is called.
export const withheldTax = (b) =>
  deductionsOf(b).filter((d) => d.account === WITHHOLDING_ACCOUNT).reduce((s, d) => s + num(d.amount), 0);

// Roll several payments into one set of totals, merging deductions by account
// so a bill paid in three instalments reports one line per account, not nine.
export function sumBreakdowns(list = []) {
  const byAccount = new Map();
  let to_vendor = 0;
  for (const b of list) {
    to_vendor += num(b?.to_vendor);
    for (const d of deductionsOf(b)) {
      if (!num(d.amount)) continue;
      byAccount.set(d.account, (byAccount.get(d.account) || 0) + num(d.amount));
    }
  }
  return {
    to_vendor,
    deductions: [...byAccount].map(([account, amount]) => newDeduction({ account, amount })),
  };
}

// A payment is only valid if it clears something, clears no more than is open,
// puts every deduction somewhere nameable, and says where the cash came from.
export function validateBreakdown(b, remaining) {
  const total = breakdownTotal(b);
  const rows = deductionsOf(b);
  if (num(b?.to_vendor) < 0 || rows.some((d) => num(d.amount) < 0)) {
    return { ok: false, reason: "No component can be negative." };
  }
  if (total <= 0) return { ok: false, reason: "Allocate at least part of the balance." };
  if (total > remaining) {
    return { ok: false, reason: "The components add up to more than the open balance." };
  }
  if (rows.some((d) => num(d.amount) > 0 && !d.account)) {
    return { ok: false, reason: "Every deduction needs an account to be booked to." };
  }
  // Cash still leaves a real account, so a source is required whenever any
  // does — the exception is a payment made entirely of deductions, where no
  // money moves at all.
  if (cashOut(b) > 0 && !b?.sourceAccountId) {
    return { ok: false, reason: "Choose the account this payment comes out of." };
  }
  if (b?.method === "giro" && !String(b?.giroNumber || "").trim()) {
    return { ok: false, reason: "A giro payment needs its giro number for the trail." };
  }
  return { ok: true, total, paysInFull: total >= remaining };
}

// One-line plain-English description of what the vendor and each account get,
// used wherever a payment needs explaining rather than tabulating.
// `omit` drops deductions booked to those accounts — for callers that give one
// of them a line of its own and would otherwise state it twice.
export function describeBreakdown(b, { omit = [] } = {}) {
  const parts = [`To vendor ${fmtShort(cashOut(b))}`];
  for (const d of activeDeductions(b)) {
    if (omit.includes(d.account)) continue;
    parts.push(`${accountByCode(d.account)?.name || d.account} ${fmtShort(d.amount)}`);
  }
  return parts.join(" · ");
}

// Audit-trail wording for an executed payment. The total leads so a payment
// history can read the amount off the line; the components follow so the trail
// says what the money actually was, and by which method it left.
export function auditTextFor(bd, full, { sourceName } = {}) {
  const head = `${full ? "Payment executed" : "Partial payment"} — ${fmtFull(breakdownTotal(bd))}`;
  const bits = [];
  const method = PAYMENT_METHOD_BY_KEY[bd?.method]?.label || "Bank transfer";
  bits.push(`${method.toLowerCase()}${sourceName ? ` from ${sourceName}` : ""}`);
  if (bd?.method === "giro" && bd.giroNumber) bits.push(`giro ${bd.giroNumber}`);
  bits.push(`to vendor ${fmtFull(cashOut(bd))}`);
  for (const d of activeDeductions(bd)) {
    bits.push(`${(accountByCode(d.account)?.name || d.account).toLowerCase()} ${fmtFull(d.amount)}`);
  }
  return `${head} (${bits.join(", ")})`;
}

const fmtFull = (n) => `Rp ${Number(n || 0).toLocaleString("id-ID")}`;

function fmtShort(n) {
  if (!n) return "Rp 0";
  if (n >= 1e9) return `Rp ${(n / 1e9).toLocaleString("id-ID", { maximumFractionDigits: 1 })} M`;
  if (n >= 1e6) return `Rp ${(n / 1e6).toLocaleString("id-ID", { maximumFractionDigits: 1 })} jt`;
  return `Rp ${n.toLocaleString("id-ID")}`;
}
