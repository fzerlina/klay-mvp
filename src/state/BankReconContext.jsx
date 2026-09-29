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
import { CURRENT_PERIOD } from "../data/seed/bankStatement";
import { historicalResolutions } from "../lib/bankReconHistory";

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

  const saveDraft = useCallback((id, draft) => {
    setDrafts((prev) => ({ ...prev, [id]: draft }));
  }, []);

  const markUploaded = useCallback((key, at) => {
    setUploaded((prev) => ({ ...prev, [key]: at }));
  }, []);

  const resolve = useCallback((id, res) => {
    setResolutions((prev) => ({ ...prev, [id]: res }));
  }, []);

  // A batch is one state write, not N. Writing off four fees one at a time
  // would re-render (and re-derive every account's state) four times, and the
  // intermediate states are ones nobody decided on.
  // Takes a decision back — used to move an item out of "Marked for later".
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

  const value = useMemo(
    () => ({ resolutions, uploaded, drafts, resolve, unresolve, resolveMany, markUploaded, saveDraft }),
    [resolutions, uploaded, drafts, resolve, unresolve, resolveMany, markUploaded, saveDraft],
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
