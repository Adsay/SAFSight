import {
  AuthError,
  DuplicateEmailError,
  getUserForSession,
  login,
  logout,
  register,
  type AuthRepository,
} from "./auth-service";
import { AuthRateLimiter, getRequestRateLimitKey } from "./rate-limit";

export const SESSION_COOKIE_NAME = "safsight_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function setSessionCookie(response: Response, token: string): void {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.headers.append(
    "Set-Cookie",
    `${SESSION_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SECONDS}${secure}`,
  );
}

function clearSessionCookie(response: Response): void {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.headers.append(
    "Set-Cookie",
    `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`,
  );
}

export function getSessionToken(request: Request): string | null {
  const cookies = request.headers.get("cookie")?.split(";") ?? [];
  const prefix = `${SESSION_COOKIE_NAME}=`;
  const value = cookies.map((cookie) => cookie.trim()).find((cookie) => cookie.startsWith(prefix));
  return value ? value.slice(prefix.length) || null : null;
}

function errorResponse(error: unknown): Response {
  if (error instanceof AuthError) {
    const status = error.code === "invalid_request" ? 400 : error.code === "duplicate_email" ? 409 : 401;
    return json({ error: error.code, message: error.message, ...(error.issues ? { issues: error.issues } : {}) }, status);
  }
  if (error instanceof DuplicateEmailError) {
    return json({ error: "duplicate_email", message: error.message }, 409);
  }
  return json({ error: "internal_error", message: "Authentication could not be completed." }, 500);
}

async function parseBody(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new AuthError("invalid_request", "A JSON request body is required.");
  }
  try {
    return await request.json();
  } catch {
    throw new AuthError("invalid_request", "The request body must contain valid JSON.");
  }
}

export function createAuthHandlers(repository: AuthRepository, limiter = new AuthRateLimiter()) {
  function rateLimitResponse(request: Request): Response | null {
    const result = limiter.check(getRequestRateLimitKey(request));
    if (result.allowed) return null;
    const response = json({ error: "rate_limited", message: "Too many attempts. Try again later." }, 429);
    response.headers.set("Retry-After", String(result.retryAfterSeconds));
    return response;
  }

  return {
    async register(request: Request): Promise<Response> {
      const blocked = rateLimitResponse(request);
      if (blocked) return blocked;
      try {
        const result = await register(await parseBody(request), repository);
        const response = json({ user: result.user }, 201);
        setSessionCookie(response, result.token);
        return response;
      } catch (error) {
        return errorResponse(error);
      }
    },

    async login(request: Request): Promise<Response> {
      const blocked = rateLimitResponse(request);
      if (blocked) return blocked;
      try {
        const result = await login(await parseBody(request), repository);
        const response = json({ user: result.user });
        setSessionCookie(response, result.token);
        return response;
      } catch (error) {
        return errorResponse(error);
      }
    },

    async session(request: Request): Promise<Response> {
      try {
        const user = await getUserForSession(getSessionToken(request), repository);
        return json({ user });
      } catch {
        return json({ error: "internal_error", message: "The session could not be loaded." }, 500);
      }
    },

    async logout(request: Request): Promise<Response> {
      try {
        await logout(getSessionToken(request), repository);
        const response = json({ success: true });
        clearSessionCookie(response);
        return response;
      } catch {
        const response = json({ error: "internal_error", message: "Logout could not be completed." }, 500);
        clearSessionCookie(response);
        return response;
      }
    },
  };
}