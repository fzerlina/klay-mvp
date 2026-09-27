// Names a person has already confirmed on an earlier reconciliation.
//
// Keyed by the text exactly as the bank printed it (upper-cased, truncated),
// valued by the vendor or customer it turned out to be. This is the memory the
// engineering plan wants the LLM to build up: once somebody confirms that
// "PT SUMBER MAKMUR ABAD" means PT Sumber Makmur Abadi, the next statement
// matches on that without asking the model — deterministic, free, and
// auditable, because a person said so.
//
// Seeded as if carried over from March. Confirming a suggested match adds to it
// in a real build; in this prototype the confirmation is recorded on the
// exception and the table itself stays as seeded.

export const KNOWN_NAMES = {
  "PT PENYEDIA LAYANAN KONS": "PT Penyedia Layanan Konsultasi",
};
