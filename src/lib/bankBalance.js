// Bank against books for one account, as of the statement's last day — the
// proof a reconciliation ends on.
//
//   Bank    the statement's closing balance
//   Klay    the account's balance in the books on that day: the opening
//           balance (the last statement's close, which a reconciled month
//           agreed with), every cash journal on the account up to the day, and
//           the journals this page posted for its lines (bank charges and
//           interest, booked differences)
//
// The two differ by exactly the reconciling items, and the result says so:
//
//   bank − klay  =  bank lines not in Klay yet  −  Klay entries not on the
//                   statement yet
//
// A line is "not in Klay" while nothing in the books stands for it — no cash
// journal suggested for it or matched to it, its fee journal not posted. An
// entry is "not on the statement" for whatever part of it no line has claimed —
// a payment in transit, a receipt the bank has not credited yet.
//
// Klay's balance is read from the same cash journals reconciliation pairs, not
// from the GL report: the demo chart carries two codes for some bank accounts
// (1-1300 and 11110), and a GL figure would disagree with this page until
// those are one.

const isLater = (r) => r?.action === "later";

export function balancesOf({ statement, exceptions = [], records = [] }) {
  const asOf = statement.through;
  const inBooks = records.filter((r) => !asOf || r.date <= asOf);

  // How much of each record lines have claimed: matched, or suggested for an
  // open line. A match shared by several lines counts once.
  const used = {};
  const seen = new Set();
  let posted = 0;
  const notInKlay = { n: 0, amount: 0 };
  for (const e of exceptions) {
    const r = isLater(e.resolution) ? null : e.resolution;
    if (r) {
      const key = r.matchId || e.id;
      if (!seen.has(key)) {
        seen.add(key);
        if (r.recordAlloc) for (const [id, amt] of Object.entries(r.recordAlloc)) used[id] = (used[id] || 0) + amt;
        else for (const id of r.recordIds || []) used[id] = inBooks.find((x) => x.id === id)?.amount || 0;
        if (r.difference) posted += r.difference.amount;
      }
      if (r.action === "post-journal") posted += e.amount;
      continue;
    }
    const sid = !e.manual ? e.suggestion?.recordId : null;
    if (sid) { used[sid] = inBooks.find((x) => x.id === sid)?.amount || 0; continue; }
    notInKlay.n += 1;
    notInKlay.amount += e.amount;
  }

  const notOnBank = { n: 0, amount: 0 };
  for (const r of inBooks) {
    const rest = r.amount - (used[r.id] || 0);
    if (Math.abs(rest) < 1) continue;
    notOnBank.n += 1;
    notOnBank.amount += rest;
  }

  const klay = statement.openingBalance + inBooks.reduce((s, r) => s + r.amount, 0) + posted;
  const bank = statement.loaded ? statement.closingBalance : null;
  const diff = bank == null ? null : bank - klay;
  return { asOf, bank, klay, diff, notInKlay, notOnBank, explained: diff != null && diff === notInKlay.amount - notOnBank.amount };
}
