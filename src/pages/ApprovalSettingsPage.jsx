import { useMemo, useRef, useState } from "react";
import {
  ADD_RULES, MAX_APPROVALS, approverSeats, bandCeiling, defaultPolicy,
  policyGaps, requiredApprovals,
} from "../lib/approvalPolicy";
import { formatRupiahExact } from "../lib/format";
import "./modules.css";
import "./invoices-ledger.css";
import "./settings-pages.css";
import "./approval-settings.css";

// Settings → Access → Approval.
//
// The policy that decides how many people must approve a payment before the
// money can leave, and who those people can be. It sits next to Access policy
// because it is the same kind of object: a control the entity configures once
// and the payment flow then obeys, not a per-transaction choice.
//
// The page is built around one idea — the requirement is DERIVED, so the page
// has to show the derivation. That is what the simulator at the bottom is for:
// a rule you cannot test against a number is a rule nobody trusts.
//
// Prototype: local state, no backend. Nothing here drives the Payment page
// yet; `lib/approvalPolicy.js` is the shared engine both will read.

const APPROVAL_CHOICES = [0, 1, 2];
const DELEGATE_CANDIDATES = ["Lutfi Hakim", "Andi Wijaya", "Putri Handayani"];

const fmt = (n) => formatRupiahExact(n);
const digits = (s) => Number(String(s).replace(/[^\d]/g, "")) || 0;

function bandLabel(bands, i) {
  const ceiling = bandCeiling(bands, i);
  if (i === 0) return `Up to ${fmt(ceiling)}`;
  if (ceiling == null) return `Above ${fmt(bands[i].from)}`;
  return `${fmt(bands[i].from)} – ${fmt(ceiling)}`;
}

export default function ApprovalSettingsPage() {
  const [policy, setPolicy] = useState(defaultPolicy);
  const [seats, setSeats] = useState(approverSeats);
  const [delegation, setDelegation] = useState({ on: false, from: "Sari Dewanti", to: "Lutfi Hakim", until: "2026-10-10" });
  const [toast, setToast] = useState("");
  const toastTmr = useRef(null);
  const [log, setLog] = useState([
    { ts: "2026-01-08T09:20:00", by: "Andi Wijaya (Admin)", text: "Approval policy created — 3 bands, 2 add-rules" },
  ]);

  function showToast(msg) {
    setToast(msg);
    if (toastTmr.current) clearTimeout(toastTmr.current);
    toastTmr.current = setTimeout(() => setToast(""), 2200);
  }
  function record(text) {
    setLog((prev) => [{ ts: new Date().toISOString(), by: "Andi Wijaya (Admin)", text }, ...prev]);
  }

  const gaps = useMemo(() => policyGaps(policy, seats), [policy, seats]);

  // ── Band edits ───────────────────────────────────────────────────────────
  // Bands are contiguous by construction: a band has a floor and inherits its
  // ceiling from the next band's floor. There is no way to leave a gap or an
  // overlap, because there is nothing to type that would create one.
  function setBandFloor(id, from) {
    setPolicy((p) => ({
      ...p,
      bands: p.bands.map((b) => (b.id === id ? { ...b, from } : b)).sort((a, b) => a.from - b.from),
    }));
  }
  function setBandApprovals(id, approvals) {
    setPolicy((p) => ({ ...p, bands: p.bands.map((b) => (b.id === id ? { ...b, approvals } : b)) }));
    record(`Band approvals changed to ${approvals}`);
  }
  function addBand() {
    const top = policy.bands[policy.bands.length - 1];
    const id = `b${Date.now().toString(36)}`;
    setPolicy((p) => ({
      ...p,
      bands: [...p.bands, { id, from: top.from * 2, approvals: Math.min(top.approvals + 1, MAX_APPROVALS) }],
    }));
    record("Band added");
  }
  function dropBand(id) {
    if (policy.bands.length <= 2) { showToast("A policy needs at least two bands"); return; }
    setPolicy((p) => ({ ...p, bands: p.bands.filter((b) => b.id !== id) }));
    record("Band removed");
  }

  function toggleRule(key) {
    setPolicy((p) => {
      const next = !p.rules[key];
      record(`Rule "${ADD_RULES.find((r) => r.key === key).label}" turned ${next ? "on" : "off"}`);
      return { ...p, rules: { ...p.rules, [key]: next } };
    });
  }

  function setSeatLimit(id, limit) {
    setSeats((prev) => prev.map((s) => (s.id === id ? { ...s, limit } : s)));
  }

  return (
    <div className="lg-page">
      <div className="lg-scroll-container">
        <div className="lg-head">
          <div className="lg-head-top">
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1 className="lg-title">Approval</h1>
              <p className="settings-sub">
                How many people must approve a payment before the money leaves, and who those people can
                be. The requirement is worked out per payment rather than fixed as a ladder, so a small
                recurring bill and a Rp 2 miliar transfer do not cost the same attention.
              </p>
            </div>
          </div>
        </div>

        <div className="apv-principle">
          <span className="apv-principle-k">Rules only ever add approvals.</span>
          <span>
            Nothing here can lower the number a band asks for, so the requirement on any payment reads as
            a sentence you can check — base, then each rule that raised it. The total is capped at{" "}
            <strong>{MAX_APPROVALS}</strong>.
          </span>
        </div>

        {/* ── Bands ──────────────────────────────────────────────────────── */}
        <section className="apv-sec">
          <div className="apv-sec-head">
            <div>
              <h2 className="apv-sec-title">Amount bands</h2>
              <p className="apv-sec-sub">
                The base requirement, read off the amount of the <em>payment</em> — not the bill. A bill
                paid in instalments crosses a band in slices, so reading the band off the bill total would
                let four payments of Rp 200 jt clear a threshold one payment of Rp 800 jt could not.
              </p>
            </div>
          </div>

          <div className="apv-band-table">
            <div className="apv-band-row head">
              <div>Payment amount</div>
              <div>Band starts at</div>
              <div>Approvals required</div>
              <div />
            </div>
            {policy.bands.map((b, i) => (
              <div className="apv-band-row" key={b.id}>
                <div className="apv-band-label">{bandLabel(policy.bands, i)}</div>
                <div>
                  {i === 0 ? (
                    <span className="apv-band-fixed">Rp 0</span>
                  ) : (
                    <span className="apv-band-input">
                      <span className="apv-band-prefix">Rp</span>
                      <input
                        inputMode="numeric"
                        value={b.from.toLocaleString("id-ID")}
                        onChange={(e) => setBandFloor(b.id, digits(e.target.value))}
                      />
                    </span>
                  )}
                </div>
                <div className="apv-band-choices">
                  {APPROVAL_CHOICES.map((n) => (
                    <button
                      key={n}
                      type="button"
                      className={`apv-choice${b.approvals === n ? " on" : ""}`}
                      onClick={() => setBandApprovals(b.id, n)}
                    >
                      {n === 0 ? "None" : n}
                    </button>
                  ))}
                </div>
                <div className="apv-band-act">
                  {policy.bands.length > 2 && (
                    <button type="button" className="apv-x" onClick={() => dropBand(b.id)} aria-label="Remove band">×</button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <button type="button" className="apv-add" onClick={addBand}>+ Add a band</button>

          {policy.bands[0].approvals === 0 && (
            <p className="apv-note">
              The lowest band asks for no approval. That is a policy choice, not a hole: the person who
              requests a payment is never the person who executes it, so two people still touch every
              payment. What it buys is that the Finance Manager&rsquo;s attention is spent where it
              changes an outcome.
            </p>
          )}
        </section>

        {/* ── Rules ──────────────────────────────────────────────────────── */}
        <section className="apv-sec">
          <div className="apv-sec-head">
            <div>
              <h2 className="apv-sec-title">Rules that add an approver</h2>
              <p className="apv-sec-sub">
                Conditions that raise the requirement above the band. Every one of these is a fact Klay
                already establishes at release time — this reads the same evidence the payment checks do,
                rather than asking for anything new.
              </p>
            </div>
          </div>

          <div className="apv-rules">
            {ADD_RULES.map((r) => {
              const on = !!policy.rules[r.key];
              return (
                <div className={`apv-rule${on ? " on" : ""}`} key={r.key}>
                  <div className="apv-rule-body">
                    <div className="apv-rule-top">
                      <span className="apv-rule-label">{r.label}</span>
                      <span className="apv-rule-delta">+1</span>
                    </div>
                    <div className="apv-rule-hint">{r.hint}</div>
                    <div className="apv-rule-why">{r.why}</div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={on}
                    aria-label={r.label}
                    className={`pp-switch${on ? " on" : ""}`}
                    onClick={() => toggleRule(r.key)}
                  >
                    <span className="pp-switch-knob" />
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        {/* ── Seats ──────────────────────────────────────────────────────── */}
        <section className="apv-sec">
          <div className="apv-sec-head">
            <div>
              <h2 className="apv-sec-title">Who can approve</h2>
              <p className="apv-sec-sub">
                Everyone holding <code className="apv-cap">payment.approve</code>, and the ceiling on what
                each may authorise. A band says how many signatures; a limit says whose signature counts —
                two approvals from two people who each stop at Rp 100 jt do not release Rp 2 miliar.
              </p>
            </div>
          </div>

          <div className="apv-seats">
            {seats.map((s) => (
              <div className="apv-seat" key={s.id}>
                <div className="apv-seat-who">
                  <span className="apv-seat-name">{s.name}</span>
                  <span className="apv-seat-role">{s.roleLabel}</span>
                </div>
                <div className="apv-seat-limit">
                  <span className="apv-seat-limit-lbl">Approves up to</span>
                  {s.limit == null ? (
                    <span className="apv-seat-nolimit">No ceiling</span>
                  ) : (
                    <span className="apv-band-input">
                      <span className="apv-band-prefix">Rp</span>
                      <input
                        inputMode="numeric"
                        value={s.limit.toLocaleString("id-ID")}
                        onChange={(e) => setSeatLimit(s.id, digits(e.target.value))}
                      />
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {gaps.length > 0 && (
            <div className="apv-gaps">
              <div className="apv-gaps-head">This policy cannot be satisfied as configured</div>
              {gaps.map((g) => <div className="apv-gap" key={g.key}>{g.text}</div>)}
              <div className="apv-gaps-foot">
                Saving an unreachable rule is worse than refusing it — the failure would surface at the
                moment somebody is trying to pay a vendor. Add a second approver seat in{" "}
                <strong>Settings → Access → Users</strong>, or lower the top band.
              </div>
            </div>
          )}
        </section>

        {/* ── Simulator ──────────────────────────────────────────────────── */}
        <Simulator policy={policy} seats={seats} />

        {/* ── Delegation ─────────────────────────────────────────────────── */}
        <section className="apv-sec">
          <div className="apv-sec-head">
            <div>
              <h2 className="apv-sec-title">Delegation</h2>
              <p className="apv-sec-sub">
                With one person holding the approval, a week of leave stops AP. A delegation carries the
                capability, not the accountability — the audit trail records who approved and on whose
                behalf.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={delegation.on}
              aria-label="Delegation"
              className={`pp-switch${delegation.on ? " on" : ""}`}
              onClick={() => {
                const next = !delegation.on;
                setDelegation((d) => ({ ...d, on: next }));
                record(`Delegation turned ${next ? "on" : "off"}`);
              }}
            />
          </div>

          <div className={`apv-deleg${delegation.on ? "" : " off"}`}>
            <div className="apv-deleg-row">
              <span>Approvals for</span>
              <strong>{delegation.from}</strong>
              <span>go to</span>
              <select
                className="apv-select"
                value={delegation.to}
                disabled={!delegation.on}
                onChange={(e) => setDelegation((d) => ({ ...d, to: e.target.value }))}
              >
                {DELEGATE_CANDIDATES.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
              <span>until</span>
              <input
                type="date"
                className="apv-date"
                value={delegation.until}
                disabled={!delegation.on}
                onChange={(e) => setDelegation((d) => ({ ...d, until: e.target.value }))}
              />
            </div>
            <div className="apv-deleg-note">
              An expiry is required. A delegation without one becomes a permanent second key that nobody
              remembers granting.
            </div>
          </div>
        </section>

        {/* ── Log ────────────────────────────────────────────────────────── */}
        <section className="apv-sec">
          <div className="apv-sec-head">
            <div>
              <h2 className="apv-sec-title">Change history</h2>
              <p className="apv-sec-sub">
                Who loosened what, and when. Approval policy is the control auditors test first, so every
                change to it is an event in its own right.
              </p>
            </div>
          </div>
          <div className="apv-log">
            {log.map((e, i) => (
              <div className="apv-log-row" key={i}>
                <span className="apv-log-ts">
                  {new Date(e.ts).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                </span>
                <span className="apv-log-text">{e.text}</span>
                <span className="apv-log-by">{e.by}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      {toast && <div className="apv-toast">{toast}</div>}
    </div>
  );
}

// ── Simulator ──────────────────────────────────────────────────────────────
// The part that makes the orchestrator trustworthy. A derived requirement is
// only better than a fixed ladder if you can see the derivation, so this runs
// the real engine — the same `requiredApprovals` the payment flow will call —
// against a number you choose, and prints the arithmetic.
function Simulator({ policy, seats }) {
  const [amount, setAmount] = useState(750000000);
  const [ctx, setCtx] = useState({ bankChanged: false, firstPayment: false, giro: false, runTotal: false });

  const payment = {
    amount,
    bankChangedDays: ctx.bankChanged ? 6 : null,
    isFirstPayment: ctx.firstPayment,
    method: ctx.giro ? "giro" : "bank",
    vendorRunTotal: ctx.runTotal ? amount * 3 : amount,
  };
  const result = requiredApprovals(payment, policy);

  // Which seats could actually sign this one. Ordered by limit so the chain
  // reads the way it is walked: the cheapest sufficient approver first.
  const eligible = seats
    .filter((s) => s.limit == null || s.limit >= amount)
    .sort((a, b) => (a.limit == null ? Infinity : a.limit) - (b.limit == null ? Infinity : b.limit));
  const short = result.count > eligible.length;

  const toggle = (k) => setCtx((c) => ({ ...c, [k]: !c[k] }));

  return (
    <section className="apv-sec apv-sim">
      <div className="apv-sec-head">
        <div>
          <h2 className="apv-sec-title">Try a payment</h2>
          <p className="apv-sec-sub">
            Runs the policy against a number. This is the same evaluation the Payment page will make, so
            what it prints here is what an approver will be told there.
          </p>
        </div>
      </div>

      <div className="apv-sim-grid">
        <div className="apv-sim-input">
          <label className="apv-sim-lbl">Payment amount</label>
          <span className="apv-band-input big">
            <span className="apv-band-prefix">Rp</span>
            <input
              inputMode="numeric"
              value={amount.toLocaleString("id-ID")}
              onChange={(e) => setAmount(digits(e.target.value))}
            />
          </span>

          <label className="apv-sim-lbl">Conditions</label>
          <div className="apv-sim-conds">
            {[
              ["bankChanged", "Bank account changed 6 days ago"],
              ["runTotal", "Part of a larger run to this vendor"],
              ["firstPayment", "First payment to this vendor"],
              ["giro", "Paid by giro"],
            ].map(([k, lbl]) => (
              <button
                key={k}
                type="button"
                className={`apv-cond${ctx[k] ? " on" : ""}`}
                onClick={() => toggle(k)}
              >
                {lbl}
              </button>
            ))}
          </div>
        </div>

        <div className="apv-sim-out">
          <div className="apv-sim-count">
            <span className="apv-sim-count-n">{result.count}</span>
            <span className="apv-sim-count-lbl">
              {result.count === 0 ? "approvals — released on request" : result.count === 1 ? "approval required" : "approvals required"}
            </span>
          </div>

          <div className="apv-sim-reasons">
            {result.reasons.map((r, i) => (
              <div className={`apv-sim-reason${r.delta > 0 && i > 0 ? " add" : ""}`} key={i}>
                {r.text}
              </div>
            ))}
            {result.capped && (
              <div className="apv-sim-reason cap">
                {result.uncapped} would be required — capped at {MAX_APPROVALS}.
              </div>
            )}
          </div>

          <div className="apv-sim-chain">
            <div className="apv-sim-chain-lbl">Goes to</div>
            {result.count === 0 ? (
              <div className="apv-sim-chain-none">Nobody — the request releases it.</div>
            ) : short ? (
              <div className="apv-sim-chain-short">
                {eligible.length === 0
                  ? `No approver's limit covers ${fmt(amount)}.`
                  : `Only ${eligible.length} approver can cover ${fmt(amount)}; ${result.count} are required.`}{" "}
                This payment would be stuck.
              </div>
            ) : (
              <div className="apv-sim-chain-list">
                {eligible.slice(0, result.count).map((s, i) => (
                  <span className="apv-sim-chain-step" key={s.id}>
                    {i > 0 && <span className="apv-sim-arrow">→</span>}
                    <span className="apv-sim-person">
                      {s.name}
                      <span className="apv-sim-person-lim">
                        {s.limit == null ? "no ceiling" : `up to ${fmt(s.limit)}`}
                      </span>
                    </span>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
