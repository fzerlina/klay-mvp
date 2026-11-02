// Non-Bank Reconciliation — the months people have worked, per account.
//
// One record per account per month: the evidence (ending balance, statement
// date, a cash count or an attachment), which GL lines it includes, and where
// it is in its review. The numbers are never stored — lib/nonBankRecon.js
// derives them from the ledger on every render, so a difference journal posted
// a second ago is already in the sum.
//
// A record moves draft → review → approved. A reviewer can send it back to
// draft with a comment; an approved month can be reopened with a reason. The
// person who approves must not be the person who prepared it.

import { createContext, useContext, useMemo, useState, useCallback } from "react";
import { NON_BANK_ACCOUNTS, NON_BANK_RECON_SEED, NON_BANK_JES } from "../data/seed/nonBankAccounts";
import { resolveSeed, recordKey } from "../lib/nonBankRecon";
import { TODAY } from "../lib/clock";

const NonBankReconContext = createContext(null);
// The demo day in local time — toISOString() would give the UTC day, a day early east of Greenwich.
const TODAY_ISO = `${TODAY.getFullYear()}-${String(TODAY.getMonth() + 1).padStart(2, "0")}-${String(TODAY.getDate()).padStart(2, "0")}`;

export function NonBankReconProvider({ children }) {
  const [records, setRecords] = useState(() => resolveSeed(NON_BANK_RECON_SEED, NON_BANK_ACCOUNTS, NON_BANK_JES));

  // Apply `patch(record)` and append one line to its log.
  const change = useCallback((key, patch, by, text) => {
    setRecords((prev) => {
      const rec = prev[key];
      if (!rec) return prev;
      const next = typeof patch === "function" ? patch(rec) : { ...rec, ...patch };
      return { ...prev, [key]: text ? { ...next, log: [...(rec.log || []), { at: TODAY_ISO, by, text }] } : next };
    });
  }, []);

  const start = useCallback((accountId, period, { statementDate, endingBalance, evidence }, by) => {
    const key = recordKey(accountId, period);
    setRecords((prev) => ({
      ...prev,
      [key]: {
        accountId, period, status: "draft", statementDate, endingBalance, evidence,
        preparedBy: by, submittedAt: null, reviewedBy: null, approvedAt: null, sentBack: null,
        ticked: [], notes: {}, log: [{ at: TODAY_ISO, by, text: "Started" }],
      },
    }));
  }, []);

  const value = useMemo(() => ({
    records,
    start,
    updateEvidence: (key, { statementDate, endingBalance, evidence }, by) =>
      change(key, { statementDate, endingBalance, evidence }, by, "Changed the evidence"),
    setTicked: (key, ids) => change(key, (r) => ({ ...r, ticked: [...ids] })),
    setNote: (key, lineId, note) => change(key, (r) => ({ ...r, notes: { ...r.notes, [lineId]: note } })),
    // Whoever submits is the preparer, so whoever touched it last can't also approve it.
    submit: (key, by) => change(key, { status: "review", submittedAt: TODAY_ISO, sentBack: null, preparedBy: by }, by, "Submitted for review"),
    approve: (key, by) => change(key, { status: "approved", reviewedBy: by, approvedAt: TODAY_ISO }, by, "Approved"),
    sendBack: (key, by, comment) =>
      change(key, { status: "draft", sentBack: { by, at: TODAY_ISO, comment } }, by, `Sent back: ${comment}`),
    reopen: (key, by, reason) =>
      change(key, { status: "draft", reviewedBy: null, approvedAt: null, sentBack: null }, by, `Reopened: ${reason}`),
    logJournal: (key, by, jeNumber) => change(key, (r) => r, by, `Posted difference journal ${jeNumber}`),
  }), [records, start, change]);

  return <NonBankReconContext.Provider value={value}>{children}</NonBankReconContext.Provider>;
}

export function useNonBankRecon() {
  const ctx = useContext(NonBankReconContext);
  if (!ctx) throw new Error("useNonBankRecon must be used inside NonBankReconProvider");
  return ctx;
}
