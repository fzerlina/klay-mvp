import { useState } from "react";
import { AccountCell, EditModal } from "./RecordList";
import { COA } from "../data/seed/coa";
import { ITEM_ACCOUNT_ROWS, ITEM_TAX_ROWS } from "../data/seed/items";
import { useAccountingSettings } from "../state/AccountingSettingsContext";
import { useModuleSettings, slugKey } from "../state/ModuleSettingsContext";
import { useItems } from "../state/ItemsContext";
import { TAX_CODES, taxAccount } from "../data/seed/taxCodes";
import { useSettingsAudit } from "../state/SettingsAuditContext";
import "./item-account-tables.css";

// The account tables of Settings → Items:
//   • Posting accounts — the thirteen-account set of every category, side by
//     side; a category's column header opens it to edit
//   • Tax accounts — each category's default taxes, edited in place
//   • Stock movement — what each movement reason posts, edited here
// Both read the live registries (ITEM_CATEGORY_ACCOUNTS through
// ModuleSettingsContext, MOVEMENT_ACCOUNTS and DEFAULT_ACCOUNTS through
// AccountingSettingsContext), so they always show what a movement will post.

const roleLabel = Object.fromEntries(ITEM_ACCOUNT_ROWS);
const OTHER_ROLES = ITEM_ACCOUNT_ROWS.filter(([k]) => k !== "inventory");
const EQUITY = COA.filter((a) => a.code && a.is_active && a.type === "equity").sort((a, b) => a.code.localeCompare(b.code));

// One row per account and one column per category — an account set too long
// to fit across. Shared by item and asset categories.
// With `onEdit`, each category's column header opens it; `action` sits at the
// head of the table (an Add button).
export function CategoryAccountGrid({ title, intro, accountRows, categories, onEdit, action }) {
  const grid = `minmax(200px,1.2fr) repeat(${categories.length}, minmax(170px,1fr))`;
  // Every row the same width, so the columns line up when the table scrolls.
  const row = { gridTemplateColumns: grid, minWidth: 200 + categories.length * (170 + 14) + 32 };
  return (
    <section className="mr-section">
      <div className="mr-head">
        <div>
          <div className="mr-title">{title}</div>
          <p className="mr-intro">{intro}</p>
        </div>
        {action}
      </div>
      <div className="mr-table">
        <div className="mr-tr mr-th ia-matrix" style={row}>
          <div>Account</div>
          {categories.map((c) => (onEdit
            ? <button key={c.key} type="button" className="ia-colbtn" onClick={() => onEdit(c)} title={`Edit ${c.label}`}>{c.label}</button>
            : <div key={c.key}>{c.label}</div>))}
        </div>
        {categories.length === 0 && <div className="mr-empty">None yet.</div>}
        {categories.length > 0 && accountRows.map(([key, label]) => (
          <div key={key} className="mr-tr ia-matrix" style={row}>
            <div className="mr-td"><b>{label}</b></div>
            {categories.map((c) => <div key={c.key} className="mr-td"><AccountCell code={c.accounts[key]} /></div>)}
          </div>
        ))}
      </div>
    </section>
  );
}

// Settings → Items → Default accounts. The item categories ARE these two
// tables: Posting accounts adds, renames and deletes a category (its column
// header opens it), and Tax accounts sets its default taxes in place.
export function ItemPostingAccounts({ canEdit }) {
  const { itemCategories, saveItemCategory, removeItemCategory } = useModuleSettings();
  const { items } = useItems();
  const { log } = useSettingsAudit();
  // { row, isNew } while the dialog is open.
  const [editing, setEditing] = useState(null);
  const used = (key) => items.filter((i) => i.category === key).length;
  const fields = [
    { key: "label", label: "Name", type: "text", required: true, span2: true },
    ...ITEM_ACCOUNT_ROWS.map(([k, label]) => ({ key: `accounts.${k}`, label, type: "account" })),
  ];
  const save = (row) => {
    const { isNew, row: before } = editing;
    const key = isNew ? slugKey(row.label) : before.key;
    saveItemCategory({ ...row, key });
    if (isNew) log("Items", "Default accounts", `Added item category ${row.label}`);
    else {
      const changes = [
        before.label !== row.label && `name ${before.label} → ${row.label}`,
        ...ITEM_ACCOUNT_ROWS.filter(([k]) => (before.accounts[k] || null) !== (row.accounts[k] || null))
          .map(([k, label]) => `${label} ${before.accounts[k] || "—"} → ${row.accounts[k] || "—"}`),
      ].filter(Boolean);
      if (changes.length) log("Items", "Default accounts", `${row.label}: ${changes.join("; ")}`);
    }
    setEditing(null);
  };
  const remove = () => {
    removeItemCategory(editing.row.key);
    log("Items", "Default accounts", `Deleted item category ${editing.row.label}`);
    setEditing(null);
  };
  const n = editing && !editing.isNew ? used(editing.row.key) : 0;
  return (
    <>
      <CategoryAccountGrid
        title="Posting accounts"
        intro={canEdit
          ? "Every item posts to its category's accounts. Click a category to rename it or change its accounts. Moving an item to another category later needs a reclassification journal, so set these up before items are created."
          : "Every item posts to its category's accounts."}
        accountRows={ITEM_ACCOUNT_ROWS}
        categories={itemCategories}
        onEdit={canEdit ? (c) => setEditing({ row: c, isNew: false }) : undefined}
        action={canEdit && (
          <button type="button" className="rl-btn" onClick={() => setEditing({ row: { key: "", label: "", accounts: {} }, isNew: true })}>+ Add category</button>
        )}
      />
      {editing && (
        <EditModal
          title={editing.isNew ? "Add item category" : `Edit ${editing.row.label}`}
          fields={fields}
          row={editing.row}
          isNew={editing.isNew}
          validate={(d, isNew) => (isNew && itemCategories.some((c) => c.key === slugKey(d.label || "")) ? "There's already a category with that name." : null)}
          onSave={save}
          onClose={() => setEditing(null)}
          onDelete={remove}
          deleteBlocked={n ? `${n} item${n === 1 ? "" : "s"} use it.` : null}
        />
      )}
    </>
  );
}

// The tax codes each kind may pick: VAT that applies to that side, or a
// withholding (or none).
const taxOptions = (kind) => TAX_CODES.filter((t) => (kind === "withholding"
  ? t.kind === "withholding"
  : t.kind === "vat" && (t.appliesTo === "both" || t.appliesTo === (kind === "sales_vat" ? "sales" : "purchases"))));
const taxText = (code) => {
  const t = TAX_CODES.find((x) => x.code === code);
  return t ? `${t.name}${t.rate != null ? ` · ${t.rate}%` : ""}` : "None";
};

export function ItemTaxAccounts({ canEdit }) {
  const { itemCategories: categories, setItemCategoryTax } = useModuleSettings();
  const { log } = useSettingsAudit();
  const grid = `minmax(200px,1.2fr) repeat(${categories.length}, minmax(190px,1fr))`;
  const row = { gridTemplateColumns: grid, minWidth: 200 + categories.length * (190 + 14) + 32 };
  const set = (c, kind, code) => {
    log("Items", "Default accounts", `${c.label} — ${Object.fromEntries(ITEM_TAX_ROWS)[kind]}: ${taxText(c.taxes[kind])} → ${taxText(code)}`);
    setItemCategoryTax(c.key, kind, code);
  };
  return (
    <section className="mr-section">
      <div className="mr-head">
        <div>
          <div className="mr-title">Tax accounts</div>
          <p className="mr-intro">
            The taxes a line for an item in the category starts with — purchase VAT and withholding on a bill, sales
            VAT on an invoice. Each tax books to its own account, set on the tax code in Accounting → Tax.
          </p>
        </div>
      </div>
      <div className="mr-table">
        <div className="mr-tr mr-th ia-matrix" style={row}>
          <div>Tax</div>
          {categories.map((c) => <div key={c.key}>{c.label}</div>)}
        </div>
        {categories.length === 0 && <div className="mr-empty">None yet.</div>}
        {categories.length > 0 && ITEM_TAX_ROWS.map(([kind, label]) => (
          <div key={kind} className="mr-tr ia-matrix" style={row}>
            <div className="mr-td"><b>{label}</b></div>
            {categories.map((c) => {
              const code = c.taxes?.[kind] || "";
              return (
                <div key={c.key} className="mr-td">
                  {canEdit ? (
                    <select className="ia-select" value={code} aria-label={`${c.label} ${label}`} onChange={(e) => set(c, kind, e.target.value)}>
                      {kind === "withholding" && <option value="">None</option>}
                      {!code && kind !== "withholding" && <option value="">Choose…</option>}
                      {taxOptions(kind).map((t) => <option key={t.code} value={t.code}>{taxText(t.code)}</option>)}
                    </select>
                  ) : <b>{taxText(code)}</b>}
                  {code && <span className="mr-sub">{taxAccount(code) ? <AccountCell code={taxAccount(code)} /> : "Books nothing"}</span>}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </section>
  );
}

// The account number the categories give a role, when they all agree.
export function CategoryCodes({ role, categories, none = "No category names this account — movements for this reason are blocked.", differs = "Differs by item category" }) {
  const codes = [...new Set(categories.map((c) => c.accounts[role]).filter(Boolean))];
  if (!codes.length) return <span className="mr-sub ia-none">{none}</span>;
  if (codes.length === 1) return <span className="mr-sub"><AccountCell code={codes[0]} /></span>;
  return <span className="mr-sub">{differs}</span>;
}

// One row per movement reason (lib/inventorySubledger.js MOVEMENT_ACCOUNTS).
// The stock side is always the Inventory account of the item's category. The
// other side is another of the category's accounts, chosen here — except
// Other, picked when the movement is recorded, and Opening balance, one
// company-wide account (DEFAULT_ACCOUNTS.openingStock).
export function StockMovementAccounts({ canEdit }) {
  const { movementAccounts, setMovementAccount, defaultAccounts, setDefaultAccount } = useAccountingSettings();
  const { itemCategories } = useModuleSettings();
  const { log } = useSettingsAudit();
  // Only a category with an Inventory account holds stock, so only those move it.
  const categories = itemCategories.filter((c) => c.accounts.inventory);
  const [changed, setChanged] = useState(() => new Set());
  const mark = (key) => setChanged((s) => new Set(s).add(key));

  const setRole = (dir, m, role) => {
    log("Inventory", "Stock movement", `${m.reason}: ${roleLabel[m.other]} → ${roleLabel[role]}`);
    setMovementAccount(dir, m.reason, role);
    mark(`${dir}-${m.reason}`);
  };
  const setOpening = (code) => {
    log("Inventory", "Stock movement", `Opening balance: ${defaultAccounts.openingStock} → ${code}`);
    setDefaultAccount("openingStock", code);
    mark("opening");
  };

  const inventorySide = <b>Item category's Inventory</b>;
  const otherSide = (dir, m) => {
    if (m.other === null) return <><b>Picked when recorded</b><span className="mr-sub">Required on the movement — Other has no account of its own.</span></>;
    return (
      <>
        {canEdit ? (
          <select className="ia-select" value={m.other} aria-label={`${m.reason} account`} onChange={(e) => setRole(dir, m, e.target.value)}>
            {OTHER_ROLES.map(([k, label]) => <option key={k} value={k}>Item category's {label}</option>)}
          </select>
        ) : <b>Item category's {roleLabel[m.other]}</b>}
        <CategoryCodes role={m.other} categories={categories} />
      </>
    );
  };
  const reasonCell = (key, reason, dir) => (
    <>
      <b>{reason}</b>
      <span className="mr-sub">{dir}</span>
      {changed.has(key) && <span className="mr-sub ia-changed">Changed — applies to movements recorded from now on</span>}
    </>
  );

  const rows = [
    ...movementAccounts.in.map((m) => ({ key: `in-${m.reason}`, reason: reasonCell(`in-${m.reason}`, m.reason, "Increase"), dr: inventorySide, cr: otherSide("in", m) })),
    ...movementAccounts.out.map((m) => ({ key: `out-${m.reason}`, reason: reasonCell(`out-${m.reason}`, m.reason, "Decrease"), dr: otherSide("out", m), cr: inventorySide })),
    {
      key: "opening", reason: reasonCell("opening", "Opening balance", "Increase"), dr: inventorySide,
      cr: (
        <>
          {canEdit ? (
            <select className="ia-select" value={defaultAccounts.openingStock} aria-label="Opening balance account" onChange={(e) => setOpening(e.target.value)}>
              {EQUITY.map((a) => <option key={a.code} value={a.code}>{a.code} · {a.name}</option>)}
            </select>
          ) : <b><AccountCell code={defaultAccounts.openingStock} /></b>}
          <span className="mr-sub">One account for every category.</span>
        </>
      ),
    },
  ];

  return (
    <section className="mr-section">
      <div className="mr-head">
        <div>
          <div className="mr-title">Stock movement</div>
          <p className="mr-intro">
        What each stock movement posts. <b>Inventory</b> is the Inventory account set on the item's own category,
        so the same reason moves a different stock account for each category. The other side is another of that
        category's accounts, set per reason here.
          </p>
        </div>
      </div>
      {canEdit && (
        <p className="coa-warn ia-warn">
          Changing an account here changes what stock movements post to <b>from now on</b>. Journals already
          drafted or posted keep the accounts they were made with — nothing moves.
        </p>
      )}
      <div className="mr-table">
        <div className="mr-tr mr-th ia-mv">
          <div>Reason</div><div>Debit</div><div>Credit</div>
        </div>
        {rows.map((r) => (
          <div key={r.key} className="mr-tr ia-mv">
            <div className="mr-td">{r.reason}</div>
            <div className="mr-td">{r.dr}</div>
            <div className="mr-td">{r.cr}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
