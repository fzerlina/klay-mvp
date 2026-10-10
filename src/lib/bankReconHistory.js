// Past months as they were left: every line on an earlier statement was
// reconciled when that month was worked, so the demo opens them that way.
//
// These are ordinary decisions, seeded into BankReconContext exactly as if a
// person had made them in early the following month. Nothing is locked — a
// past line can be undone and reconciled again like any other.

import { COMPANY_BANK_ACCOUNTS } from "../data/seed/bankAccounts";
import { CURRENT_PERIOD, shiftPeriod } from "../data/seed/bankStatement";
import { runReconciliation, reconcilable } from "./bankRecon";
import { addBusinessDays } from "./clock";

// How far back the history goes. The demo ledger starts in January with no
// opening balances behind it, so February is the first month with a statement.
export const HISTORY_MONTHS = 2;
export const PERIODS = Array.from({ length: HISTORY_MONTHS + 1 }, (_, i) => shiftPeriod(CURRENT_PERIOD, -i));

const BY = "Rina Kusuma";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const d = (iso) => `${parseInt(iso.slice(8, 10), 10)} ${MONTHS[parseInt(iso.slice(5, 7), 10) - 1]} ${iso.slice(0, 4)}`;

// What was decided about one line, dated a few business days into the next month.
function decisionFor(ex, period) {
  const at = addBusinessDays(`${shiftPeriod(period, 1)}-01`, 2);
  const on = `by ${BY} on ${d(at)}`;
  const s = ex.suggestion;
  if (s?.kind === "record") {
    return { action: "reconcile", at, by: BY, recordIds: [s.recordId], journals: [s.ref], note: `Matched to ${s.ref}${s.billId && s.billId !== s.ref ? ` (${s.billId})` : ""} ${on}.` };
  }
  if (ex.detector === "FEE_PATTERN" || ex.detector === "INTEREST_CREDIT" || ex.detector === "INTEREST_TAX") {
    const kind = ex.detector === "FEE_PATTERN" ? "Bank fee" : ex.detector === "INTEREST_TAX" ? "Tax on interest" : "Interest";
    return { action: "post-journal", at, by: BY, note: `${kind} journal posted ${on}.` };
  }
  // Anything the engine had no record for — today's open invoices are not
  // last month's — was settled by hand at the time.
  return { action: "manual-match", at, by: BY, recordIds: [], journals: [], note: `Matched manually ${on}.` };
}

export function historicalResolutions() {
  const out = {};
  for (const period of PERIODS.slice(1)) {
    for (const account of COMPANY_BANK_ACCOUNTS) {
      if (!reconcilable(account)) continue;
      const run = runReconciliation(account.id, { period });
      for (const ex of run?.exceptions || []) out[ex.id] = decisionFor(ex, period);
    }
  }
  return out;
}
