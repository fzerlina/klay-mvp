// Non-Bank Reconciliation — the numbers behind one account's month.
//
// A person brings an ending balance and the evidence for it: a cash count, the
// balance in an e-wallet app, a gateway's settlement report, a schedule of what
// is still in transit. They tick the GL lines that evidence includes. What is
// left unticked is outstanding and carries to the next month.
//
//   difference  =  ending balance  −  (beginning balance  +  ticked lines)
//
// The beginning balance is last month's approved ending balance (the opening
// balance for the first month). A month can only start once the month before
// it is reconciled, so there is one chain per account and no gaps in it.
//
// Nothing here posts. A difference is cleared by ticking more lines or by
// posting the journal Klay drafts to the account's difference account.

import { OPENING_BALANCES } from "../data/seed/openingBalances";
import { monthEnd, shiftPeriod } from "../data/seed/bankStatement";
import { COA } from "../data/seed/coa";
import { TODAY } from "./clock";

// The demo day in local time — toISOString() would give the UTC day, a day early east of Greenwich.
const TODAY_ISO = `${TODAY.getFullYear()}-${String(TODAY.getMonth() + 1).padStart(2, "0")}-${String(TODAY.getDate()).padStart(2, "0")}`;

export const nameOf = (code) => COA.find((a) => a.code === code)?.name || code;
export const recordKey = (accountId, period) => `${accountId}:${period}`;

// The four stages of a month, plus the one an account is in before it starts.
export const STATUS = {
  none:     { key: "none",     label: "Not started",    tone: "muted" },
  blocked:  { key: "blocked",  label: "Not started",    tone: "muted" },
  draft:    { key: "draft",    label: "In progress",    tone: "warn" },
  sentBack: { key: "sentBack", label: "Sent back",      tone: "danger" },
  review:   { key: "review",   label: "Pending review", tone: "warn" },
  approved: { key: "approved", label: "Reconciled",     tone: "success" },
};

// Every posted line on the account's GL code, in date order. One id per line
// (a journal can touch the account twice).
export function linesOn(entries, glCode) {
  const out = [];
  for (const je of entries) {
    if (je.status !== "posted") continue;
    je.lines.forEach((l, i) => {
      if (l.account_code !== glCode) return;
      out.push({
        id: `${je.je_number}#${i}`,
        je: je.je_number,
        date: je.je_date,
        memo: je.memo,
        description: l.description,
        refType: je.reference_type,
        amount: (l.debit || 0) - (l.credit || 0),
      });
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.je.localeCompare(b.je) || a.id.localeCompare(b.id));
}

export const openingOf = (glCode) =>
  OPENING_BALANCES.filter((r) => r.account_code === glCode).reduce((t, r) => t + (r.debit || 0) - (r.credit || 0), 0);

// The default statement date: month-end, or today for the month we're in.
export const defaultStatementDate = (period) => {
  const end = monthEnd(period);
  return end > TODAY_ISO ? TODAY_ISO : end;
};

const sum = (lines) => lines.reduce((t, l) => t + l.amount, 0);

// One account across the periods shown, oldest first. Each month gets its
// numbers from the one before it.
export function accountChain(account, lines, records, periods) {
  const opening = openingOf(account.glAccount);
  const ordered = [...periods].sort();
  const cleared = new Set();
  let beginning = opening;
  let priorApproved = true;
  let priorPeriod = null;
  const out = {};

  for (const period of ordered) {
    const rec = records[recordKey(account.id, period)] || null;
    const statementDate = rec?.statementDate || defaultStatementDate(period);
    const periodStart = `${period}-01`;
    const candidates = lines.filter((l) => l.date <= statementDate && !cleared.has(l.id));
    const ticked = new Set(rec?.ticked || []);
    const tickedLines = candidates.filter((l) => ticked.has(l.id));
    const outstanding = candidates.filter((l) => !ticked.has(l.id));
    const glBalance = opening + sum(lines.filter((l) => l.date <= statementDate));
    const tickedNet = sum(tickedLines);
    const ending = rec ? rec.endingBalance : null;
    const difference = ending == null ? null : ending - (beginning + tickedNet);

    let status = STATUS.none;
    if (rec) status = rec.status === "draft" ? (rec.sentBack ? STATUS.sentBack : STATUS.draft) : STATUS[rec.status];
    else if (!priorApproved) status = STATUS.blocked;

    out[period] = {
      account, period, record: rec, status, statementDate, beginning, glBalance,
      candidates: candidates.map((l) => ({ ...l, carried: l.date < periodStart })),
      tickedNet, outstandingNet: sum(outstanding), outstandingCount: outstanding.length,
      ending, difference, blockedBy: !rec && !priorApproved ? priorPeriod : null,
    };

    if (rec?.status === "approved") {
      tickedLines.forEach((l) => cleared.add(l.id));
      beginning = rec.endingBalance;
      priorApproved = true;
    } else {
      priorApproved = false;
    }
    priorPeriod = period;
  }
  return out;
}

// Seeded reconciliations name the lines left outstanding (`untick`); every
// other line up to the statement date was ticked. Resolved once, in period
// order, so a later month starts from what the earlier one cleared.
export function resolveSeed(seed, accounts, entries) {
  const records = {};
  const periods = [...new Set(seed.map((s) => s.period))].sort();
  for (const period of periods) {
    for (const s of seed.filter((x) => x.period === period)) {
      const account = accounts.find((a) => a.id === s.accountId);
      const chain = accountChain(account, linesOn(entries, account.glAccount), records, [...periods.filter((p) => p < period), period]);
      const untick = new Set(s.untick || []);
      const ticked = chain[period].candidates.filter((l) => !untick.has(l.je)).map((l) => l.id);
      const notes = Object.fromEntries(
        Object.entries(s.notes || {}).flatMap(([je, note]) => chain[period].candidates.filter((l) => l.je === je).map((l) => [l.id, note])),
      );
      const log = [{ at: s.submittedAt, by: s.preparedBy, text: "Started and submitted for review" }];
      if (s.sentBack) log.push({ at: s.sentBack.at, by: s.sentBack.by, text: `Sent back: ${s.sentBack.comment}` });
      if (s.status === "approved") log.push({ at: s.approvedAt, by: s.reviewedBy, text: "Approved" });
      records[recordKey(s.accountId, period)] = {
        accountId: s.accountId, period, status: s.status, statementDate: s.statementDate, endingBalance: s.endingBalance,
        evidence: s.evidence, preparedBy: s.preparedBy, submittedAt: s.submittedAt, reviewedBy: s.reviewedBy || null,
        approvedAt: s.approvedAt || null, sentBack: s.sentBack || null, ticked, notes, log,
      };
    }
  }
  return records;
}

// The journal that clears a difference. Positive: the evidence holds more than
// the books (an overage, a receipt not yet booked) — the account goes up.
export function differenceDraft(account, period, difference, date) {
  const amount = Math.abs(difference);
  const month = new Date(`${period}-01T00:00:00`).toLocaleString("en-US", { month: "long", year: "numeric" });
  const memo =
    account.type === "cash" ? `Cash count ${difference < 0 ? "short" : "over"} — ${account.name}, ${month}`
      : account.type === "gateway" ? `${account.name} fees not yet booked — ${month}`
        : `${account.name} reconciliation difference — ${month}`;
  const own = { account_code: account.glAccount, account_name: nameOf(account.glAccount), description: account.name };
  const other = { account_code: account.differenceAccount, account_name: nameOf(account.differenceAccount), description: memo };
  const lines = difference > 0
    ? [{ ...own, debit: amount, credit: 0 }, { ...other, debit: 0, credit: amount }]
    : [{ ...other, debit: amount, credit: 0 }, { ...own, debit: 0, credit: amount }];
  return { memo, je_date: date, lines };
}

export const countTotal = (counts = {}) =>
  Object.entries(counts).reduce((t, [k, n]) => t + Number(k.split("-")[1]) * (n || 0), 0);
