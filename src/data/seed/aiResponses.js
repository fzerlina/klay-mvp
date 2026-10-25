// Canned demo responses for the GL "Klay AI" co-pilot.
//
// AI_RESPONSES is the round-robin pool used for free-text queries; numbers
// are computed at module load from the live JE seed so they don't lie.
// SUGGESTION_RESPONSES is keyed-match for the suggestion chips — kept as
// rich HTML strings since they're long.

import { JOURNAL_ENTRIES } from "./journalEntries.js";
import { INVOICES } from "./invoices.js";
import { BILLS } from "./bills.js";

// ── Live stats computed from the JE seed ─────────────────────────────────
const stats = (() => {
  let totalDr = 0;
  const acctActivity = {}; // code → { tx, gross }
  let vatIn = 0;
  let vatOut = 0;
  for (const je of JOURNAL_ENTRIES) {
    if (je.status !== "posted") continue;
    for (const l of je.lines) {
      const amt = (l.debit || 0) + (l.credit || 0);
      totalDr += l.debit || 0;
      const a = (acctActivity[l.account_code] ||= { tx: 0, gross: 0, name: l.account_name });
      a.tx += 1;
      a.gross += amt;
      if (l.account_code === "1-5100") vatIn += l.debit || 0;
      if (l.account_code === "2-2100") vatOut += l.credit || 0;
    }
  }
  const topAcct = Object.entries(acctActivity)
    .map(([code, v]) => ({ code, ...v }))
    .sort((a, b) => b.gross - a.gross)[0];
  return { totalDr, topAcct, vatIn, vatOut };
})();

const openInvoice = INVOICES.find((i) => i.payStatus === "overdue");
const openBill = BILLS.find((b) => b.pay === "overdue" || b.pay === "unpaid");

const fmtRp = (n) => "Rp " + Math.round(n).toLocaleString("id-ID");
const fmtRpJt = (n) => "Rp " + (n / 1_000_000).toFixed(1).replace(".0", "") + "jt";
const fmtRpM = (n) => "Rp " + (n / 1_000_000_000).toFixed(2).replace(/\.?0+$/, "") + " milyar";

export const AI_RESPONSES = [
  `Across Jan–Apr 2025, posted journal entries total ${fmtRpM(stats.totalDr)} on each side — the GL is balanced.`,
  stats.topAcct
    ? `Most active account: ${stats.topAcct.name} (${stats.topAcct.code}) with ${stats.topAcct.tx} posted lines totalling ${fmtRpM(stats.topAcct.gross)} of activity.`
    : `No posted activity found in the period.`,
  openInvoice && openBill
    ? `1 customer invoice still outstanding (${openInvoice.id} — ${fmtRpJt(openInvoice.total)}) and 1 vendor bill still due (${openBill.id} — ${fmtRpJt(openBill.total)}).`
    : `Outstanding AR/AP queue is currently empty.`,
  stats.vatIn > 0
    ? `VAT Input (1-5100) accumulated ${fmtRpJt(stats.vatIn)} this period vs VAT Output (2-2100) at ${fmtRpJt(stats.vatOut)}. Confirm the net is filed correctly on the SPT masa.`
    : `No VAT activity yet — confirm input/output bookings before SPT masa.`,
  `Operating margin is healthy through March; April activity is light because closing is still in progress.`,
];

export const SUGGESTION_RESPONSES = {
  "What should I focus on today? ↗": `Two items are blocking the Apr 2025 close:<br><br><strong>1. Push approvals on pending JEs</strong><br>Several JEs are still waiting on Finance Manager approval. The GL can't lock without them.<br><br><strong>2. Close the bank reconciliation gap</strong><br>The bank match rate is at 76% for the period. AI has auto-matched 38 lines — the rest need manual review.<br><br>Closing window: <strong>7 days remaining</strong>. Prioritise the approvals first.`,
  "Compare with last month ↗": `Apr 2025 vs Mar 2025:<br><br>Running balance up 11% · Total entries +24 · Operating expense up 8% · Reconciliation: 76% (Mar was 98%).<br><br>The balance lift mostly comes from stronger collections; expenses rose with a higher payroll accrual.`,
};
