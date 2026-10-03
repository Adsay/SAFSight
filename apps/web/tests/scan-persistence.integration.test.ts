import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ScanRequest, ScanResult } from "@safsight/contracts";
import { prisma } from "../lib/db/client";
import { scanRepository } from "../lib/scans/scan-repository";
import { createScan, DuplicateScanError, ingestScanResult, ScanResultAlreadyExistsError } from "../lib/scans/scan-service";

const testRequest: ScanRequest = {
  contractVersion: "1.0.0",
  requestId: "integration-request",
  target: { type: "DOMAIN", value: "integration.example" },
};

function testResult(requestId = testRequest.requestId, evidenceSummary = "Integration evidence"): ScanResult {
  return {
    contractVersion: "1.0.0",
    requestId,
    status: "FAILED",
    engine: { id: "integration-test", version: "1.0.0" },
    findings: [{
      code: "INTEGRATION_FINDING",
      title: "Integration finding",
      severity: "HIGH",
      evidence: [{ kind: "test", summary: evidenceSummary, data: { source: "vitest" } }],
    }],
    error: { code: "INTEGRATION_ERROR", message: "Expected test error", retryable: false },
  };
}

describe("scan persistence database integration", () => {
  let organizationA: string;
  let organizationB: string;
  let assetA: string;
  let assetB: string;

  beforeEach(async () => {
    const [orgA, orgB] = await Promise.all([
      prisma.organization.create({ data: { name: "M05 integration A" }, select: { id: true } }),
      prisma.organization.create({ data: { name: "M05 integration B" }, select: { id: true } }),
    ]);
    organizationA = orgA.id;
    organizationB = orgB.id;
    const [createdAssetA, createdAssetB] = await Promise.all([
      prisma.asset.create({ data: { organizationId: organizationA, type: "DOMAIN", value: "integration.example" }, select: { id: true } }),
      prisma.asset.create({ data: { organizationId: organizationB, type: "DOMAIN", value: "integration.example" }, select: { id: true } }),
    ]);
    assetA = createdAssetA.id;
    assetB = createdAssetB.id;
  });

  afterEach(async () => {
    await prisma.organization.deleteMany({ where: { id: { in: [organizationA, organizationB].filter(Boolean) } } });
  });

  async function createTestScan(orgId = organizationA, linkedAssetId = assetA, requestId = testRequest.requestId) {
    return createScan(scanRepository, orgId, linkedAssetId, { ...testRequest, requestId });
  }

  async function expectScanTreeRemoved(scanId: string): Promise<void> {
    expect(await prisma.scan.count({ where: { id: scanId } })).toBe(0);
    expect(await prisma.scanResult.count({ where: { scanId } })).toBe(0);
    expect(await prisma.scanError.count({ where: { scanResult: { scanId } } })).toBe(0);
    expect(await prisma.finding.count({ where: { scanResult: { scanId } } })).toBe(0);
    expect(await prisma.evidence.count({ where: { finding: { scanResult: { scanId } } } })).toBe(0);
  }

  it("enforces requestId uniqueness per organization and allows it in another organization", async () => {
    await createTestScan();
    await expect(createTestScan(organizationA, assetA)).rejects.toBeInstanceOf(DuplicateScanError);
    await expect(createTestScan(organizationB, assetB)).resolves.toMatchObject({ organizationId: organizationB });
  });

  it("enforces one persisted result per scan", async () => {
    const scan = await createTestScan();
    await ingestScanResult(scanRepository, organizationA, scan.id, testResult());
    await expect(ingestScanResult(scanRepository, organizationA, scan.id, testResult()))
      .rejects.toBeInstanceOf(ScanResultAlreadyExistsError);
    expect(await prisma.scanResult.count({ where: { scanId: scan.id } })).toBe(1);
  });

  it("enforces the same-organization Asset/Scan foreign key in PostgreSQL", async () => {
    await expect(prisma.scan.create({
      data: {
        organizationId: organizationA,
        assetId: assetB,
        requestId: "cross-organization-fk",
        targetType: "DOMAIN",
        targetValue: "integration.example",
      },
    })).rejects.toMatchObject({ code: "P2003" });
    expect(await prisma.scan.count({ where: { organizationId: organizationA } })).toBe(0);
  });

  it("cascades organization, asset, and scan deletions through results, errors, findings, and evidence", async () => {
    const assetScan = await createTestScan(organizationA, assetA, "asset-cascade");
    await ingestScanResult(scanRepository, organizationA, assetScan.id, testResult("asset-cascade"));
    await prisma.asset.delete({ where: { id: assetA } });
    await expectScanTreeRemoved(assetScan.id);

    const organizationScan = await createTestScan(organizationB, assetB, "organization-cascade");
    await ingestScanResult(scanRepository, organizationB, organizationScan.id, testResult("organization-cascade"));
    await prisma.organization.delete({ where: { id: organizationB } });
    await expectScanTreeRemoved(organizationScan.id);

    const replacement = await prisma.asset.create({
      data: { organizationId: organizationA, type: "DOMAIN", value: "integration.example" },
      select: { id: true },
    });
    const scanDeletion = await createTestScan(organizationA, replacement.id, "scan-cascade");
    await ingestScanResult(scanRepository, organizationA, scanDeletion.id, testResult("scan-cascade"));
    await scanRepository.delete(organizationA, scanDeletion.id);
    await expectScanTreeRemoved(scanDeletion.id);
  });

  it("rolls back the entire result tree when a nested evidence insert fails", async () => {
    const scan = await createTestScan();
    let triggerInstalled = false;
    try {
      await prisma.$executeRawUnsafe(`
        CREATE OR REPLACE FUNCTION safsight_m05_fail_test_evidence() RETURNS trigger AS $$
        BEGIN
          IF NEW.summary = 'm05-force-rollback' THEN
            RAISE EXCEPTION 'M05 rollback integration test';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
      `);
      await prisma.$executeRawUnsafe(`
        CREATE TRIGGER safsight_m05_fail_test_evidence_trigger
        BEFORE INSERT ON "evidence"
        FOR EACH ROW EXECUTE FUNCTION safsight_m05_fail_test_evidence()
      `);
      triggerInstalled = true;

      await expect(ingestScanResult(scanRepository, organizationA, scan.id, testResult(undefined, "m05-force-rollback")))
        .rejects.toThrow();

      expect(await prisma.scanResult.count({ where: { scanId: scan.id } })).toBe(0);
      expect(await prisma.scanError.count({ where: { scanResult: { scanId: scan.id } } })).toBe(0);
      expect(await prisma.finding.count({ where: { scanResult: { scanId: scan.id } } })).toBe(0);
      expect(await prisma.evidence.count({ where: { finding: { scanResult: { scanId: scan.id } } } })).toBe(0);
    } finally {
      if (triggerInstalled) {
        await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS safsight_m05_fail_test_evidence_trigger ON "evidence"');
      }
      await prisma.$executeRawUnsafe("DROP FUNCTION IF EXISTS safsight_m05_fail_test_evidence()");
    }
  });
});
