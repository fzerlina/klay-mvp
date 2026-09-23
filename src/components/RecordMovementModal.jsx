import { useState, useMemo, useCallback } from "react";
import { useInventorySubledger, todayIso } from "../state/InventorySubledgerContext";
import { useJournalEntries } from "../state/JournalEntriesContext";
import { useAccountingSettings } from "../state/AccountingSettingsContext";
import { useCurrentUser } from "../state/CurrentUserContext";
import { MOVEMENT_REASONS, movementJournalLines } from "../lib/inventorySubledger";
import { itemUnits } from "../lib/itemMaster";
import { formatRupiahExact } from "../lib/format";
import "./record-movement.css";

// ── Drafting the journal a movement writes ──────────────────────────────────
// Every stock movement lands in the books as a DRAFT journal entry, which is
// reviewed and posted on the Journal Entry page like any other. Shared by the
// dialog below and by Add New Item's opening balances.
export function useStockJournal() {
  const { addJournalEntry, peekNextJeNumber } = useJournalEntries();
  const { user } = useCurrentUser();
  return useCallback((item, rows, memo) => {
    const lines = rows.flatMap((r) => movementJournalLines(item, r));
    if (!lines.some((l) => l.debit > 0)) return null;
    const je_number = peekNextJeNumber();
    const date = rows[0]?.date || todayIso();
    addJournalEntry({
      je_number, je_date: date, status: "draft", memo,
      reference_type: "inventory_movement", reference_id: item.id,
      created_by: user.name, created_date: todayIso(), posted_by: null, posted_date: null,
      lines,
    });
    return je_number;
  }, [addJournalEntry, peekNextJeNumber, user.name]);
}

const NEW_LOC = "__new__";

// ── Record movement ─────────────────────────────────────────────────────────
// The only way stock changes. Pick a location the item already has (or name a
// new one), say up or down and by how much, and the balance follows from the
// movement. `item` fixes the item (Stock tab); without it the dialog asks for
// one from `items` (Inventory page).
export default function RecordMovementModal({ item: fixedItem, items = [], onClose, onDone }) {
  const { read, previewMovement, recordMovement } = useInventorySubledger();
  const { inventoryCostingMethod } = useAccountingSettings();
  const { user } = useCurrentUser();
  const draftJournal = useStockJournal();

  const [itemId, setItemId] = useState(fixedItem?.id || "");
  const item = fixedItem || items.find((i) => i.id === itemId) || null;
  const st = item ? read(item, inventoryCostingMethod) : null;
  const locations = st?.locations || [];

  const [locPick, setLocPick] = useState(locations[0] || NEW_LOC);
  const [newLoc, setNewLoc] = useState("");
  const [direction, setDirection] = useState("in");
  const [qty, setQty] = useState("");
  const [date, setDate] = useState(todayIso());
  const [reason, setReason] = useState(MOVEMENT_REASONS.in[0]);
  const [unitCost, setUnitCost] = useState("");
  const [note, setNote] = useState("");
  const [tried, setTried] = useState(false);

  const loc = locPick === NEW_LOC ? newLoc : locPick;
  const units = item ? itemUnits(item) : null;

  function pickItem(id) {
    setItemId(id);
    const next = items.find((i) => i.id === id);
    const locs = next ? read(next, inventoryCostingMethod).locations : [];
    setLocPick(locs[0] || NEW_LOC);
  }
  function pickDirection(d) {
    setDirection(d);
    setReason(MOVEMENT_REASONS[d][0]);
  }

  const preview = useMemo(
    () => (item ? previewMovement(item, { loc, direction, qty, date, unit_cost: unitCost, method: inventoryCostingMethod }) : { ok: false, error: "Pick an item" }),
    [item, loc, direction, qty, date, unitCost, inventoryCostingMethod, previewMovement],
  );

  const before = st?.by_location.find((l) => l.loc === loc.trim())?.qty || 0;
  const after = before + (preview.row?.unit || 0);
  const lines = preview.row && item ? movementJournalLines(item, preview.row) : [];
  const currentCost = st?.current_unit_cost != null ? Math.round(st.current_unit_cost) : null;

  function submit() {
    setTried(true);
    if (!preview.ok) return;
    const verb = direction === "in" ? "Increase" : "Decrease";
    const je = draftJournal(item, [preview.row], `Stock ${verb.toLowerCase()} — ${item.name}, ${loc.trim()} (${reason})`);
    const res = recordMovement(item, {
      loc, direction, qty, date, unit_cost: unitCost, method: inventoryCostingMethod,
      reason, note, by: user.name, je_number: je,
    });
    if (res.ok) onDone?.({ item, row: res.row, je });
  }

  return (
    <div className="vd-modal-overlay" onClick={onClose}>
      <div className="vd-modal rm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="vd-modal-title">Record stock movement</div>
        <div className="vd-modal-body">
          Stock isn’t edited — it moves. Record what changed and where; the balance is worked out
          from the movements, and a draft journal entry is created for the books.
        </div>

        {!fixedItem && (
          <div className="rm-fld">
            <label>Item</label>
            <select value={itemId} onChange={(e) => pickItem(e.target.value)}>
              <option value="">Pick an item…</option>
              {items.map((i) => <option key={i.id} value={i.id}>{i.sku} — {i.name}</option>)}
            </select>
          </div>
        )}

        <div className="rm-fld">
          <label>Location</label>
          <select value={locPick} onChange={(e) => setLocPick(e.target.value)} disabled={!item}>
            {locations.map((l) => <option key={l} value={l}>{l}</option>)}
            <option value={NEW_LOC}>+ New location…</option>
          </select>
          {locPick === NEW_LOC && (
            <input style={{ marginTop: 6 }} type="text" value={newLoc} onChange={(e) => setNewLoc(e.target.value)} placeholder="e.g. Medan Warehouse" autoFocus />
          )}
        </div>

        <div className="rm-fld">
          <label>Movement</label>
          <div className="rm-seg">
            <button type="button" className={direction === "in" ? "on in" : ""} onClick={() => pickDirection("in")}>+ Increase</button>
            <button type="button" className={direction === "out" ? "on out" : ""} onClick={() => pickDirection("out")}>− Decrease</button>
          </div>
        </div>

        <div className="rm-row2">
          <div className="rm-fld">
            <label>Quantity{units ? ` (${units.primaryLabel})` : ""}</label>
            <input type="number" min="0" value={qty} onChange={(e) => setQty(e.target.value)} className="mono" placeholder="0" />
          </div>
          <div className="rm-fld">
            <label>Date</label>
            <input type="date" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>

        <div className="rm-row2">
          <div className="rm-fld">
            <label>Reason</label>
            <select value={reason} onChange={(e) => setReason(e.target.value)}>
              {MOVEMENT_REASONS[direction].map((r) => <option key={r}>{r}</option>)}
            </select>
          </div>
          <div className="rm-fld">
            <label>Unit cost (Rp)</label>
            {direction === "in" ? (
              <input type="number" min="0" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} className="mono"
                placeholder={currentCost != null ? String(currentCost) : "Required"} />
            ) : (
              <input type="text" readOnly tabIndex={-1} className="mono rm-ro"
                value={preview.row ? preview.row.unit_cost.toLocaleString("id-ID") : "—"} />
            )}
            <span className="rm-hint">
              {direction === "in" ? "Blank uses the current carried cost." : "Carried cost on that date — not typed."}
            </span>
          </div>
        </div>

        <textarea className="vd-modal-reason" placeholder="Note (optional) — e.g. count sheet #14, pallet water damage" value={note} onChange={(e) => setNote(e.target.value)} />

        {item && preview.row && (
          <div className="rm-preview">
            <div className="rm-prev-line">
              <span>{loc.trim() || "Location"}</span>
              <span className="mono">
                {before.toLocaleString("id-ID")} → <strong>{after.toLocaleString("id-ID")}</strong> {units?.primaryLabel}
              </span>
            </div>
            <div className="rm-prev-line">
              <span>Value</span>
              <span className={`mono ${preview.row.unit > 0 ? "rm-pos" : "rm-neg"}`}>
                {preview.row.unit > 0 ? "+" : "−"}{formatRupiahExact(Math.abs(preview.row.value))}
              </span>
            </div>
            <div className="rm-je">
              <div className="rm-je-title">Draft journal entry</div>
              {lines.map((l, i) => (
                <div key={i} className="rm-je-line">
                  <span>{l.debit ? "Dr" : "Cr"} {l.account_code} {l.account_name}</span>
                  <span className="mono">{formatRupiahExact(l.debit || l.credit)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {(tried || preview.row) && !preview.ok && (
          <div className="rm-error">{preview.error}</div>
        )}

        <div className="vd-modal-actions">
          <button className="vd-btn" onClick={onClose}>Cancel</button>
          <button className="vd-btn primary" onClick={submit} disabled={tried && !preview.ok}>Record movement</button>
        </div>
      </div>
    </div>
  );
}
