import { prisma } from "@/lib/db/client";
import { DuplicateEmailError, type AuthRepository } from "./auth-service";

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

export const authRepository: AuthRepository = {
  async findUserByEmail(email) {
    return prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, passwordHash: true, createdAt: true },
    });
  },

  async createUser(email, passwordHash) {
    try {
      return await prisma.user.create({
        data: { email, passwordHash },
        select: { id: true, email: true, passwordHash: true, createdAt: true },
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) throw new DuplicateEmailError();
      throw error;
    }
  },

  async createSession(userId, tokenHash, expiresAt) {
    await prisma.session.create({ data: { userId, tokenHash, expiresAt } });
  },

  async findSession(tokenHash) {
    return prisma.session.findUnique({
      where: { tokenHash },
      select: {
        expiresAt: true,
        user: { select: { id: true, email: true, createdAt: true } },
      },
    });
  },

  async deleteSession(tokenHash) {
    await prisma.session.deleteMany({ where: { tokenHash } });
  },
};