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
  agentId: string;       // Agent name (display identifier)
  agentUuid?: string;    // Agent UUID (canonical identifier, Stage 8a)
  channels: string[];
  enabled?: boolean;
}

export interface RecentMessage {
  agentId?: string;      // Agent name (legacy field name from server's agentName)
  agentName?: string;    // Agent name (server sends this in recentMessages)
  agentUuid?: string;    // Agent UUID
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

// Topic types
export interface ARPTopic {
  id: string;
  name: string;
  channelId: string;
  messageCount?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface ARPChannelMessage {
  id: string;
  channelId: string;
  content: string;
  senderId?: string;
  agentId?: string;
  agentName?: string;
  topicId?: string;
  createdAt?: string;
}

// WebSocket connection state
export interface ConnectionState {
  connected: boolean;
  reconnecting: boolean;
  lastConnected?: Date;
  error?: string;
}
