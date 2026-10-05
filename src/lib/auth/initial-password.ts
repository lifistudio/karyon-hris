import crypto from "crypto";
import { connectToDatabase } from "@/lib/db";
import { decryptOrEmpty, encrypt } from "@/lib/crypto";
import { HttpError } from "@/lib/guard";
import { getSettings } from "@/lib/settings";
import Setting from "@/models/Setting";
import Role from "@/models/Role";

/**
 * Initial passwords for new accounts, configured per role from the dashboard.
 *
 * Each role either shares one fixed initial password (convenient when HR hands
 * out accounts in person) or gets a random one per account, shown once to the
 * person creating it. Superadmin is never configurable here: any Superadmin
 * account created through these flows always receives a random password.
 *
 * Stored encrypted in the settings collection under a key that `getSettings()`
 * skips, so it never travels with the ordinary settings read.
 */

export const POLICY_KEY = "initial_password_policy";

export type InitialPasswordMode = "fixed" | "random";

export interface RolePolicy {
  mode: InitialPasswordMode;
  /** Encrypted at rest; plaintext only in memory. */
  password: string;
}

interface StoredPolicy {
  roles: Record<string, { mode: InitialPasswordMode; password: string }>;
}

/** Roles whose initial password cannot be configured. */
export const UNCONFIGURABLE_ROLES = ["SUPERADMIN"];

async function readStored(): Promise<StoredPolicy> {
  await connectToDatabase();
  const row = await Setting.findOne({ key: POLICY_KEY }).lean<{ value?: StoredPolicy } | null>();
  return row?.value?.roles ? row.value : { roles: {} };
}

/** Plaintext policy per role name, filling roles that were never configured. */
export async function readPolicy(): Promise<Record<string, RolePolicy>> {
  const [stored, roles] = await Promise.all([
    readStored(),
    Role.find({ name: { $nin: UNCONFIGURABLE_ROLES } }).select("name").lean<Array<{ name: string }>>(),
  ]);

  const out: Record<string, RolePolicy> = {};
  for (const { name } of roles) {
    const entry = stored.roles[name];
    out[name] = entry
      ? { mode: entry.mode, password: entry.password ? decryptOrEmpty(entry.password) : "" }
      : { mode: "random", password: "" };
  }
  return out;
}

/**
 * Stores the policy. Only roles listed in `changed` are validated, so a role
 * still carrying an older, weaker shared password does not block saving
 * another role.
 */
export async function writePolicy(policy: Record<string, RolePolicy>, changed?: string[]) {
  const settings = await getSettings();
  const roles: StoredPolicy["roles"] = {};
  for (const [name, p] of Object.entries(policy)) {
    if (UNCONFIGURABLE_ROLES.includes(name)) continue;
    if (p.mode === "fixed" && (!changed || changed.includes(name))) {
      assertStrong(p.password, Number(settings.password_min_length), name);
    }
    roles[name] = { mode: p.mode, password: p.mode === "fixed" ? encrypt(p.password) : "" };
  }
  await connectToDatabase();
  await Setting.findOneAndUpdate(
    { key: POLICY_KEY },
    { value: { roles }, description: "Kata sandi awal akun baru per peran (terenkripsi)." },
    { upsert: true }
  );
}

function assertStrong(password: string, minLength: number, roleName: string) {
  const problem =
    password.length < minLength
      ? `minimal ${minLength} karakter`
      : !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)
        ? "harus memuat huruf kecil, huruf besar, dan angka"
        : null;
  if (problem) {
    throw new HttpError(400, "WEAK_PASSWORD", `Kata sandi awal peran ${roleName} ${problem}.`);
  }
}

/** A random password that satisfies the complexity rules and is easy to read out. */
export function generatePassword(length = 12): string {
  // No 0/O, 1/l/I: these passwords get read aloud and typed from paper.
  const lower = "abcdefghijkmnpqrstuvwxyz";
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const digits = "23456789";
  const all = lower + upper + digits;
  const pick = (set: string) => set[crypto.randomInt(set.length)];
  const chars = [pick(lower), pick(upper), pick(digits)];
  while (chars.length < Math.max(10, length)) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

/**
 * The password a new account of this role starts with.
 *
 * `generated` tells the caller to show the value once: a random password is not
 * stored anywhere else, so if the person creating the account does not note it,
 * a reset is the only way back in.
 */
export async function initialPasswordFor(
  roleId: string
): Promise<{ password: string; roleName: string; mode: InitialPasswordMode }> {
  await connectToDatabase();
  const role = await Role.findById(roleId).select("name").lean<{ name: string } | null>();
  if (!role) throw new HttpError(400, "BAD_REQUEST", "Peran akun tidak ditemukan.");

  if (UNCONFIGURABLE_ROLES.includes(role.name)) {
    return { password: generatePassword(14), roleName: role.name, mode: "random" };
  }

  const policy = (await readPolicy())[role.name];
  if (!policy || policy.mode === "random" || !policy.password) {
    return { password: generatePassword(), roleName: role.name, mode: "random" };
  }
  return { password: policy.password, roleName: role.name, mode: "fixed" };
}

/** True when the password equals any configured fixed initial password. */
export async function isInitialPassword(password: string): Promise<boolean> {
  const policy = await readPolicy();
  return Object.values(policy).some((p) => p.mode === "fixed" && p.password && p.password === password);
}
