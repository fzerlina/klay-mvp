// The bank's version of events.
//
// A reconciliation is only interesting if the two lists genuinely differ, so
// this file does not hand-pair rows with the ledger. It starts from what the
// books say (`lib/bankLedger.js`), puts each movement through the distortions a
// real bank statement applies, and then adds the lines only the bank knows
// about. The matching engine never sees the derivation — it gets a bank line
// with a date, an amount and a description, exactly as a parsed statement would
// hand it over, and has to re-find the link from those alone.
//
// That ordering matters. The previous prototype wrote the answer next to each
// row (`klay: { ref: "BILL-2025-0142" }`), which meant the screen could show a
// reconciliation without one ever being computed. Deriving the statement and
// then throwing the link away is what makes the match real.
//
// The distortions are the product. Each one exists because it is the reason a
// real reconciliation has exceptions:
//
//   value-date lag   the bank posts a day or two after we book it
//   in transit       we booked it; the bank has not seen it yet
//   anonymous        the description carries no counterparty, only an amount
//   withholding      the debit is the invoice net of PPh, so it matches nothing
//   bank-only        fees, interest, an unregistered VA credit, a duplicate
//
// What a line carries is what a real statement carries, and nothing more:
//
//   date · amount (its sign is the direction) · description · running balance
//
// plus the opening and closing balance for the period. There is no
// counterparty field, no payment rail, no value date and no VA field — a bank
// prints none of those as data. Where the other party's name or a VA number
// appears at all, it is somewhere inside the description, and the matching
// engine has to read it out (lib/bankMatching.js, readCounterparty).
//
// Everything is deterministic: same seed, same statement, every reload.

import { COMPANY_BANK_ACCOUNTS, bankAccountById } from "./bankAccounts";
import { BILLS } from "./bills";
import { bookRecordsFor } from "../../lib/bankLedger";
import { addDays, nextBusinessDay, TODAY } from "../../lib/clock";

// ── Periods ──────────────────────────────────────────────────────────────────
//
// A statement belongs to a calendar month. The current month is the one the
// demo clock sits in, and its statement is already on file (cut off at each
// account's statementThrough). Earlier months can be uploaded at any time — a
// customer catching up on the months before they joined, a statement the bank
// sent late, a re-upload after a missing page. Later months cannot: there is
// nothing for the bank to have printed yet.

export const CURRENT_PERIOD = TODAY.toISOString().slice(0, 7);

export const monthEnd = (period) => {
  const [y, m] = period.split("-").map((n) => parseInt(n, 10));
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

export const shiftPeriod = (period, n) => {
  const [y, m] = period.split("-").map((x) => parseInt(x, 10));
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const periodLabel = (period) => `${MONTH_LABELS[parseInt(period.slice(5, 7), 10) - 1]} ${period.slice(0, 4)}`;

// "Apr 1–20, 2025" — the span a statement actually covers.
export function statementLabel(statement) {
  if (!statement?.from || !statement?.through) return "no statement yet";
  const { from, through } = statement;
  const head = `${MONTH_LABELS[parseInt(from.slice(5, 7), 10) - 1]} ${parseInt(from.slice(8, 10), 10)}`;
  const span = from === through ? head : `${head}–${parseInt(through.slice(8, 10), 10)}`;
  return `${span}, ${through.slice(0, 4)}`;
}

// ── Determinism ──────────────────────────────────────────────────────────────
// A string hash, so a record's fate is a function of its identity rather than
// its position. Inserting a bill upstream must not re-roll every other line.

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}


// ── How a statement line reads ───────────────────────────────────────────────
// BCA and its peers print a transaction type, a date stamp, a reference and —
// when the transfer carried one — the other party's name. The name is the field
// that goes missing most often, which is why `anonymous` is a distortion rather
// than an error.

const refFor = (rail, iso, n) => `${rail === "BI_FAST" ? "BF" : rail === "RTGS" ? "RT" : "SK"}${iso.replace(/-/g, "")}-${String(n).padStart(4, "0")}`;

const NAME_WIDTH = 24;

function describe({ amount, counterparty, rail, iso, seq }) {
  const dir = amount < 0 ? "DB" : "CR";
  const stamp = iso.slice(8, 10) + iso.slice(5, 7);
  const head = `TRSF E-BANKING ${dir} ${stamp} ${refFor(rail, iso, seq)}`;
  // Banks cut the name to fit a fixed-width column, which is why the engine
  // compares prefixes rather than whole names.
  return counterparty ? `${head} ${counterparty.toUpperCase().slice(0, NAME_WIDTH).trim()}` : head;
}

function railFor(record, roll) {
  if (record.method === "giro") return "SKNBI"; // a giro cheque clears through SKNBI, not instantly
  if (Math.abs(record.amount) >= 100000000) return "RTGS";
  if (roll < 0.18) return "SKNBI";
  return "BI_FAST";
}

// ── Fate of a book record ────────────────────────────────────────────────────
//
// Most movements land on the statement cleanly and on the day we booked them.
// The rest are distributed by hash so that every account gets some of each, and
// weighted so the exception list stays short — a statement where a third of the
// lines need attention is not a demo of exception management, it is a demo of
// a broken ledger.

// A closed month has had time to settle, so nothing booked in it is still in
// flight — except what was booked in its last days and posted early the next.
function pastFateOf(record, roll) {
  if (roll < 0.12) return "late";
  if (roll < 0.24) return "anonymous";
  return "clean";
}

function fateOf(record, roll) {
  // A giro is a post-dated cheque: the bill is relieved when it is handed over
  // and the bank line appears when it clears. It is in transit by definition.
  if (record.method === "giro") return "intransit";
  if (roll < 0.10) return "intransit";
  if (roll < 0.22) return "late";
  if (roll < 0.34) return "anonymous";
  return "clean";
}

// ── Lines only the bank knows about ──────────────────────────────────────────
//
// These are not in the ledger at all, and each one exercises a different branch
// of the matching engine. They are attached to specific accounts rather than
// scattered by hash, because a demo needs the unregistered VA credit to be on
// the account someone will actually open.

const BANK_ONLY = {
  "bca-op": [
    { day: 3,  amount:    -2500, description: "BIAYA TRANSFER BI-FAST" },
    { day: 9,  amount:    -6500, description: "BIAYA ADM E-BANKING" },
    { day: 14, amount:   -15000, description: "BIAYA TRANSFER RTGS" },
    { day: 17, amount:    -2500, description: "BIAYA TRANSFER BI-FAST" },
    { day: 11, amount:  1850000, description: "BUNGA GIRO" },
    { day: 16, amount: 47500000, description: "SWITCHING CR VA 3812000178432" },
    { day: 18, amount: -8250000, description: "TRSF E-BANKING DB 1804 BF20250418-9921" },
  ],
  "mandiri-op": [
    { day: 6,  amount:    -2500, description: "BIAYA TRANSFER BI-FAST" },
    { day: 13, amount:    -4000, description: "BIAYA ADM BULANAN" },
    { day: 15, amount:   890000, description: "BUNGA GIRO" },
  ],
  "bni-op": [
    { day: 8,  amount:    -2500, description: "BIAYA TRANSFER BI-FAST" },
  ],
};

// ── Paid outside Klay ────────────────────────────────────────────────────────
//
// The case the withholding priority exists for. Somebody paid this vendor from
// the bank and never recorded it, so there is no payment, no journal entry and
// nothing in the ledger to match. What reaches the statement is the invoice net
// of PPh 23 — an amount that equals no bill total anywhere in the system, which
// is precisely why every other reconciliation tool reports it as unexplained.

const PAID_OUTSIDE_KLAY = {
  "bca-op": [{ billId: "BILL006", day: 10, rail: "BI_FAST" }],
};

// Two retainers of Rp 12.5M in the same week, to two vendors. Printed cleanly,
// with the names, so the amount ties and the description has to break it: one
// name was confirmed last month and matches on its own, the other is read fresh
// and only suggested.
const ALWAYS_PRINTED = new Set(["JE-2025-0305:1-1300", "JE-2025-0306:1-1300"]);

// A payment that went out twice. The books hold one; the bank holds both.
const DUPLICATED = { "bca-op": ["BILL009:0"] };

// The current month runs to the account's cut-off; a past month is the whole
// month. An account with no statement feed at all has no window in any month.
function statementWindow(account, period) {
  if (!account.statementThrough) return { from: null, through: null };
  if (period === CURRENT_PERIOD) return { from: account.statementFrom, through: account.statementThrough };
  return { from: `${period}-01`, through: monthEnd(period) };
}

// Fees and interest recur every month; the one-off cases (the unregistered VA,
// the mystery debit, the payment made outside Klay, the duplicate) belong to
// the current statement, where the demo needs them.
const RECURRING = /^(BIAYA|BUNGA)/;

// ── Building one account's statement ─────────────────────────────────────────

export function statementFor(accountId, { extraPayments = null, period = CURRENT_PERIOD } = {}) {
  const account = bankAccountById(accountId);
  if (!account) return null;
  const current = period === CURRENT_PERIOD;
  const { from, through } = period > CURRENT_PERIOD ? { from: null, through: null } : statementWindow(account, period);
  if (!from || !through) {
    return { account, period, from: null, through: null, lines: [], outstanding: [], openingBalance: account.openingBalance, expectedOpening: account.openingBalance, closingBalance: account.openingBalance, loaded: false };
  }
  // Line ids carry the month so a decision on a March line can never land on an
  // April one. The current month keeps the short form.
  const idOf = (n) => (current ? `L${accountId}-${n}` : `L${accountId}-${period}-${n}`);

  // The ledger is read to the LAST day of the period, not to the statement
  // cut-off: a payment booked after the cut-off is exactly what "in transit"
  // means, and reading only as far as the statement would hide it.
  const books = bookRecordsFor(accountId, { from, to: current ? addDays(through, 14) : through, extraPayments });

  const lines = [];
  const outstanding = []; // booked, not on this statement — the other direction of exception
  let seq = 1;

  for (const record of books) {
    const roll = hash(record.id);
    // Only shapes the description text; the engine never sees it as a field.
    const rail = record.rail || railFor(record, hash(`${record.id}:rail`));
    const fate = record.date > through ? "intransit"
      : ALWAYS_PRINTED.has(record.id) ? "clean"
      : current ? fateOf(record, roll)
      : record.method === "giro" ? "clean" // presented within the month
      : pastFateOf(record, roll);

    if (fate === "intransit") {
      outstanding.push({ record });
      continue;
    }

    const date = fate === "late" ? nextBusinessDay(record.date) : record.date;
    if (date > through) { outstanding.push({ record }); continue; }

    lines.push({
      id: idOf(seq),
      accountId,
      date,
      amount: record.amount,
      description: describe({
        amount: record.amount,
        counterparty: fate === "anonymous" ? "" : record.counterparty,
        rail,
        iso: date,
        seq,
      }),
    });
    seq++;

    if (current && (DUPLICATED[accountId] || []).includes(record.id)) {
      const dupDate = nextBusinessDay(date) <= through ? nextBusinessDay(date) : date;
      lines.push({
        id: idOf(seq),
        accountId,
        date: dupDate,
        amount: record.amount,
        description: describe({ amount: record.amount, counterparty: record.counterparty, rail, iso: dupDate, seq }),
      });
      seq++;
    }
  }

  for (const spec of current ? PAID_OUTSIDE_KLAY[accountId] || [] : []) {
    const bill = BILLS.find((b) => b.id === spec.billId);
    if (!bill) continue;
    const date = addDays(from, spec.day);
    if (date > through) continue;
    lines.push({
      id: idOf(seq),
      accountId,
      date,
      amount: -(bill.total - (bill.pph23 || 0)),
      description: describe({ amount: -1, counterparty: bill.vendorName, rail: spec.rail, iso: date, seq }),
    });
    seq++;
  }

  for (const extra of (BANK_ONLY[accountId] || []).filter((x) => current || RECURRING.test(x.description))) {
    const date = addDays(from, extra.day);
    if (date > through) continue;
    lines.push({
      id: idOf(seq),
      accountId,
      date,
      amount: extra.amount,
      description: extra.description,
    });
    seq++;
  }

  lines.sort((a, b) => (a.date === b.date ? a.id.localeCompare(b.id) : a.date < b.date ? -1 : 1));

  // The closing balance is what the bank says it holds after these lines. The
  // opening-balance check on the next upload leans on this being arithmetic
  // rather than a number somebody typed.
  //
  // The current month opens at the balance on file. An earlier month is worked
  // backwards from the month after it, so its closing balance is exactly the
  // next month's opening — which is what makes the opening-balance check agree
  // when months are uploaded out of order.
  const net = lines.reduce((sum, l) => sum + l.amount, 0);
  const openingBalance = current
    ? account.openingBalance
    : statementFor(accountId, { period: shiftPeriod(period, 1) }).openingBalance - net;
  let running = openingBalance;
  for (const l of lines) { running += l.amount; l.balance = running; }
  const closingBalance = running;

  return { account, period, from, through, lines, outstanding, openingBalance, expectedOpening: openingBalance, closingBalance, loaded: true };
}

export const STATEMENT_ACCOUNT_IDS = COMPANY_BANK_ACCOUNTS.filter((a) => a.statementThrough).map((a) => a.id);

export function allStatements(opts) {
  return Object.fromEntries(COMPANY_BANK_ACCOUNTS.map((a) => [a.id, statementFor(a.id, opts)]));
}
