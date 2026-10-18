// AR Aging derivation layer — the receivables mirror of apAging.js.
//
// Reads ar_invoices + customers. Where AP aging tracks money we OWE (payables,
// bucketed by how overdue the bill is), AR aging tracks money we're OWED
// (receivables, bucketed by how overdue the invoice is). It reuses the same age
// buckets so the two tables read identically side-by-side in the Cashflow
// Report. There are no accruals or payment-lifecycle stages on the AR side —
// an outstanding receivable is simply a non-draft invoice not yet settled.

import { INVOICES } from "../data/seed/invoices";
import { CUSTOMERS } from "../data/seed/customers";
import { TODAY, daysSince } from "./clock";
import { AGE_BUCKETS, ageBucketOf, asOfIso } from "./apAging";

export { AGE_BUCKETS };

// ── Payment facts, placed in time ─────────────────────────────────────────
// When an invoice was settled: the last receipt reconciled against it, or
// failing that the last "paid" entry in its audit trail (every seeded paid
// invoice carries one). null = no date known.
function paidDateOf(inv) {
  const receipts = inv.receipts || [];
  if (receipts.length) return receipts.reduce((d, r) => (r.date > d ? r.date : d), "");
  const paid = (inv.audit || []).filter((a) => a.type === "paid" && a.date);
  return paid.length ? paid[paid.length - 1].date : null;
}

// The date a paid invoice's receipt is booked — what the aging and the ledger
// backfill (seed/ledgerBackfill.js) both use, so the AR aging total ties to
// Accounts Receivable — Trade. Held between the invoice date and today:
// nothing is received before it is invoiced, or in the future.
export function invoicePaidOn(inv) {
  if (inv.payStatus !== "paid") return null;
  const t = asOfIso(TODAY);
  const d = paidDateOf(inv) || inv.due || inv.date;
  const capped = d > t ? t : d;
  return inv.date && capped < inv.date ? inv.date : capped;
}

// Receipts on the books by the as-of date (InvoicesContext.recordReceipt adds
// them when a customer payment is reconciled on a bank statement).
const receivedBy = (inv, asOf) =>
  (inv.receipts || []).filter((r) => !r.date || r.date <= asOf).reduce((s, r) => s + (r.amount || 0), 0);

// ── Aging line — one row per outstanding invoice ──────────────────────────
// A receivable is "outstanding" on the as-of date when it's a real (non-draft)
// invoice dated on or before that date and not yet settled by it. Drafts
// aren't receivables yet; settled invoices drop off the report.
//
// Rebuilding a past date: an invoice paid AFTER the as-of date (invoicePaidOn)
// was still open then. A part-paid invoice owes its total less the
// receipts dated on or before the as-of date. Receipts are recorded net of any
// PPh 23 the customer withheld, so a part-paid balance can overstate what's
// actually still to come by that withholding — the invoice doesn't say.
export function isArAgingRow(inv, asOf = asOfIso(TODAY)) {
  if (!inv) return false;
  if (inv.approval === "draft") return false;
  if ((inv.total || 0) <= 0) return false;
  if (inv.date && inv.date > asOf) return false;
  if (inv.payStatus === "paid" && invoicePaidOn(inv) <= asOf) return false;
  return true;
}

export function buildArAgingLines(asOfDate = TODAY, invoices = INVOICES) {
  const asOf = asOfIso(asOfDate);
  return invoices.filter((inv) => isArAgingRow(inv, asOf)).map((inv) => {
    const c = CUSTOMERS.find((x) => x.id === inv.customer) || null;
    const daysOverdue = daysSince(inv.due, asOf);
    const ageBucket = ageBucketOf(daysOverdue);
    // The total less what had been received by the date — for an invoice
    // settled later, that's usually the whole total.
    const settledLater = inv.payStatus === "paid";
    const remaining = Math.max(0, (inv.total || 0) - receivedBy(inv, asOf));
    return {
      id: inv.id,
      customerId: inv.customer,
      customerName: inv.customerName || c?.name || inv.customer,
      customerCode: inv.custCode || c?.code || "",
      invNo: inv.invNo === "—" || !inv.invNo ? inv.id : inv.invNo,
      invoiceDate: inv.date,
      dueDate: inv.due,
      payStatus: settledLater ? "unpaid" : inv.payStatus,
      total: inv.total || 0,
      remaining,
      partial: remaining < (inv.total || 0),
      daysOverdue,
      ageBucket,
      ageDays: Math.max(0, daysSince(inv.date, asOf)),
      raw: inv,
      customerRaw: c,
    };
  });
}

// ── Customer pivot — for the AR Aging Table ───────────────────────────────
// Groups outstanding invoices by customer, with per-bucket totals and an
// expandable invoice list. Sorted by total exposure desc (largest first).
export function buildCustomerPivot(lines) {
  const byCustomer = new Map();
  for (const l of lines) {
    if (l.remaining <= 0) continue;
    if (!byCustomer.has(l.customerId)) {
      byCustomer.set(l.customerId, {
        customerId: l.customerId,
        customerName: l.customerName,
        customerCode: l.customerCode,
        buckets: { current: 0, b1_30: 0, b31_60: 0, b61_90: 0, b91_120: 0, b_gt120: 0 },
        total: 0,
        invoices: [],
      });
    }
    const row = byCustomer.get(l.customerId);
    row.buckets[l.ageBucket] += l.remaining;
    row.total += l.remaining;
    row.invoices.push(l);
  }
  return Array.from(byCustomer.values()).sort((a, b) => b.total - a.total);
}

// ── Snapshot — feeds the summary bar + the combined Aging Insights tab ─────
export function buildArSnapshot(lines, asOfDate = TODAY) {
  let arOutstanding = 0;
  let overdue = 0;
  let dueIn7Days = 0;
  const bucketTotals = { current: 0, b1_30: 0, b31_60: 0, b61_90: 0, b91_120: 0, b_gt120: 0 };

  for (const l of lines) {
    if (l.remaining <= 0) continue;
    arOutstanding += l.remaining;
    bucketTotals[l.ageBucket] += l.remaining;
    if (l.daysOverdue > 0) overdue += l.remaining;
    const dueDays = -daysSince(l.dueDate, asOfDate); // positive = future
    if (dueDays >= 0 && dueDays <= 7) dueIn7Days += l.remaining;
  }

  // Remaining-weighted average age of open receivables. Kept as `dsoDays` for
  // existing callers, but it is NOT days sales outstanding (that needs the
  // period's credit sales) — the report labels it "Avg. age (weighted)".
  let weightedAge = 0;
  let weightTotal = 0;
  for (const l of lines) {
    if (l.remaining <= 0) continue;
    const ageDays = Math.max(0, daysSince(l.invoiceDate, asOfDate));
    weightedAge += ageDays * l.remaining;
    weightTotal += l.remaining;
  }
  const dsoDays = weightTotal > 0 ? Math.round(weightedAge / weightTotal) : 0;

  return { asOfDate, arOutstanding, overdue, dueIn7Days, dsoDays, bucketTotals };
}
