// The bank-reconciliation axis, and the close state it produces.
//
// This is a THIRD axis, independent of the two in paymentStage.js:
//
//   Payment status   how much of the bill is paid off   (derived from the ledger)
//   Request status   where the payment request sits     (stored in PaymentsContext)
//   Recon status     has the bank confirmed the money moved
//
// It is deliberately NOT a stage either of the other two can reach. "Paid"
// means our payable is relieved; it says nothing about whether the cash has
// shown up on a statement. A payment can be paid-in-full and unreconciled for
// weeks, and a reconciled payment can still leave a partial balance behind.
// That is why the vocabulary note in paymentStage.js reserves "settled" — this
// axis is where that confirmation lives.
//
// It used to derive that answer from statement COVERAGE: a payment counted as
// reconciled if the loaded statement reached the day it was recorded. That was
// a stand-in for matching, and it was wrong in both directions — it called a
// payment reconciled when no bank line corresponded to it, and it had no way to
// see a bank line that corresponded to nothing. Now the answer comes from the
// matching engine, so "reconciled" means a specific bank line was matched to
// this specific payment, and the reason can be read rather than trusted.

import { statementFor } from "../data/seed/bankStatement";
import { bookRecordsFor } from "./bankLedger";
import { reconcile, EXCEPTION_TYPES } from "./bankMatching";
import { bankAccountById, COMPANY_BANK_ACCOUNTS, statementLabelOf } from "../data/seed/bankAccounts";
import { addDays } from "./clock";

// ── The five states ──────────────────────────────────────────────────────────
//
// Straight from the PRD, where this model is called a first-class product
// output rather than an internal detail — the Close Command Center's Gate 4
// reads exactly these values.
//
// The load-bearing decision is RECONCILED_WITH_TIMING closing the gate. A
// BI-FAST payment booked after the statement cut-off has not failed to clear;
// it has not had time to. Blocking a close on it would be false precision, and
// a Finance Manager who is blocked by things that resolve themselves learns to
// override the block — which is how a genuine mismatch gets waved through.

export const RECON_STATES = {
  // Not one of the PRD's five. An account with no GL account mapped cannot be
  // reconciled to the ledger at all — there is nowhere for its movements to
  // post, so there is nothing to hold a statement against. Calling that
  // UNRECONCILED would put the entity's Gate 4 permanently red over a petty-cash
  // float nobody intends to reconcile this way, and a gate that is always red is
  // a gate nobody reads. paymentJournal.js already treats an unmapped account as
  // a configuration fact rather than an error; so does this.
  OUT_OF_SCOPE: {
    key: "OUT_OF_SCOPE",
    label: "Not reconciled here",
    tone: "muted",
    gateClosed: true,
    blurb: "No GL account mapped, so there is nothing to reconcile a statement against.",
  },
  UNRECONCILED: {
    key: "UNRECONCILED",
    label: "Unreconciled",
    tone: "danger",
    gateClosed: false,
    blurb: "No statement loaded for this period.",
  },
  IN_PROGRESS: {
    key: "IN_PROGRESS",
    label: "Matching",
    tone: "muted",
    gateClosed: false,
    blurb: "Statement loaded, matching engine running.",
  },
  RECONCILED_WITH_EXCEPTIONS: {
    key: "RECONCILED_WITH_EXCEPTIONS",
    label: "Exceptions open",
    tone: "warn",
    gateClosed: false,
    blurb: "Matching complete. Some items need a decision.",
  },
  RECONCILED_WITH_TIMING: {
    key: "RECONCILED_WITH_TIMING",
    label: "Reconciled",
    tone: "success",
    gateClosed: true,
    blurb: "Everything matched. What is left will clear by itself.",
  },
  FULLY_RECONCILED: {
    key: "FULLY_RECONCILED",
    label: "Fully reconciled",
    tone: "success",
    gateClosed: true,
    blurb: "Every line matched or written off.",
  },
};

// The PRD's wording for a single payment, which is a narrower question than an
// account's state: did THIS money reach the bank.
export const RECON_META = {
  cleared:   { key: "cleared",   label: "Cleared",   tone: "success" },
  intransit: { key: "intransit", label: "In transit", tone: "muted" },
  unmatched: { key: "unmatched", label: "Unmatched", tone: "warn" },
};

// ── State derivation ─────────────────────────────────────────────────────────
//
// Note what counts as "left over". An open bank fee is not a timing difference,
// so an account with two unconfirmed fees is RECONCILED_WITH_EXCEPTIONS and its
// gate stays open — which reads harsh for a Rp 2.500 charge until you notice the
// resolution is one tap on a batch button. The PRD draws the line exactly here:
// timing exceptions close the gate, and everything else is a decision somebody
// still has to make.

export const reconcilable = (account) => !!account?.glAccount;

export function stateOf(result, statement) {
  if (!reconcilable(statement?.account)) return RECON_STATES.OUT_OF_SCOPE;
  if (!statement || !statement.loaded) return RECON_STATES.UNRECONCILED;
  const open = result.exceptions.filter((e) => !e.resolution);
  if (!open.length) return RECON_STATES.FULLY_RECONCILED;
  const blocking = open.filter((e) => EXCEPTION_TYPES[e.type]?.blocking);
  if (blocking.length) return RECON_STATES.RECONCILED_WITH_EXCEPTIONS;
  const nonTiming = open.filter((e) => e.type !== "TIMING_DIFFERENCE");
  if (nonTiming.length) return RECON_STATES.RECONCILED_WITH_EXCEPTIONS;
  return RECON_STATES.RECONCILED_WITH_TIMING;
}

// ── Running a reconciliation ─────────────────────────────────────────────────
//
// Memoised per account, because three different surfaces ask for the same
// answer on the same render — the reconciliation page, the Gate 4 card on the
// close board, and every payment row on a bill. Re-deriving it each time is
// wasted work, and worse, invites the three to disagree if any of them ever
// passes a slightly different window.

const cache = new Map();

export function runReconciliation(accountId, { extraPayments = null, force = false } = {}) {
  const key = `${accountId}|${extraPayments ? "live" : "seed"}`;
  if (!force && cache.has(key)) return cache.get(key);

  const statement = statementFor(accountId, { extraPayments });
  if (!statement) return null;

  // The ledger is read past the statement's cut-off on purpose: a payment
  // booked after it is precisely what "in transit" means, and a window that
  // stopped at the cut-off would make those payments invisible rather than
  // pending.
  const books = statement.loaded
    ? bookRecordsFor(accountId, { from: statement.from, to: addDays(statement.through, 21), extraPayments })
    : [];

  const result = reconcile({ statement, books });
  const state = stateOf(result, statement);
  const out = { accountId, account: statement.account, statement, ...result, state, statementLabel: statementLabelOf(statement.account) };
  cache.set(key, out);
  return out;
}

export const clearReconciliationCache = () => cache.clear();

// Every account, worst-first. The entity's Gate 4 is the worst state across its
// accounts: one account with an unexplained debit means the entity's books are
// not proven, however clean the other ten are.
export function allReconciliations(opts) {
  return COMPANY_BANK_ACCOUNTS.map((a) => runReconciliation(a.id, opts)).filter(Boolean);
}

const STATE_SEVERITY = ["OUT_OF_SCOPE", "FULLY_RECONCILED", "RECONCILED_WITH_TIMING", "IN_PROGRESS", "RECONCILED_WITH_EXCEPTIONS", "UNRECONCILED"];

export function entityState(runs) {
  if (!runs.length) return RECON_STATES.UNRECONCILED;
  const worst = runs.reduce((acc, r) => (STATE_SEVERITY.indexOf(r.state.key) > STATE_SEVERITY.indexOf(acc.state.key) ? r : acc));
  return worst.state;
}

// ── One payment's answer ─────────────────────────────────────────────────────
//
// `at` is the date the payment was recorded, `breakdown` its typed split and
// `billId` the bill it cleared. All three are needed: the account comes from
// the breakdown, and the bill plus the date identify which of that bill's
// payments this row is.
//
// Every "not yet" says which fact it rests on, so the answer can be checked
// rather than trusted — that discipline is the reason this function exists
// instead of a stored flag on the bill.

export function reconOf({ at, breakdown, billId } = {}) {
  const out = (key, why) => ({ ...RECON_META[key], why });

  if (!breakdown) {
    // A seeded payment with no breakdown behind it — there is no account to
    // check against, so claiming either answer would be invention.
    return out("unmatched", "No payment record behind this line to match against a statement.");
  }

  const account = bankAccountById(breakdown.sourceAccountId);
  if (!account) return out("unmatched", "No source account recorded on this payment.");
  if (!account.statementThrough) return out("unmatched", `${account.name} has no statement loaded.`);

  const run = runReconciliation(account.id);
  if (!run) return out("unmatched", `${account.name} has no statement loaded.`);

  const link = run.links.find((l) => l.record.billId === billId && l.record.date === at);
  if (link) return out("cleared", link.signal);

  const pending = run.outstanding.find((o) => o.record.billId === billId && o.record.date === at);
  if (pending) {
    return out(pending.overdue ? "unmatched" : "intransit", pending.exception.explanation);
  }

  return out(
    "unmatched",
    `The ${account.name} statement (${statementLabelOf(account)}) holds no line matching this payment, and the ledger entry for it was not offered to the matching run.`,
  );
}

// A bill's answer, which is the roll-up of its payments' answers rather than a
// field of its own. A bill paid in three instalments is only cleared when all
// three are — and the weakest instalment is the one that decides, because a
// bill with two confirmed payments and one the bank has never seen is not a
// bill whose money has arrived.
//
// This replaces `bill.bankReconStatus`, a string seeded on the bill record that
// no reconciliation ever wrote to and that disagreed with the payment rows
// directly below it on the same page.
export function billReconOf(billId, history = []) {
  if (!history.length) {
    return { ...RECON_META.unmatched, label: "—", why: "Nothing has been paid on this bill yet, so there is nothing for a bank statement to confirm." };
  }
  const answers = history.map((h) => reconOf({ ...h, billId }));
  const worst = answers.find((a) => a.key === "unmatched") || answers.find((a) => a.key === "intransit") || answers[0];
  if (answers.length === 1) return worst;
  const cleared = answers.filter((a) => a.key === "cleared").length;
  return { ...worst, why: `${cleared} of ${answers.length} payments on this bill are confirmed by a bank statement. ${worst.why}` };
}
