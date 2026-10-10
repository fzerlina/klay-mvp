// The matching engine.
//
// It takes two lists that describe the same events — the bank's (`bankStatement.js`)
// and Klay's (`bankLedger.js` for recorded payments and receipts, plus open
// invoices and bills) — and works out which line is which record.
//
// Nothing is matched automatically. For every statement line the engine either
// SUGGESTS what it is, or says it found nothing. A person reconciles each line:
// confirms the suggestion, reconciles it by hand, or parks it. That keeps the
// engine honest about what it is — a guess built from amounts — and keeps the
// decision with somebody who can be asked about it.
//
// Matching rests on the amount. The description is only read to break a tie
// between records of the same amount, never to find a candidate on its own.
//
//   Money out (AP)
//     1  a recorded payment of exactly this amount. The payment module stores
//        the cash that left the bank, with any PPh withheld booked separately,
//        so there is no tolerance: the amounts agree or it is not the payment
//     2  an open bill whose total less its PPh 23 is exactly this amount — paid
//        from the bank app and never recorded in Klay. Suggests recording it
//     3  a small debit the bank describes as a fee — a drafted journal to post
//
//   Money in (AR)
//     1  a recorded receipt of exactly this amount
//     2  an open invoice whose subtotal is exactly this amount
//     3  interest the bank describes as interest — a drafted journal to post
//     4  an open invoice whose subtotal is within 3% of this amount, either
//        way. Customers withhold 2% PPh 23 and round; the difference is said
//        in rupiah and percent, never hidden
//
// A bill or invoice counts as paid in full when what arrived falls short of it
// by no more than the 2% PPh 23 withholding.
//
// No score reaches the caller. A suggestion is a sentence built from the
// record's own numbers — "Rp 880.000 (2%) under INV005's subtotal, the PPh 23
// the customer withholds" — rather than a percentage of confidence, because
// 0.87 tells a Finance Manager nothing they can act on.

import { BILLS } from "../data/seed/bills";
import { INVOICES } from "../data/seed/invoices";
import { VENDORS } from "../data/seed/vendors";
import { CUSTOMERS } from "../data/seed/customers";
import { KNOWN_NAMES } from "../data/seed/bankKnownNames";
import { railOf } from "./paymentRails";
import { formatRupiahExact } from "./format";
import { DEFAULT_FEE_CEILING, feeCeilingFor } from "../data/seed/bankFees";
import { dayDiff, addBusinessDays } from "./clock";

// ── Configuration ────────────────────────────────────────────────────────────
//
// The fee ceiling is OQ-01 in the Bank Reconciliation PRD. The doc's
// requirements say Rp 50,000 and its own open question argues that down to
// Rp 15,000, on the grounds that Indonesian bank fees top out around Rp 25,000
// for RTGS and a Rp 50,000 net would start swallowing real payments.

// Now per bank (data/seed/bankFees.js); this stays the fallback.
export const FEE_CEILING = DEFAULT_FEE_CEILING;

// How far a customer receipt may sit from an invoice's subtotal, either way,
// and still be suggested for it.
export const AR_TOLERANCE = 0.03;

// PPh 23 withheld by the payer. Paying the total less this much settles the
// bill or invoice in full.
export const WITHHOLDING_RATE = 0.02;

const FEE_PATTERNS = /(biaya|admin|adm\b|fee|charge|provisi)/i;
const INTEREST_PATTERNS = /(bunga|interest)/i;
// Read before the fee and interest rules: "PAJAK BUNGA" names interest, but it
// is the tax on it, and it leaves the account.
const INTEREST_TAX_PATTERNS = /(pajak\s*bunga|pph\s*(final\s*)?bunga|tax\s*on\s*interest)/i;

// How far apart the bank date and our booking date may be for a recorded
// payment or receipt to be the same event.
const MATCH_WINDOW_DAYS = 12;

const rp = (n) => formatRupiahExact(Math.abs(n));
const pct = (x) => `${Number((Math.abs(x) * 100).toFixed(1))}%`;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const d = (iso) => {
  if (!iso) return "—";
  const [y, m, day] = iso.split("-");
  return `${parseInt(day, 10)} ${MONTHS[parseInt(m, 10) - 1]} ${y}`;
};

// True when `received` settles `due` in full: short by no more than the 2%
// withholding. Anything above it (an overpayment) settles it too.
export const paysInFull = (received, due) => received >= Math.round(due * (1 - WITHHOLDING_RATE));

// Loose name comparison. Bank statements truncate, upper-case and drop the
// legal form, so "PT PENYEDIA LAYANAN KON" has to be able to reach
// "PT Penyedia Layanan Konsultasi". Comparing normalised prefixes handles that
// without the false positives a general fuzzy distance would invite.
function nameAgrees(a, b) {
  if (!a || !b) return false;
  const norm = (s) => s.toUpperCase().replace(/[^A-Z0-9 ]/g, "").replace(/\s+/g, " ").trim();
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  return x.startsWith(y) || y.startsWith(x);
}

// ── Reading the other party out of the description ───────────────────────────
//
// The statement has no counterparty field. On a transfer line the name, when
// the bank printed one at all, is the free text after the reference token.
// Getting from that text to a vendor or customer is the step the engineering
// plan hands to an LLM; here it is stood in for by names confirmed on earlier
// reconciliations and by the vendor and customer master. It only ever breaks
// a tie between records of the same amount.
//
// The pattern below is BCA's e-banking format.

const TRANSFER_NAME = /^TRSF E-BANKING (?:DB|CR) \d{4} \S+ (.+)$/;
const PARTIES = [...VENDORS.map((v) => v.name), ...CUSTOMERS.map((c) => c.name)].filter(Boolean);

export function readCounterparty(description = "") {
  const raw = (TRANSFER_NAME.exec(description.trim()) || [])[1]?.trim() || "";
  if (!raw) return { raw: "", name: "", via: null };
  const known = KNOWN_NAMES[raw.toUpperCase()];
  if (known) return { raw, name: known, via: "known" };
  const hits = PARTIES.filter((p) => nameAgrees(raw, p));
  if (hits.length === 1) return { raw, name: hits[0], via: "read" };
  return { raw, name: "", via: null };
}

const VA_IN_DESCRIPTION = /\bVA\s*(\d{8,})\b/i;

// ── Exception vocabulary ─────────────────────────────────────────────────────
//
// Every statement line becomes one of these until a person reconciles it.
// Blocking ones need investigating; the rest need a yes.

export const EXCEPTION_TYPES = {
  ANOMALY:           { key: "ANOMALY",           label: "Anomaly",            rank: 1, blocking: true,  tone: "danger" },
  GENUINE_MISMATCH:  { key: "GENUINE_MISMATCH",  label: "Genuine mismatch",   rank: 2, blocking: true,  tone: "danger" },
  UNCLASSIFIED:      { key: "UNCLASSIFIED",      label: "Unclassified",       rank: 3, blocking: true,  tone: "warn"   },
  SUGGESTED:         { key: "SUGGESTED",         label: "Suggested",          rank: 4, blocking: false, tone: "info"   },
  KNOWN_SYSTEMATIC:  { key: "KNOWN_SYSTEMATIC",  label: "Bank interest",      rank: 5, blocking: false, tone: "info"   },
  BANK_FEE:          { key: "BANK_FEE",          label: "Bank fee",           rank: 5, blocking: false, tone: "info"   },
  TIMING_DIFFERENCE: { key: "TIMING_DIFFERENCE", label: "Timing difference",  rank: 6, blocking: false, tone: "muted"  },
};

// ── Candidates ───────────────────────────────────────────────────────────────

// An invoice a receipt can be for: sent to the customer, not yet paid, and
// dated no later than the money arrived.
const openInvoices = () => INVOICES.filter((i) => i.approval === "sent" && i.payStatus !== "paid" && (i.dpp || i.total) > 0);
const subtotalOf = (inv) => inv.dpp || inv.total;

// Records of exactly this amount, best first: the party named in the bank text,
// then the nearest date.
function recordCandidates(line, pool, read) {
  return pool
    .filter((r) => !r._taken && r.amount === line.amount && Math.abs(dayDiff(line.date, r.date)) <= MATCH_WINDOW_DAYS)
    .map((r) => ({ r, named: !!read.name && nameAgrees(read.name, r.counterparty), gap: Math.abs(dayDiff(line.date, r.date)) }))
    .sort((a, b) => Number(b.named) - Number(a.named) || a.gap - b.gap)
    .map((x) => x.r);
}

// Open invoices a receipt could settle, best first: the customer named in the
// bank text, then the smallest difference from the subtotal.
function invoiceCandidates(line, invoices, read, { exact }) {
  return invoices
    .filter((i) => !i._taken && i.date <= line.date)
    .map((i) => {
      const sub = subtotalOf(i);
      const diff = line.amount - sub;
      return { i, sub, diff, ratio: diff / sub, named: !!read.name && nameAgrees(read.name, i.customerName) };
    })
    .filter((x) => (exact ? x.diff === 0 : Math.abs(x.ratio) <= AR_TOLERANCE))
    .sort((a, b) => Number(b.named) - Number(a.named) || Math.abs(a.diff) - Math.abs(b.diff));
}

// ── How strong a suggestion is ───────────────────────────────────────────────
//
// Three tiers, named for what backs them rather than scored, so a person can
// see why a suggestion sits where it does:
//
//   strong   the amount is exact and nothing else fits — the only record of
//            that amount, or the name in the description settles a tie. Also
//            bank fees and interest, which the bank labels as such
//   likely   one fact is missing: an exact amount shared by several records
//            with no name to pick between them, an invoice within range whose
//            customer the description names, or a bill less its PPh 23
//   weak     an invoice within range and nothing else — no name, or several
//            invoices close enough to be it
//
// It changes where a line is grouped, never whether it needs a yes.

export const STRENGTHS = {
  strong: { key: "strong", label: "Strong match", rank: 1 },
  likely: { key: "likely", label: "Likely match", rank: 2 },
  weak:   { key: "weak",   label: "Weak match",   rank: 3 },
};

const others = (n) => (n > 0 ? ` ${n} other ${n === 1 ? "record has" : "records have"} the same amount — reconcile manually if it's one of those.` : "");

// ── Suggestions ──────────────────────────────────────────────────────────────

function suggestRecord(line, record, alternates, read) {
  const named = !!read.name && nameAgrees(read.name, record.counterparty);
  const strength = alternates === 0 || named ? "strong" : "likely";
  const basis = alternates === 0
    ? "Exact amount · the only record with it"
    : named
      ? `Exact amount · ${alternates + 1} records share it, the name in the description picks this one`
      : `Exact amount · ${alternates + 1} records share it, nearest date picked`;
  const where = record.kind === "ap_payment" ? `the payment on ${record.billId}` : record.ref;
  const lag = dayDiff(line.date, record.date);
  const lagText = lag === 0 ? "" : ` The bank posted it ${lag === 1 ? "a day" : `${Math.abs(lag)} days`} ${lag > 0 ? "after" : "before"} it was booked.`;
  const party = record.counterparty ? ` ${line.amount < 0 ? "to" : "from"} ${record.counterparty}` : "";
  const pph = record.withheld > 0
    ? ` PPh 23 of ${rp(record.withheld)} was withheld and recorded separately, so the bank shows the cash that was sent.`
    : "";
  record._taken = true;
  return {
    type: EXCEPTION_TYPES.SUGGESTED.key,
    detector: "EXACT_AMOUNT",
    brief: `${record.ref}${record.billId && record.billId !== record.ref ? ` · ${record.billId}` : ""} — ${record.counterparty || record.label}. Same amount, ${d(record.date)}.`,
    title: `${record.ref} — ${rp(line.amount)}`,
    explanation: `${rp(line.amount)}${party} is the same amount as ${where}, booked ${d(record.date)}.${pph}${lagText}${others(alternates)}`,
    counterparty: record.counterparty || "",
    strength,
    basis,
    suggestion: { kind: "record", recordId: record.id, ref: record.ref, billId: record.billId || null, basis: "exact", party: record.counterparty || "", label: record.label || "" },
    actions: ["reconcile", "manual-match", "exclude"],
  };
}

function suggestInvoice(line, hit, alternates) {
  const { i: inv, sub, diff, ratio, named } = hit;
  inv._taken = true;
  const ref = inv.invNo && inv.invNo !== "—" ? inv.invNo : inv.id;
  const full = paysInFull(line.amount, sub);
  const exact = diff === 0;
  const strength = exact
    ? (alternates === 0 || named ? "strong" : "likely")
    : named ? "likely" : "weak";
  const basis = exact
    ? alternates === 0 ? "Exact subtotal · the only open invoice with it" : named ? "Exact subtotal · customer named in the description" : `Exact subtotal · ${alternates + 1} open invoices share it`
    : named
      ? `Within ${pct(AR_TOLERANCE)} of the subtotal · customer named in the description`
      : `Within ${pct(AR_TOLERANCE)} of the subtotal · no name to confirm the customer${alternates ? `, ${alternates + 1} invoices in range` : ""}`;

  let gap = "";
  if (!exact) {
    const dir = diff < 0 ? "under" : "over";
    const withholding = diff < 0 && full ? `, within the ${pct(WITHHOLDING_RATE)} PPh 23 ${inv.customerName} withholds` : "";
    gap = `${rp(diff)} (${pct(ratio)}) ${dir} the subtotal${withholding}. `;
  }
  const outcome = full
    ? `Reconciling it marks ${inv.id} paid in full.`
    : `That is more than the ${pct(WITHHOLDING_RATE)} withholding, so reconciling it leaves ${rp(sub - line.amount)} open on ${inv.id}.`;

  return {
    type: EXCEPTION_TYPES.SUGGESTED.key,
    detector: exact ? "INVOICE_EXACT" : "INVOICE_RANGE",
    brief: exact
      ? `${inv.id} (${inv.customerName}). Same as the subtotal.`
      : `${inv.id} (${inv.customerName}). ${pct(ratio)} ${diff < 0 ? "under" : "over"} the ${rp(sub)} subtotal.`,
    title: `${inv.id} — ${rp(line.amount)}`,
    explanation:
      `${rp(line.amount)} arrived on ${d(line.date)}. ${inv.id} to ${inv.customerName} (${ref}, ${d(inv.date)}) has a subtotal of ${rp(sub)}` +
      `${exact ? " — the same amount. " : `. ${gap}`}${outcome}${others(alternates)}`,
    counterparty: inv.customerName,
    strength,
    basis,
    suggestion: {
      kind: "invoice", invoiceId: inv.id, ref: inv.id, basis: exact ? "exact" : "range",
      subtotal: sub, diff, paysInFull: full, customerName: inv.customerName,
    },
    actions: ["reconcile", "manual-match", "exclude"],
  };
}

// A debit that matches no recorded payment, but equals an open bill less its
// PPh 23 — somebody paid this vendor from the bank app and never recorded it.
// The suggestion is to record the payment; the line reconciles once it exists.
function suggestUnrecordedPayment(line, read) {
  if (line.amount >= 0) return null;
  const target = Math.abs(line.amount);
  const hits = BILLS.filter((b) => (b.pph23 || 0) > 0 && b.sisa > 0 && b.total - b.pph23 === target);
  if (!hits.length) return null;
  const named = hits.filter((b) => nameAgrees(read.name, b.vendorName));
  const bill = named.length === 1 ? named[0] : hits.length === 1 ? hits[0] : null;
  if (!bill) return null;

  const rate = pct(bill.pph23 / bill.total);
  return {
    type: EXCEPTION_TYPES.GENUINE_MISMATCH.key,
    detector: "PPH_WITHHOLDING",
    brief: `${bill.id} (${bill.vendorName}) less ${rate} PPh 23. Paid, but not recorded in Klay.`,
    title: `${bill.id} was paid but never recorded`,
    explanation:
      `${rp(line.amount)} left the bank on ${d(line.date)} and matches no payment recorded in Klay. ` +
      `It is ${rp(bill.total)} on ${bill.id} less ${rp(bill.pph23)} PPh 23 (${rate}) — the bill paid in full, so ${bill.vendorName} was likely paid ` +
      `from the bank app. Record the payment against ${bill.id}, then reconcile this line to it.`,
    billId: bill.id,
    vendorName: bill.vendorName,
    strength: "likely",
    basis: named.length === 1 ? "Bill total less its PPh 23 · vendor named in the description" : "Bill total less its PPh 23 · the only open bill it fits",
    counterparty: bill.vendorName,
    actions: ["record-payment", "manual-match", "exclude"],
  };
}

// The master stores Mandiri as "MDR" for its card logo.
const BANK_DISPLAY = { MDR: "Mandiri", PERMATA: "Permata" };

function suggestBankFee(line, account) {
  const ceiling = feeCeilingFor(account);
  if (line.amount >= 0 || Math.abs(line.amount) > ceiling) return null;
  if (!FEE_PATTERNS.test(line.description)) return null;
  return {
    type: EXCEPTION_TYPES.BANK_FEE.key,
    detector: "FEE_PATTERN",
    strength: "strong",
    basis: `The bank describes it as a fee · within ${BANK_DISPLAY[account?.bank] || account?.bank || "the bank"}'s ${rp(ceiling)} fee ceiling`,
    title: `Bank fee — ${rp(line.amount)}`,
    explanation:
      `${rp(line.amount)} on ${d(line.date)}, described by the bank as "${line.description}". Nothing in Klay raises a bill for it, ` +
      `so Klay drafted the journal. Post it as it is, or edit it first.`,
    actions: ["post-journal", "edit-journal", "manual-match", "exclude"],
  };
}

// The final tax the bank withholds on interest, printed as its own debit.
function suggestInterestTax(line) {
  if (line.amount >= 0 || !INTEREST_TAX_PATTERNS.test(line.description)) return null;
  return {
    type: EXCEPTION_TYPES.BANK_FEE.key,
    detector: "INTEREST_TAX",
    strength: "strong",
    basis: "The bank describes it as tax on interest",
    title: `Tax on interest — ${rp(line.amount)}`,
    explanation:
      `${rp(line.amount)} on ${d(line.date)}, described by the bank as "${line.description}". The final tax (PPh Final) the bank ` +
      `withholds on interest — 20% on giro interest. Nothing in Klay raises it, so Klay drafted the journal. Post it as it is, or edit it first.`,
    actions: ["post-journal", "edit-journal", "exclude"],
  };
}

function suggestBankInterest(line) {
  if (line.amount <= 0 || !INTEREST_PATTERNS.test(line.description)) return null;
  return {
    type: EXCEPTION_TYPES.KNOWN_SYSTEMATIC.key,
    detector: "INTEREST_CREDIT",
    strength: "strong",
    basis: "The bank describes it as interest",
    title: `Bank interest — ${rp(line.amount)}`,
    explanation:
      `${rp(line.amount)} credited on ${d(line.date)}, described by the bank as "${line.description}". Interest the bank paid; nothing in ` +
      `Klay raises an invoice for it, so Klay drafted the journal. Post it as it is, or edit it first.`,
    actions: ["post-journal", "edit-journal", "manual-match", "exclude"],
  };
}

// The registry is deferred, so a VA credit that matched no invoice by amount
// cannot yet be resolved to a customer. Say exactly why.
function unregisteredVa(line) {
  if (line.amount <= 0) return null;
  const vaNumber = (VA_IN_DESCRIPTION.exec(line.description || "") || [])[1];
  if (!vaNumber) return null;
  return {
    type: EXCEPTION_TYPES.GENUINE_MISMATCH.key,
    detector: "VA_UNREGISTERED",
    title: `Virtual Account credit — VA ${vaNumber} is not in the registry`,
    explanation:
      `${rp(line.amount)} arrived on ${d(line.date)} tagged with Virtual Account ${vaNumber} and no customer name. No open invoice is within ` +
      `${pct(AR_TOLERANCE)} of this amount, and the VA number is not mapped to a customer, so there is nothing to suggest.`,
    vaNumber,
    actions: ["manual-match", "exclude"],
  };
}

// ── The run ──────────────────────────────────────────────────────────────────

export function reconcile({ statement, books = [] }) {
  if (!statement || !statement.loaded) {
    return { lines: [], exceptions: [], outstanding: [], counts: emptyCounts(), balanceCheck: null };
  }

  // Private copies: `_taken` marks a record as suggested so two bank lines are
  // never pointed at the same one — which is what makes a duplicate visible.
  const pool = books.filter((r) => r.accountId === statement.account.id).map((r) => ({ ...r, _taken: false }));
  const invoices = openInvoices().map((i) => ({ ...i, _taken: false }));
  // Amounts already suggested for an earlier line, for spotting a second copy.
  const suggestedAmounts = new Map();

  const exceptions = [];
  const rows = [];

  for (const line of statement.lines) {
    const read = readCounterparty(line.description);
    let spec = null;

    // Descriptions that say fee or interest are taken at their word before any
    // amount is compared: a Rp 1.85M interest credit is not a customer paying
    // an invoice that happens to be close to it.
    spec = suggestInterestTax(line) || suggestBankFee(line, statement.account) || suggestBankInterest(line);

    if (!spec) {
      const records = recordCandidates(line, pool, read);
      if (records.length) spec = suggestRecord(line, records[0], records.length - 1, read);
    }

    if (!spec && line.amount > 0) {
      const exact = invoiceCandidates(line, invoices, read, { exact: true });
      const hits = exact.length ? exact : invoiceCandidates(line, invoices, read, { exact: false });
      if (hits.length) spec = suggestInvoice(line, hits[0], hits.length - 1);
    }

    if (!spec) spec = suggestUnrecordedPayment(line, read);

    // Nothing left for this amount, but an earlier line was pointed at a
    // record of exactly this amount: this is a second copy of that line.
    if (!spec && suggestedAmounts.has(line.amount)) {
      const first = suggestedAmounts.get(line.amount);
      spec = {
        type: EXCEPTION_TYPES.ANOMALY.key,
        detector: "DUPLICATE_PAYMENT",
        title: `Possible duplicate — ${rp(line.amount)}`,
        brief: `Same amount as the ${d(first.date)} line, and Klay holds only one record of it.`,
        counterparty: read.name,
        explanation:
          `${rp(line.amount)} ${line.amount < 0 ? "left" : "arrived in"} the account on ${d(line.date)}, the same amount as the line on ${d(first.date)}` +
          `${read.name ? ` (both read as ${read.name})` : ""}, and Klay holds one record of that amount. Either it was sent twice or one of ` +
          `them belongs to something not yet entered. Verify before reconciling.`,
        actions: ["manual-match", "exclude"],
      };
    }

    if (!spec) spec = unregisteredVa(line);

    if (!spec) {
      spec = {
        type: EXCEPTION_TYPES.UNCLASSIFIED.key,
        detector: "NO_CANDIDATE",
        title: `Unexplained ${line.amount < 0 ? "debit" : "credit"} — ${rp(line.amount)}`,
        explanation:
          `${rp(line.amount)} ${line.amount < 0 ? "left" : "arrived in"} the account on ${d(line.date)}. ` +
          (line.amount < 0
            ? `No payment recorded in Klay has this amount within ${MATCH_WINDOW_DAYS} days`
            : `No receipt recorded in Klay has this amount, and no open invoice is within ${pct(AR_TOLERANCE)} of it`) +
          (read.raw
            ? read.name ? `, though the description names ${read.name}. ` : `, and "${read.raw}" isn't a vendor or customer Klay knows. `
            : `, and the description carries no name. `) +
          `Reconcile it manually if it covers several records.`,
        counterparty: read.name,
        actions: ["manual-match", "exclude"],
      };
    }

    if (spec.type === "SUGGESTED" && !suggestedAmounts.has(line.amount)) suggestedAmounts.set(line.amount, line);
    const ex = buildException(line, spec);
    exceptions.push(ex);
    rows.push({ line, exception: ex });
  }

  // ── The other direction ────────────────────────────────────────────────────
  //
  // Everything the books hold that no bank line was pointed at. Kept off the
  // exception list on purpose — reconciliation works through the STATEMENT,
  // line by line — but still classified by the rail the payment went out on,
  // so a payment row can say In transit or Unmatched, and so Reconcile
  // manually has these to offer.
  const outstandingBy = new Map();
  for (const entry of statement.outstanding) outstandingBy.set(entry.record.id, entry);
  for (const r of pool) {
    if (r._taken || outstandingBy.has(r.id)) continue;
    outstandingBy.set(r.id, { record: r });
  }

  const outstanding = [];
  for (const entry of outstandingBy.values()) {
    const record = entry.record;
    const rail = railOf(record.rail);
    const expected = addBusinessDays(record.date, rail.clearsInDays);
    // A giro reaches the statement when the holder presents it, a date nobody
    // in Klay holds, so it is in transit until the bank says otherwise.
    const isGiro = record.method === "giro";
    const overdue = !isGiro && expected <= statement.through;
    const why = overdue
      ? `Booked ${d(record.date)}${record.counterparty ? ` to ${record.counterparty}` : ""}. It should have been on a statement by ${d(expected)}, and this one runs to ${d(statement.through)}.`
      : isGiro
        ? `Giro handed over ${d(record.date)}. It reaches the statement when it is presented.`
        : `Booked ${d(record.date)}. Expected on the ${d(expected)} statement.`;
    outstanding.push({ record, rail: rail.key, expected, overdue, why });
  }

  const balanceCheck = checkOpeningBalance(statement);
  return { lines: rows, exceptions, outstanding, counts: countOf(rows, exceptions), balanceCheck };
}

function buildException(line, spec) {
  return {
    id: `E-${line.id}`,
    lineId: line.id,
    accountId: line.accountId,
    date: line.date,
    amount: line.amount,
    counterparty: line.counterparty || "",
    description: line.description,
    resolution: null, // { action, at, by, note, jeNumber, recordIds, invoiceIds }
    suggestion: null,
    ...spec,
  };
}

// The PRD's one real safety net on an uploaded statement: this statement's
// opening balance must be the previous one's closing balance. It catches a page
// missed in a PDF, which no amount of per-line matching would reveal.
function checkOpeningBalance(statement) {
  const expected = statement.expectedOpening ?? statement.account.openingBalance;
  const actual = statement.openingBalance;
  const delta = actual - expected;
  return {
    ok: delta === 0,
    expected,
    actual,
    delta,
    message:
      delta === 0
        ? `Opening balance agrees with the previous statement's closing balance.`
        : `Statement opens at ${rp(actual)} but the last reconciled statement closed at ${rp(expected)} — a gap of ${rp(delta)}. A missing page would look exactly like this. Check before relying on the result.`,
  };
}

function emptyCounts() {
  return { total: 0, reconciled: 0, suggested: 0, anomaly: 0, genuine: 0, unclassified: 0, systematic: 0, fee: 0, blocking: 0, open: 0 };
}

// "Mark for later" parks an item without deciding it. It is recorded like any
// other decision, but it is still open: parking must never be a way to get a
// month marked reconciled.
// A line is open until it is matched (and any journal the match drafted is
// posted) or excluded. A match waiting on its journal still holds the account
// open — it is matched, not yet reconciled.
export const isOpen = (e) => !e.resolution || !!e.resolution.pendingJournal;

// Counts over a run's exceptions, with or without this session's decisions
// laid over them.
export function countOf(rows, exceptions) {
  const live = exceptions.filter(isOpen);
  const by = (t) => live.filter((e) => e.type === t).length;
  return {
    total: rows.length,
    reconciled: exceptions.filter((e) => !isOpen(e)).length,
    suggested: by("SUGGESTED"),
    anomaly: by("ANOMALY"),
    genuine: by("GENUINE_MISMATCH"),
    unclassified: by("UNCLASSIFIED"),
    systematic: by("KNOWN_SYSTEMATIC"),
    fee: by("BANK_FEE"),
    blocking: live.filter((e) => EXCEPTION_TYPES[e.type]?.blocking).length,
    open: live.length,
  };
}

export { nameAgrees, openInvoices, subtotalOf };
