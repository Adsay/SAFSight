import Link from "next/link";
import { LogoutButton } from "@/components/ui/logout-button";
import { MemberManagement } from "@/components/organizations/member-management";
import { loadOrganizationMembers } from "@/lib/organizations/server";

type PageProps = { params: Promise<{ organizationId: string }> };

export default async function OrganizationMembersPage({ params }: PageProps) {
  const { organizationId } = await params;
  const { context, members } = await loadOrganizationMembers(organizationId);
  return (
    <main className="dashboard-shell">
      <header className="dashboard-header organization-header">
        <Link className="brand" href="/dashboard"><span className="brand-mark" aria-hidden="true">S</span> SAFSight</Link>
        <LogoutButton />
      </header>
      <div className="organization-page-title">
        <Link className="back-link" href="/organizations">All organizations</Link>
        <h1>{context.organization.name}</h1>
        <p>Your role: {context.role}</p>
      </div>
      <MemberManagement
        organizationId={context.organizationId}
        actorUserId={context.userId}
        actorRole={context.role}
        initialMembers={members.map((member) => ({ userId: member.userId, email: member.user.email, role: member.role }))}
      />
    </main>
  );
}