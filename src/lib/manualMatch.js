// Does a hand-picked set of cash journals account for a set of bank lines?
//
// The rule behind the To match split view, where any number of lines on either
// side can be ticked:
//
//   exact       the journals add up to the bank lines to the rupiah
//   left open   the bank holds LESS than the Klay items: what is missing stays
//               open on them — a payment still waiting for its second
//               transfer. Nothing is unexplained, only unfinished, so nothing
//               is booked
//   booked      any other gap, posted to a difference account the person chose
//               the moment the lines are matched.
//               When the bank holds MORE than the Klay items this is the only
//               way through: cash that arrived or left has to land somewhere
//
// Amounts are applied oldest first: each Klay item takes what it is owed until
// the bank amount runs out, and the last one carries what stays open.
//
// `left` is signed like the statement: what the bank lines hold that the
// records do not.

const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

// Spread `amount` (signed like the statement) across `items`, oldest first.
// Each share has the item's sign and never exceeds what the item holds.
export function allocate(amount, items) {
  let rest = Math.abs(amount);
  return [...items].sort(byDate).map((item) => {
    const share = Math.min(rest, Math.abs(item.amount));
    rest -= share;
    return { item, share: Math.sign(item.amount) * share, full: share === Math.abs(item.amount) };
  });
}

// `mode` is "open" (leave a shortfall open) or "book" (book it to `diffAcct`).
export function matchBalance(bankTotal, records, { diffAcct = "", mode = "open" } = {}) {
  const total = records.reduce((s, r) => s + r.amount, 0);
  const left = bankTotal - total;
  // A gap the records don't explain on their own.
  const gap = records.length > 0 && left !== 0;
  const short_ = Math.sign(bankTotal) === Math.sign(total) && Math.abs(bankTotal) < Math.abs(total);
  // The bank holds less than the Klay items, in the same direction.
  const short = gap && short_;
  const leaving = short && mode === "open";
  const booking = gap && !leaving && !!diffAcct;
  // Applied oldest first, what each item gets. An item the bank amount never
  // reaches would be matched to nothing — it has to be unticked.
  const alloc = records.length && bankTotal ? allocate(leaving ? bankTotal : total, records) : [];
  const idle = alloc.filter((a) => a.share === 0).map((a) => a.item);
  const openOn = leaving ? alloc.filter((a) => a.share !== 0 && !a.full).map((a) => a.item)[0] || null : null;
  const balanced = records.length > 0 && !idle.length && (left === 0 || leaving || booking);
  return { total, left, gap, short, leaving, booking, balanced, idle, openOn };
}

// Which way the cash moved, read off the sign — the one thing every line has,
// matched or not, and the same on both sides of the comparison. Deliberately
// not "payable / receivable" (a bank fee is money out but no payable; a vendor
// refund is money in but AP) and not "debit / credit" (the bank prints DB for
// money out, which is a credit to cash in the books).
export const DIRECTIONS = [
  { k: "all", lbl: "All" },
  { k: "in", lbl: "Money in" },
  { k: "out", lbl: "Money out" },
];
export const inDirection = (dir, amount) => dir === "all" || (dir === "out" ? amount < 0 : amount > 0);
