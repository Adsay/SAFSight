import type { Prisma } from "@prisma/client";
import type { ScanRequest, ScanResult } from "@safsight/contracts";
import type { PersistedScanResult, ScanWithResult } from "./scan-service";

export function scanRequestToPersistence(request: ScanRequest) {
  return {
    requestId: request.requestId,
    targetType: request.target.type,
    targetValue: request.target.value,
  };
}

export function scanResultToPersistence(result: ScanResult) {
  return {
    contractVersion: result.contractVersion,
    status: result.status,
    engineId: result.engine.id,
    engineVersion: result.engine.version,
    startedAt: result.startedAt === undefined ? null : new Date(result.startedAt),
    completedAt: result.completedAt === undefined ? null : new Date(result.completedAt),
    ...(result.error === undefined ? {} : {
      error: {
        create: {
          code: result.error.code,
          message: result.error.message,
          retryable: result.error.retryable ?? null,
        },
      },
    }),
    findings: {
      create: result.findings.map((finding, position) => ({
        position,
        code: finding.code,
        title: finding.title,
        severity: finding.severity,
        description: finding.description ?? null,
        evidencePresent: finding.evidence !== undefined,
        evidence: {
          create: (finding.evidence ?? []).map((item, evidencePosition) => ({
            position: evidencePosition,
            kind: item.kind,
            summary: item.summary,
            ...(item.data === undefined ? {} : { data: item.data as Prisma.InputJsonValue }),
          })),
        },
      })),
    },
  };
}

export function scanResultFromPersistence(scan: ScanWithResult): ScanResult | null {
  const result = scan.result;
  if (!result) return null;
  return {
    contractVersion: result.contractVersion as ScanResult["contractVersion"],
    requestId: scan.requestId,
    status: result.status,
    engine: { id: result.engineId, version: result.engineVersion },
    findings: result.findings.map((finding) => ({
      code: finding.code,
      title: finding.title,
      severity: finding.severity,
      ...(finding.description === null ? {} : { description: finding.description }),
      ...(!finding.evidencePresent ? {} : {
        evidence: finding.evidence.map((item) => ({
          kind: item.kind,
          summary: item.summary,
          ...(item.data === null ? {} : { data: item.data }),
        })),
      }),
    })),
    ...(result.startedAt === null ? {} : { startedAt: result.startedAt.toISOString() }),
    ...(result.completedAt === null ? {} : { completedAt: result.completedAt.toISOString() }),
    ...(result.error === null ? {} : {
      error: {
        code: result.error.code,
        message: result.error.message,
        ...(result.error.retryable === null ? {} : { retryable: result.error.retryable }),
      },
    }),
  };
}

export function scanResultSelect() {
  return {
    id: true,
    scanId: true,
    contractVersion: true,
    status: true,
    engineId: true,
    engineVersion: true,
    startedAt: true,
    completedAt: true,
    error: { select: { code: true, message: true, retryable: true } },
    findings: {
      orderBy: { position: "asc" as const },
      select: {
        code: true,
        title: true,
        severity: true,
        description: true,
        evidencePresent: true,
        evidence: {
          orderBy: { position: "asc" as const },
          select: { kind: true, summary: true, data: true },
        },
      },
    },
  } satisfies Prisma.ScanResultSelect;
}

export function scanWithResultSelect() {
  return {
    id: true,
    organizationId: true,
    assetId: true,
    requestId: true,
    targetType: true,
    targetValue: true,
    createdAt: true,
    result: { select: scanResultSelect() },
  } satisfies Prisma.ScanSelect;
}

export function toScanWithResult(record: Prisma.ScanGetPayload<{ select: ReturnType<typeof scanWithResultSelect> }>): ScanWithResult {
  const result: PersistedScanResult | null = record.result === null ? null : {
    ...record.result,
    error: record.result.error,
    findings: record.result.findings.map((finding) => ({
      ...finding,
      evidence: finding.evidence.map((item) => ({
        ...item,
        data: item.data === null || typeof item.data !== "object" || Array.isArray(item.data)
          ? null
          : item.data as Record<string, unknown>,
      })),
    })),
  };
  return { ...record, result };
}
