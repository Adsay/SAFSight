# Scan persistence

Scans belong to an organization and one of its assets. The scan stores the request ID and canonical target type/value as a snapshot, so later asset edits do not change the recorded target. Request IDs are unique within an organization.

Each scan can have one persisted result. Results, optional errors, findings, and evidence are stored in relational records. Finding and evidence position columns preserve contract array order. Findings retain whether the contract omitted evidence, supplied an empty array, or supplied entries. Evidence `data` is stored as JSONB. A missing `retryable` value is stored as SQL `NULL`, separately from `false`.

The database enforces that a scan's asset belongs to the same organization. Organization and asset deletion cascade to scans; scan deletion cascades through results, errors, findings, and evidence. Result ingestion writes the result and all nested records atomically. Repository reads and mutations include the organization ID in their scope.

M04 contracts remain the engine and wire boundary. Application mapping translates between those contracts and persistence records; Prisma-generated types are not shared with contracts or engines.
