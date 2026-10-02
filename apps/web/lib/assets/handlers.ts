import { requireRequestUser } from "@/lib/auth/server";
import { organizationRepository } from "@/lib/organizations/organization-repository";
import { assetRepository } from "./asset-repository";
import { createAssetHandlers } from "./asset-http";

export const assetHandlers = createAssetHandlers(assetRepository, organizationRepository, requireRequestUser);