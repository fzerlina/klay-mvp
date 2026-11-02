import { useEffect, useRef } from "react";
import { useJournalEntries } from "./JournalEntriesContext";
import { useAssets } from "./AssetsContext";
import { useClosePeriod } from "./ClosePeriodContext";
import {
  scheduledEntries, dueForAutoPost, postedFromSchedule, jeNumberAfter, SYSTEM_ACTOR,
} from "../lib/scheduledJournals";
import { isoOf } from "../lib/journalLifecycle";
import { TODAY } from "../lib/clock";

// Scheduled entries post themselves on their date (agreed 25 Oct 2026, as the
// Core Ledger PRD §7 has it for auto-reversals): no queue, no approval, posted
// by the system. Covers the asset register's depreciation and amortisation
// and — since 2 Nov 2026 — recurring journals' copies, which were approved
// once with the entry they repeat. (Auto-reversals were dropped the same day.)
// A date in a closed period is skipped (lib/scheduledJournals.js).
//
// Mounted once inside the providers (App.jsx); renders nothing. It runs
// whenever entries, assets or the closed period change, so a copy whose date
// has already passed posts at once.
export default function ScheduledAutoPost() {
  const { entries, addJournalEntry, peekNextJeNumber } = useJournalEntries();
  const { assets } = useAssets();
  const { closedThrough } = useClosePeriod();
  // Keys already handled this session — state updates land after this effect,
  // and a second run before they do must not post the same month twice.
  const done = useRef(new Set());

  useEffect(() => {
    const today = isoOf(TODAY);
    const rows = scheduledEntries(assets, { entries, closedThrough, today: TODAY });
    const toPost = dueForAutoPost(rows, { today, closedThrough }).filter((je) => !done.current.has(je.schedule_key));
    if (!toPost.length) return;
    const base = peekNextJeNumber();
    toPost.forEach((je, i) => {
      done.current.add(je.schedule_key);
      const jeNumber = jeNumberAfter(base, i);
      addJournalEntry(postedFromSchedule(je, { jeNumber, by: SYSTEM_ACTOR, today, system: true }));
    });
  }, [entries, assets, closedThrough, addJournalEntry, peekNextJeNumber]);

  return null;
}
