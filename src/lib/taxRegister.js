// Tax Register — the numbers behind Reports → Tax Register.
//
// One row per tax line per document for a masa pajak (tax month): the monthly
// recap GKB builds by hand today ("per vendor, per invoice, with tax amounts").
// Built from three sources:
//
//   Bills / invoices  PPN Masukan / PPN Keluaran, one row per document and
//                     rate. Dated by the posting date — the day the tax
//                     reached the ledger (the document date when not posted).
//   Payments          PPh withheld, one row per payment. PPh is recognised at
//                     payment in Klay, not when the bill posts (see
//                     billJournalPreview.js and paymentJournal.js), so these
//                     rows are dated by the payment and read the amount from
//                     the payment's journal line on 2-2300.
//   Journals          Posted manual journals that touch a tax account with no
//                     bill, invoice or payment behind them (cash sales, payroll
//                     PPh 21). They carry no counterparty, DPP or rate, but
//                     they are in the ledger, so the register lists them —
//                     otherwise the totals would miss tax the books hold.
//
//   buildTaxRegister  Every row for a masa, before the page's filters.
//   TAX_REGISTER_COLUMNS  The column list the table and the CSV both read, so
//                     a column GKB asks for is one entry here.

import { TAX_CODES } from "../data/seed/taxCodes";
import { COA_BY_CODE } from "../data/seed/coa";
import { normalizePph } from "../data/labels";
import { billPostedOn } from "./apAging";

const r2 = (v) => Math.round(v * 100) / 100;
const pad = (n) => String(n).padStart(2, "0");
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

// "2025-03" → { from: "2025-03-01", to: "2025-03-31" }
export function masaRange(ym) {
  const [y, m] = ym.split("-").map(Number);
  return { from: `${ym}-01`, to: `${ym}-${pad(lastDay(y, m))}` };
}
// "2025-03" → "03/2025", the way a masa is written on SPT and e-Bupot.
export const masaLabel = (ym) => `${ym.slice(5, 7)}/${ym.slice(0, 4)}`;

// ── Tax types ───────────────────────────────────────────────────────────────
// What the register can list. Rates and accounts come from Settings → Tax
// (seed/taxCodes.js) where a code exists; PPh 0.5% Final and PPh 26 have no
// code there yet, so their defaults are written here and flagged.
const codeOf = (code) => TAX_CODES.find((c) => c.code === code) || null;
const fromCode = (code, extra) => {
  const c = codeOf(code);
  return { key: code, rate: c?.rate ?? null, nonNpwpRate: c?.nonNpwpRate ?? null, account: c?.account ?? null, inSettings: Boolean(c), ...extra };
};

export const TAX_TYPES = [
  fromCode("ppn_masukan", { label: "PPN Masukan", side: "purchases" }),
  fromCode("ppn_keluaran", { label: "PPN Keluaran", side: "sales" }),
  fromCode("pph23", { label: "PPh 23", side: "purchases" }),
  fromCode("pph42", { label: "PPh 4(2)", side: "purchases" }),
  { key: "pph05_final", label: "PPh Final 0.5%", side: "purchases", rate: 0.5, nonNpwpRate: null, account: "2-2300", inSettings: false },
  { key: "pph26", label: "PPh 26", side: "purchases", rate: 20, nonNpwpRate: null, account: "2-2300", inSettings: false },
  fromCode("pph21", { label: "PPh 21", side: "purchases" }),
];
export const TAX_TYPE_BY_KEY = Object.fromEntries(TAX_TYPES.map((t) => [t.key, t]));

// The GL accounts tax books to: PPN Masukan, PPN Keluaran, and every PPh.
const TAX_ACCOUNT_CODES = new Set(["1-5100", "2-2100", "2-2300"]);
// Movement on the account's normal side: input VAT is an asset, the rest are owed.
const oriented = (code, debit, credit) => (COA_BY_CODE[code]?.normal_balance === "debit" ? debit - credit : credit - debit);

// A vendor's withholding type, normalised to the keys above. A vendor set to
// "none" whose bill still withheld is read as PPh 23, the only PPh the seed's
// bills carry.
function withholdingTypeOf(vendor) {
  const key = normalizePph(vendor?.pph);
  return TAX_TYPE_BY_KEY[key] ? key : "pph23";
}

// A manual journal's line on 2-2300 says which PPh in its description, if at all.
function withholdingTypeFromText(text = "") {
  if (/\b21\b/.test(text)) return "pph21";
  if (/4\s*\(2\)|\b42\b/.test(text)) return "pph42";
  if (/\b26\b/.test(text)) return "pph26";
  if (/0[.,]5|final/i.test(text)) return "pph05_final";
  if (/\b23\b/.test(text)) return "pph23";
  return null;
}

const npwpOf = (s) => (s && String(s).trim()) || "";
const docNo = (no, id) => (no && no !== "—" ? no : id);

// Split a document's tax by rate: a bill with every line at 11% is one row; a
// bill mixing 11% and 12% is two. Falls back to the document's own total and
// rate when its lines carry no per-line tax.
function ppnByRate(doc) {
  const byRate = new Map();
  for (const it of doc.items || []) {
    if (!it.ppn) continue;
    const rate = it.ppnRate != null ? r2(it.ppnRate * 100) : null;
    const cur = byRate.get(rate) || { rate, dpp: 0, tax: 0 };
    cur.dpp += it.subtotal || 0;
    cur.tax += it.ppn;
    byRate.set(rate, cur);
  }
  if (byRate.size) return [...byRate.values()];
  return [{ rate: doc.ppnRate != null ? r2(doc.ppnRate * 100) : null, dpp: doc.dpp || 0, tax: doc.ppn }];
}

// ── Build ───────────────────────────────────────────────────────────────────
//
// ym: "YYYY-MM". Returns every row whose tax date falls in the masa, posted or
// not — the page filters. Each row:
//   { id, masa, type, source, docNo, ref, jeNumber, docDate, postingDate,
//     party, partyId, partyKind, npwp, taxDocNo, dpp, rate, tax, account,
//     posted }
export function buildTaxRegister({ ym, bills = [], invoices = [], vendors = [], customers = [], entries = [] }) {
  const { from, to } = masaRange(ym);
  const inMasa = (d) => d && d >= from && d <= to;
  const vendorById = new Map(vendors.map((v) => [v.id, v]));
  const customerById = new Map(customers.map((c) => [c.id, c]));
  const jeByNumber = new Map(entries.map((je) => [je.je_number, je]));
  const billById = new Map(bills.map((b) => [b.id, b]));
  const rows = [];

  const push = (row) => {
    rows.push({
      masa: ym,
      account: TAX_TYPE_BY_KEY[row.type]?.account || null,
      taxDocNo: "",
      ...row,
      tax: r2(row.tax),
      dpp: row.dpp == null ? null : r2(row.dpp),
    });
  };

  // 1. PPN Masukan on bills, dated by the posting entry.
  for (const bill of bills) {
    if (!(bill.ppn > 0)) continue;
    const je = bill.je_number ? jeByNumber.get(bill.je_number) : null;
    const posted = je ? je.status === "posted" : Boolean(bill.je_number);
    const postingDate = je?.je_date || (bill.je_number ? billPostedOn(bill) : null);
    const taxDate = postingDate || bill.date;
    if (!inMasa(taxDate)) continue;
    const vendor = vendorById.get(bill.vendor);
    ppnByRate(bill).forEach((p, i) => push({
      id: `${bill.id}:ppn:${i}`,
      type: "ppn_masukan",
      source: "Bill",
      docNo: docNo(bill.invNo, bill.id),
      ref: bill.id,
      link: `/bills/${bill.id}`,
      jeNumber: bill.je_number || "",
      docDate: bill.date,
      postingDate,
      party: bill.vendorName || vendor?.name || "",
      partyId: bill.vendor,
      partyKind: "vendor",
      npwp: npwpOf(vendor?.tax_id),
      taxDocNo: bill.fakturNo || "",
      dpp: p.dpp,
      rate: p.rate,
      tax: p.tax,
      posted,
    }));
  }

  // 2. PPN Keluaran on invoices. An invoice is issued (and posts) once it
  //    leaves draft — the same rule ledgerBackfill.js uses.
  for (const inv of invoices) {
    if (!(inv.ppn > 0)) continue;
    const posted = inv.approval !== "draft";
    if (!inMasa(inv.date)) continue;
    const customer = customerById.get(inv.customer);
    ppnByRate(inv).forEach((p, i) => push({
      id: `${inv.id}:ppn:${i}`,
      type: "ppn_keluaran",
      source: "Invoice",
      docNo: docNo(inv.invNo, inv.id),
      ref: inv.id,
      link: `/invoices`,
      jeNumber: "",
      docDate: inv.date,
      postingDate: posted ? inv.date : null,
      party: inv.customerName || customer?.name || "",
      partyId: inv.customer,
      partyKind: "customer",
      npwp: npwpOf(customer?.npwp),
      taxDocNo: inv.fakturNo || "",
      dpp: p.dpp,
      rate: p.rate,
      tax: p.tax,
      posted,
    }));
  }

  // 3. Ledger lines on the tax accounts: PPh withheld on payments, and manual
  //    journals with no document behind them. Bill and invoice postings are
  //    covered above, from the document.
  for (const je of entries) {
    if (je.status === "void" || !inMasa(je.je_date)) continue;
    if (je.reference_type === "ap_bill" || je.reference_type === "bill" || je.reference_type === "invoice") continue;
    const posted = je.status === "posted";
    const isPayment = je.reference_type === "bill_payment" || je.reference_type === "payment";

    (je.lines || []).forEach((line, i) => {
      if (!TAX_ACCOUNT_CODES.has(line.account_code)) return;
      const amount = oriented(line.account_code, line.debit || 0, line.credit || 0);
      if (Math.abs(amount) < 0.005) return;

      if (isPayment && line.account_code === "2-2300") {
        const bill = billById.get(je.reference_id);
        const vendor = bill ? vendorById.get(bill.vendor) : null;
        const type = withholdingTypeOf(vendor);
        const rate = bill?.pphRate ? r2(bill.pphRate * 100) : null;
        // The whole withholding in one payment carries the bill's own base;
        // a part payment's base is what that part withheld at the bill's rate.
        const full = bill && Math.abs(amount - (bill.pph23 || 0)) < 1;
        const dpp = full ? (bill.pphBase ?? bill.dpp) : rate ? amount / (rate / 100) : null;
        const payee = bill?.vendorName || (/^Payment — (.+?)(?: · |$)/.exec(je.memo || "")?.[1] ?? "");
        push({
          id: `${je.je_number}:${i}`,
          type,
          source: "Payment",
          docNo: bill ? docNo(bill.invNo, bill.id) : je.reference_id || je.je_number,
          ref: bill?.id || je.reference_id || "",
          link: bill ? `/bills/${bill.id}` : null,
          jeNumber: je.je_number,
          docDate: bill?.date || je.je_date,
          postingDate: je.je_date,
          party: payee,
          partyId: bill?.vendor || null,
          partyKind: "vendor",
          npwp: npwpOf(vendor?.tax_id),
          taxDocNo: line.buktiPotongNo || je.buktiPotongNo || "",
          dpp,
          rate,
          tax: amount,
          posted,
        });
        return;
      }

      // A manual journal (or any other entry on a tax account without a
      // document). The account decides PPN in or out; for 2-2300 the line's
      // description names the PPh when it can.
      const type = line.account_code === "1-5100" ? "ppn_masukan"
        : line.account_code === "2-2100" ? "ppn_keluaran"
        : withholdingTypeFromText(`${line.description || ""} ${je.memo || ""}`) || "pph23";
      push({
        id: `${je.je_number}:${i}`,
        type,
        source: "Journal",
        docNo: je.je_number,
        ref: je.je_number,
        link: null,
        jeNumber: je.je_number,
        docDate: je.je_date,
        postingDate: posted ? je.je_date : null,
        party: "",
        partyId: null,
        partyKind: null,
        npwp: "",
        memo: je.memo || "",
        dpp: null,
        rate: null,
        tax: amount,
        posted,
      });
    });
  }

  const order = Object.fromEntries(TAX_TYPES.map((t, i) => [t.key, i]));
  return rows.sort((a, b) =>
    order[a.type] - order[b.type]
    || (a.postingDate || a.docDate).localeCompare(b.postingDate || b.docDate)
    || a.docNo.localeCompare(b.docNo));
}

// Totals per tax type over the given rows, in TAX_TYPES order; types with no
// rows are left out.
export function totalsByType(rows) {
  const by = {};
  for (const r of rows) {
    const t = (by[r.type] ||= { type: r.type, count: 0, dpp: 0, tax: 0, noDpp: 0 });
    t.count += 1;
    t.tax += r.tax;
    if (r.dpp == null) t.noDpp += 1;
    else t.dpp += r.dpp;
  }
  return TAX_TYPES.filter((t) => by[t.key]).map((t) => ({ ...by[t.key], dpp: r2(by[t.key].dpp), tax: r2(by[t.key].tax) }));
}

// ── Columns ─────────────────────────────────────────────────────────────────
// One list for the screen table and the Excel export. `value` is what the CSV
// writes (numbers stay numbers); the page renders its own cell for the keys it
// styles and falls back to `value` for the rest. `screen: false` keeps a
// column in the export only. GKB has not sent its recap format yet — when it
// does, the columns change here.
const dateCsv = (d) => d || "";
export const TAX_REGISTER_COLUMNS = [
  // The same on every row on screen (the picker says it), so export only.
  { key: "masa", label: "Masa", value: (r) => masaLabel(r.masa), screen: false },
  { key: "type", label: "Tax type", value: (r) => TAX_TYPE_BY_KEY[r.type]?.label || r.type },
  { key: "source", label: "Source", value: (r) => r.source, screen: false },
  { key: "docNo", label: "Document no.", value: (r) => r.docNo },
  { key: "ref", label: "Klay ref", value: (r) => r.ref, screen: false },
  { key: "docDate", label: "Document date", value: (r) => dateCsv(r.docDate) },
  { key: "postingDate", label: "Posting date", value: (r) => dateCsv(r.postingDate) },
  { key: "party", label: "Vendor / customer", value: (r) => r.party || (r.source === "Journal" ? r.memo : "") },
  { key: "npwp", label: "NPWP / NITKU", value: (r) => r.npwp },
  { key: "taxDocNo", label: "Faktur / bukti potong no.", value: (r) => r.taxDocNo },
  { key: "dpp", label: "DPP (Rp)", value: (r) => r.dpp, num: true },
  { key: "rate", label: "Rate (%)", value: (r) => r.rate, num: true },
  { key: "tax", label: "Tax (Rp)", value: (r) => r.tax, num: true },
  { key: "account", label: "GL account", value: (r) => r.account || "" },
  { key: "jeNumber", label: "Journal", value: (r) => r.jeNumber, screen: false },
];
