// Scheduled journal entries — drafted from a schedule, waiting for their date.
//
// Two sources feed it:
//   • the fixed asset register (depreciation and amortisation, below);
//   • recurring journals (lib/recurringJournals.js) — a manual entry set to
//     repeat every N days, weeks or months, each copy posted on its date.
// Automatic reversals used to feed it too; they were taken off the journal
// form on 2 Nov 2026 — a reversal is now made by hand, through a preview.
//
// The asset register already knows, period by period, what each asset charges
// (buildSchedule) and to which accounts (journalLines). This turns that into
// the entries the ledger needs, one per month and kind, the way the books
// already record it ("Monthly depreciation — Apr 2025"):
//   • Monthly depreciation — fixed assets: Dr expense / Cr accumulated
//   • Monthly amortisation — prepaids and intangibles: Dr expense / Cr the
//     prepaid (or accumulated amortisation, for an intangible)
// Lines are summed by account, and each entry keeps the per-asset breakdown it
// was built from so the detail can show where every rupiah came from.
//
// Which months: the open ones (after the closed period) that the ledger does
// not already carry, up to the month after today — the current period and the
// next, never a year of future drafts. The same horizon caps recurring copies.
// A month whose date has passed and is still unposted is DUE: it posts itself
// on its date, with no approval and recorded as posted by the system
// (state/ScheduledAutoPost.jsx). Someone with posting rights
// can still post a future one early.
//
// These are derived, not stored. They are read-only — change the asset, and
// the scheduled entry changes with it. Posting one writes a real, numbered
// entry carrying the same schedule_key, which is how a posted month drops off.

import { buildSchedule, journalLines, nextPeriod } from "./fixedAssets";
import { withEvent, isClosedDate } from "./journalLifecycle";
import { fromRecurring } from "./recurringJournals";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (ym) => `${MONTHS[parseInt(ym.slice(5, 7), 10) - 1]} ${ym.slice(0, 4)}`;
const lastDayOf = (ym) => {
  const [y, m] = ym.split("-").map((n) => parseInt(n, 10));
  return `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
};
const isoOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const KINDS = {
  depreciation: { memo: "Monthly depreciation", code: "DEP", types: ["fixed_asset"] },
  amortisation: { memo: "Monthly amortisation", code: "AMR", types: ["prepaid", "intangible"] },
};

export const scheduleKey = (kind, period) => `${kind}|${period}`;

// The month a posted entry already covers, so it is not scheduled twice:
// either one posted from a schedule (schedule_key), or a hand-made monthly
// entry with the same memo.
function postedPeriods(entries, kind) {
  const out = new Set();
  const memo = KINDS[kind].memo;
  for (const je of entries) {
    if (je.status !== "posted" && je.status !== "pending" && je.status !== "draft") continue;
    if (je.schedule_key?.startsWith(`${kind}|`)) { out.add(je.schedule_key.split("|")[1]); continue; }
    const m = new RegExp(`^${memo} — (\\w{3}) (\\d{4})$`).exec(je.memo || "");
    if (m) out.add(`${m[2]}-${String(MONTHS.indexOf(m[1]) + 1).padStart(2, "0")}`);
  }
  return out;
}

// Every key a stored entry already covers, so nothing is scheduled twice.
const takenKeys = (entries) => new Set(entries.filter((je) => je.schedule_key && je.status !== "void").map((je) => je.schedule_key));

export function scheduledEntries(assets, { entries = [], closedThrough, today }) {
  const todayIso = isoOf(today);
  const current = todayIso.slice(0, 7);
  const horizon = nextPeriod(current);
  const firstOpen = closedThrough ? nextPeriod(closedThrough) : current;
  const taken = takenKeys(entries);

  const out = [
    ...fromRecurring(entries, { taken, firstOpen, horizon, todayIso }),
  ];
  for (const [kind, cfg] of Object.entries(KINDS)) {
    const done = postedPeriods(entries, kind);
    const inScope = assets.filter((a) => cfg.types.includes(a.type));
    // period → { lines by account, sources }
    const byPeriod = new Map();
    for (const asset of inScope) {
      const rows = buildSchedule(asset, { closedThrough });
      for (const row of rows) {
        if (row.period < firstOpen || row.period > horizon || done.has(row.period)) continue;
        if (row.held || !row.charge) continue;
        const lines = journalLines(asset, { ...row, valueAdjustment: 0 });
        if (!byPeriod.has(row.period)) byPeriod.set(row.period, { acc: new Map(), sources: [], unmapped: [] });
        const bucket = byPeriod.get(row.period);
        for (const l of lines) {
          if (!l.debit?.code || !l.credit?.code) { bucket.unmapped.push(asset.asset_tag); continue; }
          for (const [side, acct] of [["debit", l.debit], ["credit", l.credit]]) {
            const key = `${side}|${acct.code}`;
            const cur = bucket.acc.get(key) || { account_code: acct.code, account_name: acct.name, debit: 0, credit: 0, assets: 0 };
            cur[side] += l.amount;
            cur.assets += 1;
            bucket.acc.set(key, cur);
          }
          bucket.sources.push({ id: asset.id, tag: asset.asset_tag, name: asset.name, amount: l.amount });
        }
      }
    }
    for (const [period, bucket] of [...byPeriod.entries()].sort()) {
      if (!bucket.acc.size) continue;
      const date = lastDayOf(period);
      // Debits first, the way the books write them.
      const lines = [...bucket.acc.values()]
        .sort((a, b) => (b.debit > 0) - (a.debit > 0) || a.account_code.localeCompare(b.account_code))
        .map((l) => ({
          account_code: l.account_code, account_name: l.account_name,
          debit: Math.round(l.debit), credit: Math.round(l.credit),
          description: `${l.assets} asset${l.assets === 1 ? "" : "s"}`,
        }));
      out.push({
        je_number: `SCH-${period.replace("-", "")}-${cfg.code}`,
        je_date: date,
        status: "scheduled",
        memo: `${cfg.memo} — ${monthLabel(period)}`,
        reference_type: "schedule",
        reference_id: null,
        schedule_key: scheduleKey(kind, period),
        schedule: {
          kind, period, periodLabel: monthLabel(period), postsOn: date,
          due: date <= todayIso,
          source: "Fixed asset register",
          sources: bucket.sources.sort((a, b) => b.amount - a.amount),
          unmapped: [...new Set(bucket.unmapped)],
        },
        created_by: "Klay schedule", created_date: todayIso,
        posted_by: null, posted_date: null,
        lines,
      });
    }
  }
  return out;
}

// Who posts what nobody clicked Post on — the PRD's SYSTEM_UUID, shown by name.
export const SYSTEM_ACTOR = "System";

// The real, numbered entry a scheduled one becomes when it posts — dated on
// its schedule date and carrying its schedule_key, which takes the scheduled
// row off the list. A recurring copy keeps its link to the entry it repeats
// (recurring_of) and is credited to whoever set the repeat up. `system` marks
// one that posted itself.
export function postedFromSchedule(je, { jeNumber, by, today, system = false }) {
  const kind = je.schedule?.kind;
  return withEvent({
    je_number: jeNumber,
    je_date: je.je_date,
    status: "posted",
    memo: je.memo,
    reference_type: kind === "recurring" ? kind : "schedule",
    reference_id: je.reference_id,
    schedule_key: je.schedule_key,
    ...(je.recurring_of ? { recurring_of: je.recurring_of } : {}),
    created_by: kind === "recurring" ? je.created_by : "Klay schedule",
    created_date: today,
    posted_by: by,
    posted_date: today,
    ...(system ? { system_posted: true } : {}),
    lines: je.lines.map(({ account_code, account_name, debit, credit, description, dimensions, payee }) => ({
      account_code, account_name, debit, credit, description,
      ...(dimensions ? { dimensions } : {}),
      ...(payee ? { payee } : {}),
    })),
  }, system ? "posted automatically on its date" : "posted from schedule", by, je.schedule?.source);
}

// Scheduled entries whose date has come, in an open period — they post
// themselves now. `today` is an ISO date.
export const dueForAutoPost = (rows, { today, closedThrough }) => rows
  .filter((r) => r.status === "scheduled" && r.je_date <= today && !isClosedDate(r.je_date, closedThrough))
  .sort((a, b) => a.je_date.localeCompare(b.je_date) || a.je_number.localeCompare(b.je_number));

// The i-th number after `base` (JE-2025-0412 + 2 → JE-2025-0414), for posting
// several entries before the list has re-numbered.
export function jeNumberAfter(base, i) {
  const m = /^(JE-\d{4}-)(\d+)$/.exec(base || "");
  return m ? `${m[1]}${String(parseInt(m[2], 10) + i).padStart(m[2].length, "0")}` : base;
}
