// Director's Summary drill-down — what each level of the side panel shows.
// Pure: no React. The page keeps a stack of views ({ t: "ar" }, { t: "party",
// side: "ar", id }, { t: "doc", side: "ar", id } …) and resolves the top one
// with resolveDrill(); the panel (components/SummaryDrill.jsx) renders it.
//
// User, 25 Nov 2026: directors drill down without leaving the report, and the
// deepest level is the invoice / bill summary — read only, no actions, no
// journal behind it. Every list adds up to the number that was clicked; the
// panel's footer shows that total.
//
// Levels:
//   cash      Cash now → each cash account → its journal lines in the period
//   ar / ap   who owes / is owed, by customer or vendor (filter by age bucket)
//             → that party's open invoices or bills → the document summary
//   outlook   Cash in 30 days: cash now + invoices due − bills due, by due date
//   pl        a short Profit & Loss → a section's accounts → journal lines
//   equity    opening, movements, closing (profit opens the P&L)

import { AGE_BUCKETS } from "./apAging";
import { PL_BUCKETS } from "./profitLoss";
import { dayLabel } from "./reportPeriods";
import { cashEffectLines } from "./cashFlow";
import { documents, baselineWindow } from "./anomalies";

export const AGE_LABEL = { current: "Not yet due", b1_30: "1–30 days late", b31_60: "31–60 days late", b61_90: "61–90 days late", b91_120: "91–120 days late", b_gt120: "Over 120 days late" };
const r2 = (v) => Math.round(v * 100) / 100 + 0;
const sum = (list, f) => r2(list.reduce((s, x) => s + f(x), 0));

const dueText = (l) => (l.remaining <= 0 ? "paid" : l.daysOverdue > 0 ? `${l.daysOverdue} days late` : l.daysOverdue === 0 ? "due today" : `due in ${-l.daysOverdue} days`);

// A document's line as of the date: the open-item line when it's still open,
// else built from the document itself (paid, or dated after the date).
function docLine(side, id, c) {
  const open = c.aging[side].lines.find((x) => x.id === id);
  if (open) return open;
  const d = side === "ar" ? (c.invoices || []).find((x) => x.id === id) : (c.bills || []).find((x) => x.id === id);
  if (!d) return null;
  const no = d.invNo && d.invNo !== "—" ? d.invNo : d.id;
  return side === "ar"
    ? { id: d.id, invNo: no, customerId: d.customer, customerName: d.customerName, invoiceDate: d.date, dueDate: d.due, total: d.total || 0, remaining: 0, daysOverdue: 0, raw: d }
    : { id: d.id, invNo: no, vendorId: d.vendor, vendorName: d.vendorName, invoiceDate: d.date, dueDate: d.due, total: d.total || 0, remaining: 0, daysOverdue: 0, raw: d };
}
const SIDE = {
  ar: { title: "Customers owe us", party: "Customer", doc: "Invoice", docs: "open invoices", partyOf: (l) => ({ id: l.customerId, name: l.customerName }), report: { to: "/reports/cashflow?tab=ar", label: "AR Aging" } },
  ap: { title: "We owe vendors", party: "Vendor", doc: "Bill", docs: "open bills", partyOf: (l) => ({ id: l.vendorId, name: l.vendorName }), report: { to: "/reports/cashflow?tab=ap", label: "AP Aging" } },
};

// Posted journal lines on one account in [from, to], signed by `sign`
// (debit − credit × sign).
function journalLines(entries, code, { from, to }, sign = 1) {
  const out = [];
  for (const je of entries || []) {
    if (je.status !== "posted" || !je.je_date || je.je_date < from || je.je_date > to) continue;
    (je.lines || []).forEach((l, i) => {
      if (l.account_code !== code) return;
      const amount = r2(((Number(l.debit) || 0) - (Number(l.credit) || 0)) * sign);
      if (!amount) return;
      out.push({ key: `${je.je_number}-${i}`, label: l.description || je.memo || je.je_number, meta: `${dayLabel(je.je_date)} · ${je.je_number}`, values: [amount], date: je.je_date });
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

const bucketChips = (lines, bucket) => [
  { key: null, label: "All", on: !bucket },
  ...AGE_BUCKETS.filter((b) => lines.some((l) => l.ageBucket === b.key)).map((b) => ({ key: b.key, label: AGE_LABEL[b.key], on: bucket === b.key })),
];

function docRow(side, l, sign = 1, withParty = true) {
  const p = SIDE[side].partyOf(l);
  return { key: l.id, label: l.invNo, meta: `${withParty ? `${p.name} · ` : ""}due ${dayLabel(l.dueDate)} · ${dueText(l)}`, tone: l.daysOverdue > 0 ? "late" : null, values: [r2(l.remaining * sign)], open: { t: "doc", side, id: l.id } };
}

// ── Each level ──────────────────────────────────────────────────────────────
const LEVELS = {
  ar: (v, c) => parties(v, c), ap: (v, c) => parties(v, c),

  party(v, c) {
    const s = SIDE[v.side];
    const all = c.aging[v.side].lines.filter((l) => s.partyOf(l).id === v.id);
    const lines = all.filter((l) => !v.bucket || l.ageBucket === v.bucket).sort((a, b) => b.daysOverdue - a.daysOverdue);
    const name = all[0] ? s.partyOf(all[0]).name : v.id;
    return {
      crumb: name, title: name, sub: `${s.party} · ${lines.length} ${s.docs}${v.bucket ? ` · ${AGE_LABEL[v.bucket]}` : ""} at ${dayLabel(c.asOf)}`,
      chips: bucketChips(all, v.bucket), report: s.report,
      blocks: [{ cols: ["Still owed"], rows: lines.map((l) => docRow(v.side, l, 1, false)) }],
      foot: { label: v.bucket ? AGE_LABEL[v.bucket] : `${s.party} total`, amount: sum(lines, (l) => l.remaining) },
    };
  },

  doc(v, c) {
    const s = SIDE[v.side];
    const l = docLine(v.side, v.id, c);
    if (!l) return { crumb: v.id, title: v.id, sub: "Not found.", blocks: [] };
    const d = l.raw || {};
    const p = s.partyOf(l);
    const facts = [
      { k: s.party, v: p.name },
      { k: `${s.doc} no.`, v: l.invNo },
      { k: `${s.doc} date`, v: dayLabel(l.invoiceDate) },
      { k: "Due date", v: `${dayLabel(l.dueDate)} · ${dueText(l)}`, tone: l.daysOverdue > 0 ? "late" : null },
    ];
    if (v.side === "ar" && d.custPO) facts.push({ k: "Customer PO", v: d.custPO });
    if (v.side === "ap" && d.poNo) facts.push({ k: "PO", v: d.poNo });
    if (v.side === "ap" && l.on_hold) facts.push({ k: "On hold", v: l.hold_reason || "Yes", tone: "late" });
    if (d.keterangan) facts.push({ k: "Note", v: d.keterangan });
    const items = (d.items || []).map((it, i) => ({
      key: i, label: it.desc,
      meta: [it.qty != null && it.price != null ? `${it.qty.toLocaleString("id-ID")}${it.unit ? ` ${it.unit}` : ""} × Rp ${Math.round(it.price).toLocaleString("id-ID")}` : null, it.acctName].filter(Boolean).join(" · "),
      values: [it.subtotal ?? (it.qty || 0) * (it.price || 0)],
    }));
    const settled = r2(l.total - l.remaining);
    const totals = [
      d.dpp != null && Math.abs(d.dpp - l.total) >= 0.5 ? { label: "Before tax (DPP)", values: [d.dpp] } : null,
      { label: `${s.doc} total`, values: [l.total], strong: true },
      v.side === "ap" && d.pph23 ? { label: "PPh 23 withheld", values: [-d.pph23] } : null,
      settled ? { label: v.side === "ar" ? "Received" : "Paid", values: [-settled] } : null,
    ].filter(Boolean);
    const history = [
      ...((d.receipts || []).map((r) => ({ date: r.date, text: `Received Rp ${Math.round(r.amount || 0).toLocaleString("id-ID")}` }))),
      ...((d.audit || []).map((a) => ({ date: a.date, text: `${a.action}${a.by ? ` — ${a.by}` : ""}` }))),
    ].filter((h) => h.date && h.date <= c.asOf).sort((a, b) => a.date.localeCompare(b.date)).map((h) => ({ ...h, date: dayLabel(h.date) }));
    return {
      crumb: l.invNo, title: l.invNo, code: s.doc, sub: `${p.name} · as at ${dayLabel(c.asOf)}`,
      report: s.report,
      blocks: [
        { facts },
        items.length ? { head: "Lines", cols: ["Amount"], rows: items } : null,
        { rows: totals.map((t) => ({ key: t.label, label: t.label, values: t.values, strong: t.strong })) },
        history.length ? { head: "History", history } : null,
      ].filter(Boolean),
      foot: { label: "Still owed", amount: l.remaining },
    };
  },

  // A customer's or vendor's documents in the period (or, for one that went
  // quiet, in the 3 months before) — next to what's usual for them.
  activity(v, c) {
    const s = SIDE[v.side];
    const base = baselineWindow(c.from);
    const docs = documents({ invoices: c.invoices, bills: c.bills }).filter((d) => d.side === v.side && d.party === v.id);
    const inWin = (d, w) => d.date >= w.from && d.date <= w.to;
    const win = v.window === "baseline" ? base : { from: c.from, to: c.to };
    const shown = docs.filter((d) => inWin(d, win)).sort((a, b) => a.date.localeCompare(b.date));
    const name = docs[0]?.partyName || v.id;
    const cur = sum(docs.filter((d) => inWin(d, c)), (d) => d.total);
    const usual = sum(docs.filter((d) => inWin(d, base)), (d) => d.total) / 3;
    const first = docs.reduce((m, d) => (d.date < m ? d.date : m), "9999");
    return {
      crumb: name, title: name, sub: `${s.party} · ${v.window === "baseline" ? `${dayLabel(base.from)} – ${dayLabel(base.to)}, the 3 months before` : `${dayLabel(c.from)} – ${dayLabel(c.to)}`}`,
      report: s.report,
      blocks: [
        { facts: [
          { k: "This period", v: `Rp ${Math.round(cur).toLocaleString("id-ID")}` },
          { k: "Usual a month", v: usual ? `Rp ${Math.round(usual).toLocaleString("id-ID")}` : "nothing in the 3 months before" },
          { k: `First ${s.doc.toLowerCase()}`, v: first === "9999" ? "—" : dayLabel(first) },
        ] },
        { head: `${s.doc}s`, cols: ["Amount"], rows: shown.map((d) => {
          const l = docLine(v.side, d.id, c);
          return { key: d.id, label: d.no, meta: `${dayLabel(d.date)} · ${l ? dueText(l) : ""}`, values: [d.total], open: { t: "doc", side: v.side, id: d.id } };
        }) },
      ],
      foot: { label: v.window === "baseline" ? "In those 3 months" : "This period", amount: sum(shown, (d) => d.total) },
    };
  },

  // A journal entry — the document behind a manual adjustment.
  je(v, c) {
    const je = (c.entries || []).find((x) => x.je_number === v.je);
    if (!je) return { crumb: v.je, title: v.je, sub: "Not found.", blocks: [] };
    const lines = je.lines || [];
    return {
      crumb: je.je_number, title: je.je_number, code: je.is_adjusting ? "Adjusting journal" : "Journal", sub: je.memo || "",
      report: { to: `/journal-entry/${encodeURIComponent(je.je_number)}`, label: "journal" },
      blocks: [
        { facts: [
          { k: "Date", v: dayLabel(je.je_date) },
          { k: "Type", v: je.reference_type && je.reference_type !== "manual" ? je.reference_type.replace(/_/g, " ") : "Manual" },
          { k: "Prepared by", v: je.created_by || "—" },
          { k: "Posted by", v: je.posted_by || "—" },
        ] },
        { head: "Lines", cols: ["Debit", "Credit"], rows: lines.map((l, i) => ({
          key: i, label: c.accountName(l.account_code), meta: [l.account_code, l.description].filter(Boolean).join(" · "),
          values: [Number(l.debit) || null, Number(l.credit) || null],
        })) },
      ],
      foot: { label: "Total", amount: sum(lines, (l) => Number(l.debit) || 0) },
    };
  },

  // A Cash Flow group: its subgroups and accounts, by cash effect.
  cfGroup(v, c) {
    const g = c.cf.groups[v.key];
    if (!g) return { crumb: v.key, title: v.key, blocks: [] };
    const rows = [
      ...g.children.map((k) => c.cf.groups[k]).map((x) => ({ key: x.key, label: x.label, meta: "group", values: [x.amount], open: { t: "cfGroup", key: x.key } })),
      ...g.accounts.filter((a) => Math.abs(a.amount) >= 0.5).map((a) => ({ key: a.code, label: a.name, meta: a.code, values: [a.amount], open: { t: "cfAcct", code: a.code } })),
    ];
    return {
      crumb: g.label, title: g.label, sub: `Cash Flow group · ${dayLabel(c.from)} – ${dayLabel(c.to)} · + cash in, − cash out`,
      report: { to: "/reports/cash-flow", label: "Cash Flow", state: { period: { from: c.from, to: c.to } } },
      blocks: [{ cols: ["Cash"], rows }],
      foot: { label: "Net cash", amount: g.amount },
    };
  },

  cfAcct(v, c) {
    const name = c.accountName(v.code);
    const lines = cashEffectLines(c.entries, v.code, c, c.cf.cashCodes).map((l) => ({ key: l.key, label: l.desc || l.je_number, meta: `${dayLabel(l.date)} · ${l.je_number}`, values: [l.amount] }));
    return {
      crumb: name, title: name, code: v.code, sub: `Cash received and paid against this account, ${dayLabel(c.from)} – ${dayLabel(c.to)}`,
      report: { to: `/reports/general-ledger?${new URLSearchParams({ account: v.code, period: "custom", from: c.from, to: c.to })}`, label: "General Ledger" },
      blocks: [{ cols: ["Cash"], rows: lines }],
      foot: { label: "Net cash", amount: sum(lines, (l) => l.values[0]) },
    };
  },

  outlook(v, c) {
    const due = (side) => c.aging[side].lines.filter((l) => l.daysOverdue >= -30).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const ins = due("ar"), outs = due("ap");
    return {
      crumb: "Cash in 30 days", title: "Cash in 30 days", sub: `From ${dayLabel(c.asOf)}, if invoices and bills are paid when due — overdue counted as due now`,
      report: { to: "/reports/cashflow", label: "Cashflow Report" },
      blocks: [
        { rows: [{ key: "cash", label: "Cash now", meta: "cash and cash equivalents", values: [c.cashNow], strong: true, open: { t: "cash" } }] },
        { head: `Customers expected to pay · ${ins.length} invoices`, rows: ins.map((l) => docRow("ar", l)), total: { label: "Coming in", values: [sum(ins, (l) => l.remaining)] } },
        { head: `Bills to pay · ${outs.length} bills`, rows: outs.map((l) => docRow("ap", l, -1)), total: { label: "Going out", values: [-sum(outs, (l) => l.remaining)] } },
      ],
      foot: { label: "Cash in 30 days", amount: c.cash30 },
    };
  },

  cash(v, c) {
    const rows = c.cf.cashCodes
      .map((code) => ({ code, amount: r2(c.bs.byCode[code] || 0), name: c.accountName(code) }))
      .filter((a) => Math.abs(a.amount) >= 0.5)
      .sort((a, b) => b.amount - a.amount)
      .map((a) => ({ key: a.code, label: a.name, meta: a.code, values: [a.amount], open: { t: "cashAcct", code: a.code } }));
    return {
      crumb: "Cash now", title: "Cash now", sub: `Cash and cash equivalents in the books at ${dayLabel(c.to)}`,
      report: { to: "/reports/cash-flow", label: "Cash Flow", state: { period: { from: c.from, to: c.to } } },
      blocks: [{ cols: ["Balance"], rows }],
      foot: { label: "Cash now", amount: c.cashNow },
    };
  },

  cashAcct(v, c) {
    const name = c.accountName(v.code);
    const opening = r2(c.bsOpen.byCode[v.code] || 0);
    const lines = journalLines(c.entries, v.code, c);
    return {
      crumb: name, title: name, code: v.code, sub: `${dayLabel(c.from)} – ${dayLabel(c.to)} · + money in, − money out`,
      report: { to: `/reports/general-ledger?${new URLSearchParams({ account: v.code, period: "custom", from: c.from, to: c.to })}`, label: "General Ledger" },
      blocks: [{ cols: ["Amount"], rows: [{ key: "open", label: `Balance at ${dayLabel(c.dayBeforeFrom)}`, values: [opening], strong: true }, ...lines] }],
      foot: { label: `Balance at ${dayLabel(c.to)}`, amount: r2(c.bs.byCode[v.code] || 0) },
    };
  },

  pl(v, c) {
    const t = c.pl.totals;
    const sec = (key) => {
      const b = PL_BUCKETS.find((x) => x.key === key);
      return { key, label: b.label, values: [c.pl.sections[key].total], open: { t: "plSec", key } };
    };
    const sub = (key, label) => ({ key, label, values: [t[key]], strong: true });
    // From the Net revenue box: just what makes up net revenue.
    if (v.src === "revenue") {
      return {
        crumb: "Net revenue", title: "Net revenue", sub: `${dayLabel(c.from)} – ${dayLabel(c.to)} · returns and discounts subtracted`,
        report: { to: "/reports/profit-loss", label: "Profit & Loss", state: { period: { from: c.from, to: c.to } } },
        blocks: [{ cols: ["Amount"], rows: [sec("revenue"), sec("contra")] }],
        foot: { label: "Net revenue", amount: t.netRevenue },
      };
    }
    return {
      crumb: "Profit & Loss", title: "Profit & Loss", sub: `${dayLabel(c.from)} – ${dayLabel(c.to)} · costs shown as positive and subtracted`,
      report: { to: "/reports/profit-loss", label: "Profit & Loss", state: { period: { from: c.from, to: c.to } } },
      blocks: [{ cols: ["Amount"], rows: [
        sec("revenue"), sec("contra"), sub("netRevenue", "Net revenue"),
        sec("cogs"), sub("grossProfit", "Gross profit/(loss)"),
        sec("selling"), sec("ga"), sub("operatingProfit", "Operating profit/(loss)"),
        sec("otherIncome"), sec("otherExpense"), sub("profitBeforeTax", "Profit/(loss) before tax"),
        sec("tax"),
      ] }],
      foot: { label: "Net profit/(loss)", amount: t.netProfit },
    };
  },

  plSec(v, c) {
    const s = c.pl.sections[v.key];
    const rows = s.rows.filter((r) => !r.zero).sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
      .map((r) => ({ key: r.code, label: r.name, meta: r.code, values: [r.amount], open: { t: "acct", code: r.code, sign: s.deduct ? 1 : -1 } }));
    return {
      crumb: s.label, title: s.label, sub: `${dayLabel(c.from)} – ${dayLabel(c.to)}`,
      report: { to: "/reports/profit-loss", label: "Profit & Loss", state: { period: { from: c.from, to: c.to } } },
      blocks: [{ cols: ["Amount"], rows }],
      foot: { label: `Total ${s.label.toLowerCase()}`, amount: s.total },
    };
  },

  acct(v, c) {
    const name = c.accountName(v.code);
    const lines = journalLines(c.entries, v.code, c, v.sign);
    return {
      crumb: name, title: name, code: v.code, sub: `${dayLabel(c.from)} – ${dayLabel(c.to)} · posted journals`,
      report: { to: `/reports/general-ledger?${new URLSearchParams({ account: v.code, period: "custom", from: c.from, to: c.to })}`, label: "General Ledger" },
      blocks: [{ cols: ["Amount"], rows: lines }],
      foot: { label: "Total", amount: sum(lines, (l) => l.values[0]) },
    };
  },

  equity(v, c) {
    const rows = [
      { key: "open", label: `Equity at ${dayLabel(c.dayBeforeFrom)}`, values: [c.eq.opening.byComp.total], strong: true },
      ...c.eq.rows.map((r) => ({ key: r.key, label: r.label, values: [r.byComp.total], open: r.key === "profit" ? { t: "pl" } : null })),
    ];
    return {
      crumb: "Equity", title: "Total equity", sub: `How equity moved, ${dayLabel(c.from)} – ${dayLabel(c.to)}`,
      report: { to: "/reports/changes-in-equity", label: "Changes in Equity", state: { period: { from: c.from, to: c.to } } },
      blocks: [{ cols: ["Amount"], rows }],
      foot: { label: `Equity at ${dayLabel(c.to)}`, amount: c.eq.closing.byComp.total },
    };
  },
};

function parties(v, c) {
  const s = SIDE[v.t];
  const all = c.aging[v.t].lines;
  const lines = all.filter((l) => !v.bucket || l.ageBucket === v.bucket);
  const by = new Map();
  for (const l of lines) {
    const p = s.partyOf(l);
    if (!by.has(p.id)) by.set(p.id, { ...p, total: 0, overdue: 0, n: 0 });
    const row = by.get(p.id);
    row.total += l.remaining; row.n += 1;
    if (l.daysOverdue > 0) row.overdue += l.remaining;
  }
  const rows = [...by.values()].sort((a, b) => b.overdue - a.overdue || b.total - a.total).map((p) => ({
    key: p.id, label: p.name, meta: `${p.n} ${p.n === 1 ? s.doc.toLowerCase() : `${s.doc.toLowerCase()}s`}`,
    values: [p.overdue ? r2(p.overdue) : null, r2(p.total)], tone: p.overdue ? "late" : null,
    open: { t: "party", side: v.t, id: p.id, bucket: v.bucket || null },
  }));
  return {
    crumb: v.bucket ? `${s.title} · ${AGE_LABEL[v.bucket]}` : s.title,
    title: s.title, sub: `${rows.length} ${s.party.toLowerCase()}s · ${lines.length} ${s.docs} at ${dayLabel(c.asOf)}`,
    chips: bucketChips(all, v.bucket), report: s.report,
    blocks: [{ cols: ["Overdue", "Owed"], rows }],
    foot: { label: v.bucket ? AGE_LABEL[v.bucket] : "Total", amount: sum(lines, (l) => l.remaining) },
  };
}

export function resolveDrill(view, ctx) {
  const f = LEVELS[view.t];
  return f ? f(view, ctx) : { crumb: "?", title: "", blocks: [] };
}
