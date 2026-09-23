// How many people must approve a payment, and why.
//
// This is the orchestrator, not a ladder. A fixed multi-level chain
// (staff → manager → director) costs every payment the same number of
// signatures regardless of what it is, which is how approval becomes a
// rubber stamp: if a Rp 2 juta electricity bill needs the same three
// approvals as Rp 2 miliar, nobody reads either. Here the requirement is
// DERIVED from the payment — an amount band sets the base, and a small set
// of condition rules can raise it.
//
// Two invariants make the result auditable:
//
//   1. Rules may only ADD approvals, never remove them. The derivation is
//      therefore always a readable sentence — "base 1, +1 because the amount
//      is above Rp 500 jt" — and no rule can ever explain why something
//      slipped through with fewer eyes than the band called for.
//
//   2. The total is capped. Three approvals in a company with one finance
//      manager and one director is not a control, it is a queue. The cap is
//      part of the output so the UI can say the cap bit rather than silently
//      swallowing a rule.
//
// The evaluation input is a PAYMENT, never a bill. A part-paid bill crosses
// a band in slices, so a Rp 800 jt bill paid in four instalments would duck a
// Rp 250 jt band four times if the band were read off the bill total.

import { ROLE_CAPS, ROLES, USERS } from "../data/seed/roles";

export const MAX_APPROVALS = 2;

// The delegation-of-authority matrix, as data. Bands are contiguous and
// ordered; `from` is inclusive, the next band's `from` is the exclusive
// ceiling. The lowest band may require zero approvals — that is a real and
// common policy choice, and it does not leave the payment unchecked: the
// person who requests a payment is never the person who executes it, so two
// humans still touch it. What zero buys is that the Finance Manager's
// attention is spent on the payments where it changes an outcome.
export const DEFAULT_BANDS = [
  { id: "b1", from: 0,          approvals: 0 },
  { id: "b2", from: 10000000,   approvals: 1 },
  { id: "b3", from: 500000000,  approvals: 2 },
];

// Conditions that add an approver. Every one of these is a fact Klay already
// knows at release time — the same signals the payment flag engine reads —
// so this is a second consumer of existing evidence, not a new data model.
export const ADD_RULES = [
  {
    key: "bank_changed",
    label: "Vendor's bank account changed recently",
    hint: "Within the last 14 days.",
    why: "Redirection fraud is a change to where the money goes, not to the amount. A large payment to a long-standing account is safer than a small one to an account that moved last week.",
    defaultOn: true,
  },
  {
    key: "vendor_run_total",
    label: "Total to one vendor in a run is large",
    hint: "Above the top band, summed across every payment to that vendor in the same run.",
    why: "Closes the slicing loophole: without it, four payments of Rp 200 jt each clear a Rp 500 jt band that one payment of Rp 800 jt would not.",
    defaultOn: true,
  },
  {
    key: "first_payment",
    label: "First payment to this vendor",
    hint: "No payment to this vendor has ever been executed.",
    why: "There is no history to compare the account against, so the only check available is a second person reading the vendor record.",
    defaultOn: false,
  },
  {
    key: "giro",
    label: "Paid by giro",
    hint: "Post-dated cheque.",
    why: "The bill is relieved now and the money moves later, so the mistake surfaces weeks after the decision and is harder to recall than a transfer.",
    defaultOn: false,
  },
];

export const ADD_RULE_BY_KEY = Object.fromEntries(ADD_RULES.map((r) => [r.key, r]));

export function defaultPolicy() {
  return {
    bands: DEFAULT_BANDS.map((b) => ({ ...b })),
    rules: Object.fromEntries(ADD_RULES.map((r) => [r.key, r.defaultOn])),
  };
}

// The band a payment amount falls into — the last band whose floor it clears.
export function bandFor(bands, amount) {
  let hit = bands[0];
  for (const b of bands) if (amount >= b.from) hit = b;
  return hit;
}

// The band's exclusive ceiling, or null for the open-ended top band. Used for
// labelling and for keeping the table contiguous when a floor is edited.
export function bandCeiling(bands, i) {
  return i + 1 < bands.length ? bands[i + 1].from : null;
}

// What this payment needs, and the reasoning that produced it.
//
//   payment: { amount, bankChangedDays, isFirstPayment, method, vendorRunTotal }
//
// Returns { count, uncapped, capped, reasons[] } — `reasons` in the order they
// applied, each carrying its own delta so the UI can render the arithmetic
// rather than restate it.
export function requiredApprovals(payment = {}, policy = defaultPolicy()) {
  const amount = Number(payment.amount) || 0;
  const bands = policy.bands || [];
  const rules = policy.rules || {};
  const band = bandFor(bands, amount);
  const reasons = [];

  const base = band?.approvals ?? 0;
  reasons.push({
    key: "band",
    delta: base,
    text: base === 0
      ? "No approval required at this amount — released on request"
      : `Base ${base} — the amount falls in the ${base === 1 ? "single" : "dual"}-approval band`,
  });

  const add = (key, text) => {
    if (!rules[key]) return;
    reasons.push({ key, delta: 1, text });
  };

  if ((payment.bankChangedDays ?? null) !== null && payment.bankChangedDays <= 14) {
    add("bank_changed", `+1 — the vendor's bank account changed ${payment.bankChangedDays} day${payment.bankChangedDays === 1 ? "" : "s"} ago`);
  }
  const topFloor = bands.length ? bands[bands.length - 1].from : Infinity;
  if ((payment.vendorRunTotal || 0) > topFloor && (payment.vendorRunTotal || 0) > amount) {
    add("vendor_run_total", "+1 — the total to this vendor in the run is above the top band");
  }
  if (payment.isFirstPayment) {
    add("first_payment", "+1 — first payment we have ever made to this vendor");
  }
  if (payment.method === "giro") {
    add("giro", "+1 — paid by giro");
  }

  const uncapped = reasons.reduce((s, r) => s + r.delta, 0);
  const count = Math.min(uncapped, MAX_APPROVALS);
  return { count, uncapped, capped: uncapped > count, band, reasons };
}

// ── Approver seats ─────────────────────────────────────────────────────────
// Who may approve, and up to how much. A band sets HOW MANY signatures; a
// seat's limit sets WHOSE signature counts. Both are needed: two approvals
// from two people who each top out at Rp 100 jt do not authorise Rp 2 miliar.
const roleHasApprove = (roleKey) => (ROLE_CAPS[roleKey]?.ap || []).includes("payment.approve");

export function approverSeats() {
  return USERS
    .filter((u) => u.status === "Active" && (u.roleKeys || []).some(roleHasApprove))
    .map((u) => ({
      id: u.id,
      name: u.name,
      roleLabel: (u.roleKeys || [])
        .filter(roleHasApprove)
        .map((k) => ROLES.find((r) => r.key === k)?.name || k)
        .join(" · "),
      limit: u.approval_limit,   // null = no ceiling
    }));
}

// Where a policy cannot actually be satisfied by the people who hold the
// capability. A settings page that lets you save an unreachable rule is worse
// than one that refuses it, because the failure surfaces at the moment
// somebody is trying to pay a vendor.
export function policyGaps(policy, seats) {
  const gaps = [];
  const maxBandApprovals = Math.max(0, ...policy.bands.map((b) => b.approvals));
  if (seats.length < maxBandApprovals) {
    gaps.push({
      key: "seats",
      text: `The policy asks for ${maxBandApprovals} approvals, but only ${seats.length} ${seats.length === 1 ? "person holds" : "people hold"} Approve payment. Payments in that band cannot be released.`,
    });
  }
  const ceiling = seats.reduce((m, s) => (s.limit == null ? Infinity : Math.max(m, s.limit)), 0);
  const topFloor = policy.bands.length ? policy.bands[policy.bands.length - 1].from : 0;
  if (ceiling !== Infinity && ceiling <= topFloor) {
    gaps.push({
      key: "limit",
      text: `The highest approval limit is Rp ${ceiling.toLocaleString("id-ID")}, below the top band's floor of Rp ${topFloor.toLocaleString("id-ID")}. Nobody can approve a payment above it.`,
    });
  }
  return gaps;
}
