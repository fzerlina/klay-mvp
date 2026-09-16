// Fraud and tax checks that run at the moment of release.
//
// These are deliberately NOT the bill's review flags. Those ask "is this
// invoice real and correctly coded" before posting. These ask a different
// question, later, about a different object: "should this money leave, to this
// account, today". The two most expensive failures in Indonesian AP — an
// employee routing payments to their own account, and a hijacked vendor inbox
// sending a convincing "we changed banks" email — are invisible to a bill
// check and obvious to a payment check.
//
// Every detector is deterministic and names the record that made it fire, so
// the releaser can verify rather than trust. Nothing here is a model guess.
//
// Tiers match the Exception Engine's:
//   BLOCKING  the release is refused until the line is fixed or dropped
//   REVIEW    the releaser must acknowledge it before releasing
//   ADVISORY  context only, never blocks

import { BILLS } from "../data/seed/bills";
import { daysSince } from "./clock";

export const FLAG_TIERS = {
  blocking: { label: "Blocking", tone: "danger", rank: 0, desc: "Cannot be released until this is resolved or the bill is dropped from the batch." },
  review:   { label: "Review",   tone: "review", rank: 1, desc: "Can be released once you acknowledge it." },
  advisory: { label: "Advisory", tone: "muted",  rank: 2, desc: "Context only. Never blocks a release." },
};

export const FLAG_DEFS = {
  payee_unapproved:     { tier: "blocking", label: "Payee change not approved" },
  no_bank_details:      { tier: "blocking", label: "No bank account on file" },
  bank_changed:         { tier: "blocking", label: "Vendor bank account changed" },
  new_account:          { tier: "blocking", label: "New account on an established vendor" },
  possible_duplicate:   { tier: "blocking", label: "Possible duplicate payment" },
  withholding_mismatch: { tier: "blocking", label: "Withholding looks wrong" },
  request_returned:     { tier: "review",   label: "Payment request was sent back" },
  first_payment:        { tier: "review",   label: "First payment to this vendor" },
  missing_tax_invoice:  { tier: "review",   label: "No tax invoice recorded" },
  interco:              { tier: "advisory", label: "Group company" },
};

// How recent a bank-detail change still counts as suspicious. A redirection
// scam lands days before a payment, not months.
const BANK_CHANGE_WINDOW_DAYS = 30;

// Bank-detail history that predates this prototype's own change log. Real
// changes made in the app are picked up from the vendor's version history
// instead; this only seeds the demo so the check has something to fire on.
// (Same pattern as apAging's ON_HOLD_OVERRIDES.)
// `to` must match the account now on the vendor record, or the flag would
// describe a change the row itself contradicts.
export const SEEDED_BANK_EVENTS = {
  V037: { kind: "changed", at: "2025-04-19", by: "Budi Santoso", from: "BCA ···1180", to: "BNI ···6223", source: "Emailed letterhead from the vendor" },
  V019: { kind: "changed", at: "2025-04-11", by: "Budi Santoso", from: "Permata ···4412", to: "OCBC NISP ···7399", source: "WhatsApp from the vendor's contact" },
  V050: { kind: "added",   at: "2025-04-21", by: "Budi Santoso", to: "OCBC NISP ···1294", source: "Added while entering the bill" },
};

// Group companies. In production this is a flag on the vendor record; the
// payment detects it and books it as intercompany with no user action.
export const INTERCO_VENDORS = new Set(["V061", "V064"]);

// Vendors we have successfully paid before. A vendor's very first payment is
// the moment a fabricated supplier gets its money.
const PAID_BEFORE = (() => {
  const s = new Set();
  for (const b of BILLS) if (b.pay === "paid") s.add(b.vendor);
  return s;
})();

// Most recent approved version in which the payee account changed.
function lastBankChange(versions = []) {
  const hit = versions.find((v) => (v.changedFields || []).includes("banks"));
  return hit ? { at: hit.approvedAt, by: hit.approvedBy } : null;
}

// Builds a flagger bound to the payable universe, so the duplicate check can
// compare a line against its peers without rescanning every time.
export function makeFlagger({ lines = [], versionsOf = () => [], returnedOf = () => null } = {}) {
  const byVendor = new Map();
  for (const l of lines) {
    if (!byVendor.has(l.vendorId)) byVendor.set(l.vendorId, []);
    byVendor.get(l.vendorId).push(l);
  }

  return function flagsFor(line) {
    const v = line.vendorRaw || null;
    const out = [];
    const add = (key, detail) => out.push({ key, detail, ...FLAG_DEFS[key] });

    // ── Where the money is going ─────────────────────────────────────────
    const banks = v?.banks || [];
    if (banks.length === 0) {
      add("no_bank_details", "There is no bank account on this vendor, so the transfer has no destination. Add and approve one before paying.");
    }

    // A payee change bounces the vendor back to Pending approval. Paying
    // against an unapproved payee defeats the dual control on the vendor record.
    if (v && v.approval && v.approval !== "approved") {
      add("payee_unapproved", `${v.name} is sitting at "${String(v.approval).replace(/_/g, " ")}" — its payee details have not completed an approval cycle. Approve the vendor record first.`);
    }

    const seeded = SEEDED_BANK_EVENTS[line.vendorId];
    const live = lastBankChange(versionsOf(line.vendorId));
    const changedAt = live?.at && daysSince(live.at) <= BANK_CHANGE_WINDOW_DAYS ? live.at : null;

    if (seeded?.kind === "changed" && daysSince(seeded.at) <= BANK_CHANGE_WINDOW_DAYS) {
      add("bank_changed", `Changed ${daysSince(seeded.at)} days ago by ${seeded.by}: ${seeded.from} → ${seeded.to}. Source was "${seeded.source}". Confirm by phone on a number you already had, not one in the message.`);
    } else if (changedAt) {
      add("bank_changed", `The payee account changed ${daysSince(changedAt)} days ago${live.by ? `, approved by ${live.by}` : ""}. Confirm with the vendor before releasing.`);
    }

    if (seeded?.kind === "added" && daysSince(seeded.at) <= BANK_CHANGE_WINDOW_DAYS) {
      add("new_account", `${seeded.to} was added ${daysSince(seeded.at)} days ago by ${seeded.by} on a vendor we have paid before. Source was "${seeded.source}".`);
    }

    // ── Paying twice ─────────────────────────────────────────────────────
    const twin = (byVendor.get(line.vendorId) || []).find((o) =>
      o.id !== line.id &&
      o.total === line.total &&
      Math.abs(daysSince(o.invoiceDate) - daysSince(line.invoiceDate)) <= 45);
    if (twin) {
      add("possible_duplicate", `Same vendor and the same amount as ${twin.invNo}, dated ${twin.invoiceDate}. Two real invoices, or the same one received twice?`);
    }

    // ── Tax at the moment of payment ─────────────────────────────────────
    const expectsPph = typeof v?.pph === "string" && v.pph.startsWith("pph23");
    if (expectsPph && !(line.pph23 > 0)) {
      add("withholding_mismatch", `${v.name} is set up for PPh 23, but this bill withholds nothing. Release it as-is and the vendor is overpaid and never gets a bukti potong.`);
    } else if (!expectsPph && line.pph23 > 0) {
      add("withholding_mismatch", "PPh is being withheld from a vendor whose master record says no withholding applies. One of the two is wrong.");
    }

    if (v?.pkp === "PKP" && line.raw && line.raw.dpp === line.raw.total) {
      add("missing_tax_invoice", `${v.name} is PKP, but this bill records no PPN — the faktur pajak is probably missing. No tax paperwork, no payment.`);
    }

    // ── The request itself ───────────────────────────────────────────────
    // A returned request is an exception, not a status the bill parks in: the
    // bill is back at "not yet requested" and this says why. Re-requesting it
    // clears the flag, because re-requesting IS the answer to a return.
    const returned = returnedOf(line.id);
    if (returned) {
      add("request_returned", `${returned.by} sent this back on ${returned.at}: "${returned.reason}". Fix it and request payment again.`);
    }

    // ── Who we are paying ────────────────────────────────────────────────
    if (!PAID_BEFORE.has(line.vendorId)) {
      add("first_payment", "We have never paid this vendor before. Check the account name matches the vendor you think you are paying.");
    }

    if (INTERCO_VENDORS.has(line.vendorId)) {
      add("interco", "Recognised as a group company from the vendor record. It will be booked to intercompany and left out of group spend — nothing for you to do.");
    }

    return out.sort((a, b) => FLAG_TIERS[a.tier].rank - FLAG_TIERS[b.tier].rank);
  };
}

export function tierCounts(flags = []) {
  const c = { blocking: 0, review: 0, advisory: 0 };
  for (const f of flags) c[f.tier] += 1;
  return c;
}

// A line can be released when nothing blocks it and every review flag has been
// acknowledged. Advisory flags are ignored entirely.
export function releaseState(flags = [], acks = {}) {
  const blocking = flags.filter((f) => f.tier === "blocking");
  const review = flags.filter((f) => f.tier === "review");
  const unacked = review.filter((f) => !acks[f.key]);
  return {
    blocking,
    review,
    unacked,
    blocked: blocking.length > 0,
    needsAck: blocking.length === 0 && unacked.length > 0,
    clear: blocking.length === 0 && unacked.length === 0,
  };
}
