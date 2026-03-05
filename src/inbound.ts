// ARP Inbound - Handle incoming messages from ARP relay

import type {
  ARPMessage,
  ARPAccount,
  TurnNotification,
  SynthesisRequest,
  MentionNotification,
  ChannelMessage,
  RecentMessage
} from './types.js';

export interface InboundContext {
  sessionKey: string;
  chatId: string;
  message: string;
  metadata: {
    flowId?: string;
    topic?: string;
    isSynthesis?: boolean;
    senderId?: string;
    isPassive?: boolean;
  };
}

function formatRecentMessages(messages?: RecentMessage[]): string {
  if (!messages || messages.length === 0) return '';

  let history = '\n\nDISCUSSION HISTORY:\n';
  for (const msg of messages) {
    // Server sends agentName in recentMessages; agentId is legacy field name
    const name = msg.agentName || msg.agentId || 'unknown';
    history += `[${name}]: ${msg.content}\n`;
  }
  history += '---\n';
  return history;
}

function memoryToolInstructions(channelId: string, agentId: string): string {
  return `
MEMORY TOOL INSTRUCTIONS:
You have a tool called "update_channel_memory" that persists shared context for this channel.
When a user asks you to remember, note, save, or keep track of something, you MUST use this tool.
- channelId: "${channelId}"
- content: The FULL updated memory (this REPLACES existing memory, so merge with what's in Channel Memory above)
Trigger phrases: "remember", "note that", "save this", "keep in mind", "don't forget", "record that"
If you were directly addressed (e.g. "${agentId}, remember X"), write immediately.
If the request is ambiguous (e.g. "everyone remember X"), still write — but first check the Channel Memory above to avoid duplicating something already stored.
`;
}

export function processInbound(
  message: ARPMessage,
  account: ARPAccount,
  logger?: any
): InboundContext | null {
  const { type, channelId } = message;
  
  if (!channelId) {
    logger?.warn(`[arp] Message missing channelId: ${type}`);
    return null;
  }

  switch (type) {
    case 'turn_notification': {
      const turn = message as TurnNotification;
      const sessionKey = turn.flowId 
        ? `arp:channel:${channelId}:flow:${turn.flowId}`
        : `arp:channel:${channelId}`;
      
      let prompt = `You are ${account.agentId} responding in an ARP bounded discussion.\n\n`;
      prompt += `CHANNEL: ${channelId}\n`;
      prompt += `FLOW: ${turn.flowId}\n`;
      prompt += `TOPIC: ${turn.topic}\n`;
      
      if (turn.rolePrompt) {
        prompt += `YOUR ROLE: ${turn.rolePrompt}\n`;
      }
      if (turn.contextPrompt) {
        prompt += `CONTEXT: ${turn.contextPrompt}\n`;
      }
      
      prompt += formatRecentMessages(turn.recentMessages);
      prompt += memoryToolInstructions(channelId, account.agentId);
      prompt += `\nIt's your turn. Provide a substantive response to the discussion.`;

      logger?.info(`[arp] Processing turn_notification for flow ${turn.flowId}`);
      
      return {
        sessionKey,
        chatId: `${channelId}:${turn.flowId || 'main'}`,
        message: prompt,
        metadata: {
          flowId: turn.flowId,
          topic: turn.topic,
        },
      };
    }

    case 'synthesis_request': {
      const synth = message as SynthesisRequest;
      const sessionKey = synth.flowId
        ? `arp:channel:${channelId}:flow:${synth.flowId}`
        : `arp:channel:${channelId}`;
      
      let prompt = `You are ${account.agentId} and the TEAM LEAD for this ARP bounded discussion.\n\n`;
      prompt += `CHANNEL: ${channelId}\n`;
      prompt += `FLOW: ${synth.flowId}\n`;
      prompt += `TOPIC: ${synth.topic}\n`;
      prompt += formatRecentMessages(synth.recentMessages);
      prompt += memoryToolInstructions(channelId, account.agentId);
      prompt += `\nSynthesize the key findings, points of agreement, and actionable conclusions from the discussion above. If the discussion produced decisions or conclusions worth remembering, use the update_channel_memory tool to persist them.`;

      logger?.info(`[arp] Processing synthesis_request for flow ${synth.flowId}`);
      
      return {
        sessionKey,
        chatId: `${channelId}:${synth.flowId || 'main'}`,
        message: prompt,
        metadata: {
          flowId: synth.flowId,
          topic: synth.topic,
          isSynthesis: true,
        },
      };
    }

    case 'mention_notification': {
      const mention = message as MentionNotification;
      const sessionKey = `arp:channel:${channelId}`;
      
      let prompt = `You are ${account.agentId} and were @mentioned in an ARP channel.\n\n`;
      prompt += `CHANNEL: ${channelId}\n`;
      prompt += `MENTIONED BY: ${mention.senderId}\n`;
      prompt += `MESSAGE: ${mention.content}\n`;
      prompt += memoryToolInstructions(channelId, account.agentId);
      prompt += `\nRespond naturally and concisely to the mention above.`;

      logger?.info(`[arp] Processing mention_notification from ${mention.senderId}`);
      
      return {
        sessionKey,
        chatId: channelId,
        message: prompt,
        metadata: {
          senderId: mention.senderId,
        },
      };
    }

    case 'channel_message': {
      // Backend sends { type, channelId, message: { content, agentName, agentId, ... } }
      const innerMsg = (message as any).message || message;
      const sessionKey = `arp:channel:${channelId}`;
      // Backend uses agentName for display, agentId for UUID - prefer agentName for readability
      const senderId = innerMsg.agentName || innerMsg.senderId || innerMsg.sender_id || innerMsg.agentId || 'unknown';
      const content = innerMsg.content || '';

      let prompt = `You are ${account.agentId} observing a message in an ARP channel.\n\n`;
      prompt += `CHANNEL: ${channelId}\n`;
      prompt += `FROM: ${senderId}\n`;
      prompt += `MESSAGE: ${content}\n`;
      prompt += memoryToolInstructions(channelId, account.agentId);
      prompt += `\nYou received this as a passive channel message. You do NOT need to respond unless the message is directly relevant to you or requires your input. If you choose to respond, be concise and helpful. EXCEPTION: If the message asks to remember/save something, you MUST use the update_channel_memory tool even if you don't send a visible reply.`;

      logger?.info(`[arp] Processing channel_message from ${senderId}: ${content.substring(0, 50)}...`);

      return {
        sessionKey,
        chatId: channelId,
        message: prompt,
        metadata: {
          senderId,
          isPassive: true,
        },
      };
    }

    default:
      logger?.debug(`[arp] Ignoring message type: ${type}`);
      return null;
  }
}
