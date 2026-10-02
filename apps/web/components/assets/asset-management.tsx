"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { AssetType } from "@/lib/assets/asset-service";

const ASSET_TYPES: AssetType[] = ["DOMAIN", "EMAIL", "WEBSITE"];
type Role = "OWNER" | "ADMIN" | "MEMBER";
interface AssetItem { id: string; type: AssetType; value: string }

export function AssetManagement({
  organizationId,
  actorRole,
  initialAssets,
}: {
  organizationId: string;
  actorRole: Role;
  initialAssets: AssetItem[];
}) {
  const router = useRouter();
  const [assets, setAssets] = useState(initialAssets);
  const [type, setType] = useState<AssetType>("DOMAIN");
  const [value, setValue] = useState("");
  const [editingAssetId, setEditingAssetId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const canManage = actorRole === "OWNER" || actorRole === "ADMIN";

  function cancelEdit() {
    setEditingAssetId(null);
    setType("DOMAIN");
    setValue("");
    setError("");
  }

  function editAsset(asset: AssetItem) {
    setEditingAssetId(asset.id);
    setType(asset.type);
    setValue(asset.value);
    setError("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const isEditing = editingAssetId !== null;
    const endpoint = `/api/organizations/${organizationId}/assets${isEditing ? `/${editingAssetId}` : ""}`;
    try {
      const response = await fetch(endpoint, {
        method: isEditing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, value }),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.message ?? "Asset could not be saved.");
        return;
      }
      const savedAsset: AssetItem = result.asset;
      setAssets((existing) => isEditing
        ? existing.map((asset) => asset.id === savedAsset.id ? savedAsset : asset)
        : [...existing, savedAsset]);
      cancelEdit();
      router.refresh();
    } catch {
      setError("Unable to reach SAFSight. Try again.");
    } finally {
      setPending(false);
    }
  }

  async function deleteAsset(assetId: string) {
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/organizations/${organizationId}/assets/${assetId}`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) {
        setError(result.message ?? "Asset could not be deleted.");
        return;
      }
      setAssets((existing) => existing.filter((asset) => asset.id !== assetId));
      if (editingAssetId === assetId) cancelEdit();
      router.refresh();
    } catch {
      setError("Unable to reach SAFSight. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="organization-panel" aria-labelledby="assets-title" style={{ width: "min(100%, 1040px)", margin: "36px auto 0" }}>
      <h2 id="assets-title">Assets</h2>
      {canManage ? <form className="inline-form" onSubmit={submit}>
        <label className="field">Asset value
          <input value={value} onChange={(event) => setValue(event.target.value)} required />
        </label>
        <label className="field">Type
          <select value={type} onChange={(event) => setType(event.target.value as AssetType)}>
            {ASSET_TYPES.map((assetType) => <option key={assetType} value={assetType}>{assetType}</option>)}
          </select>
        </label>
        <div className="asset-form-actions">
          <button className="primary-button" type="submit" disabled={pending}>
            {pending ? "Working…" : editingAssetId ? "Save changes" : "Add asset"}
          </button>
          {editingAssetId ? <button className="secondary-button" type="button" onClick={cancelEdit} disabled={pending}>Cancel</button> : null}
        </div>
      </form> : null}
      {error ? <p className="message-error" role="alert">{error}</p> : null}
      {ASSET_TYPES.map((assetType) => {
        const groupedAssets = assets.filter((asset) => asset.type === assetType);
        return <section key={assetType} aria-labelledby={`assets-${assetType}`} style={{ marginTop: "24px" }}>
          <h3 id={`assets-${assetType}`}>{assetType}</h3>
          {groupedAssets.length ? <ul className="member-list">
            {groupedAssets.map((asset) => <li className="member-row" key={asset.id}>
              <div className="member-identity"><strong>{asset.value}</strong><p className="role-label">{asset.type}</p></div>
              {canManage ? <div className="member-controls">
                <button className="secondary-button" type="button" onClick={() => editAsset(asset)} disabled={pending}>Edit</button>
                <button className="secondary-button" type="button" onClick={() => void deleteAsset(asset.id)} disabled={pending}>
                  {pending ? "Working…" : "Delete"}
                </button>
              </div> : null}
            </li>)}
          </ul> : <p className="organization-empty">No {assetType.toLowerCase()} assets.</p>}
        </section>;
      })}
    </section>
  );
}