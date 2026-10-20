// Which dimensions and values posted journals already use — Settings →
// Dimensions locks those against rename and delete, since a posted line keeps
// the tag it was booked with.
//
// A line's tags are what the Journal Entry page shows for it: its own
// `dimensions` where it has them, otherwise the value simulated for entries
// that predate per-line tagging (sampleDimensionValue), on the dimensions its
// account carries (dimensionsForAccount).

import { COA_BY_CODE } from "../data/seed/coa";
import { dimensionsForAccount, sampleDimensionValue } from "../data/seed/dimensions";

// → { [dimKey]: { lines, values: { [value]: lines } } }
export function dimensionUsage(entries) {
  const usage = {};
  const bump = (k, v) => {
    const u = (usage[k] ||= { lines: 0, values: {} });
    u.lines += 1;
    if (v) u.values[v] = (u.values[v] || 0) + 1;
  };
  for (const je of entries) {
    if (je.status !== "posted") continue;
    for (const l of je.lines || []) {
      const keys = new Set([...dimensionsForAccount(COA_BY_CODE[l.account_code]), ...Object.keys(l.dimensions || {})]);
      for (const k of keys) {
        const v = l.dimensions?.[k] ?? sampleDimensionValue(k, `${je.je_number}|${l.account_code}|${k}`);
        if (v) bump(k, v);
      }
    }
  }
  return usage;
}
