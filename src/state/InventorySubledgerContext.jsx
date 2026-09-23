import { createContext, useContext, useMemo, useState, useCallback } from "react";
import { useLocation } from "react-router-dom";
import { readStock, balanceProblem, costAsOf } from "../lib/inventorySubledger";
import { TODAY } from "../lib/clock";
import { formatDateEn } from "../lib/format";

// ── Inventory Sub-Ledger state ───────────────────────────────────────────────
//
// The module's in-session movement store, and the only place a movement is ever
// written. It is deliberately a SEPARATE provider from ItemsContext: the two
// modules own different facts, and giving them one store would make it far too
// easy for a stock figure to end up on an item record — which is the failure the
// whole split exists to prevent.
//
// There is no "set the stock to N". A person records a movement — this location,
// up or down by this much, on this date, for this reason — and on-hand is what
// replaying the movements says. Every change is therefore a row with a date, a
// person and a journal behind it, never a silent edit.

const InventorySubledgerContext = createContext(null);

// Local date, not toISOString(): in WIB, local midnight serialises to the
// previous day in UTC.
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const todayIso = () => iso(TODAY);

let seq = 0;
const nextId = () => `MV-${String(++seq).padStart(4, "0")}`;

export function InventorySubledgerProvider({ children }) {
  // itemId → [{id, date, action, loc, unit, unit_cost, value, je, status, reason, note, by}], newest first.
  const [movementLog, setMovementLog] = useState({});
  // itemId → [location names] entered on the item, free text. A location exists
  // from the moment it is named, before anything has moved through it.
  const [locationLog, setLocationLog] = useState({});

  // Reachability is read from the route rather than computed once, so an outage
  // propagates the way a real one would — every consumer re-reads and re-decides
  // what it may still do. Demo switch: ?subledger=down on any URL.
  const { search } = useLocation();
  const online = new URLSearchParams(search).get("subledger") !== "down";

  // The published read (PRD §8.2). Everything downstream goes through this — no
  // consumer touches movementLog directly, so the contract stays the contract.
  const read = useCallback(
    (item, method = "average_cost") =>
      readStock(item, movementLog[item?.id] || [], method, { online, locations: locationLog[item?.id] || [] }),
    [movementLog, locationLog, online],
  );

  const addLocations = useCallback((itemId, names) => {
    const clean = names.map((n) => (n || "").trim()).filter(Boolean);
    if (!clean.length) return;
    setLocationLog((prev) => ({ ...prev, [itemId]: [...new Set([...(prev[itemId] || []), ...clean])] }));
  }, []);

  // Check a movement without writing it — the dialog calls this on every
  // keystroke so the preview and the refusal are the same computation as the
  // write. Returns the row it WOULD write, or the reason it can't.
  const previewMovement = useCallback((item, { loc, direction, qty, date, unit_cost, method = "average_cost" } = {}) => {
    if (!item) return { ok: false, error: "Pick an item" };
    if (!online) return { ok: false, error: "The Inventory Sub-Ledger can't be reached, so there is no confirmed balance to move from." };
    const locName = (loc || "").trim();
    if (!locName) return { ok: false, error: "Pick a location" };
    const n = Number(qty);
    if (!n || n <= 0) return { ok: false, error: "Enter a quantity above zero" };
    const d = date || todayIso();
    if (d > todayIso()) return { ok: false, error: "A movement can't be dated in the future" };

    const session = movementLog[item.id] || [];
    const unit = direction === "out" ? -n : n;
    // An increase comes in at the cost given (defaulting to the current cost);
    // a decrease leaves at what the ledger carried stock at on that date. Either
    // way the cost is FROZEN onto the row, rounded to whole rupiah because it
    // posts as a journal amount.
    const carried = costAsOf(item, session, d, method);
    const cost = direction === "out" ? carried : (unit_cost === "" || unit_cost == null ? carried : Number(unit_cost));
    if (cost == null || isNaN(cost)) {
      return { ok: false, error: direction === "out" ? "Nothing on hand to issue on that date" : "Enter a unit cost — this item has no cost yet" };
    }
    const unitCost = Math.round(cost);
    const row = { date: d, action: "adjust", loc: locName, unit, unit_cost: unitCost, value: unit * unitCost };

    const problem = balanceProblem(item, session, row);
    if (problem) {
      return {
        ok: false, row,
        error: `${problem.loc} would go ${problem.short.toLocaleString("id-ID")} below zero on ${formatDateEn(problem.date)}. Stock can't be negative.`,
      };
    }
    return { ok: true, row };
  }, [movementLog, online]);

  // Write one movement. Nothing else changes: there is no quantity or value
  // field to update, because none exists. The journal is drafted by the caller
  // (JournalEntries lives inside this provider) and its number is stamped here.
  const recordMovement = useCallback((item, input = {}) => {
    const p = previewMovement(item, input);
    if (!p.ok) return p;
    const row = {
      ...p.row,
      id: nextId(),
      reason: input.reason || null,
      note: (input.note || "").trim(),
      by: input.by || null,
      je: input.je_number || null,
      status: input.je_number ? "draft" : null,
    };
    setMovementLog((prev) => ({ ...prev, [item.id]: [row, ...(prev[item.id] || [])] }));
    addLocations(item.id, [row.loc]);
    return { ok: true, row };
  }, [previewMovement, addLocations]);

  // Opening balances for a new item: one movement per location with a
  // quantity, at the cost given. Locations entered with no quantity are still
  // registered, so they can be picked when the first movement is recorded.
  const recordOpening = useCallback((item, lines, { je_number, by, date } = {}) => {
    const d = date || todayIso();
    addLocations(item.id, lines.map((l) => l.loc));
    const rows = lines
      .filter((l) => (l.loc || "").trim() && Number(l.qty) > 0)
      .map((l) => {
        const unit = Number(l.qty);
        const unitCost = Math.round(Number(l.unit_cost) || 0);
        return {
          id: nextId(), date: d, action: "opening", loc: l.loc.trim(), unit, unit_cost: unitCost,
          value: unit * unitCost, reason: "Opening balance", note: "", by: by || null,
          je: je_number || null, status: je_number ? "draft" : null,
        };
      });
    if (rows.length) setMovementLog((prev) => ({ ...prev, [item.id]: [...rows.reverse(), ...(prev[item.id] || [])] }));
    return rows;
  }, [addLocations]);

  const value = useMemo(
    () => ({ read, previewMovement, recordMovement, recordOpening, addLocations, movementLog, online }),
    [read, previewMovement, recordMovement, recordOpening, addLocations, movementLog, online],
  );
  return <InventorySubledgerContext.Provider value={value}>{children}</InventorySubledgerContext.Provider>;
}

export function useInventorySubledger() {
  const ctx = useContext(InventorySubledgerContext);
  if (!ctx) throw new Error("useInventorySubledger must be used inside <InventorySubledgerProvider>");
  return ctx;
}
