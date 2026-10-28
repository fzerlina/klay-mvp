import { useEffect, useRef } from "react";
import { useJournalEntries } from "./JournalEntriesContext";
import { useAssets } from "./AssetsContext";
import { useClosePeriod } from "./ClosePeriodContext";
import {
  scheduledEntries, dueForAutoPost, dueForDrafting, postedFromSchedule, jeNumberAfter, SYSTEM_ACTOR,
} from "../lib/scheduledJournals";
import { draftFromRecurring } from "../lib/recurringJournals";
import { withEvent, isoOf } from "../lib/journalLifecycle";
import { TODAY } from "../lib/clock";

// Scheduled entries post themselves on their date (agreed 25 Oct 2026, as the
// Core Ledger PRD §7 has it for auto-reversals): no queue, no approval, posted
// by the system. Covers the asset register's depreciation and amortisation,
// and auto-reversals. A date in a closed period waits for the first open one
// (lib/scheduledJournals.js already moves it there).
//
// A recurring journal's month is the exception: on its date it becomes a
// draft for whoever set the schedule up, never a posting
// (lib/recurringJournals.js).
//
// Mounted once inside the providers (App.jsx); renders nothing. It runs
// whenever entries, assets or the closed period change, so an
// accrual posted today with a reversal date that has already passed reverses
// at once.
export default function ScheduledAutoPost() {
  const { entries, addJournalEntry, updateJournalEntry, peekNextJeNumber } = useJournalEntries();
  const { assets } = useAssets();
  const { closedThrough } = useClosePeriod();
  // Keys already handled this session — state updates land after this effect,
  // and a second run before they do must not post or draft the same month twice.
  const done = useRef(new Set());

  useEffect(() => {
    const today = isoOf(TODAY);
    const rows = scheduledEntries(assets, { entries, closedThrough, today: TODAY });
    const fresh = (je) => !done.current.has(je.schedule_key);
    const toPost = dueForAutoPost(rows, { today, closedThrough }).filter(fresh);
    const toDraft = dueForDrafting(rows, { today, closedThrough }).filter(fresh);
    if (!toPost.length && !toDraft.length) return;
    const base = peekNextJeNumber();
    toPost.forEach((je, i) => {
      done.current.add(je.schedule_key);
      const jeNumber = jeNumberAfter(base, i);
      addJournalEntry(postedFromSchedule(je, { jeNumber, by: SYSTEM_ACTOR, today, system: true }));
      if (je.reversal_of) {
        updateJournalEntry(je.reversal_of, (cur) => withEvent({ ...cur, reversed_by: jeNumber }, "reversed", SYSTEM_ACTOR, `By ${jeNumber}`));
      }
    });
    toDraft.forEach((je, i) => {
      done.current.add(je.schedule_key);
      addJournalEntry(draftFromRecurring(je, { jeNumber: jeNumberAfter(base, toPost.length + i), by: SYSTEM_ACTOR, today }));
    });
  }, [entries, assets, closedThrough, addJournalEntry, updateJournalEntry, peekNextJeNumber]);

  return null;
}
