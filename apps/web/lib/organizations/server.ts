import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { requireCurrentUser } from "@/lib/auth/server";
import { organizationRepository } from "./organization-repository";
import {
  getCurrentOrganizationContext,
  getOrganization,
  getOrganizationMembers,
  OrganizationError,
} from "./organization-service";
import { CURRENT_ORGANIZATION_COOKIE_NAME } from "./organization-http";

export async function loadOrganizationIndex() {
  const user = await requireCurrentUser();
  const organizations = await organizationRepository.listOrganizationsForUser(user.id);
  const cookieStore = await cookies();
  const selectedId = cookieStore.get(CURRENT_ORGANIZATION_COOKIE_NAME)?.value ?? null;
  let current = null;
  try {
    current = await getCurrentOrganizationContext(organizationRepository, user.id, selectedId);
  } catch (error) {
    if (!(error instanceof OrganizationError) || error.code !== "not_found") throw error;
  }
  return { user, organizations, current };
}

export async function loadOrganizationMembers(organizationId: string) {
  const user = await requireCurrentUser();
  try {
    return await getOrganizationMembers(organizationRepository, user.id, organizationId);
  } catch {
    notFound();
  }
}