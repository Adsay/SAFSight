import { requireRequestUser } from "@/lib/auth/server";
import { organizationRepository } from "./organization-repository";
import { createOrganizationHandlers } from "./organization-http";

export const organizationHandlers = createOrganizationHandlers(organizationRepository, requireRequestUser);