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

const BankReconContext = createContext(null);

export function BankReconProvider({ children }) {
  // { [exceptionId]: { action, at, by, note, jeNumber } }
  const [resolutions, setResolutions] = useState({});
  // { [accountId]: isoDate } — the account was declared reconciled by a person.
  const [completed, setCompleted] = useState({});

  const resolve = useCallback((id, res) => {
    setResolutions((prev) => ({ ...prev, [id]: res }));
  }, []);

  // A batch is one state write, not N. Writing off four fees one at a time
  // would re-render (and re-derive every account's state) four times, and the
  // intermediate states are ones nobody decided on.
  const resolveMany = useCallback((map) => {
    if (!map || !Object.keys(map).length) return;
    setResolutions((prev) => ({ ...prev, ...map }));
  }, []);

  const markComplete = useCallback((accountId, at) => {
    setCompleted((prev) => ({ ...prev, [accountId]: at }));
  }, []);

  const value = useMemo(
    () => ({ resolutions, completed, resolve, resolveMany, markComplete }),
    [resolutions, completed, resolve, resolveMany, markComplete],
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
export const EMPTY_OVERLAY = { resolutions: {}, completed: {} };
