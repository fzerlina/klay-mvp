// Display labels for enum-style fields. Kept separate from seed data so the
// data files stay machine-readable and labels can be swapped for i18n.
export const CAT_LABELS = {
  inventory: 'Inventory',
  service: 'Service',
  expense: 'Expense',
  cooperative: 'Cooperative',
  individual: 'Individual',
};

// Withholding model (Vendor Master MVP — entity-type driven).
//   Company  → chooses one of: PPh 23 · PPh 0.5% Final · PPh 4(2). The RATE is
//              resolved from whether the vendor has an NPWP (higher if not).
//   Individual → PPh 21 only; the rate is chosen at Create Bill time.
// A vendor still may have no withholding (goods purchases): key "none".
export const WITHHOLDING = {
  none:        { label: 'No withholding', scope: 'both' },
  pph23:       { label: 'PPh 23',         scope: 'company', npwp: '2%',  nonNpwp: '4%'  },
  pph05_final: { label: 'PPh 0.5% Final', scope: 'company' },
  pph42:       { label: 'PPh 4(2)',       scope: 'company', npwp: '10%', nonNpwp: '20%' },
  pph21:       { label: 'PPh 21',         scope: 'individual' },
};

// Old auto-generated seed uses legacy PPh keys — normalize to the new model so
// existing vendors render correctly without regenerating the seed.
const PPH_LEGACY = { pph23_2: 'pph23', pph23_15: 'pph23', pph4_final: 'pph42', pph21: 'pph21', none: 'none' };
export function normalizePph(pph) {
  return WITHHOLDING[pph] ? pph : (PPH_LEGACY[pph] || 'none');
}

// Full withholding label with the NPWP-resolved rate, e.g. "PPh 23 — 2% (NPWP)".
export function withholdingLabel(pph, hasNpwp) {
  const key = normalizePph(pph);
  const w = WITHHOLDING[key];
  if (key === 'pph23' || key === 'pph42') {
    return `${w.label} — ${hasNpwp ? w.npwp : w.nonNpwp} (${hasNpwp ? 'NPWP' : 'non-NPWP'})`;
  }
  if (key === 'pph21') return 'PPh 21 — rate set per bill';
  return w.label;
}

// Back-compat: full labels keyed by the legacy values still in seed.
export const PPH_LABELS = {
  none: 'No withholding',
  pph23_2: 'PPh 23 — 2% (NPWP)',
  pph23_15: 'PPh 23',
  pph4_final: 'PPh 4(2)',
  pph21: 'PPh 21 — rate set per bill',
  pph23: 'PPh 23',
  pph05_final: 'PPh 0.5% Final',
  pph42: 'PPh 4(2)',
};

// Vendor "default account" labels — should mirror leaf accounts in seed/coa.js.
// Kept here so the vendor dropdown stays a fixed shortlist; pages render
// arbitrary account labels via COA_BY_CODE lookup.
export const ACCT_LABELS = {
  '1-3100': '1-3100 · Raw Materials',
  '6-2300': '6-2300 · Office Rent',
  '6-2700': '6-2700 · Professional Services',
  '1-6300': '1-6300 · Office Equipment',
};

export const DEFTAX_LABELS = {
  ppn_masukan: 'Input VAT (PPN Masukan) 11%',
  bebas: 'VAT Exempt',
};
