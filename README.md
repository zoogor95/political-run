# Majority Map (working title)

A turn-based election strategy game: Parliamentary (UK, Pakistan, India, Malaysia) and Presidential (US) modes, built as one TypeScript codebase for web, itch.io, Discord, Android, Steam and iOS.

The game design document and screen designs live outside this repository; this repo holds the code and game data.

All rights reserved. This is proprietary software; no licence is granted to copy, modify or distribute it.

## Layout

- `packages/core`: the rules engine. Pure, deterministic TypeScript with no platform code, shared by the web game, desktop and mobile wrappers, and the server.
- `packages/content`: map packs and candidate data (JSON), checked by the engine's pack validator.

## Commands

```bash
pnpm install
pnpm check   # lint, typecheck and tests
```
