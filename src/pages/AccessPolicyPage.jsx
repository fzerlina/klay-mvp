import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAccountingSettings } from "../state/AccountingSettingsContext";
import "./modules.css";
import "./invoices-ledger.css";
import "./settings-pages.css";
import "./roles-users.css";
import "./access-policy.css";

// Entity-level Segregation-of-Duties enforcement mode (per the Role Management PRD).
// One setting per entity: ENFORCED (default) or RELAXED. This is a separate lever
// from the role matrix and the role-assignment SoD check on the Users page — it
// governs the runtime submitter-≠-poster control at *posting* time, not who may
// hold which roles. The mode lives in AccountingSettingsContext so the screens
// that post (bank reconciliation's Review & post journals) can enforce it.

const ENTITY = { name: "PT Sejahtera Makmur", id: "ENT-001" };

const MODES = {
  ENFORCED: {
    key: "ENFORCED",
    label: "Enforced",
    tag: "Default",
    shape: "Segregated teams",
    summary:
      "Whoever submits a transaction cannot also post it. Approvals follow the role matrix and approval limits exactly.",
    points: [
      { ok: true, text: "Submitter must differ from the poster on every Pattern B posting." },
      { ok: true, text: "The DRAFT → APPROVED → POSTED chain is required; no step can be skipped." },
      { ok: true, text: "Self-posting is blocked outright — the post button is disabled for the submitter." },
    ],
  },
  RELAXED: {
    key: "RELAXED",
    label: "Relaxed",
    tag: "Lean / single-operator",
    shape: "One operator wears several hats",
    summary:
      "Suited to a small team where the same person necessarily records and posts. Controls shift from prevention to a visible audit trail.",
    points: [
      { ok: false, text: "The submitter-≠-poster check is skipped — one person can record and post." },
      { ok: false, text: "The approval step is optional; transactions may move DRAFT → POSTED directly." },
      { ok: true, text: "Every self-post is written to the audit log with action = self_posted." },
    ],
  },
};

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export default function AccessPolicyPage() {
  const { sodMode: mode, setSodMode: setMode } = useAccountingSettings();
  const [pendingRelax, setPendingRelax] = useState(false); // RELAXED selected, awaiting confirm
  const [ack, setAck] = useState(false);
  const [log, setLog] = useState([
    { ts: "2025-01-12T09:00:00", from: null, to: "ENFORCED", by: "System (provisioning)" },
  ]);
  const [toast, setToast] = useState("");
  const toastTmr = useRef(null);

  function showToast(msg) {
    setToast(msg);
    if (toastTmr.current) clearTimeout(toastTmr.current);
    toastTmr.current = setTimeout(() => setToast(""), 2200);
  }

  function applyMode(next) {
    if (next === mode) return;
    setLog((prev) => [
      { ts: new Date().toISOString(), from: mode, to: next, by: "Sarah Wijaya (Admin)" },
      ...prev,
    ]);
    setMode(next);
    setPendingRelax(false);
    setAck(false);
    showToast(`Enforcement mode set to ${MODES[next].label}`);
  }

  // Selecting a card. Relaxing controls is a deliberate, audit-relevant action →
  // requires a typed acknowledgment. Tightening back to ENFORCED applies at once.
  function selectMode(next) {
    if (next === mode) {
      setPendingRelax(false);
      setAck(false);
      return;
    }
    if (next === "RELAXED") {
      setPendingRelax(true);
      setAck(false);
    } else {
      applyMode("ENFORCED");
    }
  }

  const summary = useMemo(() => {
    const relaxed = mode === "RELAXED";
    return {
      submitter: relaxed ? "Skipped" : "Required",
      approval: relaxed ? "Optional" : "Required",
      selfPost: relaxed ? "Audit-flagged" : "Blocked",
    };
  }, [mode]);

  // The card the screen is previewing (pending takes precedence over current).
  const shown = pendingRelax ? "RELAXED" : mode;

  return (
    <div className="lg-page access-policy-page">
      <div className="lg-scroll-container">
        <div className="lg-head">
          <div className="lg-head-top">
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1 className="lg-title">Access policy</h1>
              <p className="settings-sub">
                Entity-wide governance for how Klay enforces segregation of duties at posting time. This is set once
                per entity and applies to every module. It is separate from the role matrix and the role-assignment
                checks in <Link to="/users" className="ru-inline-link">Users</Link>.
              </p>
            </div>
          </div>

          <div className="lg-kpi-strip kpi-3">
            <button type="button" className="lg-kpi-cell">
              <div className="lg-kpi-lbl">Enforcement mode</div>
              <div className={`lg-kpi-val${mode === "RELAXED" ? " warn" : ""}`}>{MODES[mode].label}</div>
              <div className="lg-kpi-sub">{ENTITY.name}</div>
            </button>
            <button type="button" className="lg-kpi-cell">
              <div className="lg-kpi-lbl">Submitter ≠ poster</div>
              <div className={`lg-kpi-val${summary.submitter === "Skipped" ? " warn" : ""}`}>{summary.submitter}</div>
              <div className="lg-kpi-sub">on every posting</div>
            </button>
            <button type="button" className="lg-kpi-cell">
              <div className="lg-kpi-lbl">Self-posts</div>
              <div className={`lg-kpi-val${summary.selfPost === "Audit-flagged" ? " warn" : ""}`}>{summary.selfPost}</div>
              <div className="lg-kpi-sub">{summary.selfPost === "Blocked" ? "prevented up front" : "logged, not blocked"}</div>
            </button>
          </div>
        </div>

        {/* ── Mode selector ─────────────────────────────────────────────── */}
        <div className="ru-section-hdr">
          <span className="ru-section-title">Enforcement mode</span>
        </div>
        <p className="ru-sod-intro">
          Two deployment shapes, one surface — the screens and endpoints never change. Only the posting-time control
          differs. The default is <strong>Enforced</strong>; <strong>Relaxed</strong> is a deliberate choice for lean
          teams and is never inferred from team size.
        </p>

        <div className="acp-mode-grid">
          {Object.values(MODES).map((m) => {
            const isCurrent = mode === m.key;
            const isShown = shown === m.key;
            return (
              <button
                type="button"
                key={m.key}
                className={`acp-mode-card${isShown ? " selected" : ""}${m.key === "RELAXED" ? " relaxed" : ""}`}
                onClick={() => selectMode(m.key)}
              >
                <div className="acp-mode-top">
                  <span className={`acp-radio${isShown ? " on" : ""}`} />
                  <span className="acp-mode-name">{m.label}</span>
                  <span className={`acp-mode-tag${m.key === "RELAXED" ? " warn" : ""}`}>{m.tag}</span>
                  {isCurrent && <span className="acp-mode-current">Current</span>}
                </div>
                <div className="acp-mode-shape">{m.shape}</div>
                <p className="acp-mode-summary">{m.summary}</p>
                <ul className="acp-mode-points">
                  {m.points.map((p, i) => (
                    <li key={i} className={p.ok ? "ok" : "warn"}>
                      <span className="acp-pt-ico" aria-hidden>
                        {p.ok ? (
                          <svg viewBox="0 0 12 12"><polyline points="2.5 6.5 5 9 9.5 3.5" /></svg>
                        ) : (
                          <svg viewBox="0 0 12 12"><line x1="3" y1="6" x2="9" y2="6" /></svg>
                        )}
                      </span>
                      {p.text}
                    </li>
                  ))}
                </ul>
              </button>
            );
          })}
        </div>

        {/* ── Confirm panel for relaxing controls ───────────────────────── */}
        {pendingRelax && (
          <div className="acp-confirm">
            <div className="acp-confirm-hdr">
              <svg viewBox="0 0 24 24"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
              Switching {ENTITY.name} to Relaxed weakens a control
            </div>
            <p>
              With Relaxed enforcement, one person can both record and post a transaction. This is acceptable for a
              single-operator team, but it removes the structural guarantee that two people touch every posting. The
              change is written to the audit log and attributed to you.
            </p>
            <label className="acp-ack">
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
              <span>
                I understand {ENTITY.name} will skip the submitter-≠-poster check, and that self-posts will be
                audit-flagged rather than blocked.
              </span>
            </label>
            <div className="acp-confirm-actions">
              <button
                type="button"
                className="drawer-btn ghost"
                onClick={() => { setPendingRelax(false); setAck(false); }}
              >
                Keep Enforced
              </button>
              <button
                type="button"
                className="acp-relax-btn"
                disabled={!ack}
                onClick={() => applyMode("RELAXED")}
              >
                Set to Relaxed
              </button>
            </div>
          </div>
        )}

        {/* ── Change history ────────────────────────────────────────────── */}
        <div className="ru-section-hdr" style={{ marginTop: 26 }}>
          <span className="ru-section-title">Change history</span>
          <span className="ru-section-cnt">{log.length}</span>
        </div>
        <div className="acp-log">
          {log.map((e, i) => (
            <div key={i} className="acp-log-row">
              <span className="acp-log-dot" />
              <div className="acp-log-body">
                <div className="acp-log-line">
                  {e.from ? (
                    <>
                      Changed from <span className="acp-log-mode">{MODES[e.from].label}</span> to{" "}
                      <span className={`acp-log-mode${e.to === "RELAXED" ? " warn" : ""}`}>{MODES[e.to].label}</span>
                    </>
                  ) : (
                    <>Set to <span className="acp-log-mode">{MODES[e.to].label}</span> at provisioning</>
                  )}
                </div>
                <div className="acp-log-meta">{e.by} · {fmtDate(e.ts)}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {toast && <div className="toast show">{toast}</div>}
    </div>
  );
}
