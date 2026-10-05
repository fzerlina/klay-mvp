// Ledger backfill — the journal entries the seed implies but never wrote.
//
// The bill seed marks 160 bills as posted (each carries a je_number and a
// je_posted_date) and 56 of them as paid, but journalEntries.js only holds a
// handful of the matching entries. The General Ledger is built from journal
// entries alone, so without these the payables ledger misses most of what the
// company owes and the bank accounts miss most of what was paid out.
//
// Generated here, deterministically, from the bills themselves:
//   1. A posting entry for every posted bill that has none — the same entry
//      Bill Detail writes when a bill is posted in-session (buildJournalEntry).
//   2. A payment entry for every paid bill that has none, split the way
//      Record payment splits it: Dr trade AP for the gross, Cr bank for what
//      reached the vendor, Cr withholding tax payable for the PPh kept back
//      (PPh is recognised at payment, not at posting).
//   3. One opening-balance entry at the start of the year, funding each bank
//      account enough that its balance never goes negative across the demo
//      year, against retained earnings.
//
// These are loaded into the journal store (JournalEntriesContext), NOT into
// journalEntries.js: bank reconciliation builds its statements from that seed
// file, and its demo is tuned to it. Adding six months of bill payments there
// would rewrite every statement.

import { BILLS } from "./bills";
import { VENDORS } from "./vendors";
import { COA } from "./coa";
import { JOURNAL_ENTRIES } from "./journalEntries";
import { PAYMENT_HISTORY_JES } from "./paymentHistory";
import { buildJournalEntry } from "../../lib/billJournalPreview";
import { TODAY } from "../../lib/clock";

const TODAY_ISO = `${TODAY.getFullYear()}-${String(TODAY.getMonth() + 1).padStart(2, "0")}-${String(TODAY.getDate()).padStart(2, "0")}`;

const AP = { code: "2-1100", name: "Accounts Payable — Trade" };
// Historical payments went out of the two operating accounts in the chart.
const PAY_FROM = [
  { code: "1-1300", name: "Bank — BCA Operating" },
  { code: "1-1400", name: "Bank — Mandiri Operating" },
];
const RETAINED = { code: "3-1300", name: "Retained Earnings" };
const WHT = { code: "2-2300", name: "Withholding Tax Payable" };

const vendorOf = (id) => VENDORS.find((v) => v.id === id) || null;
const postedByOf = (bill) => (bill.audit || []).find((a) => a.type === "posted")?.by || "Budi Santoso";
const balanced = (je) => {
  const dr = je.lines.reduce((s, l) => s + (l.debit || 0), 0);
  const cr = je.lines.reduce((s, l) => s + (l.credit || 0), 0);
  return dr > 0 && Math.round(dr) === Math.round(cr);
};

function build() {
  const existing = [...JOURNAL_ENTRIES, ...PAYMENT_HISTORY_JES];
  const numbers = new Set(existing.map((j) => j.je_number));
  const postedRefs = new Set(existing.filter((j) => ["bill", "ap_bill"].includes(j.reference_type)).map((j) => j.reference_id));
  const paidRefs = new Set(existing.filter((j) => j.reference_type === "bill_payment").map((j) => j.reference_id));

  const out = [];
  const skipped = [];
  // When each bill reached the ledger, so its payment is never dated before it.
  const postedOn = new Map(existing.filter((j) => ["bill", "ap_bill"].includes(j.reference_type)).map((j) => [j.reference_id, j.je_date]));

  // 1. Posting entries.
  for (const bill of BILLS) {
    if (!bill.je_number || numbers.has(bill.je_number) || postedRefs.has(bill.id)) continue;
    // Capped at the demo date: a handful of seeded posting dates run past it.
    const posted = bill.je_posted_date || bill.date;
    const date = posted > TODAY_ISO ? TODAY_ISO : posted;
    const by = postedByOf(bill);
    const je = {
      ...buildJournalEntry(bill, vendorOf(bill.vendor), bill.je_number, by),
      je_date: date, created_date: date, posted_date: date,
    };
    if (!balanced(je)) { skipped.push(bill.id); continue; }
    out.push(je);
    numbers.add(je.je_number);
    postedRefs.add(bill.id);
    postedOn.set(bill.id, date);
  }

  // 2. Payment entries for paid bills. Numbered in a block of their own,
  //    after the highest number already in use that year.
  const paid = BILLS
    .filter((b) => b.pay === "paid" && postedRefs.has(b.id) && !paidRefs.has(b.id))
    // A few seeded "paid" bills carry a payment date after the demo date, or
    // before the bill was posted. Money cannot leave in the future, nor settle
    // a payable that is not booked yet, so the date is held between the two.
    .map((b) => {
      const d = b.paymentDate || b.due || b.date;
      const capped = d > TODAY_ISO ? TODAY_ISO : d;
      const floor = postedOn.get(b.id) || capped;
      return { bill: b, date: capped < floor ? floor : capped };
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.bill.id.localeCompare(b.bill.id));
  const seqMax = {};
  for (const n of numbers) {
    const m = /^JE-(\d{4})-(\d+)$/.exec(n);
    if (m) seqMax[m[1]] = Math.max(seqMax[m[1]] || 0, parseInt(m[2], 10));
  }
  paid.forEach(({ bill, date }, i) => {
    const year = date.slice(0, 4);
    seqMax[year] = (seqMax[year] || 0) + 1;
    const je_number = `JE-${year}-${String(seqMax[year]).padStart(4, "0")}`;
    const withheld = Math.min(bill.pph23 || 0, bill.total);
    const cash = bill.total - withheld;
    const bank = PAY_FROM[i % PAY_FROM.length];
    const ref = bill.invNo && bill.invNo !== "—" ? bill.invNo : bill.id;
    out.push({
      je_number, je_date: date, status: "posted",
      memo: `Payment — ${bill.vendorName} · ${ref}`,
      reference_type: "bill_payment", reference_id: bill.id,
      created_by: "Dewi Anggraini", created_date: date, posted_by: "Dewi Anggraini", posted_date: date,
      lines: [
        { account_code: AP.code, account_name: AP.name, debit: bill.total, credit: 0, description: `Settle trade payable — ${bill.vendorName}` },
        { account_code: bank.code, account_name: bank.name, debit: 0, credit: cash, description: `Paid from ${bank.name.replace(/^Bank — /, "")}` },
        ...(withheld > 0
          ? [{ account_code: WHT.code, account_name: WHT.name, debit: 0, credit: withheld, description: "Withheld — owed to the tax office" }]
          : []),
      ],
    });
  });

  // 3. Opening balances. Walk every bank and cash account through all posted
  //    lines in date order, find its lowest point, and open it high enough to
  //    stay above a working float.
  const cashCodes = new Set(COA.filter((a) => a.parent === "g-cash" && a.code).map((a) => a.code));
  const lines = [...existing, ...out]
    .filter((j) => j.status === "posted")
    .flatMap((j) => j.lines.map((l) => ({ date: j.je_date, code: l.account_code, amt: (l.debit || 0) - (l.credit || 0) })))
    .filter((l) => cashCodes.has(l.code))
    .sort((a, b) => a.date.localeCompare(b.date));
  const running = {};
  const low = {};
  for (const l of lines) {
    running[l.code] = (running[l.code] || 0) + l.amt;
    low[l.code] = Math.min(low[l.code] ?? 0, running[l.code]);
  }
  const FLOAT = 250_000_000;
  const STEP = 50_000_000;
  const openingLines = Object.keys(low)
    .sort()
    .map((code) => {
      const amount = Math.ceil((-low[code] + FLOAT) / STEP) * STEP;
      return { account_code: code, account_name: COA.find((a) => a.code === code)?.name || code, debit: amount, credit: 0, description: "Opening balance" };
    });
  // Dated the day before the earliest posting, so every movement lands on
  // top of it.
  const firstDate = [...existing, ...out].map((j) => j.je_date).sort()[0] || "2025-01-01";
  const d = new Date(`${firstDate}T00:00:00`);
  d.setDate(d.getDate() - 1);
  const openDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  let openNo = 1;
  while (numbers.has(`JE-${openDate.slice(0, 4)}-${String(openNo).padStart(4, "0")}`)) openNo += 1;
  const total = openingLines.reduce((s, l) => s + l.debit, 0);
  if (total > 0) {
    out.unshift({
      je_number: `JE-${openDate.slice(0, 4)}-${String(openNo).padStart(4, "0")}`, je_date: openDate, status: "posted",
      memo: "Opening balances — brought forward from the previous system",
      reference_type: "manual", reference_id: null,
      created_by: "Sari Dewanti", created_date: openDate, posted_by: "Sari Dewanti", posted_date: openDate,
      lines: [
        ...openingLines,
        { account_code: RETAINED.code, account_name: RETAINED.name, debit: 0, credit: total, description: "Opening equity" },
      ],
    });
  }

  return { entries: out, skipped };
}

const built = build();

// Loaded by JournalEntriesContext alongside the seed and the payment history.
export const LEDGER_BACKFILL_JES = built.entries;
// Bills whose generated posting entry did not balance, left out rather than
// forced. Exposed for checking; expected to be empty.
export const LEDGER_BACKFILL_SKIPPED = built.skipped;
