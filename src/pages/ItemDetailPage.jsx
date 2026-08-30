import { useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useItems, VER_FIELD_LABEL } from "../state/ItemsContext";
import { useInventorySubledger } from "../state/InventorySubledgerContext";
import { useCurrentUser } from "../state/CurrentUserContext";
import { useAccountingSettings } from "../state/AccountingSettingsContext";
import {
  ITEM_CAT_LABELS, ITEM_TYPES, ITEM_TYPE_ORDER, ITEM_UOM_LABELS,
  PRIMARY_UNITS, UNIT_DEFAULTS, UNIT_KIND_LABELS, CONVERSION_TYPE_LABELS,
} from "../data/seed/items";
import { ITEM_LIFECYCLE_META } from "../data/seed/itemGovernance";
import { COSTING_METHOD_LABELS } from "../data/seed/accountingSettings";
import { DEFTAX_LABELS } from "../data/labels";
import { itemUnits, itemAccounts, itemAudit, unitLock, isStocked } from "../lib/itemMaster";
import { sourceBadge, stockGuard } from "../lib/inventorySubledger";
import { formatRupiah, formatRupiahExact, formatDate } from "../lib/format";
import "./vendor-detail.css";
import "./items.css";
import "./item-detail.css";

// ── Item Detail ──────────────────────────────────────────────────────────────
// Route /items/:id. Six tabs: Information, Commercial, Accounting, Stock,
// Versions, Audit Trail.
//
// NOTHING ON THIS PAGE IS APPROVAL-GATED. Edits save immediately. What keeps
// that safe is not a signature but the version freeze on every change: a
// document copied its values at entry and keeps them, so an edit made today
// cannot restate a bill raised in January. The audit trail records who changed
// what afterwards.
//
// Two things still refuse, and neither is an approval — both are physical facts
// reported by the Inventory Sub-Ledger, and no person can sign them away:
//   • unit fields lock while stock exists (changing a conversion would
//     reinterpret every quantity already recorded)
//   • deactivation is blocked while stock exists (the quantity would leave the
//     stock reports while its value stayed in the books)
// Both fail closed when the sub-ledger cannot be reached.
//
// The Stock tab is the module boundary made visible: every figure read-only and
// badged with its source, and no action on it at all. To change one you record a
// movement in the module that owns it.

// How a version snapshot came to exist. None of them involved an approver.
const VER_ORIGIN_VERB = { created: "created", imported: "imported", changed: "changed" };

export default function ItemDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const {
    itemById, updateItem, activateItem, deactivateItem, reactivateItem,
    versionsOf, changeLog,
  } = useItems();
  const { read } = useInventorySubledger();
  const { user } = useCurrentUser();
  const { inventoryCostingMethod } = useAccountingSettings();
  const item = itemById(id);

  const [tab, setTab] = useState("information");
  const [openVer, setOpenVer] = useState(null);
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState(null);
  const [toast, setToast] = useState("");
  function flash(msg) { setToast(msg); setTimeout(() => setToast(""), 2600); }

  if (!item) {
    return (
      <div className="vd-page">
        <div className="vd-empty" style={{ marginTop: 80 }}>
          Item not found.{" "}
          <button className="vd-btn" style={{ marginTop: 14 }} onClick={() => navigate("/items")}>Back to Item Master</button>
        </div>
      </div>
    );
  }

  const stocked = isStocked(item);
  const lifecycle = item.lifecycle || "active";
  const lifeMeta = ITEM_LIFECYCLE_META[lifecycle] || ITEM_LIFECYCLE_META.active;
  const typeMeta = ITEM_TYPES[item.item_type] || ITEM_TYPES.stocked;
  const catLabel = ITEM_CAT_LABELS[item.category] || item.category;

  const units = itemUnits(item);
  const accounts = itemAccounts(item);
  // The sub-ledger's published read. Nothing on this page recomputes any of it.
  const st = read(item, inventoryCostingMethod);
  const badge = sourceBadge(st);
  const lock = unitLock(item, st);
  const guard = stockGuard(st);

  const vlist = versionsOf(item.id);
  const auditLog = [...(changeLog[item.id] || []), ...itemAudit(item).slice().reverse()];
  const meta = { actor: user.name };

  // ── Edit ──────────────────────────────────────────────────────────────────
  // One form over the whole record. There is no cost field and never will be:
  // what stock is carried at is replayed from movements, so there is nothing to
  // put in an input. That absence is the fix — the number can no longer be typed.
  function openEdit() {
    setForm({
      name: item.name || "",
      description: item.description || "",
      item_type: item.item_type || "stocked",
      category: item.category || "supplies",
      primary_unit: item.primary_unit || "pcs",
      tax_code: item.tax_code || "ppn_masukan",
      sales_price: item.sales_price == null ? "" : String(item.sales_price),
      purchase_price: item.purchase_price == null ? "" : String(item.purchase_price),
    });
    setEditOpen(true);
  }
  const setF = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  function saveEdit() {
    const patch = {};
    if (form.name.trim() && form.name.trim() !== item.name) patch.name = form.name.trim();
    if (form.description.trim() !== (item.description || "")) patch.description = form.description.trim();
    if (form.category !== item.category) patch.category = form.category;
    if (form.tax_code !== item.tax_code) patch.tax_code = form.tax_code;

    const nextSales = form.sales_price === "" ? null : Number(form.sales_price);
    const nextPurchase = form.purchase_price === "" ? null : Number(form.purchase_price);
    if (nextSales !== (item.sales_price ?? null)) patch.sales_price = nextSales;
    if (nextPurchase !== (item.purchase_price ?? null)) patch.purchase_price = nextPurchase;

    // Type change rewrites the unit model: a service has none at all.
    if (form.item_type !== item.item_type) {
      patch.item_type = form.item_type;
      if (form.item_type === "service") {
        Object.assign(patch, {
          primary_unit: null, unit_kind: null, secondary_unit: null,
          conversion_type: null, conversion_ratio: null, precision: 0,
        });
      } else {
        Object.assign(patch, { primary_unit: form.primary_unit, ...UNIT_DEFAULTS[form.primary_unit] });
      }
    } else if (!lock.locked && form.item_type !== "service" && form.primary_unit !== item.primary_unit) {
      // Changing the primary unit re-derives the whole model — secondary unit,
      // conversion type, ratio and precision all follow from it.
      Object.assign(patch, { primary_unit: form.primary_unit, ...UNIT_DEFAULTS[form.primary_unit] });
    }

    const { changed } = updateItem(item.id, patch, meta);
    setEditOpen(false);
    flash(changed.length ? `Saved — ${changed.length} field${changed.length > 1 ? "s" : ""} changed` : "No changes");
  }

  function doDeactivate() {
    const res = deactivateItem(item.id, guard, meta);
    flash(res?.ok ? "Item deactivated" : (res?.error || "Could not deactivate"));
  }

  const TABS = [
    ["information", "Information"],
    ["commercial", "Commercial"],
    ["accounting", "Accounting"],
    ...(stocked ? [["stock", "Stock"]] : []),
    ["versions", "Versions"],
    ["audit", "Audit Trail"],
  ];

  const formIsService = form?.item_type === "service";
  const formUnit = form ? (UNIT_DEFAULTS[form.primary_unit] || UNIT_DEFAULTS.pcs) : null;

  return (
    <div className="vd-page">
      <div className="vd-scroll">
        {/* ── Top bar ─────────────────────────────────────────────── */}
        <div className="vd-top">
          <button className="vd-back" onClick={() => navigate("/items")} aria-label="Back to Item Master">
            <svg viewBox="0 0 24 24"><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></svg>
          </button>
          <div className="vd-headinfo">
            <div className="vd-title-row">
              <span className="vd-title">{item.name}</span>
              <span className={`im-status im-status-${lifeMeta.tone}`}>{lifeMeta.label}</span>
            </div>
            <div className="vd-sub">
              <span style={{ fontFamily: "var(--font-mono)" }}>{item.sku}</span>
              <span>·</span>
              <span>{typeMeta.label}</span>
              <span>·</span>
              <span>{catLabel}</span>
              {item.current_version > 0 && <><span>·</span><span>v{item.current_version}</span></>}
            </div>
          </div>
          <div className="vd-actions">
            <button className="vd-btn" onClick={openEdit}>
              <svg viewBox="0 0 24 24"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg> Edit item
            </button>
            {lifecycle === "draft" && (
              <button className="vd-btn primary" onClick={() => { activateItem(item.id, meta); flash("Item activated"); }}>
                <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12" /></svg> Activate
              </button>
            )}
            {lifecycle === "active" && (
              <button
                className="vd-btn"
                onClick={doDeactivate}
                disabled={guard.blocked}
                title={guard.blocked ? guard.reason : "Retire this item from new documents"}
              >
                <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><line x1="4.9" y1="4.9" x2="19.1" y2="19.1" /></svg> Deactivate
              </button>
            )}
            {lifecycle === "inactive" && (
              <button className="vd-btn" onClick={() => { reactivateItem(item.id, meta); flash("Item reactivated"); }}>
                <svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 9-9" /><polyline points="3 4 3 12 11 12" /></svg> Reactivate
              </button>
            )}
            <button className="vd-btn" onClick={() => navigate("/items")}>Back to list</button>
          </div>
        </div>

        {/* ── Banners ─────────────────────────────────────────────── */}
        {!st.reachable && (
          <div className="vd-alert flagged">
            <svg viewBox="0 0 24 24"><path d="M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /></svg>
            <div>
              <strong>Inventory Sub-Ledger unreachable.</strong> Stock figures read “Unavailable” — never
              Rp&nbsp;0. Master data still edits normally, but units are locked and deactivation is blocked,
              because we can’t confirm this item holds no stock. Unknown is treated as “there might be”.
            </div>
          </div>
        )}
        {/* Draft is an INCOMPLETE record — a migration or import batch nobody has
            finished off. Items created in the app never land here. Activate is a
            completion step, not a sign-off. */}
        {lifecycle === "draft" && (
          <div className="vd-alert info">
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></svg>
            <div><strong>Incomplete record.</strong> This item came in from a migration batch and hasn’t been finished off, so it isn’t selectable on bills yet. Check its units and prices, then Activate it.</div>
          </div>
        )}

        {/* ── Hero KPIs ───────────────────────────────────────────── */}
        <div className="imd-hero">
          <div className="imd-kpi">
            <div className="imd-kpi-lbl">On-hand</div>
            <div className="imd-kpi-val">
              {!stocked ? <span className="imd-kpi-none">Not stocked</span>
                : st.state === "unavailable" ? <span className="imd-kpi-none">Unavailable</span>
                : st.state === "no_record" ? <span className="imd-kpi-none">No stock recorded</span>
                : <>{st.on_hand_qty.toLocaleString("id-ID")} <span className="imd-kpi-unit">{units.primaryLabel}</span></>}
            </div>
            {stocked && <div className="imd-kpi-src">{badge}</div>}
          </div>
          <div className="imd-kpi">
            <div className="imd-kpi-lbl">Stock Value</div>
            <div className="imd-kpi-val">
              {!stocked ? <span className="imd-kpi-none">Not stocked</span>
                : st.state === "unavailable" ? <span className="imd-kpi-none">Unavailable</span>
                : st.state === "no_record" ? <span className="imd-kpi-none">No stock recorded</span>
                : formatRupiahExact(st.stock_value)}
            </div>
            {stocked && <div className="imd-kpi-src">{badge}</div>}
          </div>
          <div className="imd-kpi">
            <div className="imd-kpi-lbl">Sales Price</div>
            <div className="imd-kpi-val">
              {item.sales_price == null ? <span className="imd-kpi-none">Not sold</span> : formatRupiah(item.sales_price)}
            </div>
            <div className="imd-kpi-src">Entered here · copied onto an invoice at entry</div>
          </div>
          <div className="imd-kpi">
            <div className="imd-kpi-lbl">Locations</div>
            <div className="imd-kpi-val">
              {!stocked ? <span className="imd-kpi-none">—</span>
                : st.state === "known" ? st.by_location.length
                : <span className="imd-kpi-none">{st.state === "unavailable" ? "Unavailable" : "None"}</span>}
            </div>
            {stocked && <div className="imd-kpi-src">{badge}</div>}
          </div>
        </div>

        {/* ── Tabs ────────────────────────────────────────────────── */}
        <div className="vd-tabs">
          {TABS.map(([k, lbl]) => (
            <button key={k} className={`vd-tab${tab === k ? " active" : ""}`} onClick={() => setTab(k)}>
              {lbl}
              {k === "versions" && vlist.length > 0 && <span className="vd-tab-count">{vlist.length}</span>}
              {k === "audit" && auditLog.length > 0 && <span className="vd-tab-count">{auditLog.length}</span>}
            </button>
          ))}
        </div>

        {/* ── INFORMATION ─────────────────────────────────────────── */}
        {tab === "information" && (
          <div className="vd-body">
            <div className="vd-grid">
              <div className="vd-card">
                <div className="vd-card-title">Identity</div>
                <Row l="Item ID" v={item.sku} mono />
                <Row l="Item Name" v={item.name} />
                <Row l="Description" v={item.description || "—"} />
                <Row l="Category" v={<span className={`cat-badge inv-${item.category}`}>{catLabel}</span>} />
                <Row l="Item Type" v={<span className={`im-type im-type-${item.item_type}`}>{typeMeta.label}</span>} />
                <Row l="Lifecycle" v={lifeMeta.label} />
                <div className="imd-ro-note">{typeMeta.desc}</div>
              </div>

              <div className="vd-card">
                <div className="vd-card-title">
                  Units of Measure
                  {lock.locked && (
                    <span className="im-lock" style={{ marginLeft: 8 }}>
                      <svg viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                      Locked
                    </span>
                  )}
                </div>
                {!stocked ? (
                  <div className="dim" style={{ fontSize: 12.5 }}>
                    {item.item_type === "service"
                      ? "A service has no unit model — it is not counted, stocked or converted."
                      : "A non-stocked item is bought and expensed rather than held, so no quantity is tracked against it."}
                  </div>
                ) : (
                  <>
                    <Row l="Primary Unit" v={units.primaryLabel} />
                    <Row l="Unit Kind" v={units.kind ? UNIT_KIND_LABELS[units.kind] : "—"} />
                    <Row l="Secondary Unit" v={units.secondaryLabel} />
                    <Row l="Conversion" v={units.conversionText || "—"} />
                    <Row l="Conversion Type" v={units.conversionType ? CONVERSION_TYPE_LABELS[units.conversionType] : "—"} />
                    <Row l="Precision" v={units.kind === "measure" ? `${units.precision} decimal places` : "Whole units only"} />
                    <div className="imd-ro-note">
                      {lock.locked
                        ? lock.reason
                        : lock.provisioning
                          ? "Editable inside the provisioning window — this item is a Draft in an open migration batch whose opening balances have not posted, so no financial figure depends on these yet."
                          : "Editable while this item holds no stock. Once it does, these lock: redefining a conversion would silently change what every quantity already recorded meant. That lock is not an approval — nobody can sign it away."}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── COMMERCIAL ──────────────────────────────────────────── */}
        {tab === "commercial" && (
          <div className="vd-body">
            <div className="vd-grid">
              <div className="vd-card">
                <div className="vd-card-title">Prices <span className="imd-ro-tag">Entered</span></div>
                <Row l="Sales Price" v={item.sales_price == null ? "Not sold" : formatRupiah(item.sales_price)} mono />
                <Row l="Purchase Price" v={item.purchase_price == null ? "—" : formatRupiah(item.purchase_price)} mono />
                <div className="imd-ro-note">
                  A blank sales price stays blank — it is never estimated from cost, and an item without
                  one can’t go on a sales document. Purchase price is <strong>reference only and values no
                  stock</strong>: it pre-fills a bill line and refreshes from the last price a supplier
                  invoiced. Editing either takes effect at once; documents already raised keep the price
                  they copied.
                </div>
              </div>
              <div className="vd-card">
                <div className="vd-card-title">Tax Defaults <span className="imd-ro-tag">Copied</span></div>
                <Row l="Default Tax Treatment" v={DEFTAX_LABELS[item.tax_code] || item.tax_code || "—"} />
                <div className="imd-ro-note">
                  Pre-fills the tax on a bill or invoice line at entry. The document stores its own copy,
                  so re-reading this item later can never restate a posted line — that is the rule the
                  whole module is built on, and the reason an edit here needs no sign-off.
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── ACCOUNTING ──────────────────────────────────────────── */}
        {tab === "accounting" && (
          <div className="vd-body">
            <div className="vd-grid">
              <div className="vd-card span2">
                <div className="vd-card-title">GL Account Set <span className="imd-ro-tag">Read-only</span></div>
                {accounts.map((a) => (
                  <div className="vd-row" key={a.key}>
                    <span className="vd-row-lbl">{a.label}</span>
                    <span className="vd-row-val imd-acct">
                      {a.name ? <>{a.name} <span className="imd-acct-code">{a.code}</span></> : <span className="dim">Not applicable</span>}
                    </span>
                  </div>
                ))}
                <div className="imd-ro-note">
                  Resolved from the item’s category, not set per item — editable in Item Category
                  Settings. Changing the category moves the Inventory account, and stock already posted
                  to the old one has to be reclassified: that reclassification is a journal entry owned
                  by the Inventory Sub-Ledger.
                </div>
              </div>
              <div className="vd-card span2">
                <div className="vd-card-title">Costing Method <span className="imd-ro-tag">Reference</span></div>
                <Row l="Method" v={COSTING_METHOD_LABELS[inventoryCostingMethod] || inventoryCostingMethod} />
                <div className="imd-ro-note">
                  Shown here for reference only — <strong>applied by the Inventory Sub-Ledger, not by this
                  page</strong>. It decides how a movement OUT is valued and nothing else. Company-wide
                  policy, set in <Link to="/inventory-settings" className="imd-je">Accounting Settings</Link>.
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── STOCK ───────────────────────────────────────────────── */}
        {tab === "stock" && (
          <div className="vd-body">
            <div className="vd-grid">
              <div className="vd-card span2">
                <div className="vd-card-title">
                  From the Inventory Sub-Ledger <span className="imd-ro-tag">Derived</span>
                </div>
                <div className="imd-ro-note" style={{ marginTop: 0, marginBottom: 12 }}>
                  These figures are produced by the Inventory Sub-Ledger. To correct them, record a
                  movement there — nothing on this page can change them. {badge}
                </div>

                {st.state === "unavailable" && (
                  <div className="vd-empty">
                    <strong>Unavailable.</strong> The Inventory Sub-Ledger did not answer.
                    {st.as_of ? ` Last seen ${formatDate(st.as_of)}.` : ""} No figure is shown, and none is
                    guessed — a zero here would look like a checked number.
                  </div>
                )}
                {st.state === "no_record" && (
                  <div className="vd-empty">
                    <strong>No stock recorded.</strong> The sub-ledger has no movements for this item.
                    That is not the same as zero: nobody has counted it yet. An opening balance is a
                    posted journal entry, recorded there.
                  </div>
                )}
                {st.state === "known" && (
                  <>
                    <div className="vd-tx-tablewrap">
                      <table className="vd-tx-table">
                        <thead>
                          <tr>
                            <th>Location</th>
                            <th className="num">On-hand</th>
                            <th className="num">Stock Value</th>
                          </tr>
                        </thead>
                        <tbody>
                          {st.by_location.map((l, i) => (
                            <tr key={i}>
                              <td>{l.loc}</td>
                              <td className="num">{l.qty.toLocaleString("id-ID")} {units.primaryLabel}</td>
                              <td className="num">{formatRupiahExact(l.value)}</td>
                            </tr>
                          ))}
                          <tr className="imd-loc-total">
                            <td>Total</td>
                            <td className="num">{st.on_hand_qty.toLocaleString("id-ID")} {units.primaryLabel}</td>
                            <td className="num">{formatRupiahExact(st.stock_value)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                    <div className="vd-row" style={{ marginTop: 12 }}>
                      <span className="vd-row-lbl">Current unit cost</span>
                      <span className="vd-row-val mono">
                        {st.current_unit_cost == null ? "Nothing on hand" : formatRupiah(Math.round(st.current_unit_cost))}
                      </span>
                    </div>
                    <div className="vd-row">
                      <span className="vd-row-lbl">As of</span>
                      <span className="vd-row-val">{formatDate(st.as_of)}</span>
                    </div>
                  </>
                )}

                {/* The sub-ledger has no screens yet, so the link that belongs
                    here is stated and disabled rather than pointed somewhere it
                    isn't. */}
                <div className="imd-ro-note" style={{ marginTop: 14 }}>
                  <button className="vd-btn" disabled title="The Inventory Sub-Ledger has no screens yet">
                    Open in Inventory Sub-Ledger
                  </button>
                  <span style={{ marginLeft: 10 }}>Movements, receipts, issues and adjustments live there.</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── VERSIONS ────────────────────────────────────────────── */}
        {tab === "versions" && (
          <div className="vd-body">
            <div className="vd-card">
              <div className="vd-card-title">Version history</div>
              <div className="vd-ver-intro">
                A version is a frozen snapshot of the item’s master record, and a document copies from one
                — which is what makes the copy safe. Every change freezes a new one, so a bill raised in
                January keeps January’s values no matter what is edited afterwards. This, not a sign-off,
                is what protects a closed month.
              </div>
              {vlist.length === 0 ? (
                <div className="vd-empty">No versions recorded.</div>
              ) : (
                <div className="vd-ver-list">
                  {vlist.map((ver, i) => {
                    const open = openVer === ver.versionId;
                    return (
                      <div className={`vd-ver${open ? " open" : ""}`} key={ver.versionId}>
                        <button className="vd-ver-head" onClick={() => setOpenVer(open ? null : ver.versionId)}>
                          <span className="vd-ver-caret">{open ? "▾" : "▸"}</span>
                          <span className="vd-ver-id">{ver.versionId}</span>
                          {i === 0 && <span className="vd-ver-current">Current</span>}
                          <span className="vd-ver-meta">{VER_ORIGIN_VERB[ver.origin] || "changed"} {formatDate(ver.at)} · {ver.by}</span>
                          <span className="vd-ver-changed">
                            {ver.changedFields.length > 0
                              ? `changed: ${ver.changedFields.map((f) => VER_FIELD_LABEL[f] || f).join(", ")}`
                              : "initial version"}
                          </span>
                        </button>
                        {open && <VersionSnapshot data={ver.data} reason={ver.reason} />}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── AUDIT TRAIL ─────────────────────────────────────────── */}
        {tab === "audit" && (
          <div className="vd-body">
            <div className="vd-card span2">
              <div className="vd-card-title">Change Log</div>
              <div className="vd-ver-intro">
                Changes to the RECORD — created, edited, activated, deactivated. With no approval step in
                front of an edit, this is how a change is caught: detection after the fact rather than
                permission before it. Stock movements are a different ledger and are not shown here,
                because this module does not own them.
              </div>
              {auditLog.length === 0 ? (
                <div className="vd-empty">No changes recorded.</div>
              ) : (
                <ul className="vd-log">
                  {auditLog.map((e, i) => (
                    <li className="vd-log-item" key={i}>
                      <span className="vd-log-dot" />
                      <div className="vd-log-body">
                        <div className="vd-log-action">{e.action} {e.detail && <span className="vd-log-detail">{e.detail}</span>}</div>
                        <div className="vd-log-meta">{e.actor} · {formatDate(e.date)}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Edit modal ────────────────────────────────────────────── */}
      {editOpen && form && (
        <div className="vd-modal-overlay" onClick={() => setEditOpen(false)}>
          <div className="vd-modal imd-edit-modal" onClick={(e) => e.stopPropagation()}>
            <div className="vd-modal-title">Edit {item.name}</div>
            <div className="vd-modal-body">
              Changes save immediately. Documents already raised keep the values they copied, so nothing
              posted can be restated by an edit here.
            </div>

            <div className="imd-edit-grid">
              <div className="form-fld imd-edit-full">
                <label>Item Name</label>
                <input type="text" value={form.name} onChange={(e) => setF("name", e.target.value)} />
              </div>
              <div className="form-fld imd-edit-full">
                <label>Description</label>
                <input type="text" value={form.description} onChange={(e) => setF("description", e.target.value)} />
              </div>
              <div className="form-fld">
                <label>Item Type</label>
                <select value={form.item_type} onChange={(e) => setF("item_type", e.target.value)}>
                  {ITEM_TYPE_ORDER.map((t) => <option key={t} value={t}>{ITEM_TYPES[t].label}</option>)}
                </select>
              </div>
              <div className="form-fld">
                <label>Category</label>
                <select value={form.category} onChange={(e) => setF("category", e.target.value)}>
                  {Object.entries(ITEM_CAT_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>

              {!formIsService && (
                <>
                  <div className="form-fld">
                    <label>
                      Primary Unit
                      {lock.locked && <span className="imd-fld-tag">locked</span>}
                    </label>
                    <select
                      value={form.primary_unit}
                      onChange={(e) => setF("primary_unit", e.target.value)}
                      disabled={lock.locked}
                      title={lock.locked ? lock.reason : undefined}
                    >
                      {PRIMARY_UNITS.map((u) => <option key={u} value={u}>{ITEM_UOM_LABELS[u]}</option>)}
                    </select>
                  </div>
                  <div className="form-fld">
                    <label>Conversion</label>
                    <input
                      type="text"
                      readOnly tabIndex={-1} className="imc-ro"
                      value={formUnit.secondary_unit
                        ? `1 ${ITEM_UOM_LABELS[form.primary_unit]} = ${formUnit.conversion_ratio.toLocaleString("id-ID")} ${ITEM_UOM_LABELS[formUnit.secondary_unit]}`
                        : "—"}
                    />
                  </div>
                </>
              )}

              <div className="form-fld">
                <label>Sales Price (Rp)</label>
                <input type="number" min="0" value={form.sales_price} onChange={(e) => setF("sales_price", e.target.value)} placeholder="Blank if not sold" style={{ fontFamily: "var(--font-mono)" }} />
              </div>
              <div className="form-fld">
                <label>Purchase Price (Rp) <span className="imd-fld-tag">reference</span></label>
                <input type="number" min="0" value={form.purchase_price} onChange={(e) => setF("purchase_price", e.target.value)} style={{ fontFamily: "var(--font-mono)" }} />
              </div>
              <div className="form-fld imd-edit-full">
                <label>Default Tax Treatment</label>
                <select value={form.tax_code} onChange={(e) => setF("tax_code", e.target.value)}>
                  {Object.entries(DEFTAX_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
            </div>

            <div className="imd-ro-note" style={{ marginBottom: 0 }}>
              {lock.locked
                ? <><strong>Units are locked.</strong> {lock.reason}</>
                : <><strong>There is no cost field.</strong> What stock is carried at
                  ({st.state === "known" && st.current_unit_cost != null ? formatRupiah(Math.round(st.current_unit_cost)) : "nothing on hand"})
                  is replayed from movements in the Inventory Sub-Ledger. To change it, record a movement there.</>}
            </div>

            <div className="vd-modal-actions">
              <button className="vd-btn" onClick={() => setEditOpen(false)}>Cancel</button>
              <button className="vd-btn primary" onClick={saveEdit}>Save changes</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast show">{toast}</div>}
    </div>
  );
}

function Row({ l, v, mono }) {
  return (
    <div className="vd-row">
      <span className="vd-row-lbl">{l}</span>
      <span className={`vd-row-val${mono ? " mono" : ""}`}>{v}</span>
    </div>
  );
}

// Frozen snapshot of the MASTER record. Quantity and stock value are absent on
// purpose: they are stock figures owned elsewhere, and freezing them into a
// version would imply this module decides them.
function VersionSnapshot({ data, reason }) {
  const d = data || {};
  const money = (v) => (v == null ? "—" : formatRupiah(v));
  const unit = (v) => (v ? (ITEM_UOM_LABELS[v] || v) : "—");
  return (
    <div className="vd-ver-snap">
      <Row l="Item ID" v={d.sku} mono />
      <Row l="Name" v={d.name} />
      <Row l="Item Type" v={ITEM_TYPES[d.item_type]?.label || "—"} />
      <Row l="Category" v={ITEM_CAT_LABELS[d.category] || d.category || "—"} />
      <Row l="Primary Unit" v={unit(d.primary_unit)} />
      <Row l="Conversion" v={d.conversion_ratio ? `1 ${unit(d.primary_unit)} = ${d.conversion_ratio} ${unit(d.secondary_unit)}` : "—"} />
      <Row l="Lifecycle" v={ITEM_LIFECYCLE_META[d.lifecycle]?.label || d.lifecycle || "—"} />
      <Row l="Purchase Price" v={money(d.purchase_price)} mono />
      <Row l="Sales Price" v={money(d.sales_price)} mono />
      {reason && <div className="vd-ver-reason">Reason: {reason}</div>}
    </div>
  );
}
