import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScanResult } from "@safsight/contracts";
import { scanRepository } from "../lib/scans/scan-repository";
import { ScanAssetMismatchError, ScanNotFoundError, ScanResultAlreadyExistsError } from "../lib/scans/scan-service";

const { transaction, prismaMock } = vi.hoisted(() => {
  const transaction = {
    asset: { findFirst: vi.fn() },
    scan: { create: vi.fn(), findFirst: vi.fn() },
    scanResult: { create: vi.fn() },
  };
  const prismaMock = {
    ...transaction,
    scan: { ...transaction.scan, findMany: vi.fn(), deleteMany: vi.fn() },
    $transaction: vi.fn(async (callback: (tx: typeof transaction) => unknown) => callback(transaction)),
  };
  return { transaction, prismaMock };
});

vi.mock("../lib/db/client", () => ({ prisma: prismaMock }));

const baseScan = {
  id: "scan-1",
  organizationId: "org-1",
  assetId: "asset-1",
  requestId: "request-1",
  targetType: "DOMAIN" as const,
  targetValue: "example.com",
  createdAt: new Date("2026-10-03T00:00:00.000Z"),
};

const baseResult: ScanResult = {
  contractVersion: "1.0.0",
  requestId: "request-1",
  status: "SUCCEEDED",
  engine: { id: "domain", version: "1.0.0" },
  findings: [{ code: "DUPLICATE", title: "One", severity: "LOW" }, { code: "DUPLICATE", title: "Two", severity: "HIGH" }],
};

describe("Prisma scan repository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("scopes asset resolution and scan creation to the organization", async () => {
    transaction.asset.findFirst.mockResolvedValue({ type: "DOMAIN", value: "example.com" });
    transaction.scan.create.mockResolvedValue(baseScan);

    await scanRepository.create("org-1", "asset-1", {
      contractVersion: "1.0.0",
      requestId: "request-1",
      target: { type: "DOMAIN", value: "example.com" },
    });

    expect(transaction.asset.findFirst).toHaveBeenCalledWith({
      where: { id: "asset-1", organizationId: "org-1" },
      select: { type: true, value: true },
    });
    expect(transaction.scan.create.mock.calls[0][0].data).toMatchObject({
      organizationId: "org-1",
      assetId: "asset-1",
      targetValue: "example.com",
    });
    expect(prismaMock.$transaction).toHaveBeenCalledOnce();
  });

  it("rejects missing, cross-organization, or mismatched assets before creating a scan", async () => {
    transaction.asset.findFirst.mockResolvedValue(null);
    await expect(scanRepository.create("org-1", "asset-other", {
      contractVersion: "1.0.0",
      requestId: "request-1",
      target: { type: "DOMAIN", value: "example.com" },
    })).rejects.toBeInstanceOf(ScanAssetMismatchError);
    expect(transaction.scan.create).not.toHaveBeenCalled();

    transaction.asset.findFirst.mockResolvedValue({ type: "DOMAIN", value: "different.example" });
    await expect(scanRepository.create("org-1", "asset-1", {
      contractVersion: "1.0.0",
      requestId: "request-1",
      target: { type: "DOMAIN", value: "example.com" },
    })).rejects.toBeInstanceOf(ScanAssetMismatchError);
    expect(transaction.scan.create).not.toHaveBeenCalled();
  });

  it("adds organization predicates to list, find, and delete operations", async () => {
    prismaMock.scan.findMany.mockResolvedValue([]);
    prismaMock.scan.findFirst.mockResolvedValue(null);
    prismaMock.scan.deleteMany.mockResolvedValue({ count: 0 });

    await scanRepository.list("org-1");
    expect(prismaMock.scan.findMany.mock.calls[0][0].where).toEqual({ organizationId: "org-1" });
    expect(await scanRepository.find("org-2", "scan-1")).toBeNull();
    expect(prismaMock.scan.findFirst.mock.calls[0][0].where).toEqual({ organizationId: "org-2", id: "scan-1" });
    await expect(scanRepository.delete("org-3", "scan-1")).rejects.toBeInstanceOf(ScanNotFoundError);
    expect(prismaMock.scan.deleteMany.mock.calls[0][0].where).toEqual({ organizationId: "org-3", id: "scan-1" });
  });

  it("checks tenant and correlation inside a transaction and writes the complete result tree atomically", async () => {
    transaction.scan.findFirst.mockResolvedValue(baseScan);
    transaction.scanResult.create.mockResolvedValue({
      id: "result-1",
      scanId: "scan-1",
      contractVersion: "1.0.0",
      status: "SUCCEEDED",
      engineId: "domain",
      engineVersion: "1.0.0",
      startedAt: null,
      completedAt: null,
      error: null,
      findings: [],
    });

    await scanRepository.ingestResult("org-1", "scan-1", baseResult);

    expect(prismaMock.$transaction).toHaveBeenCalledOnce();
    expect(transaction.scan.findFirst.mock.calls[0][0].where).toEqual({
      organizationId: "org-1",
      id: "scan-1",
      requestId: "request-1",
    });
    const write = transaction.scanResult.create.mock.calls[0][0];
    expect(write.data.scan).toEqual({ connect: { id: "scan-1" } });
    expect(write.data.findings.create.map((finding: { position: number }) => finding.position)).toEqual([0, 1]);
    expect(write.data.findings.create.map((finding: { code: string }) => finding.code)).toEqual(["DUPLICATE", "DUPLICATE"]);
  });

  it("does not write a result when the tenant-scoped scan lookup fails", async () => {
    transaction.scan.findFirst.mockResolvedValue(null);
    await expect(scanRepository.ingestResult("org-other", "scan-1", baseResult)).rejects.toBeInstanceOf(ScanNotFoundError);
    expect(transaction.scanResult.create).not.toHaveBeenCalled();
    expect(transaction.scan.findFirst.mock.calls[0][0].where.organizationId).toBe("org-other");
  });

  it("translates the one-result unique constraint into an explicit conflict", async () => {
    transaction.scan.findFirst.mockResolvedValue(baseScan);
    transaction.scanResult.create.mockRejectedValue({ code: "P2014" });
    await expect(scanRepository.ingestResult("org-1", "scan-1", baseResult)).rejects.toBeInstanceOf(ScanResultAlreadyExistsError);
  });
});
