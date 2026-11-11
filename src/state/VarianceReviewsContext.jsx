// Variance reviews on the Profit & Loss and Trial Balance (user, 11 Nov 2026; Michael's "flags +
// a place for notes" for MVP, DualEntry's flux review).
//
// One review per account per period: { note, by, at, amount, prev }, where
// `amount` / `prev` are the account's figures when it was marked reviewed. If
// the account's amount later differs (another journal posted), the review no
// longer covers it and the flag comes back — DualEntry re-flags the same way.
//
// Every save and reopen is kept in `log` on the review, so an explanation can't
// be quietly rewritten. Prototype storage: this browser (localStorage), like
// the other demo state; the real thing lives with the period's close record.

import { createContext, useCallback, useContext, useMemo, useState } from "react";

const STORE_KEY = "klay.varianceReviews.v1";
const load = () => {
  try { return JSON.parse(window.localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; }
};
const save = (v) => {
  try { window.localStorage.setItem(STORE_KEY, JSON.stringify(v)); } catch { /* demo storage only */ }
};

export const reviewKey = (code, from, to) => `${code}|${from}|${to}`;
export const parseReviewKey = (key) => { const [code, from, to] = key.split("|"); return { code, from, to }; };

// Every review event, newest first — what the Review log page shows.
export function reviewEvents(reviews) {
  const out = [];
  for (const [key, rv] of Object.entries(reviews)) {
    const k = parseReviewKey(key);
    (rv.log || []).forEach((e, i) => out.push({ ...k, ...e, id: `${key}#${i}`, amount: e.amount ?? rv.amount, prev: e.prev ?? rv.prev }));
  }
  return out.sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

const VarianceReviewsContext = createContext(null);

export function VarianceReviewsProvider({ children }) {
  const [reviews, setReviews] = useState(load);
  const update = useCallback((fn) => setReviews((prev) => { const next = fn(prev); save(next); return next; }), []);

  // Mark reviewed with a note, at the account's current figures.
  const markReviewed = useCallback((key, { note, by, amount, prev, report = "pl" }) => update((all) => {
    const at = new Date().toISOString();
    const old = all[key];
    return { ...all, [key]: { note, by, at, amount, prev, log: [...(old?.log || []), { action: old && !old.reopened ? "updated" : "reviewed", by, at, note, amount, prev, report }] } };
  }), [update]);

  // Reopen: the flag shows again; the history stays.
  const reopen = useCallback((key, by, report = "pl") => update((all) => {
    const old = all[key];
    if (!old) return all;
    const at = new Date().toISOString();
    return { ...all, [key]: { ...old, reopened: true, log: [...(old.log || []), { action: "reopened", by, at, report }] } };
  }), [update]);

  const value = useMemo(() => ({ reviews, markReviewed, reopen }), [reviews, markReviewed, reopen]);
  return <VarianceReviewsContext.Provider value={value}>{children}</VarianceReviewsContext.Provider>;
}

export function useVarianceReviews() {
  const ctx = useContext(VarianceReviewsContext);
  if (!ctx) throw new Error("useVarianceReviews must be used within VarianceReviewsProvider");
  return ctx;
}
