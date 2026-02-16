// ARP Channel Plugin Definition

import type { ARPAccount, ARPMessage } from './types.js';
import { ARPGateway } from './gateway.js';
import { processInbound } from './inbound.js';
import { sendToARP } from './outbound.js';

// Store active gateways per account
const gateways = new Map<string, ARPGateway>();

// Store pending responses (channelId:flowId -> response callback)
const pendingResponses = new Map<string, (content: string) => void>();

export function createARPChannel(api: any) {
  const logger = api.logger;

  const channel = {
    id: 'arp',
    
    meta: {
      id: 'arp',
      label: 'Agent Relay Protocol',
      selectionLabel: 'ARP (Multi-agent coordination)',
      docsPath: '/channels/arp',
      blurb: 'Multi-agent coordination and structured conversations via ARP',
      aliases: ['arp'],
    },

    capabilities: {
      chatTypes: ['direct', 'group'],
      media: {
        images: false,
        audio: false,
        video: false,
        documents: false,
      },
      reactions: false,
      threads: false,
      mentions: true,
    },

    config: {
      listAccountIds: (cfg: any) => {
        return Object.keys(cfg.channels?.arp?.accounts ?? {});
      },
      
      resolveAccount: (cfg: any, accountId?: string): ARPAccount | undefined => {
        const accounts = cfg.channels?.arp?.accounts ?? {};
        const id = accountId ?? 'default';
        const account = accounts[id];
        if (!account) return undefined;
        
        return {
          accountId: id,
          relayUrl: account.relayUrl,
          token: account.token,
          agentId: account.agentId,
          channels: account.channels ?? [],
          enabled: account.enabled !== false,
        };
      },
    },

    gateway: {
      start: async (cfg: any, accountId: string) => {
        const account = channel.config.resolveAccount(cfg, accountId);
        if (!account || !account.enabled) {
          logger.info(`[arp] Account ${accountId} not enabled, skipping`);
          return;
        }

        if (gateways.has(accountId)) {
          logger.warn(`[arp] Gateway already running for ${accountId}`);
          return;
        }

        const messageHandler = async (message: ARPMessage, acct: ARPAccount) => {
          const context = processInbound(message, acct, logger);
          if (!context) return;

          // Route to OpenClaw session
          try {
            // Emit the message to OpenClaw's message handling pipeline
            // The response will be caught by the outbound handler
            const chatKey = context.metadata.flowId 
              ? `${context.chatId}`
              : context.chatId;
            
            // Store callback for when response arrives
            pendingResponses.set(chatKey, async (responseContent: string) => {
              // Send response back to ARP
              const channelId = message.channelId!;
              await sendToARP(
                acct,
                channelId,
                responseContent,
                {
                  flowId: context.metadata.flowId,
                  isSynthesis: context.metadata.isSynthesis,
                },
                logger
              );
              pendingResponses.delete(chatKey);
            });

            // Trigger OpenClaw agent with the message
            // This uses the internal messaging API
            api.emitMessage({
              channel: 'arp',
              accountId,
              chatId: context.chatId,
              sessionKey: context.sessionKey,
              senderId: context.metadata.senderId ?? 'arp-system',
              text: context.message,
              timestamp: Date.now(),
            });

          } catch (err) {
            logger.error(`[arp] Failed to process message: ${err}`);
          }
        };

        const gateway = new ARPGateway(account, messageHandler, logger);
        gateways.set(accountId, gateway);

        try {
          await gateway.connect();
          logger.info(`[arp] Gateway started for ${accountId}`);
        } catch (err) {
          logger.error(`[arp] Failed to start gateway for ${accountId}: ${err}`);
          gateways.delete(accountId);
        }
      },

      stop: async (accountId: string) => {
        const gateway = gateways.get(accountId);
        if (gateway) {
          await gateway.disconnect();
          gateways.delete(accountId);
          logger.info(`[arp] Gateway stopped for ${accountId}`);
        }
      },
    },

    outbound: {
      deliveryMode: 'direct' as const,

      sendText: async ({ 
        text, 
        chatId, 
        accountId,
        cfg,
      }: {
        text: string;
        chatId: string;
        accountId?: string;
        cfg: any;
      }) => {
        const account = channel.config.resolveAccount(cfg, accountId);
        if (!account) {
          return { ok: false, error: 'Account not found' };
        }

        // Check if this is a response to a pending request
        const callback = pendingResponses.get(chatId);
        if (callback) {
          callback(text);
          return { ok: true };
        }

        // Otherwise, send as a direct channel message
        // Parse chatId to get channelId and optional flowId
        const [channelId, flowId] = chatId.split(':');
        
        const result = await sendToARP(
          account,
          channelId,
          text,
          { flowId },
          logger
        );

        return result;
      },
    },

    status: {
      getHealth: (accountId: string) => {
        const gateway = gateways.get(accountId);
        if (!gateway) {
          return { status: 'disconnected', message: 'Gateway not running' };
        }
        
        const state = gateway.getState();
        if (state.connected) {
          return { status: 'connected', message: 'Connected to ARP relay' };
        } else if (state.reconnecting) {
          return { status: 'reconnecting', message: 'Reconnecting to ARP relay' };
        } else {
          return { status: 'disconnected', message: state.error ?? 'Disconnected' };
        }
      },
    },
  };

  return channel;
}
