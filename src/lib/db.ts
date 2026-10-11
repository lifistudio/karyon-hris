import database from "./postgres";
import "./postgres-models";
import { refreshTimezone } from "./timezone-server";
let connected = false;
export async function connectToDatabase() {
  try { await database.connect(); connected = true; await refreshTimezone(); return database; }
  catch (error) { connected = false; throw error; }
}
export function isDbConnected() { return connected; }
export function isDbUnreachable(error: unknown) {
  const e = error as { code?: string; message?: string } | null;
  return !!e && (["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT", "08000", "08001", "08003", "08006", "57P01", "53300"].includes(e.code ?? "") || /DB_HOST\/DB_NAME|timeout exceeded when trying to connect/i.test(e.message ?? ""));
}
