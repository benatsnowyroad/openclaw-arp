// ARP Terminal Session Orchestrator
// Manages lifecycle of terminal streaming sessions: creation, PTY streaming, cleanup

import WebSocket from 'ws';

/** Configuration for starting a terminal session */
export interface TerminalSessionConfig {
  relayUrl: string;
  token: string;
  channelId: string;
  title: string;
  /** Shell command to run in the PTY. Defaults to process.env.SHELL or 'bash' */
  command?: string;
  /** PTY column width. Defaults to 120 */
  cols?: number;
  /** PTY row height. Defaults to 40 */
  rows?: number;
}

/** Handle for a running terminal session */
export interface TerminalSession {
  /** The terminal_session_id from the relay */
  id: string;
  /** End the session gracefully with a summary */
  end(summary: string): Promise<void>;
  /** Force-kill the session without sending a summary */
  kill(): void;
  /** Resolves when the PTY process exits (or is killed) */
  onExit: Promise<void>;
}

/** Response from POST /channels/:id/terminal-sessions */
interface CreateSessionResponse {
  sessionId: string;
  wsUrl: string;
}

const HEARTBEAT_INTERVAL_MS = 25_000;
const RECONNECT_GRACE_MS = 30_000;
const MAX_RECONNECT_ATTEMPTS = 5;

/**
 * Dynamically import node-pty (optional dependency).
 * Throws a helpful error if not installed.
 */
async function loadNodePty(): Promise<{ spawn: (...args: any[]) => any }> {
  try {
    return await import('node-pty' as string) as { spawn: (...args: any[]) => any };
  } catch {
    throw new Error(
      'node-pty is required for terminal streaming. Install it: npm install node-pty'
    );
  }
}

/**
 * Convert a relay URL (wss:// or ws://) to its HTTP equivalent for REST calls.
 */
function httpUrl(relayUrl: string): string {
  return relayUrl.replace('wss://', 'https://').replace('ws://', 'http://');
}

/**
 * Convert a relay URL to its WebSocket equivalent.
 */
function wsUrl(relayUrl: string): string {
  return relayUrl.replace(/^http/, 'ws').replace(/\/$/, '');
}

/**
 * Create a terminal session via the ARP relay REST API.
 *
 * @param config - relayUrl, token, channelId, and title for the session
 * @returns Session ID and WebSocket URL for streaming
 * @throws On HTTP errors or network failures
 */
async function createSession(config: TerminalSessionConfig): Promise<CreateSessionResponse> {
  const url = `${httpUrl(config.relayUrl)}/channels/${config.channelId}/terminal-sessions`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title: config.title }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Failed to create terminal session: HTTP ${res.status} ${body}`);
  }

  const data = await res.json() as Record<string, any>;
  const sessionId = data.sessionId || data.session_id || data.id || data.session?.id || data.session?.ID;
  const sessionWsUrl = data.wsUrl || data.ws_url || data.session?.ws_url;

  if (!sessionId || !sessionWsUrl) {
    throw new Error(`Invalid terminal session response: missing sessionId or wsUrl`);
  }

  return { sessionId, wsUrl: sessionWsUrl };
}

/**
 * Connect a WebSocket to the relay as a terminal streamer.
 * Resolves once the connection is open.
 */
function connectStreamer(sessionWsUrl: string, token: string, sessionId: string): Promise<WebSocket> {
  // Use the wsUrl directly if it's already a full URL, otherwise build it
  let url: string;
  if (sessionWsUrl.startsWith('ws://') || sessionWsUrl.startsWith('wss://')) {
    // Server-provided full URL — append role and token if not already present
    const separator = sessionWsUrl.includes('?') ? '&' : '?';
    url = `${sessionWsUrl}${separator}role=streamer&token=${encodeURIComponent(token)}`;
  } else {
    url = `${sessionWsUrl}/ws/terminal/${sessionId}?role=streamer&token=${encodeURIComponent(token)}`;
  }

  return new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.on('open', () => resolve(ws));
    ws.on('error', (err: Error) => reject(err));
  });
}

/**
 * Start a terminal streaming session on an ARP channel.
 *
 * Creates a terminal session via the relay API, spawns a PTY process,
 * connects a WebSocket as a streamer, and pipes raw PTY output as binary
 * frames. Handles heartbeats, resize events, and graceful/forced cleanup.
 *
 * @param config - Terminal session configuration
 * @param logger - Optional logger (info/warn/error methods)
 * @returns A TerminalSession handle for controlling the session
 *
 * @example
 * ```ts
 * const session = await startTerminalSession({
 *   relayUrl: 'wss://relay.example.com',
 *   token: 'bearer-token',
 *   channelId: 'channel-uuid',
 *   title: 'Implementing feature X',
 * });
 *
 * // Later, when work is done:
 * await session.end('Implemented feature X, all tests passing');
 * ```
 */
export async function startTerminalSession(
  config: TerminalSessionConfig,
  logger?: any,
): Promise<TerminalSession> {
  const nodePty = await loadNodePty();
  const { sessionId, wsUrl: sessionWsUrl } = await createSession(config);

  logger?.info(`[arp-terminal] Created session ${sessionId} for channel ${config.channelId}`);

  const cols = config.cols ?? 120;
  const rows = config.rows ?? 40;

  // Mutable state for the session lifecycle
  let ws: WebSocket | null = null;
  let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  let pty: any = null;
  let ended = false;
  let reconnecting = false;

  // Deferred for PTY exit
  let resolveExit: () => void;
  const onExit = new Promise<void>((resolve) => {
    resolveExit = resolve;
  });

  /** Clean up all resources */
  function cleanup() {
    ended = true;
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
    ws = null;
    if (pty) {
      try { pty.kill(); } catch { /* already dead */ }
      pty = null;
    }
  }

  /** Start heartbeat timer */
  function startHeartbeat() {
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    heartbeatInterval = setInterval(() => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'heartbeat_ack' }));
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  /** Handle inbound control messages from the relay */
  function handleControlMessage(data: WebSocket.Data) {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'resize' && pty) {
        const newCols = msg.cols ?? cols;
        const newRows = msg.rows ?? rows;
        pty.resize(newCols, newRows);
        logger?.info(`[arp-terminal] Resized PTY to ${newCols}x${newRows}`);
      }
      // heartbeat from server — respond with ack
      if (msg.type === 'heartbeat') {
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'heartbeat_ack' }));
        }
      }
    } catch {
      // Not JSON — ignore (shouldn't happen for text frames)
    }
  }

  /** Attempt to reconnect the WebSocket within the grace period */
  async function attemptReconnect() {
    if (ended || reconnecting) return;
    reconnecting = true;
    logger?.warn(`[arp-terminal] WebSocket disconnected, attempting reconnect (grace: ${RECONNECT_GRACE_MS}ms)`);

    const deadline = Date.now() + RECONNECT_GRACE_MS;
    let attempt = 0;

    while (attempt < MAX_RECONNECT_ATTEMPTS && Date.now() < deadline && !ended) {
      attempt++;
      const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 10_000);
      await new Promise((r) => setTimeout(r, backoffMs));

      if (ended) break;

      try {
        ws = await connectStreamer(sessionWsUrl, config.token, sessionId);
        logger?.info(`[arp-terminal] Reconnected on attempt ${attempt}`);

        // Re-wire message handler
        ws.on('message', handleControlMessage);
        ws.on('close', () => {
          if (!ended) attemptReconnect();
        });

        // Re-send resize so relay knows current dimensions
        if (pty) {
          ws.send(JSON.stringify({ type: 'resize', cols: pty.cols, rows: pty.rows }));
        }

        startHeartbeat();
        reconnecting = false;
        return;
      } catch (err) {
        logger?.warn(`[arp-terminal] Reconnect attempt ${attempt} failed: ${err}`);
      }
    }

    reconnecting = false;
    logger?.error(`[arp-terminal] Failed to reconnect within grace period, cleaning up`);
    cleanup();
    resolveExit();
  }

  // --- Connect WebSocket ---
  ws = await connectStreamer(sessionWsUrl, config.token, sessionId);

  ws.on('message', handleControlMessage);
  ws.on('close', () => {
    if (!ended) attemptReconnect();
  });

  startHeartbeat();

  // --- Spawn PTY ---
  const shell = config.command ?? process.env.SHELL ?? 'bash';
  pty = nodePty.spawn(shell, [], {
    name: 'xterm-256color',
    cols,
    rows,
    env: process.env as Record<string, string>,
  });

  logger?.info(`[arp-terminal] Spawned PTY (${shell}, ${cols}x${rows})`);

  // Send initial resize
  ws.send(JSON.stringify({ type: 'resize', cols, rows }));

  // Pipe PTY output as binary frames
  pty.onData((data: string) => {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(Buffer.from(data, 'utf-8'));
    }
  });

  // Handle PTY exit
  pty.onExit(() => {
    logger?.info(`[arp-terminal] PTY exited for session ${sessionId}`);
    if (!ended) {
      cleanup();
    }
    resolveExit();
  });

  // --- Build session handle ---
  const session: TerminalSession = {
    id: sessionId,

    async end(summary: string): Promise<void> {
      if (ended) return;
      ended = true;

      // Send end control frame
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'end', summary }));
        // Brief pause to let the frame flush before closing
        await new Promise((r) => setTimeout(r, 500));
      }

      cleanup();
    },

    kill(): void {
      if (ended) return;
      cleanup();
      resolveExit();
    },

    onExit,
  };

  return session;
}
