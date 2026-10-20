import { useLocation } from "react-router-dom";
import "./modules.css";
import "./invoices-ledger.css";
import "./settings-pages.css";
import "./roles-users.css";
import SettingsHeader, { INVENTORY_TABS, FIXED_ASSETS_TABS } from "../components/SettingsHeader";
import RecordList, { AccountCell } from "../components/RecordList";
import { InventorySection } from "./AccountingPreferencesPage";
import { useModuleSettings, slugKey } from "../state/ModuleSettingsContext";
import { useCurrentUser } from "../state/CurrentUserContext";
import { useItems } from "../state/ItemsContext";
import { useAssets } from "../state/AssetsContext";
import { ITEM_ACCOUNT_ROWS, ITEM_UOM_LABELS } from "../data/seed/items";
import { ASSET_ACCOUNT_ROWS } from "../data/seed/fixedAssets";
import { METHOD_LABELS, TYPE_LABELS } from "../lib/fixedAssets";
import { TAX_GROUPS } from "../data/seed/moduleSettings";

// Settings → Inventory (item categories, units, sites & locations, costing)
// and Settings → Fixed Assets (asset categories). A category is where an item
// or asset gets its GL accounts, so changing one here changes what every item
// or asset in it posts to from then on. Editing needs coa.manage.

const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const ReadOnly = () => <p className="mr-ro">Read only — changing these needs the <em>Manage Chart of Accounts</em> capability.</p>;

function ItemCategoriesList({ canEdit }) {
  const { itemCategories, saveItemCategory, removeItemCategory } = useModuleSettings();
  const { items } = useItems();
  const used = (key) => items.filter((i) => i.category === key).length;
  return (
    <RecordList
      title="Item categories"
      auditArea="Inventory"
      intro="Every item belongs to one category, and the category decides its accounts — where stock sits, where sales and cost of goods go. Moving an item to another category later needs a reclassification journal, so set these up before items are created."
      rows={itemCategories}
      rowKey="key"
      noun="item category"
      canEdit={canEdit}
      newRow={{ key: "", label: "", accounts: {} }}
      columns={[
        { key: "label", label: "Category", width: "minmax(140px,1fr)", render: (c) => <><b>{c.label}</b><span className="mr-sub">{plural(used(c.key), "item")}</span></> },
        { key: "inventory", label: "Inventory", width: "minmax(150px,1.2fr)", render: (c) => <AccountCell code={c.accounts.inventory} /> },
        { key: "sales", label: "Sales", width: "minmax(150px,1.2fr)", render: (c) => <AccountCell code={c.accounts.sales} /> },
        { key: "cogs", label: "COGS", width: "minmax(150px,1.2fr)", render: (c) => <AccountCell code={c.accounts.cogs} /> },
      ]}
      fields={[
        { key: "label", label: "Name", type: "text", required: true, span2: true },
        ...ITEM_ACCOUNT_ROWS.map(([k, label]) => ({ key: `accounts.${k}`, label, type: "account" })),
      ]}
      onSave={(row, orig) => saveItemCategory({ ...row, key: orig || slugKey(row.label) })}
      onDelete={(c) => removeItemCategory(c.key)}
      deleteBlocked={(c) => (used(c.key) ? `${plural(used(c.key), "item")} use it.` : null)}
    />
  );
}

function UnitsList({ canEdit }) {
  const { units, saveUnit, removeUnit } = useModuleSettings();
  const { items } = useItems();
  const used = (code) => items.filter((i) => i.primary_unit === code).length;
  return (
    <RecordList
      title="Units of measure"
      auditArea="Inventory"
      intro="The units items can be stocked in. A Count unit takes whole numbers only; a Measure unit allows decimals to its precision. The conversion is the default an item starts from — an item can still override it."
      rows={units}
      rowKey="code"
      noun="unit"
      canEdit={canEdit}
      newRow={{ code: "", label: "", kind: "count", secondary: null, ratio: null, precision: 0 }}
      columns={[
        { key: "code", label: "Unit", width: "minmax(90px,0.7fr)", render: (u) => <><b>{u.code}</b><span className="mr-sub">{plural(used(u.code), "item")}</span></> },
        { key: "kind", label: "Kind", width: "100px", render: (u) => (u.kind === "measure" ? "Measure" : "Count") },
        { key: "conversion", label: "Converts to", width: "minmax(140px,1fr)", render: (u) => (u.secondary ? `1 ${u.code} = ${u.ratio} ${ITEM_UOM_LABELS[u.secondary] || u.secondary}` : <span className="mr-muted">—</span>) },
        { key: "precision", label: "Decimals", width: "90px", render: (u) => u.precision },
      ]}
      fields={[
        { key: "code", label: "Unit", type: "text", required: true, placeholder: "e.g. carton", lockOnEdit: true },
        { key: "kind", label: "Kind", type: "select", required: true, options: [{ value: "count", label: "Count — whole numbers" }, { value: "measure", label: "Measure — decimals allowed" }] },
        { key: "secondary", label: "Converts to", type: "text", placeholder: "e.g. pcs (optional)" },
        { key: "ratio", label: "How many", type: "number", placeholder: "e.g. 24" },
        { key: "precision", label: "Decimals", type: "number", hint: "0 for Count units." },
      ]}
      validate={(d) => ((d.secondary && !d.ratio) ? "Say how many of the smaller unit make one." : null)}
      onSave={(row, orig) => saveUnit({ ...row, label: row.code, secondary: row.secondary || null, ratio: row.secondary ? row.ratio : null, precision: row.precision ?? 0 }, orig)}
      onDelete={(u) => removeUnit(u.code)}
      deleteBlocked={(u) => (used(u.code) ? `${plural(used(u.code), "item")} use it.` : null)}
    />
  );
}

function SitesList({ canEdit }) {
  const { sites, saveSite, removeSite } = useModuleSettings();
  return (
    <RecordList
      title="Sites & locations"
      auditArea="Inventory"
      intro="Where items and assets are kept. A site is the broader place — a city, an area or a project; a location is a specific spot inside it, such as a warehouse or a cluster."
      rows={sites}
      rowKey="id"
      noun="site"
      canEdit={canEdit}
      newRow={{ id: "", name: "", address: "", locations: [] }}
      columns={[
        { key: "name", label: "Site", width: "minmax(160px,1fr)", render: (s) => <><b>{s.name}</b>{s.address && <span className="mr-sub">{s.address}</span>}</> },
        { key: "locations", label: "Locations", width: "minmax(220px,2fr)", render: (s) => (s.locations.length ? s.locations.map((l) => <span key={l} className="mr-pill">{l}</span>) : <span className="mr-muted">No locations yet</span>) },
      ]}
      fields={[
        { key: "name", label: "Site name", type: "text", required: true, placeholder: "e.g. Bali — Project Ubud" },
        { key: "address", label: "Address", type: "text" },
        { key: "locations", label: "Locations (one per line)", type: "list", placeholder: "Main warehouse\nCluster A" },
      ]}
      onSave={(row, orig) => saveSite({ ...row, id: orig || `S${String(Date.now()).slice(-5)}` }, orig)}
      onDelete={(s) => removeSite(s.id)}
    />
  );
}

export default function InventorySettingsPage() {
  const { pathname } = useLocation();
  const { hasCapability } = useCurrentUser();
  const canEdit = hasCapability("coa.manage");
  const tab = pathname.endsWith("/units") ? "units" : pathname.endsWith("/sites") ? "sites" : pathname.endsWith("/costing") ? "costing" : "categories";
  return (
    <div className="lg-page">
      <div className="lg-scroll-container">
        <SettingsHeader
          title="Inventory"
          tabs={INVENTORY_TABS}
          intro="How items are grouped, counted, stored and valued."
        />
        {tab === "categories" && <ItemCategoriesList canEdit={canEdit} />}
        {tab === "units" && <UnitsList canEdit={canEdit} />}
        {tab === "sites" && <SitesList canEdit={canEdit} />}
        {tab === "costing" && <InventorySection />}
        {!canEdit && tab !== "costing" && <ReadOnly />}
        <div style={{ height: 40 }} />
      </div>
    </div>
  );
}

const lifeText = (m) => (m == null ? "—" : m % 12 === 0 ? `${m / 12} year${m === 12 ? "" : "s"}` : `${m} months`);

export function FixedAssetsSettingsPage() {
  const { assetCategories, saveAssetCategory, removeAssetCategory } = useModuleSettings();
  const { assets } = useAssets();
  const { hasCapability } = useCurrentUser();
  const canEdit = hasCapability("coa.manage");
  const used = (key) => assets.filter((a) => a.category === key).length;
  return (
    <div className="lg-page">
      <div className="lg-scroll-container">
        <SettingsHeader
          title="Fixed Assets"
          tabs={FIXED_ASSETS_TABS}
          intro="Asset categories decide where an asset posts and how a new one depreciates. The method and useful life pre-fill new assets in the category; each asset can still change them."
        />
        <RecordList
          title="Asset categories"
          auditArea="Fixed Assets"
          intro="Useful lives start from the Indonesian tax asset groups (Kelompok 1–4, permanent and non-permanent buildings). Check them against your own policy."
          rows={assetCategories}
          rowKey="key"
          noun="asset category"
          canEdit={canEdit}
          newRow={{ key: "", label: "", type: "fixed_asset", method: "straight_line", lifeMonths: 48, taxGroup: null, accounts: {} }}
          columns={[
            { key: "label", label: "Category", width: "minmax(150px,1.1fr)", render: (c) => <><b>{c.label}</b><span className="mr-sub">{TYPE_LABELS[c.type]} · {plural(used(c.key), "asset")}</span></> },
            { key: "method", label: "Default method", width: "minmax(120px,0.9fr)", render: (c) => METHOD_LABELS[c.method]?.split(" —")[0] || "—" },
            { key: "life", label: "Useful life", width: "minmax(100px,0.7fr)", render: (c) => <>{lifeText(c.lifeMonths)}{c.taxGroup && <span className="mr-sub">{c.taxGroup}</span>}</> },
            { key: "asset", label: "Asset account", width: "minmax(150px,1.1fr)", render: (c) => <AccountCell code={c.accounts.asset} /> },
            { key: "expense", label: "Expense account", width: "minmax(150px,1.1fr)", render: (c) => <AccountCell code={c.accounts.expense} /> },
          ]}
          fields={[
            { key: "label", label: "Name", type: "text", required: true },
            { key: "type", label: "Type", type: "select", required: true, lockOnEdit: true, options: Object.entries(TYPE_LABELS).map(([value, label]) => ({ value, label })) },
            { key: "method", label: "Default method", type: "select", required: true, options: Object.entries(METHOD_LABELS).map(([value, label]) => ({ value, label })) },
            { key: "lifeMonths", label: "Useful life (months)", type: "number", hint: "e.g. 48 = 4 years. Blank for no schedule." },
            { key: "taxGroup", label: "Tax group", type: "select", options: TAX_GROUPS.map((g) => ({ value: g, label: g })), placeholder: "None" },
            ...ASSET_ACCOUNT_ROWS.map(([k, label]) => ({ key: `accounts.${k}`, label, type: "account" })),
          ]}
          onSave={(row, orig) => saveAssetCategory({ ...row, key: orig || slugKey(row.label) })}
          onDelete={(c) => removeAssetCategory(c.key)}
          deleteBlocked={(c) => (used(c.key) ? `${plural(used(c.key), "asset")} use it.` : null)}
        />
        {!canEdit && <ReadOnly />}
        <div style={{ height: 40 }} />
      </div>
    </div>
  );
}
