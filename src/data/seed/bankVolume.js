// Simulated volume — what a busy operating account looks like in a month.
//
// The hand-written seed gives each account a couple of dozen movements, each
// one there to exercise a branch of the matching engine. A real operating
// account at a distributor this size carries hundreds: customers paying
// invoices all day, suppliers paid in batches, a QRIS settlement every
// morning, the utilities and the tax deposit mid-month, and a transfer fee
// printed after most outgoing transfers.
//
// This file adds that volume to the BOOK side only (records Klay holds), in
// the same shape lib/bankLedger.js produces, so the statement is still derived
// from the books by lib/../bankStatement.js — posting lag, in transit, names
// dropped — and the engine still has to re-find every link. Two things exist
// only on the bank side, as they do in life: the per-transfer fees, and the
// odd customer receipt nobody recorded in Klay.
//
// Current month only — earlier months are already reconciled and keep their
// hand-written statements. Deterministic: same seed, same month, every reload.

import { CUSTOMERS } from "./customers";
import { VENDORS } from "./vendors";
import { INVOICES } from "./invoices";
import { addDays, isWeekend } from "../../lib/clock";

// An unrecorded receipt is meant to have nothing in Klay to match. One that
// happened to land within 3% of an open invoice would draw a suggestion for
// that invoice — and claim it away from the hand-written cases that need it.
// Nudge it out of range.
const OPEN_SUBTOTALS = INVOICES.filter((i) => i.approval === "sent" && i.payStatus !== "paid").map((i) => i.dpp || i.total);
function clearOfInvoices(amount) {
  let a = amount;
  while (OPEN_SUBTOTALS.some((sub) => Math.abs(a - sub) <= sub * 0.035)) a = Math.round((a * 1.071) / 500) * 500;
  return a;
}

const MONTH = "2025-04";
const MONTH_END = "2025-04-30";
// Good Friday — a national holiday; banks post nothing.
const HOLIDAYS = new Set(["2025-04-18"]);

// Per business day: [min, max] count of receipts and supplier payments, and
// the Rp range of a supplier payment. Supplier payments are fewer but larger
// than receipts, so a month's cash in and cash out roughly offset — an
// operating account that only fills up is not one anybody runs. `refBase`
// keeps journal numbers clear of each other and of every real number — the
// seed's journals run to JE-2025-03xx, bill postings to JE-2025-12xx, and new
// journals count up from there — so simulated records sit at 7xxx–9xxx.
const PROFILES = {
  "bca-op":     { gl: "1-1300", glName: "Bank — BCA Operating",     refBase: 7000, receipts: [12, 18], payments: [7, 11], payRange: [2e6, 150e6], qris: true,  bills: true },
  "mandiri-op": { gl: "1-1400", glName: "Bank — Mandiri Operating", refBase: 8000, receipts: [5, 8],   payments: [3, 6],  payRange: [2e6, 120e6], qris: false, bills: false },
  "bni-op":     { gl: "1-1410", glName: "Bank — BNI Operating",     refBase: 9000, receipts: [2, 4],   payments: [1, 3],  payRange: [2e6, 90e6],  qris: false, bills: false },
};

export const VOLUME_ACCOUNT_IDS = Object.keys(PROFILES);

// mulberry32 — small, fast, good enough for seed data.
function rng(seedStr) {
  let h = 2166136261;
  for (let i = 0; i < seedStr.length; i++) { h ^= seedStr.charCodeAt(i); h = Math.imul(h, 16777619); }
  let a = h >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const between = (r, [lo, hi]) => lo + Math.floor(r() * (hi - lo + 1));
const pick = (r, list) => list[Math.floor(r() * list.length)];
// Invoice-shaped amounts: spread on a log scale, to the nearest Rp 500 — PPN
// at 11% leaves few round numbers on a real statement.
const amountIn = (r, lo, hi) => Math.round(Math.exp(Math.log(lo) + r() * (Math.log(hi) - Math.log(lo))) / 500) * 500;

const CUSTOMER_NAMES = CUSTOMERS.map((c) => c.name);
const VENDOR_NAMES = VENDORS.map((v) => v.name);

// The month's fixed outgoings on the main account: day of month, payee, the
// account the cash settled, and how the bank prints it.
const MONTHLY = [
  { day: 7,  payee: "PT PLN (Persero)",            contra: "6-2100", label: "Electricity — PLN",            lo: 18e6, hi: 26e6, text: (d) => `PEMBAYARAN PLN POSTPAID ${d.replace(/-/g, "").slice(2)} 5390012345` },
  { day: 10, payee: "PT Telkom Indonesia",         contra: "6-2200", label: "Internet & phone — Telkom",    lo: 4e6,  hi: 7e6,  text: (d) => `PEMBAYARAN TELKOM ${d.replace(/-/g, "").slice(2)} 0217654321` },
  { day: 14, payee: "BPJS Ketenagakerjaan",        contra: "2-4300", label: "BPJS Ketenagakerjaan — March", lo: 21e6, hi: 24e6, text: (d) => `BPJS TK ${d.replace(/-/g, "").slice(2)} 2504000731` },
  { day: 15, payee: "Kas Negara (MPN)",            contra: "2-3100", label: "PPh 21 deposit — March",       lo: 31e6, hi: 36e6, text: (d) => `MPN G3 BILLING ${d.replace(/-/g, "").slice(2)} 012504000123456` },
];

const isBusinessDay = (iso) => !isWeekend(iso) && !HOLIDAYS.has(iso);

const cache = new Map();

// Everything for one account's month: book records, and bank-only lines.
function monthFor(accountId) {
  if (cache.has(accountId)) return cache.get(accountId);
  const p = PROFILES[accountId];
  const records = [];
  const bankOnly = [];
  let seq = 0;
  const ref = () => `JE-2025-${String(p.refBase + ++seq).padStart(4, "0")}`;

  const record = (date, amount, { counterparty = "", label, contra, bankText = null }) => {
    const n = ref();
    records.push({
      id: `${n}:${p.gl}`, kind: "je", accountId, date, amount, counterparty, ref: n, label,
      glLine: { account_code: p.gl, account_name: p.glName }, contraCodes: [contra],
      billId: null, cleared: Math.abs(amount), withheld: 0, rail: null, simulated: true,
      ...(bankText ? { bankText } : {}),
    });
  };

  for (let d = `${MONTH}-01`; d <= MONTH_END; d = addDays(d, 1)) {
    if (!isBusinessDay(d)) continue;
    const r = rng(`${accountId}:${d}`);

    // Customers paying invoices. About one in thirty is never recorded in
    // Klay — it reaches the statement and nothing on the book side.
    for (let i = between(r, p.receipts); i > 0; i--) {
      const name = pick(r, CUSTOMER_NAMES);
      const amount = amountIn(r, 1.5e6, 70e6);
      if (r() < 0.035) {
        bankOnly.push({ date: d, amount: clearOfInvoices(amount), counterparty: name });
        continue;
      }
      record(d, amount, { counterparty: name, label: `Customer payment — ${name}`, contra: "1-2100" });
    }

    // Suppliers, paid in the day's batch. Most outgoing transfers print a
    // separate fee line after them.
    for (let i = between(r, p.payments); i > 0; i--) {
      const name = pick(r, VENDOR_NAMES);
      record(d, -amountIn(r, ...p.payRange), { counterparty: name, label: `Supplier payment — ${name}`, contra: "2-1100" });
      if (r() < 0.3) bankOnly.push({ date: d, amount: -2500, description: "BIAYA TXN BI-FAST" });
    }

    // Yesterday's card and QRIS takings, settled each business morning.
    if (p.qris) {
      record(d, amountIn(r, 3e6, 18e6), {
        label: "QRIS settlement — store sales", contra: "4-1100",
        bankText: `KR OTOMATIS QRIS MID 936000${String(between(r, [1000, 9999]))} ${d.slice(8, 10)}${d.slice(5, 7)}`,
      });
    }
  }

  if (p.bills) {
    for (const m of MONTHLY) {
      let d = `${MONTH}-${String(m.day).padStart(2, "0")}`;
      while (!isBusinessDay(d)) d = addDays(d, 1);
      const r = rng(`${accountId}:${m.label}`);
      record(d, -amountIn(r, m.lo, m.hi), { counterparty: m.payee, label: m.label, contra: m.contra, bankText: m.text(d) });
    }
  }

  records.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const out = { records, bankOnly };
  cache.set(accountId, out);
  return out;
}

// Book records for every simulated account within a window.
export function volumeRecords({ from, to } = {}) {
  return VOLUME_ACCOUNT_IDS.flatMap((id) =>
    monthFor(id).records.filter((r) => (!from || r.date >= from) && (!to || r.date <= to)),
  );
}

// Bank-only lines (fees, unrecorded receipts) for one account up to a date.
// `key` is the line's place in the whole month, so it names the same line
// however far an upload reaches.
export function volumeBankOnly(accountId, { from, through }) {
  if (!PROFILES[accountId]) return [];
  return monthFor(accountId).bankOnly
    .map((l, i) => ({ ...l, key: `v${i}` }))
    .filter((l) => l.date >= from && l.date <= through);
}
