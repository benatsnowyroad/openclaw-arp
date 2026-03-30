// ARP Gateway - WebSocket connection to ARP relay

import WebSocket from 'ws';
import type { ARPAccount, ARPMessage, ConnectionState } from './types.js';

export type MessageHandler = (message: ARPMessage, account: ARPAccount) => void;

// Stability threshold: reset reconnect counter after this many ms of stable connection
const STABILITY_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

// Heartbeat watchdog: force reconnect if no server heartbeat received within this time
const HEARTBEAT_WATCHDOG_MS = 65 * 1000; // 65 seconds (server sends every 30s)

export class ARPGateway {
  private ws: WebSocket | null = null;
  private account: ARPAccount;
  private messageHandler: MessageHandler;
  private logger: any;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 1000;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private watchdogTimeout: NodeJS.Timeout | null = null;
  private lastServerHeartbeat: number = 0;
  private connectionStartTime: number = 0;
  private state: ConnectionState = { connected: false, reconnecting: false };

  constructor(account: ARPAccount, messageHandler: MessageHandler, logger: any) {
    this.account = account;
    this.messageHandler = messageHandler;
    this.logger = logger;
  }

  async connect(): Promise<void> {
    // Stage 8a: prefer UUID for WebSocket connection (server accepts both)
    const wsAgentId = this.account.agentUuid || this.account.agentId;
    const url = `${this.account.relayUrl}/ws/agent/${wsAgentId}?token=${this.account.token}`;
    
    this.logger.info(`[arp] Connecting to relay: ${this.account.relayUrl}`);
    
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url);
      
      this.ws.on('open', () => {
        this.logger.info(`[arp] Connected to ARP relay`);
        this.connectionStartTime = Date.now();
        this.lastServerHeartbeat = Date.now();
        this.state = { connected: true, reconnecting: false, lastConnected: new Date() };
        this.reconnectAttempts = 0;
        this.startHeartbeat();
        this.startWatchdog();
        resolve();
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        try {
          const message = JSON.parse(data.toString()) as ARPMessage;
          this.handleMessage(message);
        } catch (err) {
          this.logger.warn(`[arp] Failed to parse message: ${err}`);
        }
      });

      this.ws.on('close', (code, reason) => {
        const reasonStr = reason ? reason.toString() : 'no reason';
        
        // Enhanced logging for 4003 (replaced by new connection)
        if (code === 4003) {
          this.logger.error(`[arp] Connection replaced (4003): ${reasonStr}. Another instance may be connecting with same identity.`);
        } else {
          this.logger.warn(`[arp] Connection closed: code=${code} reason=${reasonStr}`);
        }
        
        this.state.connected = false;
        this.stopHeartbeat();
        this.stopWatchdog();
        this.scheduleReconnect();
      });

      this.ws.on('error', (err) => {
        this.logger.error(`[arp] WebSocket error: ${err.message}`);
        this.state.error = err.message;
        if (!this.state.connected) {
          reject(err);
        }
      });
    });
  }

  private handleMessage(message: ARPMessage): void {
    switch (message.type) {
      case 'hello':
        this.logger.info(`[arp] Received hello from relay`);
        this.lastServerHeartbeat = Date.now();
        break;
      
      case 'heartbeat':
        this.lastServerHeartbeat = Date.now();
        this.sendHeartbeatAck();
        // Check if connection has been stable long enough to reset retry counter
        this.checkStabilityAndResetRetries();
        break;
      
      case 'turn_notification':
      case 'synthesis_request':
      case 'mention_notification':
      case 'channel_message':
        this.lastServerHeartbeat = Date.now(); // Any message counts as activity
        this.messageHandler(message, this.account);
        break;

      case 'summary_request':
        this.lastServerHeartbeat = Date.now();
        this.handleSummaryRequest(message);
        break;
      
      default:
        this.logger.debug(`[arp] Unhandled message type: ${message.type}`);
    }
  }

  private checkStabilityAndResetRetries(): void {
    const connectionDuration = Date.now() - this.connectionStartTime;
    if (connectionDuration >= STABILITY_THRESHOLD_MS && this.reconnectAttempts > 0) {
      this.logger.info(`[arp] Connection stable for ${Math.round(connectionDuration / 1000)}s, resetting retry counter`);
      this.reconnectAttempts = 0;
    }
  }

  private sendHeartbeatAck(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'heartbeat_ack' }));
    }
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        // Presence ping
        this.ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  private startWatchdog(): void {
    // Check every 30s if we've received a heartbeat from server
    this.watchdogTimeout = setInterval(() => {
      const timeSinceLastHeartbeat = Date.now() - this.lastServerHeartbeat;
      if (timeSinceLastHeartbeat > HEARTBEAT_WATCHDOG_MS) {
        this.logger.warn(`[arp] Heartbeat watchdog triggered: no server heartbeat for ${Math.round(timeSinceLastHeartbeat / 1000)}s, forcing reconnect`);
        this.forceReconnect();
      }
    }, 30000);
  }

  private stopWatchdog(): void {
    if (this.watchdogTimeout) {
      clearInterval(this.watchdogTimeout);
      this.watchdogTimeout = null;
    }
  }

  private forceReconnect(): void {
    this.stopHeartbeat();
    this.stopWatchdog();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.state.connected = false;
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    // Prevent multiple concurrent reconnection attempts
    if (this.state.reconnecting) {
      this.logger.info(`[arp] Reconnect already in progress, skipping duplicate request`);
      return;
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.logger.error(`[arp] Max reconnect attempts (${this.maxReconnectAttempts}) reached. Connection will stay offline until gateway restart.`);
      return;
    }

    this.state.reconnecting = true;
    this.reconnectAttempts++;
    const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1), 60000);
    
    this.logger.info(`[arp] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
    
    setTimeout(() => {
      this.connect().catch(err => {
        this.logger.error(`[arp] Reconnect failed: ${err.message}`);
      });
    }, delay);
  }

  async disconnect(): Promise<void> {
    this.stopHeartbeat();
    this.stopWatchdog();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.state = { connected: false, reconnecting: false };
  }

  isConnected(): boolean {
    return this.state.connected && this.ws?.readyState === WebSocket.OPEN;
  }

  getState(): ConnectionState {
    return { ...this.state };
  }

  /**
   * Send an activity indicator to the ARP relay.
   * Supported activities: thinking, typing, coding, reviewing, waiting_io, idle.
   * Server expects: type="activity_start"|"activity_stop", channelId, activity=string
   */
  sendActivity(channelId: string, action: 'start' | 'stop', activity: string = 'typing'): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      const msgType = action === 'start' ? 'activity_start' : 'activity_stop';
      this.ws.send(JSON.stringify({
        type: msgType,
        channelId,
        activity,
      }));
      this.logger.debug(`[arp] Sent ${msgType} (${activity}) for channel ${channelId}`);
    }
  }

  /**
   * Send a typing indicator (backwards-compat wrapper around sendActivity).
   */
  sendTyping(channelId: string, action: 'start' | 'stop'): void {
    this.sendActivity(channelId, action, 'typing');
  }

  /**
   * Handle summary_request: generate a context summary and respond via WebSocket.
   * Uses channel memory + recent messages to build a seed prompt for forking.
   */
  private handleSummaryRequest(message: ARPMessage): void {
    const { requestId, channelId, channelName, memory, messages } = message as any;
    if (!requestId) {
      this.logger.warn('[arp] summary_request missing requestId');
      return;
    }

    this.logger.info(`[arp] Handling summary_request: requestId=${requestId} channel=${channelName || channelId}`);

    // Build summary from provided context
    const parts: string[] = [];
    
    if (channelName) {
      parts.push(`This channel (#${channelName}) has been discussing the following:`);
    }

    if (memory && typeof memory === 'string' && memory.trim()) {
      parts.push('');
      parts.push('**Key context:**');
      parts.push(memory.trim());
    }

    if (Array.isArray(messages) && messages.length > 0) {
      parts.push('');
      parts.push('**Recent discussion highlights:**');
      // Summarize last ~10 messages to keep it concise
      const recent = messages.slice(-10);
      for (const msg of recent) {
        const sender = msg.sender || msg.type || 'unknown';
        const content = typeof msg.content === 'string' ? msg.content.slice(0, 200) : '';
        if (content) {
          parts.push(`- ${sender}: ${content}${msg.content?.length > 200 ? '...' : ''}`);
        }
      }
    }

    if (parts.length === 0) {
      parts.push(`Forked from #${channelName || 'unknown'}. Continue the discussion here.`);
    }

    parts.push('');
    parts.push('Continue this discussion in the forked channel.');

    const summary = parts.join('\n');

    // Send response back over WebSocket
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'summary_response',
        requestId,
        summary,
      }));
      this.logger.info(`[arp] Sent summary_response for requestId=${requestId} (${summary.length} chars)`);
    } else {
      this.logger.error(`[arp] WebSocket not open, cannot send summary_response for requestId=${requestId}`);
    }
  }

}
