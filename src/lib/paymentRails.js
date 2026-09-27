// How a bank transfer travelled, and how long that rail takes to clear.
//
// The bank statement does not say. It gives a date, an amount, a direction, a
// line of description and the balances — nothing that names BI-FAST or SKN as
// a field. So the rail is something WE record, on the payment, at the moment we
// send it (`breakdown.rail`), and reconciliation reads it from there when it
// decides whether a payment the bank has not shown yet is late or merely in
// flight. A payment recorded without one falls back to UNKNOWN, which allows a
// generic two business days and says so.
//
// Clearance windows are the published ones — BI-FAST is near-instant, RTGS
// settles inside the same operating window, SKNBI is next business day.

export const RAILS = {
  BI_FAST: { key: "BI_FAST", label: "BI-FAST", clearsInDays: 0, note: "clears within hours" },
  RTGS:    { key: "RTGS",    label: "BI-RTGS", clearsInDays: 0, note: "clears inside the same operating window (07:00–17:00 WIB)" },
  SKNBI:   { key: "SKNBI",   label: "SKNBI",   clearsInDays: 1, note: "settles the next business day" },
  UNKNOWN: { key: "UNKNOWN", label: "an unrecorded method", clearsInDays: 2, note: "was not recorded on the payment, so Klay allows two business days" },
};

// What the Record Payment form offers. "Not sure" is a real answer, not a
// missing one: it stores "" and the reconciliation falls back to UNKNOWN.
export const RAIL_OPTIONS = [
  { key: "BI_FAST", label: "BI-FAST" },
  { key: "RTGS",    label: "RTGS" },
  { key: "SKNBI",   label: "SKN" },
  { key: "",        label: "Not sure" },
];

export const railOf = (key) => RAILS[key] || RAILS.UNKNOWN;
