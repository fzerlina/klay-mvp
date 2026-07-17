import { createContext, useContext, useMemo, useState, useCallback } from "react";
import { BILLS as SEED_BILLS } from "../data/seed/bills";

const BillsContext = createContext(null);

function isoNow() {
  const d = new Date();
  return {
    date: d.toISOString().slice(0, 10),
    time: d.toTimeString().slice(0, 5),
  };
}

function nextId(list) {
  const nums = list
    .map((b) => parseInt(String(b.id).replace(/[^0-9]/g, ""), 10))
    .filter((n) => !isNaN(n));
  const max = nums.length ? Math.max(...nums) : 0;
  return "BILL" + String(max + 1).padStart(3, "0");
}

export function BillsProvider({ children }) {
  const [bills, setBills] = useState(() => SEED_BILLS);

  const addBill = useCallback((draft) => {
    const id = nextId(bills);
    const { date, time } = isoNow();
    const audit = [
      {
        type: "created",
        action: draft.fromAI ? "Bill dibuat otomatis oleh AI" : "Bill dibuat",
        by: draft.fromAI ? "Klay AI System" : "Sarah Wijaya",
        date,
        time,
      },
    ];
    if (draft.approval === "review") {
      audit.push({
        type: "submitted",
        action: "Submit untuk approval",
        by: "Sarah Wijaya",
        date,
        time,
      });
    }
    const record = {
      id,
      vendor: draft.vendor,
      vendorName: draft.vendorName,
      initials: draft.initials || "",
      poNo: draft.poNo || "—",
      invNo: draft.invNo || "—",
      date: draft.date,
      due: draft.due,
      grn: draft.grn || "pending",
      dpp: draft.dpp,
      ppn: draft.ppn,
      pph23: draft.pph23 || 0,
      total: draft.total,
      // sisa (outstanding AP balance) tracks the gross document total, matching
      // the seed convention and AP-aging math. Net-of-PPh is a display value
      // only ("Net Payable" on the form), never the subledger balance.
      sisa: draft.sisa != null ? draft.sisa : draft.total,
      approval: draft.approval || "draft",
      pay: "unpaid",
      isAI: !!draft.fromAI,
      keterangan: draft.keterangan || "",
      // No-document path (Create Bill PRD): set when a bill is created without
      // a source document; justification is captured in the confirm modal.
      no_document_flag: !!draft.no_document_flag,
      no_document_justification: draft.no_document_justification || "",
      items: draft.items,
      audit,
    };
    setBills((prev) => [record, ...prev]);
    return record;
  }, [bills]);

  // Apply a partial patch to a bill. Optionally append one audit entry in the
  // same update so the workflow transition + its audit log are atomic. Used
  // by BillDetailPage's ActionBar to simulate posting: workflow transition,
  // payment recording, etc.
  const updateBill = useCallback((id, patch, auditEntry) => {
    setBills((prev) => prev.map((b) => {
      if (b.id !== id) return b;
      const next = { ...b, ...patch };
      if (auditEntry) {
        next.audit = [...(b.audit || []), auditEntry];
      }
      return next;
    }));
  }, []);

  const value = useMemo(() => ({ bills, addBill, updateBill }), [bills, addBill, updateBill]);

  return <BillsContext.Provider value={value}>{children}</BillsContext.Provider>;
}

export function useBills() {
  const ctx = useContext(BillsContext);
  if (!ctx) throw new Error("useBills must be used inside <BillsProvider>");
  return ctx;
}
