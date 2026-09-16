// Bills that are already part-paid when the prototype loads.
//
// The two status axes are independent, so a part-paid bill can sit at ANY point
// of the request cycle: nobody has asked for the remainder yet, someone has
// asked, or it has been approved and is waiting to be executed. These three
// deliberately span all three, because a seed that only ever produced
// "Partial + Approved" made the two axes look like one.
//
// `remainingShare` is what is left open as a fraction of the bill total — the
// ledger balance is the ONLY thing that makes a bill read as Partial, since
// payment status is derived from it (paymentStatusOf in lib/paymentStage.js).

export const PARTIAL_SEED = {
  BILL009: { remainingShare: 0.45, request: "notyet" },
  BILL015: { remainingShare: 0.60, request: "requested" },
  BILL022: { remainingShare: 0.30, request: "approved" },
};

export const PARTIAL_IDS = Object.keys(PARTIAL_SEED);
