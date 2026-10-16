/**
 * Deliberate API errors. Kept apart from `lib/guard` (which pulls in the auth
 * stack) so domain modules can throw them and still be unit-tested on their own.
 */

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
