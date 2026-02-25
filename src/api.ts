// ARP API utilities

import type { ARPAccount, ARPTopic, ARPChannelMessage } from './types.js';

function baseUrl(account: ARPAccount): string {
  return account.relayUrl.replace('wss://', 'https://').replace('ws://', 'http://');
}

function authHeaders(account: ARPAccount): Record<string, string> {
  return {
    'Authorization': `Bearer ${account.token}`,
    'Content-Type': 'application/json',
  };
}

export interface ChannelMemory {
  content: string;
  updatedAt: string | null;
  updatedBy: string | null;
}

/**
 * Fetch channel memory from ARP backend
 */
export async function getChannelMemory(
  account: ARPAccount,
  channelId: string,
  logger?: any
): Promise<ChannelMemory | null> {
  const url = `${baseUrl(account)}/channels/${channelId}/memory`;

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: authHeaders(account),
    });

    if (!res.ok) {
      if (res.status === 404) {
        return null;
      }
      logger?.warn(`[arp] Failed to fetch channel memory: ${res.status}`);
      return null;
    }

    const data = await res.json();
    if (!data.ok) {
      return null;
    }

    return {
      content: data.content || '',
      updatedAt: data.updatedAt || null,
      updatedBy: data.updatedBy || null,
    };
  } catch (err) {
    logger?.warn(`[arp] Error fetching channel memory: ${err}`);
    return null;
  }
}

/**
 * Update channel memory in ARP backend
 */
export async function updateChannelMemory(
  account: ARPAccount,
  channelId: string,
  content: string,
  logger?: any
): Promise<boolean> {
  const url = `${baseUrl(account)}/channels/${channelId}/memory`;

  try {
    const res = await fetch(url, {
      method: 'PUT',
      headers: authHeaders(account),
      body: JSON.stringify({ content }),
    });

    if (!res.ok) {
      logger?.warn(`[arp] Failed to update channel memory: ${res.status}`);
      return false;
    }

    const data = await res.json();
    return data.ok === true;
  } catch (err) {
    logger?.warn(`[arp] Error updating channel memory: ${err}`);
    return false;
  }
}

// --- Topic API ---

/**
 * List topics for a channel (includes message counts)
 */
export async function listTopics(
  account: ARPAccount,
  channelId: string,
  logger?: any
): Promise<ARPTopic[]> {
  const url = `${baseUrl(account)}/channels/${channelId}/topics`;

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: authHeaders(account),
    });

    if (!res.ok) {
      logger?.warn(`[arp] Failed to list topics: ${res.status}`);
      return [];
    }

    const data = await res.json();
    return data.topics ?? [];
  } catch (err) {
    logger?.warn(`[arp] Error listing topics: ${err}`);
    return [];
  }
}

/**
 * Create a new topic in a channel
 */
export async function createTopic(
  account: ARPAccount,
  channelId: string,
  name: string,
  logger?: any
): Promise<ARPTopic | null> {
  const url = `${baseUrl(account)}/channels/${channelId}/topics`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: authHeaders(account),
      body: JSON.stringify({ name }),
    });

    if (!res.ok) {
      const errorText = await res.text();
      logger?.warn(`[arp] Failed to create topic: ${res.status} ${errorText}`);
      return null;
    }

    const data = await res.json();
    return data.topic ?? null;
  } catch (err) {
    logger?.warn(`[arp] Error creating topic: ${err}`);
    return null;
  }
}

/**
 * Move messages to a topic (bulk update)
 */
export async function moveMessagesToTopic(
  account: ARPAccount,
  channelId: string,
  messageIds: string[],
  topicId: string,
  logger?: any
): Promise<{ ok: boolean; updated?: number; error?: string }> {
  const url = `${baseUrl(account)}/channels/${channelId}/messages/bulk-topic`;

  try {
    const res = await fetch(url, {
      method: 'PATCH',
      headers: authHeaders(account),
      body: JSON.stringify({ messageIds, topicId }),
    });

    if (!res.ok) {
      const errorText = await res.text();
      logger?.warn(`[arp] Failed to move messages: ${res.status} ${errorText}`);
      return { ok: false, error: `HTTP ${res.status}: ${errorText}` };
    }

    const data = await res.json();
    return { ok: true, updated: data.updated ?? messageIds.length };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger?.warn(`[arp] Error moving messages: ${error}`);
    return { ok: false, error };
  }
}

/**
 * List messages in a channel (with optional topic filter)
 */
export async function listMessages(
  account: ARPAccount,
  channelId: string,
  options?: { topicId?: string; limit?: number; before?: string },
  logger?: any
): Promise<ARPChannelMessage[]> {
  const params = new URLSearchParams();
  if (options?.topicId) params.set('topicId', options.topicId);
  if (options?.limit) params.set('limit', String(options.limit));
  if (options?.before) params.set('before', options.before);

  const qs = params.toString();
  const url = `${baseUrl(account)}/channels/${channelId}/messages${qs ? `?${qs}` : ''}`;

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: authHeaders(account),
    });

    if (!res.ok) {
      logger?.warn(`[arp] Failed to list messages: ${res.status}`);
      return [];
    }

    const data = await res.json();
    return data.messages ?? [];
  } catch (err) {
    logger?.warn(`[arp] Error listing messages: ${err}`);
    return [];
  }
}
