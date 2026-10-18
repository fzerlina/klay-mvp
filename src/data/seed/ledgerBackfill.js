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
//   3. A posting entry for every issued invoice that has none (Dr trade AR,
//      Cr the revenue account its lines describe), and a receipt entry for
//      every paid one (Dr bank, Cr trade AR). Without these the receivables
//      ledger held a handful of invoices while the AR aging held 177.
//   4. One opening-balance entry at the start of the year, funding each bank
//      account enough that its balance never goes negative across the demo
//      year, against retained earnings.
//
// Posting and payment dates come from the same helpers the agings use
// (billPostedOn / billPaidOn in lib/apAging.js, invoicePaidOn in
// lib/arAging.js), so each aging total ties to its control account on any
// as-of date. The control accounts take nothing else: hand-written journals
// post to Other Receivables / Other Payables instead (see journalEntries.js).
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
import { billPostedOn, billPaidOn } from "../../lib/apAging";
import { invoicePaidOn } from "../../lib/arAging";
import { INVOICES } from "./invoices";
import { TODAY } from "../../lib/clock";

const TODAY_ISO = `${TODAY.getFullYear()}-${String(TODAY.getMonth() + 1).padStart(2, "0")}-${String(TODAY.getDate()).padStart(2, "0")}`;

const AP = { code: "2-1100", name: "Accounts Payable — Trade" };
// Historical payments went out of the two operating accounts in the chart.
const PAY_FROM = [
  { code: "1-1300", name: "Bank — BCA Operating" },
  { code: "1-1400", name: "Bank — Mandiri Operating" },
];
const AR = { code: "1-2100", name: "Accounts Receivable — Trade" };
const RETAINED = { code: "3-1300", name: "Retained Earnings" };
// Revenue account for an invoice line, read from what it sold. Invoices carry
// no account of their own; the anchor invoices' journals use the same split.
const REVENUE = [
  [/furniture/i, "4-1100"],
  [/textile/i, "4-1200"],
  [/electronic/i, "4-1400"],
  [/setup|training|consult|service/i, "4-1500"],
  [/pack/i, "4-1300"],
];
const revenueCodeOf = (desc = "") => (REVENUE.find(([re]) => re.test(desc)) || [null, "4-1300"])[1];
const accountName = (code) => COA.find((a) => a.code === code)?.name || code;
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

  // 1. Posting entries.
  for (const bill of BILLS) {
    if (!bill.je_number || numbers.has(bill.je_number) || postedRefs.has(bill.id)) continue;
    const date = billPostedOn(bill);
    const by = postedByOf(bill);
    const je = {
      ...buildJournalEntry(bill, vendorOf(bill.vendor), bill.je_number, by),
      je_date: date, created_date: date, posted_date: date,
    };
    if (!balanced(je)) { skipped.push(bill.id); continue; }
    out.push(je);
    numbers.add(je.je_number);
    postedRefs.add(bill.id);
  }

  // 2. Payment entries for paid bills. Numbered in a block of their own,
  //    after the highest number already in use that year.
  const paid = BILLS
    .filter((b) => b.pay === "paid" && postedRefs.has(b.id) && !paidRefs.has(b.id))
    // Held between the posting date and today (billPaidOn), the date the AP
    // aging uses too.
    .map((b) => ({ bill: b, date: billPaidOn(b) }))
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

  // 3. Invoices and their receipts. Numbered on from the payments.
  const invoiced = new Set(existing.filter((j) => j.reference_type === "invoice").map((j) => j.reference_id));
  const received = new Set(existing.filter((j) => j.reference_type === "invoice_payment").map((j) => j.reference_id));
  const nextNo = (date) => {
    const year = date.slice(0, 4);
    seqMax[year] = (seqMax[year] || 0) + 1;
    return `JE-${year}-${String(seqMax[year]).padStart(4, "0")}`;
  };
  const issued = INVOICES
    .filter((inv) => inv.approval !== "draft" && (inv.total || 0) > 0 && inv.date && inv.date <= TODAY_ISO)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  for (const inv of issued) {
    if (invoiced.has(inv.id)) continue;
    const by = (inv.audit || []).find((a) => a.type === "sent")?.by || "Andi Prasetyo";
    const ref = inv.invNo && inv.invNo !== "—" ? inv.invNo : inv.id;
    const byCode = {};
    for (const it of inv.items || []) byCode[revenueCodeOf(it.desc)] = (byCode[revenueCodeOf(it.desc)] || 0) + (it.subtotal || 0);
    // Lines that don't add up to the invoice total put the rest on the first account.
    const codes = Object.keys(byCode);
    if (!codes.length) { codes.push("4-1300"); byCode["4-1300"] = 0; }
    const gap = inv.total - codes.reduce((s, c) => s + byCode[c], 0);
    byCode[codes[0]] += gap;
    out.push({
      je_number: nextNo(inv.date), je_date: inv.date, status: "posted",
      memo: `Invoice issued — ${inv.customerName} · ${ref}`,
      reference_type: "invoice", reference_id: inv.id,
      created_by: by, created_date: inv.date, posted_by: by, posted_date: inv.date,
      lines: [
        { account_code: AR.code, account_name: AR.name, debit: inv.total, credit: 0, description: `Trade receivable from ${inv.customerName}` },
        ...codes.map((c) => ({ account_code: c, account_name: accountName(c), debit: 0, credit: byCode[c], description: `Revenue ${accountName(c).replace(/^Product Sales — /, "")}` })),
      ],
    });
  }
  issued
    .filter((inv) => inv.payStatus === "paid" && !received.has(inv.id))
    .map((inv) => ({ inv, date: invoicePaidOn(inv) }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.inv.id.localeCompare(b.inv.id))
    .forEach(({ inv, date }, i) => {
      const bank = PAY_FROM[i % PAY_FROM.length];
      const ref = inv.invNo && inv.invNo !== "—" ? inv.invNo : inv.id;
      out.push({
        je_number: nextNo(date), je_date: date, status: "posted",
        memo: `Customer payment received — ${inv.customerName} · ${ref}`,
        reference_type: "invoice_payment", reference_id: inv.id,
        created_by: "Rina Kusuma", created_date: date, posted_by: "Rina Kusuma", posted_date: date,
        lines: [
          { account_code: bank.code, account_name: bank.name, debit: inv.total, credit: 0, description: `Received into ${bank.name.replace(/^Bank — /, "")}` },
          { account_code: AR.code, account_name: AR.name, debit: 0, credit: inv.total, description: `Settle receivable — ${inv.customerName}` },
        ],
      });
    });

  // 4. Opening balances. Walk every bank and cash account through all posted
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
