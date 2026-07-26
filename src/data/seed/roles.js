// Roles, capability catalog, capability-level Segregation-of-Duties rules,
// record-scope types, and sample users.
//
// Sourced from the Role & Permission Engine PRD (V1, June 2026). Prototype data
// — no backend. The engine models CAPABILITIES: discrete verbs per module, held
// in ANY combination — NOT a cumulative ladder. An approver is not automatically
// a poster; a poster is not automatically an approver (PRD §4.1). A role is a
// named bundle of (module, capability) grants. The old ordinal PERMISSION_MATRIX
// is now DERIVED from capabilities as a back-compat shim (see legacyLevel) so the
// pages that still ask hasLevel()/level() keep working while capabilities are the
// source of truth.

// ── Modules ──────────────────────────────────────────────────────────────
// PRD module ENUM: gl · ap · ar · purchasing · inventory · bank · reports ·
// settings · migration. `migration` is KLAY-internal (IA migration tooling) —
// flagged so the customer-facing role UI can skip it.
export const MODULES = [
  { key: "gl", label: "General Ledger", desc: "Journals, ledger, trial balance" },
  { key: "ap", label: "Accounts Payable", desc: "Bills, payment vouchers, vendors" },
  { key: "ar", label: "Accounts Receivable", desc: "Invoices, cash receipts, customers" },
  { key: "purchasing", label: "Purchasing", desc: "Purchase orders & procurement" },
  { key: "inventory", label: "Inventory", desc: "Stock, goods receipts, adjustments" },
  { key: "bank", label: "Bank", desc: "Bank statements & reconciliation" },
  { key: "reports", label: "Reports", desc: "Financial reports & analytics" },
  { key: "settings", label: "Settings", desc: "System & user configuration" },
  { key: "migration", label: "Migration", desc: "Data onboarding", internal: true },
];

// ── Capability catalog (PRD §4.1) ──────────────────────────────────────────
// Transaction VERBS (per module, any combination) + named master-data /
// reconciliation / configuration capabilities. `full` is the settings/reports
// "everything" grant and, on a financial module, expands to every verb.
export const VERBS = ["view", "transact", "approve", "post", "full"];

export const CAPABILITIES = {
  // Verbs
  view: { label: "View", kind: "verb", desc: "Read only" },
  transact: { label: "Transact", kind: "verb", desc: "Create, edit own drafts, submit" },
  approve: { label: "Approve", kind: "verb", desc: "Approve items routed to the approval pool" },
  post: { label: "Post", kind: "verb", desc: "Commit to the ledger (final; correctable only by a compensating entry)" },
  full: { label: "Full", kind: "verb", desc: "All verbs in the module, including configuration" },
  // Master-data & reconciliation (first-class — the SoD matrix points at these)
  "vendor.create": { label: "Create vendors", kind: "named", home: "ap", desc: "Onboard vendor master records" },
  "customer.create": { label: "Create customers", kind: "named", home: "ar", desc: "Onboard customer master records" },
  "vendor.classify": { label: "Classify vendors", kind: "named", home: "ap", desc: "Set a vendor's relationship tier (strategic / standard / at-risk)" },
  // Payment lifecycle (AP Aging) — request → approve → execute, one per role
  "payment.request": { label: "Request payment", kind: "named", home: "ap", desc: "Request payment for a posted bill (AP Staff)" },
  "payment.approve": { label: "Approve payment", kind: "named", home: "ap", desc: "Approve a payment request (Finance Manager)" },
  "payment.execute": { label: "Execute payment", kind: "named", home: "ap", desc: "Execute the transfer off-system and mark the bill paid; upload the bank statement (Finance Staff)" },
  "bank.reconcile": { label: "Reconcile bank", kind: "named", home: "bank", noDefaultHome: true, desc: "Reconcile bank statements against the ledger. Never bundled into a seeded role — granted explicitly per entity (see NOTE below)." },
  // Named settings / configuration capabilities (split so each grants independently)
  "coa.manage": { label: "Manage Chart of Accounts", kind: "named", home: "settings", desc: "Edit the Chart of Accounts (high-sensitivity changes route through approval)" },
  "dimensions.manage": { label: "Manage dimensions", kind: "named", home: "settings", desc: "Edit dimensions (branch, cost center, project)" },
  "posting_rules.manage": { label: "Manage posting rules", kind: "named", home: "settings", desc: "Edit posting rules and vendor overrides" },
  "period.lock": { label: "Lock period", kind: "named", home: "settings", desc: "Declare an accounting period closed" },
  "period.reopen": { label: "Reopen period", kind: "named", home: "settings", desc: "Reopen a closed period (a control point — routes through approval)" },
  "users.manage": { label: "Manage users", kind: "named", home: "settings", desc: "Invite, deactivate, assign roles to users" },
  "roles.manage": { label: "Manage roles", kind: "named", home: "settings", desc: "Define and edit roles" },
  "scope.assign": { label: "Assign scope", kind: "named", home: "settings", desc: "Assign record scope to a user" },
  // Forbidden single-capability — never grantable to any role (PRD §8.2 #4)
  "user.edit_own_approval_limit": { label: "Edit own approval limit", kind: "forbidden", desc: "Structurally forbidden: raising your own ceiling defeats every amount-based control." },
};

// The named config capabilities that make up the Finance Manager's `settings`
// footprint vs. the Admin's — used by legacyLevel to map settings → a legacy level.
const ADMIN_SETTINGS_CAPS = ["users.manage", "roles.manage", "scope.assign"];

// ── Role capability grants (PRD §4.3, Table 602) ────────────────────────────
// roleKey → { moduleKey: [capability, …] }. Absent module = `none`.
export const ROLE_CAPS = {
  // Finance Manager — the anchor. Holds BOTH approve and post on gl/ap/ar (two
  // separate grants: in the approver pool AND can post). NOT vendor.create /
  // bank.reconcile (either would create a HARD self-conflict), NOT users/roles.
  finance_manager: {
    gl: ["approve", "post"],
    ap: ["approve", "post", "payment.approve", "vendor.classify"],
    ar: ["approve", "post"],
    purchasing: ["approve"],
    inventory: ["view"],
    reports: ["full"],
    settings: ["coa.manage", "dimensions.manage", "posting_rules.manage", "period.lock", "period.reopen"],
  },
  // AP Staff — highest-volume daily role. Enters & submits vendor bills; onboards
  // vendors. Cannot approve or pay, so vendor.create is safe here.
  ap_staff: {
    ap: ["transact", "vendor.create", "payment.request", "vendor.classify"],
    reports: ["view"],
  },
  // Admin — user & access administration; deliberately powerless over money.
  admin: {
    settings: ["users.manage", "roles.manage", "scope.assign"],
  },
  // View-Only (Pemantau) — read-only oversight (owner / auditor / investor).
  view_only: {
    gl: ["view"], ap: ["view"], ar: ["view"], purchasing: ["view"], inventory: ["view"],
    reports: ["full"],
  },
  // AR Staff — the AP Staff mirror on receivables.
  ar_staff: {
    ar: ["transact", "customer.create"],
    reports: ["view"],
  },
  // Purchasing Staff — raises purchase orders and requests.
  purchasing_staff: {
    purchasing: ["transact"],
    reports: ["view"],
  },
  // Warehouse Staff — goods receipt and stock operations.
  warehouse_staff: {
    inventory: ["transact"],
    reports: ["view"],
  },

  // ── Added per request (2026-07-11 MoM roles) — these DIVERGE from the PRD's
  // 7 seeded templates. They split the AP payment pipeline into distinct seats.
  // Accounting Manager — the recorder. Posts journals (GL approve+post) and
  // commits bills/invoices to the ledger (ap/ar post). NOT the payment approver
  // (that stays the Finance Manager's `approve`); no vendor.create / reconcile.
  accounting_manager: {
    gl: ["approve", "post"],
    ap: ["post", "vendor.classify"],
    ar: ["post"],
    reports: ["view"],
  },
  // Finance Staff — executes the actual bank transfer (off-system, not modelled)
  // and uploads the daily bank statement to reconcile. Holds bank.reconcile with
  // NO post/approve, so it raises no SoD conflict — the dedicated reconciler seat
  // the PRD describes (§4.1). Read-only on GL/AP so they can see what they pay.
  finance_staff: {
    gl: ["view"],
    ap: ["view", "payment.execute"],
    bank: ["bank.reconcile"],
    reports: ["view"],
  },
};

// ── Roles (7 seeded customer templates, PRD build order) ────────────────────
// is_system roles ship with Klay and cannot be deleted (custom roles arrive v2
// as clone-from-template). approval_limit is the max Rupiah a role may approve.
// control_role vs. operational drives the UI dot. name_id = Bahasa display label.
export const ROLES = [
  {
    key: "finance_manager",
    name: "Finance Manager",
    name_id: "Manajer Keuangan",
    description: "The senior control and the approver pool. Approves and posts across GL/AP/AR, holds accounting configuration (CoA, dimensions, posting rules, period lock/reopen). In a lean team this is often the owner's own seat. Deliberately NOT user administration, vendor creation, or bank reconciliation.",
    is_system: true,
    is_internal: false,
    approval_limit: 100000000,
    control_role: true,
  },
  {
    key: "accounting_manager",
    name: "Accounting Manager",
    name_id: "Manajer Akuntansi",
    description: "The recorder. Posts journals to the general ledger and commits approved bills/invoices to the ledger, and reviews non-tax posting exceptions. Distinct from the Finance Manager, who authorises payment. Added for the AP payment pipeline (diverges from the PRD's 7 templates).",
    is_system: true,
    is_internal: false,
    approval_limit: null,
    control_role: true,
  },
  {
    key: "ap_staff",
    name: "AP Staff",
    name_id: "Staff AP",
    description: "Enters vendor bills and submits them for approval, and onboards vendor master records. Cannot approve or pay — so holding vendor.create is safe. The highest-volume daily role.",
    is_system: true,
    is_internal: false,
    approval_limit: null,
    control_role: false,
  },
  {
    key: "finance_staff",
    name: "Finance Staff",
    name_id: "Staff Keuangan",
    description: "Executes the actual bank transfer (done off-system) and uploads the daily bank statement to reconcile against the ledger. Holds bank reconciliation but no posting or approval authority. Added for the AP payment pipeline (diverges from the PRD's 7 templates).",
    is_system: true,
    is_internal: false,
    approval_limit: null,
    control_role: false,
  },
  {
    key: "admin",
    name: "Admin",
    name_id: "Admin",
    description: "User and access administration — invites users, assigns roles and scope, toggles SoD enforcement. Deliberately powerless over money: no posting or approval on any financial module.",
    is_system: true,
    is_internal: false,
    approval_limit: null,
    control_role: true,
  },
  {
    key: "view_only",
    name: "View Only",
    name_id: "Pemantau",
    description: "Read-only oversight — owner, CFO/director, external auditor, investor. Sees the modules and full reports; writes nothing. The productized form of the owner-reviews-the-books control; can be given a sensitivity scope to hide payroll / owner's-draw accounts.",
    is_system: true,
    is_internal: false,
    approval_limit: null,
    control_role: false,
  },
  {
    key: "ar_staff",
    name: "AR Staff",
    name_id: "Staff AR",
    description: "The AP Staff mirror on the receivables side. Enters and submits customer invoices, and onboards customer master records.",
    is_system: true,
    is_internal: false,
    approval_limit: null,
    control_role: false,
  },
  {
    key: "purchasing_staff",
    name: "Purchasing Staff",
    name_id: "Staff Pengadaan",
    description: "Raises purchase orders and procurement requests. No access to financial records.",
    is_system: true,
    is_internal: false,
    approval_limit: null,
    control_role: false,
  },
  {
    key: "warehouse_staff",
    name: "Warehouse Staff",
    name_id: "Staff Gudang",
    description: "Goods receipt and stock operations (GRN, stock opname). No access to the finance modules.",
    is_system: true,
    is_internal: false,
    approval_limit: null,
    control_role: false,
  },
];

// NOTE — bank.reconcile HARD-conflicts with both gl.post and approving payments
// (SoD #2, #3). The PRD gives it no default role home; here the dedicated
// Finance Staff role carries it safely (it holds NO post/approve), which is the
// PRD's "separate reconciler seat" made into a template. It can still also be
// granted ad-hoc per user via user.extraCaps (e.g. a lean-team FM as a flagged
// self-review). See CAPABILITIES["bank.reconcile"].

// ── Record scope types (PRD §5.2) ──────────────────────────────────────────
// Scope rides on the assignment (user_entity_roles), never on the role. All
// optional, default NONE, and compose with AND.
export const SCOPE_TYPES = [
  { key: "NONE", label: "Unscoped", desc: "Sees everything within the entity (default)." },
  { key: "DIMENSION", label: "Dimension", desc: "Confine to a branch / cost center / project (row-level)." },
  { key: "OWNERSHIP", label: "Ownership", desc: "Confine to own records — submitted_by / created_by = user (row-level)." },
  { key: "SENSITIVITY", label: "Sensitivity", desc: "Hide a tagged set of accounts or report classes (column / account-level)." },
];

// ── Permission levels (legacy ordinal ladder — back-compat only) ─────────────
// Retained ONLY so hasLevel()/level() call sites and the LEVELS[x].label lookups
// keep working. The real model is capabilities above; legacyLevel() projects a
// module's capability set onto this ladder.
export const LEVELS = {
  none: { rank: 0, label: "None" },
  view: { rank: 1, label: "View" },
  transact: { rank: 2, label: "Transact" },
  approve: { rank: 3, label: "Approve" },
  post: { rank: 4, label: "Post" },
  "approve+post": { rank: 5, label: "Approve + Post" },
  full: { rank: 6, label: "Full" },
};

// Project a module's capability array onto a legacy ordinal level.
export function legacyLevel(caps = []) {
  const s = new Set(caps);
  if (s.has("full")) return "full";
  if (s.has("approve") && s.has("post")) return "approve+post";
  if (s.has("post")) return "post";
  if (s.has("approve")) return "approve";
  if (s.has("transact")) return "transact";
  if (s.has("view")) return "view";
  // Named-only modules (settings, bank): map admin-tier caps → full, else view.
  if (ADMIN_SETTINGS_CAPS.some((c) => s.has(c))) return "full";
  if (s.size) return "view";
  return "none";
}

// Legacy matrix, DERIVED from ROLE_CAPS. roleKey → { moduleKey: levelKey }.
export const PERMISSION_MATRIX = Object.fromEntries(
  Object.keys(ROLE_CAPS).map((rk) => [
    rk,
    Object.fromEntries(MODULES.map((m) => [m.key, legacyLevel(ROLE_CAPS[rk][m.key] || [])])),
  ]),
);

// ── Effective capability set (canonical ids) ────────────────────────────────
// Flattens a user's roles (+ any per-user extra capabilities) into a flat Set of
// canonical capability ids used for SoD checks and authorize():
//   • verbs        → "<module>.<verb>"   (e.g. "ap.approve", "gl.post")
//   • "full"       → expands to every verb on that module
//   • named caps   → the cap string as-is (e.g. "vendor.create", "bank.reconcile",
//                    "users.manage", "coa.manage")
export function effectiveCapabilities(roleKeys = [], extraCaps = []) {
  const set = new Set();
  const add = (module, cap) => {
    if (VERBS.includes(cap)) {
      if (cap === "full") for (const v of VERBS) set.add(`${module}.${v}`);
      else set.add(`${module}.${cap}`);
    } else {
      set.add(cap); // named caps are already canonical
    }
  };
  for (const rk of roleKeys) {
    const mods = ROLE_CAPS[rk] || {};
    for (const [m, caps] of Object.entries(mods)) for (const c of caps) add(m, c);
  }
  for (const c of extraCaps) set.add(c);
  return set;
}

// ── Segregation-of-Duties rules (capability-level, PRD §8.2 D6 — locked) ──────
// Defined over CAPABILITIES, not role pairs, so a self-built fraud combo in a
// future custom role is caught the moment it's defined. A rule fires when the
// user's effective set intersects group `a` AND group `b`. HARD = assignment
// refused; SOFT = allowed with a logged justification.
export const SOD_RULES = [
  {
    id: 1,
    type: "HARD",
    a: ["vendor.create"],
    b: ["ap.approve", "ap.post"],
    label: "Create vendor + pay vendor",
    reason: "One person onboarding a vendor and paying it is the classic fake-vendor fraud.",
  },
  {
    id: 2,
    type: "HARD",
    a: ["ap.approve"],
    b: ["bank.reconcile"],
    label: "Approve payment + reconcile bank",
    reason: "Approving a payment and reconciling the bank lets one person both move money and hide the movement.",
  },
  {
    id: 3,
    type: "HARD",
    a: ["gl.post"],
    b: ["bank.reconcile"],
    label: "Post to ledger + reconcile bank",
    reason: "Posting to the ledger and reconciling the bank is the textbook record-and-conceal combination.",
  },
  {
    id: 4,
    type: "HARD",
    a: ["user.edit_own_approval_limit"],
    b: null,
    label: "Edit own approval limit",
    reason: "No role may ever include the ability to raise its own approval ceiling; it defeats every amount-based control.",
  },
  {
    id: 5,
    type: "SOFT",
    a: ["users.manage", "roles.manage"],
    b: ["ap.approve", "gl.post"],
    label: "Access administration + financial approval",
    reason: "One person controlling who-has-access and financial approval concentrates power — allowed in a small shop, but logged with a justification.",
  },
];

const BLOCK_NO_APPROVER =
  "No approver is available for this module. Add a user with the Finance Manager role.";

function roleName(key) {
  const r = ROLES.find((x) => x.key === key);
  return r ? r.name : key;
}

// Evaluate SoD for a set of roles (+ optional per-user extra capabilities).
// Returns { level: 'none'|'soft'|'hard', message, conflicts:[rule] }. HARD wins.
export function evaluateSod(roleKeys, opts = {}) {
  const set = effectiveCapabilities(roleKeys || [], opts.extraCaps || []);
  const hits = SOD_RULES.filter((rule) => {
    const aHit = rule.a.some((c) => set.has(c));
    if (rule.b == null) return aHit; // single-capability forbidden rule
    return aHit && rule.b.some((c) => set.has(c));
  });

  const hard = hits.filter((h) => h.type === "HARD");
  if (hard.length) {
    return {
      level: "hard",
      message: `Segregation of duties conflict: ${hard.map((h) => h.label).join("; ")} cannot be held by one person.`,
      conflicts: hard,
    };
  }
  const soft = hits.filter((h) => h.type === "SOFT");
  if (soft.length) {
    return {
      level: "soft",
      message: `Segregation of duties warning: ${soft.map((h) => h.label).join("; ")} should be split across people. Provide a justification to proceed.`,
      conflicts: soft,
    };
  }
  return { level: "none", message: "", conflicts: [] };
}

// Backwards-friendly alias used by drawer flows.
export const checkSodConflict = evaluateSod;

export { BLOCK_NO_APPROVER, roleName };

// ── Sample users ───────────────────────────────────────────────────────────
// status: "Active" | "Invited" | "Inactive"
// Simulates an ~80-person company: 11 named "anchor" users (stable IDs U001–U011
// referenced elsewhere) plus a deterministic generator filling the roster to 80.
// Generation is deterministic (no randomness) so the list is identical on every
// render. A user may hold several roles (additive); the SoD guard checks the
// combination at assignment time.

const ANCHOR_USERS = [
  { id: "U001", name: "Andi Wijaya", email: "andi.wijaya@klay.id", roleKeys: ["admin"], status: "Active", approval_limit: null, lastActive: "2026-06-07", invitedOn: "2025-01-12" },
  { id: "U002", name: "Sari Dewanti", email: "sari.dewanti@klay.id", roleKeys: ["finance_manager"], status: "Active", approval_limit: 100000000, lastActive: "2026-06-06", invitedOn: "2025-01-12" },
  { id: "U003", name: "Budi Santoso", email: "budi.santoso@klay.id", roleKeys: ["ap_staff"], status: "Active", approval_limit: null, lastActive: "2026-06-07", invitedOn: "2025-02-03" },
  { id: "U004", name: "Rina Kartika", email: "rina.kartika@klay.id", roleKeys: ["ar_staff"], status: "Active", approval_limit: null, lastActive: "2026-06-05", invitedOn: "2025-02-03" },
  { id: "U005", name: "Dimas Prasetyo", email: "dimas.prasetyo@klay.id", roleKeys: ["purchasing_staff"], status: "Active", approval_limit: null, lastActive: "2026-06-04", invitedOn: "2025-03-18" },
  { id: "U006", name: "Maya Lestari", email: "maya.lestari@klay.id", roleKeys: ["warehouse_staff", "purchasing_staff"], status: "Active", approval_limit: null, lastActive: "2026-06-03", invitedOn: "2025-03-18" },
  { id: "U007", name: "Eko Nugroho", email: "eko.nugroho@klay.id", roleKeys: ["view_only"], status: "Active", approval_limit: null, lastActive: "2026-05-28", invitedOn: "2025-04-22" },
  { id: "U008", name: "Putri Handayani", email: "putri.handayani@klay.id", roleKeys: ["finance_staff"], status: "Active", approval_limit: null, lastActive: "2026-06-06", invitedOn: "2025-06-02" },
  { id: "U009", name: "Galih Ramadhan", email: "galih.ramadhan@klay.id", roleKeys: ["ar_staff"], status: "Inactive", approval_limit: null, lastActive: "2025-11-14", invitedOn: "2025-05-09" },
  { id: "U010", name: "Lutfi Hakim", email: "lutfi.hakim@klay.id", roleKeys: ["accounting_manager"], status: "Active", approval_limit: null, lastActive: "2026-06-06", invitedOn: "2025-05-09" },
  // Bookkeeper role was dropped in the V1 PRD (its GL posting folds into Finance
  // Manager). Hana is re-cast as AP Staff — she handles the AP close queue.
  { id: "U011", name: "Hana Wijoyo", email: "hana.wijoyo@klay.id", roleKeys: ["ap_staff"], status: "Active", approval_limit: null, lastActive: "2026-06-06", invitedOn: "2025-02-20" },
];

const FIRST_NAMES = [
  "Agus", "Dewi", "Fajar", "Indah", "Hadi", "Citra", "Bayu", "Ratna", "Yoga", "Sinta",
  "Rizki", "Ayu", "Teguh", "Wulan", "Iwan", "Nadia", "Surya", "Mira", "Doni", "Mega",
  "Hendra", "Fitri", "Arif", "Tari", "Reza", "Dian", "Bagus", "Vina", "Krisna", "Yuni",
  "Adit", "Rara", "Faisal", "Nita", "Gilang", "Sasha", "Bram", "Laras", "Yusuf", "Intan",
];

const SUR_NAMES = [
  "Saputra", "Anggraini", "Pratama", "Maharani", "Kusuma", "Permata", "Wibowo", "Utami", "Halim", "Setiawan",
  "Gunawan", "Puspita", "Hartono", "Rahmawati", "Suryadi", "Cahyani", "Firmansyah", "Oktaviani", "Nurdin", "Widodo",
  "Susanto", "Melati", "Hidayat", "Purnama", "Iskandar", "Damayanti", "Mahendra", "Safitri", "Aprilia", "Andriani",
  "Wardana", "Lestari", "Pranata", "Septiani", "Kurniawan", "Handoko", "Marpaung", "Sihombing", "Nasution", "Siregar",
];

// Primary role for each generated user (sums to 70 → 80 with anchors).
const ROLE_PLAN = [
  ["warehouse_staff", 22],
  ["ap_staff", 12],
  ["ar_staff", 12],
  ["purchasing_staff", 11],
  ["view_only", 10],
  ["finance_manager", 2],
  ["admin", 1],
];

function buildGeneratedUsers() {
  const primaries = [];
  for (const [key, n] of ROLE_PLAN) for (let i = 0; i < n; i++) primaries.push(key);

  return primaries.map((primary, idx) => {
    const seq = idx + 12; // continues after U011
    const first = FIRST_NAMES[idx % FIRST_NAMES.length];
    const sur = SUR_NAMES[(idx * 7) % SUR_NAMES.length];
    const name = `${first} ${sur}`;
    const email = `${first}.${sur}${seq}@klay.id`.toLowerCase();

    const roleKeys = [primary];
    let justification = null;
    // A few clean operational multi-role holders. Operational roles carry no
    // approval authority, so these combinations raise no SoD flag — they show
    // that AP+AR and Purchasing+Warehouse are freely combinable.
    if (primary === "warehouse_staff" && idx % 11 === 3) roleKeys.push("purchasing_staff");
    if (primary === "ap_staff" && idx % 9 === 4) roleKeys.push("ar_staff");
    // The single generated Admin also holds Finance Manager — the one SOFT pair
    // (SoD #5: access administration + financial approval). A SOFT combination
    // cannot be saved without a recorded justification, so this holder carries one.
    if (primary === "admin") {
      roleKeys.push("finance_manager");
      justification = "Owner-operator on a lean team holds both access administration and financial approval; every posting is reviewed during the monthly close.";
    }

    // Deterministic status spread: mostly Active, a few Invited / Inactive.
    let status = "Active";
    if (seq % 17 === 0) status = "Inactive";
    else if (seq % 13 === 0) status = "Invited";

    const approval_limit = roleKeys.includes("finance_manager") ? 100000000 : null;
    const lastActive = status === "Invited" ? null : `2026-${String(5 + (seq % 2)).padStart(2, "0")}-${String(1 + (seq % 27)).padStart(2, "0")}`;
    const invitedOn = status === "Invited"
      ? "2026-06-02"
      : `2025-${String(1 + (seq % 11)).padStart(2, "0")}-${String(1 + (seq % 26)).padStart(2, "0")}`;

    return { id: `U${String(seq).padStart(3, "0")}`, name, email, roleKeys, status, approval_limit, lastActive, invitedOn, justification };
  });
}

export const USERS = [...ANCHOR_USERS, ...buildGeneratedUsers()];
