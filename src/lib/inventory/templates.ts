/**
 * What GA records for an asset depends on what the asset is: a laptop has a
 * serial number and a battery, a car has a plate number and an odometer.
 *
 * A category template lists the specification fields filled in once when the
 * asset is registered and the checklist walked through at every check. The
 * built-in categories ship with sensible defaults; each template (and every
 * custom category) can be edited from the category manager and is stored in the
 * Setting `inventory_category_templates`.
 *
 * Shared by the server and the browser, so nothing here touches the database.
 */

export type CheckResult = "ok" | "issue" | "na";

export interface CheckItem {
  label: string;
  result: CheckResult;
  note?: string;
}

export interface SpecValue {
  label: string;
  value: string;
}

/** A specification re-read during a check: does the asset still match its record? */
export interface SpecCheck {
  label: string;
  expected: string;
  matches: boolean;
  note?: string;
}

export interface CategoryTemplate {
  specs: string[];
  checklist: string[];
  /** A meter read at every check (e.g. "Odometer (km)"); empty when not applicable. */
  reading: string;
}

export const DEFAULT_CATEGORIES = ["laptop", "phone", "vehicle", "other"];

export const DEFAULT_TEMPLATES: Record<string, CategoryTemplate> = {
  laptop: {
    specs: ["Merek", "Model", "Prosesor", "RAM", "Penyimpanan", "Nomor seri"],
    checklist: ["Fisik & casing", "Layar", "Keyboard & touchpad", "Baterai & charger", "Port & konektivitas", "Sistem operasi & aplikasi"],
    reading: "",
  },
  phone: {
    specs: ["Merek", "Model", "IMEI", "Penyimpanan", "Nomor kartu SIM"],
    checklist: ["Fisik & casing", "Layar & sentuhan", "Kamera", "Baterai & charger", "Sinyal & kartu SIM", "Aksesori"],
    reading: "",
  },
  vehicle: {
    specs: ["Merek", "Model", "Nomor polisi", "Nomor rangka", "Nomor mesin", "Tahun", "Warna", "STNK berlaku sampai"],
    checklist: ["Bodi & cat", "Mesin", "Rem", "Ban", "Lampu & klakson", "STNK & pajak", "Kebersihan"],
    reading: "Odometer (km)",
  },
  other: {
    specs: ["Merek", "Model / tipe", "Nomor seri"],
    checklist: ["Fisik", "Fungsi", "Kelengkapan aksesori"],
    reading: "",
  },
};

const GENERIC: CategoryTemplate = DEFAULT_TEMPLATES.other;

export const CHECK_RESULT_LABELS: Record<CheckResult, string> = {
  ok: "Baik",
  issue: "Bermasalah",
  na: "Tidak ada",
};

export const CHECK_TYPE_LABELS: Record<string, string> = {
  initial: "Kondisi awal",
  monthly: "Pengecekan bulanan",
  incidental: "Pengecekan insidental",
};

export const ASSIGNMENT_STATUS_LABELS: Record<string, string> = {
  pending_handover: "Menunggu tanda tangan",
  active: "Dipegang karyawan",
  returned: "Sudah dikembalikan",
  disputed: "Dilaporkan tidak sesuai",
  cancelled: "Dibatalkan",
};

const MAX_ITEMS = 20;
const cleanList = (value: unknown): string[] =>
  Array.isArray(value)
    ? [...new Set(value.filter((v): v is string => typeof v === "string").map((v) => v.trim().slice(0, 60)).filter(Boolean))].slice(0, MAX_ITEMS)
    : [];

/** Validates one template from user input; missing parts fall back to `fallback`. */
export function sanitizeTemplate(input: unknown, fallback: CategoryTemplate = GENERIC): CategoryTemplate {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const specs = cleanList(raw.specs);
  const checklist = cleanList(raw.checklist);
  return {
    specs: Array.isArray(raw.specs) ? specs : fallback.specs,
    checklist: checklist.length ? checklist : fallback.checklist,
    reading: typeof raw.reading === "string" ? raw.reading.trim().slice(0, 40) : fallback.reading,
  };
}

/** The template for a category: the stored one, else the built-in default, else generic. */
export function templateFor(category: string, stored?: Record<string, CategoryTemplate> | null): CategoryTemplate {
  return stored?.[category] ?? DEFAULT_TEMPLATES[category] ?? GENERIC;
}

/** Empty checklist rows for a template, optionally prefilled from an earlier check. */
export function blankChecklist(template: CategoryTemplate, previous?: CheckItem[] | null): CheckItem[] {
  return template.checklist.map((label) => {
    const prior = previous?.find((p) => p.label === label);
    return { label, result: prior?.result ?? "ok", note: "" };
  });
}

export function sanitizeChecklist(input: unknown): CheckItem[] {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 30).flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const r = row as Record<string, unknown>;
    const label = typeof r.label === "string" ? r.label.trim().slice(0, 60) : "";
    if (!label) return [];
    const result: CheckResult = r.result === "issue" || r.result === "na" ? r.result : "ok";
    const note = typeof r.note === "string" ? r.note.trim().slice(0, 300) : "";
    return [{ label, result, ...(note ? { note } : {}) }];
  });
}

export function sanitizeSpecs(input: unknown): SpecValue[] {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 30).flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const r = row as Record<string, unknown>;
    const label = typeof r.label === "string" ? r.label.trim().slice(0, 60) : "";
    const value = typeof r.value === "string" ? r.value.trim().slice(0, 200) : "";
    return label && value ? [{ label, value }] : [];
  });
}

export function sanitizeSpecChecks(input: unknown): SpecCheck[] {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 30).flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const r = row as Record<string, unknown>;
    const label = typeof r.label === "string" ? r.label.trim().slice(0, 60) : "";
    if (!label) return [];
    const note = typeof r.note === "string" ? r.note.trim().slice(0, 300) : "";
    return [{
      label,
      expected: typeof r.expected === "string" ? r.expected.slice(0, 200) : "",
      matches: r.matches !== false,
      ...(note ? { note } : {}),
    }];
  });
}

const CONDITION_RANK: Record<string, number> = { good: 0, damaged: 1, lost: 2 };

export function conditionWorse(next: string, before: string | null | undefined): boolean {
  return before != null && (CONDITION_RANK[next] ?? 0) > (CONDITION_RANK[before] ?? 0);
}

/**
 * Plain-language differences between a check and the baseline it is compared
 * to. An empty list means "nothing changed", which is what a verified check is.
 */
export function compareCheck(
  current: { condition: string; checklist: CheckItem[]; specChecks?: SpecCheck[] },
  baseline: { condition?: string | null; checklist?: CheckItem[] | null } | null,
  labels: Record<string, string>
): string[] {
  const findings: string[] = [];
  if (baseline?.condition && current.condition !== baseline.condition) {
    findings.push(`Kondisi berubah dari ${labels[baseline.condition] ?? baseline.condition} menjadi ${labels[current.condition] ?? current.condition}`);
  } else if (!baseline && current.condition !== "good") {
    findings.push(`Kondisi tercatat ${labels[current.condition] ?? current.condition}`);
  }
  for (const item of current.checklist) {
    if (item.result !== "issue") continue;
    const before = baseline?.checklist?.find((b) => b.label === item.label);
    const suffix = item.note ? `: ${item.note}` : "";
    findings.push(before?.result === "issue" ? `${item.label} masih bermasalah${suffix}` : `${item.label} bermasalah${suffix}`);
  }
  for (const spec of current.specChecks ?? []) {
    if (!spec.matches) findings.push(`Spesifikasi ${spec.label} tidak sesuai catatan (${spec.expected || "-"})${spec.note ? `: ${spec.note}` : ""}`);
  }
  return findings;
}
