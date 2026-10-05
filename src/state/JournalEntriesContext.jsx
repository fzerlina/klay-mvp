import { createContext, useContext, useMemo, useState, useCallback } from "react";
import { JOURNAL_ENTRIES as SEED_JES } from "../data/seed/journalEntries";
import { PAYMENT_HISTORY_JES } from "../data/seed/paymentHistory";
import { LEDGER_BACKFILL_JES } from "../data/seed/ledgerBackfill";
import { RECURRING_TEMPLATES } from "../data/seed/recurringJournals";
import { TODAY } from "../lib/clock";

const JournalEntriesContext = createContext(null);

// Compute the next JE number. JE numbers in the seed are JE-YYYY-NNNN.
// We pick the current year (or fall back to the highest year present) and
// the next sequence after the highest NNNN within that year.
function nextJeNumber(list) {
  // The demo clock, not the wall clock: every date in this prototype is 2025,
  // and numbering a new entry JE-2026-xxxx next to a 2025 posting date reads as
  // a bug on screen.
  const year = TODAY.getFullYear();
  const prefix = `JE-${year}-`;
  const matches = list
    .map((j) => {
      const m = /^JE-(\d{4})-(\d+)$/.exec(j.je_number || "");
      return m ? { year: parseInt(m[1], 10), n: parseInt(m[2], 10) } : null;
    })
    .filter(Boolean);

  const sameYear = matches.filter((x) => x.year === year);
  const seqMax = sameYear.length
    ? Math.max(...sameYear.map((x) => x.n))
    : (matches.length ? Math.max(...matches.map((x) => x.n)) : 0);

  return prefix + String(seqMax + 1).padStart(4, "0");
}

export function JournalEntriesProvider({ children }) {
  // The seeded ledger plus the entries the seeded payments wrote, so a payment
  // row on Bill Detail can link to an entry that is actually here, plus the
  // bill postings, bill payments and opening balances the seed implies but
  // never wrote (seed/ledgerBackfill.js) so the General Ledger adds up.
  const [entries, setEntries] = useState(() => [...SEED_JES, ...PAYMENT_HISTORY_JES, ...LEDGER_BACKFILL_JES]);
  // A draft staged from another page (e.g. a stock adjustment) for the Journal
  // Entry page to open pre-filled: { memo, lines: [{account_code, debit, credit, description}] }.
  const [pendingDraft, setPendingDraft] = useState(null);

  const addJournalEntry = useCallback((je) => {
    setEntries((prev) => [je, ...prev]);
    return je;
  }, []);

  // Lifecycle moves (submit, approve, return, void, reverse) and edits to a
  // draft replace the entry in place. `update` receives the current entry and
  // returns the next one (lib/journalLifecycle.js builds it).
  const updateJournalEntry = useCallback((jeNumber, update) => {
    setEntries((prev) => prev.map((je) => (je.je_number === jeNumber ? update(je) : je)));
  }, []);

  const peekNextJeNumber = useCallback(() => nextJeNumber(entries), [entries]);

  const stagePendingDraft = useCallback((draft) => setPendingDraft(draft), []);
  const clearPendingDraft = useCallback(() => setPendingDraft(null), []);

  // Recurring templates (seed/recurringJournals.js). Each active one drafts a
  // Scheduled entry per open month on the Journal Entry page.
  const [templates, setTemplates] = useState(() => RECURRING_TEMPLATES);
  const addTemplate = useCallback((tpl) => setTemplates((prev) => [...prev, tpl]), []);
  const updateTemplate = useCallback((id, patch) => setTemplates((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t))), []);
  const removeTemplate = useCallback((id) => setTemplates((prev) => prev.filter((t) => t.id !== id)), []);

  const value = useMemo(
    () => ({
      entries, addJournalEntry, updateJournalEntry, peekNextJeNumber,
      pendingDraft, stagePendingDraft, clearPendingDraft,
      templates, addTemplate, updateTemplate, removeTemplate,
    }),
    [entries, addJournalEntry, updateJournalEntry, peekNextJeNumber, pendingDraft, stagePendingDraft, clearPendingDraft,
      templates, addTemplate, updateTemplate, removeTemplate],
  );

  return <JournalEntriesContext.Provider value={value}>{children}</JournalEntriesContext.Provider>;
}

export function useJournalEntries() {
  const ctx = useContext(JournalEntriesContext);
  if (!ctx) throw new Error("useJournalEntries must be used inside <JournalEntriesProvider>");
  return ctx;
}
