// Generate master vendors/customers + transactional bills/invoices.
// Run via:
//
//     node scripts/generate-master-data.mjs
//
// Deterministic from seed 20250424. Re-runs produce the same data so the
// demo stays stable across reloads. Re-run after changing the new-record
// counts at the top, or after the new CoA changes (so generated bill line
// items pick valid account codes).
//
// Strategy:
// - Keeps the first 10 vendors / 6 customers / 8 bills / 8 invoices as-is
//   so the JE generator's bill/invoice-anchored entries (BILL001..008 and
//   INV001..008) keep resolving in the GL drawer.
// - Generates the remainder synthetically: V011..V080, C007..C070,
//   BILL009..200, INV009..200.
// - Customer.ar / totalInv and vendor.lastTx are recomputed from the
//   generated bills/invoices so the dashboards stay coherent.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { COA_BY_CODE } from "../src/data/seed/coa.js";
import { VENDORS } from "../src/data/seed/vendors.js";
import { CUSTOMERS } from "../src/data/seed/customers.js";
import { BILLS } from "../src/data/seed/bills.js";
import { INVOICES } from "../src/data/seed/invoices.js";
import { deriveBillDetailFields } from "./bill-detail-fields.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ── Targets ───────────────────────────────────────────────────────────────
const TARGET_VENDORS   = 80;
const TARGET_CUSTOMERS = 70;
const TARGET_BILLS     = 200;
const TARGET_INVOICES  = 200;

// ── Deterministic PRNG (mulberry32) ──────────────────────────────────────
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = makeRng(20250424);
const pick = (arr) => arr[Math.floor(rng() * arr.length)];
const between = (min, max) => Math.floor(rng() * (max - min + 1)) + min;
const moneyBetween = (min, max, step = 50000) =>
  Math.round(between(min, max) / step) * step;
const chance = (p) => rng() < p;

// ── Indonesian name pools ────────────────────────────────────────────────
const PT_PREFIXES = ["PT", "CV", "UD", "Toko", "Koperasi"];
const COMPANY_QUALIFIERS = [
  "Sejahtera", "Makmur", "Jaya", "Abadi", "Sentosa", "Mandiri", "Lestari",
  "Bersama", "Pratama", "Utama", "Sukses", "Berkah", "Karya", "Cipta",
  "Surya", "Bintang", "Mas", "Permata", "Indah", "Agung", "Sumber",
  "Gemilang", "Sahabat", "Mulia", "Harapan", "Mekar", "Tunas", "Kencana",
];
const COMPANY_INDUSTRIES = [
  "Elektronik", "Bangunan", "Logistik", "Teknologi", "Asuransi", "Kemasan",
  "Percetakan", "Konsultasi", "Sembako", "Otomotif", "Tekstil", "Furnitur",
  "Pangan", "Pertanian", "Energi", "Konstruksi", "Perdagangan", "Distribusi",
  "Niaga", "Manufaktur", "Industri", "Solusi", "Layanan", "Mitra", "Karya",
];
const FIRST_NAMES = [
  "Sarah", "Budi", "Andi", "Rina", "Suko", "Bambang", "Endra", "Dewi",
  "Fajar", "Iwan", "Janti", "Karyo", "Lina", "Rizky", "Tomi", "Wati",
  "Zaenal", "Aditya", "Citra", "Eko", "Fitri", "Gunawan", "Hadi", "Indra",
  "Joko", "Kartika", "Linda", "Mega", "Nurul", "Oki", "Putra", "Reza",
  "Sinta", "Tania", "Umar", "Vina", "Yudi", "Agus", "Dian", "Hendra",
  "Maya", "Nisa", "Pandu", "Ratna", "Surya", "Tegar", "Yanti", "Anto",
];
const LAST_NAMES = [
  "Wijaya", "Santoso", "Prasetyo", "Kusuma", "Lestari", "Pratama",
  "Nugroho", "Susanto", "Hermawan", "Kumala", "Mujib", "Pratiwi", "Saputra",
  "Mahendra", "Cahyono", "Setiawan", "Halim", "Hartono", "Purnomo", "Tanoto",
  "Salim", "Tan", "Wibowo", "Iskandar", "Sudirman", "Rahmawati", "Suryanto",
];
const CITIES = [
  "Jakarta", "Bandung", "Surabaya", "Medan", "Yogyakarta", "Semarang",
  "Denpasar", "Makassar", "Palembang", "Pekanbaru", "Bogor", "Tangerang",
  "Bekasi", "Depok", "Malang", "Solo", "Cirebon", "Padang", "Manado",
  "Banjarmasin", "Balikpapan", "Pontianak", "Batam", "Lampung", "Mataram",
];
const STREETS = [
  "Jl. Sudirman", "Jl. Gatot Subroto", "Jl. Diponegoro", "Jl. Ahmad Yani",
  "Jl. MH Thamrin", "Jl. Cihampelas", "Jl. Asia Afrika", "Jl. Pemuda",
  "Jl. Pahlawan", "Jl. Veteran", "Jl. Imam Bonjol", "Jl. Hayam Wuruk",
  "Jl. Mangga Dua", "Jl. Pasar Baru", "Jl. Senayan", "Jl. Kuningan",
  "Jl. Wahid Hasyim", "Jl. Soekarno Hatta", "Jl. Magelang", "Jl. Solo",
];
const BANKS = ["BCA", "Mandiri", "BNI", "BRI", "CIMB Niaga", "Permata", "OCBC NISP", "Danamon"];

const VENDOR_CATEGORIES = ["inventory", "service", "expense", "expense", "inventory"];
const VENDOR_DEFAULT_ACCT = {
  inventory: "1-3100",
  service:   "6-2700",
  expense:   "6-2300",
};
const VENDOR_PPH = { inventory: "none", expense: "none", service: "pph23_2" };
const PAYMENT_TERMS = ["NET 7", "NET 14", "NET 15", "NET 30", "NET 45", "NET 60"];

// ── Helpers ──────────────────────────────────────────────────────────────
function initials(name) {
  return name.replace(/^(PT|CV|UD|Toko|Koperasi)\s+/i, "").trim().split(/\s+/)
    .map((w) => w[0] || "").join("").slice(0, 2).toUpperCase();
}
function fakeNpwp() {
  const seg = (n) => String(between(0, 10 ** n - 1)).padStart(n, "0");
  return `${seg(2)}.${seg(3)}.${seg(3)}.${seg(1)}-${seg(3)}.${seg(3)}`;
}
function fakePhoneJakarta() {
  return `+62-21-${between(2000, 9999)}-${between(1000, 9999)}`;
}
function fakePhoneCellular() {
  return `+62-${pick(["812","813","815","817","819","821","822","851","857","858"])}-${between(1000, 9999)}-${between(1000, 9999)}`;
}
function fakeBankAccount() {
  return `${between(100, 999)}-${between(100, 999)}-${between(1000, 9999)}`;
}
function fakeAddress(city) {
  return `${pick(STREETS)} No. ${between(1, 250)}, ${city} ${between(10000, 80000)}`;
}
function fakeCompanyName() {
  return `${pick(PT_PREFIXES)} ${pick(COMPANY_QUALIFIERS)} ${pick(COMPANY_INDUSTRIES)}`;
}
function fakePersonName() {
  return `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
}
function offsetDays(isoDate, days) {
  const d = new Date(isoDate + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
// Audit dates stored as ISO so they round-trip cleanly. The bills/invoices
// pages render them via formatDate at display time.
function emailFromCompany(name) {
  const slug = name.replace(/^(PT|CV|UD|Toko|Koperasi)\s+/i, "").trim()
    .toLowerCase().replace(/\s+/g, "").replace(/[^a-z]/g, "").slice(0, 18);
  return `info@${slug}.id`;
}
function emailFromPerson(name) {
  const parts = name.toLowerCase().split(/\s+/);
  return `${parts[0]}.${parts[parts.length - 1]}@gmail.com`;
}

// ── Vendor generator ─────────────────────────────────────────────────────
function makeVendor(idx) {
  const id = `V${String(idx).padStart(3, "0")}`;
  const code = `V-${String(idx).padStart(3, "0")}`;
  const category = pick(VENDOR_CATEGORIES);
  const isCoop = chance(0.05);
  const isIndividual = chance(0.06);
  const type = isCoop ? "cooperative" : isIndividual ? "individual" : "company";
  const name = isIndividual
    ? `UD ${fakePersonName()}`
    : isCoop
    ? `Koperasi ${pick(COMPANY_QUALIFIERS)} ${pick(COMPANY_INDUSTRIES)}`
    : fakeCompanyName();
  const isPkp = !isCoop && !isIndividual && chance(0.85);
  const contact = fakePersonName();
  const city = pick(CITIES);
  const status = chance(0.9) ? "active" : "inactive";
  const lastTxDays = status === "active" ? between(0, 110) : between(120, 220);
  const lastTx = offsetDays("2025-04-23", -lastTxDays);
  const bank = pick(BANKS);
  return {
    id, code, name, initials: initials(name),
    contact,
    phone: chance(0.5) ? fakePhoneJakarta() : fakePhoneCellular(),
    email: emailFromCompany(name),
    address: fakeAddress(city),
    tax_id: isPkp ? fakeNpwp() : "",
    payment_terms: pick(PAYMENT_TERMS),
    pkp: isPkp ? "PKP" : "NON_PKP",
    pph: VENDOR_PPH[category] || "none",
    category, type, status,
    lastTx,
    notes: pick([
      "Vendor utama untuk kebutuhan operasional rutin.",
      "Hubungan kerja sama jangka panjang.",
      "Min. order Rp 5 jt untuk pengiriman gratis.",
      "Kontrak per proyek.",
      "Coverage Jabodetabek dan kota besar.",
      "MOQ 1000 unit untuk produk tertentu.",
    ]),
    acct: VENDOR_DEFAULT_ACCT[category] || "6-2300",
    defTax: isPkp ? "ppn_masukan" : "bebas",
    banks: [{
      name: bank, branch: `KCU ${city}`,
      acc: fakeBankAccount(),
      holder: name,
      isDefault: true,
    }],
  };
}

// ── Customer generator ───────────────────────────────────────────────────
function makeCustomer(idx) {
  const id = `C${String(idx).padStart(3, "0")}`;
  const code = `C-${String(idx).padStart(3, "0")}`;
  const isIndividual = chance(0.35);
  const type = isIndividual ? "individu" : "perusahaan";
  const name = isIndividual ? fakePersonName() : fakeCompanyName();
  const legalName = isIndividual ? "" : name;
  const npwp = isIndividual ? "" : (chance(0.85) ? fakeNpwp() : "");
  const top = isIndividual ? pick(["COD", "NET 7", "NET 14"]) : pick(PAYMENT_TERMS);
  const creditLimit = isIndividual
    ? (chance(0.5) ? 0 : moneyBetween(5000000, 25000000, 1000000))
    : moneyBetween(50000000, 500000000, 10000000);
  const contact = isIndividual ? name : fakePersonName();
  const contactTitle = isIndividual
    ? "—"
    : pick(["Finance Manager", "Direktur", "Procurement", "VP Finance", "Pemilik", "Owner", "Account Manager"]);
  const city = pick(CITIES);
  const active = chance(0.92);
  return {
    id, code, type,
    name, legalName,
    npwp,
    top, creditLimit,
    contacts: [{
      name: contact, title: contactTitle,
      phone: chance(0.5) ? fakePhoneJakarta() : fakePhoneCellular(),
      email: isIndividual ? emailFromPerson(name) : `${contact.toLowerCase().split(" ")[0]}@${name.replace(/^(PT|CV|UD|Toko|Koperasi)\s+/i, "").toLowerCase().replace(/\s+/g, "").replace(/[^a-z]/g, "").slice(0, 14)}.id`,
      emailFin: !isIndividual && chance(0.4)
        ? `finance@${name.replace(/^(PT|CV|UD|Toko|Koperasi)\s+/i, "").toLowerCase().replace(/\s+/g, "").replace(/[^a-z]/g, "").slice(0, 14)}.id`
        : "",
      primary: true,
    }],
    address: fakeAddress(city),
    invMode: chance(0.55) ? "auto" : "manual",
    invCh: chance(0.6) ? ["Email"] : (chance(0.5) ? ["Email", "WhatsApp"] : []),
    // ar / arOverdue / lastInv / totalInv get filled in after invoices generated
    ar: 0, arOverdue: false, lastInv: null, totalInv: 0,
    active,
  };
}

// ── Build vendor / customer lists ────────────────────────────────────────
const vendors  = [...VENDORS];
for (let i = vendors.length + 1; i <= TARGET_VENDORS; i++) vendors.push(makeVendor(i));

const customers = [...CUSTOMERS];
for (let i = customers.length + 1; i <= TARGET_CUSTOMERS; i++) customers.push(makeCustomer(i));

console.log(`Vendors:   ${vendors.length} (${vendors.length - VENDORS.length} new)`);
console.log(`Customers: ${customers.length} (${customers.length - CUSTOMERS.length} new)`);

// ── Bill generator ───────────────────────────────────────────────────────
const PRODUCT_LINES = [
  { acct: "1-3100", name: "Raw Materials", desc: ["Komponen elektronik", "Bahan baku tekstil", "Material kemasan", "Bahan baku produksi", "Komponen kayu olahan"] },
  { acct: "1-6300", name: "Office Equipment", desc: ["Furnitur kantor", "Komputer & peripheral", "Printer & scanner", "Telepon kantor", "AC & pendingin ruangan"] },
  { acct: "6-3100", name: "Postage & Courier", desc: ["Jasa kurir bulanan", "Pengiriman dokumen", "Logistik regional", "Ekspedisi paket"] },
  { acct: "6-2700", name: "Professional Services", desc: ["Konsultasi pajak", "Audit keuangan", "Konsultasi strategis", "Jasa hukum", "Pendampingan proses bisnis"] },
  { acct: "6-2600", name: "Software Subscriptions", desc: ["Lisensi software tahunan", "Subscription SaaS", "Cloud hosting", "Tools developer"] },
  { acct: "6-3200", name: "Repairs & Maintenance", desc: ["Servis kendaraan", "Maintenance kantor", "Perbaikan AC", "Renovasi ruangan"] },
  { acct: "6-2300", name: "Office Rent", desc: ["Sewa ruang kantor", "Biaya sewa cabang", "Sewa gudang"] },
  { acct: "6-2400", name: "Office Utilities", desc: ["Tagihan listrik", "Tagihan air", "Internet kantor"] },
  { acct: "6-2500", name: "Office Supplies", desc: ["ATK kantor bulanan", "Tinta & kertas", "Peralatan tulis"] },
  { acct: "6-1200", name: "Marketing & Advertising", desc: ["Iklan digital", "Brosur & banner", "Endorsement", "Event marketing"] },
];

function vendorAcctChoices(vendor) {
  if (vendor.category === "inventory") {
    return PRODUCT_LINES.filter((p) => p.acct === "1-3100" || p.acct === "1-6300");
  }
  if (vendor.category === "service") {
    return PRODUCT_LINES.filter((p) => p.acct === "6-2700" || p.acct === "6-2600" || p.acct === "6-3100" || p.acct === "6-3200");
  }
  // expense — wider mix
  return PRODUCT_LINES.filter((p) => p.acct.startsWith("6-"));
}

function makeBill(idx) {
  const id = `BILL${String(idx).padStart(3, "0")}`;
  const vendor = pick(vendors.filter((v) => v.status === "active"));
  const date = pick([
    `2025-01-${String(between(2, 28)).padStart(2, "0")}`,
    `2025-02-${String(between(2, 27)).padStart(2, "0")}`,
    `2025-03-${String(between(2, 30)).padStart(2, "0")}`,
    `2025-04-${String(between(1, 22)).padStart(2, "0")}`,
  ]);
  const termsDays = parseInt(vendor.payment_terms.replace(/\D/g, ""), 10) || 30;
  const due = offsetDays(date, termsDays);
  const isAI = chance(0.04);
  const isDraft = isAI || chance(0.07);
  const today = "2025-04-23";

  // Status mix
  const overdue = !isDraft && due < today && chance(0.6);
  const paid = !isDraft && !overdue && chance(0.65);
  const review = !isDraft && !paid && !overdue && chance(0.25);
  const approval = isDraft ? "draft" : (review ? "review" : "approved");
  const pay = isDraft || review ? "unpaid" : (paid ? "paid" : (overdue ? "overdue" : "unpaid"));
  const grn = isDraft ? "pending" : pick(["matched", "matched", "matched", "pending", "mismatch"]);

  // Items: 1-3 lines drawn from vendor-appropriate accts
  const acctPool = vendorAcctChoices(vendor);
  const itemCount = between(1, 3);
  const items = [];
  let dpp = 0;
  for (let i = 0; i < itemCount; i++) {
    const line = pick(acctPool);
    const qty = chance(0.6) ? between(1, 50) : between(50, 1000);
    const price = chance(0.5) ? moneyBetween(50000, 5000000, 25000) : moneyBetween(2500, 50000, 1000);
    const subtotal = qty * price;
    items.push({
      desc: `${pick(line.desc)} — batch ${between(1, 12)}/2025`,
      qty, price, subtotal,
      acct: line.acct, acctName: line.name,
    });
    dpp += subtotal;
  }
  const pph23 = vendor.pph === "pph23_2" ? Math.round(dpp * 0.02) : 0;
  const total = dpp;
  const sisa = pay === "paid" ? 0 : total;

  const head = {
    id, vendor: vendor.id, vendorName: vendor.name, initials: vendor.initials,
    poNo: isDraft ? "—" : `PO${String(idx).padStart(3, "0")}`,
    invNo: isDraft ? "—" : `INV-${vendor.code.replace("V-", "V")}-${date.replace(/-/g, "")}`,
    date, due, grn,
    dpp, pph23, total, sisa,
    approval, pay, isAI,
    keterangan: chance(0.3) ? pick([
      "Pengadaan kebutuhan operasional rutin.",
      "Pesanan khusus untuk proyek Q1.",
      "Tagihan bulanan sesuai kontrak.",
      "Pembelian sesuai PO yang disetujui.",
      "Restock inventory bulanan.",
    ]) : "",
  };

  return {
    ...head,
    ...deriveBillDetailFields(head, vendor, idx),
    items,
    audit: [{
      type: "created",
      action: isAI ? "Bill dibuat (Draft — OCR AI)" : "Bill dibuat",
      by: isAI ? "System (OCR Auto)" : pick(["Sarah Wijaya", "Andi Prasetyo", "Rina Kusuma"]),
      date: date,
      time: `${String(between(8, 17)).padStart(2, "0")}:${String(between(0, 59)).padStart(2, "0")}`,
    }, ...(approval === "approved" ? [{
      type: "approved", action: "Disetujui", by: "Budi Santoso",
      date: offsetDays(date, between(1, 5)),
      time: `${String(between(9, 16)).padStart(2, "0")}:${String(between(0, 59)).padStart(2, "0")}`,
    }] : [])],
  };
}

// ── Invoice generator ────────────────────────────────────────────────────
const INVOICE_PRODUCTS = [
  { unit: "paket", name: "Produk Divisi A - Paket Retail" },
  { unit: "paket", name: "Produk Divisi A - Paket Premium" },
  { unit: "unit",  name: "Produk Divisi B - Kemasan Standar" },
  { unit: "unit",  name: "Produk Divisi B - Kemasan Premium" },
  { unit: "set",   name: "Furnitur kantor lengkap" },
  { unit: "lot",   name: "Tekstil produksi batch" },
  { unit: "jasa",  name: "Setup & Training" },
  { unit: "jasa",  name: "Konsultasi implementasi" },
  { unit: "kg",    name: "Bahan olahan kemasan" },
  { unit: "unit",  name: "Elektronik produksi line" },
];

function makeInvoice(idx) {
  const id = `INV${String(idx).padStart(3, "0")}`;
  const customer = pick(customers.filter((c) => c.active));
  const date = pick([
    `2025-01-${String(between(2, 28)).padStart(2, "0")}`,
    `2025-02-${String(between(2, 27)).padStart(2, "0")}`,
    `2025-03-${String(between(2, 30)).padStart(2, "0")}`,
    `2025-04-${String(between(1, 22)).padStart(2, "0")}`,
  ]);
  const termsDays = customer.top === "COD" ? 0 : (parseInt(customer.top.replace(/\D/g, ""), 10) || 30);
  const due = offsetDays(date, termsDays);
  const isAI = chance(0.03);
  const isDraft = isAI || chance(0.08);
  const today = "2025-04-23";
  const overdue = !isDraft && due < today && chance(0.55);
  const lunas = !isDraft && !overdue && chance(0.7);
  const approval = isDraft ? "draft" : "terkirim";
  const payStatus = isDraft ? "belumbayar" : (lunas ? "lunas" : (overdue ? "overdue" : "belumbayar"));

  const itemCount = between(1, 3);
  const items = [];
  let dpp = 0;
  for (let i = 0; i < itemCount; i++) {
    const product = pick(INVOICE_PRODUCTS);
    const qty = product.unit === "jasa" ? 1 : between(1, 100);
    const price = product.unit === "jasa"
      ? moneyBetween(2000000, 25000000, 250000)
      : moneyBetween(150000, 5000000, 25000);
    const subtotal = qty * price;
    items.push({
      desc: `${product.name} — ${date.slice(0, 7)}`,
      qty, unit: product.unit, price, subtotal,
    });
    dpp += subtotal;
  }
  const ppn = customer.npwp ? Math.round(dpp * 0.11) : Math.round(dpp * 0.10);
  const total = dpp + ppn;

  return {
    id,
    invNo: isDraft ? "—" : `INV-${customer.code.replace("C-", "C")}-${date.replace(/-/g, "")}`,
    custPO: isDraft ? "—" : `PO-${customer.code.replace("C-", "")}-${String(between(1, 99)).padStart(3, "0")}`,
    customer: customer.id,
    customerName: customer.name,
    custCode: customer.code,
    custEmail: customer.contacts[0]?.email || "",
    date, due,
    dpp, ppn, total,
    approval, payStatus, isAI,
    ...(isAI ? { aiConf: between(82, 96) } : {}),
    items,
    audit: [{
      type: "created",
      action: isAI ? "Invoice dibuat otomatis oleh AI" : "Invoice dibuat",
      by: isAI ? "Klay AI System" : pick(["Sarah Wijaya", "Andi Prasetyo", "Rina Kusuma"]),
      date: date,
      time: `${String(between(8, 17)).padStart(2, "0")}:${String(between(0, 59)).padStart(2, "0")}`,
    }, ...(approval === "terkirim" ? [{
      type: "sent", action: "Invoice dikirim",
      by: pick(["Sarah Wijaya", "Andi Prasetyo"]),
      date: offsetDays(date, between(0, 2)),
      time: `${String(between(9, 16)).padStart(2, "0")}:${String(between(0, 59)).padStart(2, "0")}`,
    }] : []), ...(payStatus === "lunas" ? [{
      type: "paid", action: "Pembayaran diterima",
      by: pick(["Sarah Wijaya", "Andi Prasetyo"]),
      date: offsetDays(due, -between(1, 10)),
      time: `${String(between(9, 16)).padStart(2, "0")}:${String(between(0, 59)).padStart(2, "0")}`,
    }] : [])],
  };
}

// ── Build bill / invoice lists ───────────────────────────────────────────
const bills = [...BILLS];
for (let i = bills.length + 1; i <= TARGET_BILLS; i++) bills.push(makeBill(i));
const invoices = [...INVOICES];
for (let i = invoices.length + 1; i <= TARGET_INVOICES; i++) invoices.push(makeInvoice(i));

console.log(`Bills:     ${bills.length} (${bills.length - BILLS.length} new)`);
console.log(`Invoices:  ${invoices.length} (${invoices.length - INVOICES.length} new)`);

// ── Derive customer.ar / arOverdue / lastInv / totalInv ──────────────────
const today = "2025-04-23";
for (const c of customers) {
  const myInvs = invoices.filter((i) => i.customer === c.id);
  c.totalInv = myInvs.length;
  c.ar = myInvs.filter((i) => i.payStatus !== "lunas" && i.approval !== "draft")
                .reduce((s, i) => s + i.total, 0);
  c.arOverdue = myInvs.some((i) => i.payStatus === "overdue");
  c.lastInv = myInvs.reduce((latest, i) => (i.date > latest ? i.date : latest), "0000-00-00");
  if (c.lastInv === "0000-00-00") c.lastInv = null;
}

// ── Derive vendor.lastTx from generated bills ────────────────────────────
for (const v of vendors) {
  const myBills = bills.filter((b) => b.vendor === v.id);
  if (myBills.length > 0) {
    v.lastTx = myBills.reduce((latest, b) => (b.date > latest ? b.date : latest), "0000-00-00");
  }
  // else: keep the original lastTx from the seed
}

// ── Validation ───────────────────────────────────────────────────────────
const errors = [];
for (const b of bills) {
  if (b.total !== b.dpp) errors.push(`${b.id}: total ${b.total} != dpp ${b.dpp}`);
  if (!vendors.find((v) => v.id === b.vendor)) errors.push(`${b.id}: vendor ${b.vendor} not found`);
  for (const it of b.items) {
    if (!COA_BY_CODE[it.acct]) errors.push(`${b.id}: item acct ${it.acct} not in CoA`);
  }
}
for (const i of invoices) {
  if (i.total !== i.dpp + i.ppn) errors.push(`${i.id}: total ${i.total} != dpp ${i.dpp} + ppn ${i.ppn}`);
  if (!customers.find((c) => c.id === i.customer)) errors.push(`${i.id}: customer ${i.customer} not found`);
}
if (errors.length > 0) {
  console.error("Validation failures:");
  errors.slice(0, 10).forEach((e) => console.error("  " + e));
  if (errors.length > 10) console.error(`  ... and ${errors.length - 10} more`);
  process.exit(1);
}

// ── Write seed files ─────────────────────────────────────────────────────
function writeArrayFile(filename, varName, arr, header) {
  const out = `${header}\nexport const ${varName} = [\n${
    arr.map((r) => "  " + JSON.stringify(r).replace(/"([a-zA-Z_][a-zA-Z0-9_]*)":/g, "$1:")).join(",\n")
  },\n];\n`;
  fs.writeFileSync(path.join(ROOT, "src/data/seed/", filename), out);
}

writeArrayFile(
  "vendors.js", "VENDORS", vendors,
  `// AUTO-GENERATED by scripts/generate-master-data.mjs (deterministic, seed 20250424).\n// Vendor master records — referenced by id from bills.js.`
);
writeArrayFile(
  "customers.js", "CUSTOMERS", customers,
  `// AUTO-GENERATED by scripts/generate-master-data.mjs (deterministic, seed 20250424).\n// Customer master records — referenced by id from invoices.js.\n// ar / totalInv / lastInv / arOverdue are derived from generated invoices.`
);
writeArrayFile(
  "bills.js", "BILLS", bills,
  `// AUTO-GENERATED by scripts/generate-master-data.mjs (deterministic, seed 20250424).\n// AP bills. \`vendor\` references vendors.js by id. The first 8 records are\n// hand-curated demo anchors that the JE generator references; the rest are\n// synthetic but reference the same vendor + CoA universe.`
);
writeArrayFile(
  "invoices.js", "INVOICES", invoices,
  `// AUTO-GENERATED by scripts/generate-master-data.mjs (deterministic, seed 20250424).\n// AR invoices. \`customer\` references customers.js by id. The first 8 records\n// are hand-curated demo anchors that the JE generator references; the rest\n// are synthetic but reference the same customer + CoA universe.`
);

// ── Summary ──────────────────────────────────────────────────────────────
const totalBillAP   = bills.filter((b) => b.pay !== "paid").reduce((s, b) => s + b.sisa, 0);
const totalInvAR    = invoices.filter((i) => i.payStatus !== "lunas" && i.approval !== "draft").reduce((s, i) => s + i.total, 0);
const overdueBills  = bills.filter((b) => b.pay === "overdue").length;
const overdueInvs   = invoices.filter((i) => i.payStatus === "overdue").length;
console.log(`\nSummary:`);
console.log(`  Outstanding AP:    Rp ${totalBillAP.toLocaleString("id-ID")} (${overdueBills} overdue bills)`);
console.log(`  Outstanding AR:    Rp ${totalInvAR.toLocaleString("id-ID")} (${overdueInvs} overdue invoices)`);
console.log(`  Active vendors:    ${vendors.filter((v) => v.status === "active").length}`);
console.log(`  Active customers:  ${customers.filter((c) => c.active).length}`);
console.log(`\nWrote 4 seed files. Run the JE generator next if you want JE counts to match:`);
console.log(`  node scripts/generate-journal-entries.mjs`);
