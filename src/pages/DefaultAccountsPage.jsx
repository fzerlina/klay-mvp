import { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import "./modules.css";
import "./invoices-ledger.css";
import "./settings-pages.css";
import "./roles.css";
import "./default-accounts.css";
import SettingsHeader from "../components/SettingsHeader";
import { AccountCell } from "../components/RecordList";
import { COA } from "../data/seed/coa";
import { COMPANY_BANK_ACCOUNTS } from "../data/seed/bankAccounts";
import { TAX_CODES } from "../data/seed/taxCodes";
import { ITEM_ACCOUNT_ROWS } from "../data/seed/items";
import { ASSET_ACCOUNT_ROWS } from "../data/seed/fixedAssets";
import { useAccountingSettings } from "../state/AccountingSettingsContext";
import { useModuleSettings } from "../state/ModuleSettingsContext";
import { useCurrentUser } from "../state/CurrentUserContext";
import { useSettingsAudit } from "../state/SettingsAuditContext";

// Settings → Accounting → Default accounts. Every account a
// module pre-fills or falls back to, on one page, grouped by module:
//   • company-wide defaults (data/seed/defaultAccounts.js), edited here
//   • defaults set per record — tax code, bank account, vendor / item / asset
//     category — listed here and edited where the record lives
// Changing a default affects what is drafted from then on; nothing already
// posted moves. Editing needs coa.manage, like the chart of accounts.

const LEAVES = COA.filter((a) => a.code && a.is_active).sort((a, b) => a.code.localeCompare(b.code));
const ofTypes = (...types) => (a) => types.includes(a.type);
const cashAndBank = (a) => a.parent === "g-cash";

// One row per company-wide default. `eligible` narrows the picker to accounts
// that make sense for the role; the current account is always offered.
const MODULES = [
  {
    id: "payables",
    title: "Payables",
    rows: [
      { key: "ap", label: "Accounts payable", eligible: ofTypes("liability"),
        hint: "Credited when a bill posts and debited when it's paid. A new vendor starts on it.",
        usedBy: ["Bills", "Payments", "Vendors", "Bank reconciliation", "Cashflow report"] },
      { key: "billExpense", label: "Bill line account", eligible: ofTypes("expense", "asset"),
        hint: "Where a new bill line starts when the vendor has no bill history and its category names no account.",
        usedBy: ["Bills"] },
      { key: "paymentDifference", label: "Payment difference", eligible: ofTypes("expense", "revenue"),
        hint: "Books the gap when a bill is marked fully paid for less than its balance — usually a bank fee the vendor didn't receive.",
        usedBy: ["Payments"] },
    ],
  },
  {
    id: "receivables",
    title: "Receivables",
    rows: [
      { key: "ar", label: "Accounts receivable", eligible: ofTypes("asset"),
        hint: "Debited by an invoice and credited by a receipt. A new customer starts on it.",
        usedBy: ["Invoices", "Customers", "Bank reconciliation", "Cashflow report"] },
      { key: "revenue", label: "Sales revenue", eligible: ofTypes("revenue"),
        hint: "What an invoice credits.",
        usedBy: ["Invoices"] },
    ],
  },
  {
    id: "cash",
    title: "Cash and bank",
    rows: [
      { key: "cash", label: "Cash on hand", eligible: cashAndBank,
        hint: "Credited by a payment from a bank account with no GL account set. The entry is flagged.",
        usedBy: ["Payments"] },
      { key: "pettyCash", label: "Petty cash", eligible: cashAndBank,
        hint: "The same, for a petty cash box with no GL account set.",
        usedBy: ["Payments"] },
    ],
  },
  {
    id: "reconciliation",
    title: "Bank reconciliation",
    rows: [
      { key: "bankIdr", label: "Bank side — IDR", eligible: cashAndBank,
        hint: "The bank line of a fee or interest journal drafted from an IDR statement.",
        usedBy: ["Bank reconciliation"] },
      { key: "bankFx", label: "Bank side — foreign currency", eligible: cashAndBank,
        hint: "The same, for a USD, SGD or EUR statement.",
        usedBy: ["Bank reconciliation"] },
      { key: "bankFee", label: "Bank charges", eligible: ofTypes("expense"),
        hint: "Admin fees and transfer charges the bank debits.",
        usedBy: ["Bank reconciliation"] },
      { key: "interestIncome", label: "Interest income", eligible: ofTypes("revenue"),
        hint: "Interest the bank credits on giro and deposit balances.",
        usedBy: ["Bank reconciliation"] },
      { key: "interestTax", label: "Tax on interest", eligible: ofTypes("expense", "asset"),
        hint: "The final tax (PPh Final) the bank withholds from that interest.",
        usedBy: ["Bank reconciliation"] },
    ],
  },
  {
    id: "inventory",
    title: "Inventory",
    rows: [
      { key: "inventory", label: "Stock account", eligible: ofTypes("asset"),
        hint: "For an item whose category names no inventory account.",
        usedBy: ["Inventory"] },
      { key: "inventoryAdjustment", label: "Stock adjustment", eligible: ofTypes("expense"),
        hint: "The other side of a stock count increase or decrease.",
        usedBy: ["Inventory"] },
      { key: "openingStock", label: "Opening stock", eligible: ofTypes("equity"),
        hint: "The other side of stock entered as an opening balance.",
        usedBy: ["Inventory"] },
    ],
  },
  { id: "fixed-assets", title: "Fixed assets", rows: [] },
  { id: "tax", title: "Tax", rows: [] },
  {
    id: "year-end",
    title: "Year end",
    rows: [
      { key: "retainedEarnings", label: "Retained earnings", eligible: ofTypes("equity"),
        hint: "Where profit from earlier fiscal years is rolled when the trial balance opens a new year.",
        usedBy: ["Trial balance"] },
    ],
  },
];

function DefaultRow({ row, value, canEdit, onChange }) {
  const options = LEAVES.filter((a) => a.code === value || row.eligible(a));
  return (
    <div className="mr-tr da-tr">
      <div className="mr-td">
        <b>{row.label}</b>
        <span className="mr-sub">{row.hint}</span>
      </div>
      <div className="mr-td da-used">{row.usedBy.join(" · ")}</div>
      <div className="mr-td">
        <select className="da-select" value={value || ""} disabled={!canEdit} onChange={(e) => onChange(e.target.value)}
          aria-label={row.label}>
          {options.map((a) => <option key={a.code} value={a.code}>{a.code} · {a.name}</option>)}
        </select>
      </div>
    </div>
  );
}

// A per-record default: a small read-only table and a link to where it's set.
function PerRecord({ title, to, linkLabel, columns, rows }) {
  const grid = columns.map((c) => c.width || "minmax(0,1fr)").join(" ");
  return (
    <div className="da-per">
      <div className="da-per-head">
        <span>{title}</span>
        <Link to={to} className="da-link">{linkLabel} →</Link>
      </div>
      <div className="mr-table">
        <div className="mr-tr mr-th" style={{ gridTemplateColumns: grid }}>
          {columns.map((c) => <div key={c.label}>{c.label}</div>)}
        </div>
        {rows.length === 0 && <div className="mr-empty">None yet.</div>}
        {rows.map((r) => (
          <div key={r.key} className="mr-tr" style={{ gridTemplateColumns: grid }}>
            {columns.map((c) => <div key={c.label} className="mr-td">{c.render(r)}</div>)}
          </div>
        ))}
      </div>
    </div>
  );
}

const acctCol = (label, get) => ({ label, width: "minmax(150px,1.2fr)", render: (r) => <AccountCell code={get(r)} /> });
const nameCol = (label) => ({ label, width: "minmax(140px,1fr)", render: (r) => <b>{r.label}</b> });

export default function DefaultAccountsPage() {
  const { defaultAccounts, setDefaultAccount, reconDifferenceAccounts } = useAccountingSettings();
  const { vendorCategories, itemCategories, assetCategories } = useModuleSettings();
  const { hasCapability } = useCurrentUser();
  const { log } = useSettingsAudit();
  const canEdit = hasCapability("coa.manage");
  // Links like Reconciliation's land on their module (#reconciliation).
  const { hash } = useLocation();
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView({ block: "start" });
  }, [hash]);
  const change = (row, code) => {
    log("Default accounts", "Default accounts", `${row.label}: ${defaultAccounts[row.key]} → ${code}`);
    setDefaultAccount(row.key, code);
  };

  const itemLabel = Object.fromEntries(ITEM_ACCOUNT_ROWS);
  const assetLabel = Object.fromEntries(ASSET_ACCOUNT_ROWS);

  // What each module also takes from its own records.
  const perRecord = {
    payables: (
      <PerRecord
        title="Per vendor category — where a new bill line starts"
        to="/settings/payables/vendor-categories" linkLabel="Vendor categories"
        columns={[nameCol("Category"), acctCol("Bill line account", (c) => c.defaultAccount)]}
        rows={vendorCategories}
      />
    ),
    cash: (
      <PerRecord
        title="Per bank account — what its payments and receipts post to"
        to="/bank-accounts" linkLabel="Bank accounts"
        columns={[nameCol("Bank account"), acctCol("GL account", (b) => b.glAccount)]}
        rows={COMPANY_BANK_ACCOUNTS.filter((b) => b.active).map((b) => ({ ...b, key: b.id, label: b.name }))}
      />
    ),
    reconciliation: (
      <PerRecord
        title="Difference accounts — a manual match may book its gap to one of these"
        to="/settings/reconciliation" linkLabel="Reconciliation"
        columns={[acctCol("Account", (r) => r.key)]}
        rows={reconDifferenceAccounts.map((code) => ({ key: code }))}
      />
    ),
    inventory: (
      <PerRecord
        title="Per item category — an item posts to its category's accounts"
        to="/settings/inventory" linkLabel="Item categories"
        columns={[nameCol("Category"), ...["inventory", "sales", "cogs"].map((k) => acctCol(itemLabel[k] || k, (c) => c.accounts[k]))]}
        rows={itemCategories}
      />
    ),
    "fixed-assets": (
      <PerRecord
        title="Per asset category — an asset posts to its category's accounts"
        to="/settings/fixed-assets" linkLabel="Asset categories"
        columns={[nameCol("Category"), ...["asset", "accumulated", "expense", "loss"].map((k) => acctCol(assetLabel[k] || k, (c) => c.accounts[k]))]}
        rows={assetCategories}
      />
    ),
    tax: (
      <PerRecord
        title="Per tax code — input VAT on bills, output VAT on invoices, PPh withheld at payment"
        to="/tax" linkLabel="Tax codes"
        columns={[{ label: "Tax code", width: "minmax(180px,1.2fr)", render: (t) => <b>{t.name}</b> }, acctCol("Account", (t) => t.account)]}
        rows={TAX_CODES.filter((t) => t.account).map((t) => ({ ...t, key: t.code }))}
      />
    ),
  };

  return (
    <div className="lg-page">
      <div className="lg-scroll-container">
        <SettingsHeader
          title="Default accounts"
          intro="The accounts each module starts from when a bill, payment, invoice or journal doesn't name its own. A change applies to what Klay drafts from then on — nothing already posted moves."
        />
        <nav className="da-jump" aria-label="Modules">
          {MODULES.map((m) => <a key={m.id} href={`#${m.id}`}>{m.title}</a>)}
        </nav>
        {MODULES.map((m) => (
          <section key={m.id} id={m.id} className="mr-section">
            <div className="mr-title">{m.title}</div>
            {m.rows.length > 0 && (
              <div className="mr-table da-table">
                <div className="mr-tr mr-th da-tr">
                  <div>Default</div>
                  <div>Used by</div>
                  <div>Account</div>
                </div>
                {m.rows.map((r) => (
                  <DefaultRow key={r.key} row={r} value={defaultAccounts[r.key]} canEdit={canEdit}
                    onChange={(code) => change(r, code)} />
                ))}
              </div>
            )}
            {perRecord[m.id]}
          </section>
        ))}
        {!canEdit && <p className="mr-ro">Read only — changing these needs the <em>Manage Chart of Accounts</em> capability.</p>}
        <div style={{ height: 40 }} />
      </div>
    </div>
  );
}
