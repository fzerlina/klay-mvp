import { createContext, useContext, useMemo, useState, useCallback } from "react";
import { INVOICES as SEED_INVOICES } from "../data/seed/invoices";

const InvoicesContext = createContext(null);

function isoNow() {
  const d = new Date();
  return {
    date: d.toISOString().slice(0, 10),
    time: d.toTimeString().slice(0, 5),
  };
}

function nextId(list) {
  const nums = list
    .map((i) => parseInt(String(i.id).replace(/[^0-9]/g, ""), 10))
    .filter((n) => !isNaN(n));
  const max = nums.length ? Math.max(...nums) : 0;
  return "INV" + String(max + 1).padStart(3, "0");
}

export function InvoicesProvider({ children }) {
  const [invoices, setInvoices] = useState(() => SEED_INVOICES);

  const addInvoice = useCallback((draft) => {
    const id = nextId(invoices);
    const { date, time } = isoNow();
    const audit = [
      {
        type: "created",
        action: draft.fromAI ? "Invoice created automatically by AI" : "Invoice created",
        by: draft.fromAI ? "Klay AI System" : "Sarah Wijaya",
        date,
        time,
      },
    ];
    const record = {
      id,
      invNo: draft.invNo || "—",
      custPO: draft.custPO || "—",
      customer: draft.customer,
      customerName: draft.customerName,
      custCode: draft.custCode || "",
      custEmail: draft.custEmail || "",
      date: draft.date,
      due: draft.due,
      dpp: draft.dpp,
      total: draft.total,
      approval: "draft",
      payStatus: "unpaid",
      isAI: !!draft.fromAI,
      items: draft.items,
      audit,
    };
    setInvoices((prev) => [record, ...prev]);
    return record;
  }, [invoices]);

  const sendInvoice = useCallback((id, sendInfo = {}) => {
    const { date, time } = isoNow();
    setInvoices((prev) =>
      prev.map((inv) => {
        if (inv.id !== id) return inv;
        const invNo = inv.invNo === "—"
          ? `INV-${inv.custCode?.replace(/-/g, "") || "CUST"}-${date.replace(/-/g, "")}`
          : inv.invNo;
        return {
          ...inv,
          approval: "sent",
          invNo,
          audit: [
            ...inv.audit,
            {
              type: "sent",
              action: sendInfo.channel === "wa"
                ? "Invoice sent via WhatsApp"
                : "Invoice sent via Email",
              by: "Sarah Wijaya",
              date,
              time,
            },
          ],
        };
      }),
    );
  }, []);

  // A customer receipt reconciled on a bank statement. The invoice is paid in
  // full when the receipt is short of the subtotal by no more than the 2% PPh 23
  // the customer withholds; otherwise it is part-paid. `lineId` ties it to the
  // statement line so undoing the reconciliation takes it back.
  const recordReceipt = useCallback((id, { amount, date, lineId, by, paysInFull }) => {
    const { time } = isoNow();
    setInvoices((prev) =>
      prev.map((inv) => {
        if (inv.id !== id) return inv;
        const receipts = [...(inv.receipts || []), { amount, date, lineId }];
        return {
          ...inv,
          receipts,
          payStatus: paysInFull ? "paid" : "partial",
          _payStatusBefore: inv._payStatusBefore ?? inv.payStatus,
          audit: [
            ...inv.audit,
            { type: "paid", action: paysInFull ? "Payment received — reconciled on bank statement" : "Part payment received — reconciled on bank statement", by, date, time },
          ],
        };
      }),
    );
  }, []);

  const undoReceipt = useCallback((lineId) => {
    setInvoices((prev) =>
      prev.map((inv) => {
        if (!(inv.receipts || []).some((r) => r.lineId === lineId)) return inv;
        const receipts = inv.receipts.filter((r) => r.lineId !== lineId);
        const { _payStatusBefore, ...rest } = inv;
        return receipts.length
          ? { ...inv, receipts }
          : { ...rest, receipts, payStatus: _payStatusBefore || "unpaid", audit: inv.audit.slice(0, -1) };
      }),
    );
  }, []);

  const value = useMemo(
    () => ({ invoices, addInvoice, sendInvoice, recordReceipt, undoReceipt }),
    [invoices, addInvoice, sendInvoice, recordReceipt, undoReceipt],
  );

  return <InvoicesContext.Provider value={value}>{children}</InvoicesContext.Provider>;
}

export function useInvoices() {
  const ctx = useContext(InvoicesContext);
  if (!ctx) throw new Error("useInvoices must be used inside <InvoicesProvider>");
  return ctx;
}
