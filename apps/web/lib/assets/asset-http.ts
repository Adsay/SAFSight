import type { UserProfile } from "@/lib/auth/auth-service";
import { OrganizationError, type OrganizationRepository } from "@/lib/organizations/organization-service";
import {
  AssetError,
  createAsset,
  deleteAsset,
  getAsset,
  listAssets,
  updateAsset,
  type AssetRepository,
} from "./asset-service";

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

async function parseJson(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new AssetError("invalid_request", "A JSON request body is required.");
  }
  try {
    return await request.json();
  } catch {
    throw new AssetError("invalid_request", "The request body must contain valid JSON.");
  }
}

function errorResponse(error: unknown): Response {
  if (error instanceof OrganizationError) {
    const status = {
      unauthenticated: 401,
      invalid_request: 400,
      forbidden: 403,
      not_found: 404,
      duplicate_membership: 409,
      last_owner: 409,
    }[error.code];
    return json({
      error: error.code,
      message: error.message,
      ...(error.issues ? { issues: error.issues } : {}),
    }, status);
  }
  if (error instanceof AssetError) {
    const status = {
      invalid_request: 400,
      duplicate_asset: 409,
      not_found: 404,
    }[error.code];
    return json({
      error: error.code,
      message: error.message,
      ...(error.issues ? { issues: error.issues } : {}),
    }, status);
  }
  return json({ error: "internal_error", message: "The asset request could not be completed." }, 500);
}

export type RequestUser = (request: Request) => Promise<UserProfile | null>;

export function createAssetHandlers(
  repository: AssetRepository,
  organizationRepository: OrganizationRepository,
  getRequestUser: RequestUser,
) {
  async function authenticated(request: Request): Promise<UserProfile> {
    const user = await getRequestUser(request);
    if (!user) throw new OrganizationError("unauthenticated", "Authentication is required.");
    return user;
  }

  async function run(work: () => Promise<Response>): Promise<Response> {
    try {
      return await work();
    } catch (error) {
      return errorResponse(error);
    }
  }

  return {
    list: (request: Request, organizationId: string) => run(async () => {
      const user = await authenticated(request);
      const assets = await listAssets(repository, organizationRepository, user.id, organizationId);
      return json({ assets });
    }),

    create: (request: Request, organizationId: string) => run(async () => {
      const user = await authenticated(request);
      const asset = await createAsset(
        repository,
        organizationRepository,
        user.id,
        organizationId,
        await parseJson(request),
      );
      return json({ asset }, 201);
    }),

    get: (request: Request, organizationId: string, assetId: string) => run(async () => {
      const user = await authenticated(request);
      const asset = await getAsset(repository, organizationRepository, user.id, organizationId, assetId);
      return json({ asset });
    }),

    update: (request: Request, organizationId: string, assetId: string) => run(async () => {
      const user = await authenticated(request);
      const asset = await updateAsset(
        repository,
        organizationRepository,
        user.id,
        organizationId,
        assetId,
        await parseJson(request),
      );
      return json({ asset });
    }),

    delete: (request: Request, organizationId: string, assetId: string) => run(async () => {
      const user = await authenticated(request);
      await deleteAsset(repository, organizationRepository, user.id, organizationId, assetId);
      return json({ success: true });
    }),
  };
}