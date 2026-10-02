export const CONTRACT_VERSION = "1.0.0" as const;

export const ASSET_TYPES = ["DOMAIN", "EMAIL", "WEBSITE"] as const;
export type AssetType = (typeof ASSET_TYPES)[number];

export const SCAN_STATUSES = ["QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED"] as const;
export type ScanStatus = (typeof SCAN_STATUSES)[number];

export const SEVERITIES = ["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type Severity = (typeof SEVERITIES)[number];

export interface AssetTarget {
  type: AssetType;
  value: string;
}

export interface ScanRequest {
  contractVersion: typeof CONTRACT_VERSION;
  requestId: string;
  target: AssetTarget;
}

export interface EngineIdentity {
  id: string;
  version: string;
}

export interface Evidence {
  kind: string;
  summary: string;
  data?: Record<string, unknown>;
}

export interface Finding {
  code: string;
  title: string;
  severity: Severity;
  description?: string;
  evidence?: Evidence[];
}

export interface ContractError {
  code: string;
  message: string;
  retryable?: boolean;
}

export interface ScanResult {
  contractVersion: typeof CONTRACT_VERSION;
  requestId: string;
  status: ScanStatus;
  engine: EngineIdentity;
  findings: Finding[];
  startedAt?: string;
  completedAt?: string;
  error?: ContractError;
}