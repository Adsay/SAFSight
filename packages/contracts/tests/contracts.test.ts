import { beforeAll, describe, expect, it } from "vitest";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import sharedSchema from "../schemas/shared.schema.json";
import scanRequestSchema from "../schemas/scan-request.schema.json";
import scanResultSchema from "../schemas/scan-result.schema.json";
import {
  ASSET_TYPES,
  CONTRACT_VERSION,
  SCAN_STATUSES,
  SEVERITIES,
  type AssetTarget,
  type ScanRequest,
  type ScanResult
} from "../types/index";

const ajv = new Ajv2020({ allErrors: true });
addFormats(ajv);
ajv.addSchema(sharedSchema);

let validateRequest: ReturnType<typeof ajv.compile>;
let validateResult: ReturnType<typeof ajv.compile>;
let validateAssetTarget: ReturnType<typeof ajv.compile>;

beforeAll(() => {
  validateRequest = ajv.compile(scanRequestSchema);
  validateResult = ajv.compile(scanResultSchema);
  validateAssetTarget = ajv.getSchema("urn:safsight:contracts:shared#/$defs/AssetTarget")!;
});

describe("shared contract schemas", () => {
  it("use JSON Schema 2020-12 and keep enum constants aligned with TypeScript", () => {
    expect(sharedSchema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(scanRequestSchema.$schema).toBe(sharedSchema.$schema);
    expect(scanResultSchema.$schema).toBe(sharedSchema.$schema);
    expect(sharedSchema.$defs.AssetTarget.properties.type.enum).toEqual(ASSET_TYPES);
    expect(sharedSchema.$defs.ScanStatus.enum).toEqual(SCAN_STATUSES);
    expect(sharedSchema.$defs.Severity.enum).toEqual(SEVERITIES);
  });

  it("accepts canonical targets for each M03 asset type", () => {
    const targets: AssetTarget[] = [
      { type: "DOMAIN", value: "example.com" },
      { type: "EMAIL", value: "owner@example.com" },
      { type: "WEBSITE", value: "https://example.com/path?query=1#section" },
    ];
    for (const target of targets) expect(validateAssetTarget(target)).toBe(true);
  });

  it("rejects non-canonical or invalid target values", () => {
    for (const value of ["EXAMPLE.COM", "example.com/path", "example.com?query=1", "example.com#fragment"]) {
      expect(validateAssetTarget({ type: "DOMAIN", value })).toBe(false);
    }
    expect(validateAssetTarget({ type: "EMAIL", value: "Owner@example.com" })).toBe(false);
    expect(validateAssetTarget({ type: "EMAIL", value: `${"a".repeat(64)}@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(62)}` })).toBe(false);
    expect(validateAssetTarget({ type: "WEBSITE", value: "ftp://example.com" })).toBe(false);
    expect(validateAssetTarget({ type: "WEBSITE", value: "/relative/path" })).toBe(false);
  });

  it("rejects organization and undeclared fields on AssetTarget", () => {
    const target = { type: "DOMAIN", value: "example.com" };
    expect(validateAssetTarget({ ...target, organizationId: "org-1" })).toBe(false);
    expect(validateAssetTarget({ ...target, id: "asset-1" })).toBe(false);
    expect(validateAssetTarget({ ...target, arbitrary: true })).toBe(false);
  });

  it("accepts M03 WEBSITE serialization and rejects equivalent noncanonical URLs", () => {
    const canonicalValue = new URL("https://EXAMPLE.COM:443").toString();
    expect(canonicalValue).toBe("https://example.com/");
    expect(validateAssetTarget({ type: "WEBSITE", value: canonicalValue })).toBe(true);
    expect(validateAssetTarget({ type: "WEBSITE", value: "https://EXAMPLE.COM:443" })).toBe(false);
    expect(validateAssetTarget({ type: "WEBSITE", value: "https://example.com" })).toBe(false);
  });

  it("validates the minimal ScanRequest and allows additive extension fields", () => {
    const request: ScanRequest = {
      contractVersion: CONTRACT_VERSION,
      requestId: "request-1",
      target: { type: "DOMAIN", value: "example.com" },
    };
    expect(validateRequest({ ...request, traceId: "trace-1" })).toBe(true);
    expect(validateRequest({ ...request, contractVersion: "2.0.0" })).toBe(false);
    expect(validateRequest({ contractVersion: CONTRACT_VERSION, requestId: "request-1" })).toBe(false);
  });

  it("validates ScanResult fields, optional timestamps and errors, and extensible evidence data", () => {
    const result: ScanResult = {
      contractVersion: CONTRACT_VERSION,
      requestId: "request-1",
      status: "SUCCEEDED",
      engine: { id: "domain", version: "1.0.0" },
      findings: [{
        code: "DNS_RECORD_PRESENT",
        title: "DNS record present",
        severity: "INFO",
        evidence: [{ kind: "dns-record", summary: "A record observed", data: { address: "192.0.2.1" } }],
      }],
      startedAt: "2026-10-03T00:00:00Z",
      completedAt: "2026-10-03T00:00:01Z",
    };
    expect(validateResult(result)).toBe(true);
    expect(validateResult({
      ...result,
      status: "FAILED",
      findings: [],
      error: { code: "ENGINE_FAILURE", message: "Engine failed", retryable: true },
    })).toBe(true);
    expect(validateResult({ ...result, status: "UNKNOWN" })).toBe(false);
    expect(validateResult({ ...result, engine: { id: "domain" } })).toBe(false);
    expect(validateResult({ ...result, startedAt: "not-a-date" })).toBe(false);
  });
});