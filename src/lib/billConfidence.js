// Per-field confidence model — implements the PRD's GREEN / YELLOW / BLUE /
// RED visual states keyed to system_config thresholds. Phase C computes
// confidence at render-time from bill.isAI + bill.anomalies + vendor master
// lookups (no seed changes). Phase J makes fields editable so user
// corrections feed back into draft_accuracy_log.

// Thresholds — named so IA/TradeOS can tune without code deployment in
// production (per PRD "Confidence Thresholds" subsection). Surfaced as
// constants here; in production they'd come from a system_config table.
export const CONFIDENCE_THRESHOLD_GREEN = 0.85;
export const CONFIDENCE_THRESHOLD_YELLOW_MIN = 0.60;

// Field labels — internal field name → human label. Used in the review brief
// callout and field-row tooltips.
export const FIELD_LABELS = {
  vendor:       "Vendor",
  invNo:        "Invoice No.",
  poNo:         "PO No.",
  date:         "Invoice Date",
  due:          "Due Date",
  dpp:          "DPP",
  pph23:        "PPh 23",
  total:        "Total",
  net_payable:  "Net Payable",
  items_qty:    "Line quantities",
};

// Source → human label for tooltips.
const SOURCE_LABEL = {
  VENDOR_MASTER: "Vendor master",
  OCR:           "OCR extraction",
  RULE_ENGINE:   "Rule engine",
  MANUAL:        "Manual entry",
};

// Anomaly description → which fields it flags. Demo-only heuristic; in
// production the rules engine emits structured field references with the
// anomaly. Order matters: the first matching rule wins per anomaly.
function anomalyToFields(anomaly) {
  const t = (anomaly.description || "").toLowerCase();
  if (t.includes("po total") && t.includes("invoice total")) return ["total", "poNo"];
  if (t.includes("higher than this vendor"))                  return ["total"];
  if (t.includes("× higher") || t.includes("x higher"))       return ["total"];
  if (t.includes("exceeds approval threshold"))               return ["total"];
  if (t.includes("ocr readings") || t.includes("ocr confidence") || t.includes("low ocr")) return ["dpp", "total", "poNo"];
  if (t.includes("sunday") || t.includes("weekend"))          return ["date"];
  if (t.includes("grn mismatch") || t.includes("units received")) return ["items_qty"];
  if (t.includes("possible duplicate"))                       return []; // bill-level banner (Phase I)
  if (t.includes("first invoice"))                            return ["vendor"]; // informational
  return [];
}

function sevWeight(s) {
  if (s === "high")   return 3;
  if (s === "medium") return 2;
  if (s === "low")    return 1;
  return 0;
}

// Group anomalies by which field(s) they hit. Returns { fieldName: [anomaly...] }.
// Anomalies in `resolvedIdxs` (a Set of indexes into bill.anomalies) are
// skipped — the FM marked them addressed via Edit or Confirm, so they no
// longer drive the visual_state.
function bucketAnomalies(anomalies, resolvedIdxs) {
  const buckets = {};
  (anomalies || []).forEach((a, idx) => {
    if (resolvedIdxs && resolvedIdxs.has(idx)) return;
    for (const f of anomalyToFields(a)) {
      (buckets[f] = buckets[f] || []).push(a);
    }
  });
  return buckets;
}

// Public helper: which anomaly indexes (positions in bill.anomalies) hit the
// named field? Used by the page to mark anomalies resolved when the FM edits
// or confirms a flagged field. Editing a field clears every anomaly that
// pointed at it — by definition the FM has now addressed those signals.
export function anomalyIndexesForField(bill, fieldName) {
  const out = [];
  (bill.anomalies || []).forEach((a, i) => {
    if (anomalyToFields(a).includes(fieldName)) out.push(i);
  });
  return out;
}

// Synthesize a one-line rule explanation for RULE_ENGINE-sourced fields.
// In production these come from the rules engine's emitted reasoning.
// PRD: "PPh 23 at 2% withheld: service invoice, domestic vendor"
export function ruleExplanation(fieldName, vendor) {
  if (fieldName === "pph23") {
    if (vendor?.pph === "pph23_2") {
      return `PPh 23 at 2% withheld: ${vendor.category === "service" ? "service" : "service/sewa"} invoice, domestic vendor`;
    }
    if (vendor?.pph === "pph23_15") {
      return "PPh 23 at 15% withheld: dividen / bunga vendor";
    }
    if (vendor?.pph === "pph4_final") {
      return "PPh 4(2) Final at 2% withheld: konstruksi vendor";
    }
    return "No PPh withholding (vendor category does not require it)";
  }
  if (fieldName === "due") {
    return vendor?.payment_terms
      ? `Due date = invoice date + ${vendor.payment_terms} (from vendor master)`
      : "Computed from invoice date + payment terms";
  }
  if (fieldName === "net_payable") {
    return "Net payable = Total − PPh withheld (amount transferred to vendor)";
  }
  return "Applied from rule engine";
}

// Vendor-master explanation, including NPWP when present.
function vendorMasterExplanation(vendor) {
  if (!vendor) return "Pulled from vendor master";
  const npwp = vendor.tax_id ? ` (NPWP ${vendor.tax_id})` : "";
  return `Pulled from vendor master · ${vendor.name}${npwp}`;
}

// Build a single field's confidence record. Anomalies always override the
// default state — a manually-entered field that the rules engine later
// flagged with "21% higher than average" still surfaces YELLOW, regardless
// of source. Anomaly severity drives visual_state and synthetic score.
function buildField(fieldName, source, hits, vendor) {
  let visual_state;
  let score = null;
  let explanation;

  if (hits.length > 0) {
    const maxSev = hits.reduce((m, a) => Math.max(m, sevWeight(a.severity)), 0);
    if      (maxSev >= 3) { visual_state = "RED";    score = source === "OCR" ? 0.52 : null; }
    else if (maxSev >= 2) { visual_state = "YELLOW"; score = source === "OCR" ? 0.68 : null; }
    else                  { visual_state = source === "OCR" ? "GREEN" : "BLUE"; score = source === "OCR" ? 0.82 : null; }
    explanation = hits.map((a) => a.description).join(" · ");
  } else if (source === "VENDOR_MASTER") {
    visual_state = "BLUE";
    explanation  = vendorMasterExplanation(vendor);
  } else if (source === "RULE_ENGINE") {
    visual_state = "BLUE";
    explanation  = ruleExplanation(fieldName, vendor);
  } else if (source === "OCR") {
    visual_state = "GREEN";
    score        = 0.92;
    explanation  = "Extracted from the invoice — value reads clearly";
  } else {
    // MANUAL with no anomaly → quiet, no indicator chrome.
    visual_state = null;
    explanation  = "Entered manually";
  }

  return {
    field_name: fieldName,
    source,
    source_label: SOURCE_LABEL[source] || source,
    score,
    visual_state,
    explanation,
  };
}

// Per-bill confidence map. Skips fields that don't carry an indicator
// (Bill ID, GRN, Payment Status — those are system state, not extracted
// values). Anomalies the FM has marked resolved are excluded so the field
// flips back to GREEN/BLUE once addressed.
export function computeFieldConfidence(bill, vendor) {
  const resolved = new Set(bill.anomalies_resolved || []);
  const hits = bucketAnomalies(bill.anomalies, resolved);
  const isAI = !!bill.isAI;
  const fields = {};

  // Vendor → always vendor master
  fields.vendor = buildField("vendor", "VENDOR_MASTER", hits.vendor || [], vendor);

  // Header identifiers: OCR if AI, MANUAL otherwise (anomalies still flag MANUAL)
  fields.invNo = buildField("invNo", isAI ? "OCR" : "MANUAL", hits.invNo || [], vendor);
  fields.poNo  = buildField("poNo",  isAI ? "OCR" : "MANUAL", hits.poNo  || [], vendor);
  fields.date  = buildField("date",  isAI ? "OCR" : "MANUAL", hits.date  || [], vendor);

  // Due date → rule (derived from invoice_date + payment_terms)
  fields.due = buildField("due", "RULE_ENGINE", hits.due || [], vendor);

  // DPP → OCR (extracted) or MANUAL
  fields.dpp = buildField("dpp", isAI ? "OCR" : "MANUAL", hits.dpp || [], vendor);

  // PPh 23 → RULE (from vendor.pph)
  fields.pph23 = buildField("pph23", "RULE_ENGINE", hits.pph23 || [], vendor);

  // Total → OCR (extracted; cross-checked against DPP − PPh) or MANUAL
  fields.total = buildField("total", isAI ? "OCR" : "MANUAL", hits.total || [], vendor);

  // Line-item quantity flag (bill-level signal — Phase J surfaces per-line)
  if (hits.items_qty) {
    fields.items_qty = buildField("items_qty", "OCR", hits.items_qty, vendor);
  }

  // Net payable — derived rule (Total − PPh withheld)
  fields.net_payable = {
    field_name:   "net_payable",
    source:       "RULE_ENGINE",
    source_label: SOURCE_LABEL.RULE_ENGINE,
    score:        null,
    visual_state: "BLUE",
    explanation:  ruleExplanation("net_payable", vendor),
  };

  // Manual overrides — once the FM edits a field, its source reads "manual"
  // (the hover tooltip updates accordingly), unless it still carries an active
  // YELLOW/RED flag. `manual_fields` is recorded by Bill Detail's editField.
  const manualSet = new Set(bill.manual_fields || []);
  if (manualSet.size > 0) {
    for (const f of Object.values(fields)) {
      const edited = manualSet.has(f.field_name);
      if (edited && f.visual_state !== "YELLOW" && f.visual_state !== "RED") {
        f.source       = "MANUAL";
        f.source_label = SOURCE_LABEL.MANUAL;
        f.score        = null;
        f.visual_state = null;
        f.explanation  = "Entered manually by you";
      }
    }
  }

  return fields;
}

// Review brief — the top-of-page sentence summarizing what needs attention.
// PRD format: "[N] field(s) need your attention: [field name] ([reason]), …"
// If N = 0: "Everything looks good — ready to post."
// Hidden once the bill is approved/posted — post-posting the brief is noise.
export function computeReviewBrief(bill, fields) {
  const isPostApproval = bill.approval === "approved";
  if (isPostApproval) return null;

  const attention = Object.values(fields).filter(
    (f) => f.visual_state === "YELLOW" || f.visual_state === "RED",
  );

  if (attention.length === 0) {
    return {
      count: 0,
      tone: "ok",
      message: "Everything looks good — ready to post.",
      fields: [],
    };
  }

  // Sort RED first, then YELLOW; within each, preserve declaration order.
  const sorted = attention.slice().sort((a, b) => {
    const w = (s) => (s === "RED" ? 0 : 1);
    return w(a.visual_state) - w(b.visual_state);
  });

  return {
    count: attention.length,
    tone: attention.some((f) => f.visual_state === "RED") ? "danger" : "warn",
    message: `${attention.length} field${attention.length === 1 ? "" : "s"} need your attention`,
    fields: sorted.map((f) => ({
      field: f.field_name,
      label: FIELD_LABELS[f.field_name] || f.field_name,
      reason: shortenReason(f.explanation),
      visual_state: f.visual_state,
    })),
  };
}

// Trim explanation text to a phrase suitable for inline display in the brief.
function shortenReason(text) {
  if (!text) return "";
  const firstClause = text.split(" · ")[0];
  const parenless = firstClause.replace(/\s*\(.*?\)\s*$/, "");
  return parenless.length > 70 ? parenless.slice(0, 67) + "…" : parenless;
}

// Convenience: does the bill have any unresolved flagged fields? Used by the
// Post button to gate workflow-progressing actions. Per PRD: "Post is active
// when all RED filled and all YELLOW confirmed/corrected." Phase C doesn't
// yet make fields editable, so any YELLOW/RED counts as unresolved — the
// disabled state is itself the demo signal ("the system caught issues").
export function hasUnresolvedAttention(fields) {
  return Object.values(fields).some(
    (f) => f.visual_state === "YELLOW" || f.visual_state === "RED",
  );
}

// Human-readable headline for a field's confidence — surfaces in the tooltip
// without leaking internal vocabulary (BLUE/GREEN/etc.) or system labels
// (OCR/RULE_ENGINE/etc.). The color of the row's indicator dot already
// conveys the state visually; this phrase explains it in everyday words so
// the FM knows immediately what the field is asking of them.
export function summarizeConfidence(field) {
  if (!field) return "";
  const vs = field.visual_state;
  const source = field.source;
  if (vs === "BLUE") {
    if (source === "VENDOR_MASTER") return "From the vendor master";
    if (source === "RULE_ENGINE")   return "Automatically computed";
    return "Settled — no review needed";
  }
  if (vs === "GREEN")  return "Read clearly from the invoice";
  if (vs === "YELLOW") return "Worth reviewing before posting";
  if (vs === "RED")    return "Needs your attention before posting";
  return "Entered manually";
}
