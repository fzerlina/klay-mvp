// Roles, capability catalog, capability-level Segregation-of-Duties rules,
// record-scope types, and sample users.
//
// The capability catalog and the role grants follow the backend's role
// catalog (Oct 2026): every capability id is canonical "<module>.<capability>"
// (ap.vendor.create, settings.coa.manage, gl.je.reverse…), and each role holds
// exactly the backend's list — plus the GAP FILLS marked below: capabilities
// the prototype gates screens on that no backend role holds yet, given to the
// closest role so every screen still has someone who can use it. Prototype
// data — no backend.
//
// Capabilities are discrete grants held in ANY combination — NOT a cumulative
// ladder. An approver is not automatically a poster; a poster is not
// automatically an approver. A role is a named bundle of (module, capability)
// grants. The old ordinal PERMISSION_MATRIX is DERIVED from capabilities as a
// back-compat shim (see legacyLevel) so pages that still ask hasLevel()/level()
// keep working.

// ── Modules ──────────────────────────────────────────────────────────────
// `internal` modules are Klay's own (back office) — the customer-facing role UI
// skips them.
export const MODULES = [
  { key: "gl", label: "General Ledger", desc: "Journals, ledger, trial balance" },
  { key: "ap", label: "Accounts Payable", desc: "Bills, payments, vendors" },
  { key: "ar", label: "Accounts Receivable", desc: "Invoices, cash receipts, customers" },
  { key: "purchasing", label: "Purchasing", desc: "Purchase orders & procurement" },
  { key: "inventory", label: "Inventory", desc: "Stock, goods receipts, adjustments" },
  { key: "bank", label: "Bank", desc: "Bank accounts, statements & reconciliation" },
  { key: "masterdata", label: "Master data", desc: "Counterparties, products, warehouses, fixed assets, opening stock" },
  { key: "reports", label: "Reports", desc: "Financial reports & analytics" },
  { key: "settings", label: "Settings", desc: "Company, users, roles and accounting configuration" },
  { key: "migration", label: "Migration", desc: "Data onboarding — upload, mapping, UAT, sign-off" },
  { key: "other", label: "Other", desc: "Audit trail configuration and the user directory" },
  { key: "bo", label: "Back office", desc: "Klay's own entity and provisioning tools", internal: true },
];

// ── Capability catalog ─────────────────────────────────────────────────────
// Transaction VERBS (per module, any combination) + named capabilities. `full`
// is the reports "everything" grant and, on a financial module, expands to
// every verb.
export const VERBS = ["view", "transact", "approve", "post", "full"];

// Which verbs the role editor offers per module. Named capabilities attach to
// their `home` module below.
export const MODULE_VERBS = {
  gl: ["view", "transact", "approve", "post"],
  ap: ["view", "transact", "approve", "post"],
  ar: ["view", "transact", "approve", "post"],
  purchasing: ["view", "transact", "approve"],
  inventory: ["view", "transact"],
  bank: ["view"],
  masterdata: [],
  reports: ["view", "full"],
  settings: [],
  migration: ["view"],
  other: [],
  bo: [],
};

const named = (home, label, desc, extra = {}) => ({ label, kind: "named", home, desc, ...extra });

export const CAPABILITIES = {
  // Verbs
  view: { label: "View", kind: "verb", desc: "Read only" },
  transact: { label: "Transact", kind: "verb", desc: "Create, edit own drafts, submit" },
  approve: { label: "Approve", kind: "verb", desc: "Approve items routed to the approval pool" },
  post: { label: "Post", kind: "verb", desc: "Commit to the ledger (final; correctable only by a compensating entry)" },
  full: { label: "Full", kind: "verb", desc: "All verbs in the module, including configuration" },

  // General Ledger
  "gl.je.reverse": named("gl", "Reverse journals", "Reverse a posted journal entry, and delete posted journals where Klay has turned deletion on."),
  "gl.posting.dry_run": named("gl", "Preview postings", "Run a posting as a dry run to see the journal it would write."),
  "gl.recommendations.dismiss": named("gl", "Dismiss recommendations", "Dismiss Klay's suggestions and insights."),
  "gl.reclassify": named("gl", "Reclassify in the ledger", "Move a posted line to another account or cost centre from the General Ledger. Writes a reclassification journal for approval; the original stays."),
  "gl.export": named("gl", "Export the ledger", "Download General Ledger lines as CSV or Excel."),

  // Accounts Payable
  "ap.reverse": named("ap", "Reverse bills", "Reverse a posted bill with a compensating entry."),
  "ap.vendor.create": named("ap", "Create vendors", "Onboard vendor master records."),
  "ap.vendor.edit": named("ap", "Edit vendors", "Change vendor details, including the relationship tier."),
  "ap.vendor.edit_bank": named("ap", "Change vendor bank/payee", "Propose a change to a vendor's bank or payee details. Safe for staff to hold — the change always routes for approval."),
  "ap.vendor.approve": named("ap", "Approve vendors", "Confirm a new or changed vendor so it can be posted to and paid."),
  "ap.payment.authorize": named("ap", "Authorize payments", "Approve a payment request before the money leaves."),
  "ap.payment.void": named("ap", "Void payments", "Void a recorded payment."),
  "ap.credit_note.transact": named("ap", "Vendor credit notes", "Record credit notes from vendors."),

  // Accounts Receivable
  "ar.customer.create": named("ar", "Create customers", "Onboard customer master records."),
  "ar.customer.edit": named("ar", "Edit customers", "Change customer details, including the relationship tier."),
  "ar.customer.edit_bank": named("ar", "Change customer bank", "Change a customer's bank details."),
  "ar.customer.approve": named("ar", "Approve customers", "Confirm a new or changed customer so it can be posted to."),
  "ar.write_off": named("ar", "Write off receivables", "Write off a customer balance as uncollectible."),

  // Inventory
  "inventory.adjust": named("inventory", "Adjust stock", "Record stock count increases and decreases."),

  // Bank
  "bank.account.create": named("bank", "Add bank accounts", "Add a company bank account in Settings."),
  "bank.account.manage": named("bank", "Manage bank accounts", "Edit a company bank account and its GL link."),
  "bank.account.delete": named("bank", "Archive bank accounts", "Archive a company bank account."),
  "bank.statement.import": named("bank", "Import statements", "Upload bank statements."),
  "bank.reconcile": named("bank", "Reconcile bank", "Reconcile bank statements against the ledger, and post the journals reconciliation writes (bank charges, interest, differences, quick drafts)."),
  "bank.quick_draft": named("bank", "Quick draft from bank", "Post the cash journal for an unexplained bank statement line (Quick draft). Matching and reconciling it stays with Reconcile bank."),

  // Master data
  "masterdata.counterparty.manage": named("masterdata", "Manage counterparty lists", "Payment terms, vendor categories and payment methods."),
  "masterdata.counterparty.delete": named("masterdata", "Delete counterparty list items", "Remove payment terms, vendor categories and payment methods."),
  "masterdata.product.manage": named("masterdata", "Manage products", "Item categories and units of measure."),
  "masterdata.product.delete": named("masterdata", "Delete products", "Remove item categories and units."),
  "masterdata.warehouse.manage": named("masterdata", "Manage warehouses", "Locations and sub-locations."),
  "masterdata.warehouse.delete": named("masterdata", "Delete warehouses", "Remove locations and sub-locations."),
  "masterdata.fixed_asset.create": named("masterdata", "Create fixed assets", "Register new fixed assets."),
  "masterdata.fixed_asset.manage": named("masterdata", "Manage fixed assets", "Asset categories and their accounts."),
  "masterdata.fixed_asset.delete": named("masterdata", "Delete fixed assets", "Remove asset categories and assets."),
  "masterdata.inventory_ob.manage": named("masterdata", "Manage opening stock", "Enter opening inventory balances."),
  "masterdata.inventory_ob.delete": named("masterdata", "Delete opening stock", "Remove opening inventory balances."),

  // Reports
  "reports.export": named("reports", "Export reports", "Download reports as CSV or PDF."),

  // Settings
  "settings.entity.view": named("settings", "View company", "See the company profile."),
  "settings.entity.manage": named("settings", "Manage company", "Edit the company profile, logo and accounting basics."),
  "settings.users.view": named("settings", "View users", "See who has access and their roles."),
  "settings.users.manage": named("settings", "Manage users", "Invite, deactivate, and assign roles to users."),
  "settings.users.limits.manage": named("settings", "Manage approval limits", "Set the payment approval workflow and each approver's ceiling."),
  "settings.roles.manage": named("settings", "Manage roles", "Define and edit roles."),
  "settings.scope.assign": named("settings", "Assign scope", "Assign record scope to a user."),
  "settings.sod.mode": named("settings", "Set SoD mode", "Choose whether segregation of duties is Enforced or Relaxed."),
  "settings.access.override.grant": named("settings", "Grant access overrides", "Give a user temporary access outside their roles."),
  "settings.coa.create": named("settings", "Create accounts", "Add accounts to the Chart of Accounts."),
  "settings.coa.manage": named("settings", "Manage Chart of Accounts", "Rename accounts and choose which settle through Payment."),
  "settings.coa.code.unlock": named("settings", "Unlock account codes", "Change the code of a locked tax or control account."),
  "settings.dimensions.manage": named("settings", "Manage dimensions", "Add dimensions and values; rename those no journal uses yet."),
  "settings.dimensions.delete": named("settings", "Delete dimensions", "Delete a dimension no posted journal uses."),
  "settings.dimensions.values.delete": named("settings", "Delete dimension values", "Remove a value no posted journal uses."),
  "settings.fx.manage": named("settings", "Manage FX rates", "Enter and edit exchange rates."),
  "settings.fx.delete": named("settings", "Delete FX rates", "Remove exchange rates."),
  "settings.fx.currency.manage": named("settings", "Manage currencies", "Add and switch on currencies."),
  "settings.posting_rules.manage": named("settings", "Manage posting rules", "Stock movement and book status accounts, journal templates, posting preferences and reconciliation tolerances."),
  "settings.tax.manage": named("settings", "Manage tax codes", "Add tax codes and change their rate and what they apply to."),
  "settings.period.lock": named("settings", "Lock period", "Declare an accounting period closed, and set the monthly closing cut-off."),
  "settings.period.reopen": named("settings", "Reopen period", "Reopen a closed period (a control point — routes through approval)."),
  "settings.autoclear.toggle": named("settings", "Toggle auto-clear", "Turn automatic clearing on or off."),

  // Migration
  "migration.execute": named("migration", "Run migration", "Run the data migration."),
  "migration.file.upload": named("migration", "Upload files", "Upload migration data files."),
  "migration.file.confirm": named("migration", "Confirm files", "Confirm uploaded migration files."),
  "migration.mapping.map": named("migration", "Map accounts", "Map the old chart of accounts to the new one."),
  "migration.stage.lock": named("migration", "Lock stages", "Lock a migration stage once it's done."),
  "migration.signoff.prepare": named("migration", "Prepare sign-off", "Prepare the migration sign-off."),
  "migration.signoff.view": named("migration", "View sign-off", "See the migration sign-off."),
  "migration.uat.attest": named("migration", "Attest UAT", "Confirm user-acceptance testing results."),
  "migration.opening_balance.approve": named("migration", "Approve opening balances", "Approve the migrated opening balances."),
  "migration.go_live.execute": named("migration", "Go live", "Switch the company live on Klay."),
  "migration.coa_template.view": named("migration", "View CoA templates", "See the chart-of-accounts templates."),
  "migration.overview.dismiss": named("migration", "Dismiss overview", "Dismiss the migration overview."),
  "migration.cashback.dismiss": named("migration", "Dismiss cashback notice", "Dismiss the cashback notice."),

  // Other
  "audit.config.view": named("other", "View audit configuration", "See how the audit trail is configured."),
  "identity.directory.view": named("other", "View user directory", "See the people in the company directory."),
  "demo.admin": named("other", "Demo administration", "Reset and manage demo data."),

  // Back office (Klay internal)
  "bo.session": named("bo", "Back-office session", "Sign in to Klay's back office."),
  "bo.entities.view": named("bo", "View entities", "See customer companies."),
  "bo.entities.manage": named("bo", "Manage entities", "Create and edit customer companies."),
  "bo.users.manage": named("bo", "Manage back-office users", "Manage Klay staff accounts."),
  "bo.assignments.view": named("bo", "View assignments", "See staff assignments."),
  "bo.assignments.view_own": named("bo", "View own assignments", "See your own assignments."),
  "bo.assignments.manage": named("bo", "Manage assignments", "Assign staff to companies."),
  "bo.coa.provision": named("bo", "Provision CoA", "Provision a chart of accounts for a company."),
  "bo.migrations.view": named("bo", "View migrations", "See migrations across companies."),
  "bo.migrations.execute": named("bo", "Run migrations", "Run migrations for a company."),
  "bo.templates.view": named("bo", "View templates", "See CoA templates."),
  "bo.templates.publish": named("bo", "Publish templates", "Publish CoA templates."),

  // Forbidden single-capability — never grantable to any role
  "user.edit_own_approval_limit": { label: "Edit own approval limit", kind: "forbidden", desc: "Structurally forbidden: raising your own ceiling defeats every amount-based control." },
};

// Named settings capabilities that make a module read as "full" on the legacy
// ladder (user & access administration).
const ADMIN_SETTINGS_CAPS = ["settings.users.manage", "settings.roles.manage", "settings.scope.assign"];

// ── Role capability grants (backend role catalog, Oct 2026) ────────────────
// roleKey → { moduleKey: [capability, …] }. Absent module = `none`. Verbs are
// bare ("view"); named capabilities are canonical ids.
//
// GAP FILLS — capabilities the prototype gates screens on that no backend role
// holds. Each is marked `// gap` where it is granted:
//   • ap.payment.authorize → Finance Manager (approves payment requests)
//   • reports.full → Finance Manager, CFO, View Only; reports.view → AP Staff,
//     AR Staff, Warehouse Staff, Purchasing Staff
//   • bank.view / bank.statement.import / bank.reconcile → AP Staff (no
//     approve or post, so no SoD conflict)
//   • bank.quick_draft → Finance Manager (posts the missing cash journal from
//     a bank line; reconciling it stays with AP Staff, so SoD #2/#3 hold)
//   • settings.period.lock / settings.period.reopen → Finance Manager
// The payment pipeline stays three seats: AP Staff requests (ap.transact),
// Finance Manager authorizes (ap.payment.authorize), CFO records the payment
// (ap.post without authorize) — see lib/paymentStage.js.
export const ROLE_CAPS = {
  admin: {
    ap: ["view", "ap.vendor.create", "ap.vendor.edit", "ap.vendor.edit_bank"],
    ar: ["view", "ar.customer.create", "ar.customer.edit"],
    bank: ["bank.account.create", "bank.account.manage", "bank.account.delete"],
    gl: ["view", "gl.posting.dry_run", "gl.recommendations.dismiss"],
    inventory: ["transact"],
    masterdata: [
      "masterdata.counterparty.manage", "masterdata.counterparty.delete",
      "masterdata.fixed_asset.create", "masterdata.fixed_asset.manage", "masterdata.fixed_asset.delete",
      "masterdata.inventory_ob.manage", "masterdata.inventory_ob.delete",
      "masterdata.product.manage", "masterdata.product.delete",
      "masterdata.warehouse.manage", "masterdata.warehouse.delete",
    ],
    migration: [
      "view", "migration.execute", "migration.file.upload", "migration.file.confirm", "migration.mapping.map",
      "migration.stage.lock", "migration.signoff.prepare", "migration.signoff.view", "migration.uat.attest",
      "migration.coa_template.view", "migration.overview.dismiss", "migration.cashback.dismiss",
    ],
    settings: [
      "settings.entity.view", "settings.entity.manage", "settings.users.view", "settings.users.manage",
      "settings.users.limits.manage", "settings.roles.manage", "settings.scope.assign", "settings.sod.mode",
      "settings.access.override.grant", "settings.coa.create", "settings.coa.manage", "settings.coa.code.unlock",
      "settings.dimensions.manage", "settings.dimensions.delete", "settings.dimensions.values.delete",
      "settings.fx.manage", "settings.fx.delete", "settings.fx.currency.manage", "settings.posting_rules.manage",
      "settings.tax.manage",
    ],
    other: ["audit.config.view", "identity.directory.view", "demo.admin"],
  },
  finance_manager: {
    ap: ["view", "transact", "approve", "post", "ap.reverse", "ap.vendor.approve", "ap.vendor.edit",
      "ap.payment.authorize"], // gap
    ar: ["view", "transact", "approve", "post", "ar.customer.approve", "ar.customer.edit"],
    bank: ["bank.account.create", "bank.account.manage", "bank.quick_draft"], // gap
    gl: ["view", "transact", "approve", "post", "gl.je.reverse", "gl.reclassify", "gl.export", "gl.posting.dry_run", "gl.recommendations.dismiss"],
    inventory: ["transact", "inventory.adjust"],
    masterdata: [
      "masterdata.counterparty.manage", "masterdata.counterparty.delete", "masterdata.fixed_asset.create",
      "masterdata.fixed_asset.manage", "masterdata.inventory_ob.manage", "masterdata.product.manage",
      "masterdata.product.delete", "masterdata.warehouse.manage",
    ],
    migration: [
      "view", "migration.file.upload", "migration.file.confirm", "migration.mapping.map", "migration.stage.lock",
      "migration.opening_balance.approve", "migration.signoff.view", "migration.uat.attest", "migration.cashback.dismiss",
    ],
    settings: [
      "settings.entity.view", "settings.users.view", "settings.coa.create", "settings.coa.manage",
      "settings.dimensions.manage", "settings.dimensions.values.delete", "settings.fx.manage",
      "settings.posting_rules.manage", "settings.tax.manage",
      "settings.period.lock", "settings.period.reopen", // gap
    ],
    reports: ["full"], // gap
    other: ["audit.config.view", "identity.directory.view"],
  },
  ia: {
    ap: ["view"],
    ar: ["view"],
    bank: ["bank.account.create"],
    gl: ["view", "gl.export", "gl.posting.dry_run", "gl.recommendations.dismiss"],
    inventory: ["transact"],
    masterdata: [
      "masterdata.counterparty.manage", "masterdata.fixed_asset.create", "masterdata.inventory_ob.manage",
      "masterdata.product.manage", "masterdata.warehouse.manage",
    ],
    migration: [
      "view", "migration.execute", "migration.file.upload", "migration.file.confirm", "migration.mapping.map",
      "migration.stage.lock", "migration.signoff.prepare", "migration.signoff.view", "migration.go_live.execute",
      "migration.coa_template.view", "migration.cashback.dismiss",
    ],
    settings: [
      "settings.coa.create", "settings.dimensions.manage", "settings.fx.manage", "settings.fx.currency.manage",
      "settings.posting_rules.manage", "settings.tax.manage",
    ],
    other: ["audit.config.view", "identity.directory.view"],
  },
  cfo: {
    ap: ["view", "approve", "post", "ap.reverse", "ap.vendor.approve"],
    ar: ["view", "approve", "post", "ar.customer.approve"],
    gl: ["view", "gl.recommendations.dismiss"],
    migration: ["view", "migration.file.confirm", "migration.opening_balance.approve", "migration.signoff.view", "migration.cashback.dismiss"],
    reports: ["full"], // gap
    other: ["audit.config.view", "identity.directory.view"],
  },
  ap_staff: {
    ap: ["view", "transact", "ap.vendor.create", "ap.vendor.edit", "ap.vendor.edit_bank"],
    gl: ["view", "transact", "gl.posting.dry_run", "gl.recommendations.dismiss"],
    inventory: ["transact", "inventory.adjust"],
    masterdata: ["masterdata.counterparty.manage", "masterdata.product.manage"],
    migration: ["view", "migration.uat.attest", "migration.cashback.dismiss"],
    bank: ["view", "bank.statement.import", "bank.reconcile"], // gap
    reports: ["view"], // gap
    other: ["audit.config.view", "identity.directory.view"],
  },
  ar_staff: {
    ar: ["view", "transact", "ar.customer.create", "ar.customer.edit"],
    gl: ["view", "transact", "gl.posting.dry_run", "gl.recommendations.dismiss"],
    inventory: ["transact", "inventory.adjust"],
    masterdata: ["masterdata.counterparty.manage", "masterdata.product.manage"],
    migration: ["view", "migration.uat.attest", "migration.cashback.dismiss"],
    reports: ["view"], // gap
    other: ["audit.config.view", "identity.directory.view"],
  },
  view_only: {
    ap: ["view"],
    ar: ["view"],
    gl: ["view", "gl.recommendations.dismiss"],
    migration: ["view", "migration.cashback.dismiss"],
    reports: ["full"], // gap
    other: ["identity.directory.view"],
  },
  warehouse_staff: {
    inventory: ["transact"],
    gl: ["view", "gl.recommendations.dismiss"],
    migration: ["view", "migration.cashback.dismiss"],
    reports: ["view"], // gap
    other: ["identity.directory.view"],
  },
  purchasing_staff: {
    gl: ["view", "gl.recommendations.dismiss"],
    migration: ["view", "migration.cashback.dismiss"],
    reports: ["view"], // gap
    other: ["identity.directory.view"],
  },
};

// ── Roles (seeded customer templates) ──────────────────────────────────────
// The starting set every company is provisioned with — after that they are
// ordinary, editable roles (is_system only records provenance).
// approval_limit is the max Rupiah a role may approve.
export const ROLES = [
  {
    key: "admin",
    name: "Admin",
    description: "Company and access administration — users, roles, scope and SoD mode — plus the company's setup: chart of accounts, tax, dimensions, FX, posting rules, bank accounts and master data. Runs the migration. No approval or posting on any financial module.",
    is_system: true,
    is_internal: false,
    approval_limit: null,
  },
  {
    key: "finance_manager",
    name: "Finance Manager",
    description: "The senior control. Approves and posts across GL, AP and AR, reverses entries, approves vendors and customers, and authorizes payments. Holds accounting configuration (chart of accounts, dimensions, FX, posting rules, tax) and period close. Can quick-draft a missing cash journal from a bank line, but not reconcile it. No user administration or vendor creation.",
    is_system: true,
    is_internal: false,
    approval_limit: 100000000,
  },
  {
    key: "ia",
    name: "IA",
    description: "Runs the data migration end to end — uploads, mapping, staging, sign-off preparation and go-live — and sets up the chart of accounts, tax, dimensions, FX and posting rules alongside it. Views AP, AR and GL; no approval or posting.",
    is_system: true,
    is_internal: false,
    approval_limit: null,
  },
  {
    key: "cfo",
    name: "CFO",
    description: "Approves and posts bills and invoices, reverses bills, approves vendors and customers, records payments once authorized, and approves the migrated opening balances. Reads the general ledger and full reports; no journal posting or configuration.",
    is_system: true,
    is_internal: false,
    approval_limit: null,
  },
  {
    key: "ap_staff",
    name: "AP Staff",
    description: "Enters vendor bills and journals and submits them, requests payments, onboards and edits vendors, adjusts stock, and reconciles the bank. Cannot approve or post — so holding vendor creation and bank reconciliation is safe.",
    is_system: true,
    is_internal: false,
    approval_limit: null,
  },
  {
    key: "ar_staff",
    name: "AR Staff",
    description: "The AP Staff mirror on the receivables side. Enters invoices and journals and submits them, onboards and edits customers, and adjusts stock.",
    is_system: true,
    is_internal: false,
    approval_limit: null,
  },
  {
    key: "view_only",
    name: "View Only",
    description: "Read-only oversight — owner, director, external auditor, investor. Sees AP, AR, the general ledger and full reports; writes nothing.",
    is_system: true,
    is_internal: false,
    approval_limit: null,
  },
  {
    key: "warehouse_staff",
    name: "Warehouse Staff",
    description: "Goods receipt and stock operations. Reads the general ledger; no access to bills, invoices or payments.",
    is_system: true,
    is_internal: false,
    approval_limit: null,
  },
  {
    key: "purchasing_staff",
    name: "Purchasing Staff",
    description: "Raises purchase orders and procurement requests. Reads the general ledger.",
    is_system: true,
    is_internal: false,
    approval_limit: null,
  },
];

// NOTE — bank.reconcile HARD-conflicts with posting to the ledger and with
// approving payments (SoD #2, #3). No backend role holds it yet; here AP Staff
// carries it (gap fill) because AP Staff holds no approve or post. Giving it
// to a poster or approver as temporary access is blocked when the company is
// Enforced, and needs an accepted risk when it is Relaxed.

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
//   • named caps   → the canonical id as-is (e.g. "ap.vendor.create",
//                    "bank.reconcile", "settings.coa.manage")
//
// `override` ({ key, caps }) swaps one role's grants for a draft — the Roles
// editor uses it to ask "what would each holder end up with if I saved this?".
export function effectiveCapabilities(roleKeys = [], extraCaps = [], override = null) {
  const set = new Set();
  for (const rk of roleKeys) {
    const mods = override && override.key === rk ? override.caps : ROLE_CAPS[rk];
    addModuleCaps(set, mods);
  }
  for (const c of extraCaps) set.add(c);
  return set;
}

// Canonical capability ids for one { moduleKey: [cap, …] } grant map.
export function capabilitySet(capsByModule) {
  return addModuleCaps(new Set(), capsByModule);
}

function addModuleCaps(set, capsByModule = {}) {
  for (const [module, caps] of Object.entries(capsByModule || {})) {
    for (const cap of caps) {
      if (VERBS.includes(cap)) {
        if (cap === "full") for (const v of VERBS) set.add(`${module}.${v}`);
        else set.add(`${module}.${cap}`);
      } else {
        set.add(cap); // named caps are already canonical
      }
    }
  }
  return set;
}

// ── Segregation-of-Duties rules (capability-level, PRD §8.2 D6 — locked) ──────
// Defined over CAPABILITIES, not role pairs, so a self-built fraud combo in a
// future custom role is caught the moment it's defined. A rule fires when the
// user's effective set intersects group `a` AND group `b`. What a hit means
// depends on the company's SoD mode (set by Klay; shown on Settings → Users → Roles) — see sodDecision:
//   forbidden          → always denied
//   HARD, relaxable    → denied when ENFORCED; allowed with an accepted risk when RELAXED
//   HARD, !relaxable   → always denied (none seeded today, mirroring the backend)
//   SOFT               → allowed with an accepted risk in either mode
export const SOD_RULES = [
  {
    id: 1,
    type: "HARD",
    relaxable: true,
    a: ["ap.vendor.create"],
    b: ["ap.approve", "ap.post", "ap.payment.authorize"],
    label: "Create vendor + pay vendor",
    reason: "One person onboarding a vendor and paying it is the classic fake-vendor fraud.",
  },
  {
    id: 2,
    type: "HARD",
    relaxable: true,
    a: ["ap.approve", "ap.payment.authorize"],
    b: ["bank.reconcile"],
    label: "Approve payment + reconcile bank",
    reason: "Approving a payment and reconciling the bank lets one person both move money and hide the movement.",
  },
  {
    id: 3,
    type: "HARD",
    relaxable: true,
    a: ["gl.post"],
    b: ["bank.reconcile"],
    label: "Post to ledger + reconcile bank",
    reason: "Posting to the ledger and reconciling the bank is the textbook record-and-conceal combination.",
  },
  {
    id: 4,
    type: "HARD",
    forbidden: true,
    a: ["user.edit_own_approval_limit"],
    b: null,
    label: "Edit own approval limit",
    reason: "No role may ever include the ability to raise its own approval ceiling; it defeats every amount-based control.",
  },
  {
    id: 5,
    type: "SOFT",
    a: ["settings.users.manage", "settings.roles.manage"],
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
  return evaluateSodSet(effectiveCapabilities(roleKeys || [], opts.extraCaps || [], opts.override || null));
}

// Same evaluation over an already-flattened capability set.
export function evaluateSodSet(set) {
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
      all: hits,
    };
  }
  const soft = hits.filter((h) => h.type === "SOFT");
  if (soft.length) {
    return {
      level: "soft",
      message: `Segregation of duties warning: ${soft.map((h) => h.label).join("; ")} should be split across people. Provide a justification to proceed.`,
      conflicts: soft,
      all: hits,
    };
  }
  return { level: "none", message: "", conflicts: [], all: [] };
}

// What the entity's SoD mode does with a set of fired rules. Returns
// { level: "blocked"|"risk"|"none", blocked: [rule], risk: [rule] } — blocked
// rules refuse the change outright; risk rules let it through only once a
// justification and an independent risk owner are recorded.
export function sodDecision(rules = [], mode = "ENFORCED") {
  const blocked = [];
  const risk = [];
  for (const r of rules) {
    if (r.forbidden) blocked.push(r);
    else if (r.type === "HARD" && (mode !== "RELAXED" || !r.relaxable)) blocked.push(r);
    else risk.push(r);
  }
  return { level: blocked.length ? "blocked" : risk.length ? "risk" : "none", blocked, risk };
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
  { id: "U008", name: "Putri Handayani", email: "putri.handayani@klay.id", roleKeys: ["ia"], status: "Active", approval_limit: null, lastActive: "2026-06-06", invitedOn: "2025-06-02" },
  { id: "U009", name: "Galih Ramadhan", email: "galih.ramadhan@klay.id", roleKeys: ["ar_staff"], status: "Inactive", approval_limit: null, lastActive: "2025-11-14", invitedOn: "2025-05-09" },
  { id: "U010", name: "Lutfi Hakim", email: "lutfi.hakim@klay.id", roleKeys: ["cfo"], status: "Active", approval_limit: null, lastActive: "2026-06-06", invitedOn: "2025-05-09" },
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
    const justification = null;
    // A few clean operational multi-role holders. Operational roles carry no
    // approval authority, so these combinations raise no SoD flag — they show
    // that AP+AR and Purchasing+Warehouse are freely combinable.
    if (primary === "warehouse_staff" && idx % 11 === 3) roleKeys.push("purchasing_staff");
    if (primary === "ap_staff" && idx % 9 === 4) roleKeys.push("ar_staff");
    // No Admin + Finance Manager holder: Admin creates vendors, so with Finance
    // Manager approval it is a HARD conflict (SoD #1), refused under Enforced.

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

// ── Live role registry (customisable roles) ────────────────────────────────
// ROLES and ROLE_CAPS above are the roles every company is provisioned with,
// so nobody begins from an empty role, and they are also the live
// registry. Every helper in this file (effectiveCapabilities, evaluateSod,
// roleName) and CurrentUserContext read them at call time, so an edit made on
// the Roles page takes effect app-wide without threading state through every
// caller. RolesContext is the only writer; it bumps a revision so React
// re-renders.
export function cloneCaps(caps) {
  return Object.fromEntries(Object.entries(caps || {}).map(([m, c]) => [m, [...c]]));
}

// A user's approval limit is the highest limit among the roles they hold
// (null = no approval authority). The approval workflow decides WHO is asked;
// this ceiling decides how much their signature can cover.
export function approvalLimitFor(roleKeys = []) {
  let max = null;
  for (const k of roleKeys) {
    const r = ROLES.find((x) => x.key === k);
    if (r?.approval_limit != null) max = Math.max(max ?? 0, r.approval_limit);
  }
  return max;
}

// Insert or replace a role and its grants, then re-derive the approval limit of
// everyone holding it.
export function writeRole(role, caps) {
  const i = ROLES.findIndex((r) => r.key === role.key);
  if (i >= 0) ROLES[i] = { ...role };
  else ROLES.push({ ...role });
  ROLE_CAPS[role.key] = cloneCaps(caps);
  for (const u of USERS) {
    if (u.roleKeys.includes(role.key)) u.approval_limit = approvalLimitFor(u.roleKeys);
  }
}

// Remove a custom role. Callers must ensure nobody holds it.
export function removeRole(key) {
  const i = ROLES.findIndex((r) => r.key === key);
  if (i >= 0) ROLES.splice(i, 1);
  delete ROLE_CAPS[key];
}
