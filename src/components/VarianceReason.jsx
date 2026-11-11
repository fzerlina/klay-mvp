// The reason part of a variance review — shared by the Profit & Loss pill
// popover and the Trial Balance review popover, so both behave the same:
// a reason is required to mark reviewed; once reviewed it shows the reason,
// who and when, with Edit reason and Reopen. A review that no longer covers
// the amount ("changed") opens straight into the form with the old reason.

import { useState } from "react";
import "./variance-reason.css";

export const shortDate = (iso) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "");
const rp = (v) => `Rp ${Math.abs(v || 0).toLocaleString("id-ID")}`;

export default function VarianceReason({ review, status, onSave, onReopen }) {
  const [note, setNote] = useState(review?.note || "");
  const [err, setErr] = useState("");
  const [editing, setEditing] = useState(status !== "reviewed");
  const save = () => {
    if (!note.trim()) { setErr("Add a short reason first."); return; }
    onSave(note.trim());
    setEditing(false);
  };
  return (
    <div className="vr">
      {status === "changed" && (
        <div className="vr-changed">
          Changed since review — it was {rp(review.amount)} when {review.by} reviewed it on {shortDate(review.at)}. Check the new amount and update the reason.
        </div>
      )}
      {editing ? (
        <div className="vr-form">
          <textarea rows={3} value={note} placeholder="Why did it move? e.g. Q2 launch campaign, approved in the March budget"
            onChange={(e) => { setNote(e.target.value); if (err) setErr(""); }} aria-label="Reason for the variance" />
          {err && <div className="vr-err">{err}</div>}
          <div className="vr-actions">
            <button type="button" className="lg-btn-brand vr-save" onClick={save}>{review ? "Save and mark reviewed" : "Mark reviewed"}</button>
            {status === "reviewed" && <button type="button" className="lg-btn-ghost" onClick={() => { setNote(review.note); setEditing(false); }}>Cancel</button>}
          </div>
        </div>
      ) : (
        <div className="vr-note">
          <div className="vr-note-text">“{review.note}”</div>
          <div className="vr-note-meta">{review.by} · {shortDate(review.at)}</div>
          <div className="vr-actions">
            <button type="button" className="lg-btn-ghost" onClick={() => setEditing(true)}>Edit reason</button>
            <button type="button" className="lg-btn-ghost" onClick={onReopen}>Reopen</button>
          </div>
        </div>
      )}
    </div>
  );
}
