# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Project: LinkGuard Mini App

A Telegram Mini App for teens that checks URLs for safety (phishing, malware, suspicious sites).
- **Not** a parental control tool — it's a personal safety assistant for the teen
- Results in Russian: безопасно / осторожно / опасно / неизвестно
- "Показать взрослому" button always available but never forced
- Google Safe Browsing API + heuristic analysis

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

## Artifacts

- **link-checker-mini-app** — React + Vite frontend (Telegram Mini App), preview path `/`
- **api-server** — Express 5 backend, preview path `/api`

## Architecture

- `lib/api-spec/openapi.yaml` — single source of truth for all API contracts
- `lib/db/src/schema/` — Drizzle ORM schema (users, link_checks tables)
- `artifacts/api-server/src/lib/risk-engine.ts` — URL risk scoring logic
- `artifacts/api-server/src/routes/links.ts` — link check, history, stats, report-to-parent
- `artifacts/api-server/src/routes/users.ts` — user registration and settings

## Environment Variables

- `DATABASE_URL` — PostgreSQL connection string (auto-set)
- `GOOGLE_SAFE_BROWSING_API_KEY` — Optional: Google Web Risk API key for production checks

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
