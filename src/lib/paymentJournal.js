// The GL entry a recorded payment writes.
//
// Companion to billJournalPreview.js, which builds the entry for POSTING a
// bill. This one is the other half: what happens when the bill is paid off.
// Line shape is deliberately identical so both render through the same table.
//
// Derivation:
//   DR  Accounts Payable — Trade   total cleared    (the liability goes away)
//   CR  the source cash account    to_vendor        (money out of our bank)
//   CR  each deduction account     its amount       (the rest of the relief)
//
// It always balances by construction: the debit IS the sum of the credits,
// because a payment is defined as a split of the amount it clears. There is no
// arithmetic here that can disagree with the modal the user just filled in —
// the split is the entry.

import { COA } from "../data/seed/coa";
import { bankAccountById } from "../data/seed/bankAccounts";
import { WITHHOLDING_ACCOUNT, accountByCode, activeDeductions, breakdownTotal, cashOut } from "./paymentBreakdown";

const ACCT_AP_TRADE = { code: "2-1100", name: "Accounts Payable — Trade" };

// Fallbacks for a cash account with no GL mapping configured. Petty cash and a
// bank account land in different places, so the default follows the group
// rather than being one catch-all.
const FALLBACK_CASH = { petty: "1-1200", default: "1-1100" };

const inCoa = (code) => COA.some((a) => a.type !== "group" && a.code === code);

// Where a payment out of this account is credited, and how much we trust it.
//
// The bank-account master carries its own posting code (e.g. "1101-100 Cash -
// BCA Operating") which does NOT exist in the chart of accounts — the seeds use
// two different code systems. Rather than silently substitute an account
// nobody chose, the configured code is used and the line is flagged, so the
// mismatch shows up on screen instead of in a reconciliation three weeks later.
function creditAccountFor(account) {
  if (!account) {
    return { code: FALLBACK_CASH.default, name: "Cash on Hand", flag: "No source account recorded on this payment — defaulted to Cash on Hand." };
  }
  if (!account.glAccount) {
    const code = account.group === "petty" ? FALLBACK_CASH.petty : FALLBACK_CASH.default;
    return {
      code,
      name: accountByCode(code)?.name || code,
      flag: `${account.name} has no GL account mapped in Settings → Bank Accounts. Defaulted to ${code}.`,
    };
  }
  if (!inCoa(account.glAccount)) {
    return {
      code: account.glAccount,
      name: account.glAccountName || account.name,
      flag: `${account.glAccount} is configured on ${account.name} but is not in the chart of accounts.`,
    };
  }
  return { code: account.glAccount, name: account.glAccountName || accountByCode(account.glAccount)?.name || account.name, flag: null };
}

export function paymentJournalLines(breakdown, { vendorName } = {}) {
  if (!breakdown) return { lines: [], balanced: true, totalDr: 0, totalCr: 0 };

  const cleared = breakdownTotal(breakdown);
  const cash = cashOut(breakdown);
  const source = bankAccountById(breakdown.sourceAccountId);
  const lines = [];

  lines.push({
    side: "DR",
    account_code: ACCT_AP_TRADE.code,
    account_name: ACCT_AP_TRADE.name,
    amount: cleared,
    description: `Payable cleared${vendorName ? ` — ${vendorName}` : ""}`,
    rule: "AP control rule: a payment relieves the payable by everything it clears, cash and deductions alike",
    flag: null,
  });

  if (cash > 0) {
    const acct = creditAccountFor(source);
    // A giro relieves the payable today but does not move the bank balance
    // until it clears, so crediting cash now overstates what has left. A full
    // implementation parks it in a giro-payable account until clearing; the
    // chart has no such account yet, so the line says so rather than pretending.
    const giroFlag = breakdown.method === "giro"
      ? `Giro ${breakdown.giroNumber || ""} has not cleared — the bank balance does not move until it does.`.replace("  ", " ")
      : null;
    lines.push({
      side: "CR",
      account_code: acct.code,
      account_name: acct.name,
      amount: cash,
      description: source ? `Paid from ${source.name}` : "Paid from cash",
      rule: "Cash rule: the to-vendor component is the only part that leaves a cash account",
      // Both can be true at once — an unmapped account AND an uncleared giro —
      // and dropping either one hides a reason this line might be wrong.
      flag: [acct.flag, giroFlag].filter(Boolean).join(" ") || null,
    });
  }

  for (const d of activeDeductions(breakdown)) {
    const a = accountByCode(d.account);
    lines.push({
      side: "CR",
      account_code: d.account,
      account_name: a?.name || d.account,
      amount: d.amount,
      // The account column already names the account, so the description only
      // earns its place where it adds something: withholding is the one
      // deduction that creates an obligation to a third party rather than just
      // reducing what the vendor gets.
      description: d.account === WITHHOLDING_ACCOUNT
        ? "Withheld — owed to the tax office"
        : "Deducted from the vendor's share",
      rule: a
        ? `Booked to ${a.code} as chosen on the payment (${a.fs === "BS" ? "balance sheet" : "profit & loss"})`
        : "Account chosen on the payment is not in the chart of accounts",
      flag: a ? null : `${d.account} is not in the chart of accounts.`,
    });
  }

  const totalDr = lines.filter((l) => l.side === "DR").reduce((s, l) => s + l.amount, 0);
  const totalCr = lines.filter((l) => l.side === "CR").reduce((s, l) => s + l.amount, 0);
  return { lines, totalDr, totalCr, balanced: Math.abs(totalDr - totalCr) <= 1 };
}
