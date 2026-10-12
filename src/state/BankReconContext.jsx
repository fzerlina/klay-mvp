// What people decided about a reconciliation, kept apart from the reconciliation.
//
// The matching run (lib/bankMatching.js) is a pure function of the statement and
// the ledger: given the same two lists it always produces the same links and the
// same exceptions. What a Finance Manager then DID about an exception — wrote
// off the fee, acknowledged the timing item, escalated the mystery — is not part
// of that derivation, and storing it inside the engine would mean every re-run
// had to be careful not to discard it.
//
// So decisions live here, and screens lay them over the run.
//
// They live in a context rather than in the reconciliation page's own state for
// one reason: the close board asks the same question. Write off the last open
// fee on the reconciliation page and Gate 4 on the close board has to agree —
// which it cannot do if the decision only exists inside a component that the
// close board never renders. Two screens, one answer; that was the whole point
// of pointing Gate 4 at the real run in the first place.

import { createContext, useContext, useMemo, useState, useCallback } from "react";
import { CURRENT_PERIOD, markStatementOnFile } from "../data/seed/bankStatement";
import { clearReconciliationCache } from "../lib/bankRecon";
import { historicalResolutions } from "../lib/bankReconHistory";
import { useJournalEntries } from "./JournalEntriesContext";

// One key per account per month. The current month keeps the bare account id,
// which is what Gate 4 on the close board reads.
export const periodKey = (accountId, period = CURRENT_PERIOD) =>
  period === CURRENT_PERIOD ? accountId : `${accountId}|${period}`;

const BankReconContext = createContext(null);

export function BankReconProvider({ children }) {
  // { [exceptionId]: { action, at, by, note, jeNumber } }
  // Seeded with how the previous months were left (lib/bankReconHistory.js).
  const [resolutions, setResolutions] = useState(historicalResolutions);
  // { [periodKey]: isoDate } — a statement for a past month was uploaded. The
  // current month's statements are already on file, so they never appear here.
  const [uploaded, setUploaded] = useState({});
  // { [exceptionId]: { je_date, memo, lines } } — a bank fee or interest journal
  // somebody edited but has not posted yet. Unedited lines use Klay's draft.
  const [drafts, setDrafts] = useState({});
  // { [exceptionId]: true } — a line whose suggestion somebody set aside to
  // match it by hand. It is still undecided; it just sits in To match now,
  // and its suggested record is free to pair with anything.
  const [manual, setManual] = useState({});
  // { [recordId]: record } — cash journals posted from To match's Quick draft,
  // for a statement line nothing in Klay explained. Each is a book record in the
  // shape bankLedger.js gives (plus accountId, period, lineId), held here
  // because the seed ledger the engine reads never sees it. It is not paired
  // with its line automatically: it appears on the Klay side, and the line is
  // reconciled to it by hand.
  const [quickDrafts, setQuickDrafts] = useState({});
  const addQuickDraft = useCallback((record) => {
    setQuickDrafts((prev) => ({ ...prev, [record.id]: record }));
  }, []);

  const setManualFor = useCallback((id, on) => {
    setManual((prev) => {
      const next = { ...prev };
      if (on) next[id] = true; else delete next[id];
      return next;
    });
  }, []);

  const saveDraft = useCallback((id, draft) => {
    setDrafts((prev) => ({ ...prev, [id]: draft }));
  }, []);

  // A statement was uploaded, reaching `through`. The module-level record
  // (bankStatement.js) and the cached runs are updated first, so the re-render
  // this state change triggers already sees the lines — on this page and every
  // other. `uploaded` keeps each upload, newest last.
  const markUploaded = useCallback((accountId, { at, through, file, added = 0, period = CURRENT_PERIOD }) => {
    if (period === CURRENT_PERIOD) markStatementOnFile(accountId, through);
    clearReconciliationCache();
    setUploaded((prev) => {
      const key = periodKey(accountId, period);
      return { ...prev, [key]: [...(prev[key] || []), { at, through, file, added }] };
    });
  }, []);

  const resolve = useCallback((id, res) => {
    setResolutions((prev) => ({ ...prev, [id]: res }));
  }, []);

  // A batch is one state write, not N. Writing off four fees one at a time
  // would re-render (and re-derive every account's state) four times, and the
  // intermediate states are ones nobody decided on.
  // Takes a decision back — Undo on a match, Move back on a line marked for later.
  const unresolve = useCallback((id) => {
    setResolutions((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const resolveMany = useCallback((map) => {
    if (!map || !Object.keys(map).length) return;
    setResolutions((prev) => ({ ...prev, ...map }));
  }, []);

  // ── Reversals in the GL ────────────────────────────────────────────────────
  //
  // A posted journal is never undone here; it is reversed on the Journal Entry
  // page. This page follows: a line whose journal was reversed is no longer
  // reconciled, and reopens where it started.
  //
  //   fee or interest   back in To post, with a fresh draft — the bank line
  //                     still has to be booked
  //   a booked          back in To match with the rest of its match: the
  //     difference      difference was part of how the lines balanced, so the
  //                     match goes with it
  //   a matched cash    the same — the line was reconciled to something the
  //     journal         books no longer hold. A quick-drafted journal that was
  //                     reversed also drops off the Klay side
  //
  // Derived, not stored: what the GL says wins, every render, for every screen
  // that reads this context (the close board included).
  const { entries } = useJournalEntries();
  const reversedBy = useMemo(() => {
    const out = {};
    for (const je of entries) {
      if (!je.reversed_by) continue;
      const rev = entries.find((x) => x.je_number === je.reversed_by);
      out[je.je_number] = { je: je.reversed_by, by: rev?.posted_by || rev?.created_by || "" };
    }
    return out;
  }, [entries]);

  const { effective, reopened } = useMemo(() => {
    const eff = { ...resolutions };
    const back = {};
    for (const [id, r] of Object.entries(resolutions)) {
      if (!r || r.action === "later") continue;
      const je = [r.jeNumber, ...(r.journals || [])].find((n) => n && reversedBy[n]);
      if (!je) continue;
      back[id] = { je, reversedBy: reversedBy[je].je, by: reversedBy[je].by };
      delete eff[id];
    }
    return { effective: eff, reopened: back };
  }, [resolutions, reversedBy]);

  const liveQuickDrafts = useMemo(
    () => Object.fromEntries(Object.entries(quickDrafts).filter(([, r]) => !reversedBy[r.ref])),
    [quickDrafts, reversedBy],
  );

  const value = useMemo(
    () => ({ resolutions: effective, uploaded, drafts, manual, reopened, quickDrafts: liveQuickDrafts, resolve, unresolve, resolveMany, markUploaded, saveDraft, setManualFor, addQuickDraft }),
    [effective, uploaded, drafts, manual, reopened, liveQuickDrafts, resolve, unresolve, resolveMany, markUploaded, saveDraft, setManualFor, addQuickDraft],
  );

  return <BankReconContext.Provider value={value}>{children}</BankReconContext.Provider>;
}

export function useBankRecon() {
  const ctx = useContext(BankReconContext);
  if (!ctx) throw new Error("useBankRecon must be used inside <BankReconProvider>");
  return ctx;
}

// For the non-React callers (computeBankRecon in the apClose seed, the task
// hub): the overlay is passed in as plain data rather than reached for, so
// those stay pure functions of their arguments.
export const EMPTY_OVERLAY = { resolutions: {}, uploaded: {}, drafts: {} };
