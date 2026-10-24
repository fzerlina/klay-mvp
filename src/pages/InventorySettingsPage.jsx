import { useLocation } from "react-router-dom";
import "./modules.css";
import "./invoices-ledger.css";
import "./settings-pages.css";
import "./roles-users.css";
import SettingsHeader, { ITEMS_TABS, FIXED_ASSETS_TABS } from "../components/SettingsHeader";
import RecordList from "../components/RecordList";
import { ItemPostingAccounts, ItemTaxAccounts, StockMovementAccounts, CategoryAccountGrid } from "../components/ItemAccountTables";
import { TypeBookStatus } from "../components/AssetJournalTables";
import { FixedAssetPreferencesSection } from "./AccountingPreferencesPage";
import { useModuleSettings, slugKey } from "../state/ModuleSettingsContext";
import { useCurrentUser } from "../state/CurrentUserContext";
import { useAssets } from "../state/AssetsContext";
import { ASSET_ACCOUNT_ROWS_BY_TYPE } from "../data/seed/fixedAssets";
import { CAPABILITIES } from "../data/seed/roles";

// Settings → Items (default accounts — each item category's posting and tax
// accounts — and stock movement accounts) and Settings → Fixed Assets (asset
// categories). A category is where
// an item or asset gets its GL accounts, so changing one here changes what
// every item or asset in it posts to from then on. Editing needs the
// capability for what is being edited: products for item categories, posting
// rules for stock movement, fixed assets. Locations live on General Ledger
// (LocationsPage.jsx).

const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const ReadOnly = ({ cap }) => <p className="mr-ro">Read only — changing these needs the <em>{CAPABILITIES[cap].label}</em> capability.</p>;

export default function InventorySettingsPage() {
  const { pathname } = useLocation();
  const { hasCapability } = useCurrentUser();
  const canProducts = hasCapability("masterdata.product.manage");
  const canPosting = hasCapability("settings.posting_rules.manage");
  const tab = pathname.endsWith("/stock-movement") ? "movement" : "categories";
  const cap = { categories: [canProducts, "masterdata.product.manage"], movement: [canPosting, "settings.posting_rules.manage"] }[tab];
  return (
    <div className="lg-page">
      <div className="lg-scroll-container">
        <SettingsHeader
          title="Items"
          tabs={ITEMS_TABS}
          intro="The accounts and taxes each item category posts with, and what stock movements post to."
        />
        {tab === "categories" && <><ItemPostingAccounts canEdit={canProducts} /><ItemTaxAccounts canEdit={canProducts} /></>}
        {tab === "movement" && <StockMovementAccounts canEdit={canPosting} />}
        {!cap[0] && <ReadOnly cap={cap[1]} />}
        <div style={{ height: 40 }} />
      </div>
    </div>
  );
}


// One tab per type — Asset, Prepaid, Intangible. The types are fixed; each tab
// holds that type's categories (a new one is always added inside a type and
// never picks one), their accounts side by side, and the type's book status
// journal.
const TYPE_TABS = { "": "fixed_asset", prepaid: "prepaid", intangible: "intangible" };
const TYPE_INTRO = {
  fixed_asset: "Tangible property, plant and equipment. Built or bought, placed in service and depreciated, then held for sale or disposed of.",
  prepaid: "Paid in advance and released to expense over its term. It starts releasing straight away and is never built or sold — it runs out, or what is left is written off.",
  intangible: "Software, rights and goodwill. Developed or bought, put into use and amortised, then derecognised. Never held for sale.",
};

function AssetTypeSection({ type, canEdit }) {
  const { assetCategories, saveAssetCategory, removeAssetCategory } = useModuleSettings();
  const { assets } = useAssets();
  const categories = assetCategories.filter((c) => c.type === type);
  const accountRows = ASSET_ACCOUNT_ROWS_BY_TYPE[type];
  const used = (key) => assets.filter((a) => a.category === key).length;
  return (
    <>
      <RecordList
        title="Categories"
        auditArea="Fixed Assets"
        intro="Each category decides where its assets post. Method and duration are set on each asset."
        rows={categories}
        rowKey="key"
        noun="category"
        canEdit={canEdit}
        newRow={{ key: "", label: "", type, accounts: {} }}
        columns={[
          { key: "label", label: "Category", width: "minmax(150px,1.1fr)", render: (c) => <><b>{c.label}</b><span className="mr-sub">{plural(used(c.key), "asset")}</span></> },
        ]}
        fields={[
          { key: "label", label: "Name", type: "text", required: true },
          ...accountRows.map(([k, label]) => ({ key: `accounts.${k}`, label, type: "account" })),
        ]}
        onSave={(row, orig) => saveAssetCategory({ ...row, type, key: orig || slugKey(row.label) })}
        onDelete={(c) => removeAssetCategory(c.key)}
        deleteBlocked={(c) => (used(c.key) ? `${plural(used(c.key), "asset")} use it.` : null)}
      />
      <CategoryAccountGrid
        title="Category accounts"
        intro="Every asset posts to its category's accounts. To change them, open the category in the list above."
        accountRows={accountRows}
        categories={categories}
      />
    </>
  );
}

export function FixedAssetsSettingsPage() {
  const { pathname } = useLocation();
  const { hasCapability } = useCurrentUser();
  const canCategories = hasCapability("masterdata.fixed_asset.manage");
  const canPosting = hasCapability("settings.posting_rules.manage");
  const tab = pathname.replace(/^\/settings\/fixed-assets\/?/, "");
  const type = TYPE_TABS[tab] || "fixed_asset";
  return (
    <div className="lg-page">
      <div className="lg-scroll-container">
        <SettingsHeader
          title="Fixed Assets"
          tabs={FIXED_ASSETS_TABS}
          intro="Each type's categories decide where its assets post; its book status journal decides what each change of status posts."
        />
        {tab === "preferences" ? (
          <>
            <div className="fa-prefs"><FixedAssetPreferencesSection /></div>
            {!canPosting && <ReadOnly cap="settings.posting_rules.manage" />}
          </>
        ) : (
          <>
            <p className="mr-intro fa-set-intro">{TYPE_INTRO[type]}</p>
            <AssetTypeSection key={type} type={type} canEdit={canCategories} />
            {!canCategories && <ReadOnly cap="masterdata.fixed_asset.manage" />}
            <TypeBookStatus key={`bs-${type}`} type={type} canEdit={canPosting} />
            {!canPosting && <ReadOnly cap="settings.posting_rules.manage" />}
          </>
        )}
        <div style={{ height: 40 }} />
      </div>
    </div>
  );
}
