// The payment request axis and the actions each role takes on it.
//
// This is the single source for payment CTAs. The Payment list and Bill Detail
// both render the same pipeline, and when each kept its own label set they
// drifted — the list offered "Record payment" on an approved bill while Detail
// offered "Mark as paid" for the same act on the same bill. One entry per
// action, two renderings: `short` for a table's action column, `full` for a
// detail page or a bulk bar where there is no column header to give context
// (on a bill page a bare "Approve" would read as approving the bill itself).

// Where the CURRENT request sits. Three values only: recording a payment ends
// the cycle and returns the bill to "not yet requested", so a remaining balance
// can be requested again. Neither "paid" nor "returned" belongs here — how much
// is paid off is the other axis, and a returned request is an exception on the
// bill, not a state it rests in.
//
// "Settled" is deliberately absent from BOTH axes: it is reserved for the
// moment Bank Reconciliation confirms the money actually moved. We have paid;
// we do not yet have settled.
export const REQ_META = {
  notyet:    { label: "No request", tone: "muted"  },
  requested: { label: "Requested",  tone: "review" },
  approved:  { label: "Approved",   tone: "action" },
};

// Role → the stage that persona works. Capabilities come from roles.js:
// AP Staff request, Finance Manager approves, Finance Staff executes.
export const PAYMENT_ROLES = {
  request: {
    stage: "request",
    short: "Request",
    full: "Request payment",
    bulk: "Request payment",
    actsOn: (s) => s === "notyet",
  },
  approve: {
    stage: "approval",
    short: "Approve",
    full: "Approve payment",
    bulk: "Approve payment",
    secondary: "Return",
    actsOn: (s) => s === "requested",
  },
  execute: {
    stage: "execution",
    short: "Record payment",
    full: "Record payment",
    bulk: "Pay in full",
    actsOn: (s) => s === "approved",
  },
  view: null,
};

// The stage a persona works. Only one, so nobody sees two sides of the same
// gate — approving and executing your own request is the thing the gate exists
// to prevent.
export function payModeFor(hasCapability) {
  if (hasCapability("payment.approve")) return "approve";
  if (hasCapability("payment.request")) return "request";
  if (hasCapability("payment.execute")) return "execute";
  return "view";
}

// Payment status is DERIVED from the ledger, never stored. How much of a bill
// is paid off is a fact about its balance: storing it alongside `sisa` gives two
// places to disagree, and they will. Recording a payment reduces the balance,
// and the status follows from that by itself.
export function paymentStatusOf(bill) {
  if (!bill) return "unpaid";
  if (bill.pay === "paid" || bill.sisa === 0) return "paid";
  if (bill.sisa != null && bill.sisa < bill.total) return "partial";
  return "unpaid";
}

// The action this persona can take on this stage, or null. `variant` picks the
// rendering: "short" for a table row, "full" for a detail page.
export function paymentActionFor(payMode, stage, variant = "full") {
  const role = PAYMENT_ROLES[payMode];
  if (!role || !role.actsOn(stage)) return null;
  return { label: role[variant] || role.full, secondary: role.secondary || null, role };
}

// Only the stages that actually move money are gated by the release checks.
// Gating the request stage too would mean a blocking flag is never seen by
// anyone but the person who raised the payment.
export const gatesRelease = (payMode) => payMode === "approve" || payMode === "execute";
