import { NextResponse } from "next/server";
import { fieldLabel } from "./validation-message";
import { isDbUnreachable } from "@/lib/db";
import { runWithRequestContext } from "@/lib/integrations/request-context";

export interface ApiMeta {
  page?: number;
  limit?: number;
  total?: number;
  totalPages?: number;
  /** Period-scoped lists (e.g. inventory checks) report the period and its counts. */
  period?: string;
  summary?: Record<string, number>;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
  meta?: ApiMeta;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export function apiSuccess<T>(
  data: T,
  message?: string,
  meta?: ApiMeta,
  status: number = 200
) {
  const body: ApiResponse<T> = { success: true, data, message };
  if (meta) {
    body.meta = {
      ...meta,
      totalPages:
        meta.total !== undefined && meta.limit
          ? Math.max(1, Math.ceil(meta.total / meta.limit))
          : meta.totalPages,
    };
  }
  return NextResponse.json(body, { status });
}

export function apiError(
  code: string,
  message: string,
  details?: unknown,
  status: number = 400
) {
  return NextResponse.json<ApiResponse>(
    { success: false, error: { code, message, details } },
    { status }
  );
}

/** Anything carrying an HTTP status we are willing to surface to the client. */
interface StatusCarrier {
  status?: number;
  /** Mongo driver errors use a numeric `code` (11000 = duplicate key). */
  code?: string | number;
  message?: string;
  details?: unknown;
  name?: string;
  keyValue?: Record<string, unknown>;
}

/**
 * Route context shape. Next.js passes `{ params: Promise<…> }` for dynamic
 * segments and nothing at all for static ones.
 */
export type RouteContext<P = Record<string, string>> = { params: Promise<P> };

/**
 * Wraps a route handler so every route shares one error contract.
 *
 * Errors raised deliberately (`HttpError` from `lib/guard`, Mongo duplicate
 * keys, validation) keep their status and message. Anything unexpected is
 * logged server-side and returned as a generic 500 — internal stack traces and
 * driver messages must never reach the browser.
 */
export function wrapRouteHandler<C = RouteContext>(
  handler: (req: Request, context: C) => Promise<NextResponse | Response>
) {
  return (req: Request, context: C) => runWithRequestContext(async () => {
    try {
      // Browser state-changing requests must originate from this host. JSON
      // bodies and SameSite cookies reduce classic CSRF, but neither protects
      // against every same-browser cross-origin mutation or future form route.
      if (!["GET", "HEAD", "OPTIONS"].includes(req.method.toUpperCase())) {
        const fetchSite = req.headers.get("sec-fetch-site");
        if (fetchSite === "cross-site") {
          return apiError("CROSS_SITE_REQUEST", "Permintaan lintas situs ditolak.", null, 403);
        }

        const origin = req.headers.get("origin");
        const host = req.headers.get("host") ?? new URL(req.url).host;
        if (origin) {
          let originHost = "";
          try {
            originHost = new URL(origin).host;
          } catch {
            return apiError("INVALID_ORIGIN", "Header origin tidak valid.", null, 403);
          }
          if (originHost !== host) {
            return apiError("CROSS_SITE_REQUEST", "Permintaan lintas situs ditolak.", null, 403);
          }
        }
      }

      return await handler(req, context);
    } catch (raw) {
      const err = raw as StatusCarrier;

      // Deliberate HttpError from the guard helpers.
      if (err?.name === "HttpError" && typeof err.status === "number") {
        return apiError(err.code as string, err.message as string, err.details, err.status);
      }

      // Repository duplicate key / native PostgreSQL unique violation.
      if (err?.code === 11000 || err?.code === "23505") {
        const field = Object.keys(err.keyValue ?? {})[0];
        return apiError(
          "DUPLICATE",
          field ? `${fieldLabel(field)} sudah dipakai data lain. Gunakan nilai yang berbeda.` : "Data yang sama sudah ada. Periksa kembali isian yang harus unik (misalnya email, NIP, atau kode).",
          null,
          409
        );
      }

      if (err?.code === "23503" || err?.message === "CONFLICT") return apiError("CONFLICT", "Data sudah berubah atau masih digunakan oleh data lain. Muat ulang dan periksa relasinya.", null, 409);
      // Schema validation and PostgreSQL CHECK/NOT NULL constraints.
      if (err?.name === "ValidationError" || err?.message?.startsWith("Validation failed:") || ["23502", "23514"].includes(String(err?.code))) {
        return apiError("VALIDATION_ERROR", "Ada isian wajib yang kosong atau nilainya di luar batas yang diizinkan. Periksa kembali formulir lalu simpan ulang.", null, 400);
      }

      if (err?.name === "CastError" || err?.message === "Invalid record identifier") {
        return apiError("BAD_REQUEST", "Data yang diminta tidak ditemukan atau tautannya tidak valid. Muat ulang halaman dari menu.", null, 400);
      }

      // Database unreachable. The predicate lives with the connection code so
      // the sign-in path and the route handlers cannot drift apart on what
      // counts as an outage.
      if (isDbUnreachable(raw)) {
        console.error("[API ERROR] database unreachable:", err.message);
        return apiError(
          "DB_UNAVAILABLE",
          "Server basis data sedang tidak dapat dihubungi, sehingga data tidak dapat dimuat. " +
            "Coba lagi beberapa saat lagi, atau hubungi administrator bila terus berulang.",
          null,
          503
        );
      }

      console.error("[API ERROR]", { code: err?.code, name: err?.name });
      return apiError(
        "INTERNAL_SERVER_ERROR",
        "Terjadi kesalahan di server sehingga permintaan belum diproses. Coba lagi beberapa saat; jika berulang, hubungi administrator dan sebutkan waktu kejadiannya.",
        null,
        500
      );
    }
  });
}
