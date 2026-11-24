// Tax Register sample data for GKB's three export sheets (Slack, 20 Oct 2026;
// docs/research/tax-register/README.md §0):
//
//   CUSTOMER_RENT      PPh 4(2) withheld BY customers on warehouse rent we
//                      invoice (sheet "PPh 4(2) by Customer", 10%).
//   CONSTRUCTION       Two fit-out projects billed by termin: the customer
//                      withholds PPh 4(2) final (2.65%, PP 9/2022) on each
//                      termin, while revenue is recognised by progress — so
//                      the withheld tax is prepaid until it is expensed
//                      (sheet "PPh 4(2) Construction").
//   CONSTRUCTION_JES   The journals that carry it in the ledger: a termin
//                      moves the withheld PPh from other receivables to
//                      Prepaid Tax — PPh 4(2) Final (1-5510); each month the
//                      PPh on recognised revenue is expensed out of it to
//                      Final Tax (8-1300). 1-5510's balance is the net
//                      prepaid / (accrued) the construction view ties to.
//   seededTaxDocNo     A deterministic faktur / bukti potong number for older
//                      documents, so the register has a realistic mix of
//                      closed and outstanding lines (the bill and invoice seed
//                      carry none).

import { COA } from "./coa";
import { JOURNAL_ENTRIES } from "./journalEntries";
import { PAYMENT_HISTORY_JES } from "./paymentHistory";
import { LEDGER_BACKFILL_JES } from "./ledgerBackfill";
import { NON_BANK_JES } from "./nonBankAccounts";
import { ADJUSTING_JES } from "./adjustingEntries";
import { EQUITY_JES } from "./equityEntries";

export const PREPAID_PPH42 = "1-5510";
export const FINAL_TAX_EXPENSE = "8-1300";

// ── PPh 4(2) withheld by customers on rent ────────────────────────────────
// One invoice per customer per month; a bukti potong number once the
// customer sends it (the latest months are still outstanding).
const RENT = [
  { customer: "C001", object: "Sewa gudang Bekasi — Blok B", monthly: 45_000_000, bupot: { "2025-01": "2501044120", "2025-02": "2502051877", "2025-03": "2503060412" } },
  { customer: "C003", object: "Sewa gudang Bandung — unit 3", monthly: 18_000_000, bupot: { "2025-01": "2501090233", "2025-02": "2502099118" } },
];
export const CUSTOMER_RENT = RENT.flatMap((r, ri) => ["2025-01", "2025-02", "2025-03", "2025-04"].map((ym, i) => ({
  id: `RENT-${r.customer}-${ym}`,
  ym,
  date: `${ym}-05`,
  customer: r.customer,
  invNo: `INV/RENT/${ym.replace("-", "")}${String(ri + 1).padStart(2, "0")}`,
  object: r.object,
  dpp: r.monthly,
  rate: 10,
  bupotNo: r.bupot[ym] || "",
  bupotDate: r.bupot[ym] ? `${ym}-${String(18 + i).padStart(2, "0")}` : "",
})));

// ── PPh 4(2) on construction ──────────────────────────────────────────────
// Each month: the termin invoiced and paid net of PPh (if any), its bukti
// potong number (if received), and the revenue recognised by progress.
export const CONSTRUCTION = [
  {
    id: "PRJ-01", name: "Fit-out Kantor Ritel Utama — Sudirman", customer: "C001", contract: 1_800_000_000, rate: 2.65,
    months: [
      { ym: "2025-01", termin: { invNo: "INV/2025010031", label: "DP 20%", amount: 360_000_000, bupotNo: "2501077301" }, revenue: 150_000_000 },
      { ym: "2025-02", termin: null, revenue: 320_000_000 },
      { ym: "2025-03", termin: { invNo: "INV/2025030044", label: "Termin 1", amount: 540_000_000, bupotNo: "2503081290" }, revenue: 410_000_000 },
      { ym: "2025-04", termin: { invNo: "INV/2025040019", label: "Termin 2", amount: 450_000_000, bupotNo: "" }, revenue: 260_000_000 },
    ],
  },
  {
    id: "PRJ-02", name: "Showroom Toko Modern — Cihampelas", customer: "C003", contract: 950_000_000, rate: 2.65,
    months: [
      { ym: "2025-02", termin: { invNo: "INV/2025020052", label: "DP 10%", amount: 95_000_000, bupotNo: "2502100455" }, revenue: 120_000_000 },
      { ym: "2025-03", termin: null, revenue: 260_000_000 },
      { ym: "2025-04", termin: { invNo: "INV/2025040027", label: "Termin 1", amount: 285_000_000, bupotNo: "" }, revenue: 180_000_000 },
    ],
  },
];
export const pphOn = (amount, rate) => Math.round(amount * rate / 100);
const monthEndOf = (ym) => { const [y, m] = ym.split("-").map(Number); return `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`; };

const nameOf = (code) => COA.find((a) => a.code === code)?.name || code;
let seq = Math.max(
  ...[...JOURNAL_ENTRIES, ...PAYMENT_HISTORY_JES, ...LEDGER_BACKFILL_JES, ...NON_BANK_JES, ...ADJUSTING_JES, ...EQUITY_JES]
    .map((j) => /^JE-2025-(\d+)$/.exec(j.je_number || "")?.[1]).filter(Boolean).map(Number),
);
const je = (date, memo, reference, lines) => {
  seq += 1;
  return {
    je_number: `JE-2025-${String(seq).padStart(4, "0")}`, je_date: date, status: "posted", memo, reference,
    reference_type: "manual", reference_id: null,
    created_by: "Rina Kusuma", created_date: date, posted_by: "Hana Wijoyo", posted_date: date,
    lines: lines.map(([code, debit, credit, description]) => ({ account_code: code, account_name: nameOf(code), debit, credit, description: description || memo })),
  };
};
export const CONSTRUCTION_JES = CONSTRUCTION.flatMap((p) => p.months.flatMap((m) => {
  const out = [];
  if (m.termin) {
    const w = pphOn(m.termin.amount, p.rate);
    out.push(je(`${m.ym}-20`, `PPh 4(2) final withheld by customer — ${p.name}, ${m.termin.label}`, m.termin.invNo, [
      [PREPAID_PPH42, w, 0, `PPh 4(2) ${p.rate}% on ${m.termin.label}`],
      ["1-2300", 0, w, "Withheld from the termin receipt"],
    ]));
  }
  const e = pphOn(m.revenue, p.rate);
  if (e) {
    out.push(je(monthEndOf(m.ym), `PPh 4(2) final on revenue recognised — ${p.name}`, p.id, [
      [FINAL_TAX_EXPENSE, e, 0, `PPh 4(2) ${p.rate}% on progress revenue`],
      [PREPAID_PPH42, 0, e, "Expensed from prepaid PPh 4(2)"],
    ]));
  }
  return out;
}));

// ── Faktur / bukti potong numbers on older documents ─────────────────────
// Deterministic: a document dated before April 2025 has its number about
// four times in five; April's mostly haven't arrived yet.
const hash = (s) => { let h = 2166136261; for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return Math.abs(h); };
export function seededTaxDocNo(row) {
  // Customer-withheld PPh carries its own numbers (or none yet) in the seed.
  if ((row.source === "Journal" && !row.type.startsWith("ppn")) || !row.docDate || row.type === "pph42_cust") return "";
  const h = hash(row.id);
  const recent = row.docDate >= "2025-04-01";
  if (h % 10 >= (recent ? 2 : 8)) return "";
  if (row.type.startsWith("ppn")) return `04002500${String(h % 100000000).padStart(8, "0")}`; // e-Faktur no.
  return `25${String(h % 100000000).padStart(8, "0")}`; // bukti potong no.
}
