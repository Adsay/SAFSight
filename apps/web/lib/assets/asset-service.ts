import { domainToASCII } from "node:url";
import { z } from "zod";
import {
  OrganizationError,
  requireOrganizationContext,
  requireOrganizationRole,
  type OrganizationContext,
  type OrganizationRepository,
} from "@/lib/organizations/organization-service";

export const ASSET_TYPES = ["DOMAIN", "EMAIL", "WEBSITE"] as const;
export type AssetType = (typeof ASSET_TYPES)[number];

export interface AssetRecord {
  id: string;
  organizationId: string;
  type: AssetType;
  value: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AssetRepository {
  create(organizationId: string, type: AssetType, value: string): Promise<AssetRecord>;
  list(organizationId: string): Promise<AssetRecord[]>;
  find(organizationId: string, assetId: string): Promise<AssetRecord | null>;
  update(organizationId: string, assetId: string, type: AssetType, value: string): Promise<AssetRecord>;
  delete(organizationId: string, assetId: string): Promise<void>;
}

export class AssetError extends Error {
  constructor(
    public readonly code: "invalid_request" | "duplicate_asset" | "not_found",
    message: string,
    public readonly issues?: Array<{ field: string; message: string }>,
  ) {
    super(message);
    this.name = "AssetError";
  }
}

export class DuplicateAssetError extends Error {
  constructor() {
    super("This asset already exists in the organization.");
    this.name = "DuplicateAssetError";
  }
}

export class AssetNotFoundError extends Error {
  constructor() {
    super("Asset was not found.");
    this.name = "AssetNotFoundError";
  }
}

const createInputSchema = z.object({
  type: z.enum(ASSET_TYPES),
  value: z.string(),
});

const updateInputSchema = z.object({
  type: z.enum(ASSET_TYPES).optional(),
  value: z.string().optional(),
}).refine((input) => input.type !== undefined || input.value !== undefined);

const emailSchema = z.string().trim().email().max(254).transform((value) => value.toLowerCase());
const hostnameLabelPattern = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

function issuesFromZod(error: z.ZodError): Array<{ field: string; message: string }> {
  return error.issues.map((issue) => ({ field: issue.path.join("."), message: issue.message }));
}

function invalidValue(type: AssetType): AssetError {
  return new AssetError("invalid_request", `Enter a valid ${type.toLowerCase()} asset value.`, [
    { field: "value", message: `Invalid ${type.toLowerCase()} value.` },
  ]);
}

function normalizeValue(type: AssetType, input: string): string {
  if (type === "DOMAIN") {
    const normalizedInput = input.trim().toLowerCase();
    if (/[\/\\?#:]/.test(normalizedInput)) throw invalidValue(type);
    const value = domainToASCII(normalizedInput);
    const labels = value.split(".");
    if (
      !value
      || value.length > 253
      || labels.some((label) => label.length === 0 || label.length > 63 || !hostnameLabelPattern.test(label))
    ) {
      throw invalidValue(type);
    }
    return value;
  }

  if (type === "EMAIL") {
    const parsed = emailSchema.safeParse(input);
    if (!parsed.success) {
      throw new AssetError("invalid_request", "Enter a valid email asset value of at most 254 characters.", issuesFromZod(parsed.error));
    }
    return parsed.data;
  }

  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw invalidValue(type);
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname) {
    throw invalidValue(type);
  }
  return url.toString();
}

function parseCreateInput(input: unknown): { type: AssetType; value: string } {
  const parsed = createInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new AssetError("invalid_request", "Enter a supported asset type and value.", issuesFromZod(parsed.error));
  }
  return { type: parsed.data.type, value: normalizeValue(parsed.data.type, parsed.data.value) };
}

function parseUpdateInput(input: unknown): { type?: AssetType; value?: string } {
  const parsed = updateInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new AssetError("invalid_request", "Provide an asset type or value to update.", issuesFromZod(parsed.error));
  }
  return parsed.data;
}

async function requireAssetContext(
  organizationRepository: OrganizationRepository,
  userId: string | null | undefined,
  organizationId: string,
  write: boolean,
): Promise<OrganizationContext> {
  if (!userId) throw new OrganizationError("unauthenticated", "Authentication is required.");
  const context = await requireOrganizationContext(organizationRepository, userId, organizationId);
  if (write) requireOrganizationRole(context, ["OWNER", "ADMIN"]);
  return context;
}

function translateRepositoryError(error: unknown): never {
  if (error instanceof DuplicateAssetError) {
    throw new AssetError("duplicate_asset", error.message);
  }
  if (error instanceof AssetNotFoundError) {
    throw new AssetError("not_found", error.message);
  }
  throw error;
}

export async function createAsset(
  repository: AssetRepository,
  organizationRepository: OrganizationRepository,
  userId: string | null | undefined,
  organizationId: string,
  input: unknown,
): Promise<AssetRecord> {
  const context = await requireAssetContext(organizationRepository, userId, organizationId, true);
  const asset = parseCreateInput(input);
  try {
    return await repository.create(context.organizationId, asset.type, asset.value);
  } catch (error) {
    return translateRepositoryError(error);
  }
}

export async function listAssets(
  repository: AssetRepository,
  organizationRepository: OrganizationRepository,
  userId: string | null | undefined,
  organizationId: string,
): Promise<AssetRecord[]> {
  const context = await requireAssetContext(organizationRepository, userId, organizationId, false);
  return repository.list(context.organizationId);
}

export async function getAsset(
  repository: AssetRepository,
  organizationRepository: OrganizationRepository,
  userId: string | null | undefined,
  organizationId: string,
  assetId: string,
): Promise<AssetRecord> {
  const context = await requireAssetContext(organizationRepository, userId, organizationId, false);
  const asset = await repository.find(context.organizationId, assetId);
  if (!asset) throw new AssetError("not_found", "Asset was not found.");
  return asset;
}

export async function updateAsset(
  repository: AssetRepository,
  organizationRepository: OrganizationRepository,
  userId: string | null | undefined,
  organizationId: string,
  assetId: string,
  input: unknown,
): Promise<AssetRecord> {
  const context = await requireAssetContext(organizationRepository, userId, organizationId, true);
  const changes = parseUpdateInput(input);
  const existing = await repository.find(context.organizationId, assetId);
  if (!existing) throw new AssetError("not_found", "Asset was not found.");

  const type = changes.type ?? existing.type;
  const value = normalizeValue(type, changes.value ?? existing.value);
  try {
    return await repository.update(context.organizationId, assetId, type, value);
  } catch (error) {
    return translateRepositoryError(error);
  }
}

export async function deleteAsset(
  repository: AssetRepository,
  organizationRepository: OrganizationRepository,
  userId: string | null | undefined,
  organizationId: string,
  assetId: string,
): Promise<void> {
  const context = await requireAssetContext(organizationRepository, userId, organizationId, true);
  try {
    await repository.delete(context.organizationId, assetId);
  } catch (error) {
    translateRepositoryError(error);
  }
}