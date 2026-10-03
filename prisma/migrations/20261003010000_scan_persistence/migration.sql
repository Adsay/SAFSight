CREATE TYPE "ScanStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

CREATE TYPE "FindingSeverity" AS ENUM ('INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

CREATE UNIQUE INDEX "assets_id_organization_id_key" ON "assets"("id", "organization_id");

CREATE TABLE "scans" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "target_type" "AssetType" NOT NULL,
    "target_value" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "scans_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "scan_results" (
    "id" TEXT NOT NULL,
    "scan_id" TEXT NOT NULL,
    "contract_version" TEXT NOT NULL,
    "status" "ScanStatus" NOT NULL,
    "engine_id" TEXT NOT NULL,
    "engine_version" TEXT NOT NULL,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    CONSTRAINT "scan_results_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "scan_errors" (
    "id" TEXT NOT NULL,
    "scan_result_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "retryable" BOOLEAN,
    CONSTRAINT "scan_errors_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "findings" (
    "id" TEXT NOT NULL,
    "scan_result_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "severity" "FindingSeverity" NOT NULL,
    "description" TEXT,
    CONSTRAINT "findings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "evidence" (
    "id" TEXT NOT NULL,
    "finding_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "data" JSONB,
    CONSTRAINT "evidence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "scans_organization_id_request_id_key" ON "scans"("organization_id", "request_id");
CREATE INDEX "scans_organization_id_created_at_idx" ON "scans"("organization_id", "created_at");
CREATE UNIQUE INDEX "scan_results_scan_id_key" ON "scan_results"("scan_id");
CREATE UNIQUE INDEX "scan_errors_scan_result_id_key" ON "scan_errors"("scan_result_id");
CREATE UNIQUE INDEX "findings_scan_result_id_position_key" ON "findings"("scan_result_id", "position");
CREATE UNIQUE INDEX "evidence_finding_id_position_key" ON "evidence"("finding_id", "position");

ALTER TABLE "scans" ADD CONSTRAINT "scans_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "scans" ADD CONSTRAINT "scans_asset_id_organization_id_fkey"
    FOREIGN KEY ("asset_id", "organization_id") REFERENCES "assets"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "scan_results" ADD CONSTRAINT "scan_results_scan_id_fkey"
    FOREIGN KEY ("scan_id") REFERENCES "scans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "scan_errors" ADD CONSTRAINT "scan_errors_scan_result_id_fkey"
    FOREIGN KEY ("scan_result_id") REFERENCES "scan_results"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "findings" ADD CONSTRAINT "findings_scan_result_id_fkey"
    FOREIGN KEY ("scan_result_id") REFERENCES "scan_results"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_finding_id_fkey"
    FOREIGN KEY ("finding_id") REFERENCES "findings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
