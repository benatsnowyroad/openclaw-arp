// ARP Protocol Types

export interface ARPConfig {
  relayUrl: string;
  token: string;
  agentId: string;
  channels?: string[];
}

export interface ARPAccount {
  accountId: string;
  relayUrl: string;
  token: string;
  agentId: string;
  channels: string[];
  enabled?: boolean;
}

export interface RecentMessage {
  agentId: string;
  content: string;
  createdAt?: string;
}

// Inbound WebSocket messages from ARP relay
export interface ARPMessage {
  type: string;
  messageId?: string;
  channelId?: string;
  flowId?: string;
  topic?: string;
  content?: string;
  senderId?: string;
  rolePrompt?: string;
  contextPrompt?: string;
  recentMessages?: RecentMessage[];
}

export interface TurnNotification extends ARPMessage {
  type: 'turn_notification';
  channelId: string;
  flowId: string;
  topic: string;
  rolePrompt?: string;
  contextPrompt?: string;
  recentMessages?: RecentMessage[];
}

export interface SynthesisRequest extends ARPMessage {
  type: 'synthesis_request';
  channelId: string;
  flowId: string;
  topic: string;
  recentMessages?: RecentMessage[];
}

export interface MentionNotification extends ARPMessage {
  type: 'mention_notification';
  channelId: string;
  content: string;
  senderId: string;
}

export interface ChannelMessage extends ARPMessage {
  type: 'channel_message';
  channelId: string;
  messageId: string;
  content: string;
  senderId: string;
}

// Outbound message to ARP relay
export interface ARPOutboundMessage {
  agentId: string;
  content: string;
  isSynthesis?: boolean;
}

// WebSocket connection state
export interface ConnectionState {
  connected: boolean;
  reconnecting: boolean;
  lastConnected?: Date;
  error?: string;
}
