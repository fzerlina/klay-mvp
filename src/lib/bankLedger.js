// The book side of bank reconciliation: everything the GL says moved through a
// company bank account, reduced to one shape.
//
// Reconciliation compares two lists. This file builds the one we are sure of —
// what Klay believes happened — so that `bankMatching.js` has something to hold
// the statement against. Nothing here knows about matching; it only answers
// "what does the ledger say went in and out of this account, and when".
//
// Two sources feed it, and they are different in kind:
//
//   Recorded payments   carry a typed breakdown, so we know the vendor, the
//                       gross amount the bill was relieved by, and the tax
//                       withheld — three facts a journal entry alone loses.
//   Posted journals     everything else that touches a bank line: customer
//                       receipts, payroll, utilities, tax remittance.
//
// Only POSTED journals count. A draft entry is not in the general ledger, so
// reconciling against it would be reconciling against an intention.

import { JOURNAL_ENTRIES } from "../data/seed/journalEntries";
import { COA } from "../data/seed/coa";
import { COMPANY_BANK_ACCOUNTS, bankAccountById } from "../data/seed/bankAccounts";
import { PAYMENT_HISTORY_SEED } from "../data/seed/paymentHistory";
import { BILLS } from "../data/seed/bills";
import { VENDORS } from "../data/seed/vendors";
import { CUSTOMERS } from "../data/seed/customers";
import { cashOut, breakdownTotal, withheldTax } from "./paymentBreakdown";

// ── Bridging two code systems ────────────────────────────────────────────────
//
// The bank-account master carries its own posting code ("1101-100 Cash - BCA
// Operating") and the chart of accounts carries another ("1-1300 Bank — BCA
// Operating"). paymentJournal.js already surfaces this mismatch as a flag on
// the entry rather than silently substituting an account, and this file takes
// the same line: the bridge is explicit, tries the configured code FIRST, and
// falls back to the CoA name only because "Bank — {account name}" is a naming
// convention the chart actually follows. Where neither works we return null and
// the ledger simply has no bank movement to offer, which is the honest answer —
// better than attributing someone's payroll run to the wrong account.

const bankCoaCodes = new Set(
  COA.filter((a) => a.type !== "group" && /^Bank — /.test(a.name || "")).map((a) => a.code),
);

const glCodeToAccountId = (() => {
  const map = new Map();
  for (const account of COMPANY_BANK_ACCOUNTS) {
    if (account.glAccount) map.set(account.glAccount, account.id);
  }
  for (const coa of COA) {
    if (!bankCoaCodes.has(coa.code) || map.has(coa.code)) continue;
    const bare = coa.name.replace(/^Bank — /, "").trim();
    const hit = COMPANY_BANK_ACCOUNTS.find((a) => a.name === bare);
    if (hit) map.set(coa.code, hit.id);
  }
  return map;
})();

export const accountIdForGlCode = (code) => glCodeToAccountId.get(code) || null;

// Which CoA code a bank account's movements land on, for the reverse lookup.
export function glCodeForAccount(accountId) {
  for (const [code, id] of glCodeToAccountId) if (id === accountId) return code;
  return null;
}

// ── The counterparty a journal entry is about ────────────────────────────────
//
// A journal memo is prose, not a field, so the name has to be read out of it.
// Most memos put something after an em-dash, but that something is as often a
// product category ("Cash sale — Electronics") or a payment method ("paid from
// operating bank") as it is a party — and a matcher told the counterparty is
// "Electronics" is worse off than one told there is no counterparty at all.
//
// So the trailing segment only counts as a party if it resolves against the
// vendor or customer master. A counterparty is somebody we already know, which
// is a fact we can check, rather than a shape of words, which is a guess. Where
// it does not resolve we return "" — and "" means "no name to compare", which
// the matcher treats differently from a name that failed to match.

const KNOWN_PARTIES = new Set([
  ...VENDORS.map((v) => v.name),
  ...CUSTOMERS.map((c) => c.name),
].filter(Boolean));

const MEMO_PARTY = /—\s*([^—]{3,60})$/;

function partyFromMemo(memo = "") {
  const m = MEMO_PARTY.exec(memo.trim());
  if (!m) return "";
  const name = m[1].trim();
  return KNOWN_PARTIES.has(name) ? name : "";
}

// ── Book records ─────────────────────────────────────────────────────────────
//
// `amount` is signed the way a bank statement signs it: negative left the
// account, positive arrived. That is the bank's convention rather than the
// ledger's (debit/credit), because the whole job of this list is to be compared
// against a statement, and two sign conventions in one comparison is how
// reconciliations get quietly reversed.

function journalBookRecords({ from, to } = {}) {
  const out = [];
  for (const je of JOURNAL_ENTRIES) {
    if (je.status !== "posted") continue;
    // A recorded payment writes its own entry, and paymentBookRecords already
    // reads that payment directly — with the vendor and the withholding that
    // the entry's bank line has lost. Taking both would reconcile the same
    // rupiah twice.
    if (je.reference_type === "payment") continue;
    if (from && je.je_date < from) continue;
    if (to && je.je_date > to) continue;
    for (const line of je.lines) {
      const accountId = accountIdForGlCode(line.account_code);
      if (!accountId) continue;
      const amount = (line.debit || 0) - (line.credit || 0);
      if (!amount) continue;
      out.push({
        id: `${je.je_number}:${line.account_code}`,
        kind: "je",
        accountId,
        date: je.je_date,
        amount,
        counterparty: partyFromMemo(je.memo),
        ref: je.je_number,
        label: je.memo,
        glLine: { account_code: line.account_code, account_name: line.account_name },
        billId: null,
        cleared: Math.abs(amount),
        withheld: 0,
      });
    }
  }
  return out;
}

// A recorded payment is the richer record: `cleared` is what the bill was
// relieved by and `amount` is only the cash that left. When those two differ,
// the difference is withholding — and that gap is exactly what Priority 2 of
// the matching engine exists to explain.
function paymentBookRecords(history = PAYMENT_HISTORY_SEED, { from, to } = {}) {
  const out = [];
  for (const [billId, payments] of Object.entries(history || {})) {
    (payments || []).forEach((p, i) => {
      const account = bankAccountById(p.breakdown?.sourceAccountId);
      if (!account) return;
      if (from && p.at < from) return;
      if (to && p.at > to) return;
      const out_ = cashOut(p.breakdown);
      if (!out_) return;
      // The payment stores the split, not the party — the vendor lives on the bill.
      const vendorName = p.vendorName || BILLS.find((b) => b.id === billId)?.vendorName || "";
      out.push({
        id: `${billId}:${i}`,
        kind: "ap_payment",
        accountId: account.id,
        date: p.at,
        amount: -out_,
        counterparty: vendorName,
        ref: p.je_number || billId,
        label: `Payment to ${vendorName || "vendor"}`,
        glLine: null,
        billId,
        cleared: breakdownTotal(p.breakdown),
        withheld: withheldTax(p.breakdown),
        method: p.breakdown?.method || "bank",
        giroNumber: p.breakdown?.giroNumber || "",
      });
    });
  }
  return out;
}

// Everything the books say passed through a bank account in a window.
//
// `extraPayments` lets a caller fold in payments recorded during the session —
// PaymentsContext holds those, and a reconciliation that ignored them would
// report a payment you just made as an unexplained bank debit.
export function bookRecords({ from, to, extraPayments = null } = {}) {
  return [
    ...journalBookRecords({ from, to }),
    ...paymentBookRecords(PAYMENT_HISTORY_SEED, { from, to }),
    ...(extraPayments ? paymentBookRecords(extraPayments, { from, to }) : []),
  ].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export const bookRecordsFor = (accountId, opts) =>
  bookRecords(opts).filter((r) => r.accountId === accountId);
