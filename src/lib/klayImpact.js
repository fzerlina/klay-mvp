// Klay Impact — what Klay did for the business over a period (Michael Andreas,
// 16 Nov 2026: "for the client to see how much impact KLAY drives, on day 1").
// Two sides:
//
//   Time saved      every task Klay did that a person accepted, times the
//                   minutes it would have taken by hand
//   Money guarded   every flag that changed an outcome — a bill or payment
//                   stopped, or a tax mistake fixed before it posted
//
// Two rules keep the numbers defensible in front of a CFO:
//
//   1. Count what a person ACCEPTED, not what Klay attempted. An auto-drafted
//      bill counts once it posts; a bank line counts only when Klay's
//      suggestion was confirmed as it stood (a line matched by hand saved no
//      time). A flag counts toward "guarded" only when it stopped something or
//      got a mistake fixed — an acknowledged ("This is Correct") or overridden
//      flag shows as flagged, never as guarded. Which outcomes count depends on
//      the check (MONEY_CHECKS[].guards).
//   2. Value what was actually at risk. A duplicate risks the whole document; a
//      bill from a fake vendor risks the bill; a tax mistake risks the tax
//      difference, not the invoice it sits on. A document with several flags
//      is guarded once, at its largest value.
//
// MINUTES ARE BACKEND CONFIG (Slack thread, 16 Nov 2026): set by Klay, shown
// read-only to users so the estimate is never hidden. The defaults below are
// placeholders until timed against a pilot client's manual entry.
//
// THE EVENT LOG IS SEEDED. In production Money guarded reads the backend's
// flag rows (never deleted; status, actioned_by/at, first_raised_at) joined to
// the document's status; Time saved needs an event per accepted task. The
// prototype has neither — its review flags are computed live and vanish once a
// bill posts (reviewWorkflow.js),
// bank matches don't record whether Klay suggested them, and only 5 seed bills
// carry isAI. So the log below is generated deterministically, pointing at real
// bills, invoices, vendors and bank accounts wherever one exists. A bill can
// therefore count as auto-drafted here while its own page shows no AI badge.

import { BILLS } from "../data/seed/bills";
import { INVOICES } from "../data/seed/invoices";
import { VENDORS } from "../data/seed/vendors";
import { CUSTOMERS } from "../data/seed/customers";
import { COMPANY_BANK_ACCOUNTS } from "../data/seed/bankAccounts";
import { ASSETS } from "../data/seed/fixedAssets";
import { ITEMS } from "../data/seed/items";
import { todayIso } from "./reportPeriods";

// ── Definitions ─────────────────────────────────────────────────────────────

export const TIME_METRICS = [
  { key: "bill_drafted",    label: "Bills auto-drafted",              desc: "Bills read from vendor invoices and drafted for you.", unit: "bill",    module: "Payables", minutes: 10, counts: "Bills Klay read from the vendor's invoice and drafted, counted once posted.", source: { label: "Bills", to: "/bills" } },
  { key: "invoice_drafted", label: "Invoices auto-drafted",           desc: "Sales invoices drafted for you.", unit: "invoice", module: "Receivables", minutes: 8,  counts: "Sales invoices Klay drafted, counted once sent.", source: { label: "Invoices", to: "/invoices" } },
  { key: "recon_suggested", label: "Bank lines matched by Klay",      desc: "Bank statement lines matched to their payment or receipt.", unit: "line",    module: "Reconciliation", minutes: 3,  counts: "Klay's suggested match, confirmed as it stood. Lines matched by hand don't count.", source: { label: "Bank Reconciliation", to: "/bank-reconciliation" } },
  { key: "quick_draft",     label: "Quick cash journals",             desc: "Journals drafted from a bank line with no record behind it.", unit: "journal", module: "Reconciliation", minutes: 5,  counts: "Cash journals made with Quick draft from a bank line Klay couldn't explain.", source: { label: "Bank Reconciliation", to: "/bank-reconciliation" } },
  { key: "bank_fee",        label: "Bank fee & interest journals",    desc: "Bank charges and interest booked from the statement.", unit: "journal", module: "Reconciliation", minutes: 3,  counts: "Drafted by Klay when the statement loads, counted once posted.", source: { label: "Bank Reconciliation", to: "/bank-reconciliation" } },
  { key: "recurring",       label: "Recurring journals",              desc: "Repeating entries posted on their schedule.", unit: "journal", module: "General Ledger", minutes: 5,  counts: "Copies Klay posted on their schedule.", source: { label: "Journal Entries", to: "/journal-entry" } },
  { key: "depreciation",    label: "Depreciation & amortisation",     desc: "Monthly charges posted from the asset register.", unit: "entry",   module: "Fixed Assets", minutes: 20, counts: "Monthly entries Klay posted from the asset register.", source: { label: "Fixed Assets", to: "/assets" } },
  { key: "asset_disposal",  label: "Asset disposal journals",         desc: "Gain or loss on sold or scrapped assets, booked for you.", unit: "disposal", module: "Fixed Assets", minutes: 15, counts: "Disposals where Klay worked out the gain or loss against book value and wrote the entry.", source: { label: "Fixed Assets", to: "/assets" } },
  { key: "stock_movement",  label: "Stock movement journals",         desc: "Journals for stock in and out, at the computed cost.", unit: "movement", module: "Items", minutes: 5, counts: "Stock movements whose journal Klay drafted at the computed unit cost, cost of goods sold included — counted once posted.", source: { label: "Items", to: "/items" } },
  { key: "bulk_transfer",   label: "Bulk transfer files",             desc: "Vendor payments exported to one bank upload file.", unit: "payment", module: "Payables", minutes: 3,  counts: "Payments sent in a bank file Klay exported, instead of keyed one by one.", source: { label: "Payments", to: "/payments" } },
  { key: "tax_rows",        label: "Tax Register rows",               desc: "Monthly PPN and PPh recap compiled for you.", unit: "row",     module: "Reports", minutes: 2,  counts: "Rows Klay compiled for the masa pajak recap.", source: { label: "Tax Register", to: "/reports/tax-register" } },
];

// Money guarded runs on the backend's flag catalog for bills (AP) and invoices
// (AR): `subledger_document_exception_catalog`, gl migration 250, commit
// 355050685, 18 Nov 2026. `live: false` marks a code the catalog defines but
// nothing on main raises yet — listed so the gap is visible, never counted.
//
// Money guarded counts only the catalog codes below — money at risk. Every
// other code is left out (NOT_COUNTED): data quality (scan reading, missing
// fields, journal building, vendor/customer data — they guard the books, not
// money), workflow and approval controls, and information.
// The catalog covers bills and invoices only — there are no payment-release
// codes, so a payment-time catch (duplicate payment, redirected bank account at
// release) has nowhere to come from yet.
//
// `guards` on a code overrides its check's.
const code = (ledger, c, label, live = true, extra = {}) => ({ ledger, code: c, label, live, ...extra });

// `guards`: the outcomes that count as guarded for this check. A RESOLVED flag
// is not always a catch — a duplicate resolves when its invoice no. is
// corrected (it was mis-keyed, not a duplicate), a vendor flag resolves when the
// vendor is approved. Those only count when the document itself was stopped.
export const MONEY_CHECKS = [
  {
    key: "duplicate", label: "Duplicates", desc: "The same bill or invoice entered twice.", basis: "Full document amount", guards: ["stopped"], resolvedLabel: "Resolved",
    codes: [code("AP", "duplicate_invoice", "Possible duplicate bill"), code("AR", "duplicate_invoice", "Possible duplicate invoice")],
    source: { label: "Bills", to: "/bills" },
  },
  {
    key: "tax", label: "Tax mistakes", desc: "Wrong, missing or unconfirmed tax on a bill or invoice.", basis: "Tax difference", guards: ["resolved", "stopped"], resolvedLabel: "Fixed",
    codes: [
      code("AP", "tax_amount_mismatch", "Tax amount doesn't match the invoice"), code("AR", "tax_amount_mismatch", "Tax amount doesn't match the invoice"),
      code("AP", "faktur_missing", "Faktur Pajak is missing"), code("AR", "faktur_missing", "Faktur Pajak is missing"),
      code("AP", "review_tax", "Tax needs a closer look"), code("AR", "review_tax", "Tax needs a closer look"),
      code("AP", "tax_object_unconfirmed", "Some lines need a tax class confirmed"), code("AR", "tax_object_unconfirmed", "Some lines need a tax class confirmed"),
      code("AP", "tax_omitted", "A required tax is missing", false), code("AP", "tax_mismatch", "Unexpected tax applied", false), code("AR", "tax_mismatch", "Unexpected tax applied", false),
    ],
    source: { label: "Bills", to: "/bills" },
  },
  {
    // A wrong bank account printed on our own invoice is fixed by correcting
    // it before it goes out — so on that code, Fixed counts too.
    key: "vendor", label: "Suspicious vendor or bank account", desc: "Unapproved or deactivated vendor, or an unknown bank account on an invoice.", basis: "Document amount", guards: ["stopped"], resolvedLabel: "Cleared",
    guardNote: "Guarded when stopped (or fixed, for a wrong bank account on an invoice)",
    codes: [
      code("AP", "vendor_unapproved", "Vendor not approved"), code("AP", "vendor_blocked", "This vendor is deactivated"),
      code("AR", "company_bank_account_unmatched", "Printed bank account not recognised", true, { guards: ["resolved", "stopped"] }),
      code("AP", "vendor_bank_change", "Vendor bank details changed", false),
    ],
    source: { label: "Vendors", to: "/vendors" },
  },
  {
    key: "amount", label: "Amount errors", desc: "Figures that don't add up, or prices out of pattern.", basis: "Amount over- or under-billed", guards: ["resolved", "stopped"], resolvedLabel: "Fixed", proposed: true,
    codes: [
      code("AP", "arithmetic_mismatch", "The invoice figures don't add up"), code("AR", "arithmetic_mismatch", "The invoice figures don't add up"),
      code("AP", "amount_variance", "A price looks unusual"), code("AR", "amount_variance", "A price looks unusual"),
      code("AP", "bill_total_variance", "Bill total looks unusual"), code("AP", "line_anomaly", "A line looks out of pattern"),
      code("AP", "grn_mismatch", "Goods receipt doesn't match", false),
    ],
    source: { label: "Bills", to: "/bills" },
  },
  {
    // Stopped = the invoice was held until the customer paid down. A limit
    // raised to let it through is Cleared, not a catch.
    key: "credit", label: "Credit risk", desc: "An invoice that takes a customer over their credit limit.", basis: "Amount over the credit limit", guards: ["stopped"], resolvedLabel: "Cleared", proposed: true,
    codes: [code("AR", "credit_limit_exceeded", "Over the credit limit")],
    source: { label: "Customers", to: "/customers" },
  },
  {
    // Not in the backend catalog — it covers bills and invoices only. These
    // are the prototype's release checks (paymentFlags.js), proposed for BE.
    key: "payment", label: "Payment release", desc: "Payments held at release: paid twice, sent to a changed bank account, or with the wrong withholding.",
    basis: "Payment amount (tax difference for withholding)", guards: ["stopped", "resolved"], resolvedLabel: "Fixed", proposed: true,
    codes: [
      code("PAY", "possible_duplicate", "Possible duplicate payment"), code("PAY", "bank_changed", "Vendor bank account changed"),
      code("PAY", "new_account", "New account on an established vendor"), code("PAY", "payee_unapproved", "Payee change not approved"),
      code("PAY", "withholding_mismatch", "Withholding looks wrong"),
    ],
    source: { label: "Payments", to: "/payments" },
  },
  {
    // Not a flag: read from each paid bill's discount due date. Counts money
    // saved rather than protected. Captured = paid on or before that date.
    // The 2% rate is a placeholder — bills carry the date but not the terms.
    key: "discount", label: "Early-payment discounts", desc: "Discounts captured by paying inside the vendor's discount window.",
    basis: "Discount amount (2% placeholder)", guards: ["resolved"], resolvedLabel: "Captured", proposed: true,
    codes: [], modules: ["Payables"], flaggedLabel: "Offered",
    source: { label: "Payments", to: "/payments" },
  },
];
// The module(s) a check runs in, from the ledgers of its codes: bills are
// Payables, invoices Receivables.
MONEY_CHECKS.forEach((c) => {
  const ledgers = new Set(c.codes.map((x) => x.ledger));
  c.modules = c.modules || [(ledgers.has("AP") || ledgers.has("PAY")) && "Payables", ledgers.has("AR") && "Receivables"].filter(Boolean);
});
export const CHECK_BY_KEY = Object.fromEntries(MONEY_CHECKS.map((c) => [c.key, c]));

// Raised by the catalog but not counted on this report.
export const NOT_COUNTED = "data-quality flags (scan reading, missing information, journal and posting, vendor and customer data), approval and workflow controls (approval_voided, returned, amount_over_authority, conflicting_duty — self-approval is refused outright, not flagged), information (foreign_currency, large_transaction) and normal events (new_vendor, new_customer, customer_in_dispute)";

// What happened to a flag. Four are the backend's flag states; `stopped` is
// derived — the flag was still OPEN when its bill or invoice was voided or
// rejected (the catalog has no state for that; to confirm with BE).
export const OUTCOMES = {
  stopped:      { label: "Stopped",        be: "OPEN, document voided or rejected", tone: "good",  hint: "The bill or invoice was voided or rejected while the flag was open." },
  resolved:     { label: "Resolved",       be: "RESOLVED",     tone: "good",  hint: "The data changed and the check passes now." },
  acknowledged: { label: "Marked correct", be: "ACKNOWLEDGED", tone: "muted", hint: "Someone clicked \"This is Correct\" — reviewed and found genuine." },
  overridden:   { label: "Overridden",     be: "OVERRIDDEN",   tone: "muted", hint: "A user with authority let a Blocking flag pass, with a note." },
  open:         { label: "Open",           be: "OPEN",         tone: "warn",  hint: "Not resolved yet." },
};
// An event is guarded when its outcome is one its check (or code) counts.
export const isGuarded = (e) => !!e.guards && e.guards.includes(e.outcome);
// A RESOLVED flag reads "Fixed" when it counts, else the
// check's own word: "Resolved" on duplicates, "Cleared" on vendor and credit.
export const outcomeLabel = (e) => {
  if (e.outcome !== "resolved") return OUTCOMES[e.outcome].label;
  if (!e.guards || isGuarded(e)) return "Fixed";
  return CHECK_BY_KEY[e.check].resolvedLabel;
};
export const outcomeTone = (e) => (e.outcome === "resolved" && e.guards && !isGuarded(e) ? "muted" : OUTCOMES[e.outcome].tone);

// ── Deterministic generator ──────────────────────────────────────────────────

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash = (s) => [...String(s)].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);
const pad = (n) => String(n).padStart(2, "0");
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const r1000 = (v) => Math.round(v / 1000) * 1000;

// Klay go-live for the demo company — "Since inception" starts here.
const START = "2024-10-01";
export const KLAY_START = START;
const MONTHS = ["2024-10", "2024-11", "2024-12", "2025-01", "2025-02", "2025-03", "2025-04"];
// Adoption ramps up over the first months — the report should show it.
const RAMP = { "2024-10": 0.2, "2024-11": 0.3, "2024-12": 0.38, "2025-01": 0.45, "2025-02": 0.65, "2025-03": 0.85, "2025-04": 1 };

function businessDays(from, to) {
  const out = [];
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (d <= end) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}
const monthEndOf = (ym) => `${ym}-${pad(lastDay(+ym.slice(0, 4), +ym.slice(5, 7)))}`;

let CACHE = null;

function buildLog() {
  const today = todayIso();
  const R = rng(20261116);
  const pick = (arr) => arr[Math.floor(R() * arr.length)];
  const time = [];
  const money = [];
  const addT = (metric, e) => time.push({ id: `${metric}:${time.length}`, metric, qty: 1, ...e });
  const addM = (check, e) => money.push({ id: `${check}:${money.length}`, check, ...e });
  const closedMonths = MONTHS.filter((ym) => monthEndOf(ym) < today);

  // Bills drafted by Klay and since posted.
  BILLS.filter((b) => b.date >= START && b.je_number && (b.isAI || hash(b.id) % 10 < 7)).forEach((b) => {
    addT("bill_drafted", { date: b.date, docNo: b.invNo && b.invNo !== "—" ? b.invNo : b.id, party: b.vendorName, detail: b.items?.[0]?.desc || "", amount: b.total, to: `/bills/${b.id}` });
  });

  // Sales invoices drafted by Klay and since sent.
  INVOICES.filter((v) => v.date >= START && v.approval === "sent" && (v.isAI || hash(v.id) % 10 < 6)).forEach((v) => {
    addT("invoice_drafted", { date: v.date, docNo: v.invNo, party: v.customerName, detail: v.items?.[0]?.desc || v.items?.[0]?.name || "", amount: v.total, to: "/invoices" });
  });

  // Bank lines matched from Klay's suggestion, Quick draft journals.
  const opAccounts = COMPANY_BANK_ACCOUNTS.filter((a) => a.glAccount && a.group === "operating");
  const parties = [...VENDORS.map((v) => ({ name: v.name, out: true })), ...CUSTOMERS.map((c) => ({ name: c.name, out: false }))];
  const QUICK = [
    ["Parkir & tol — operasional", 185000, 650000],
    ["Top-up e-wallet operasional", 500000, 2500000],
    ["Transfer masuk tanpa invoice — refund vendor", 1200000, 9500000],
    ["Bayar listrik PLN", 3800000, 9200000],
    ["Biaya kirim dokumen", 95000, 480000],
    ["Setoran tunai kasir", 2500000, 15000000],
  ];
  businessDays(START, today).forEach((day) => {
    const ramp = RAMP[day.slice(0, 7)] || 1;
    const n = Math.round((3 + R() * 7) * ramp);
    for (let i = 0; i < n; i += 1) {
      const p = pick(parties);
      const acct = pick(opAccounts);
      const amt = r1000(1500000 + R() * 85000000);
      addT("recon_suggested", { date: day, docNo: acct.name, party: p.name, detail: p.out ? "Vendor payment" : "Customer receipt", amount: p.out ? -amt : amt, to: "/bank-reconciliation" });
    }
    if (R() < 0.45 * ramp) {
      const [desc, lo, hi] = pick(QUICK);
      const acct = pick(opAccounts);
      addT("quick_draft", { date: day, docNo: acct.name, party: "", detail: desc, amount: r1000(lo + R() * (hi - lo)), to: "/bank-reconciliation" });
    }
  });

  // Month-end: bank fees & interest per account, recurring copies, depreciation, tax rows.
  closedMonths.forEach((ym) => {
    const end = monthEndOf(ym);
    opAccounts.forEach((a) => {
      addT("bank_fee", { date: end, docNo: a.name, party: a.bank, detail: "Biaya administrasi bulanan", amount: -r1000(15000 + R() * 35000), to: "/bank-reconciliation" });
      addT("bank_fee", { date: end, docNo: a.name, party: a.bank, detail: "Bunga jasa giro", amount: r1000(40000 + R() * 600000), to: "/bank-reconciliation" });
      addT("bank_fee", { date: end, docNo: a.name, party: a.bank, detail: "Pajak atas bunga jasa giro (20%)", amount: -r1000(8000 + R() * 120000), to: "/bank-reconciliation" });
    });
    addT("depreciation", { date: end, docNo: `Monthly depreciation — ${ym}`, party: "", detail: "Fixed assets", amount: 48650000, to: "/assets" });
    addT("depreciation", { date: end, docNo: `Monthly amortisation — ${ym}`, party: "", detail: "Prepaid expenses", amount: 12400000, to: "/assets" });
    addT("depreciation", { date: end, docNo: `Monthly amortisation — ${ym}`, party: "", detail: "Intangible assets", amount: 3150000, to: "/assets" });
    const rows = 38 + Math.floor(R() * 30 * (RAMP[ym] || 1));
    addT("tax_rows", { date: end, docNo: `Masa ${ym}`, party: "", detail: `${rows} PPN and PPh rows compiled`, qty: rows, amount: null, to: "/reports/tax-register" });
  });
  MONTHS.forEach((ym) => {
    [["01", "Sewa kantor — Gedung Graha", 85000000], ["01", "Langganan software (SaaS)", 14500000], ["05", "Premi asuransi properti", 6200000], ["25", "Tunjangan transport karyawan", 22800000]].forEach(([d, desc, amt]) => {
      const date = `${ym}-${d}`;
      if (date <= today) addT("recurring", { date, docNo: "Recurring journal", party: "", detail: desc, amount: amt, to: "/journal-entry" });
    });
  });

  // Fixed Assets disposals and Items stock movements — their own random
  // source, so adding them didn't move any other line's numbers.
  const R3 = rng(2026111801);
  const pick3 = (arr) => arr[Math.floor(R3() * arr.length)];
  const disposable = ASSETS.filter((a) => a.type === "fixed_asset" && a.category !== "building");
  [["2025-01-28", "Sold", 1], ["2025-02-19", "Scrapped", -1], ["2025-03-12", "Traded in", 1], ["2025-04-09", "Sold", -1]].forEach(([date, reason, sign], i) => {
    const a = disposable[(i * 3) % Math.max(1, disposable.length)];
    if (!a || date > today) return;
    addT("asset_disposal", { date, docNo: a.asset_tag || a.id, party: a.name, detail: `${reason} — ${sign > 0 ? "gain" : "loss"} against book value`, amount: sign * r1000(1500000 + R3() * 18000000), to: `/assets/${a.id}` });
  });
  const stocked = ITEMS.filter((it) => (it.item_type || "stocked") === "stocked");
  const MOVES = ["Goods received — PO", "Issued to production", "Sold — delivery", "Returned to stock — from customer", "Stock count adjustment", "Transfer between locations"];
  businessDays(START, today).forEach((day) => {
    const n = Math.round(R3() * 4 * (RAMP[day.slice(0, 7)] || 1));
    for (let i = 0; i < n; i += 1) {
      const it = pick3(stocked);
      if (!it) return;
      addT("stock_movement", { date: day, docNo: it.sku || it.id, party: it.name, detail: pick3(MOVES), amount: r1000(500000 + R3() * 40000000), to: `/items/${it.id}` });
    }
  });

  // Payments sent through an exported bulk-transfer file.
  BILLS.filter((b) => b.pay === "paid" && b.paymentDate && b.paymentDate >= START && hash(b.id) % 10 < 6).forEach((b) => {
    addT("bulk_transfer", { date: b.paymentDate, docNo: b.invNo && b.invNo !== "—" ? b.invNo : b.id, party: b.vendorName, detail: "Bank file export", amount: -(b.total - (b.pph23 || 0)), to: `/bills/${b.id}` });
  });

  // ── Money guarded ─────────────────────────────────────────────────────────
  const inRange = BILLS.filter((b) => b.date >= START);
  const billRef = (b) => ({ docId: b.id, docNo: b.invNo && b.invNo !== "—" ? b.invNo : b.id, party: b.vendorName, docAmount: b.total, to: `/bills/${b.id}` });
  // Each seeded catch lands on a bill no other seeded catch uses, and on an
  // ordinary-sized one (a single Rp 2 M bill would otherwise be the whole story).
  const used = new Set();
  const pickBills = (n, salt, filter = () => true) => {
    const out = inRange.filter((b) => !used.has(b.id) && b.total <= 600000000 && filter(b)).sort((x, y) => hash(x.id + salt) - hash(y.id + salt)).slice(0, n);
    out.forEach((b) => used.add(b.id));
    return out;
  };

  // Invoices (AR), picked the same way.
  const invRange = INVOICES.filter((v) => v.date >= START && v.date <= today && v.approval === "sent");
  const usedInv = new Set();
  const pickInvoices = (n, salt) => {
    const out = invRange.filter((v) => !usedInv.has(v.id) && v.total > 5000000 && v.total <= 250000000).sort((x, y) => hash(x.id + salt) - hash(y.id + salt)).slice(0, n);
    out.forEach((v) => usedInv.add(v.id));
    return out;
  };
  const invRef = (v) => ({ docId: v.id, docNo: v.invNo, party: v.customerName, docAmount: v.total, to: "/invoices" });
  const dppOf = (v) => v.dpp || Math.round(v.total / 1.11);
  // One flag event: check, BE code, ledger, the document, value at risk, outcome, what happened.
  const flagOn = (check, ledger, flagCode, doc, value, outcome, note) => {
    const def = CHECK_BY_KEY[check].codes.find((c) => c.ledger === ledger && c.code === flagCode);
    addM(check, { ...(ledger === "AP" ? billRef(doc) : invRef(doc)), date: doc.date, ledger, flag: flagCode, flagLabel: def.label, guards: def.guards || CHECK_BY_KEY[check].guards, value: r1000(value), outcome, note });
  };

  // Duplicates (duplicate_invoice, AP and AR) — value is the whole document.
  // Guarded only when the duplicate was voided or rejected (Stopped).
  const dupSeed = BILLS.filter((b) => (b.anomalies || []).some((a) => /duplicate/i.test(a.description)));
  dupSeed.forEach((b) => used.add(b.id));
  dupSeed.forEach((b) => flagOn("duplicate", "AP", "duplicate_invoice", b, b.total, b.approval === "review" ? "open" : "stopped", b.anomalies.find((a) => /duplicate/i.test(a.description)).description));
  [
    ["stopped", "Same vendor, invoice no. and amount as a bill posted 6 days earlier — the vendor re-sent it by email. Voided."],
    ["stopped", "Scanned copy of an invoice already entered from the original PDF. Voided."],
    ["acknowledged", "Same amount, but a separate monthly delivery — marked correct."],
    ["stopped", "Same amount and PO, invoice no. differs by one digit — vendor confirmed it was a resend. Rejected."],
    ["resolved", "Invoice no. was mis-keyed; corrected, and the check passes. Not a duplicate."],
    ["stopped", "Forwarded twice from the AP inbox a day apart. Rejected."],
  ].forEach(([outcome, note], i) => {
    const b = pickBills(1, `dup${i}`, (x) => x.total > 5000000)[0];
    if (b) flagOn("duplicate", "AP", "duplicate_invoice", b, b.total, outcome, note);
  });
  pickInvoices(2, "dup").forEach((v, i) => flagOn("duplicate", "AR", "duplicate_invoice", v, v.total,
    i === 0 ? "stopped" : "acknowledged",
    i === 0 ? "Same customer, PO and amount as an invoice sent last week — the customer would have been billed twice. Voided." : "Recurring monthly retainer, same amount by design — marked correct."));

  // Tax mistakes — value is the tax difference. Only live codes raise.
  [
    ["AP", "tax_amount_mismatch", "resolved", (d) => dppOf(d) * 0.011, "PPN keyed from the scan didn't match DPP × 11% on the faktur. Corrected to the faktur."],
    ["AP", "faktur_missing", "resolved", (d) => dppOf(d) * 0.11, "No Faktur Pajak attached — the PPN input credit was at risk. Vendor sent the faktur."],
    ["AP", "review_tax", "resolved", (d) => dppOf(d) * 0.02, "Service line with no PPh 23 withheld. Withholding added before posting."],
    ["AP", "tax_object_unconfirmed", "resolved", (d) => dppOf(d) * 0.08, "Building rent classed as PPh 23 (2%); reclassed to PPh 4(2) (10%)."],
    ["AP", "review_tax", "acknowledged", (d) => dppOf(d) * 0.02, "Goods-only invoice; confirmed no withholding."],
    ["AR", "tax_amount_mismatch", "resolved", (d) => dppOf(d) * 0.004, "PPN rounded per line instead of per document. Corrected before sending."],
    ["AP", "faktur_missing", "resolved", (d) => dppOf(d) * 0.11, "Faktur Pajak number missing; captured from the vendor's e-Faktur."],
    ["AP", "review_tax", "open", (d) => dppOf(d) * 0.02, "Marketing service with no PPh 23 applied — waiting on AP."],
    ["AP", "tax_object_unconfirmed", "resolved", (d) => dppOf(d) * 0.02, "Courier lines had no tax class; set to PPh 23 and withholding added."],
    ["AR", "faktur_missing", "acknowledged", (d) => dppOf(d) * 0.11, "Faktur issued directly in e-Faktur, outside Klay — marked correct."],
    ["AP", "tax_amount_mismatch", "resolved", (d) => dppOf(d) * 0.006, "Tax on the bill didn't match the vendor's invoice. Corrected."],
    ["AP", "faktur_missing", "acknowledged", (d) => dppOf(d) * 0.11, "Non-PKP vendor — no faktur expected. Marked correct."],
  ].forEach(([ledger, c, outcome, val, note], i) => {
    const d = ledger === "AP" ? pickBills(1, `tax${i}`, (b) => b.dpp > 4000000)[0] : pickInvoices(1, `tax${i}`)[0];
    if (d) flagOn("tax", ledger, c, d, val(d), outcome, note);
  });

  // Suspicious vendor (vendor_unapproved, vendor_blocked). vendor_bank_change
  // isn't raised yet. Guarded only when the bill was stopped; a vendor that
  // was approved or reactivated is Cleared, not a catch.
  [
    ["vendor_unapproved", "stopped", "Vendor failed KYC — the NPWP didn't match the company name. Bill rejected, vendor not onboarded."],
    ["vendor_unapproved", "resolved", "Vendor approved in Vendor Master after KYC; the bill went ahead."],
    ["vendor_blocked", "stopped", "Bill from a deactivated vendor whose contract ended in December. Rejected."],
    ["vendor_unapproved", "resolved", "New supplier approved by the Finance Manager the same day."],
    ["vendor_blocked", "resolved", "Vendor reactivated for a final invoice under the old contract."],
    ["vendor_unapproved", "stopped", "Bill from a \"vendor\" set up by the requester themself; no PO or contract on file. Rejected."],
  ].forEach(([c, outcome, note], i) => {
    const b = pickBills(1, `ven${i}`, (x) => x.total > 10000000)[0];
    if (b) flagOn("vendor", "AP", c, b, b.total, outcome, note);
  });

  // Amount errors (proposed): arithmetic_mismatch, amount_variance,
  // bill_total_variance. grn_mismatch isn't raised yet, so GRN anomalies are left out.
  inRange.filter((b) => b.total <= 600000000 && (b.anomalies || []).some((a) => /higher than|× higher|po total/i.test(a.description))).forEach((b, i) => {
    used.add(b.id);
    const t = b.anomalies.find((x) => /higher than|× higher|po total/i.test(x.description)).description;
    const pct = t.match(/(\d+)% higher/);
    const times = t.match(/(\d+)× higher/);
    const over = pct ? b.total - b.total / (1 + pct[1] / 100) : times ? b.total - b.total / Number(times[1]) : b.total * 0.22;
    const c = /po total/i.test(t) ? "bill_total_variance" : "amount_variance";
    flagOn("amount", "AP", c, b, over, ["resolved", "acknowledged", "stopped", "open"][i % 4], t);
  });
  [
    ["resolved", 0.031, "Line totals summed to more than the invoice total — a quantity was keyed twice. Corrected to the vendor's figures."],
    ["resolved", 0.012, "DPP + PPN didn't equal the total printed on the invoice. Vendor re-issued a corrected invoice."],
    ["stopped", 0.08, "Unit price × qty on two lines didn't match the line amounts; vendor couldn't explain. Bill rejected."],
  ].forEach(([outcome, share, note], i) => {
    const b = pickBills(1, `arith${i}`, (x) => x.total > 8000000)[0];
    if (b) flagOn("amount", "AP", "arithmetic_mismatch", b, b.total * share, outcome, note);
  });
  [
    ["AP", "line_anomaly", "resolved", 0.06, "Freight line at 3× the usual rate for this route — vendor had charged express. Corrected to regular."],
    ["AP", "line_anomaly", "acknowledged", 0.04, "Larger order than usual for year-end stock-up — marked correct."],
    ["AR", "arithmetic_mismatch", "resolved", 0.025, "Line totals summed to less than the quantities ordered — a line was left at 0. Corrected before sending; the customer would have been under-billed."],
    ["AR", "amount_variance", "acknowledged", 0.1, "Price below this customer's usual — agreed promotional discount. Marked correct."],
  ].forEach(([ledger, c, outcome, share, note], i) => {
    const d = ledger === "AP" ? pickBills(1, `amt${i}`, (x) => x.total > 8000000)[0] : pickInvoices(1, `amt${i}`)[0];
    if (d) flagOn("amount", ledger, c, d, d.total * share, outcome, note);
  });

  // A bank account on our own invoice we don't recognise — the customer would
  // pay into it. Fixed (corrected before sending) counts here.
  [
    ["resolved", "Invoice template still printed an old, closed BCA account. Corrected to BCA Operating before sending."],
    ["resolved", "Bank account on the invoice PDF didn't match any company account — the file had been edited. Re-issued from Klay."],
    ["acknowledged", "New Mandiri collection account opened this month — added to bank accounts. Marked correct."],
  ].forEach(([outcome, note], i) => {
    const v = pickInvoices(1, `bank${i}`)[0];
    if (v) flagOn("vendor", "AR", "company_bank_account_unmatched", v, v.total, outcome, note);
  });

  // Credit risk (proposed): the amount over the customer's limit.
  [
    ["stopped", 0.35, "Customer already over the limit, with invoices 60+ days overdue. Invoice held until they paid down."],
    ["resolved", 0.2, "Credit limit raised by the Finance Manager after a review — cleared, not a catch."],
    ["acknowledged", 0.1, "One-off project order, approved as an exception."],
    ["stopped", 0.5, "New order on top of an unpaid balance. Held; customer moved to cash-before-delivery."],
  ].forEach(([outcome, share, note], i) => {
    const v = pickInvoices(1, `credit${i}`)[0];
    if (v) flagOn("credit", "AR", "credit_limit_exceeded", v, v.total * share, outcome, note);
  });

  // Payment release (proposed) — caught when the money was about to leave.
  const PAY_CASES = [
    ["possible_duplicate", "stopped", 1, "The same bill was already paid on an earlier run — pulled from the batch."],
    ["bank_changed", "stopped", 1, "Vendor's bank changed by email two days before release; the vendor confirmed it wasn't them. Held."],
    ["new_account", "acknowledged", 1, "New account on an established vendor — verified with the vendor by phone, then released."],
    ["payee_unapproved", "stopped", 1, "Payee edited to a personal account just before release. Change rejected."],
    ["withholding_mismatch", "resolved", 0.08, "Building rent keyed with PPh 23 (2%) instead of PPh 4(2) (10%). Corrected before release."],
    ["possible_duplicate", "acknowledged", 1, "Two deliveries for the same amount — both genuine, released."],
    ["withholding_mismatch", "resolved", 0.02, "Withholding computed on the total instead of the DPP. Corrected."],
  ];
  PAY_CASES.forEach(([c, outcome, share, note], i) => {
    const b = pickBills(1, `pay${i}`, (x) => x.pay === "paid" && x.paymentDate && x.total > 8000000)[0];
    if (!b) return;
    const def = CHECK_BY_KEY.payment.codes.find((x) => x.code === c);
    const amount = share === 1 ? b.total - (b.pph23 || 0) : (b.dpp || b.total) * share;
    addM("payment", { ...billRef(b), date: b.paymentDate, ledger: "PAY", flag: c, flagLabel: def.label, guards: CHECK_BY_KEY.payment.guards, value: r1000(amount), outcome, note, to: "/payments" });
  });

  // Early-payment discounts (proposed) — real paid bills with a discount date.
  BILLS.filter((b) => b.pay === "paid" && b.paymentDate && b.discountDueDate && b.paymentDate >= START).forEach((b) => {
    const captured = b.paymentDate <= b.discountDueDate;
    addM("discount", {
      ...billRef(b), date: b.paymentDate, ledger: "AP", flag: "early_payment_discount", flagLabel: "Early-payment discount",
      guards: CHECK_BY_KEY.discount.guards, value: r1000((b.dpp || b.total) * 0.02), outcome: captured ? "resolved" : "open",
      note: captured ? `Paid ${b.paymentDate}, inside the window to ${b.discountDueDate}.` : `Paid ${b.paymentDate}, after the window closed ${b.discountDueDate}.`,
    });
  });

  const byDate = (x, y) => y.date.localeCompare(x.date) || x.id.localeCompare(y.id);
  return { time: time.filter((e) => e.date <= today).sort(byDate), money: money.filter((e) => e.date <= today).sort(byDate) };
}

export function impactLog() {
  if (!CACHE) CACHE = buildLog();
  return CACHE;
}

// ── Summaries ────────────────────────────────────────────────────────────────

const within = (e, from, to) => e.date >= from && e.date <= to;

// Distinct documents guarded, each at its largest guarded value.
function guardedTotal(events) {
  const best = new Map();
  events.filter(isGuarded).forEach((e) => {
    best.set(e.docId, Math.max(best.get(e.docId) || 0, e.value));
  });
  return { docs: best.size, value: [...best.values()].reduce((s, v) => s + v, 0) };
}

export function summarizeImpact({ from, to }) {
  const { time, money } = impactLog();
  const t = time.filter((e) => within(e, from, to));
  const m = money.filter((e) => within(e, from, to));
  const timeRows = TIME_METRICS.map((def) => {
    const events = t.filter((e) => e.metric === def.key);
    const count = events.reduce((s, e) => s + e.qty, 0);
    return { ...def, events, count, totalMinutes: count * def.minutes };
  });
  const moneyRows = MONEY_CHECKS.map((def) => {
    const events = m.filter((e) => e.check === def.key);
    const flaggedDocs = new Set(events.map((e) => e.docId)).size;
    const atRisk = events.reduce((s, e) => s + e.value, 0);
    const guarded = guardedTotal(events);
    const acknowledged = events.filter((e) => e.outcome === "acknowledged").length;
    const open = events.filter((e) => e.outcome === "open").length;
    return { ...def, events, flaggedDocs, atRisk, stoppedDocs: guarded.docs, guarded: guarded.value, acknowledged, open };
  });

  const totalMinutes = timeRows.reduce((s, r) => s + r.totalMinutes, 0);
  const taskCount = timeRows.reduce((s, r) => s + r.count, 0);
  const guarded = guardedTotal(m);
  return {
    timeRows,
    moneyRows,
    totalMinutes,
    taskCount,
    guardedValue: guarded.value,
    guardedDocs: guarded.docs,
    // Discounts offered aren't flags — left out of the flagged total.
    flaggedDocs: new Set(m.filter((e) => CHECK_BY_KEY[e.check].codes.length).map((e) => e.docId)).size,
  };
}

// ── Formatting ───────────────────────────────────────────────────────────────

// "45 min", "6 h 40 m"
export function fmtDuration(min) {
  if (!min) return "—";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h.toLocaleString("id-ID")} h ${m} m` : `${h.toLocaleString("id-ID")} h`;
}
export const fmtHours = (min) => `${Math.round(min / 60).toLocaleString("id-ID")} hrs`;

// Indonesian short form: "Rp 412 jt", "Rp 1,24 M".
export function fmtRpShort(v) {
  const a = Math.abs(v || 0);
  if (a >= 1e9) return `Rp ${(a / 1e9).toLocaleString("id-ID", { maximumFractionDigits: 2 })} M`;
  if (a >= 1e6) return `Rp ${Math.round(a / 1e6).toLocaleString("id-ID")} jt`;
  return `Rp ${a.toLocaleString("id-ID")}`;
}

// Change vs the previous period, as a signed whole percent (null when there's no base).
export const pctChange = (now, before) => (before ? Math.round(((now - before) / before) * 100) : null);
