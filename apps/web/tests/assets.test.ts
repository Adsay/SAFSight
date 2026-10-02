import { beforeEach, describe, expect, it } from "vitest";
import type { UserProfile } from "../lib/auth/auth-service";
import { createAssetHandlers } from "../lib/assets/asset-http";
import {
  AssetNotFoundError,
  DuplicateAssetError,
  type AssetRecord,
  type AssetRepository,
  type AssetType,
} from "../lib/assets/asset-service";
import {
  DuplicateMembershipError,
  LastOwnerError,
  MembershipNotFoundError,
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

  seedOrganization(name: string): OrganizationRecord {
    const organization = {
      id: `organization-${++this.sequence}`,
      name,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.organizations.set(organization.id, organization);
    return organization;
  }

  addMembership(organizationId: string, userId: string, role: OrganizationRole): OrganizationMemberRecord {
    const membership = this.newMembership(organizationId, userId, role);
    this.memberships.set(this.key(organizationId, userId), membership);
    return membership;
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
    const organization = this.seedOrganization(name);
    const membership = this.addMembership(organization.id, ownerUserId, "OWNER");
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

  async createMembership(
    organizationId: string,
    userId: string,
    role: OrganizationRole,
  ): Promise<OrganizationMemberRecord> {
    const key = this.key(organizationId, userId);
    if (this.memberships.has(key)) throw new DuplicateMembershipError();
    const membership = this.newMembership(organizationId, userId, role);
    this.memberships.set(key, membership);
    return membership;
  }

  async changeMembershipRole(
    organizationId: string,
    userId: string,
    role: OrganizationRole,
  ): Promise<OrganizationMemberRecord> {
    const key = this.key(organizationId, userId);
    const membership = this.memberships.get(key);
    if (!membership) throw new MembershipNotFoundError();
    if (membership.role === "OWNER" && role !== "OWNER") {
      const owners = [...this.memberships.values()]
        .filter((item) => item.organizationId === organizationId && item.role === "OWNER");
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
      const owners = [...this.memberships.values()]
        .filter((item) => item.organizationId === organizationId && item.role === "OWNER");
      if (owners.length <= 1) throw new LastOwnerError();
    }
    this.memberships.delete(key);
  }
}

class MemoryAssetRepository implements AssetRepository {
  readonly assets = new Map<string, AssetRecord>();
  private sequence = 0;

  async create(organizationId: string, type: AssetType, value: string): Promise<AssetRecord> {
    this.assertUnique(organizationId, type, value);
    const now = new Date();
    const asset = {
      id: `asset-${++this.sequence}`,
      organizationId,
      type,
      value,
      createdAt: now,
      updatedAt: now,
    };
    this.assets.set(asset.id, asset);
    return asset;
  }

  async list(organizationId: string): Promise<AssetRecord[]> {
    return [...this.assets.values()]
      .filter((asset) => asset.organizationId === organizationId)
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
  }

  async find(organizationId: string, assetId: string): Promise<AssetRecord | null> {
    const asset = this.assets.get(assetId);
    return asset?.organizationId === organizationId ? asset : null;
  }

  async update(
    organizationId: string,
    assetId: string,
    type: AssetType,
    value: string,
  ): Promise<AssetRecord> {
    const existing = await this.find(organizationId, assetId);
    if (!existing) throw new AssetNotFoundError();
    this.assertUnique(organizationId, type, value, assetId);
    const updated = { ...existing, type, value, updatedAt: new Date() };
    this.assets.set(assetId, updated);
    return updated;
  }

  async delete(organizationId: string, assetId: string): Promise<void> {
    if (!await this.find(organizationId, assetId)) throw new AssetNotFoundError();
    this.assets.delete(assetId);
  }

  private assertUnique(organizationId: string, type: AssetType, value: string, excludingAssetId?: string): void {
    const duplicate = [...this.assets.values()].some((asset) =>
      asset.id !== excludingAssetId
      && asset.organizationId === organizationId
      && asset.type === type
      && asset.value === value,
    );
    if (duplicate) throw new DuplicateAssetError();
  }
}

function makeRequest(path: string, method: string, userId: string | null, body?: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(userId ? { "x-test-user-id": userId } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function collectionRequest(organizationId: string, method: string, userId: string | null, body?: unknown): Request {
  return makeRequest(`/api/organizations/${organizationId}/assets`, method, userId, body);
}

function itemRequest(
  organizationId: string,
  assetId: string,
  method: string,
  userId: string | null,
  body?: unknown,
): Request {
  return makeRequest(`/api/organizations/${organizationId}/assets/${assetId}`, method, userId, body);
}

async function expectError(response: Response, status: number, code: string): Promise<void> {
  expect(response.status).toBe(status);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(await response.json()).toMatchObject({ error: code, message: expect.any(String) });
}

describe("asset handlers", () => {
  let organizationRepository: MemoryOrganizationRepository;
  let assetRepository: MemoryAssetRepository;
  let handlers: ReturnType<typeof createAssetHandlers>;
  let owner: UserProfile;
  let admin: UserProfile;
  let member: UserProfile;
  let outsider: UserProfile;
  let organizationId: string;
  let otherOrganizationId: string;

  beforeEach(() => {
    organizationRepository = new MemoryOrganizationRepository();
    assetRepository = new MemoryAssetRepository();
    owner = organizationRepository.seedUser("owner@example.com");
    admin = organizationRepository.seedUser("admin@example.com");
    member = organizationRepository.seedUser("member@example.com");
    outsider = organizationRepository.seedUser("outsider@example.com");
    organizationId = organizationRepository.seedOrganization("Acme Security").id;
    otherOrganizationId = organizationRepository.seedOrganization("Other Security").id;
    organizationRepository.addMembership(organizationId, owner.id, "OWNER");
    organizationRepository.addMembership(organizationId, admin.id, "ADMIN");
    organizationRepository.addMembership(organizationId, member.id, "MEMBER");

    const getRequestUser = async (request: Request) =>
      organizationRepository.users.get(request.headers.get("x-test-user-id") ?? "") ?? null;
    handlers = createAssetHandlers(assetRepository, organizationRepository, getRequestUser);
  });

  it("rejects unauthenticated access and authenticated non-members", async () => {
    await expectError(
      await handlers.list(collectionRequest(organizationId, "GET", null), organizationId),
      401,
      "unauthenticated",
    );
    await expectError(
      await handlers.create(collectionRequest(organizationId, "POST", null, { type: "DOMAIN", value: "example.com" }), organizationId),
      401,
      "unauthenticated",
    );
    await expectError(
      await handlers.list(collectionRequest(organizationId, "GET", outsider.id), organizationId),
      404,
      "not_found",
    );
  });

  it("lets OWNER create, list, read, update, and delete assets through collection and item operations", async () => {
    const createdResponse = await handlers.create(
      collectionRequest(organizationId, "POST", owner.id, { type: "DOMAIN", value: "example.com" }),
      organizationId,
    );
    expect(createdResponse.status).toBe(201);
    expect(createdResponse.headers.get("Cache-Control")).toBe("no-store");
    const created = (await createdResponse.json()).asset as AssetRecord;
    expect(created).toMatchObject({ organizationId, type: "DOMAIN", value: "example.com" });

    const listedResponse = await handlers.list(collectionRequest(organizationId, "GET", owner.id), organizationId);
    expect(listedResponse.status).toBe(200);
    expect((await listedResponse.json()).assets).toHaveLength(1);

    const readResponse = await handlers.get(
      itemRequest(organizationId, created.id, "GET", owner.id),
      organizationId,
      created.id,
    );
    expect(readResponse.status).toBe(200);
    expect((await readResponse.json()).asset.id).toBe(created.id);

    const updatedResponse = await handlers.update(
      itemRequest(organizationId, created.id, "PATCH", owner.id, { type: "WEBSITE", value: "HTTPS://Example.COM:443" }),
      organizationId,
      created.id,
    );
    expect(updatedResponse.status).toBe(200);
    expect((await updatedResponse.json()).asset).toMatchObject({ type: "WEBSITE", value: "https://example.com/" });

    const deletedResponse = await handlers.delete(
      itemRequest(organizationId, created.id, "DELETE", owner.id),
      organizationId,
      created.id,
    );
    expect(deletedResponse.status).toBe(200);
    expect(deletedResponse.headers.get("Cache-Control")).toBe("no-store");
    expect(await deletedResponse.json()).toEqual({ success: true });
    await expectError(
      await handlers.get(itemRequest(organizationId, created.id, "GET", owner.id), organizationId, created.id),
      404,
      "not_found",
    );
  });

  it("lets ADMIN create, read, update, and delete assets", async () => {
    const createdResponse = await handlers.create(
      collectionRequest(organizationId, "POST", admin.id, { type: "EMAIL", value: "ADMIN@EXAMPLE.COM" }),
      organizationId,
    );
    expect(createdResponse.status).toBe(201);
    const created = (await createdResponse.json()).asset as AssetRecord;
    expect(created.value).toBe("admin@example.com");

    expect((await handlers.list(collectionRequest(organizationId, "GET", admin.id), organizationId)).status).toBe(200);
    expect((await handlers.get(itemRequest(organizationId, created.id, "GET", admin.id), organizationId, created.id)).status).toBe(200);
    expect((await handlers.update(
      itemRequest(organizationId, created.id, "PATCH", admin.id, { value: "updated@example.com" }),
      organizationId,
      created.id,
    )).status).toBe(200);
    expect((await handlers.delete(itemRequest(organizationId, created.id, "DELETE", admin.id), organizationId, created.id)).status).toBe(200);
  });

  it("allows MEMBER reads but rejects all write operations", async () => {
    const createdResponse = await handlers.create(
      collectionRequest(organizationId, "POST", owner.id, { type: "DOMAIN", value: "readable.example" }),
      organizationId,
    );
    const created = (await createdResponse.json()).asset as AssetRecord;

    expect((await handlers.list(collectionRequest(organizationId, "GET", member.id), organizationId)).status).toBe(200);
    expect((await handlers.get(itemRequest(organizationId, created.id, "GET", member.id), organizationId, created.id)).status).toBe(200);
    await expectError(
      await handlers.create(collectionRequest(organizationId, "POST", member.id, { type: "DOMAIN", value: "new.example" }), organizationId),
      403,
      "forbidden",
    );
    await expectError(
      await handlers.update(itemRequest(organizationId, created.id, "PATCH", member.id, { value: "changed.example" }), organizationId, created.id),
      403,
      "forbidden",
    );
    await expectError(
      await handlers.delete(itemRequest(organizationId, created.id, "DELETE", member.id), organizationId, created.id),
      403,
      "forbidden",
    );
    expect((await assetRepository.find(organizationId, created.id))?.value).toBe("readable.example");
  });

  it("rejects cross-organization asset reads and mutations", async () => {
    const otherAsset = await assetRepository.create(otherOrganizationId, "DOMAIN", "private.example");

    await expectError(
      await handlers.get(itemRequest(organizationId, otherAsset.id, "GET", owner.id), organizationId, otherAsset.id),
      404,
      "not_found",
    );
    await expectError(
      await handlers.update(itemRequest(organizationId, otherAsset.id, "PATCH", owner.id, { value: "changed.example" }), organizationId, otherAsset.id),
      404,
      "not_found",
    );
    await expectError(
      await handlers.delete(itemRequest(organizationId, otherAsset.id, "DELETE", owner.id), organizationId, otherAsset.id),
      404,
      "not_found",
    );
    expect((await assetRepository.find(otherOrganizationId, otherAsset.id))?.value).toBe("private.example");
  });

  it("trims and canonicalizes DOMAIN values and rejects URL/path/query/fragment forms", async () => {
    const response = await handlers.create(
      collectionRequest(organizationId, "POST", owner.id, { type: "DOMAIN", value: "  EXAMPLE.COM  " }),
      organizationId,
    );
    expect(response.status).toBe(201);
    expect((await response.json()).asset.value).toBe("example.com");

    for (const value of [
      "https://protocol-case.example",
      "path-case.example/path",
      "query-case.example?query=1",
      "fragment-case.example#fragment",
      "bad..example.com",
      "-bad.example.com",
    ]) {
      await expectError(
        await handlers.create(collectionRequest(organizationId, "POST", owner.id, { type: "DOMAIN", value }), organizationId),
        400,
        "invalid_request",
      );
    }
  });

  it("trims and lowercases EMAIL values and enforces the 254-character limit", async () => {
    const response = await handlers.create(
      collectionRequest(organizationId, "POST", owner.id, { type: "EMAIL", value: "  Person@Example.COM  " }),
      organizationId,
    );
    expect(response.status).toBe(201);
    expect((await response.json()).asset.value).toBe("person@example.com");

    const maxLengthEmail = `${"a".repeat(64)}@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(61)}`;
    expect(maxLengthEmail).toHaveLength(254);
    expect((await handlers.create(
      collectionRequest(organizationId, "POST", owner.id, { type: "EMAIL", value: maxLengthEmail }),
      organizationId,
    )).status).toBe(201);

    const overLimitEmail = `${"a".repeat(64)}@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(62)}`;
    expect(overLimitEmail).toHaveLength(255);
    await expectError(
      await handlers.create(collectionRequest(organizationId, "POST", owner.id, { type: "EMAIL", value: overLimitEmail }), organizationId),
      400,
      "invalid_request",
    );
    await expectError(
      await handlers.create(collectionRequest(organizationId, "POST", owner.id, { type: "EMAIL", value: "not-an-email" }), organizationId),
      400,
      "invalid_request",
    );
  });

  it("accepts and canonicalizes absolute HTTP/HTTPS WEBSITE URLs only", async () => {
    const httpResponse = await handlers.create(
      collectionRequest(organizationId, "POST", owner.id, { type: "WEBSITE", value: "  http://Example.COM:80/a/../b  " }),
      organizationId,
    );
    expect(httpResponse.status).toBe(201);
    expect((await httpResponse.json()).asset.value).toBe("http://example.com/b");

    const httpsResponse = await handlers.create(
      collectionRequest(organizationId, "POST", owner.id, { type: "WEBSITE", value: "HTTPS://Example.COM:443/path/../assets" }),
      organizationId,
    );
    expect(httpsResponse.status).toBe(201);
    expect((await httpsResponse.json()).asset.value).toBe("https://example.com/assets");

    for (const value of ["ftp://example.com", "/relative/path", "https://"]) {
      await expectError(
        await handlers.create(collectionRequest(organizationId, "POST", owner.id, { type: "WEBSITE", value }), organizationId),
        400,
        "invalid_request",
      );
    }
  });

  it("rejects duplicate assets after DOMAIN, EMAIL, and WEBSITE canonicalization", async () => {
    const duplicatePairs: Array<{ type: AssetType; first: string; second: string }> = [
      { type: "DOMAIN", first: "Example.COM", second: " example.com " },
      { type: "EMAIL", first: "Person@Example.com", second: " person@example.COM " },
      { type: "WEBSITE", first: "https://EXAMPLE.com:443", second: "https://example.com/" },
    ];

    for (const pair of duplicatePairs) {
      const firstResponse = await handlers.create(
        collectionRequest(organizationId, "POST", owner.id, { type: pair.type, value: pair.first }),
        organizationId,
      );
      expect(firstResponse.status).toBe(201);
      await expectError(
        await handlers.create(
          collectionRequest(organizationId, "POST", owner.id, { type: pair.type, value: pair.second }),
          organizationId,
        ),
        409,
        "duplicate_asset",
      );
    }
  });

  it("returns consistent not-found and validation JSON errors", async () => {
    const missingAssetId = "missing-asset";
    await expectError(
      await handlers.get(itemRequest(organizationId, missingAssetId, "GET", owner.id), organizationId, missingAssetId),
      404,
      "not_found",
    );
    await expectError(
      await handlers.update(itemRequest(organizationId, missingAssetId, "PATCH", owner.id, { value: "updated.example" }), organizationId, missingAssetId),
      404,
      "not_found",
    );
    await expectError(
      await handlers.delete(itemRequest(organizationId, missingAssetId, "DELETE", owner.id), organizationId, missingAssetId),
      404,
      "not_found",
    );

    const invalidType = await handlers.create(
      collectionRequest(organizationId, "POST", owner.id, { type: "IP", value: "192.0.2.1" }),
      organizationId,
    );
    const errorBody = await invalidType.json();
    expect(invalidType.status).toBe(400);
    expect(invalidType.headers.get("Cache-Control")).toBe("no-store");
    expect(errorBody).toMatchObject({ error: "invalid_request", message: expect.any(String) });
    expect(errorBody.issues).toBeInstanceOf(Array);
  });
});