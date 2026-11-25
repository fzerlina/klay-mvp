// Director's Summary — "Worth a look". Pure: no React.
//
// User, 25–26 Nov 2026: the system can't explain why a number went up or
// down, but it can point at the transactions that might — new vendors, big
// documents, a customer that bought much more or stopped buying. Finance's
// commentary gives the why; this lists what to ask about.
//
// MVP rules (the rest of the agreed list — concentration, margins, customers
// paying later, collections vs billing, big bills due soon — come later):
//   new_vendor / new_customer   first bill / invoice ever, in the period, ≥ floor
//   vendor_change / customer_change
//                               billed / invoiced ±pct and ±floor against the
//                               usual: the average of the 3 months before the
//                               period, scaled to the period's length
//   customer_quiet              invoiced in each of those 3 months, nothing now
//   large_doc                   an invoice or bill ≥ the large-transaction
//                               amount, or ≥ 3× that party's usual document
//                               (median of its last 12 months, 3+ documents)
//   manual_journal              a manual journal ≥ floor touching P&L or cash
//   cash_outside_ops            investing / financing cash-flow groups moving
//                               ≥ floor — why cash moved and profit didn't
//   cash_floor                  cash in 30 days below the minimum balance
//
// Thresholds: pct and floor are the company's materiality (the Trial
// Balance's variance setting, 30% and Rp 20 M by default); large and the
// minimum cash balance are Director's Summary settings (Accounting →
// Preferences). Each anomaly says which box it might explain, carries a
// signed rupiah impact (they're ranked by its size) and the drill-down view
// that shows the documents behind it.

import { dayBefore, dayLabel } from "./reportPeriods";

const r2 = (v) => Math.round(v * 100) / 100 + 0;
const ym = (iso) => iso.slice(0, 7);
function addMonths(yyyymm, n) {
  const [y, m] = yyyymm.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000) + 1;
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
const rpS = (v) => {
  const a = Math.abs(v);
  const s = a >= 1e9 ? `${(a / 1e9).toLocaleString("id-ID", { maximumFractionDigits: 2 })} M` : a >= 1e6 ? `${(a / 1e6).toLocaleString("id-ID", { maximumFractionDigits: 1 })} jt` : a.toLocaleString("id-ID");
  return `Rp ${s}`;
};
const pctS = (p) => `${Math.round(Math.abs(p) * 100)}%`;

export const RULES = {
  new_vendor: { label: "New vendor", box: "ap" },
  new_customer: { label: "New customer", box: "revenue" },
  vendor_change: { label: "Vendor spend changed", box: "ap" },
  customer_change: { label: "Customer sales changed", box: "revenue" },
  customer_quiet: { label: "Customer went quiet", box: "revenue" },
  large_doc: { label: "Large transaction", box: null },
  manual_journal: { label: "Manual journal", box: "profit" },
  cash_outside_ops: { label: "Cash outside operations", box: "cash" },
  cash_floor: { label: "Below minimum cash", box: "outlook" },
};
export const BOX_LABEL = { cash: "Cash now", ar: "Customers owe us", ap: "We owe vendors", outlook: "Cash in 30 days", revenue: "Net revenue", profit: "Net profit/(loss)", equity: "Total equity" };

// Invoices and bills as one shape. Drafts aren't documents yet; a bill counts
// once it's posted.
export function documents({ invoices = [], bills = [] }) {
  return [
    ...invoices.filter((i) => i.approval !== "draft" && (i.total || 0) > 0 && i.date).map((i) => ({
      side: "ar", id: i.id, no: i.invNo && i.invNo !== "—" ? i.invNo : i.id, party: i.customer, partyName: i.customerName || i.customer, date: i.date, total: i.total,
    })),
    ...bills.filter((b) => b.je_number && (b.total || 0) > 0 && b.date).map((b) => ({
      side: "ap", id: b.id, no: b.invNo && b.invNo !== "—" ? b.invNo : b.id, party: b.vendor, partyName: b.vendorName || b.vendor, date: b.date, total: b.total,
    })),
  ];
}

// The usual: the 3 calendar months before the period's first month.
export function baselineWindow(from) {
  const first = addMonths(ym(from), -3);
  return { from: `${first}-01`, to: dayBefore(from), months: [first, addMonths(ym(from), -2), addMonths(ym(from), -1)] };
}

export function detectAnomalies({ from, to, invoices, bills, entries, cf, cash30, plCodes, cashCodes, t }) {
  const { pct, floor, large, minCash } = t;
  const docs = documents({ invoices, bills });
  const base = baselineWindow(from);
  const monthsIn = Math.max(0.25, daysBetween(from, to) / 30.44);
  const out = [];

  // ── Customers and vendors ────────────────────────────────────────────────
  const skipped = [];
  for (const side of ["ar", "ap"]) {
    const mine = docs.filter((d) => d.side === side);
    // "New" and "usual" mean nothing without history: the party rules run
    // only when there are documents from before the 3-month window.
    const history = mine.some((d) => d.date < base.from);
    const parties = new Map();
    for (const d of mine) {
      if (!parties.has(d.party)) parties.set(d.party, { id: d.party, name: d.partyName, first: d.date, cur: 0, base: 0, baseMonths: new Set(), curDocs: 0 });
      const p = parties.get(d.party);
      if (d.date < p.first) p.first = d.date;
      if (d.date >= from && d.date <= to) { p.cur += d.total; p.curDocs += 1; }
      if (d.date >= base.from && d.date <= base.to) { p.base += d.total; p.baseMonths.add(ym(d.date)); }
    }
    const who = side === "ar" ? "customer" : "vendor";
    if (!history) skipped.push(side === "ar" ? "customers" : "vendors");
    for (const p of history ? parties.values() : []) {
      const view = { t: "activity", side, id: p.id };
      if (p.first >= from && p.first <= to) {
        if (p.cur >= floor) {
          out.push({
            id: `new_${who}:${p.id}`, rule: `new_${who}`, side, impact: r2(side === "ar" ? p.cur : -p.cur),
            title: side === "ar" ? `${p.name} — first invoice${p.curDocs > 1 ? "s" : ""} ever` : `${p.name} — first bill${p.curDocs > 1 ? "s" : ""} ever`,
            detail: `${rpS(p.cur)} ${side === "ar" ? "invoiced" : "billed"} in ${p.curDocs} document${p.curDocs === 1 ? "" : "s"}`, view,
          });
        }
        continue;
      }
      const usual = (p.base / 3) * monthsIn;
      const quiet = side === "ar" && p.cur === 0 && p.baseMonths.size === 3;
      if (quiet) {
        if (usual >= floor) {
          out.push({
            id: `customer_quiet:${p.id}`, rule: "customer_quiet", side, impact: r2(-usual),
            title: `${p.name} — no invoices this period`,
            detail: `Invoiced every month before — usually ${rpS(usual)} for a period this long`, view: { ...view, window: "baseline" },
          });
        }
        continue;
      }
      if (usual <= 0) continue;
      const diff = p.cur - usual;
      if (Math.abs(diff) >= floor && Math.abs(diff) / usual >= pct) {
        const up = diff > 0;
        out.push({
          id: `${who}_change:${p.id}`, rule: `${who}_change`, side, impact: r2(side === "ar" ? diff : -diff),
          title: side === "ar"
            ? `${p.name} bought ${up ? "more" : "less"} than usual`
            : `${p.name} billed ${up ? "more" : "less"} than usual`,
          detail: `${rpS(p.cur)} against a usual ${rpS(usual)} · ${p.cur >= 3 * usual ? `${Math.round(p.cur / usual)}× usual` : `${up ? "+" : "−"}${pctS(diff / usual)}`}`, view,
        });
      }
    }

    // Large documents: over the large amount, or far over the party's usual —
    // unless the party is already listed above (its documents are one click
    // into that anomaly).
    const listed = new Set(out.filter((a) => a.side === side).map((a) => a.view.id));
    const yearAgo = `${addMonths(ym(from), -12)}-01`;
    for (const d of mine) {
      if (d.date < from || d.date > to || listed.has(d.party)) continue;
      const history = mine.filter((x) => x.party === d.party && x.date >= yearAgo && x.date < from).map((x) => x.total);
      const usualDoc = history.length >= 3 ? median(history) : null;
      const big = d.total >= large;
      const outsized = usualDoc && d.total >= floor && d.total >= 3 * usualDoc;
      if (!big && !outsized) continue;
      out.push({
        id: `large_doc:${d.side}:${d.id}`, rule: "large_doc", side: d.side, box: d.side === "ar" ? "revenue" : "ap", impact: r2(d.side === "ar" ? d.total : -d.total),
        title: `${d.side === "ar" ? "Invoice" : "Bill"} ${d.no} — ${d.partyName}`,
        detail: `${rpS(d.total)} on ${dayLabel(d.date)}${outsized ? ` · ${Math.round(d.total / usualDoc)}× their usual ${rpS(usualDoc)}` : ""}`,
        view: { t: "doc", side: d.side, id: d.id },
      });
    }
  }

  // ── Manual journals that change profit without moving cash ──────────────
  // Accruals, write-offs, provisions, reclassifications into the P&L: the
  // entries that can move profit with no invoice or bill behind them. A
  // manual journal that moves cash is a receipt or payment, and shows up in
  // the cash and party rules instead. A routine one — the same accounts in a
  // manual journal in each of the 3 months before (a monthly payroll accrual)
  // — isn't unusual and isn't listed.
  const isManual = (je) => !je.reference_type || je.reference_type === "manual" || je.reference_type === "reclassification";
  const sig = (je) => [...new Set((je.lines || []).map((l) => l.account_code))].sort().join(",");
  const seen = new Map(); // signature → months it was used in the 3 months before
  for (const je of entries || []) {
    if (je.status !== "posted" || !isManual(je) || !je.je_date || je.je_date < base.from || je.je_date > base.to) continue;
    const s = sig(je);
    if (!seen.has(s)) seen.set(s, new Set());
    seen.get(s).add(ym(je.je_date));
  }
  // Months of those 3 that have any manual journal (books can start inside
  // the window): routine = used in each of them, and at least two.
  const dataMonths = new Set([...seen.values()].flatMap((s) => [...s]));
  const routine = (je) => dataMonths.size >= 2 && (seen.get(sig(je))?.size || 0) >= dataMonths.size;
  for (const je of entries || []) {
    if (je.status !== "posted" || je.is_opening || !je.je_date || je.je_date < from || je.je_date > to) continue;
    if (!isManual(je) || routine(je)) continue;
    const lines = je.lines || [];
    if (lines.some((l) => cashCodes.has(l.account_code))) continue;
    const plEffect = r2(lines.filter((l) => plCodes.has(l.account_code)).reduce((s, l) => s + (Number(l.credit) || 0) - (Number(l.debit) || 0), 0));
    if (Math.abs(plEffect) < floor) continue;
    out.push({
      id: `manual_journal:${je.je_number}`, rule: "manual_journal", impact: plEffect,
      title: `${je.is_adjusting ? "Adjusting journal" : "Manual journal"} ${je.je_number}${je.memo ? ` — ${je.memo}` : ""}`,
      detail: `${plEffect > 0 ? "Adds" : "Takes"} ${rpS(plEffect)} ${plEffect > 0 ? "to" : "from"} profit on ${dayLabel(je.je_date)}, no cash moved${je.created_by ? ` · by ${je.created_by}` : ""}`,
      view: { t: "je", je: je.je_number },
    });
  }

  // ── Cash ─────────────────────────────────────────────────────────────────
  for (const sec of ["investing", "financing"]) {
    for (const k of cf.roots[sec] || []) {
      const g = cf.groups[k];
      if (Math.abs(g.amount) < floor) continue;
      out.push({
        id: `cash_outside_ops:${k}`, rule: "cash_outside_ops", impact: g.amount,
        title: `${g.label}: ${g.amount < 0 ? "cash out" : "cash in"}`,
        detail: `${rpS(g.amount)} ${sec} — moves cash without touching profit`,
        view: { t: "cfGroup", key: k },
      });
    }
  }
  if (cash30 < minCash) {
    out.push({
      id: "cash_floor", rule: "cash_floor", impact: r2(cash30 - minCash),
      title: cash30 < 0 ? "Cash in 30 days is negative" : "Cash in 30 days is below the minimum",
      detail: `${rpS(cash30)} expected against a minimum of ${rpS(minCash)}`,
      view: { t: "outlook" },
    });
  }

  const list = out
    .map((a) => ({ ...a, box: a.box || RULES[a.rule].box, label: RULES[a.rule].label }))
    .sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));
  return { list, skipped, baseline: base };
}
