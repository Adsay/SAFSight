import type { OrganizationRole as PrismaOrganizationRole } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import {
  DuplicateMembershipError,
  LastOwnerError,
  MembershipNotFoundError,
  type OrganizationRepository,
} from "./organization-service";

function hasPrismaCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

export const organizationRepository: OrganizationRepository = {
  async createOrganizationWithOwner(name, ownerUserId) {
    return prisma.$transaction(async (transaction) => {
      const organization = await transaction.organization.create({ data: { name } });
      const membership = await transaction.membership.create({
        data: { organizationId: organization.id, userId: ownerUserId, role: "OWNER" },
        select: { id: true, organizationId: true, userId: true, role: true },
      });
      return {
        userId: ownerUserId,
        organizationId: organization.id,
        membershipId: membership.id,
        role: membership.role,
        organization,
      };
    });
  },

  async listOrganizationsForUser(userId) {
    const memberships = await prisma.membership.findMany({
      where: { userId },
      select: {
        id: true,
        role: true,
        organization: { select: { id: true, name: true, createdAt: true, updatedAt: true } },
      },
      orderBy: { createdAt: "asc" },
    });
    return memberships.map(({ id, role, organization }) => ({ membershipId: id, role, organization }));
  },

  async findOrganization(organizationId) {
    return prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, name: true, createdAt: true, updatedAt: true },
    });
  },

  async findMembership(organizationId, userId) {
    return prisma.membership.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      select: {
        id: true,
        organizationId: true,
        userId: true,
        role: true,
        createdAt: true,
        user: { select: { id: true, email: true } },
      },
    });
  },

  async listMembers(organizationId) {
    return prisma.membership.findMany({
      where: { organizationId },
      select: {
        id: true,
        organizationId: true,
        userId: true,
        role: true,
        createdAt: true,
        user: { select: { id: true, email: true } },
      },
      orderBy: [{ role: "asc" }, { createdAt: "asc" }],
    });
  },

  async findUserByEmail(email) {
    return prisma.user.findUnique({ where: { email }, select: { id: true, email: true } });
  },

  async createMembership(organizationId, userId, role) {
    try {
      return await prisma.membership.create({
        data: { organizationId, userId, role: role as PrismaOrganizationRole },
        select: {
          id: true,
          organizationId: true,
          userId: true,
          role: true,
          createdAt: true,
          user: { select: { id: true, email: true } },
        },
      });
    } catch (error) {
      if (hasPrismaCode(error, "P2002")) throw new DuplicateMembershipError();
      throw error;
    }
  },

  async changeMembershipRole(organizationId, userId, role) {
    return prisma.$transaction(async (transaction) => {
      const membership = await transaction.membership.findUnique({
        where: { organizationId_userId: { organizationId, userId } },
        select: { role: true },
      });
      if (!membership) throw new MembershipNotFoundError();
      if (membership.role === "OWNER" && role !== "OWNER") {
        const ownerCount = await transaction.membership.count({ where: { organizationId, role: "OWNER" } });
        if (ownerCount <= 1) throw new LastOwnerError();
      }
      return transaction.membership.update({
        where: { organizationId_userId: { organizationId, userId } },
        data: { role: role as PrismaOrganizationRole },
        select: {
          id: true,
          organizationId: true,
          userId: true,
          role: true,
          createdAt: true,
          user: { select: { id: true, email: true } },
        },
      });
    }, { isolationLevel: "Serializable" });
  },

  async removeMembership(organizationId, userId) {
    await prisma.$transaction(async (transaction) => {
      const membership = await transaction.membership.findUnique({
        where: { organizationId_userId: { organizationId, userId } },
        select: { role: true },
      });
      if (!membership) throw new MembershipNotFoundError();
      if (membership.role === "OWNER") {
        const ownerCount = await transaction.membership.count({ where: { organizationId, role: "OWNER" } });
        if (ownerCount <= 1) throw new LastOwnerError();
      }
      await transaction.membership.delete({ where: { organizationId_userId: { organizationId, userId } } });
    }, { isolationLevel: "Serializable" });
  },
};