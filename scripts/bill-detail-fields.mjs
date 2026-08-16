// Deterministic derivation of the extended Bill Detail fields. Shared by the
// master-data generator (so newly generated bills carry the fields) and the
// one-off migration that backfills the existing seed records. Pure functions
// of the bill + its vendor — no RNG — so the seed stays stable across runs.

function offsetDays(isoDate, days) {
  const d = new Date(isoDate + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function deriveBillDetailFields(b, vendor, idx) {
  const dpp = b.dpp || 0;

  // Rate back-derived from the seeded amount so existing PPh totals stay
  // consistent; falls back to zero when the amount is absent.
  const pphRate = dpp > 0 && b.pph23 ? Math.round((b.pph23 / dpp) * 10000) / 10000 : 0;

  const num = idx != null ? idx : (parseInt(String(b.id).replace(/\D/g, ""), 10) || 0);
  const pad = String(num).padStart(3, "0");

  const hasGrnDoc = b.grn === "matched" || b.grn === "mismatch";
  const recurring = ["NET 30", "NET 45", "NET 60"].includes(vendor?.payment_terms);
  const hasContract = recurring || /kontrak/i.test(b.keterangan || "");
  const paid = b.pay === "paid";

  return {
    pphRate,
    discountDueDate: b.date ? offsetDays(b.date, 10) : "",
    grnNo: hasGrnDoc ? `GRN-${pad}` : "",
    contractNo: hasContract ? `KTR-${(vendor?.code || "V-000").replace("V-", "V")}-2025` : "",
    bankReconStatus: paid ? (num % 4 === 0 ? "unreconciled" : "reconciled") : "",
    paymentDate: paid && b.due ? offsetDays(b.due, -3) : "",
    paymentTime: paid ? "14:30" : "",
  };
}
