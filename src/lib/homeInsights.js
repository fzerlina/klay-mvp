// ── Insights hub — cross-module analytical-insight registry ────────────────
//
// Companion to homeTasks.js. Where Your Tasks (/dashboard) surfaces the work to
// DO, the Insights page (/insights) surfaces what the data SHOWS — concentration,
// discounts on the table, ageing/DPD analytics. Previously these lived scattered
// on the module pages (AP Aging's insight panel, the Invoices summary drawer);
// they're now combined here.
//
// Same reusable seam as the task registry: each module contributes ONE provider
// `(ctx) => Insight[]`, gated on `ctx.can(module)` (module visibility). A new
// module plugs in by adding a provider; the page never changes.
//
// Insight (data-only, no JSX):
//   { id, group, groupLabel, groupTo,
//     headline,   // the figure — big ("62%", "Rp 4,2 M")
//     label,      // what the figure is
//     detail,     // one-sentence read of the data
//     tone,       // "neutral" | "positive" | "warning"
//     to, cta }   // deep-link into the source module

import { buildSnapshot } from "./apAging";
import { formatRupiah, formatDateEn } from "./format";
import { TODAY, daysSince } from "./clock";

const sum = (arr, f) => arr.reduce((s, x) => s + (f(x) || 0), 0);
const todayKey = () => TODAY.toISOString().slice(0, 10);

// ── Payables (AP Aging) — concentration, discounts, overdue share ──────────
function payablesInsights(ctx) {
  const { agingLines, can } = ctx;
  if (!can("ap")) return [];
  const g = { group: "payables", groupLabel: "Payables", groupTo: "/reports/cashflow?tab=ap" };
  const out = [];

  // Vendor concentration in the 60+ day overdue tail — collection/risk signal.
  const sixtyPlus = agingLines.filter(
    (l) => !l.is_accrual && l.workflow_status !== "DRAFT" && l.remaining > 0 && l.daysOverdue > 60,
  );
  const byVendor = new Map();
  for (const l of sixtyPlus) {
    const p = byVendor.get(l.vendorId) || { name: l.vendorName, sum: 0 };
    p.sum += l.remaining;
    byVendor.set(l.vendorId, p);
  }
  const sixtyTotal = sum(sixtyPlus, (l) => l.remaining);
  const topV = [...byVendor.values()].sort((a, b) => b.sum - a.sum).slice(0, 3);
  const topVsum = topV.reduce((s, v) => s + v.sum, 0);
  const concentrationPct = sixtyTotal > 0 ? Math.round(topVsum / sixtyTotal * 100) : 0;
  if (topV.length && sixtyTotal > 0) {
    out.push({ ...g, id: "pay:concentration", headline: `${concentrationPct}%`,
      label: `Top ${topV.length} vendor${topV.length === 1 ? "" : "s"} of 60+ day overdue`,
      detail: `${topV.map((v) => v.name).join(", ")} hold ${formatRupiah(topVsum)} of ${formatRupiah(sixtyTotal)} owed past 60 days.`,
      tone: concentrationPct >= 60 ? "warning" : "neutral", to: "/reports/cashflow?tab=ap", cta: "View AP Aging" });
  }

  const snapshot = buildSnapshot(agingLines);

  // Overdue share of the payables balance + DPO.
  const overdue = sum(
    agingLines.filter((l) => !l.is_accrual && l.remaining > 0 && l.daysOverdue > 0),
    (l) => l.remaining,
  );
  const totalOut = snapshot.apOutstanding || 0;
  if (totalOut > 0 && overdue > 0) {
    const pct = Math.round(overdue / totalOut * 100);
    out.push({ ...g, id: "pay:overdueshare", headline: `${pct}%`, label: "of payables are overdue",
      detail: `${formatRupiah(overdue)} of ${formatRupiah(totalOut)} outstanding is past due · DPO ${snapshot.dpoDays} days.`,
      tone: pct >= 40 ? "warning" : "neutral", to: "/reports/cashflow?tab=ap", cta: "View AP Aging" });
  }
  return out;
}

// ── Receivables (Invoices) — concentration, days-past-due, largest ─────────
function receivablesInsights(ctx) {
  const { invoices, can } = ctx;
  if (!can("ar")) return [];
  const g = { group: "receivables", groupLabel: "Receivables", groupTo: "/invoices" };
  const out = [];
  const tk = todayKey();
  const isOverdue = (v) => v.payStatus === "overdue" || (v.payStatus === "belumbayar" && v.due && v.due < tk);
  const overdue = invoices.filter(isOverdue);
  const totalOverdue = sum(overdue, (v) => v.total);

  // Customer concentration in overdue AR.
  const byCust = new Map();
  for (const v of overdue) {
    const p = byCust.get(v.customer) || { name: v.customerName, sum: 0 };
    p.sum += v.total;
    byCust.set(v.customer, p);
  }
  const topC = [...byCust.values()].sort((a, b) => b.sum - a.sum).slice(0, 3);
  const topCsum = topC.reduce((s, c) => s + c.sum, 0);
  const concPct = totalOverdue > 0 ? Math.round(topCsum / totalOverdue * 100) : 0;
  if (topC.length && totalOverdue > 0) {
    out.push({ ...g, id: "ar:concentration", headline: `${concPct}%`,
      label: `Top ${topC.length} customer${topC.length === 1 ? "" : "s"} of overdue AR`,
      detail: `${topC.map((c) => c.name).join(", ")} account for ${formatRupiah(topCsum)} of ${formatRupiah(totalOverdue)} overdue.`,
      tone: concPct >= 60 ? "warning" : "neutral", to: "/invoices?tab=jatuhtempo", cta: "View overdue" });
  }

  // Average days past due across the overdue set.
  if (overdue.length) {
    const avg = Math.round(overdue.reduce((s, v) => s + Math.max(0, daysSince(v.due)), 0) / overdue.length);
    out.push({ ...g, id: "ar:avgdpd", headline: `${avg}d`, label: "Average days past due",
      detail: `${overdue.length} overdue invoice${overdue.length === 1 ? "" : "s"} run ${avg} days late on average · ${formatRupiah(totalOverdue)} total.`,
      tone: avg >= 30 ? "warning" : "neutral", to: "/invoices?tab=jatuhtempo", cta: "View overdue" });
  }

  // Largest single open receivable.
  const open = invoices.filter((v) => v.payStatus !== "lunas");
  if (open.length) {
    const largest = open.reduce((m, v) => (v.total > m.total ? v : m), open[0]);
    out.push({ ...g, id: "ar:largest", headline: formatRupiah(largest.total),
      label: "Largest open receivable",
      detail: `${largest.customerName} — invoice ${largest.invNo}, due ${formatDateEn(largest.due)}.`,
      tone: "neutral", to: "/invoices", cta: "View invoices" });
  }
  return out;
}

export const INSIGHT_PROVIDERS = [payablesInsights, receivablesInsights];

export function computeHomeInsights(ctx) {
  const insights = [];
  for (const provider of INSIGHT_PROVIDERS) {
    const rows = provider(ctx) || [];
    for (const i of rows) insights.push(i);
  }
  // Section by module group, in first-seen order.
  const groups = [];
  const byKey = new Map();
  for (const i of insights) {
    let grp = byKey.get(i.group);
    if (!grp) { grp = { key: i.group, label: i.groupLabel, to: i.groupTo, insights: [] }; byKey.set(i.group, grp); groups.push(grp); }
    grp.insights.push(i);
  }
  return { insights, groups, count: insights.length, groupCount: groups.length };
}
