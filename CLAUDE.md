# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

OpenClaw channel plugin for the Agent Relay Protocol (ARP). Connects OpenClaw agents to ARP relay servers via WebSocket for multi-agent coordination. This is an ES module TypeScript project with no build step — OpenClaw loads `src/index.ts` directly.

## Commands

```bash
pnpm install          # Install dependencies
pnpm test             # Run tests (vitest run)
pnpm test:watch       # Run tests in watch mode
```

No build/lint commands are configured. The plugin is loaded directly by the OpenClaw gateway via the path in `~/.openclaw/openclaw.json`.

## Architecture

```
ARP Relay Server  ←→  WebSocket  ←→  @openclaw/arp plugin  ←→  OpenClaw Gateway  ←→  Agent Session
```

### Core modules (all in `src/`):

- **`index.ts`** — Plugin entry point. Registers the ARP channel and 6 agent tools (memory, topics, messages, attention).
- **`channel.ts`** — Channel definition factory (`createARPChannel()`). Manages gateway lifecycle, inbound context injection (memory + topics + pinned files fetched in parallel via `Promise.allSettled`), outbound reply dispatch, typing indicators, and session routing.
- **`gateway.ts`** — `ARPGateway` class. Persistent WebSocket to ARP relay with exponential backoff reconnection, heartbeat watchdog (65s timeout), and singleton guard per account.
- **`inbound.ts`** — Converts ARP WebSocket messages into OpenClaw context objects. Four message types: `turn_notification`, `synthesis_request`, `mention_notification`, `channel_message`.
- **`outbound.ts`** — POSTs agent responses back to ARP relay REST API. Routes to flow-specific or channel-level endpoints.
- **`api.ts`** — REST client for ARP backend (channel memory, topics, messages, pinned files, attention). Functions return null/empty on errors — never throw.
- **`types.ts`** — All TypeScript interfaces for the ARP protocol.
- **`runtime.ts`** — Simple getter/setter for sharing the `PluginRuntime` reference across modules.

### Key patterns:

- **Singleton gateways**: One `ARPGateway` per account stored in a `Map<accountId, ARPGateway>`. Prevents duplicate WebSocket connections.
- **Stable session keys**: Format `arp:channel:{channelId}` (or `:flow:{flowId}` suffix). Ensures agent context persists across turns.
- **Graceful degradation**: API utilities never throw. `Promise.allSettled` for parallel context fetching so one failure doesn't block others.
- **UUID preference**: `agentUuid` preferred over `agentId` when available (auto-fetched on first connection).
- **`stopAccount()` is critical**: Without it, config changes leave zombie WebSocket connections. Always maintain this lifecycle hook.

### Message type behavior:

| Type | Agent behavior |
|------|---------------|
| `turn_notification` | Active turn in bounded flow — must respond |
| `synthesis_request` | Team lead role — synthesize discussion |
| `mention_notification` | Direct @mention — respond naturally |
| `channel_message` | Passive listening (`isPassive: true`) — respond only if relevant |

## Testing

Tests use Vitest. Test file lives alongside source: `src/inbound.test.ts`. Tests cover message parsing/routing for all four message types.

## Configuration

Plugin config lives in `~/.openclaw/openclaw.json` under `channels.arp.accounts`. Required fields: `relayUrl` (wss://), `token`, `agentId`. Optional: `agentUuid`, `channels[]`.

Restart gateway after config changes: `openclaw gateway restart`
