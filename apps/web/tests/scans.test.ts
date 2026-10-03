import { beforeEach, describe, expect, it } from "vitest";
import type { ScanRequest, ScanResult } from "@safsight/contracts";
import {
  createScan,
  deleteScan,
  DuplicateScanError,
  getScan,
  ingestScanResult,
  listScans,
  ScanContractMismatchError,
  ScanAssetMismatchError,
  ScanNotFoundError,
  ScanResultAlreadyExistsError,
  type ScanRecord,
  type ScanRepository,
  type ScanWithResult,
} from "../lib/scans/scan-service";
import { scanRequestToPersistence, scanResultFromPersistence, scanResultToPersistence } from "../lib/scans/scan-mapper";

const organizationId = "org-a";
const otherOrganizationId = "org-b";
const assetId = "asset-a";
const request: ScanRequest = {
  contractVersion: "1.0.0",
  requestId: "request-1",
  target: { type: "DOMAIN", value: "example.com" },
};

function result(overrides: Partial<ScanResult> = {}): ScanResult {
  return {
    contractVersion: "1.0.0",
    requestId: request.requestId,
    status: "SUCCEEDED",
    engine: { id: "domain", version: "1.2.3" },
    findings: [
      {
        code: "DNS_PRESENT",
        title: "DNS record present",
        severity: "INFO",
        evidence: [{ kind: "record", summary: "First", data: { address: "192.0.2.1" } }],
      },
      { code: "DNS_PRESENT", title: "Also present", severity: "LOW", evidence: [{ kind: "record", summary: "Second" }] },
    ],
    startedAt: "2026-10-03T00:00:00.000Z",
    completedAt: "2026-10-03T00:00:01.000Z",
    ...overrides,
  };
}

class MemoryScanRepository implements ScanRepository {
  readonly scans = new Map<string, ScanWithResult>();
  private sequence = 0;

  async create(orgId: string, linkedAssetId: string, scanRequest: ScanRequest): Promise<ScanRecord> {
    if (linkedAssetId !== assetId && orgId === organizationId) throw new Error("asset not found in organization");
    if (scanRequest.target.type !== "DOMAIN" || scanRequest.target.value !== "example.com") {
      throw new ScanAssetMismatchError();
    }
    if ([...this.scans.values()].some((scan) => scan.organizationId === orgId && scan.requestId === scanRequest.requestId)) {
      throw new DuplicateScanError();
    }
    const scan: ScanWithResult = {
      id: `scan-${++this.sequence}`,
      organizationId: orgId,
      assetId: linkedAssetId,
      requestId: scanRequest.requestId,
      targetType: scanRequest.target.type,
      targetValue: scanRequest.target.value,
      createdAt: new Date("2026-10-03T00:00:00.000Z"),
      result: null,
    };
    this.scans.set(scan.id, scan);
    return scan;
  }

  async list(orgId: string): Promise<ScanWithResult[]> {
    return [...this.scans.values()].filter((scan) => scan.organizationId === orgId);
  }

  async find(orgId: string, scanId: string): Promise<ScanWithResult | null> {
    const scan = this.scans.get(scanId);
    return scan?.organizationId === orgId ? scan : null;
  }

  async delete(orgId: string, scanId: string): Promise<void> {
    if (!await this.find(orgId, scanId)) throw new ScanNotFoundError();
    this.scans.delete(scanId);
  }

  async ingestResult(orgId: string, scanId: string, scanResult: ScanResult): Promise<ScanWithResult> {
    const scan = await this.find(orgId, scanId);
    if (!scan || scan.requestId !== scanResult.requestId) throw new ScanNotFoundError();
    if (scan.result) throw new ScanResultAlreadyExistsError();
    const stored = scanResultToPersistence(scanResult);
    const mapped = {
      id: `result-${scanId}`,
      scanId,
      contractVersion: stored.contractVersion,
      status: scanResult.status,
      engineId: stored.engineId,
      engineVersion: stored.engineVersion,
      startedAt: stored.startedAt,
      completedAt: stored.completedAt,
      error: scanResult.error ? {
        code: scanResult.error.code,
        message: scanResult.error.message,
        retryable: scanResult.error.retryable ?? null,
      } : null,
      findings: scanResult.findings.map((finding) => ({
        code: finding.code,
        title: finding.title,
        severity: finding.severity,
        description: finding.description ?? null,
        evidencePresent: finding.evidence !== undefined,
        evidence: (finding.evidence ?? []).map((item) => ({
          kind: item.kind,
          summary: item.summary,
          data: item.data ?? null,
        })),
      })),
    };
    const updated = { ...scan, result: mapped };
    this.scans.set(scan.id, updated);
    return updated;
  }
}

describe("scan persistence service", () => {
  let repository: MemoryScanRepository;

  beforeEach(() => {
    repository = new MemoryScanRepository();
  });

  it("creates a tenant-owned scan with the request target snapshot and unique request ID", async () => {
    const scan = await createScan(repository, organizationId, assetId, request);
    expect(scan).toMatchObject({ organizationId, assetId, requestId: request.requestId, targetType: "DOMAIN", targetValue: "example.com" });
    await expect(createScan(repository, organizationId, assetId, request)).rejects.toBeInstanceOf(DuplicateScanError);
    await expect(createScan(repository, otherOrganizationId, "asset-b", request)).resolves.toMatchObject({ organizationId: otherOrganizationId });
    expect(scanRequestToPersistence(request)).toEqual({ requestId: "request-1", targetType: "DOMAIN", targetValue: "example.com" });
  });

  it("lists and finds scans only within the supplied organization", async () => {
    const scan = await createScan(repository, organizationId, assetId, request);
    await createScan(repository, otherOrganizationId, "asset-b", { ...request, requestId: "request-2" });
    expect(await listScans(repository, organizationId)).toHaveLength(1);
    expect(await getScan(repository, organizationId, scan.id)).toMatchObject({ id: scan.id });
    await expect(getScan(repository, otherOrganizationId, scan.id)).rejects.toBeInstanceOf(ScanNotFoundError);
  });

  it("rejects a target snapshot that does not identify the selected asset", async () => {
    await expect(createScan(repository, organizationId, assetId, {
      ...request,
      target: { type: "DOMAIN", value: "other.example" },
    })).rejects.toBeInstanceOf(ScanAssetMismatchError);
    expect(repository.scans.size).toBe(0);
  });

  it("deletes only a scan in the requested organization", async () => {
    const scan = await createScan(repository, organizationId, assetId, request);
    await expect(deleteScan(repository, otherOrganizationId, scan.id)).rejects.toBeInstanceOf(ScanNotFoundError);
    await deleteScan(repository, organizationId, scan.id);
    expect(await listScans(repository, organizationId)).toHaveLength(0);
  });

  it("ingests one result and preserves contract data and array order", async () => {
    const scan = await createScan(repository, organizationId, assetId, request);
    const incoming = result({ error: { code: "ENGINE_ERROR", message: "Partial failure", retryable: false } });
    const persisted = await ingestScanResult(repository, organizationId, scan.id, incoming);
    expect(persisted.result?.findings.map((finding) => finding.title)).toEqual(["DNS record present", "Also present"]);
    expect(persisted.result?.findings[0].evidence[0]).toMatchObject({ kind: "record", summary: "First", data: { address: "192.0.2.1" } });
    expect(persisted.result?.error).toEqual({ code: "ENGINE_ERROR", message: "Partial failure", retryable: false });
    await expect(ingestScanResult(repository, organizationId, scan.id, incoming)).rejects.toBeInstanceOf(ScanResultAlreadyExistsError);
  });

  it("keeps absent timestamps, error and retryable distinct from false", async () => {
    const scan = await createScan(repository, organizationId, assetId, request);
    await ingestScanResult(repository, organizationId, scan.id, result({
      startedAt: undefined,
      completedAt: undefined,
      error: { code: "UNKNOWN", message: "No retry value" },
      findings: [],
    }));
    const persisted = await getScan(repository, organizationId, scan.id);
    expect(persisted.result?.startedAt).toBeNull();
    expect(persisted.result?.completedAt).toBeNull();
    expect(persisted.result?.error?.retryable).toBeNull();
    expect(persisted.result?.findings).toEqual([]);
  });

  it("rejects mismatched result correlation IDs without storing anything", async () => {
    const scan = await createScan(repository, organizationId, assetId, request);
    await expect(ingestScanResult(repository, organizationId, scan.id, result({ requestId: "wrong-request" })))
      .rejects.toBeInstanceOf(ScanContractMismatchError);
    expect((await getScan(repository, organizationId, scan.id)).result).toBeNull();
  });
});

describe("scan contract mapper", () => {
  it("maps a persisted result back to M04 without exposing database identifiers", () => {
    const incoming = result({ error: { code: "ENGINE_ERROR", message: "failed" } });
    const stored = scanResultToPersistence(incoming);
    const wire = scanResultFromPersistence({
      id: "scan-id",
      organizationId,
      assetId,
      requestId: request.requestId,
      targetType: "DOMAIN",
      targetValue: "example.com",
      createdAt: new Date(),
      result: {
        id: "result-id",
        scanId: "scan-id",
        contractVersion: stored.contractVersion,
        status: incoming.status,
        engineId: stored.engineId,
        engineVersion: stored.engineVersion,
        startedAt: stored.startedAt,
        completedAt: stored.completedAt,
        error: { code: "ENGINE_ERROR", message: "failed", retryable: null },
        findings: incoming.findings.map((finding) => ({
          code: finding.code,
          title: finding.title,
          severity: finding.severity,
          description: null,
          evidencePresent: finding.evidence !== undefined,
          evidence: (finding.evidence ?? []).map((evidence) => ({ ...evidence, data: evidence.data ?? null })),
        })),
      },
    });
    expect(wire).toEqual({ ...incoming, error: { code: "ENGINE_ERROR", message: "failed" } });
    expect(JSON.stringify(wire)).not.toContain("organizationId");
    expect(JSON.stringify(wire)).not.toContain("scanId");
  });

  it("preserves omitted evidence, an empty evidence array, and populated evidence separately", () => {
    const incoming = result({
      findings: [
        { code: "OMITTED", title: "Omitted", severity: "INFO" },
        { code: "EMPTY", title: "Empty", severity: "LOW", evidence: [] },
        { code: "PRESENT", title: "Present", severity: "HIGH", evidence: [{ kind: "check", summary: "Observed" }] },
      ],
    });
    const stored = scanResultToPersistence(incoming);
    const wire = scanResultFromPersistence({
      id: "scan-id",
      organizationId,
      assetId,
      requestId: request.requestId,
      targetType: "DOMAIN",
      targetValue: "example.com",
      createdAt: new Date(),
      result: {
        id: "result-id",
        scanId: "scan-id",
        contractVersion: stored.contractVersion,
        status: incoming.status,
        engineId: stored.engineId,
        engineVersion: stored.engineVersion,
        startedAt: stored.startedAt,
        completedAt: stored.completedAt,
        error: null,
        findings: incoming.findings.map((finding, position) => ({
          code: finding.code,
          title: finding.title,
          severity: finding.severity,
          description: null,
          evidencePresent: stored.findings.create[position].evidencePresent,
          evidence: (finding.evidence ?? []).map((evidence) => ({ ...evidence, data: evidence.data ?? null })),
        })),
      },
    });

    expect(wire?.findings[0]).not.toHaveProperty("evidence");
    expect(wire?.findings[1]).toHaveProperty("evidence", []);
    expect(wire?.findings[2]).toHaveProperty("evidence", [{ kind: "check", summary: "Observed" }]);
  });
});
