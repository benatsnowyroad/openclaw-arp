// ARP Outbound - Send messages to ARP relay

import type { ARPAccount, ARPOutboundMessage } from './types.js';

export interface SendResult {
  ok: boolean;
  messageId?: string;
  error?: string;
}

export async function sendToARP(
  account: ARPAccount,
  channelId: string,
  content: string,
  options?: {
    flowId?: string;
    isSynthesis?: boolean;
  },
  logger?: any
): Promise<SendResult> {
  const { flowId, isSynthesis } = options || {};
  
  // Build the endpoint URL
  let url: string;
  if (flowId) {
    url = `${account.relayUrl.replace('wss://', 'https://').replace('ws://', 'http://')}/channels/${channelId}/flows/${flowId}/messages`;
  } else {
    url = `${account.relayUrl.replace('wss://', 'https://').replace('ws://', 'http://')}/channels/${channelId}/messages`;
  }

  const body: ARPOutboundMessage = {
    agentId: account.agentId,
    content,
  };
  
  if (isSynthesis) {
    body.isSynthesis = true;
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${account.token}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger?.error(`[arp] Failed to send message: ${response.status} ${errorText}`);
      return { ok: false, error: `HTTP ${response.status}: ${errorText}` };
    }

    const result = await response.json();
    logger?.debug(`[arp] Message sent successfully: ${result.message?.id}`);
    
    return { ok: true, messageId: result.message?.id };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger?.error(`[arp] Failed to send message: ${error}`);
    return { ok: false, error };
  }
}
