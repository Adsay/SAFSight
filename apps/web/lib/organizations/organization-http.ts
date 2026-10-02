import type { UserProfile } from "@/lib/auth/auth-service";
import {
  addOrganizationMember,
  changeOrganizationMemberRole,
  createOrganization,
  getCurrentOrganizationContext,
  getOrganization,
  getOrganizationMembers,
  listOrganizations,
  OrganizationError,
  removeOrganizationMember,
  type OrganizationRepository,
} from "./organization-service";

export const CURRENT_ORGANIZATION_COOKIE_NAME = "safsight_organization";

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function setCurrentOrganizationCookie(response: Response, organizationId: string): void {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.headers.append(
    "Set-Cookie",
    `${CURRENT_ORGANIZATION_COOKIE_NAME}=${encodeURIComponent(organizationId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure}`,
  );
}

function clearCurrentOrganizationCookie(response: Response): void {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.headers.append(
    "Set-Cookie",
    `${CURRENT_ORGANIZATION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`,
  );
}

function getCookie(request: Request, name: string): string | null {
  const prefix = `${name}=`;
  const value = request.headers.get("cookie")?.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(prefix));
  if (!value) return null;
  try {
    return decodeURIComponent(value.slice(prefix.length)) || null;
  } catch {
    return null;
  }
}

async function parseJson(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new OrganizationError("invalid_request", "A JSON request body is required.");
  }
  try {
    return await request.json();
  } catch {
    throw new OrganizationError("invalid_request", "The request body must contain valid JSON.");
  }
}

function errorResponse(error: unknown): Response {
  if (error instanceof OrganizationError) {
    const status = {
      unauthenticated: 401,
      invalid_request: 400,
      forbidden: 403,
      not_found: 404,
      duplicate_membership: 409,
      last_owner: 409,
    }[error.code];
    return json({
      error: error.code,
      message: error.message,
      ...(error.issues ? { issues: error.issues } : {}),
    }, status);
  }
  return json({ error: "internal_error", message: "The organization request could not be completed." }, 500);
}

export type RequestUser = (request: Request) => Promise<UserProfile | null>;

export function createOrganizationHandlers(
  repository: OrganizationRepository,
  getRequestUser: RequestUser,
) {
  async function authenticated(request: Request): Promise<UserProfile> {
    const user = await getRequestUser(request);
    if (!user) throw new OrganizationError("unauthenticated", "Authentication is required.");
    return user;
  }

  async function run(work: () => Promise<Response>): Promise<Response> {
    try {
      return await work();
    } catch (error) {
      return errorResponse(error);
    }
  }

  return {
    list: (request: Request) => run(async () => {
      const user = await authenticated(request);
      return json({ organizations: await listOrganizations(repository, user.id) });
    }),

    create: (request: Request) => run(async () => {
      const user = await authenticated(request);
      const context = await createOrganization(repository, user.id, await parseJson(request));
      const response = json({ organization: context.organization, role: context.role }, 201);
      setCurrentOrganizationCookie(response, context.organizationId);
      return response;
    }),

    get: (request: Request, organizationId: string) => run(async () => {
      const user = await authenticated(request);
      const context = await getOrganization(repository, user.id, organizationId);
      return json({ organization: context.organization, role: context.role });
    }),

    members: (request: Request, organizationId: string) => run(async () => {
      const user = await authenticated(request);
      const result = await getOrganizationMembers(repository, user.id, organizationId);
      return json(result);
    }),

    addMember: (request: Request, organizationId: string) => run(async () => {
      const user = await authenticated(request);
      const member = await addOrganizationMember(repository, user.id, organizationId, await parseJson(request));
      return json({ member }, 201);
    }),

    changeMemberRole: (request: Request, organizationId: string, memberUserId: string) => run(async () => {
      const user = await authenticated(request);
      const member = await changeOrganizationMemberRole(
        repository,
        user.id,
        organizationId,
        memberUserId,
        await parseJson(request),
      );
      return json({ member });
    }),

    removeMember: (request: Request, organizationId: string, memberUserId: string) => run(async () => {
      const user = await authenticated(request);
      await removeOrganizationMember(repository, user.id, organizationId, memberUserId);
      return json({ success: true });
    }),

    current: (request: Request) => run(async () => {
      const user = await authenticated(request);
      const organizationId = getCookie(request, CURRENT_ORGANIZATION_COOKIE_NAME);
      try {
        const context = await getCurrentOrganizationContext(repository, user.id, organizationId);
        return json({ organization: context?.organization ?? null, role: context?.role ?? null });
      } catch (error) {
        if (error instanceof OrganizationError && error.code === "not_found") {
          const response = json({ organization: null, role: null });
          clearCurrentOrganizationCookie(response);
          return response;
        }
        throw error;
      }
    }),

    setCurrent: (request: Request) => run(async () => {
      const user = await authenticated(request);
      const body = await parseJson(request);
      const organizationId = typeof body === "object" && body !== null && "organizationId" in body
        ? body.organizationId
        : null;
      if (typeof organizationId !== "string" || !organizationId) {
        throw new OrganizationError("invalid_request", "organizationId is required.");
      }
      const context = await getOrganization(repository, user.id, organizationId);
      const response = json({ organization: context.organization, role: context.role });
      setCurrentOrganizationCookie(response, context.organizationId);
      return response;
    }),

    clearCurrent: (request: Request) => run(async () => {
      await authenticated(request);
      const response = json({ success: true });
      clearCurrentOrganizationCookie(response);
      return response;
    }),
  };
}