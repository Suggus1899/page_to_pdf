# AGENTS.md

## Stack

- **Language**: TypeScript
- **Framework**: WXT + React, Manifest V3
- **Package manager**: npm

## Commands

- **Build**: `npm run build`
- **Test**: `npm test`
- **Lint**: `npm run lint`
- **Typecheck**: `npm run typecheck`
- **Full verification**: `npm run verify`

## Conventions

- TypeScript strict; avoid `any` at domain boundaries.
- Keep browser-specific APIs behind small adapters.
- No remote code, telemetry, or network backend.
- Conventional commits: type in English, subject in Spanish, imperative, ≤50 chars.
- No AI attribution and never bypass Git hooks.
- `devwf:` comments mark deliberate simplifications with a known ceiling.
- Fix shared root causes rather than patching individual callers.
