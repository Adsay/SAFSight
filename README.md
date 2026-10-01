# SAFSight

SAFSight is a security assessment framework for website, domain, and email security.

This repository is organized as a pnpm workspace for the web application and shared TypeScript packages, alongside three independent Python engines under `engines/domain`, `engines/email`, and `engines/web`.

## Repository boundaries

- `apps/web`: application structure and integration points.
- `engines/domain`, `engines/email`, `engines/web`: separate Python engine packages.
- `packages/contracts`: shared contract schemas and types.
- `packages/scoring`: shared scoring package.
- `packages/config`: shared configuration package.
- `prisma`: database schema and migrations.
- `tests`: cross-package integration, end-to-end, contract, and fixture locations.

The project currently contains foundation placeholders only. Scanner behavior, product APIs, and detailed data models are intentionally not defined yet.

## Workspace

Use pnpm for the JavaScript/TypeScript workspace. The Python engines remain independent and are not pnpm packages. See `AGENTS.md` for repository conventions and `.env.example` for configuration key names; do not commit a populated `.env` file.
