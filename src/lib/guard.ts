import { auth } from "@/auth";
import { validationMessage } from "./validation-message";
import { apiError } from "./api";
import { checkPermission, type PermissionResult } from "./rbac";
import { connectToDatabase } from "./db";
import { rateLimit, rateLimitKeyForIp, clientIp, type RateLimitRule } from "./rate-limit";
import type { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";
import User from "@/models/User";
import Employee from "@/models/Employee";
import { bearerApiKey, permissionScope } from "./integrations/api-scopes";
import { authenticateApiKey } from "./integrations/api-key-auth";
import { bindApiKey } from "./integrations/request-context";
import { apiKeyAllows } from "./rbac";
import {
  employeeRecordScopeFilter,
  scopeFilterForFields,
  type ScopeFields,
} from "./rbac/scope";

export interface SessionUser {
  id: string;
  email: string;
  role: string;
  employeeId: string | null;
  branchId: string | null;
  divisionId: string | null;
}

export interface GuardContext {
  user: SessionUser;
  permission: PermissionResult;
  ip: string;
  userAgent: string;
  /** Set when the request authenticated with a Pro API key instead of a session. */
  apiKeyId?: string;
}

/** Thrown by guards; `wrapRouteHandler` turns it into the standard error body. */
export class HttpError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const Unauthorized = (msg = "Sesi Anda telah berakhir. Silakan login kembali.") =>
  new HttpError(401, "UNAUTHORIZED", msg);
export const Forbidden = (msg = "Anda tidak memiliki izin untuk tindakan ini.") =>
  new HttpError(403, "FORBIDDEN", msg);
export const NotFound = (msg = "Data tidak ditemukan.") => new HttpError(404, "NOT_FOUND", msg);
export const BadRequest = (msg: string, details?: unknown) =>
  new HttpError(400, "BAD_REQUEST", msg, details);
export const Conflict = (msg: string) => new HttpError(409, "CONFLICT", msg);

/** Roles that may reach the admin/CMS surface at all. */
export const ADMIN_ROLES = ["SUPERADMIN", "DIREKSI", "HRD", "AUDIT", "GA", "SPV"];

/**
 * Personal or human-decision endpoints: an integration must never read a
 * user's notifications, change a password, enrol a face, decide an approval or
 * read confidential complaints on someone's behalf.
 */
const SESSION_ONLY_PREFIXES = [
  "/api/v1/auth/", "/api/v1/notifications", "/api/v1/face", "/api/v1/uploads", "/api/v1/approvals",
  "/api/v1/complaints", "/api/v1/birthdays", "/api/v1/docs", "/api/v1/license", "/api/v1/integrations/", "/api/v1/system/",
];

/**
 * Resolves the signed-in user, or the creator of a Pro API key, or throws.
 *
 * A key identity carries no employee link: self-service actions need an
 * employee record and narrow (self/branch/division) grants resolve to nothing,
 * so a key only reaches data its creator may see company-wide. Every
 * `checkPermission` for that user in this request is further limited to the
 * key scopes (see `rbac/index.ts`).
 */
export async function requireUser(req: Request): Promise<GuardContext> {
  const token = bearerApiKey(req);
  if (token) {
    const path = new URL(req.url).pathname;
    if (SESSION_ONLY_PREFIXES.some((prefix) => path.startsWith(prefix))) {
      throw Forbidden("Endpoint ini hanya dapat dipakai melalui sesi login, bukan API key.");
    }
    return requireApiKey(req, token);
  }
  const session = await auth();
  if (!session?.user?.id) throw Unauthorized();
  if (session.user.mustChangePassword) {
    const pathname = new URL(req.url).pathname;
    const changingPassword = pathname === "/api/v1/auth/change-password" || pathname === "/api/v1/auth/change-password-verify";
    const viewingOwnProfile = req.method === "GET" && session.user.employeeId && pathname === `/api/v1/employees/${session.user.employeeId}`;
    if (!changingPassword && !viewingOwnProfile) throw Forbidden("Ganti kata sandi awal sebelum menggunakan fitur lainnya.");
  }
  return loadAccount(req, session.user.id);
}

/**
 * Authenticates a Pro API key. The key acts as the user who created it, so the
 * creator's live permission still applies on top of the key's scopes.
 */
async function requireApiKey(req: Request, token: string): Promise<GuardContext> {
  const key = await authenticateApiKey(req, token);
  // Without the request context the RBAC layer could not see the key scopes: fail closed.
  if (!bindApiKey(key)) throw Forbidden("Endpoint ini tidak mendukung API key.");
  const ctx = await loadAccount(req, key.userId);
  return { ...ctx, user: { ...ctx.user, employeeId: null, branchId: null, divisionId: null }, apiKeyId: key.keyId };
}

async function loadAccount(req: Request, userId: string): Promise<GuardContext> {
  await connectToDatabase();

  // JWTs are only proof of a previous login. Re-read mutable authorization
  // state so account deactivation, role changes, and employee transfers take
  // effect immediately instead of waiting up to twelve hours for expiry.
  if (!/^[0-9a-fA-F]{24}$/.test(userId)) throw Unauthorized();
  const account = await User.findById(userId)
    .populate("roleId", "name")
    .select("email roleId employeeId isActive")
    .lean<{
      email: string;
      roleId?: { name?: string };
      employeeId?: unknown;
      isActive?: boolean;
    } | null>();
  if (!account || account.isActive === false || !account.roleId?.name) throw Unauthorized();

  let employeeId: string | null = null;
  let branchId: string | null = null;
  let divisionId: string | null = null;
  if (account.employeeId) {
    const employee = await Employee.findById(account.employeeId)
      .select("status branchId divisionId")
      .lean<{
        _id: unknown;
        status: string;
        branchId?: unknown;
        divisionId?: unknown;
      } | null>();
    if (!employee || !["active", "onboarding"].includes(employee.status)) throw Unauthorized();
    employeeId = String(employee._id);
    branchId = employee.branchId ? String(employee.branchId) : null;
    divisionId = employee.divisionId ? String(employee.divisionId) : null;
  }

  return {
    user: {
      id: userId,
      email: account.email,
      role: account.roleId.name,
      employeeId,
      branchId,
      divisionId,
    },
    permission: { allowed: true, scope: "self" },
    ip: clientIp(req),
    userAgent: req.headers.get("user-agent") ?? "",
  };
}

/** Resolves the user and asserts an RBAC module/action, throwing 401/403. */
export async function requirePermission(
  req: Request,
  module: string,
  action: string
): Promise<GuardContext> {
  const ctx = await requireUser(req);
  if (ctx.apiKeyId && !apiKeyAllows(module, action)) {
    throw Forbidden(`API key tidak memiliki scope ${permissionScope(module, action)}.`);
  }
  const permission = await checkPermission(ctx.user.id, module, action);
  if (!permission.allowed) {
    throw Forbidden(
      `Peran ${ctx.user.role} tidak memiliki izin "${action}" pada modul ${module}.`
    );
  }
  return { ...ctx, permission };
}

/** Asserts the caller holds an employee record (portal self-service actions). */
export async function requireCompanyPermission(req: Request, module: string, action: string): Promise<GuardContext> {
  const ctx = await requirePermission(req, module, action);
  if (ctx.permission.scope !== "all") throw Forbidden("Tindakan administrasi ini memerlukan izin seluruh perusahaan.");
  return ctx;
}

/** Asserts the caller holds an employee record (portal self-service actions). */
export async function requireEmployee(req: Request): Promise<GuardContext & { employeeId: string }> {
  const ctx = await requireUser(req);
  if (!ctx.user.employeeId) {
    throw Forbidden(
      "Akun ini belum tertaut ke data karyawan, sehingga tidak dapat melakukan tindakan mandiri. Hubungi HRD."
    );
  }
  return { ...ctx, employeeId: ctx.user.employeeId };
}

/**
 * Applies a rate limit keyed by scope + identity; throws 429 when exceeded.
 *
 * `identity` must be something that distinguishes one caller from another — a
 * user id, an employee id, an email. Each identity gets its own budget, so a
 * busy colleague can never spend yours. Never pass a constant here: that would
 * put every user of the endpoint into a single shared bucket.
 */
export function enforceRateLimit(scope: string, identity: string, rule: RateLimitRule) {
  const result = rateLimit(`${scope}:${identity}`, rule);
  if (!result.ok) {
    throw new HttpError(
      429,
      "RATE_LIMITED",
      `Terlalu banyak permintaan. Silakan coba lagi dalam ${result.retryAfter} detik.`
    );
  }
}

/**
 * Rate limit for endpoints reached without a session, keyed by client address.
 *
 * Anonymous callers have no identity to key on, so the address stands in for
 * one. When even that is unavailable the key falls back to a coarse bucket
 * shared by many strangers, and the limit is widened to match: a budget sized
 * for one person, applied to everyone at once, locks out real users. The
 * strict per-address limit still applies wherever the address is known.
 */
export function enforceIpRateLimit(scope: string, req: Request, rule: RateLimitRule) {
  const ip = clientIp(req);
  const { key, sharedBucket } = rateLimitKeyForIp(ip, {
    userAgent: req.headers.get("user-agent"),
    language: req.headers.get("accept-language"),
  });

  const effective = sharedBucket ? { ...rule, max: rule.max * 20 } : rule;
  const result = rateLimit(`${scope}:${key}`, effective);

  if (!result.ok) {
    throw new HttpError(
      429,
      "RATE_LIMITED",
      `Terlalu banyak permintaan. Silakan coba lagi dalam ${result.retryAfter} detik.`
    );
  }
}

/** Parses and validates a JSON body, converting Zod issues into a 400 body. */
export async function parseBody<T>(req: Request, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw BadRequest("Format data yang dikirim bukan JSON yang valid.");
  }

  try {
    return schema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      const fields = err.issues.map((i) => ({
        field: i.path.join(".") || "(body)",
        message: validationMessage(i as Parameters<typeof validationMessage>[0]),
      }));
      throw BadRequest(fields[0]?.message ?? "Data yang dikirim tidak valid.", fields);
    }
    throw err;
  }
}

/** Validates query-string params with the same error shape as `parseBody`. */
export function parseQuery<T>(req: Request, schema: ZodType<T>): T {
  const params = Object.fromEntries(new URL(req.url).searchParams.entries());
  try {
    return schema.parse(params);
  } catch (err) {
    if (err instanceof ZodError) {
      throw BadRequest(validationMessage(err.issues[0] as Parameters<typeof validationMessage>[0]));
    }
    throw err;
  }
}

/**
 * Builds the Mongo filter fragment that limits a query to the caller's scope.
 * `all` adds nothing; `branch`/`division` pin to the caller's own unit; `self`
 * pins to the caller's employee record (and to an impossible id when the
 * account has none, so a scoped read can never fall back to "everything").
 */
export function scopeFilter(
  ctx: GuardContext,
  fields: ScopeFields = {}
): Record<string, unknown> {
  return scopeFilterForFields(ctx, fields);
}

export { employeeRecordScopeFilter };

/** Standard pagination parsing with sane caps. */
export function pagination(req: Request, defaultLimit = 25, maxLimit = 200) {
  const sp = new URL(req.url).searchParams;
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const limit = Math.min(maxLimit, Math.max(1, Number(sp.get("limit")) || defaultLimit));
  return { page, limit, skip: (page - 1) * limit };
}

export type RouteResult = NextResponse | Response;
export { apiError };
