import { parseDate } from "./clock";

const DASH = "—";

// Money in Indonesian Rupiah. Empty / zero values render as an em-dash.
// Negatives pass through naturally ("-Rp" via locale grouping).
export function formatRupiah(n) {
  if (n == null || n === 0) return DASH;
  return "Rp " + n.toLocaleString("id-ID");
}

// Plain number with id-ID grouping (1.500.000). Empty / zero → em-dash.
export function formatNumber(n) {
  if (n == null || n === 0) return DASH;
  return n.toLocaleString("id-ID");
}

// "15 Apr 2025" — uses Indonesian short month names from the locale
// (Jan/Feb/Mar/Apr/Mei/Jun/Jul/Agu/Sep/Okt/Nov/Des).
export function formatDate(input) {
  const date = parseDate(input);
  if (!date) return DASH;
  return date.toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// "15 Apr 2025" — English short month names. Use on surfaces that prefer
// English over the Indonesian locale's (Mei/Agu/Okt/Des). Bills List and
// Bill Detail both surface English dates so the same demo reads cleanly
// alongside English UI strings.
const MONTHS_EN_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function formatDateEn(input) {
  if (!input) return DASH;
  const d = new Date(input);
  if (isNaN(d.getTime())) return DASH;
  return `${d.getDate()} ${MONTHS_EN_SHORT[d.getMonth()]} ${d.getFullYear()}`;
}

// Payment terms in plain language — "NET 30" → "30 days", "NET 0" → "Due on
// receipt". Accepts the stored "NET n" form or a bare number; unknown strings
// pass through unchanged.
export function termLabel(term) {
  if (term == null || term === "") return DASH;
  const s = String(term).trim();
  const m = s.match(/(\d+)/);
  if (!m) return s;
  const n = parseInt(m[1], 10);
  if (n === 0) return "Due on receipt";
  return `${n} days`;
}

export function initials(name) {
  if (!name) return "";
  return name.trim().split(/\s+/).map((w) => w[0] || "").join("").slice(0, 2).toUpperCase();
}

export { TODAY, daysSince } from "./clock";
