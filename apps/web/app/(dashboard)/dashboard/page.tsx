import { LogoutButton } from "@/components/ui/logout-button";
import Link from "next/link";
import { requireCurrentUser } from "@/lib/auth/server";

export default async function DashboardPage() {
  const user = await requireCurrentUser();

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <div className="brand"><span className="brand-mark" aria-hidden="true">S</span> SAFSight</div>
        <LogoutButton />
      </header>
      <section className="dashboard-panel" aria-labelledby="dashboard-title">
        <h1 id="dashboard-title">Your workspace</h1>
        <p>Signed in as {user.email}</p>
        <p><Link href="/organizations">Organizations and members</Link></p>
      </section>
    </main>
  );
}