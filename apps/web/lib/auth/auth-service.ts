import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;
const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 7;

const credentialsSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(12).max(128),
});

export interface AuthUserRecord {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: Date;
}

export interface UserProfile {
  id: string;
  email: string;
  createdAt: Date;
}

export interface AuthRepository {
  findUserByEmail(email: string): Promise<AuthUserRecord | null>;
  createUser(email: string, passwordHash: string): Promise<AuthUserRecord>;
  createSession(userId: string, tokenHash: string, expiresAt: Date): Promise<void>;
  findSession(tokenHash: string): Promise<{
    expiresAt: Date;
    user: UserProfile;
  } | null>;
  deleteSession(tokenHash: string): Promise<void>;
}

export class AuthError extends Error {
  constructor(
    public readonly code: "invalid_request" | "invalid_credentials" | "duplicate_email",
    message: string,
    public readonly issues?: Array<{ field: string; message: string }>,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export class DuplicateEmailError extends Error {
  constructor() {
    super("An account with this email already exists.");
    this.name = "DuplicateEmailError";
  }
}

function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(
      password,
      salt,
      KEY_LENGTH,
      { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: 64 * 1024 * 1024 },
      (error, derivedKey) => {
        if (error) reject(error);
        else resolve(derivedKey);
      },
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derivedKey = await deriveKey(password, salt);
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("base64url")}$${derivedKey.toString("base64url")}`;
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  const [algorithm, n, r, p, saltText, keyText] = passwordHash.split("$");
  if (algorithm !== "scrypt" || n !== String(SCRYPT_N) || r !== String(SCRYPT_R) || p !== String(SCRYPT_P)) {
    return false;
  }

  try {
    const expected = Buffer.from(keyText, "base64url");
    const actual = await deriveKey(password, Buffer.from(saltText, "base64url"));
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function validateCredentials(input: unknown): { email: string; password: string } {
  const result = credentialsSchema.safeParse(input);
  if (!result.success) {
    throw new AuthError(
      "invalid_request",
      "Enter a valid email address and a password between 12 and 128 characters.",
      result.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      })),
    );
  }
  return { email: result.data.email.toLowerCase(), password: result.data.password };
}

function toProfile(user: AuthUserRecord): UserProfile {
  return { id: user.id, email: user.email, createdAt: user.createdAt };
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function register(
  input: unknown,
  repository: AuthRepository,
  now = new Date(),
): Promise<{ user: UserProfile; token: string; expiresAt: Date }> {
  const credentials = validateCredentials(input);
  const passwordHash = await hashPassword(credentials.password);
  let user: AuthUserRecord;
  try {
    user = await repository.createUser(credentials.email, passwordHash);
  } catch (error) {
    if (error instanceof DuplicateEmailError) {
      throw new AuthError("duplicate_email", error.message);
    }
    throw error;
  }

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + SESSION_DURATION_SECONDS * 1000);
  await repository.createSession(user.id, hashSessionToken(token), expiresAt);
  return { user: toProfile(user), token, expiresAt };
}

export async function login(
  input: unknown,
  repository: AuthRepository,
  now = new Date(),
): Promise<{ user: UserProfile; token: string; expiresAt: Date }> {
  const credentials = validateCredentials(input);
  const user = await repository.findUserByEmail(credentials.email);
  if (!user) {
    await hashPassword(credentials.password);
    throw new AuthError("invalid_credentials", "Invalid email or password.");
  }
  if (!(await verifyPassword(credentials.password, user.passwordHash))) {
    throw new AuthError("invalid_credentials", "Invalid email or password.");
  }

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + SESSION_DURATION_SECONDS * 1000);
  await repository.createSession(user.id, hashSessionToken(token), expiresAt);
  return { user: toProfile(user), token, expiresAt };
}

export async function getUserForSession(
  token: string | null | undefined,
  repository: AuthRepository,
  now = new Date(),
): Promise<UserProfile | null> {
  if (!token) return null;
  const tokenHash = hashSessionToken(token);
  const session = await repository.findSession(tokenHash);
  if (!session) return null;
  if (session.expiresAt.getTime() <= now.getTime()) {
    await repository.deleteSession(tokenHash);
    return null;
  }
  return session.user;
}

export async function logout(
  token: string | null | undefined,
  repository: AuthRepository,
): Promise<void> {
  if (token) await repository.deleteSession(hashSessionToken(token));
}