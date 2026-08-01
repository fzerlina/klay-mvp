import { useState, useRef } from "react";
import { formatRupiah } from "../lib/format";
import "./modules.css";
import "./invoices-ledger.css";
import "./tax-reconciliation.css";

// Tax Reconciliation — reconciles Indonesian tax documents against the ledger,
// split by Klay's role in the transaction:
//   • As a Customer (purchases) — input VAT (PPN Masukan) from vendors' faktur
//     pajak, and PPh withholding evidenced by bukti potong.
//   • As a Vendor (sales) — output VAT (PPN Keluaran) via faktur pajak issued to
//     customers through Coretax, and PPh withholding bukti potong.
// Each row pairs a tax document (faktur pajak / bukti potong) with its invoice
// or bill and carries a reconciliation status. Scaffold: seeded rows + status;
// the upload / reconcile / Coretax actions are visual stubs for now.

const STATUS = {
  matched:   { label: "Matched",                tone: "ok" },
  pending:   { label: "Pending",                tone: "pending" },
  mismatch:  { label: "Mismatch",               tone: "mismatch" },
  cancelled: { label: "Cancelled · credit note", tone: "cancelled" },
  skipped:   { label: "Skipped",                tone: "skipped" },
};

// Role → its two stacked sections (VAT + Withholding), each with the process
// flow (as documented) and a seeded doc↔invoice reconciliation table.
const MODEL = {
  customer: [
    {
      key: "vat",
      title: "VAT — PPN Masukan (input)",
      blurb: "Creditable input VAT from vendors' faktur pajak, matched to the bill it belongs to.",
      flow: ["Upload faktur pajak from vendor", "Reconcile against the bill"],
      action: "Upload faktur pajak",
      docLabel: "Faktur Pajak",
      partyLabel: "Vendor",
      linkLabel: "Bill",
      rows: [
        { doc: "010.002-25.00000040", party: "PT Agung Elektronik",   link: "INV-V020-20241115", amount: 206061130, status: "matched" },
        { doc: "010.002-25.00000051", party: "Toko Sukses Otomotif",  link: "INV-V021-20241216", amount: 152400000, status: "pending" },
        { doc: "010.002-25.00000062", party: "PT Teknologi Solusi",   link: "INV-V008-20241216", amount: 26220000,  status: "mismatch" },
        { doc: "—",                   party: "UD Mas Distribusi",     link: "INV-V034-20250116", amount: 0,         status: "cancelled" },
        { doc: "—",                   party: "Warung Kopi Lokal",     link: "INV-V088-20250210", amount: 0,         status: "skipped" },
      ],
    },
    {
      key: "wht",
      title: "Withholding — PPh",
      blurb: "PPh withheld on vendor payments, evidenced by the bukti potong the vendor provides.",
      flow: ["Wait for bukti potong from vendor", "Upload", "Reconcile"],
      action: "Upload bukti potong",
      docLabel: "Bukti Potong",
      partyLabel: "Vendor",
      linkLabel: "Bill",
      rows: [
        { doc: "33.001-25.0000210", party: "PT Jasa Logistik Cepat", link: "INV-V020-20250101", amount: 4121000, status: "matched" },
        { doc: "—",                 party: "CV Konsultan Prima",     link: "INV-V042-20250414", amount: 2088000, status: "pending" },
        { doc: "33.001-25.0000225", party: "UD Karya Teknologi",     link: "INV-V031-20250215", amount: 636000,  status: "mismatch" },
      ],
    },
  ],
  vendor: [
    {
      key: "vat",
      title: "VAT — PPN Keluaran (output)",
      blurb: "Output VAT on customer invoices — faktur pajak submitted through Coretax and sent to the customer.",
      flow: ["Submit faktur pajak to Coretax", "Send faktur pajak to customer", "Attach to invoice"],
      action: "Submit to Coretax",
      docLabel: "Faktur Pajak",
      partyLabel: "Customer",
      linkLabel: "Invoice",
      rows: [
        { doc: "010.003-25.00000120", party: "Koperasi Mulia Manufaktur", link: "INV026", amount: 17017000, status: "matched" },
        { doc: "010.003-25.00000121", party: "Nisa Kumala",               link: "INV030", amount: 8800000,  status: "pending" },
        { doc: "—",                   party: "Agus Hartono",              link: "INV055", amount: 0,         status: "cancelled" },
      ],
    },
    {
      key: "wht",
      title: "Withholding — PPh",
      blurb: "PPh withheld by customers. Bukti potong submitted to Coretax; DJP relays the payment proof to the customer.",
      flow: ["Submit bukti potong to Coretax", "Coretax returns payment stub & invoice", "DJP sends payment proof to customer"],
      action: "Submit bukti potong",
      docLabel: "Bukti Potong",
      partyLabel: "Customer",
      linkLabel: "Invoice",
      rows: [
        { doc: "33.003-25.0000088", party: "Koperasi Indah Logistik", link: "INV028", amount: 1318000, status: "matched" },
        { doc: "—",                 party: "Sarah Hartono",           link: "INV045", amount: 1238000, status: "pending" },
      ],
    },
  ],
};

const ROLE_TABS = [
  { k: "customer", lbl: "As a Customer", sub: "Purchases · input tax" },
  { k: "vendor",   lbl: "As a Vendor",   sub: "Sales · output tax" },
];

function rowAction(status) {
  switch (status) {
    case "pending":   return "Reconcile";
    case "mismatch":  return "Review";
    case "cancelled": return "View credit note";
    case "skipped":   return null;
    default:          return "View";
  }
}

export default function TaxReconciliationPage() {
  const [role, setRole] = useState("customer");
  const [toast, setToast] = useState("");
  const tmr = useRef(null);
  const stub = (label) => {
    setToast(`${label} — preview, not wired yet`);
    if (tmr.current) clearTimeout(tmr.current);
    tmr.current = setTimeout(() => setToast(""), 2200);
  };

  const secs = MODEL[role];
  const partyLabel = secs[0].partyLabel;   // Vendor (customer tab) / Customer (vendor tab)
  const linkLabel = secs[0].linkLabel;     // Bill / Invoice
  // Flatten the role's VAT + Withholding rows into one table, tagged by type.
  const rows = secs.flatMap((sec) =>
    sec.rows.map((r) => ({
      ...r,
      type: sec.key === "vat" ? "VAT (PPN)" : "Withholding (PPh)",
      typeSub: sec.key === "vat" ? (role === "customer" ? "PPN Masukan" : "PPN Keluaran") : "PPh",
      docKind: sec.docLabel,
    })),
  );

  return (
    <div className="lg-page">
      <div className="lg-scroll-container">
        <div className="lg-head lg-head-plain">
          <div className="lg-head-top">
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1 className="lg-title">Tax Reconciliation</h1>
              <p className="txr-lede">
                Reconcile faktur pajak and bukti potong against their invoices — input tax on what you buy, output tax on
                what you sell — before the DJP filing. Cancelled invoices with a credit note skip the tax.
              </p>
            </div>
          </div>

          <div className="cc-tabs" role="tablist">
            {ROLE_TABS.map((t) => (
              <button
                key={t.k}
                role="tab"
                aria-selected={role === t.k}
                className={`cc-tab${role === t.k ? " active" : ""}`}
                onClick={() => setRole(t.k)}
              >
                {t.lbl}
              </button>
            ))}
          </div>
        </div>

        <div className="txr-body">
          <div className="txr-card">
            <table className="txr-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Document</th>
                  <th>{partyLabel}</th>
                  <th>{linkLabel}</th>
                  <th className="r">Tax amount</th>
                  <th>Status</th>
                  <th className="ra">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const st = STATUS[r.status] || STATUS.pending;
                  const act = rowAction(r.status);
                  return (
                    <tr key={i}>
                      <td className="txr-type">
                        <span className="txr-type-main">{r.type}</span>
                        <span className="txr-type-sub">{r.docKind}</span>
                      </td>
                      <td className="txr-doc">{r.doc}</td>
                      <td>{r.party}</td>
                      <td className="txr-link">{r.link}</td>
                      <td className="r txr-num">{r.amount > 0 ? formatRupiah(r.amount) : "—"}</td>
                      <td><span className={`txr-pill ${st.tone}`}>{st.label}</span></td>
                      <td className="ra">
                        {act ? <button type="button" className="txr-row-act" onClick={() => stub(`${act} — ${r.party}`)}>{act}</button> : <span className="txr-dash">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {toast && <div className="toast show">{toast}</div>}
    </div>
  );
}
