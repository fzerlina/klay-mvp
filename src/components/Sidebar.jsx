import { useState, useEffect, useRef } from "react";
import { NavLink } from "react-router-dom";
import { useCurrentUser, PERSONAS } from "../state/CurrentUserContext";
import { ROLES } from "../data/seed/roles";
import { computeApCloseSummary, computeBillPostingProgress } from "../data/seed/apClose";

function initials(name) {
  if (!name) return "?";
  return name.trim().split(/\s+/).map((w) => w[0] || "").join("").slice(0, 2).toUpperCase();
}

function primaryRoleLabel(roleKeys = []) {
  const names = roleKeys.map((k) => ROLES.find((r) => r.key === k)?.name || k);
  if (names.length === 0) return "No role";
  if (names.length === 1) return names[0];
  return `${names[0]} +${names.length - 1}`;
}

// Sidebar footer control to switch the active demo persona. Flipping it re-runs
// every can()/level() gate in the app so the nav and views change per role.
function PersonaSwitcher({ collapsed }) {
  const { user, setUserId } = useCurrentUser();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div className="sb-persona-wrap" ref={ref}>
      {open && (
        <div className="sb-persona-menu">
          <div className="sb-persona-menu-hdr">Viewing as</div>
          {PERSONAS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`sb-persona-opt${p.id === user.id ? " active" : ""}`}
              onClick={() => { setUserId(p.id); setOpen(false); }}
            >
              <span className="sb-av">{initials(p.name)}</span>
              <span className="sb-persona-opt-body">
                <span className="sb-persona-opt-name">{p.name}</span>
                <span className="sb-persona-opt-role">{primaryRoleLabel(p.roleKeys)}</span>
              </span>
              {p.id === user.id && (
                <svg className="sb-persona-check" viewBox="0 0 12 12"><polyline points="2 6 5 9 10 3" /></svg>
              )}
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        className={`sb-profile sb-persona-trigger${open ? " open" : ""}`}
        title={collapsed ? `Viewing as ${user.name} · ${primaryRoleLabel(user.roleKeys)}` : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="sb-av">{initials(user.name)}</span>
        {!collapsed && (
          <span className="sb-persona-id">
            <span className="sb-persona-eyebrow">Viewing as</span>
            <span className="sb-profile-name">{user.name}</span>
            <span className="sb-profile-role">{primaryRoleLabel(user.roleKeys)}</span>
          </span>
        )}
        {!collapsed && (
          <svg className="sb-persona-caret" viewBox="0 0 12 12"><polyline points="3 5 6 8 9 5" /></svg>
        )}
      </button>
    </div>
  );
}

// Close hero card pinned at the top of the sidebar (above the Overview section).
// Reinforces Klay's 0-day-closing USP and gives a constant signal of where the
// close stands without leaving any page. The framing is role-aware:
//   • Close owners (FM/Admin, who can approve+post) see the period's readiness —
//     "Ready to close" or "N blockers to clear".
//   • Everyone else sees how many open close tasks remain.
// The ring shows tangible progress (period bills posted to the GL). The Close
// Command Center page (/close) is the live source.
function CloseHeroCard({ collapsed }) {
  const { hasLevel } = useCurrentUser();
  const isCloseOwner = hasLevel("ap", "approve+post");
  const s = computeApCloseSummary();
  const posting = computeBillPostingProgress();

  const R = 13;
  const C = 2 * Math.PI * R;
  const arcFrac = posting.total ? posting.posted / posting.total : 0;
  const arcLen = arcFrac * C;
  const pct = Math.round(arcFrac * 100);
  const centerNum = s.blockerCount;
  const subText = isCloseOwner
    ? (s.ready ? "Ready to close" : `${s.blockerCount} blocker${s.blockerCount === 1 ? "" : "s"} to clear`)
    : (s.open === 0 ? "You're all caught up" : `${s.open} open close task${s.open === 1 ? "" : "s"}`);

  return (
    <NavLink
      to="/close"
      title={collapsed ? `April Close · ${subText}` : undefined}
      className={({ isActive }) => `sb-close-hero${isActive ? " active" : ""}${collapsed ? " collapsed" : ""}`}
    >
      <span className="sb-close-hero-ring" aria-label={`April Close — ${subText} (${pct}% posted)`}>
        <svg viewBox="0 0 32 32">
          <circle cx="16" cy="16" r={R} fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="3"/>
          {arcFrac > 0 && (
            <circle
              cx="16" cy="16" r={R} fill="none"
              stroke="#3ec47a" strokeWidth="3" strokeLinecap="round"
              strokeDasharray={`${arcLen} ${C - arcLen}`}
              transform="rotate(-90 16 16)"
            />
          )}
          <text x="16" y="20" textAnchor="middle" fontSize="10" fontWeight="700" fill="#fff" fontFamily="var(--font-display)">{centerNum}</text>
        </svg>
      </span>
      {!collapsed && (
        <span className="sb-close-hero-body">
          <span className="sb-close-hero-title">April Close</span>
          <span className="sb-close-hero-sub">{subText}</span>
        </span>
      )}
    </NavLink>
  );
}

const navSections = [
  {
    standalone: true,
    items: [
      {
        label: "Command Center",
        to: "/command-center",
        icon: <svg viewBox="0 0 24 24"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>,
      },
    ],
  },
  {
    section: "Payables",
    collapsible: true,
    key: "ap",
    icon: <svg viewBox="0 0 24 24"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>,
    items: [
      {
        label: "Bills",
        to: "/bills",
        module: "ap",
        icon: <svg viewBox="0 0 24 24"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>,
      },
      {
        label: "Payment",
        to: "/payments",
        module: "ap",
        icon: <svg viewBox="0 0 24 24"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M2 10h20"/><path d="M16 14h2"/></svg>,
      },
    ],
  },
  {
    section: "Receivables",
    collapsible: true,
    key: "ar",
    icon: <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>,
    items: [
      {
        label: "Invoices",
        to: "/invoices",
        module: "ar",
        icon: <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>,
      },
    ],
  },
  {
    section: "Master Data",
    collapsible: true,
    key: "masterData",
    icon: <svg viewBox="0 0 24 24"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v6c0 1.7 4 3 9 3s9-1.3 9-3V5"/><path d="M3 11v6c0 1.7 4 3 9 3s9-1.3 9-3v-6"/></svg>,
    items: [
      {
        label: "Vendors",
        to: "/vendors",
        module: "ap",
        icon: <svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
      },
      {
        label: "Customers",
        to: "/customers",
        module: "ar",
        icon: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>,
      },
      {
        label: "Items",
        to: "/items",
        icon: <svg viewBox="0 0 24 24"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>,
      },
    ],
  },
  {
    section: "Reconciliation",
    collapsible: true,
    key: "reconciliation",
    icon: <svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><polyline points="21 3 21 8 16 8"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><polyline points="3 21 3 16 8 16"/></svg>,
    items: [
      {
        label: "Bank Reconciliation",
        to: "/bank-reconciliation",
        module: "gl",
        icon: <svg viewBox="0 0 24 24"><rect x="2" y="6" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/><path d="M6 15h4M14 15h4"/></svg>,
      },
      {
        label: "Tax Reconciliation",
        to: "/tax-reconciliation",
        module: "gl",
        icon: <svg viewBox="0 0 24 24"><path d="M9 14l6-6"/><circle cx="9.5" cy="8.5" r="1.5"/><circle cx="14.5" cy="13.5" r="1.5"/><rect x="3" y="3" width="18" height="18" rx="2"/></svg>,
      },
    ],
  },
  {
    standalone: true,
    items: [
      {
        label: "Reports",
        to: "/reports",
        module: "reports",
        icon: <svg viewBox="0 0 24 24"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>,
      },
    ],
  },
];

const settingsSections = [
  {
    key: "accounting",
    label: "Accounting",
    module: "settings",
    icon: <svg viewBox="0 0 24 24"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>,
    items: [
      { label: "Chart of accounts", to: "/chart-of-accounts" },
      { label: "Bank accounts", to: "/bank-accounts" },
      { label: "Dimensions", to: "/dimensions" },
      { label: "Posting periods", to: "/posting-periods" },
      { label: "Inventory", to: "/inventory-settings" },
      { label: "Tax codes" },
      { label: "Tax rates" },
      { label: "Fiscal year" },
      { label: "Currency" },
    ],
  },
  {
    key: "access",
    label: "Access",
    module: "settings",
    icon: <svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
    items: [
      { label: "Users", to: "/users" },
      { label: "Access policy", to: "/access-policy" },
    ],
  },
];

// Brand-textured background — gradient (on .sb), film grain, soft vignette,
// architectural light shapes. Pure decoration; aria-hidden, pointer-events:none.
function BrandTexture() {
  const noiseSvg =
    "<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'>" +
      "<filter id='n'>" +
        "<feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/>" +
      "</filter>" +
      "<rect width='100%' height='100%' filter='url(#n)'/>" +
    "</svg>";
  const noiseUrl = `url("data:image/svg+xml,${encodeURIComponent(noiseSvg)}")`;
  return (
    <div className="sb-texture" aria-hidden>
      <div className="sb-grain" style={{ backgroundImage: noiseUrl }} />
      <div className="sb-vignette" />
      <svg className="sb-shapes" viewBox="0 0 232 600" preserveAspectRatio="none">
        <defs>
          <linearGradient id="sb-slat" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="rgba(255,255,255,0)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0.16)" />
          </linearGradient>
        </defs>
        <g>
          <rect x="-40" y="80"  width="340" height="540" fill="url(#sb-slat)" opacity="0.6" />
          <rect x="10"  y="130" width="290" height="490" fill="url(#sb-slat)" opacity="0.6" />
          <rect x="60"  y="180" width="240" height="440" fill="url(#sb-slat)" opacity="0.6" />
          <rect x="110" y="230" width="190" height="390" fill="url(#sb-slat)" opacity="0.6" />
          <rect x="160" y="280" width="140" height="340" fill="url(#sb-slat)" opacity="0.6" />
        </g>
      </svg>
    </div>
  );
}

function CollapseToggle({ collapsed, onToggle }) {
  const label = collapsed ? "Open sidebar" : "Close sidebar";
  return (
    <button
      type="button"
      className="sb-toggle"
      onClick={onToggle}
      title={label}
      aria-label={label}
      aria-pressed={collapsed}
    >
      <svg viewBox="0 0 12 12">
        <path d={collapsed ? "M4 2l4 4-4 4" : "M8 2l-4 4 4 4"} />
      </svg>
    </button>
  );
}

const STORAGE_KEY = "klay.sidebar.collapsed";

function readInitialCollapsed() {
  if (typeof window === "undefined") return false;
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved !== null) return saved === "true";
  } catch (_) {}
  return window.innerWidth < 1280;
}

export default function Sidebar() {
  const [open, setOpen] = useState({ ap: true, ar: true, masterData: true, reconciliation: true });
  const [collapsed, setCollapsed] = useState(readInitialCollapsed);
  const { can } = useCurrentUser();

  useEffect(() => {
    try { window.localStorage.setItem(STORAGE_KEY, String(collapsed)); } catch (_) {}
  }, [collapsed]);

  const toggle = (key) => setOpen((prev) => ({ ...prev, [key]: !prev[key] }));

  // Only show nav items the current persona can reach; drop sections left empty.
  const visibleNav = navSections
    .map((s) => ({ ...s, items: s.items.filter((it) => can(it.module)) }))
    .filter((s) => s.items.length > 0);
  const visibleSettings = settingsSections.filter((s) => can(s.module));

  return (
    <nav className={`sb${collapsed ? " collapsed" : ""}`}>
      <BrandTexture />
      <CollapseToggle collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />

      <div className="sb-content">
        <div className="sb-top">
          <div className="sb-logomark">
            <svg viewBox="0 0 24 24">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
            </svg>
          </div>
          <span className="sb-brand">Klay</span>
        </div>

        <div className="sb-search-wrap">
          <button
            type="button"
            className="sb-klay-btn"
            title="Ask Klay (⌘J)"
            onClick={() => window.dispatchEvent(new CustomEvent("klay:open-launcher"))}
          >
            <span className="sb-klay-btn-icon">
              <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 1.5l1.3 3.2L11.5 6l-3.2 1L7 10l-1.3-3L2.5 6l3.2-1.3L7 1.5z" />
                <path d="M11.5 9.5l.5 1.2 1.2.5-1.2.5-.5 1.2-.5-1.2-1.2-.5 1.2-.5.5-1.2z" />
              </svg>
            </span>
            <span className="sb-klay-btn-label">Ask Klay</span>
            <span className="sb-klay-btn-kbd">⌘J</span>
          </button>
          <button className="sb-notif-btn" type="button" title="Notifications">
            <svg viewBox="0 0 24 24">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            <span className="sb-notif-dot" />
          </button>
        </div>

        <CloseHeroCard collapsed={collapsed} />

        {visibleNav.map((sec, sIdx) => {
          const { section, items, collapsible, standalone, key: secKey, icon: secIcon } = sec;

          // Standalone item(s) with no section header (Command Center, Reports).
          if (standalone) {
            return (
              <div key={items[0]?.to || sIdx}>
                {sIdx > 0 && <div className="sb-rail-divider" />}
                {items.map(({ label, to, icon }) => (
                  <NavLink
                    key={to}
                    to={to}
                    title={collapsed ? label : undefined}
                    className={({ isActive }) => `sb-item${isActive ? " active" : ""}`}
                  >
                    {icon}
                    {!collapsed && label}
                  </NavLink>
                ))}
              </div>
            );
          }

          // Collapsible group (e.g. Master Data). When the rail is collapsed to
          // icons we fall through to the flat render so its items stay reachable.
          if (collapsible && !collapsed) {
            const isOpen = !!open[secKey];
            return (
              <div key={section}>
                {sIdx > 0 && <div className="sb-rail-divider" />}
                <div className="sn-item" onClick={() => toggle(secKey)}>
                  {secIcon}
                  {section}
                  <svg className="sn-arrow" viewBox="0 0 24 24" style={{ transform: isOpen ? "rotate(90deg)" : "none" }}>
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </div>
                {isOpen && items.map(({ label, to, icon }) => (
                  <NavLink
                    key={to}
                    to={to}
                    className={({ isActive }) => `sb-item sb-item-nested${isActive ? " active" : ""}`}
                  >
                    {icon}
                    {label}
                  </NavLink>
                ))}
              </div>
            );
          }

          return (
            <div key={section}>
              <div className="sb-section">{section}</div>
              {sIdx > 0 && <div className="sb-rail-divider" />}
              {items.map(({ label, to, icon, indicator, accent }) => (
                <NavLink
                  key={to}
                  to={to}
                  title={collapsed ? `${section} · ${label}` : undefined}
                  className={({ isActive }) => `sb-item${isActive ? " active" : ""}${accent ? ` sb-item-${accent}` : ""}`}
                >
                  {icon}
                  {!collapsed && label}
                  {!collapsed && indicator}
                </NavLink>
              ))}
            </div>
          );
        })}

        <div className="sb-foot">
        {!collapsed && visibleSettings.length > 0 && (
          <>
            <div className="sb-section">Settings</div>
            {visibleSettings.map(({ key, label, icon, items }) => (
              <div key={key}>
                <div className="sn-item" onClick={() => toggle(key)}>
                  {icon}
                  {label}
                  <svg
                    className="sn-arrow"
                    viewBox="0 0 24 24"
                    style={{ transform: open[key] ? "rotate(90deg)" : "none" }}
                  >
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </div>
                {open[key] && (
                  <div>
                    {items.map((item) =>
                      item.to ? (
                        <NavLink
                          key={item.to}
                          to={item.to}
                          className={({ isActive }) =>
                            `sn-subitem${isActive ? " sn-subitem-active" : ""}`
                          }
                        >
                          {item.label}
                        </NavLink>
                      ) : (
                        <div key={item.label} className="sn-subitem">
                          {item.label}
                        </div>
                      ),
                    )}
                  </div>
                )}
              </div>
            ))}
          </>
        )}

        <div className="sb-bottom">
          <PersonaSwitcher collapsed={collapsed} />
        </div>
        </div>{/* /sb-foot */}
      </div>
    </nav>
  );
}
