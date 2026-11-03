import { auth } from "@/auth";
import { storageProvider, LocalProvider, isCanonicalKey, toStorageKey } from "@/lib/storage";
import { logActivity } from "@/lib/audit/logger";
import { clientIp } from "@/lib/rate-limit";
import { checkPermission } from "@/lib/rbac";
import { canReadStoredPayslip } from "@/lib/payroll-file-access";
import Payroll from "@/models/Payroll";
import Complaint from "@/models/Complaint";
import { complaintHandlerScope, canReadComplaintQueue } from "@/lib/complaint-access";

/**
 * The single door to every stored file.
 *
 * Two independent checks must both pass:
 *  1. A valid session (or a valid HMAC signature for a short-lived share link).
 *  2. Ownership — a STAFF account may only read files that live under its own
 *     employee folder. Anything else requires an HR/admin role.
 *
 * Files no longer sit in `public/`, so this route is the *only* way to read
 * them; there is no static fallback that bypasses these checks.
 */

/** Folders whose second path segment is the owning employee id. */
const EMPLOYEE_SCOPED_PREFIXES = [
  "attendances/",
  "payrolls/",
  "employees/",
  "leaves/",
  "corrections/",
  "inventory-bast/",
  "task-proofs/",
  "complaints/",
];

const PRIVILEGED_ROLES = ["SUPERADMIN", "HRD", "AUDIT", "DIREKSI", "GA", "SPV"];

/** Biometric reference photos: see the check in GET. */
const FACE_PREFIX = "faces/";
const FACE_ROLES = ["SUPERADMIN", "HRD"];

/**
 * Applicants' CVs and documents: people outside the company, readable only by
 * staff whose role can read recruitment. Being privileged elsewhere (GA, SPV,
 * Audit) is not a reason to browse job applications.
 */
const CANDIDATE_PREFIX = "candidates/";
/** Uploads not yet attached to a form. Never served on a session alone. */
const PENDING_PREFIX = "tmp/";

function jsonError(message: string, status: number) {
  return Response.json({ success: false, error: { code: "STORAGE", message } }, { status });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const rawKey = url.searchParams.get("key") ?? url.searchParams.get("path");
  const expires = url.searchParams.get("expires");
  const sig = url.searchParams.get("sig");
  const download = url.searchParams.get("download") === "1";

  if (!rawKey) return jsonError("Parameter berkas tidak lengkap.", 400);

  const key = toStorageKey(rawKey);
  if (!isCanonicalKey(key)) return jsonError("Jalur berkas tidak valid.", 400);

  // --- Gate 1: signature or session -------------------------------------
  let signatureValid = false;
  if (expires && sig && storageProvider instanceof LocalProvider) {
    signatureValid = storageProvider.verifySignature(key, Number(expires), sig);
    if (!signatureValid) {
      return jsonError("Tautan berkas tidak sah atau sudah kedaluwarsa.", 403);
    }
  }

  const session = await auth();
  if (!signatureValid && !session?.user) {
    return jsonError("Anda harus login untuk membuka berkas ini.", 401);
  }

  // --- Gate 2: ownership -------------------------------------------------
  // A signature alone is enough for a deliberately shared link; otherwise the
  // session must own the file or hold a privileged role.
  // Face reference photos are biometric data and get a narrower door than any
  // other folder: the owner, HRD and Superadmin only. A supervisor still sees a
  // face while judging a change request — through a signed link minted by the
  // approvals endpoint, which has already checked they may see that request.
  // GA, Audit and Direksi, privileged for everything else, are not let in.
  if (!signatureValid && session?.user && key.startsWith(FACE_PREFIX)) {
    const ownerId = key.slice(FACE_PREFIX.length).split("/")[0];
    const isOwner = Boolean(session.user.employeeId) && ownerId === session.user.employeeId;
    if (!isOwner && !FACE_ROLES.includes(session.user.role)) {
      return jsonError("Foto wajah hanya dapat dibuka pemiliknya, HRD, dan Superadmin.", 403);
    }
  }

  if (!signatureValid && key.startsWith(PENDING_PREFIX)) {
    return jsonError("Berkas ini belum dilampirkan ke formulir mana pun.", 403);
  }

  if (!signatureValid && session?.user && key.startsWith(CANDIDATE_PREFIX)) {
    const permission = await checkPermission(session.user.id, "recruitment", "read");
    if (!permission.allowed) {
      return jsonError("Berkas pelamar hanya dapat dibuka tim rekrutmen.", 403);
    }
  }

  // A directory/employee-id check is insufficient for unpublished payslips.
  // Match the exact stored file to its payroll record before serving it.
  let recordAuthorized = false;
  if (!signatureValid && session?.user && key.startsWith("payrolls/")) {
    const payroll = await Payroll.findOne({ fileUrl: { $in: [key, `/uploads/${key}`] } }).select("employeeId status").lean<{
      employeeId: unknown;
      status: string;
    } | null>();
    if (!payroll) return jsonError("Slip gaji tidak ditemukan.", 404);
    if (!await canReadStoredPayslip(session.user, payroll)) {
      return jsonError("Anda tidak memiliki izin membuka slip gaji ini.", 403);
    }
    recordAuthorized = true;
  }

  if (!signatureValid && session?.user && key.startsWith("complaints/")) {
    const complaint = await Complaint.findOne({ attachments: { $in: [key, `/uploads/${key}`] } })
      .select("reporterId target").lean<{ reporterId: unknown; target: string } | null>();
    if (!complaint) return jsonError("Lampiran tidak ditemukan.", 404);
    if (String(complaint.reporterId) !== session.user.employeeId) {
      if (!canReadComplaintQueue(session.user.role, complaint.target)) return jsonError("Anda tidak memiliki izin membuka lampiran ini.", 403);
      const scope = await complaintHandlerScope(session.user, "read");
      if (!await Complaint.exists({ $and: [{ attachments: { $in: [key, `/uploads/${key}`] } }, scope] })) {
        return jsonError("Anda tidak memiliki izin membuka lampiran ini.", 403);
      }
    }
    recordAuthorized = true;
  }

  if (!signatureValid && !recordAuthorized && session?.user && !key.startsWith(FACE_PREFIX) && !key.startsWith(CANDIDATE_PREFIX)) {
    const role = session.user.role;
    const isPrivileged = PRIVILEGED_ROLES.includes(role);
    const scopedPrefix = EMPLOYEE_SCOPED_PREFIXES.find((p) => key.startsWith(p));

    if (!isPrivileged) {
      if (!scopedPrefix) {
        return jsonError("Anda tidak memiliki akses ke berkas ini.", 403);
      }
      const ownerId = key.slice(scopedPrefix.length).split("/")[0];
      if (!session.user.employeeId || ownerId !== session.user.employeeId) {
        return jsonError("Berkas ini bukan milik akun Anda.", 403);
      }
    }
  }

  // --- Serve -------------------------------------------------------------
  let file: { buffer: Buffer; contentType: string };
  try {
    file = await storageProvider.read(key);
  } catch {
    return jsonError("Berkas tidak ditemukan.", 404);
  }

  // Sensitive documents are audited on every read, as the spec requires.
  if (
    session?.user &&
    (key.startsWith("payrolls/") ||
      key.startsWith("employees/") ||
      key.startsWith(FACE_PREFIX) ||
      key.startsWith(CANDIDATE_PREFIX))
  ) {
    void logActivity({
      userId: session.user.id,
      action: "VIEW_SECURE_FILE",
      module: key.split("/")[0],
      after: { key },
      ip: clientIp(req),
      userAgent: req.headers.get("user-agent") ?? "",
    });
  }

  const filename = key.split("/").pop() || "berkas";
  // HTML is served as a download rather than inline so a stored document can
  // never execute script against this origin.
  const isHtml = file.contentType.startsWith("text/html");
  const disposition = download || isHtml ? "attachment" : "inline";

  return new Response(new Uint8Array(file.buffer), {
    status: 200,
    headers: {
      "Content-Type": isHtml ? "application/octet-stream" : file.contentType,
      "Content-Disposition": `${disposition}; filename="${filename.replace(/"/g, "")}"`,
      "Content-Length": String(file.buffer.byteLength),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
