import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { useCurrentUser } from "./CurrentUserContext";
import { TODAY } from "../lib/clock";
import { SETTINGS_AUDIT } from "../data/seed/settingsAudit";

// The Settings audit trail: one log of every change made on a Settings page —
// who, when, where (section and tab) and what (old → new). Pages call `log`
// when they save; SettingsHeader shows the log for its section behind a
// History button, with a switch to see every section.
//
//   entry: { id, at (ISO date-time), by, area, page, summary }
//     area — the Settings section ("Company", "General Ledger", "Payables"…)
//     page — the tab within it ("Tax", "Chart of accounts"…)

const SettingsAuditContext = createContext(null);

// The demo clock's day with the wall clock's time, so a change made now sorts
// after the seeded history.
function nowIso() {
  const t = new Date();
  const d = new Date(TODAY);
  d.setHours(t.getHours(), t.getMinutes(), t.getSeconds());
  return d.toISOString();
}

let seq = 0;

export function SettingsAuditProvider({ children }) {
  const { user } = useCurrentUser();
  const [entries, setEntries] = useState(SETTINGS_AUDIT);
  const log = useCallback((area, page, summary) => {
    setEntries((cur) => [{ id: `SA-${Date.now()}-${++seq}`, at: nowIso(), by: user.name, area, page, summary }, ...cur]);
  }, [user.name]);
  const value = useMemo(() => ({ entries, log }), [entries, log]);
  return <SettingsAuditContext.Provider value={value}>{children}</SettingsAuditContext.Provider>;
}

export function useSettingsAudit() {
  const ctx = useContext(SettingsAuditContext);
  if (!ctx) throw new Error("useSettingsAudit must be used within SettingsAuditProvider");
  return ctx;
}

// For fields that save as you type: one audit entry per edit, written when the
// field loses focus, instead of one per keystroke. Spread the result on the
// input: <input {...track("Next number", s.nextNumber)} />.
export function useFieldAudit(area, page) {
  const { log } = useSettingsAudit();
  const start = useRef({});
  return (label, value, fmt = (v) => (v == null || v === "" ? "—" : String(v))) => ({
    onFocus: () => { start.current[label] = value; },
    onBlur: () => {
      const from = start.current[label];
      delete start.current[label];
      if (from !== undefined && from !== value) log(area, page, `${label}: ${fmt(from)} → ${fmt(value)}`);
    },
  });
}
