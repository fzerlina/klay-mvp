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
// matching engine and the decisions laid over it, so "reconciled" means a
// person reconciled a specific bank line to this specific payment.

import { statementFor, statementLabel, monthEnd, CURRENT_PERIOD } from "../data/seed/bankStatement";
import { bookRecordsFor } from "./bankLedger";
import { reconcile, EXCEPTION_TYPES, isOpen } from "./bankMatching";
import { bankAccountById, COMPANY_BANK_ACCOUNTS, statementLabelOf } from "../data/seed/bankAccounts";
import { addDays } from "./clock";

// ── An account's state ──────────────────────────────────────────────────────
//
// Three stages, grey → amber → green, and the close board's Gate 4 reads
// exactly these values:
//
//   No statement yet   nothing uploaded for the month
//   In progress        uploaded; lines open, or all decided but the uploads
//                      don't reach month-end ("Up to date")
//   Reconciled         the whole month on file, every line decided
//
// Statements are uploaded more than once a month, so "every line decided" is
// not enough on its own: an account caught up through the 20th is up to date,
// not reconciled. Payments booked in Klay but not yet on the statement never
// hold an account open — they are the bank's timing, not a decision.

export const RECON_STATES = {
  // Not a stage. An account with no GL account mapped cannot be reconciled to
  // the ledger at all — there is nowhere for its movements to post. Shown as a
  // muted note, and it never holds the close open.
  OUT_OF_SCOPE: {
    key: "OUT_OF_SCOPE",
    label: "Not reconciled here",
    tone: "muted",
    gateClosed: true,
    blurb: "No GL account mapped, so there is nothing to reconcile a statement against.",
  },
  // Grey. Nothing uploaded for the month yet.
  NO_STATEMENT: {
    key: "NO_STATEMENT",
    label: "No statement yet",
    tone: "muted",
    gateClosed: false,
    blurb: "No statement uploaded for this month.",
  },
  // Amber. At least one upload. Lines still open — or every line decided but
  // the uploads don't reach month-end yet ("Up to date"): a statement can be
  // uploaded several times a month, and being caught up through the 20th is
  // not the month reconciled.
  IN_PROGRESS: {
    key: "IN_PROGRESS",
    label: "In progress",
    tone: "warn",
    gateClosed: false,
    blurb: "Statement uploaded; lines still to reconcile, or the month isn't covered to its last day yet.",
  },
  // Green. The uploads cover the whole month and every line is reconciled or
  // excluded. The only state that closes the month.
  RECONCILED: {
    key: "RECONCILED",
    label: "Reconciled",
    tone: "success",
    gateClosed: true,
    blurb: "The whole month is on file and every line is reconciled or excluded.",
  },
};

// The PRD's wording for a single payment, which is a narrower question than an
// account's state: did THIS money reach the bank.
export const RECON_META = {
  cleared:   { key: "cleared",   label: "Reconciled", tone: "success" },
  suggested: { key: "suggested", label: "To confirm", tone: "muted" },
  intransit: { key: "intransit", label: "In transit", tone: "muted" },
  unmatched: { key: "unmatched", label: "Not reconciled", tone: "warn" },
};

// ── State derivation ─────────────────────────────────────────────────────────
//
// Every statement line counts — a Rp 2.500 fee waiting for its journal holds
// the account open like anything else; its resolution is one tap on Post all.

export const reconcilable = (account) => !!account?.glAccount;

export function stateOf(result, statement) {
  if (!reconcilable(statement?.account)) return RECON_STATES.OUT_OF_SCOPE;
  if (!statement || !statement.loaded) return RECON_STATES.NO_STATEMENT;
  const open = result.exceptions.filter(isOpen).length;
  const wholeMonth = statement.through >= monthEnd(statement.period);
  if (!open && wholeMonth) return RECON_STATES.RECONCILED;
  // Caught up on what is on file, but the month runs on past it.
  if (!open) return { ...RECON_STATES.IN_PROGRESS, label: "Up to date", upToDate: true };
  return RECON_STATES.IN_PROGRESS;
}

// ── Running a reconciliation ─────────────────────────────────────────────────
//
// Memoised per account, because three different surfaces ask for the same
// answer on the same render — the reconciliation page, the Gate 4 card on the
// close board, and every payment row on a bill. Re-deriving it each time is
// wasted work, and worse, invites the three to disagree if any of them ever
// passes a slightly different window.

const cache = new Map();

// `period` defaults to the current month, which is what every caller outside
// the reconciliation page means — Gate 4, the payment rows, the task hub.
export function runReconciliation(accountId, { extraPayments = null, force = false, period = CURRENT_PERIOD } = {}) {
  const key = `${accountId}|${period}|${extraPayments ? "live" : "seed"}`;
  if (!force && cache.has(key)) return cache.get(key);

  const statement = statementFor(accountId, { extraPayments, period });
  if (!statement) return null;

  // The ledger is read past the statement's cut-off on purpose: a payment
  // booked after it is precisely what "in transit" means, and a window that
  // stopped at the cut-off would make those payments invisible rather than
  // pending.
  // A past month stops at its own last day: what was booked in April is April's
  // business, not March's in-transit list.
  const books = statement.loaded
    ? bookRecordsFor(accountId, {
        from: statement.from,
        to: period === CURRENT_PERIOD ? addDays(statement.through, 21) : statement.through,
        extraPayments,
      })
    : [];

  const result = reconcile({ statement, books });
  const state = stateOf(result, statement);
  const out = { accountId, account: statement.account, statement, records: books, ...result, state, statementLabel: statement.loaded ? statementLabel(statement) : period === CURRENT_PERIOD ? statementLabelOf(statement.account) : statementLabel(statement) };
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

const STATE_SEVERITY = ["OUT_OF_SCOPE", "RECONCILED", "IN_PROGRESS", "NO_STATEMENT"];

export function entityState(runs) {
  if (!runs.length) return RECON_STATES.NO_STATEMENT;
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

// `resolutions` is the session's decisions (state/BankReconContext). Without
// them every payment would read "to confirm" — nothing is reconciled until a
// person says so.
export function reconOf({ at, breakdown, billId } = {}, resolutions = {}) {
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
  if (run.statement.awaitingUpload) return out("unmatched", `${account.name}'s statement for this month hasn't been uploaded yet.`);

  const record = (run.records || []).find((r) => r.billId === billId && r.date === at);
  if (record) {
    const exceptions = run.exceptions.map((e) => (resolutions[e.id] ? { ...e, resolution: resolutions[e.id] } : e));
    const done = exceptions.find((e) => {
      const r = e.resolution;
      if (!r || r.action === "exclude") return false;
      return (r.recordIds || []).includes(record.id) || (r.action === "reconcile" && e.suggestion?.recordId === record.id);
    });
    if (done) return out("cleared", done.resolution.note);
    const suggested = exceptions.find((e) => !e.resolution && e.suggestion?.recordId === record.id);
    if (suggested) return out("suggested", `On the statement ${suggested.date} — waiting for someone to reconcile it. ${suggested.explanation}`);
  }

  const pending = run.outstanding.find((o) => o.record.billId === billId && o.record.date === at);
  if (pending) return out(pending.overdue ? "unmatched" : "intransit", pending.why);

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
export function billReconOf(billId, history = [], resolutions = {}) {
  if (!history.length) {
    return { ...RECON_META.unmatched, label: "—", why: "Nothing has been paid on this bill yet, so there is nothing for a bank statement to confirm." };
  }
  const answers = history.map((h) => reconOf({ ...h, billId }, resolutions));
  const worst = answers.find((a) => a.key === "unmatched") || answers.find((a) => a.key === "intransit") || answers.find((a) => a.key === "suggested") || answers[0];
  if (answers.length === 1) return worst;
  const cleared = answers.filter((a) => a.key === "cleared").length;
  return { ...worst, why: `${cleared} of ${answers.length} payments on this bill are reconciled to a bank statement. ${worst.why}` };
}
