"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

type Role = "OWNER" | "ADMIN" | "MEMBER";
interface OrganizationItem { id: string; name: string; role: Role }

export function OrganizationList({
  initialOrganizations,
  currentOrganizationId,
}: {
  initialOrganizations: OrganizationItem[];
  currentOrganizationId: string | null;
}) {
  const router = useRouter();
  const [organizations, setOrganizations] = useState(initialOrganizations);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setPending(true);
    try {
      const response = await fetch("/api/organizations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.message ?? "Organization could not be created.");
        return;
      }
      setOrganizations((existing) => [...existing, {
        id: result.organization.id,
        name: result.organization.name,
        role: result.role,
      }]);
      setName("");
      router.refresh();
    } catch {
      setError("Unable to reach SAFSight. Try again.");
    } finally {
      setPending(false);
    }
  }

  async function select(organizationId: string) {
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/organizations/current", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId }),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.message ?? "Organization could not be selected.");
        return;
      }
      router.refresh();
    } catch {
      setError("Unable to reach SAFSight. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="organization-layout">
      <section className="organization-panel" aria-labelledby="create-org-title">
        <h2 id="create-org-title">Create organization</h2>
        <form className="auth-form" onSubmit={create}>
          <label className="field">Organization name
            <input value={name} onChange={(event) => setName(event.target.value)} minLength={2} maxLength={120} required />
          </label>
          {error ? <p className="message-error" role="alert">{error}</p> : null}
          <button className="primary-button" type="submit" disabled={pending}>{pending ? "Working…" : "Create organization"}</button>
        </form>
      </section>
      <section className="organization-panel" aria-labelledby="org-list-title">
        <h2 id="org-list-title">Your organizations</h2>
        {organizations.length ? <ul className="organization-list">
          {organizations.map((organization) => <li className="organization-row" key={organization.id}>
            <div><strong>{organization.name}</strong><p>{organization.role}</p></div>
            <div className="organization-actions">
              <Link className="secondary-button" href={`/organizations/${organization.id}`}>Members</Link>
              {currentOrganizationId === organization.id
                ? <span className="role-label">Current</span>
                : <button className="secondary-button" type="button" onClick={() => void select(organization.id)} disabled={pending}>Select</button>}
            </div>
          </li>)}
        </ul> : <p className="organization-empty">You are not a member of any organization yet.</p>}
      </section>
    </div>
  );
}