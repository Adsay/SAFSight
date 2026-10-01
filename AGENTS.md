# Repository guidance

- Keep the three Python engines independent under `engines/domain`, `engines/email`, and `engines/web`.
- Put shared contracts in `packages/contracts`, scoring in `packages/scoring`, configuration in `packages/config`, and database definitions in `prisma`.
- Keep changes within the owning package and avoid coupling engines through implementation details.
- Do not add scanner, authentication, dashboard, or business behavior without an agreed implementation plan.
- Do not invent detailed API or database schemas; agree on contracts before defining them.
- Use pnpm for the JavaScript/TypeScript workspace. Do not add dependencies unless a concrete implementation requires them.
- Never commit secrets or populated environment files. `.env.example` contains placeholders only.
- Add focused tests alongside the package or engine they cover.