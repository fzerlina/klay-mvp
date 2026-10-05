// Scheduled journal entries — drafted from a schedule, waiting for their date.
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
// next, never a year of future drafts. A month whose date has passed and is
// still unposted is DUE: it should have posted on its date.
//
// These are derived, not stored. They are read-only — change the asset, and
// the scheduled entry changes with it. Posting one writes a real, numbered
// entry carrying the same schedule_key, which is how a posted month drops off.

import { buildSchedule, journalLines, nextPeriod } from "./fixedAssets";

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

export function scheduledEntries(assets, { entries = [], closedThrough, today }) {
  const todayIso = isoOf(today);
  const current = todayIso.slice(0, 7);
  const horizon = nextPeriod(current);
  const firstOpen = closedThrough ? nextPeriod(closedThrough) : current;

  const out = [];
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
