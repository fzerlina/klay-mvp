// What a bank line is, as far as Klay can tell — separate from which way the
// cash moved (lib/manualMatch.js, DIRECTIONS).
//
//   AP     settles a bill or a vendor — a recorded payment, a journal against
//          trade payables, a bill paid outside Klay
//   AR     settles an invoice or a customer
//   Bank   the bank's own charges and interest
//   Other  anything else Klay can name: payroll, a direct expense, a transfer
//
// It is read off the Klay side, so a line nothing has been suggested or
// matched for has no category yet — the bank text alone does not say.

export const CATEGORIES = {
  ap:    { k: "ap",    lbl: "AP",    title: "Accounts payable — settles a bill or a vendor" },
  ar:    { k: "ar",    lbl: "AR",    title: "Accounts receivable — settles an invoice or a customer" },
  bank:  { k: "bank",  lbl: "Bank",  title: "The bank's own fees and interest" },
  other: { k: "other", lbl: "Other", title: "Payroll, a direct expense, a transfer — not AP or AR" },
};

// The Klay-side filter: every category, plus All.
export const CATEGORY_FILTERS = [{ k: "all", lbl: "All" }, ...Object.values(CATEGORIES)];

const AP_PREFIX = "2-1"; // trade payables
const AR_PREFIX = "1-2"; // trade and other receivables
// Bank charges and interest income, under both code schemes in the CoA.
const BANK_CODES = new Set(["6-3000", "72050", "4-2100", "71010"]);

export function categoryOfRecord(r) {
  if (!r) return null;
  if (r.kind === "ap_payment") return "ap";
  if (r.kind === "invoice") return "ar";
  const contra = r.contraCodes || [];
  if (contra.some((c) => c.startsWith(AP_PREFIX))) return "ap";
  if (contra.some((c) => c.startsWith(AR_PREFIX))) return "ar";
  if (contra.length && contra.every((c) => BANK_CODES.has(c))) return "bank";
  return "other";
}

// A statement line's category from what it was matched to, or else from what
// Klay suggests for it. `recordById` maps the run's book records.
export function categoryOfLine(ex, recordById = {}) {
  const r = ex.resolution;
  if (r?.action === "exclude") return null;
  if (r?.action === "post-journal") return "bank";
  if (r?.invoiceIds?.length) return "ar";
  if (r?.recordIds?.length) return categoryOfRecord(recordById[r.recordIds[0]]);
  switch (ex.detector) {
    case "FEE_PATTERN":
    case "INTEREST_CREDIT":
    case "INTEREST_TAX": return "bank";
    case "INVOICE_EXACT":
    case "INVOICE_RANGE": return "ar";
    case "PPH_WITHHOLDING":
    case "DUPLICATE_PAYMENT": return "ap";
    case "EXACT_AMOUNT": return categoryOfRecord(recordById[ex.suggestion?.recordId]);
    default: return null;
  }
}
