import { useAccountingSettings } from "../state/AccountingSettingsContext";
import "./modules.css";
import "./invoices-ledger.css";
import "./settings-pages.css";

// Settings → Accounting → Inventory. Owns the company-wide inventory costing
// method. It's a foundational policy chosen once at setup and applied to every
// product — it can't be overridden per item, so it lives here rather than on the
// product form.
const OPTIONS = [
  {
    k: "average_cost",
    title: "Average Cost",
    desc: "Every unit on hand is carried at one blended weighted-average cost. Each purchase recomputes the average. Simpler to run and smooths out price swings.",
  },
  {
    k: "actual_cost",
    title: "Actual Cost",
    desc: "Each unit keeps its own purchase cost (specific identification / cost layers). More precise cost of goods sold, but needs per-layer tracking.",
  },
];

export default function InventorySettingsPage() {
  const { inventoryCostingMethod, setInventoryCostingMethod } = useAccountingSettings();

  return (
    <div className="lg-page">
      <div className="lg-scroll-container">
        <div className="lg-head">
          <div className="lg-head-top">
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1 className="lg-title">Inventory</h1>
              <p className="settings-sub">
                How stock is valued across the company. Set once at setup — changing it mid-life restates
                cost of goods sold and inventory value, so it applies to every product and can&rsquo;t be
                overridden per item.
              </p>
            </div>
          </div>
        </div>

        <div className="pp-setting-card">
          <div className="pp-setting-title">Costing method</div>
          <p className="pp-setting-desc">
            The valuation basis Klay uses for every product&rsquo;s stock value and cost of goods sold.
          </p>

          <div className="is-options">
            {OPTIONS.map((o) => {
              const selected = inventoryCostingMethod === o.k;
              return (
                <button
                  key={o.k}
                  type="button"
                  className={`is-option${selected ? " selected" : ""}`}
                  onClick={() => setInventoryCostingMethod(o.k)}
                >
                  <span className="is-option-radio" aria-hidden />
                  <span className="is-option-body">
                    <span className="is-option-title">
                      {o.title}
                      {selected && <span className="is-current">Current</span>}
                    </span>
                    <span className="is-option-desc">{o.desc}</span>
                  </span>
                </button>
              );
            })}
          </div>

          <p className="pp-setting-note">
            This is a foundational policy. In production, changing it after transactions exist would require
            a controlled revaluation — treat it as a one-time setup choice.
          </p>
        </div>
      </div>
    </div>
  );
}
