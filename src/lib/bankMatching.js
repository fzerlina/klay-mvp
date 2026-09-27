// The matching engine.
//
// It takes two lists that describe the same events — the bank's (`bankStatement.js`)
// and the ledger's (`bankLedger.js`) — and works out which line is which record.
// Priorities are tried in order and the first one that fires wins the line, so
// a cheap certain answer is never displaced by an expensive probable one.
//
//   1  EXACT_AMOUNT         amount, direction and date agree, and exactly one
//                           ledger entry could be it. A recorded payment stores
//                           the cash that actually left the bank, with any PPh
//                           withheld booked separately, so its amount is the
//                           statement amount — no formula needed.
//      (tie)                two or more entries share the amount. A name the
//                           user has confirmed before settles it; a name read
//                           fresh from the description only SUGGESTS one, and a
//                           person confirms it
//   2  PPH_WITHHOLDING      fallback: the debit equals no recorded payment, but
//                           it equals an open bill net of its PPh — paid outside
//                           Klay. An exception, never a match
//   3  VA_REGISTRY          a credit whose description carries a VA number
//   4  PAYMENT_RAIL_TIMING  booked but not yet on the statement, and the rail
//                           WE recorded on the payment says it has not had time
//                           to clear
//   5  BANK_FEE             a small debit whose description is a fee
//   6  MANUAL_MATCH         a learned or widened suggestion the user confirms
//   7  —                    whatever is left, classified and explained
//
// What comes out is deliberately lopsided: a short list of exceptions, each
// carrying its own plain-language explanation, and a long list of matches
// nobody needs to read. No score reaches the caller. A match either holds or it
// does not, and when it holds the reason is a sentence — "Rp 95.7M debit =
// Rp 98.8M cleared less Rp 3.0M PPh 23 withheld" — rather than a percentage,
// because a number between 0 and 1 tells a Finance Manager nothing they can act
// on and invites them to treat 0.87 as good enough.

import { BILLS } from "../data/seed/bills";
import { VENDORS } from "../data/seed/vendors";
import { CUSTOMERS } from "../data/seed/customers";
import { KNOWN_NAMES } from "../data/seed/bankKnownNames";
import { railOf } from "./paymentRails";
import { formatRupiahExact } from "./format";
import { dayDiff, addBusinessDays } from "./clock";

// ── Configuration ────────────────────────────────────────────────────────────
//
// The fee ceiling is OQ-01 in the Bank Reconciliation PRD. The doc's
// requirements say Rp 50,000 and its own open question argues that down to
// Rp 15,000, on the grounds that Indonesian bank fees top out around Rp 25,000
// for RTGS and a Rp 50,000 net would start swallowing real payments. We take
// the open question's number: the cost of a fee landing in the exception list
// is one extra row, and the cost of a payment being written off as a fee is a
// missing supplier payment nobody looks for again.

export const FEE_CEILING = 15000;

const FEE_PATTERNS = /(biaya|admin|adm\b|fee|charge|provisi)/i;
const INTEREST_PATTERNS = /(bunga|interest)/i;

const DATE_WINDOW_DAYS = 5;   // PRD Priority 1
const WIDE_WINDOW_DAYS = 12;  // PRD Priority 6 — a suggestion, never an auto-match

const rp = (n) => formatRupiahExact(Math.abs(n));

// Dates inside an explanation are prose, so they read as the rest of the UI
// reads them. An explanation is the one place a raw "2025-04-11" is jarring:
// everything around it is a sentence.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const d = (iso) => {
  if (!iso) return "—";
  const [y, m, day] = iso.split("-");
  return `${parseInt(day, 10)} ${MONTHS[parseInt(m, 10) - 1]} ${y}`;
};

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
// the bank printed one at all, is the free text after the reference token —
// upper-cased and cut to the column width. Getting from that text to a vendor
// or customer is the step the engineering plan hands to an LLM. Here it is
// stood in for by the two things that step would lean on:
//
//   known   a name a person confirmed on an earlier reconciliation
//           ("PT SUMBER MAKMUR ABAD" means PT Sumber Makmur Abadi). Trusted,
//           because a person already said so.
//   read    the text resolves to exactly one vendor or customer in the master.
//           This is the model's reading, so it can point at a candidate but it
//           cannot close one on its own.
//
// The pattern below is BCA's e-banking format. Every bank lays this line out
// differently, which is the first thing to learn from the finance team.

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
// Straight from the PRD, and ordered by whose problem it is. Anomalies first
// because an unusual amount should be looked at before it is matched; timing
// last and collapsed because it is not a problem at all.

export const EXCEPTION_TYPES = {
  ANOMALY:           { key: "ANOMALY",           label: "Anomaly",            rank: 1, blocking: true,  tone: "danger" },
  GENUINE_MISMATCH:  { key: "GENUINE_MISMATCH",  label: "Genuine mismatch",   rank: 2, blocking: true,  tone: "danger" },
  UNCLASSIFIED:      { key: "UNCLASSIFIED",      label: "Unclassified",       rank: 3, blocking: true,  tone: "warn"   },
  KNOWN_SYSTEMATIC:  { key: "KNOWN_SYSTEMATIC",  label: "Known systematic",   rank: 4, blocking: false, tone: "info"   },
  BANK_FEE:          { key: "BANK_FEE",          label: "Bank fee",           rank: 5, blocking: false, tone: "info"   },
  TIMING_DIFFERENCE: { key: "TIMING_DIFFERENCE", label: "Timing difference",  rank: 6, blocking: false, tone: "muted"  },
};

// Bank fees and known systematic credits do not block Gate 4 in the sense of
// needing investigation, but they DO need a decision — somebody has to agree to
// write them off. They are "not blocking" only once written off, which the
// state model handles by counting open ones.

export const MATCH_TYPES = {
  EXACT_AMOUNT: "EXACT_AMOUNT",
  KNOWN_NAME: "KNOWN_NAME",
  PPH_WITHHOLDING: "PPH_WITHHOLDING",
  VA_REGISTRY: "VA_REGISTRY",
  PAYMENT_RAIL_TIMING: "PAYMENT_RAIL_TIMING",
  BANK_FEE_WRITEOFF: "BANK_FEE_WRITEOFF",
  MANUAL_MATCH: "MANUAL_MATCH",
  MANUAL_WRITEOFF: "MANUAL_WRITEOFF",
};

// ── Why a matched line matched ───────────────────────────────────────────────
//
// The PRD calls this the match signal and requires it on every link. It is
// generated from the record's own numbers, never written by a model, so it
// cannot describe something the data does not say.

// The party named in a signal is always OUR record's — the bank never supplied
// one as data, so a sentence claiming "the bank says PT X" would be invented.
function signalFor(line, record, { read = null } = {}) {
  const where = record.kind === "ap_payment" ? `the payment on ${record.billId}` : record.ref;
  const lag = dayDiff(line.date, record.date);
  const lagText = lag === 0 ? "" : ` The bank posted it ${lag === 1 ? "a day" : `${lag} days`} after we booked it.`;
  const party = record.counterparty ? ` ${line.amount < 0 ? "to" : "from"} ${record.counterparty}` : "";

  if (read?.via === "known") {
    return `${rp(line.amount)}${party} matched to ${where}. Several entries share this amount; the description reads "${read.raw}", a name confirmed as ${read.name} on an earlier reconciliation.${lagText}`;
  }
  const pph = record.withheld > 0
    ? ` PPh 23 of ${rp(record.withheld)} was withheld and recorded separately, so the bank shows the cash that was sent, not the bill total.`
    : "";
  return `${rp(line.amount)}${party} matched to ${where} on ${d(record.date)} — same amount, and no other entry on this account could be it.${pph}${lagText}`;
}

// ── Priority 1 ───────────────────────────────────────────────────────────────

function exactCandidates(line, pool) {
  return pool.filter(
    (r) =>
      !r._taken &&
      r.amount === line.amount &&
      Math.abs(dayDiff(line.date, r.date)) <= DATE_WINDOW_DAYS,
  );
}

function priorityExact(line, pool, read) {
  const candidates = exactCandidates(line, pool);
  if (!candidates.length) return null;

  // Only one entry on this account could be this line. Uniqueness is the
  // evidence, and it is the common case — no name needed.
  if (candidates.length === 1) return { record: candidates[0], matchType: MATCH_TYPES.EXACT_AMOUNT };

  // A tie. A name somebody already confirmed settles it.
  const named = read.name ? candidates.filter((r) => nameAgrees(read.name, r.counterparty)) : [];
  if (named.length === 1 && read.via === "known") {
    return { record: named[0], matchType: MATCH_TYPES.KNOWN_NAME };
  }
  // A name read fresh from the description points at one — offer it, do not
  // take it. Reading the name right is likely; being wrong about which of two
  // same-amount payments this was is expensive.
  if (named.length === 1) return { suggest: named[0], candidates };

  // Otherwise fall through rather than pick the nearest date: "two candidates,
  // took the first" is how a duplicate payment gets quietly reconciled away.
  return null;
}

// ── Priority 2 ───────────────────────────────────────────────────────────────
//
// A debit that matches nothing, but equals an open bill net of its withholding.
// Somebody paid this vendor from the bank and never recorded it in Klay. Every
// other system reports the amount as unexplained, because the amount appears
// nowhere: it is not the invoice total and there is no payment. The formula is
// what makes it legible.
//
// This produces an exception rather than a match, because recognising a payment
// is not the same as having recorded one — the ledger is still missing an entry,
// and closing the gate on it would be closing on books we know are incomplete.

function priorityWithholding(line, { billsById, read }) {
  if (line.amount >= 0) return null;
  const target = Math.abs(line.amount);

  const hits = BILLS.filter(
    (b) => (b.pph23 || 0) > 0 && b.sisa > 0 && b.total - b.pph23 === target,
  );
  if (!hits.length) return null;

  const named = hits.filter((b) => nameAgrees(read.name, b.vendorName));
  const bill = named.length === 1 ? named[0] : hits.length === 1 ? hits[0] : null;
  if (!bill) return null;

  // Derived from the two amounts already in the sentence rather than read off
  // `bill.pphRate`, which is stored as a fraction (0.02) — printing that field
  // directly gave "PPh 23 (0.02%)" next to a figure that was plainly 2%.
  // A rate computed from the numbers beside it cannot contradict them.
  const rate = `${Number(((bill.pph23 / bill.total) * 100).toFixed(2))}%`;
  void billsById;
  return {
    type: EXCEPTION_TYPES.GENUINE_MISMATCH.key,
    detector: "PPH_WITHHOLDING",
    // One line for a list row; `explanation` stays the full account of it.
    brief: `${bill.id} (${bill.vendorName}) less ${rate} PPh 23. Paid, but not recorded in Klay.`,
    title: `Recognised via PPh 23 — ${bill.id} was paid but never recorded`,
    explanation:
      `${rp(line.amount)} left the bank on ${d(line.date)} and matches no payment recorded in Klay. ` +
      `It is ${rp(bill.total)} on ${bill.id} less ${rp(bill.pph23)} PPh 23 (${rate}) — so it looks like ${bill.vendorName} was paid ` +
      `from the bank app and the payment was never recorded. The bill is still open in Klay: the money moved, the entry did not. Record the payment against ${bill.id} to reconcile it.`,
    billId: bill.id,
    vendorName: bill.vendorName,
    counterparty: bill.vendorName,
    actions: ["record-payment", "manual-match", "write-off"],
  };
}

// ── Priority 3 ───────────────────────────────────────────────────────────────
//
// The registry itself is deferred, so a VA credit cannot yet be resolved to a
// customer. What we can do — and what stops it being filed as noise — is say
// exactly why it is unresolved and what would fix it.

function priorityVirtualAccount(line) {
  if (line.amount <= 0) return null;
  const vaNumber = (VA_IN_DESCRIPTION.exec(line.description || "") || [])[1];
  if (!vaNumber) return null;
  return {
    type: EXCEPTION_TYPES.GENUINE_MISMATCH.key,
    detector: "VA_UNREGISTERED",
    title: `Virtual Account credit — VA ${vaNumber} is not in the registry`,
    explanation:
      `${rp(line.amount)} arrived on ${d(line.date)} tagged with Virtual Account ${vaNumber} and no customer name or ` +
      `invoice reference — which is how every VA credit arrives. Klay can match these automatically once the VA number is ` +
      `mapped to a customer. This one is not mapped, so there is nothing to match it to yet.`,
    vaNumber,
    // No "add to registry" action: the registry is not built yet, and offering
    // a button that cannot do what it says is worse than saying so in the
    // explanation, which this one does.
    actions: ["manual-match", "write-off", "mark-later"],
  };
}

// ── Priority 5 ───────────────────────────────────────────────────────────────

function priorityBankFee(line) {
  if (line.amount >= 0 || Math.abs(line.amount) > FEE_CEILING) return null;
  if (!FEE_PATTERNS.test(line.description)) return null;
  return {
    type: EXCEPTION_TYPES.BANK_FEE.key,
    detector: "FEE_PATTERN",
    title: `Bank fee — ${rp(line.amount)}`,
    explanation:
      `${rp(line.amount)} on ${d(line.date)}, described by the bank as "${line.description}". Under the ` +
      `${rp(FEE_CEILING)} fee ceiling and the description is a fee. Write off to Bank Charges.`,
    actions: ["write-off-fee"],
  };
}

// Interest credited by the bank is the mirror image: systematic, small relative
// to everything else, and never in the books because nobody raises an invoice
// for it.
function priorityBankInterest(line) {
  if (line.amount <= 0 || !INTEREST_PATTERNS.test(line.description)) return null;
  return {
    type: EXCEPTION_TYPES.KNOWN_SYSTEMATIC.key,
    detector: "INTEREST_CREDIT",
    title: `Bank interest — ${rp(line.amount)}`,
    explanation:
      `${rp(line.amount)} credited on ${d(line.date)}, described by the bank as "${line.description}". ` +
      `Interest the bank paid us. There is no ledger entry because nothing in Klay raises one. Post to Interest Income.`,
    actions: ["write-off-interest"],
  };
}

// ── Priority 6 ───────────────────────────────────────────────────────────────
//
// A suggestion, and presented as one. Widening the date window finds candidates
// that the ±5 day rule rejected; that is weaker evidence, so the engine offers
// it and does not take it.

function prioritySuggestion(line, pool) {
  const near = pool.filter(
    (r) => !r._taken && r.amount === line.amount && Math.abs(dayDiff(line.date, r.date)) <= WIDE_WINDOW_DAYS,
  );
  if (near.length !== 1) return null;
  const r = near[0];
  return {
    record: r,
    note: `Same amount as ${r.ref} on ${d(r.date)}, ${Math.abs(dayDiff(line.date, r.date))} days from this line — outside the ${DATE_WINDOW_DAYS}-day window Klay matches on its own.`,
  };
}

// ── Anomalies ────────────────────────────────────────────────────────────────
//
// Evaluated across the statement rather than line by line, because that is the
// only level at which "this happened twice" is visible. The PRD puts anomalies
// above everything else: an unusual amount should be questioned before it is
// reconciled, not after.

// Keyed on the name READ from each description, because that is the only
// place a name exists. Two lines with no readable name cannot be called
// duplicates of each other on amount alone — same-amount payments to different
// people are ordinary.
function duplicateGroups(lines, readOf) {
  const seen = new Map();
  for (const l of lines) {
    const name = readOf.get(l.id)?.name;
    if (!name) continue;
    const key = `${l.amount}|${name.toUpperCase()}`;
    seen.set(key, [...(seen.get(key) || []), l]);
  }
  return [...seen.values()].filter((g) => g.length > 1);
}

// ── The run ──────────────────────────────────────────────────────────────────

export function reconcile({ statement, books = [] }) {
  if (!statement || !statement.loaded) {
    return { lines: [], links: [], exceptions: [], outstanding: [], counts: emptyCounts(), balanceCheck: null };
  }

  // A private copy: `_taken` marks a record as spent so two bank lines cannot
  // both claim it, which is what makes the duplicate-payment case detectable.
  const pool = books.filter((r) => r.accountId === statement.account.id).map((r) => ({ ...r, _taken: false }));
  const billsById = Object.fromEntries(BILLS.map((b) => [b.id, b]));

  const readOf = new Map(statement.lines.map((l) => [l.id, readCounterparty(l.description)]));
  const dupes = new Set(duplicateGroups(statement.lines, readOf).flatMap((g) => g.slice(1).map((l) => l.id)));

  const links = [];
  const exceptions = [];
  const rows = [];

  for (const line of statement.lines) {
    const read = readOf.get(line.id);

    // Priority 1
    const exact = priorityExact(line, pool, read);
    if (exact?.suggest && !dupes.has(line.id)) {
      const r = exact.suggest;
      // Held for a person to confirm: not matched, but not outstanding either —
      // reporting it as never cleared would contradict the suggestion beside it.
      r._reserved = true;
      const ex = buildException(line, {
        type: EXCEPTION_TYPES.UNCLASSIFIED.key,
        detector: "NAME_FROM_DESCRIPTION",
        brief: `${r.ref} — read as ${read.name}. ${exact.candidates.length} entries share this amount.`,
        title: `Suggested match — ${r.ref}, ${rp(line.amount)}`,
        explanation:
          `${exact.candidates.length} entries on this account are ${rp(line.amount)} within ${DATE_WINDOW_DAYS} days, so the amount ` +
          `alone can't decide. The description reads "${read.raw}", which Klay read as ${read.name} — pointing to ${r.ref}` +
          `${r.billId && r.ref !== r.billId ? ` (${r.billId})` : ""} on ${d(r.date)}. Confirm it and Klay will remember that name.`,
        counterparty: read.name,
        suggestion: { recordId: r.id, ref: r.ref, note: `Read "${read.raw}" as ${read.name}.`, learnName: { raw: read.raw, name: read.name } },
        actions: ["confirm-suggestion", "manual-match", "mark-later"],
      });
      exceptions.push(ex);
      rows.push({ line, link: null, exception: ex });
      continue;
    }
    if (exact?.record && !dupes.has(line.id)) {
      exact.record._taken = true;
      const link = {
        id: `K-${line.id}`,
        lineId: line.id,
        recordId: exact.record.id,
        matchType: exact.matchType,
        signal: signalFor(line, exact.record, { read: exact.matchType === MATCH_TYPES.KNOWN_NAME ? read : null }),
        record: exact.record,
        pphAmount: exact.record.withheld || 0,
      };
      links.push(link);
      rows.push({ line, link, exception: null });
      continue;
    }

    // Priority 2, 3, 5 — each produces an explained exception rather than a link.
    const found =
      priorityWithholding(line, { billsById, read }) ||
      priorityVirtualAccount(line) ||
      priorityBankFee(line) ||
      priorityBankInterest(line);

    if (found) {
      const ex = buildException(line, found);
      exceptions.push(ex);
      rows.push({ line, link: null, exception: ex });
      continue;
    }

    // A duplicate of a line that already matched is an anomaly, not a mystery:
    // we know precisely what it is a second copy of.
    if (dupes.has(line.id)) {
      const ex = buildException(line, {
        type: EXCEPTION_TYPES.ANOMALY.key,
        detector: "DUPLICATE_PAYMENT",
        title: `Possible duplicate payment — ${rp(line.amount)} to ${read.name}`,
        counterparty: read.name,
        explanation:
          `${rp(line.amount)} left the account twice on this statement, both lines reading "${read.raw}" (${read.name}), and the ledger holds one ` +
          `payment of that amount. Either the transfer was sent twice or one of them belongs to a bill that has not been ` +
          `entered. Verify before matching — this is the amount worth being wrong about.`,
        actions: ["manual-match", "write-off", "mark-later"],
      });
      exceptions.push(ex);
      rows.push({ line, link: null, exception: ex });
      continue;
    }

    // Priority 6 — offer, do not take.
    const suggestion = prioritySuggestion(line, pool);
    const ex = buildException(line, {
      type: EXCEPTION_TYPES.UNCLASSIFIED.key,
      detector: suggestion ? "WIDENED_WINDOW" : "NO_CANDIDATE",
      brief: suggestion ? `${suggestion.record.ref} — same amount, ${Math.abs(dayDiff(line.date, suggestion.record.date))} days apart.` : null,
      title: suggestion
        ? `Possibly ${suggestion.record.ref} — ${rp(line.amount)}`
        : `Unexplained ${line.amount < 0 ? "debit" : "credit"} — ${rp(line.amount)}`,
      explanation: suggestion
        ? `${suggestion.note} Confirm it if that's the one.`
        : `${rp(line.amount)} ${line.amount < 0 ? "left" : "arrived in"} the account on ${d(line.date)}. No ledger entry on ` +
          `this account has this amount within ${DATE_WINDOW_DAYS} days, ` +
          (read.raw
            ? read.name
              ? `though the description names ${read.name}. `
              : `and the name in the description, "${read.raw}", isn't a vendor or customer Klay knows. `
            : `and the description carries no name to go on. `) +
          `This one needs a person.`,
      counterparty: read.name,
      suggestion: suggestion ? { recordId: suggestion.record.id, ref: suggestion.record.ref, note: suggestion.note } : null,
      actions: suggestion ? ["confirm-suggestion", "manual-match", "write-off", "mark-later"] : ["manual-match", "write-off", "mark-later"],
    });
    exceptions.push(ex);
    rows.push({ line, link: null, exception: ex });
  }

  // ── Priority 4, the other direction ────────────────────────────────────────
  //
  // Everything the books hold that no bank line claimed. The rail decides
  // whether that is physics or a problem: a BI-FAST payment booked a fortnight
  // before the cut-off should have cleared long ago, while one booked yesterday
  // has not had time. Classifying both as "timing" — which is what a blanket
  // rule would do — is the false comfort the PRD warns against.
  // Two lists reach here and they overlap: the statement generator already put
  // aside what it chose not to print, and the pool still holds whatever no line
  // claimed. Keyed by record id, preferring the generator's entry because that
  // one carries the rail the payment actually went out on — without the key,
  // a giro would be reported as outstanding twice.
  // The rail comes from our own payment record — the bank never says how money
  // travelled, and a line it has not printed says nothing at all.
  const outstandingBy = new Map();
  for (const entry of statement.outstanding) outstandingBy.set(entry.record.id, entry);
  for (const r of pool) {
    if (r._taken || r._reserved || outstandingBy.has(r.id)) continue;
    outstandingBy.set(r.id, { record: r });
  }

  const outstanding = [];
  for (const entry of outstandingBy.values()) {
    const record = entry.record;
    const rail = railOf(record.rail);
    const via = railPhrase(record, rail);
    const expected = addBusinessDays(record.date, rail.clearsInDays);

    // A giro is a post-dated cheque. The bill is relieved the day it is handed
    // over and the bank line appears the day it is presented, which is a date
    // nobody in Klay holds. Measuring it against a clearing window would report
    // every giro as overdue the day after it was written — so it is in transit
    // until the bank says otherwise, and the explanation says why rather than
    // inventing a date to expect it on.
    const isGiro = record.method === "giro";
    const overdue = !isGiro && expected <= statement.through;

    const ex = buildException(
      { id: `O-${record.id}`, accountId: record.accountId, date: record.date, amount: record.amount, description: record.label, counterparty: record.counterparty, rail: rail.key },
      overdue
        ? {
            type: EXCEPTION_TYPES.GENUINE_MISMATCH.key,
            detector: "BOOKED_NOT_CLEARED",
            title: `Booked but never cleared — ${rp(record.amount)}`,
            explanation:
              `Klay booked ${rp(record.amount)} on ${d(record.date)}${record.counterparty ? ` to ${record.counterparty}` : ""} ` +
              `${via}. It should have been on a statement by ${d(expected)}, and this one runs to ` +
              `${d(statement.through)}. The books say the money moved and the bank has never seen it.`,
            recordId: record.id,
            billId: record.billId,
            actions: ["manual-match", "mark-later"],
          }
        : {
            type: EXCEPTION_TYPES.TIMING_DIFFERENCE.key,
            detector: isGiro ? "GIRO_UNPRESENTED" : "RAIL_TIMING",
            title: isGiro
              ? `Giro not yet presented — ${rp(record.amount)}`
              : `In transit — ${rp(record.amount)}${rail.key === "UNKNOWN" ? "" : ` via ${rail.label}`}`,
            explanation: isGiro
              ? `Giro ${record.giroNumber || ""} for ${rp(record.amount)}${record.counterparty ? ` to ${record.counterparty}` : ""}, handed over ${d(record.date)}. `.replace(/\s{2,}/g, " ") +
                `A giro reaches the statement when the holder presents it, not when we wrote it, so there is no date to expect ` +
                `it on — it will match itself whenever it is banked. Nothing to do.`
              : `Booked ${d(record.date)}${record.counterparty ? ` to ${record.counterparty}` : ""}. Sent ${via}, ` +
                `so this is expected on the ${d(expected)} statement. Nothing is wrong and nothing needs doing — it will match ` +
                `itself when the next statement is loaded.`,
            recordId: record.id,
            billId: record.billId,
            expectedClearance: isGiro ? null : expected,
            rail: rail.key,
            actions: ["confirm-timing"],
          },
    );
    // Kept off the exception list on purpose: reconciliation works through the
    // STATEMENT, line by line, and a record the bank never printed is not a line.
    // It stays here so a payment row can still say Cleared / In transit / Unmatched.
    outstanding.push({ record, rail: rail.key, expected, overdue, exception: ex });
  }

  const balanceCheck = checkOpeningBalance(statement);

  return { lines: rows, links, exceptions, outstanding, counts: countOf(rows, exceptions), balanceCheck };
}

// How the rail reads inside a sentence. An unrecorded rail is said plainly —
// the fix is on the payment form, not in the bank's data.
function railPhrase(record, rail) {
  if (rail.key !== "UNKNOWN") return `via ${rail.label}, which ${rail.note}`;
  return record.kind === "ap_payment"
    ? "with no transfer method recorded on the payment (Klay allows two business days)"
    : "from a journal entry, which carries no transfer method (Klay allows two business days)";
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
    rail: spec.rail || line.rail || null,
    resolution: null, // { action, at, by, note, jeNumber }
    ...spec,
  };
}

// The PRD's one real safety net on an uploaded statement: this statement's
// opening balance must be the previous one's closing balance. It catches a page
// missed in a PDF, which is the failure an OCR pipeline actually has and which
// no amount of per-line matching would reveal.
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
  return { total: 0, matched: 0, anomaly: 0, genuine: 0, unclassified: 0, systematic: 0, fee: 0, timing: 0, blocking: 0, open: 0 };
}

function countOf(rows, exceptions) {
  const live = exceptions.filter(isOpen);
  const by = (t) => live.filter((e) => e.type === t).length;
  const blocking = live.filter((e) => EXCEPTION_TYPES[e.type]?.blocking).length;
  return {
    total: rows.length,
    matched: rows.filter((r) => r.link).length,
    anomaly: by("ANOMALY"),
    genuine: by("GENUINE_MISMATCH"),
    unclassified: by("UNCLASSIFIED"),
    systematic: by("KNOWN_SYSTEMATIC"),
    fee: by("BANK_FEE"),
    timing: by("TIMING_DIFFERENCE"),
    blocking,
    open: live.length,
  };
}

// "Mark for later" parks an item without deciding it. It is recorded like any
// other decision, but it is still open: parking must never be a way to get a
// month marked reconciled.
export const isOpen = (e) => !e.resolution || e.resolution.action === "mark-later";

export { countOf, nameAgrees };
