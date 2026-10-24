import { useState } from "react";
import { useModuleSettings } from "../state/ModuleSettingsContext";
import { useSettingsAudit } from "../state/SettingsAuditContext";
import "../pages/roles.css";
import "./location-cards.css";

// Settings → Accounting → General Ledger → Locations. One card per top-level location, with
// the locations inside it nested below — the tree in ModuleSettingsContext.
// The card renders its tree recursively, so going deeper is one more name in
// LOCATION_LEVELS: a node can take children until it reaches the last level.
export const LOCATION_LEVELS = ["Location", "Sub-location"];
const levelName = (depth) => LOCATION_LEVELS[depth] || LOCATION_LEVELS.at(-1);
const canNest = (depth) => depth < LOCATION_LEVELS.length - 1;

const plural = (n, w) => `${n} ${w.toLowerCase()}${n === 1 ? "" : "s"}`;
const newId = () => `L${Date.now().toString(36)}`;

// Add or edit one node. Only a top-level location carries an address.
function LocationDialog({ editing, siblings, onSave, onClose }) {
  const { node, depth, isNew, parentName } = editing;
  const [name, setName] = useState(node.name || "");
  const [address, setAddress] = useState(node.address || "");
  const clean = name.trim();
  const taken = siblings.some((s) => s.id !== node.id && s.name.toLowerCase() === clean.toLowerCase());
  const noun = levelName(depth);
  const title = isNew ? (parentName ? `Add ${noun.toLowerCase()} to ${parentName}` : `Add ${noun.toLowerCase()}`) : `Edit ${noun.toLowerCase()}`;
  return (
    <div className="rl-modal-overlay" onClick={onClose}>
      <div className="rl-modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="rl-modal-title">{title}</div>
        <label className="rl-field">
          <span>Name *</span>
          <input value={name} autoFocus onChange={(e) => setName(e.target.value)}
            placeholder={depth === 0 ? "e.g. Jakarta" : "e.g. Benhil"} />
        </label>
        {depth === 0 && (
          <label className="rl-field">
            <span>Address</span>
            <input value={address} onChange={(e) => setAddress(e.target.value)} />
          </label>
        )}
        {taken && <em className="rl-field-err">{parentName ? `${parentName} already has` : "There's already"} a {noun.toLowerCase()} called {clean}.</em>}
        <div className="rl-modal-actions">
          <button type="button" className="drawer-btn ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="drawer-btn primary" disabled={!clean || taken}
            onClick={() => onSave({ ...node, name: clean, ...(depth === 0 ? { address: address.trim() } : {}) })}>
            {isNew ? "Add" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Children({ node, depth, ...p }) {
  const kids = node.children || [];
  return (
    <>
      {kids.length > 0 && (
        <ul className="loc-children">
          {kids.map((k) => (
            <li key={k.id} className="loc-node">
              <div className="loc-sub">
                <span>{k.name}</span>
                <Actions node={k} parent={node} depth={depth} {...p} />
              </div>
              <Children node={k} depth={depth + 1} {...p} />
            </li>
          ))}
        </ul>
      )}
      {p.canEdit && canNest(depth - 1) && (
        <button type="button" className="loc-act loc-add" onClick={() => p.onAdd(node, depth)}>
          + Add {levelName(depth).toLowerCase()}
        </button>
      )}
    </>
  );
}

function Actions({ node, parent, depth, canEdit, canDelete, onEdit, onDelete }) {
  if (!canEdit && !canDelete) return null;
  const kids = node.children?.length || 0;
  return (
    <span className="loc-acts">
      {canEdit && <button type="button" className="loc-act" onClick={() => onEdit(node, depth, parent)}>Edit</button>}
      {canDelete && (
        <button type="button" className="loc-act danger" disabled={kids > 0}
          title={kids ? `Remove its ${plural(kids, levelName(depth + 1))} first.` : undefined}
          onClick={() => onDelete(node, depth, parent)}>Delete</button>
      )}
    </span>
  );
}

export default function LocationCards({ canEdit, canDelete }) {
  const { locations, saveLocation, removeLocation } = useModuleSettings();
  const { log } = useSettingsAudit();
  // { node, depth, parent, isNew } while the dialog is open.
  const [editing, setEditing] = useState(null);

  const onAdd = (parent, depth) => setEditing({ node: { id: newId(), name: "", children: [] }, depth, parent, isNew: true, parentName: parent?.name });
  const onEdit = (node, depth, parent) => setEditing({ node, depth, parent, isNew: false, parentName: parent?.name });
  const onDelete = (node, depth, parent) => {
    removeLocation(node.id);
    log("Inventory", "Locations", `Deleted ${levelName(depth).toLowerCase()} ${node.name}${parent ? ` from ${parent.name}` : ""}`);
  };
  const save = (node) => {
    const { depth, parent, isNew } = editing;
    const noun = levelName(depth).toLowerCase();
    saveLocation(node, parent?.id || null);
    log("Inventory", "Locations", isNew
      ? `Added ${noun} ${node.name}${parent ? ` to ${parent.name}` : ""}`
      : editing.node.name !== node.name ? `Renamed ${noun} ${editing.node.name} → ${node.name}` : `Edited ${noun} ${node.name}`);
    setEditing(null);
  };
  const p = { canEdit, canDelete, onAdd, onEdit, onDelete };

  return (
    <section className="mr-section">
      <div className="mr-head">
        <div>
          <div className="mr-title">Locations <span className="ru-section-cnt">{locations.length}</span></div>
          <p className="mr-intro">
            Where items and assets are kept. Each card is a location — a city, an area or a project, such as
            Jakarta — with the sub-locations inside it, such as Benhil or a warehouse.
          </p>
        </div>
        {canEdit && <button type="button" className="rl-btn" onClick={() => onAdd(null, 0)}>+ Add location</button>}
      </div>
      {locations.length === 0 && <div className="mr-table"><div className="mr-empty">No locations yet.</div></div>}
      <div className="loc-grid">
        {locations.map((loc) => {
          const kids = loc.children?.length || 0;
          return (
            <article key={loc.id} className="loc-card">
              <div className="loc-card-head">
                <div>
                  <div className="loc-name">{loc.name}</div>
                  {loc.address && <div className="loc-addr">{loc.address}</div>}
                </div>
                <Actions node={loc} parent={null} depth={0} {...p} />
              </div>
              <div className="loc-count">{kids ? plural(kids, levelName(1)) : `No ${levelName(1).toLowerCase()}s yet`}</div>
              <Children node={loc} depth={1} {...p} />
            </article>
          );
        })}
      </div>
      {editing && (
        <LocationDialog
          editing={editing}
          siblings={editing.parent ? editing.parent.children || [] : locations}
          onSave={save}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}
