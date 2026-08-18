// AR Aging derivation layer — the receivables mirror of apAging.js.
//
// Reads ar_invoices + customers. Where AP aging tracks money we OWE (payables,
// bucketed by how overdue the bill is), AR aging tracks money we're OWED
// (receivables, bucketed by how overdue the invoice is). It reuses the same age
// buckets so the two tables read identically side-by-side in the Cashflow
// Report. There are no accruals or payment-lifecycle stages on the AR side —
// an outstanding receivable is simply a non-draft, unpaid invoice.

import { INVOICES } from "../data/seed/invoices";
import { CUSTOMERS } from "../data/seed/customers";
import { TODAY, daysSince } from "./clock";
import { AGE_BUCKETS, ageBucketOf } from "./apAging";

export { AGE_BUCKETS };

// ── Aging line — one row per outstanding invoice ──────────────────────────
// A receivable is "outstanding" when it's a real (non-draft) invoice that
// hasn't been paid in full. Drafts aren't receivables yet; paid invoices drop
// off the report.
export function isArAgingRow(inv) {
  if (!inv) return false;
  if (inv.approval === "draft") return false;
  if (inv.payStatus === "paid") return false;
  return (inv.total || 0) > 0;
}

export function buildArAgingLines(asOfDate = TODAY, invoices = INVOICES) {
  return invoices.filter(isArAgingRow).map((inv) => {
    const c = CUSTOMERS.find((x) => x.id === inv.customer) || null;
    const daysOverdue = daysSince(inv.due);
    const ageBucket = ageBucketOf(daysOverdue);
    // AR has no partial-settlement tracking in the prototype — the whole
    // invoice total is the open receivable until it's marked paid.
    const remaining = inv.total || 0;
    return {
      id: inv.id,
      customerId: inv.customer,
      customerName: inv.customerName || c?.name || inv.customer,
      customerCode: inv.custCode || c?.code || "",
      invNo: inv.invNo === "—" || !inv.invNo ? inv.id : inv.invNo,
      invoiceDate: inv.date,
      dueDate: inv.due,
      payStatus: inv.payStatus,
      total: inv.total || 0,
      remaining,
      daysOverdue,
      ageBucket,
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
    const dueDays = -daysSince(l.dueDate); // positive = future
    if (dueDays >= 0 && dueDays <= 7) dueIn7Days += l.remaining;
  }

  // DSO proxy — remaining-weighted average age of open receivables. Same shape
  // as the AP DPO proxy so the two read comparably.
  let weightedAge = 0;
  let weightTotal = 0;
  for (const l of lines) {
    if (l.remaining <= 0) continue;
    const ageDays = Math.max(0, daysSince(l.invoiceDate));
    weightedAge += ageDays * l.remaining;
    weightTotal += l.remaining;
  }
  const dsoDays = weightTotal > 0 ? Math.round(weightedAge / weightTotal) : 0;

  return { asOfDate, arOutstanding, overdue, dueIn7Days, dsoDays, bucketTotals };
}
