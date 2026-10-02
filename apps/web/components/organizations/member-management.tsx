"use client";

import { useState, type FormEvent } from "react";

type Role = "OWNER" | "ADMIN" | "MEMBER";
interface Member { userId: string; email: string; role: Role }

export function MemberManagement({
  organizationId,
  actorUserId,
  actorRole,
  initialMembers,
}: {
  organizationId: string;
  actorUserId: string;
  actorRole: Role;
  initialMembers: Member[];
}) {
  const [members, setMembers] = useState(initialMembers);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("MEMBER");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const canManage = actorRole === "OWNER" || actorRole === "ADMIN";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/organizations/${organizationId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role: actorRole === "OWNER" ? role : "MEMBER" }),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.message ?? "Member could not be added.");
        return;
      }
      setMembers((existing) => [...existing, {
        userId: result.member.userId,
        email: result.member.user.email,
        role: result.member.role,
      }]);
      setEmail("");
    } catch {
      setError("Unable to reach SAFSight. Try again.");
    } finally {
      setPending(false);
    }
  }

  async function updateRole(member: Member, nextRole: Role) {
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/organizations/${organizationId}/members/${member.userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: nextRole }),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.message ?? "Role could not be changed.");
        return;
      }
      setMembers((existing) => existing.map((entry) => entry.userId === member.userId ? { ...entry, role: nextRole } : entry));
    } catch {
      setError("Unable to reach SAFSight. Try again.");
    } finally {
      setPending(false);
    }
  }

  async function removeMember(member: Member) {
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/organizations/${organizationId}/members/${member.userId}`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) {
        setError(result.message ?? "Member could not be removed.");
        return;
      }
      setMembers((existing) => existing.filter((entry) => entry.userId !== member.userId));
    } catch {
      setError("Unable to reach SAFSight. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="organization-panel" aria-labelledby="members-title" style={{ width: "min(100%, 1040px)", margin: "36px auto 0" }}>
      <h2 id="members-title">Members</h2>
      {canManage ? <form className="inline-form" onSubmit={submit}>
        <label className="field">Account email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={254} required /></label>
        {actorRole === "OWNER" ? <label className="field">Role<select value={role} onChange={(event) => setRole(event.target.value as Role)}>
          <option value="MEMBER">Member</option><option value="ADMIN">Admin</option><option value="OWNER">Owner</option>
        </select></label> : <div className="field"><span>Role</span><span className="role-label">Member</span></div>}
        <button className="primary-button" type="submit" disabled={pending}>Add member</button>
      </form> : null}
      {error ? <p className="message-error" role="alert">{error}</p> : null}
      {members.length ? <ul className="member-list">
        {members.map((member) => {
          const canChangeRole = actorRole === "OWNER" || (actorRole === "ADMIN" && member.role === "MEMBER");
          const canRemove = actorRole === "OWNER" || member.role === "MEMBER";
          return <li className="member-row" key={member.userId}>
            <div className="member-identity"><strong>{member.email}</strong><p>{member.role}</p></div>
            {canManage ? <div className="member-controls">
              {canChangeRole ? <select aria-label={`Role for ${member.email}`} value={member.role} onChange={(event) => void updateRole(member, event.target.value as Role)} disabled={pending}>
                {actorRole === "OWNER" ? <><option value="OWNER">Owner</option><option value="ADMIN">Admin</option></> : null}
                <option value="MEMBER">Member</option>
              </select> : null}
              {canRemove ? <button className="secondary-button" type="button" onClick={() => void removeMember(member)} disabled={pending}>Remove</button> : null}
            </div> : null}
          </li>;
        })}
      </ul> : <p className="organization-empty">This organization has no members.</p>}
    </section>
  );
}