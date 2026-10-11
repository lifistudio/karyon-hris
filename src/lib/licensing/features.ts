export const PRO_FEATURES = [
  "face.advanced",
  "payroll.advanced",
  "discipline.workflow",
  "organization.multi_branch",
  "analytics.advanced",
  "automation.advanced",
  "integration.api",
  "integration.webhook",
  "integration.sso",
  "agent.lifecycle",
] as const;

export type ProFeature = (typeof PRO_FEATURES)[number];

export const PRO_FEATURE_LABELS: Record<ProFeature, string> = {
  "face.advanced": "Pengenalan wajah dan anti-spoof saat absen",
  "payroll.advanced": "Payroll lanjutan dan simulasi kebijakan",
  "discipline.workflow": "Alur disiplin (SP, pembinaan, PHK) dengan bukti keputusan",
  "organization.multi_branch": "Multi-cabang tanpa batas",
  "analytics.advanced": "Analitik lintas cabang",
  "automation.advanced": "Otomatisasi dan penjadwal lanjutan",
  "integration.api": "REST API dan asisten AI lewat MCP (Claude, Cursor)",
  "integration.webhook": "Webhook bertanda tangan",
  "integration.sso": "Login SSO perusahaan",
  "agent.lifecycle": "Backup terjadwal otomatis",
};

/**
 * Keys kept for license compatibility but not shown as a separate Pro feature:
 * update and rollback now run from the installer manager on every edition.
 */
export const HIDDEN_FEATURE_LABELS: ReadonlySet<ProFeature> = new Set(["agent.lifecycle"]);

export interface EntitlementSnapshot {
  plan: "community" | "pro" | "enterprise";
  status: "active" | "grace" | "expired" | "unlicensed";
  features: ProFeature[];
  expiresAt: string | null;
  graceUntil: string | null;
  installationId: string | null;
  siteOrigin?: string;
  source: "lease" | "development" | "community";
}

export const COMMUNITY_ENTITLEMENTS: EntitlementSnapshot = {
  plan: "community",
  status: "unlicensed",
  features: [],
  expiresAt: null,
  graceUntil: null,
  installationId: null,
  source: "community",
};

/** Re-evaluates a cached agent lease so an outage can never freeze Pro access forever. */
export function effectiveEntitlements(snapshot: EntitlementSnapshot, now = Date.now()): EntitlementSnapshot {
  if (snapshot.source !== "lease") return snapshot;
  const leaseEnd = snapshot.expiresAt ? new Date(snapshot.expiresAt).getTime() : 0;
  const graceEnd = snapshot.graceUntil ? new Date(snapshot.graceUntil).getTime() : 0;
  if (!Number.isFinite(graceEnd) || now > graceEnd) return { ...snapshot, status: "expired", features: [] };
  if (!Number.isFinite(leaseEnd) || now > leaseEnd) return { ...snapshot, status: "grace" };
  return { ...snapshot, status: "active" };
}
