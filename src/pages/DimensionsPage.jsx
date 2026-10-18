import { useState } from "react";
import { paletteFor } from "../data/seed/dimensions";
import { useDimensions } from "../state/DimensionsContext";
import SettingsHeader, { ACCOUNTING_TABS } from "../components/SettingsHeader";
import "./invoices-ledger.css";
import "./settings-pages.css";

export default function DimensionsPage() {
  // Configured dimensions (seed + any added manually), shared app-wide.
  const { dimensions, setDimensions } = useDimensions();

  // Editing state — only one row in edit mode at a time.
  // editingId: dim.id when renaming, or "__addval__:<dim.id>" when adding a value,
  // or "__new__" when adding a new dimension.
  const [editingId, setEditingId] = useState(null);
  const [renameValue, setRenameValue] = useState("");
  const [newValueText, setNewValueText] = useState("");
  const [newDimName, setNewDimName] = useState("");

  function startRename(dim) {
    setEditingId(dim.id);
    setRenameValue(dim.label);
  }
  function saveRename(id) {
    const name = renameValue.trim();
    if (!name) return;
    setDimensions((prev) => prev.map((d) => (d.key === id ? { ...d, label: name } : d)));
    setEditingId(null);
  }
  function cancelEdit() {
    setEditingId(null);
    setNewValueText("");
    setNewDimName("");
  }

  function startAddValue(dim) {
    setEditingId(`__addval__:${dim.key}`);
    setNewValueText("");
  }
  function saveValue(id) {
    const v = newValueText.trim();
    if (!v) return;
    setDimensions((prev) =>
      prev.map((d) => (d.key === id ? { ...d, values: [...d.values.filter((x) => x !== "—"), v, ...(d.values.includes("—") ? ["—"] : [])] } : d)),
    );
    setEditingId(null);
    setNewValueText("");
  }
  function removeValue(id, idx) {
    setDimensions((prev) =>
      prev.map((d) => (d.key === id ? { ...d, values: d.values.filter((_, i) => i !== idx) } : d)),
    );
  }

  function deleteDimension(id) {
    if (!window.confirm("Delete this dimension? Tags using it will be removed from any account references.")) return;
    setDimensions((prev) => prev.filter((d) => d.key !== id));
  }

  function startNewDim() {
    setEditingId("__new__");
    setNewDimName("");
  }
  function saveNewDim() {
    const name = newDimName.trim();
    if (!name) return;
    const key = "custom-" + Date.now();
    setDimensions((prev) => [...prev, { key, label: name, cls: "_new", values: [] }]);
    setEditingId(null);
    setNewDimName("");
  }

  return (
    <div className="lg-page">
      <div className="lg-scroll-container">
      <SettingsHeader
        title="General Ledger"
        tabs={ACCOUNTING_TABS}
        intro="Define the analytical tags you'll attach to accounts and transactions — like Department, Location, or Project. Each dimension has its own list of values. All optional."
      />
      <div className="acc-body">

      {/* Configured dimensions table */}
      <div className="s2-dim-tbl-section">
        <div className="s2-dim-tbl-hdr">
          <span className="s2-dim-tbl-title">Configured dimensions</span>
          <span className="s2-dim-tbl-cnt">{dimensions.length}</span>
        </div>

        {dimensions.length === 0 && editingId !== "__new__" ? (
          <div className="s2-dim-tbl-empty">
            No dimensions yet.{" "}
            <button className="s2-dim-empty-link" onClick={startNewDim}>
              Add a custom dimension
            </button>
            .
          </div>
        ) : (
          <table className="s2-dim-tbl">
            <thead>
              <tr>
                <th style={{ width: 220 }}>Name</th>
                <th>Values</th>
                <th style={{ width: 140, textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {dimensions.map((dim) => {
                const pal = paletteFor(dim.cls);
                const isRenaming = editingId === dim.key;
                const isAddingValue = editingId === `__addval__:${dim.key}`;
                return (
                  <tr className="s2-dim-tbl-row" key={dim.key}>
                    <td>
                      {isRenaming ? (
                        <input
                          className="s2-dim-edit-input"
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveRename(dim.key);
                            if (e.key === "Escape") cancelEdit();
                          }}
                          autoFocus
                        />
                      ) : (
                        <div className="s2-dim-tbl-name">
                          <span className="s2-dim-card-dot" style={{ background: pal.dot }} />
                          {dim.label}
                        </div>
                      )}
                    </td>
                    <td>
                      <div className="s2-dim-card-values">
                        {dim.values.map((v, vi) => (
                          <span
                            className="s2-dim-val-chip"
                            key={vi}
                            style={{ background: pal.bg, color: pal.fg }}
                          >
                            {v}
                            <span
                              className="s2-dim-val-chip-x"
                              title="Remove value"
                              onClick={() => removeValue(dim.key, vi)}
                            >
                              ×
                            </span>
                          </span>
                        ))}
                        {isAddingValue ? (
                          <>
                            <input
                              className="s2-dim-edit-input"
                              style={{ width: 140, padding: "3px 6px", fontSize: 11, flex: "0 0 auto" }}
                              value={newValueText}
                              onChange={(e) => setNewValueText(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") saveValue(dim.key);
                                if (e.key === "Escape") cancelEdit();
                              }}
                              placeholder="New value"
                              autoFocus
                            />
                            <button className="s2-dim-val-add" onClick={() => saveValue(dim.key)}>Add</button>
                            <button className="s2-dim-val-add" onClick={cancelEdit}>Cancel</button>
                          </>
                        ) : (
                          <button className="s2-dim-val-add" onClick={() => startAddValue(dim)}>
                            + value
                          </button>
                        )}
                      </div>
                    </td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      {isRenaming ? (
                        <>
                          <button className="s2-dim-card-act" onClick={cancelEdit}>Cancel</button>{" "}
                          <button className="s2-dim-card-act primary" onClick={() => saveRename(dim.key)}>Save</button>
                        </>
                      ) : (
                        <>
                          <button className="s2-dim-card-act" onClick={() => startRename(dim)}>Rename</button>{" "}
                          <button className="s2-dim-card-act s2-dim-card-act-danger" onClick={() => deleteDimension(dim.key)}>Delete</button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}

              {editingId === "__new__" && (
                <tr className="s2-dim-tbl-row s2-dim-tbl-row-new">
                  <td>
                    <input
                      className="s2-dim-edit-input"
                      value={newDimName}
                      onChange={(e) => setNewDimName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveNewDim();
                        if (e.key === "Escape") cancelEdit();
                      }}
                      placeholder="Dimension name (e.g. Project, Cost Center)"
                      autoFocus
                    />
                  </td>
                  <td style={{ color: "var(--color-text-tertiary)", fontSize: 11 }}>
                    Values can be added after the dimension is created.
                  </td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <button className="s2-dim-card-act" onClick={cancelEdit}>Cancel</button>{" "}
                    <button className="s2-dim-card-act primary" onClick={saveNewDim}>Add</button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}

        {editingId !== "__new__" && (
          <button className="s2-dim-add-card" onClick={startNewDim}>
            + Add custom dimension
          </button>
        )}
      </div>
      </div>
      </div>
    </div>
  );
}
