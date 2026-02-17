// ARP Gateway - WebSocket connection to ARP relay

import WebSocket from 'ws';
import type { ARPAccount, ARPMessage, ConnectionState } from './types.js';

export type MessageHandler = (message: ARPMessage, account: ARPAccount) => void;

export class ARPGateway {
  private ws: WebSocket | null = null;
  private account: ARPAccount;
  private messageHandler: MessageHandler;
  private logger: any;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 1000;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private state: ConnectionState = { connected: false, reconnecting: false };

  constructor(account: ARPAccount, messageHandler: MessageHandler, logger: any) {
    this.account = account;
    this.messageHandler = messageHandler;
    this.logger = logger;
  }

  async connect(): Promise<void> {
    const url = `${this.account.relayUrl}/ws/agent/${this.account.agentId}?token=${this.account.token}`;
    
    this.logger.info(`[arp] Connecting to relay: ${this.account.relayUrl}`);
    
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url);
      
      this.ws.on('open', () => {
        this.logger.info(`[arp] Connected to ARP relay`);
        this.state = { connected: true, reconnecting: false, lastConnected: new Date() };
        this.reconnectAttempts = 0;
        this.startHeartbeat();
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
        this.logger.warn(`[arp] Connection closed: code=${code} reason=${reasonStr}`);
        this.state.connected = false;
        this.stopHeartbeat();
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
        break;
      
      case 'heartbeat':
        this.sendHeartbeatAck();
        break;
      
      case 'turn_notification':
      case 'synthesis_request':
      case 'mention_notification':
      case 'channel_message':
        this.messageHandler(message, this.account);
        break;
      
      default:
        this.logger.debug(`[arp] Unhandled message type: ${message.type}`);
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

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.logger.error(`[arp] Max reconnect attempts reached`);
      return;
    }

    this.state.reconnecting = true;
    this.reconnectAttempts++;
    const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1), 60000);
    
    this.logger.info(`[arp] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    
    setTimeout(() => {
      this.connect().catch(err => {
        this.logger.error(`[arp] Reconnect failed: ${err.message}`);
      });
    }, delay);
  }

  async disconnect(): Promise<void> {
    this.stopHeartbeat();
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
   * Send a typing indicator to the ARP relay
   */
  sendTyping(channelId: string, action: 'start' | 'stop'): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'typing',
        channelId,
        agentId: this.account.agentId,
        action,
        timestamp: Date.now(),
      }));
      this.logger.debug(`[arp] Sent typing ${action} for channel ${channelId}`);
    }
  }
}
