import type { ScanRequest, ScanResult } from "@safsight/contracts";
import type { AssetType, FindingSeverity, ScanStatus } from "@prisma/client";

export interface ScanRecord {
  id: string;
  organizationId: string;
  assetId: string;
  requestId: string;
  targetType: AssetType;
  targetValue: string;
  createdAt: Date;
}

export interface PersistedScanResult {
  id: string;
  scanId: string;
  contractVersion: string;
  status: ScanStatus;
  engineId: string;
  engineVersion: string;
  startedAt: Date | null;
  completedAt: Date | null;
  error: { code: string; message: string; retryable: boolean | null } | null;
  findings: Array<{
    code: string;
    title: string;
    severity: FindingSeverity;
    description: string | null;
    evidencePresent: boolean;
    evidence: Array<{ kind: string; summary: string; data: Record<string, unknown> | null }>;
  }>;
}

export interface ScanWithResult extends ScanRecord {
  result: PersistedScanResult | null;
}

export interface ScanRepository {
  create(organizationId: string, assetId: string, request: ScanRequest): Promise<ScanRecord>;
  list(organizationId: string): Promise<ScanWithResult[]>;
  find(organizationId: string, scanId: string): Promise<ScanWithResult | null>;
  delete(organizationId: string, scanId: string): Promise<void>;
  ingestResult(organizationId: string, scanId: string, result: ScanResult): Promise<ScanWithResult>;
}

export class ScanNotFoundError extends Error {
  constructor() {
    super("Scan was not found.");
    this.name = "ScanNotFoundError";
  }
}

export class DuplicateScanError extends Error {
  constructor() {
    super("A scan with this request ID already exists in the organization.");
    this.name = "DuplicateScanError";
  }
}

export class ScanResultAlreadyExistsError extends Error {
  constructor() {
    super("A result has already been stored for this scan.");
    this.name = "ScanResultAlreadyExistsError";
  }
}

export class ScanContractMismatchError extends Error {
  constructor() {
    super("The result request ID does not match the scan request ID.");
    this.name = "ScanContractMismatchError";
  }
}

export class ScanAssetMismatchError extends Error {
  constructor() {
    super("The scan target does not match the selected organization asset.");
    this.name = "ScanAssetMismatchError";
  }
}

export async function createScan(
  repository: ScanRepository,
  organizationId: string,
  assetId: string,
  request: ScanRequest,
): Promise<ScanRecord> {
  return repository.create(organizationId, assetId, request);
}

export async function listScans(repository: ScanRepository, organizationId: string): Promise<ScanWithResult[]> {
  return repository.list(organizationId);
}

export async function getScan(
  repository: ScanRepository,
  organizationId: string,
  scanId: string,
): Promise<ScanWithResult> {
  const scan = await repository.find(organizationId, scanId);
  if (!scan) throw new ScanNotFoundError();
  return scan;
}

export async function deleteScan(repository: ScanRepository, organizationId: string, scanId: string): Promise<void> {
  return repository.delete(organizationId, scanId);
}

export async function ingestScanResult(
  repository: ScanRepository,
  organizationId: string,
  scanId: string,
  result: ScanResult,
): Promise<ScanWithResult> {
  const scan = await repository.find(organizationId, scanId);
  if (!scan) throw new ScanNotFoundError();
  if (scan.requestId !== result.requestId) throw new ScanContractMismatchError();
  return repository.ingestResult(organizationId, scanId, result);
}
