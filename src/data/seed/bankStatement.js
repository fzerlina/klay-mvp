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
// Everything is deterministic: same seed, same statement, every reload.

import { COMPANY_BANK_ACCOUNTS, bankAccountById } from "./bankAccounts";
import { BILLS } from "./bills";
import { bookRecordsFor } from "../../lib/bankLedger";
import { addDays, nextBusinessDay } from "../../lib/clock";

// ── Payment rails ────────────────────────────────────────────────────────────
//
// The rail is not decoration: it is what turns "this hasn't cleared" into
// "this clears tomorrow". Clearance windows are the published ones — BI-FAST is
// near-instant, RTGS settles inside the same operating window, SKNBI is next
// business day. `lib/bankMatching.js` reads these to decide whether an unseen
// payment is a timing difference or a problem.

export const RAILS = {
  BI_FAST: { key: "BI_FAST", label: "BI-FAST", clearsInDays: 0, note: "clears within hours" },
  RTGS:    { key: "RTGS",    label: "BI-RTGS", clearsInDays: 0, note: "clears inside the same operating window (07:00–17:00 WIB)" },
  SKNBI:   { key: "SKNBI",   label: "SKNBI",   clearsInDays: 1, note: "settles the next business day" },
  ATBK:    { key: "ATBK",    label: "ATM Bersama", clearsInDays: 1, note: "clears same day to next day" },
  VA:      { key: "VA",      label: "Virtual Account", clearsInDays: 0, note: "credited on receipt" },
  UNKNOWN: { key: "UNKNOWN", label: "Unknown rail", clearsInDays: 2, note: "rail not identified from the description" },
};

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

function describe({ amount, counterparty, rail, iso, seq }) {
  const dir = amount < 0 ? "DB" : "CR";
  const stamp = iso.slice(8, 10) + iso.slice(5, 7);
  const head = `TRSF E-BANKING ${dir} ${stamp} ${refFor(rail, iso, seq)}`;
  return counterparty ? `${head} ${counterparty.toUpperCase()}` : head;
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
    { day: 3,  amount:    -2500, rail: "BI_FAST", description: "BIAYA TRANSFER BI-FAST" },
    { day: 9,  amount:    -6500, rail: "BI_FAST", description: "BIAYA ADM E-BANKING" },
    { day: 14, amount:   -15000, rail: "RTGS",    description: "BIAYA TRANSFER RTGS" },
    { day: 17, amount:    -2500, rail: "BI_FAST", description: "BIAYA TRANSFER BI-FAST" },
    { day: 11, amount:  1850000, rail: "UNKNOWN", description: "BUNGA GIRO" },
    { day: 16, amount: 47500000, rail: "VA",      description: "SWITCHING CR VA 3812000178432", vaNumber: "3812000178432" },
    { day: 18, amount: -8250000, rail: "BI_FAST", description: "TRSF E-BANKING DB 1804 BF20250418-9921" },
  ],
  "mandiri-op": [
    { day: 6,  amount:    -2500, rail: "BI_FAST", description: "BIAYA TRANSFER BI-FAST" },
    { day: 13, amount:    -4000, rail: "BI_FAST", description: "BIAYA ADM BULANAN" },
    { day: 15, amount:   890000, rail: "UNKNOWN", description: "BUNGA GIRO" },
  ],
  "bni-op": [
    { day: 8,  amount:    -2500, rail: "BI_FAST", description: "BIAYA TRANSFER BI-FAST" },
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

// A payment that went out twice. The books hold one; the bank holds both.
const DUPLICATED = { "bca-op": ["BILL009:0"] };

function statementWindow(account) {
  return { from: account.statementFrom, through: account.statementThrough };
}

// ── Building one account's statement ─────────────────────────────────────────

export function statementFor(accountId, { extraPayments = null } = {}) {
  const account = bankAccountById(accountId);
  if (!account) return null;
  const { from, through } = statementWindow(account);
  if (!from || !through) {
    return { account, from: null, through: null, lines: [], outstanding: [], openingBalance: account.openingBalance, closingBalance: account.openingBalance, loaded: false };
  }

  // The ledger is read to the LAST day of the period, not to the statement
  // cut-off: a payment booked after the cut-off is exactly what "in transit"
  // means, and reading only as far as the statement would hide it.
  const books = bookRecordsFor(accountId, { from, to: addDays(through, 14), extraPayments });

  const lines = [];
  const outstanding = []; // booked, not on this statement — the other direction of exception
  let seq = 1;

  for (const record of books) {
    const roll = hash(record.id);
    const rail = railFor(record, hash(`${record.id}:rail`));
    const fate = record.date > through ? "intransit" : fateOf(record, roll);

    if (fate === "intransit") {
      outstanding.push({ record, rail });
      continue;
    }

    const date = fate === "late" ? nextBusinessDay(record.date) : record.date;
    if (date > through) { outstanding.push({ record, rail }); continue; }

    lines.push({
      id: `L${accountId}-${seq}`,
      accountId,
      date,
      valueDate: record.date,
      amount: record.amount,
      rail,
      vaNumber: null,
      counterparty: fate === "anonymous" ? "" : record.counterparty,
      reference: refFor(rail, date, seq),
      description: describe({
        amount: record.amount,
        counterparty: fate === "anonymous" ? "" : record.counterparty,
        rail,
        iso: date,
        seq,
      }),
    });
    seq++;

    if ((DUPLICATED[accountId] || []).includes(record.id)) {
      const dupDate = nextBusinessDay(date) <= through ? nextBusinessDay(date) : date;
      lines.push({
        id: `L${accountId}-${seq}`,
        accountId,
        date: dupDate,
        valueDate: dupDate,
        amount: record.amount,
        rail,
        vaNumber: null,
        counterparty: record.counterparty,
        reference: refFor(rail, dupDate, seq),
        description: describe({ amount: record.amount, counterparty: record.counterparty, rail, iso: dupDate, seq }),
      });
      seq++;
    }
  }

  for (const spec of PAID_OUTSIDE_KLAY[accountId] || []) {
    const bill = BILLS.find((b) => b.id === spec.billId);
    if (!bill) continue;
    const date = addDays(from, spec.day);
    if (date > through) continue;
    lines.push({
      id: `L${accountId}-${seq}`,
      accountId,
      date,
      valueDate: date,
      amount: -(bill.total - (bill.pph23 || 0)),
      rail: spec.rail,
      vaNumber: null,
      counterparty: bill.vendorName,
      reference: refFor(spec.rail, date, seq),
      description: describe({ amount: -1, counterparty: bill.vendorName, rail: spec.rail, iso: date, seq }),
    });
    seq++;
  }

  for (const extra of BANK_ONLY[accountId] || []) {
    const date = addDays(from, extra.day);
    if (date > through) continue;
    lines.push({
      id: `L${accountId}-${seq}`,
      accountId,
      date,
      valueDate: date,
      amount: extra.amount,
      rail: extra.rail,
      vaNumber: extra.vaNumber || null,
      counterparty: "",
      reference: extra.vaNumber || refFor(extra.rail, date, seq),
      description: extra.description,
    });
    seq++;
  }

  lines.sort((a, b) => (a.date === b.date ? a.id.localeCompare(b.id) : a.date < b.date ? -1 : 1));

  // The closing balance is what the bank says it holds after these lines. The
  // opening-balance check on the next upload leans on this being arithmetic
  // rather than a number somebody typed.
  const openingBalance = account.openingBalance;
  const closingBalance = lines.reduce((sum, l) => sum + l.amount, openingBalance);

  return { account, from, through, lines, outstanding, openingBalance, closingBalance, loaded: true };
}

export const STATEMENT_ACCOUNT_IDS = COMPANY_BANK_ACCOUNTS.filter((a) => a.statementThrough).map((a) => a.id);

export function allStatements(opts) {
  return Object.fromEntries(COMPANY_BANK_ACCOUNTS.map((a) => [a.id, statementFor(a.id, opts)]));
}
