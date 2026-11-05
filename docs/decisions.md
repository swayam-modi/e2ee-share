# Architectural & Design Decisions

This document tracks decisions made during implementation where the specification allowed flexibility or where trade-offs were resolved.

## Decision Log

### ADR 001: Monorepo Build and Typechecking Strategy

- **Context**: Monorepo packages (`@e2ee-share/protocol`, `@e2ee-share/core`) are consumed by `apps/server` and `apps/web`.
- **Decision**: Configure packages with `tsc` building to `dist/`, emitting declarations (`.d.ts`), while using `moduleResolution: "bundler"` for maximum interoperability with Vite and Fastify/tsx. Root `typecheck` ensures packages are compiled before running `tsc --noEmit` across all workspaces.
- **Rationale**: Avoids issues where bundlers/TypeScript attempt to import TypeScript sources outside project root directories, and allows standalone packaging if needed.

### ADR 002: ESLint Flat Config (ESLint 9)

- **Context**: ESLint 9 uses flat configuration (`eslint.config.js`) by default.
- **Decision**: Use `typescript-eslint` helper (`tseslint.config`) with recommended TypeScript rules and explicit rules against `any` types.
- **Rationale**: Aligns with modern TypeScript ESLint standards and ensures strict typing rules across packages.
