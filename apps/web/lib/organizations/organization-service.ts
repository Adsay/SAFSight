import { z } from "zod";

export const ORGANIZATION_ROLES = ["OWNER", "ADMIN", "MEMBER"] as const;
export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];

export interface OrganizationRecord {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrganizationMemberRecord {
  id: string;
  organizationId: string;
  userId: string;
  role: OrganizationRole;
  createdAt: Date;
  user: { id: string; email: string };
}

export interface OrganizationListItem {
  organization: OrganizationRecord;
  membershipId: string;
  role: OrganizationRole;
}

export interface OrganizationContext {
  userId: string;
  organizationId: string;
  membershipId: string;
  role: OrganizationRole;
  organization: OrganizationRecord;
}

export interface OrganizationRepository {
  createOrganizationWithOwner(name: string, ownerUserId: string): Promise<OrganizationContext>;
  listOrganizationsForUser(userId: string): Promise<OrganizationListItem[]>;
  findOrganization(organizationId: string): Promise<OrganizationRecord | null>;
  findMembership(organizationId: string, userId: string): Promise<OrganizationMemberRecord | null>;
  listMembers(organizationId: string): Promise<OrganizationMemberRecord[]>;
  findUserByEmail(email: string): Promise<{ id: string; email: string } | null>;
  createMembership(organizationId: string, userId: string, role: OrganizationRole): Promise<OrganizationMemberRecord>;
  changeMembershipRole(organizationId: string, userId: string, role: OrganizationRole): Promise<OrganizationMemberRecord>;
  removeMembership(organizationId: string, userId: string): Promise<void>;
}

export class OrganizationError extends Error {
  constructor(
    public readonly code:
      | "unauthenticated"
      | "invalid_request"
      | "forbidden"
      | "not_found"
      | "duplicate_membership"
      | "last_owner",
    message: string,
    public readonly issues?: Array<{ field: string; message: string }>,
  ) {
    super(message);
    this.name = "OrganizationError";
  }
}

export class DuplicateMembershipError extends Error {
  constructor() {
    super("This user is already a member of the organization.");
    this.name = "DuplicateMembershipError";
  }
}

export class LastOwnerError extends Error {
  constructor() {
    super("An organization must have at least one owner.");
    this.name = "LastOwnerError";
  }
}

export class MembershipNotFoundError extends Error {
  constructor() {
    super("Organization membership was not found.");
    this.name = "MembershipNotFoundError";
  }
}

const organizationInputSchema = z.object({ name: z.string().trim().min(2).max(120) });
const memberInputSchema = z.object({
  email: z.string().trim().email().max(254),
  role: z.enum(ORGANIZATION_ROLES).optional().default("MEMBER"),
});
const roleInputSchema = z.object({ role: z.enum(ORGANIZATION_ROLES) });

function parseInput<T>(schema: z.ZodType<T>, input: unknown, message: string): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new OrganizationError(
      "invalid_request",
      message,
      parsed.error.issues.map((issue) => ({ field: issue.path.join("."), message: issue.message })),
    );
  }
  return parsed.data;
}

export function parseOrganizationInput(input: unknown): { name: string } {
  return parseInput(organizationInputSchema, input, "Enter an organization name between 2 and 120 characters.");
}

export function parseMemberInput(input: unknown): { email: string; role: OrganizationRole } {
  return parseInput(memberInputSchema, input, "Enter a valid member email and role.");
}

export function parseRoleInput(input: unknown): { role: OrganizationRole } {
  return parseInput(roleInputSchema, input, "Select a valid organization role.");
}

export async function requireOrganizationContext(
  repository: OrganizationRepository,
  userId: string,
  organizationId: string,
): Promise<OrganizationContext> {
  const membership = await repository.findMembership(organizationId, userId);
  if (!membership) throw new OrganizationError("not_found", "Organization not found.");
  const organization = await repository.findOrganization(organizationId);
  if (!organization) throw new OrganizationError("not_found", "Organization not found.");
  return {
    userId,
    organizationId,
    membershipId: membership.id,
    role: membership.role,
    organization,
  };
}

export function requireOrganizationRole(
  context: OrganizationContext,
  allowedRoles: readonly OrganizationRole[],
): void {
  if (!allowedRoles.includes(context.role)) {
    throw new OrganizationError("forbidden", "Your organization role does not allow this action.");
  }
}

export function assertSameOrganization(context: OrganizationContext, resourceOrganizationId: string): void {
  if (context.organizationId !== resourceOrganizationId) {
    throw new OrganizationError("not_found", "Resource not found.");
  }
}

export function tenantWhere(context: OrganizationContext): { organizationId: string } {
  return { organizationId: context.organizationId };
}

export async function createOrganization(
  repository: OrganizationRepository,
  userId: string,
  input: unknown,
): Promise<OrganizationContext> {
  const { name } = parseOrganizationInput(input);
  return repository.createOrganizationWithOwner(name, userId);
}

export async function listOrganizations(repository: OrganizationRepository, userId: string): Promise<OrganizationListItem[]> {
  return repository.listOrganizationsForUser(userId);
}

export async function getOrganization(
  repository: OrganizationRepository,
  userId: string,
  organizationId: string,
): Promise<OrganizationContext> {
  return requireOrganizationContext(repository, userId, organizationId);
}

export async function getOrganizationMembers(
  repository: OrganizationRepository,
  userId: string,
  organizationId: string,
): Promise<{ context: OrganizationContext; members: OrganizationMemberRecord[] }> {
  const context = await requireOrganizationContext(repository, userId, organizationId);
  return { context, members: await repository.listMembers(context.organizationId) };
}

export async function addOrganizationMember(
  repository: OrganizationRepository,
  userId: string,
  organizationId: string,
  input: unknown,
): Promise<OrganizationMemberRecord> {
  const context = await requireOrganizationContext(repository, userId, organizationId);
  requireOrganizationRole(context, ["OWNER", "ADMIN"]);
  const { email, role } = parseMemberInput(input);
  if (context.role === "ADMIN" && role !== "MEMBER") {
    throw new OrganizationError("forbidden", "Admins can only add members with the MEMBER role.");
  }
  const user = await repository.findUserByEmail(email.toLowerCase());
  if (!user) throw new OrganizationError("not_found", "User not found.");
  try {
    return await repository.createMembership(context.organizationId, user.id, role);
  } catch (error) {
    if (error instanceof DuplicateMembershipError) {
      throw new OrganizationError("duplicate_membership", error.message);
    }
    throw error;
  }
}

export async function changeOrganizationMemberRole(
  repository: OrganizationRepository,
  actorUserId: string,
  organizationId: string,
  memberUserId: string,
  input: unknown,
): Promise<OrganizationMemberRecord> {
  const context = await requireOrganizationContext(repository, actorUserId, organizationId);
  requireOrganizationRole(context, ["OWNER", "ADMIN"]);
  const { role } = parseRoleInput(input);
  const target = await repository.findMembership(context.organizationId, memberUserId);
  if (!target) throw new OrganizationError("not_found", "Organization member not found.");
  if (context.role === "ADMIN" && (target.role !== "MEMBER" || role !== "MEMBER")) {
    throw new OrganizationError("forbidden", "Admins cannot change admin or owner roles.");
  }
  try {
    return await repository.changeMembershipRole(context.organizationId, memberUserId, role);
  } catch (error) {
    if (error instanceof LastOwnerError) throw new OrganizationError("last_owner", error.message);
    if (error instanceof MembershipNotFoundError) {
      throw new OrganizationError("not_found", "Organization member not found.");
    }
    throw error;
  }
}

export async function removeOrganizationMember(
  repository: OrganizationRepository,
  actorUserId: string,
  organizationId: string,
  memberUserId: string,
): Promise<void> {
  const context = await requireOrganizationContext(repository, actorUserId, organizationId);
  requireOrganizationRole(context, ["OWNER", "ADMIN"]);
  const target = await repository.findMembership(context.organizationId, memberUserId);
  if (!target) throw new OrganizationError("not_found", "Organization member not found.");
  if (context.role === "ADMIN" && target.role !== "MEMBER") {
    throw new OrganizationError("forbidden", "Admins cannot remove admins or owners.");
  }
  try {
    await repository.removeMembership(context.organizationId, memberUserId);
  } catch (error) {
    if (error instanceof LastOwnerError) throw new OrganizationError("last_owner", error.message);
    if (error instanceof MembershipNotFoundError) {
      throw new OrganizationError("not_found", "Organization member not found.");
    }
    throw error;
  }
}

export async function getCurrentOrganizationContext(
  repository: OrganizationRepository,
  userId: string,
  organizationId: string | null,
): Promise<OrganizationContext | null> {
  if (!organizationId) return null;
  return requireOrganizationContext(repository, userId, organizationId);
}