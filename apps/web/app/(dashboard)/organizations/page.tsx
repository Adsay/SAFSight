import Link from "next/link";
import { LogoutButton } from "@/components/ui/logout-button";
import { OrganizationList } from "@/components/organizations/organization-list";
import { loadOrganizationIndex } from "@/lib/organizations/server";

export default async function OrganizationsPage() {
  const { organizations, current } = await loadOrganizationIndex();
  return (
    <main className="dashboard-shell">
      <header className="dashboard-header organization-header">
        <Link className="brand" href="/dashboard"><span className="brand-mark" aria-hidden="true">S</span> SAFSight</Link>
        <LogoutButton />
      </header>
      <div className="organization-page-title">
        <h1>Organizations</h1>
        <p>{current ? `Current organization: ${current.organization.name}` : "Create or select an organization."}</p>
      </div>
      <OrganizationList
        initialOrganizations={organizations.map(({ organization, role }) => ({
          id: organization.id,
          name: organization.name,
          role,
        }))}
        currentOrganizationId={current?.organizationId ?? null}
      />
    </main>
  );
}