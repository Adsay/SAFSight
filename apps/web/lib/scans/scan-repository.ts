import type { AssetType as PrismaAssetType, ScanStatus as PrismaScanStatus } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { scanRequestToPersistence, scanResultSelect, scanResultToPersistence, scanWithResultSelect, toScanWithResult } from "./scan-mapper";
import {
  DuplicateScanError,
  ScanAssetMismatchError,
  ScanNotFoundError,
  ScanResultAlreadyExistsError,
  type ScanRepository,
} from "./scan-service";

function hasPrismaCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

export const scanRepository: ScanRepository = {
  async create(organizationId, assetId, request) {
    try {
      return await prisma.$transaction(async (transaction) => {
        const asset = await transaction.asset.findFirst({
          where: { id: assetId, organizationId },
          select: { type: true, value: true },
        });
        if (!asset || asset.type !== request.target.type || asset.value !== request.target.value) {
          throw new ScanAssetMismatchError();
        }

        return transaction.scan.create({
          data: {
            organizationId,
            assetId,
            ...scanRequestToPersistence(request),
            targetType: request.target.type as PrismaAssetType,
          },
          select: {
            id: true,
            organizationId: true,
            assetId: true,
            requestId: true,
            targetType: true,
            targetValue: true,
            createdAt: true,
          },
        });
      });
    } catch (error) {
      if (hasPrismaCode(error, "P2002")) throw new DuplicateScanError();
      throw error;
    }
  },

  async list(organizationId) {
    const records = await prisma.scan.findMany({
      where: { organizationId },
      select: scanWithResultSelect(),
      orderBy: { createdAt: "asc" },
    });
    return records.map(toScanWithResult);
  },

  async find(organizationId, scanId) {
    const record = await prisma.scan.findFirst({
      where: { organizationId, id: scanId },
      select: scanWithResultSelect(),
    });
    return record ? toScanWithResult(record) : null;
  },

  async delete(organizationId, scanId) {
    const result = await prisma.scan.deleteMany({ where: { organizationId, id: scanId } });
    if (result.count === 0) throw new ScanNotFoundError();
  },

  async ingestResult(organizationId, scanId, result) {
    try {
      return await prisma.$transaction(async (transaction) => {
        const scan = await transaction.scan.findFirst({
          where: { organizationId, id: scanId, requestId: result.requestId },
          select: {
            id: true,
            organizationId: true,
            assetId: true,
            requestId: true,
            targetType: true,
            targetValue: true,
            createdAt: true,
          },
        });
        if (!scan) throw new ScanNotFoundError();

        const record = await transaction.scanResult.create({
          data: {
            scan: { connect: { id: scan.id } },
            ...scanResultToPersistence(result),
            status: result.status as PrismaScanStatus,
          },
          select: scanResultSelect(),
        });
        return toScanWithResult({ ...scan, result: record });
      });
    } catch (error) {
      if (hasPrismaCode(error, "P2002") || hasPrismaCode(error, "P2014")) {
        throw new ScanResultAlreadyExistsError();
      }
      throw error;
    }
  },
};
