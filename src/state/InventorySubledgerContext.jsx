import { createContext, useContext, useMemo, useState, useCallback } from "react";
import { useLocation } from "react-router-dom";
import { readStock } from "../lib/inventorySubledger";
import { TODAY } from "../lib/clock";

// ── Inventory Sub-Ledger state ───────────────────────────────────────────────
//
// The module's in-session movement store, and the only place a movement is ever
// written. It is deliberately a SEPARATE provider from ItemsContext: the two
// modules own different facts, and giving them one store would make it far too
// easy for a stock figure to end up on an item record — which is the failure the
// whole split exists to prevent.
//
// Item Master consumes this through `read(item)` only. It has no writer here,
// by design: correcting a stock figure means recording a movement, and that is
// the sub-ledger's job. Once the sub-ledger has screens, they are what calls
// `recordAdjustment`.

const InventorySubledgerContext = createContext(null);

const today = () => TODAY.toISOString().slice(0, 10);

export function InventorySubledgerProvider({ children }) {
  // itemId → [{date, action, loc, unit, unit_cost, value, je, note}], newest first.
  const [movementLog, setMovementLog] = useState({});

  // Reachability is read from the route rather than computed once, so an outage
  // propagates the way a real one would — every consumer re-reads and re-decides
  // what it may still do. Demo switch: ?subledger=down on any Item Master URL.
  const { search } = useLocation();
  const online = new URLSearchParams(search).get("subledger") !== "down";

  // The published read (PRD §8.2). Everything downstream goes through this — no
  // consumer touches movementLog directly, so the contract stays the contract.
  const read = useCallback(
    (item, method = "average_cost") => readStock(item, movementLog[item?.id] || [], method, { online }),
    [movementLog, online],
  );

  // Record a stock movement — a count correction, damage, shrinkage, or the
  // opening balance of a new item (same shape, different reason).
  //
  // It writes ONE movement and nothing else. There is no quantity or value field
  // to update, because none exists: the balance this produces is whatever
  // replaying the ledger says. The cost is read at this moment and FROZEN onto
  // the row, so a later cost change cannot reach back and re-value it. The GL
  // side posts separately as a journal — stock moves here, the books follow.
  const recordAdjustment = useCallback((item, { loc, newQty, reason, note, je_number, method = "average_cost" } = {}) => {
    if (!item) return null;
    const current = readStock(item, movementLog[item.id] || [], method, { online });
    if (!current.stocked) return null;
    // Fail closed: without a confirmed balance there is nothing to adjust FROM,
    // and writing a movement against a guess would post a wrong journal amount.
    if (current.state === "unavailable") return null;

    const locName = loc || current.by_location[0]?.loc || "Main Warehouse";
    const oldQty = current.by_location.find((l) => l.loc === locName)?.qty || 0;
    const nq = Number(newQty) || 0;
    const delta = nq - oldQty;
    if (!delta) return { delta: 0, valueDelta: 0, oldQty, newQty: nq, loc: locName };

    // Rounded to whole rupiah: this cost is frozen onto the movement and posted
    // as a journal amount, and a journal cannot carry a fraction of a rupiah.
    const unitCost = Math.round(current.current_unit_cost ?? 0);
    const valueDelta = delta * unitCost;
    const reasonLabel = reason ? `${reason}${note ? ` — ${note}` : ""}` : (note || "");

    setMovementLog((prev) => ({
      ...prev,
      [item.id]: [
        { date: today(), action: "adjust", loc: locName, unit: delta, unit_cost: unitCost, value: valueDelta, je: je_number || null, note: reasonLabel },
        ...(prev[item.id] || []),
      ],
    }));
    return { delta, valueDelta, oldQty, newQty: nq, loc: locName, unitCost };
  }, [movementLog, online]);

  const value = useMemo(
    () => ({ read, recordAdjustment, movementLog, online }),
    [read, recordAdjustment, movementLog, online],
  );
  return <InventorySubledgerContext.Provider value={value}>{children}</InventorySubledgerContext.Provider>;
}

export function useInventorySubledger() {
  const ctx = useContext(InventorySubledgerContext);
  if (!ctx) throw new Error("useInventorySubledger must be used inside <InventorySubledgerProvider>");
  return ctx;
}
