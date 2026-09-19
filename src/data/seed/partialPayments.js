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
  // A consulting bill carrying PPh 23, so the payment history has a case where
  // what cleared the payable and what reached the vendor are different numbers.
  // Without one, withholding only ever appears on bills nobody has paid yet.
  BILL068: { remainingShare: 0.35, request: "notyet" },
};

export const PARTIAL_IDS = Object.keys(PARTIAL_SEED);
