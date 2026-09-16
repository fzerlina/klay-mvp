// Typed payment breakdown.
//
// A bill is almost never paid off by one transfer of exactly the invoiced
// amount. Some of it is withheld for the tax office, some is a discount, some
// is a rounding difference, some is netted against what the counterparty owes
// us. Every Indonesian SMB tool models that as a single anonymous "deduction"
// box — or, in Accurate's case, teaches users to dump it in the discount-account
// field — which means the ledger records that money moved but never why.
//
// Here every rupiah that closes off a bill carries a named type. The types must
// sum to the amount being cleared: `to_vendor` is the only one that is actual
// cash leaving the bank, so it is also the amount that ends up in a bank file
// and the amount bank reconciliation will later look for on the statement.

// `cash` marks the one component that actually leaves the bank account.
// `deduction` components reduce what the vendor receives without reducing what
// the bill is relieved by — they each need their own accounting treatment.
export const BREAKDOWN_TYPES = [
  {
    key: "to_vendor", label: "To vendor", short: "To vendor", cash: true,
    hint: "Cash that actually leaves the bank for this vendor.",
  },
  {
    key: "withholding", label: "Tax withheld (PPh)", short: "Withheld", deduction: true,
    hint: "Kept back from the vendor and owed to the tax office. Creates a bukti potong obligation.",
  },
  {
    key: "discount", label: "Discount taken", short: "Discount", deduction: true,
    hint: "A discount the vendor has agreed to — early payment or negotiated.",
  },
  {
    key: "write_off", label: "Write-off", short: "Write-off", deduction: true,
    hint: "A balance we have decided not to pay and not to chase.",
  },
  {
    key: "rounding", label: "Rounding", short: "Rounding", deduction: true,
    hint: "A small difference so the bill closes cleanly instead of leaving stray rupiah open.",
  },
  {
    key: "offset", label: "Offset against AR", short: "Offset", deduction: true,
    hint: "Netted against an invoice this counterparty owes us. You choose the counterpart yourself — nothing is proposed automatically.",
  },
  {
    key: "advance_applied", label: "Advance applied", short: "Advance", deduction: true,
    hint: "An advance already paid to this vendor, applied against this bill.",
  },
];

export const BREAKDOWN_BY_KEY = Object.fromEntries(BREAKDOWN_TYPES.map((t) => [t.key, t]));
export const DEDUCTION_TYPES = BREAKDOWN_TYPES.filter((t) => t.deduction);

export function emptyBreakdown() {
  return BREAKDOWN_TYPES.reduce((o, t) => ({ ...o, [t.key]: 0 }), {});
}

// The split a payment starts from: clear the whole open balance, withholding
// whatever PPh the bill already carries. Everything else is zero until someone
// deliberately types it.
export function defaultBreakdown({ remaining = 0, pph23 = 0 } = {}) {
  const b = emptyBreakdown();
  b.withholding = Math.min(pph23 || 0, remaining);
  b.to_vendor = Math.max(0, remaining - b.withholding);
  return b;
}

// What the bill is relieved by — cash plus every deduction.
export const breakdownTotal = (b) =>
  BREAKDOWN_TYPES.reduce((s, t) => s + (Number(b?.[t.key]) || 0), 0);

// What leaves the bank.
export const cashOut = (b) => Number(b?.to_vendor) || 0;

export const deductionTotal = (b) =>
  DEDUCTION_TYPES.reduce((s, t) => s + (Number(b?.[t.key]) || 0), 0);

// Which deduction types carry a value — used to render only the lines in play.
export const activeDeductions = (b) =>
  DEDUCTION_TYPES.filter((t) => (Number(b?.[t.key]) || 0) !== 0);

export function sumBreakdowns(list = []) {
  const t = emptyBreakdown();
  for (const b of list) for (const k of Object.keys(t)) t[k] += Number(b?.[k]) || 0;
  return t;
}

// A payment is only valid if it clears something, clears no more than is open,
// and puts at least a rupiah somewhere.
export function validateBreakdown(b, remaining) {
  const total = breakdownTotal(b);
  if (BREAKDOWN_TYPES.some((t) => (Number(b?.[t.key]) || 0) < 0)) {
    return { ok: false, reason: "No component can be negative." };
  }
  if (total <= 0) return { ok: false, reason: "Allocate at least part of the balance." };
  if (total > remaining) {
    return { ok: false, reason: "The components add up to more than the open balance." };
  }
  return { ok: true, total, paysInFull: total >= remaining };
}

// One-line plain-English description of what the vendor and the tax office get,
// used wherever a payment needs explaining rather than tabulating.
export function describeBreakdown(b) {
  const parts = [`${BREAKDOWN_BY_KEY.to_vendor.short} ${fmtShort(cashOut(b))}`];
  for (const t of activeDeductions(b)) parts.push(`${t.short} ${fmtShort(b[t.key])}`);
  return parts.join(" · ");
}

function fmtShort(n) {
  if (!n) return "Rp 0";
  if (n >= 1e9) return `Rp ${(n / 1e9).toLocaleString("id-ID", { maximumFractionDigits: 1 })} M`;
  if (n >= 1e6) return `Rp ${(n / 1e6).toLocaleString("id-ID", { maximumFractionDigits: 1 })} jt`;
  return `Rp ${n.toLocaleString("id-ID")}`;
}
