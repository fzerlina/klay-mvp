// Tax codes — Settings → Accounting → Tax.
//
// Modelled on DualEntry's Tax Setup: a code carries its rate, what it applies
// to, the GL account it books to, and the dates it is valid for, so a rate
// change (e.g. PPN) is a new dated row rather than an edit to history. Keys
// match the codes already used on items (DEFTAX_LABELS) and vendors
// (WITHHOLDING / PPH_LABELS in data/labels.js). Accounts are from seed/coa.js.
//
// kind:     "vat" (PPN) | "withholding" (PPh)
// appliesTo: "sales" | "purchases" | "both"
// rate:     percent; null = set per transaction (PPh 21)
// nonNpwpRate: withholding rate when the counterparty has no NPWP
export const TAX_CODES = [
  {
    code: "ppn_keluaran", name: "PPN Keluaran (Output VAT)", kind: "vat", appliesTo: "sales",
    rate: 11, account: "2-2100", validFrom: "2022-04-01", validTo: null,
    note: "12% on DPP nilai lain (11/12 of price) since 1 Jan 2025 — an effective 11% on non-luxury goods.",
  },
  {
    code: "ppn_masukan", name: "PPN Masukan (Input VAT)", kind: "vat", appliesTo: "purchases",
    rate: 11, account: "1-5100", validFrom: "2022-04-01", validTo: null,
    note: "Creditable against output VAT when the supplier's e-Faktur is valid.",
  },
  {
    code: "bebas", name: "VAT exempt", kind: "vat", appliesTo: "both",
    rate: 0, account: null, validFrom: "2022-04-01", validTo: null,
    note: "Goods and services outside PPN, or supplied by a non-PKP vendor.",
  },
  {
    code: "pph23", name: "PPh 23", kind: "withholding", appliesTo: "purchases",
    rate: 2, nonNpwpRate: 4, account: "2-2300", validFrom: "2009-01-01", validTo: null,
    note: "Withheld from payments for services, rent of movable assets and royalties.",
  },
  {
    code: "pph42", name: "PPh 4(2) — final", kind: "withholding", appliesTo: "purchases",
    rate: 10, nonNpwpRate: 20, account: "2-2300", validFrom: "2017-01-01", validTo: null,
    note: "Final withholding, e.g. land and building rent.",
  },
  {
    code: "pph21", name: "PPh 21", kind: "withholding", appliesTo: "purchases",
    rate: null, account: "2-2300", validFrom: "2024-01-01", validTo: null,
    note: "Withheld when paying individuals; the rate is set on each bill (TER).",
  },
];

export const TAX_KIND_LABELS = { vat: "VAT (PPN)", withholding: "Withholding (PPh)" };
export const APPLIES_LABELS = { sales: "Sales", purchases: "Purchases", both: "Sales & purchases" };
