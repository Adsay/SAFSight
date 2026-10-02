import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { createProxy, isProtectedPath } from "../proxy";
import { createAuthHandlers, getSessionToken, SESSION_COOKIE_NAME } from "../lib/auth/auth-http";
import {
  DuplicateEmailError,
  getUserForSession,
  hashSessionToken,
  type AuthRepository,
  type AuthUserRecord,
  type UserProfile,
} from "../lib/auth/auth-service";
import { AuthRateLimiter } from "../lib/auth/rate-limit";

class MemoryAuthRepository implements AuthRepository {
  readonly users = new Map<string, AuthUserRecord>();
  readonly sessions = new Map<string, { expiresAt: Date; user: UserProfile }>();

  async findUserByEmail(email: string) {
    return this.users.get(email) ?? null;
  }

  async createUser(email: string, passwordHash: string) {
    if (this.users.has(email)) throw new DuplicateEmailError();
    const user = { id: crypto.randomUUID(), email, passwordHash, createdAt: new Date() };
    this.users.set(email, user);
    return user;
  }

  async createSession(userId: string, tokenHash: string, expiresAt: Date) {
    const user = [...this.users.values()].find((candidate) => candidate.id === userId);
    if (!user) throw new Error("User not found");
    const { id, email, createdAt } = user;
    this.sessions.set(tokenHash, { expiresAt, user: { id, email, createdAt } });
  }

  async findSession(tokenHash: string) {
    return this.sessions.get(tokenHash) ?? null;
  }

  async deleteSession(tokenHash: string) {
    this.sessions.delete(tokenHash);
  }
}

function jsonRequest(path: string, body?: unknown, cookie?: string): Request {
  return new Request(`http://localhost${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(cookie ? { cookie } : {}),
      "x-forwarded-for": "192.0.2.10",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function cookieValue(response: Response): string {
  const setCookie = response.headers.get("set-cookie");
  expect(setCookie).toContain(`${SESSION_COOKIE_NAME}=`);
  return setCookie!.split(";")[0].slice(SESSION_COOKIE_NAME.length + 1);
}

describe("authentication handlers", () => {
  let repository: MemoryAuthRepository;
  let handlers: ReturnType<typeof createAuthHandlers>;

  beforeEach(() => {
    repository = new MemoryAuthRepository();
    handlers = createAuthHandlers(repository, new AuthRateLimiter(100));
  });

  it("registers with a salted password hash and persists a session cookie", async () => {
    const response = await handlers.register(
      jsonRequest("/api/auth/register", { email: "  Person@Example.com ", password: "A-long-test-password-1" }),
    );
    const body = await response.json();
    const token = cookieValue(response);

    expect(response.status).toBe(201);
    expect(body.user.email).toBe("person@example.com");
    expect(body.user).not.toHaveProperty("passwordHash");
    expect(repository.users.get("person@example.com")?.passwordHash).toMatch(/^scrypt\$/);
    expect(repository.sessions.has(hashSessionToken(token))).toBe(true);
    expect(repository.sessions.has(token)).toBe(false);
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("SameSite=Lax");
  });

  it("rejects duplicate registration with a clear conflict response", async () => {
    const input = { email: "person@example.com", password: "A-long-test-password-1" };
    await handlers.register(jsonRequest("/api/auth/register", input));
    const response = await handlers.register(jsonRequest("/api/auth/register", input));

    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("duplicate_email");
  });

  it("logs in with valid credentials and rejects invalid credentials generically", async () => {
    const input = { email: "person@example.com", password: "A-long-test-password-1" };
    await handlers.register(jsonRequest("/api/auth/register", input));

    const loginResponse = await handlers.login(jsonRequest("/api/auth/login", input));
    expect(loginResponse.status).toBe(200);
    expect(cookieValue(loginResponse)).not.toBe("");

    const invalidResponse = await handlers.login(
      jsonRequest("/api/auth/login", { ...input, password: "A-different-password-2" }),
    );
    expect(invalidResponse.status).toBe(401);
    expect((await invalidResponse.json()).message).toBe("Invalid email or password.");

    const unknownResponse = await handlers.login(
      jsonRequest("/api/auth/login", { email: "unknown@example.com", password: input.password }),
    );
    expect(unknownResponse.status).toBe(401);
    expect((await unknownResponse.json()).message).toBe("Invalid email or password.");
  });

  it("returns the persisted current session and revokes it on logout", async () => {
    const registration = await handlers.register(
      jsonRequest("/api/auth/register", { email: "person@example.com", password: "A-long-test-password-1" }),
    );
    const token = cookieValue(registration);
    const sessionCookie = `${SESSION_COOKIE_NAME}=${token}`;

    const current = await handlers.session(jsonRequest("/api/auth/session", undefined, sessionCookie));
    expect((await current.json()).user.email).toBe("person@example.com");
    expect(getSessionToken(jsonRequest("/api/auth/session", undefined, sessionCookie))).toBe(token);

    const logoutResponse = await handlers.logout(jsonRequest("/api/auth/logout", {}, sessionCookie));
    expect(logoutResponse.status).toBe(200);
    expect(logoutResponse.headers.get("set-cookie")).toContain("Max-Age=0");
    expect((await handlers.session(jsonRequest("/api/auth/session", undefined, sessionCookie)).then((res) => res.json())).user).toBeNull();
  });

  it("deletes expired sessions when they are accessed", async () => {
    const registration = await handlers.register(
      jsonRequest("/api/auth/register", { email: "person@example.com", password: "A-long-test-password-1" }),
    );
    const token = cookieValue(registration);
    const tokenHash = hashSessionToken(token);
    repository.sessions.get(tokenHash)!.expiresAt = new Date(Date.now() - 1000);

    expect(await getUserForSession(token, repository)).toBeNull();
    expect(repository.sessions.has(tokenHash)).toBe(false);
  });

  it("rate limits repeated authentication attempts", async () => {
    const limitedHandlers = createAuthHandlers(repository, new AuthRateLimiter(1, 60_000));
    const input = { email: "unknown@example.com", password: "A-long-test-password-1" };

    expect((await limitedHandlers.login(jsonRequest("/api/auth/login", input))).status).toBe(401);
    const blocked = await limitedHandlers.login(jsonRequest("/api/auth/login", input));
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("protects dashboard pages and business API paths while leaving auth routes public", async () => {
    const testProxy = createProxy(async (token) => token === "valid-session");
    const dashboardResponse = await testProxy(new NextRequest("https://safsight.test/dashboard"));
    const apiResponse = await testProxy(new NextRequest("https://safsight.test/api/scans"));
    const authResponse = await testProxy(new NextRequest("https://safsight.test/api/auth/session"));
    const validResponse = await testProxy(
      new NextRequest("https://safsight.test/dashboard", {
        headers: { cookie: `${SESSION_COOKIE_NAME}=valid-session` },
      }),
    );

    expect(dashboardResponse.headers.get("location")).toBe("https://safsight.test/login");
    expect(apiResponse.status).toBe(401);
    expect(authResponse.headers.get("x-middleware-next")).toBe("1");
    expect(validResponse.headers.get("x-middleware-next")).toBe("1");
    expect(isProtectedPath("/organizations")).toBe(true);
    expect(isProtectedPath("/organizations/organization-1")).toBe(true);
    expect(isProtectedPath("/api/organizations/organization-1/members")).toBe(true);
  });
});