import type { AssetType as PrismaAssetType } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import {
  AssetNotFoundError,
  DuplicateAssetError,
  type AssetRepository,
} from "./asset-service";

const assetSelect = {
  id: true,
  organizationId: true,
  type: true,
  value: true,
  createdAt: true,
  updatedAt: true,
};

function hasPrismaCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

export const assetRepository: AssetRepository = {
  async create(organizationId, type, value) {
    try {
      return await prisma.asset.create({
        data: { organizationId, type: type as PrismaAssetType, value },
        select: assetSelect,
      });
    } catch (error) {
      if (hasPrismaCode(error, "P2002")) throw new DuplicateAssetError();
      throw error;
    }
  },

  async list(organizationId) {
    return prisma.asset.findMany({
      where: { organizationId },
      select: assetSelect,
      orderBy: { createdAt: "asc" },
    });
  },

  async find(organizationId, assetId) {
    return prisma.asset.findFirst({
      where: { id: assetId, organizationId },
      select: assetSelect,
    });
  },

  async update(organizationId, assetId, type, value) {
    try {
      return await prisma.$transaction(async (transaction) => {
        const result = await transaction.asset.updateMany({
          where: { id: assetId, organizationId },
          data: { type: type as PrismaAssetType, value },
        });
        if (result.count === 0) throw new AssetNotFoundError();

        const asset = await transaction.asset.findFirst({
          where: { id: assetId, organizationId },
          select: assetSelect,
        });
        if (!asset) throw new AssetNotFoundError();
        return asset;
      });
    } catch (error) {
      if (hasPrismaCode(error, "P2002")) throw new DuplicateAssetError();
      throw error;
    }
  },

  async delete(organizationId, assetId) {
    const result = await prisma.asset.deleteMany({ where: { id: assetId, organizationId } });
    if (result.count === 0) throw new AssetNotFoundError();
  },
};