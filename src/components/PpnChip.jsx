import { ppnWindowState } from "../lib/ppnWindow";
import "./ppn-chip.css";

// Faktur-pajak (PPN) input-VAT crediting-window chip — Pak Hadi's Priority 1.
// Non-gating: flags a hard tax deadline (90 days from invoice date). Renders
// from 14 days left onwards — amber at 8–14, red at ≤ 7 / today; nothing while
// the window is still open (> 14 days). The EXPIRED "credit lost" state is
// deliberately NOT shown on list/table chips — it lives on Bill Detail only.
export default function PpnChip({ invoiceDate }) {
  const s = ppnWindowState(invoiceDate);
  if (!s || s.tone === "ok" || s.tone === "expired") return null;
  const title = s.tone === "expired"
    ? "Faktur pajak past the 90-day window — input VAT (PPN) can no longer be credited; it is now a cost."
    : "Input-VAT (PPN) crediting window closes 90 days from the invoice date. Process / pay before it lapses to keep the credit.";
  return <span className={`ppn-pill ${s.tone}`} title={title}>{s.text}</span>;
}
