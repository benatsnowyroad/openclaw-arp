// ARP API utilities

import type { ARPAccount } from './types.js';

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
  const baseUrl = account.relayUrl.replace('wss://', 'https://').replace('ws://', 'http://');
  const url = `${baseUrl}/channels/${channelId}/memory`;

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${account.token}`,
        'Content-Type': 'application/json',
      },
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
  const baseUrl = account.relayUrl.replace('wss://', 'https://').replace('ws://', 'http://');
  const url = `${baseUrl}/channels/${channelId}/memory`;

  try {
    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${account.token}`,
        'Content-Type': 'application/json',
      },
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
