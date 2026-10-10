// What each bank charges, as far as the reconciliation needs to know.
//
// The fee ceiling is the largest debit Klay will read as a bank charge on its
// own — a small amount the bank describes as a fee. Above it, a debit is
// treated as a payment and has to be matched. One flat Rp 15,000 (the Bank
// Reconciliation PRD's OQ-01) catches BI-FAST and SKN charges but misses the
// larger ones some banks print: RTGS, monthly giro administration. So each
// bank gets its own ceiling, set just above its largest routine charge.
//
// PLACEHOLDERS — the figures below are typical published corporate fees, not
// confirmed against each bank's current schedule. A bank account can also
// carry its own `feeCeiling`, which wins over the bank's.

export const DEFAULT_FEE_CEILING = 15000;

export const FEE_CEILING_BY_BANK = {
  BCA: 30000,
  MDR: 30000,
  BNI: 30000,
  CIMB: 30000,
  BRI: 25000,
  PERMATA: 25000,
};

export const feeCeilingFor = (account) =>
  account?.feeCeiling ?? FEE_CEILING_BY_BANK[account?.bank] ?? DEFAULT_FEE_CEILING;

// The final tax (PPh Final) a bank withholds on giro and deposit interest, and
// prints as its own debit after the interest credit.
export const INTEREST_TAX_RATE = 0.2;
