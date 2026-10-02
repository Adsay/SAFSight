import Link from "next/link";
import { notFound } from "next/navigation";
import { LogoutButton } from "@/components/ui/logout-button";
import { AssetManagement } from "@/components/assets/asset-management";
import { requireCurrentUser } from "@/lib/auth/server";
import { assetRepository } from "@/lib/assets/asset-repository";
import { getOrganization, OrganizationError, type OrganizationContext } from "@/lib/organizations/organization-service";
import { organizationRepository } from "@/lib/organizations/organization-repository";

type PageProps = { params: Promise<{ organizationId: string }> };

export default async function OrganizationAssetsPage({ params }: PageProps) {
  const { organizationId } = await params;
  const user = await requireCurrentUser();
  let context: OrganizationContext;
  try {
    context = await getOrganization(organizationRepository, user.id, organizationId);
  } catch (error) {
    if (error instanceof OrganizationError && error.code === "not_found") notFound();
    throw error;
  }
  const assets = await assetRepository.list(context.organizationId);

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header organization-header">
        <Link className="brand" href="/dashboard"><span className="brand-mark" aria-hidden="true">S</span> SAFSight</Link>
        <LogoutButton />
      </header>
      <div className="organization-page-title">
        <Link className="back-link" href="/organizations">All organizations</Link>
        <h1>{context.organization.name}</h1>
        <p>Assets · Your role: {context.role}</p>
        <Link className="secondary-button" href={`/organizations/${context.organizationId}`}>Members</Link>
      </div>
      <AssetManagement
        organizationId={context.organizationId}
        actorRole={context.role}
        initialAssets={assets.map(({ id, type, value }) => ({ id, type, value }))}
      />
    </main>
  );
}