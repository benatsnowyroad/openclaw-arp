// ARP Inbound - Handle incoming messages from ARP relay

import type { 
  ARPMessage, 
  ARPAccount, 
  TurnNotification, 
  SynthesisRequest, 
  MentionNotification,
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
  };
}

function formatRecentMessages(messages?: RecentMessage[]): string {
  if (!messages || messages.length === 0) return '';
  
  let history = '\n\nDISCUSSION HISTORY:\n';
  for (const msg of messages) {
    history += `[${msg.agentId}]: ${msg.content}\n`;
  }
  history += '---\n';
  return history;
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
      prompt += `\nSynthesize the key findings, points of agreement, and actionable conclusions from the discussion above.`;

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

    default:
      logger?.debug(`[arp] Ignoring message type: ${type}`);
      return null;
  }
}
