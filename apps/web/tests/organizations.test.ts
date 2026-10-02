import { beforeEach, describe, expect, it } from "vitest";
import type { UserProfile } from "../lib/auth/auth-service";
import { createOrganizationHandlers, CURRENT_ORGANIZATION_COOKIE_NAME } from "../lib/organizations/organization-http";
import {
  DuplicateMembershipError,
  LastOwnerError,
  MembershipNotFoundError,
  assertSameOrganization,
  tenantWhere,
  type OrganizationContext,
  type OrganizationListItem,
  type OrganizationMemberRecord,
  type OrganizationRecord,
  type OrganizationRepository,
  type OrganizationRole,
} from "../lib/organizations/organization-service";

class MemoryOrganizationRepository implements OrganizationRepository {
  readonly users = new Map<string, UserProfile>();
  readonly organizations = new Map<string, OrganizationRecord>();
  readonly memberships = new Map<string, OrganizationMemberRecord>();
  private sequence = 0;

  seedUser(email: string): UserProfile {
    const user = { id: `user-${++this.sequence}`, email, createdAt: new Date() };
    this.users.set(user.id, user);
    return user;
  }

  private key(organizationId: string, userId: string): string {
    return `${organizationId}:${userId}`;
  }

  private newMembership(organizationId: string, userId: string, role: OrganizationRole): OrganizationMemberRecord {
    const user = this.users.get(userId);
    if (!user) throw new Error("User not found");
    return {
      id: `membership-${++this.sequence}`,
      organizationId,
      userId,
      role,
      createdAt: new Date(),
      user: { id: user.id, email: user.email },
    };
  }

  async createOrganizationWithOwner(name: string, ownerUserId: string): Promise<OrganizationContext> {
    const organization = {
      id: `organization-${++this.sequence}`,
      name,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.organizations.set(organization.id, organization);
    const membership = this.newMembership(organization.id, ownerUserId, "OWNER");
    this.memberships.set(this.key(organization.id, ownerUserId), membership);
    return {
      userId: ownerUserId,
      organizationId: organization.id,
      membershipId: membership.id,
      role: membership.role,
      organization,
    };
  }

  async listOrganizationsForUser(userId: string): Promise<OrganizationListItem[]> {
    return [...this.memberships.values()]
      .filter((membership) => membership.userId === userId)
      .flatMap((membership) => {
        const organization = this.organizations.get(membership.organizationId);
        return organization ? [{ organization, membershipId: membership.id, role: membership.role }] : [];
      });
  }

  async findOrganization(organizationId: string): Promise<OrganizationRecord | null> {
    return this.organizations.get(organizationId) ?? null;
  }

  async findMembership(organizationId: string, userId: string): Promise<OrganizationMemberRecord | null> {
    return this.memberships.get(this.key(organizationId, userId)) ?? null;
  }

  async listMembers(organizationId: string): Promise<OrganizationMemberRecord[]> {
    return [...this.memberships.values()].filter((membership) => membership.organizationId === organizationId);
  }

  async findUserByEmail(email: string): Promise<{ id: string; email: string } | null> {
    const user = [...this.users.values()].find((candidate) => candidate.email === email);
    return user ? { id: user.id, email: user.email } : null;
  }

  async createMembership(organizationId: string, userId: string, role: OrganizationRole): Promise<OrganizationMemberRecord> {
    const key = this.key(organizationId, userId);
    if (this.memberships.has(key)) throw new DuplicateMembershipError();
    const membership = this.newMembership(organizationId, userId, role);
    this.memberships.set(key, membership);
    return membership;
  }

  async changeMembershipRole(organizationId: string, userId: string, role: OrganizationRole): Promise<OrganizationMemberRecord> {
    const key = this.key(organizationId, userId);
    const membership = this.memberships.get(key);
    if (!membership) throw new MembershipNotFoundError();
    if (membership.role === "OWNER" && role !== "OWNER") {
      const owners = [...this.memberships.values()].filter((item) => item.organizationId === organizationId && item.role === "OWNER");
      if (owners.length <= 1) throw new LastOwnerError();
    }
    const updated = { ...membership, role };
    this.memberships.set(key, updated);
    return updated;
  }

  async removeMembership(organizationId: string, userId: string): Promise<void> {
    const key = this.key(organizationId, userId);
    const membership = this.memberships.get(key);
    if (!membership) throw new MembershipNotFoundError();
    if (membership.role === "OWNER") {
      const owners = [...this.memberships.values()].filter((item) => item.organizationId === organizationId && item.role === "OWNER");
      if (owners.length <= 1) throw new LastOwnerError();
    }
    this.memberships.delete(key);
  }
}

function request(path: string, userId: string | null, body?: unknown, cookie?: string, method?: string): Request {
  return new Request(`http://localhost${path}`, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(userId ? { "x-test-user-id": userId } : {}),
      ...(cookie ? { cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("organization and membership handlers", () => {
  let repository: MemoryOrganizationRepository;
  let owner: UserProfile;
  let admin: UserProfile;
  let member: UserProfile;
  let outsider: UserProfile;
  let ownerHandlers: ReturnType<typeof createOrganizationHandlers>;

  beforeEach(() => {
    repository = new MemoryOrganizationRepository();
    owner = repository.seedUser("owner@example.com");
    admin = repository.seedUser("admin@example.com");
    member = repository.seedUser("member@example.com");
    outsider = repository.seedUser("outsider@example.com");
    const getUser = async (incoming: Request) => repository.users.get(incoming.headers.get("x-test-user-id") ?? "") ?? null;
    ownerHandlers = createOrganizationHandlers(repository, getUser);
  });

  async function createOrg(name = "Acme Security"): Promise<string> {
    const response = await ownerHandlers.create(request("/api/organizations", owner.id, { name }));
    return (await response.json()).organization.id;
  }

  function handlersFor(user: UserProfile) {
    return createOrganizationHandlers(repository, async () => user);
  }

  it("creates organizations atomically with the creator as OWNER and lists only memberships", async () => {
    const response = await ownerHandlers.create(request("/api/organizations", owner.id, { name: "  Acme Security  " }));
    const body = await response.json();
    const list = await ownerHandlers.list(request("/api/organizations", owner.id));
    expect(response.status).toBe(201);
    expect(body.organization.name).toBe("Acme Security");
    expect(body.role).toBe("OWNER");
    expect(response.headers.get("set-cookie")).toContain(`${CURRENT_ORGANIZATION_COOKIE_NAME}=`);
    expect((await list.json()).organizations).toHaveLength(1);
    expect((await ownerHandlers.create(request("/api/organizations", owner.id, { name: "x" }))).status).toBe(400);
  });

  it("requires an authenticated user for every organization operation", async () => {
    const unauthenticated = await ownerHandlers.list(request("/api/organizations", null));
    const invalid = await ownerHandlers.create(request("/api/organizations", owner.id, { name: " " }));
    expect(unauthenticated.status).toBe(401);
    expect(invalid.status).toBe(400);
  });

  it("applies OWNER, ADMIN, and MEMBER capabilities to member management", async () => {
    const organizationId = await createOrg();
    expect((await ownerHandlers.addMember(request("/members", owner.id, { email: admin.email, role: "ADMIN" }), organizationId)).status).toBe(201);
    expect((await ownerHandlers.addMember(request("/members", owner.id, { email: member.email }), organizationId)).status).toBe(201);

    const adminHandlers = handlersFor(admin);
    const memberHandlers = handlersFor(member);
    expect((await adminHandlers.addMember(request("/members", admin.id, { email: outsider.email }), organizationId)).status).toBe(201);
    expect((await adminHandlers.addMember(request("/members", admin.id, { email: "new@example.com", role: "ADMIN" }), organizationId)).status).toBe(403);
    expect((await adminHandlers.addMember(request("/members", admin.id, { email: "new@example.com", role: "OWNER" }), organizationId)).status).toBe(403);
    expect((await adminHandlers.changeMemberRole(request("/members", admin.id, { role: "ADMIN" }), organizationId, member.id)).status).toBe(403);
    expect((await adminHandlers.changeMemberRole(request("/members", admin.id, { role: "MEMBER" }), organizationId, admin.id)).status).toBe(403);
    expect((await memberHandlers.members(request("/members", member.id), organizationId)).status).toBe(200);
    expect((await memberHandlers.addMember(request("/members", member.id, { email: outsider.email }), organizationId)).status).toBe(403);
    expect((await memberHandlers.removeMember(request("/members", member.id, undefined, undefined, "DELETE"), organizationId, outsider.id)).status).toBe(403);
    expect((await ownerHandlers.changeMemberRole(request("/members", owner.id, { role: "ADMIN" }, undefined, "PATCH"), organizationId, member.id)).status).toBe(200);
    expect((await adminHandlers.removeMember(request("/members", admin.id, undefined, undefined, "DELETE"), organizationId, member.id)).status).toBe(403);
    expect((await adminHandlers.removeMember(request("/members", admin.id, undefined, undefined, "DELETE"), organizationId, admin.id)).status).toBe(403);
  });

  it("prevents cross-tenant organization reads, member reads, and current-org selection", async () => {
    const ownOrganizationId = await createOrg("Own org");
    const outsiderHandlers = handlersFor(outsider);
    const otherResponse = await outsiderHandlers.create(request("/api/organizations", outsider.id, { name: "Other org" }));
    const otherOrganizationId = (await otherResponse.json()).organization.id;

    expect((await ownerHandlers.get(request("/org", owner.id), otherOrganizationId)).status).toBe(404);
    expect((await ownerHandlers.members(request("/members", owner.id), otherOrganizationId)).status).toBe(404);
    expect((await ownerHandlers.setCurrent(request("/current", owner.id, { organizationId: otherOrganizationId })).then((res) => res.status))).toBe(404);
    expect((await ownerHandlers.get(request("/org", owner.id), ownOrganizationId)).status).toBe(200);
    expect((await outsiderHandlers.list(request("/orgs", outsider.id)).then((res) => res.json())).organizations)
      .not.toContain(expect.objectContaining({ id: ownOrganizationId }));
  });

  it("validates and returns the current organization context only for a member", async () => {
    const organizationId = await createOrg();
    const selected = await ownerHandlers.setCurrent(request("/current", owner.id, { organizationId }));
    const cookie = selected.headers.get("set-cookie")!.split(";")[0];
    const current = await ownerHandlers.current(request("/current", owner.id, undefined, cookie));
    expect((await current.json()).organization.id).toBe(organizationId);

    const outsiderCurrent = await handlersFor(outsider).current(request("/current", outsider.id, undefined, cookie));
    expect((await outsiderCurrent.json()).organization).toBeNull();
    expect(outsiderCurrent.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("prevents removal or demotion of the last OWNER but permits it when another owner remains", async () => {
    const organizationId = await createOrg();
    expect((await ownerHandlers.removeMember(request("/members", owner.id, undefined, undefined, "DELETE"), organizationId, owner.id)).status).toBe(409);
    expect((await ownerHandlers.changeMemberRole(request("/members", owner.id, { role: "MEMBER" }, undefined, "PATCH"), organizationId, owner.id)).status).toBe(409);

    await ownerHandlers.addMember(request("/members", owner.id, { email: admin.email, role: "OWNER" }), organizationId);
    expect((await ownerHandlers.removeMember(request("/members", owner.id, undefined, undefined, "DELETE"), organizationId, owner.id)).status).toBe(200);
  });

  it("provides reusable tenant filters and ownership assertions", async () => {
    const organizationId = await createOrg();
    const { getOrganization } = await import("../lib/organizations/organization-service");
    const context = await getOrganization(repository, owner.id, organizationId);
    expect(tenantWhere(context)).toEqual({ organizationId });
    expect(() => assertSameOrganization(context, "other-organization")).toThrowError("Resource not found.");
  });
});
