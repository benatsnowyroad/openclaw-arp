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
      // Use startAccount/stopAccount pattern (matches Telegram/Slack)
      startAccount: async (ctx: any) => {
        const account = ctx.account;
        const accountId = account.accountId ?? 'default';
        
        if (!account.enabled) {
          ctx.log?.info(`[arp] Account ${accountId} not enabled, skipping`);
          return;
        }

        if (gateways.has(accountId)) {
          ctx.log?.warn(`[arp] Gateway already running for ${accountId}`);
          return;
        }

        const arpAccount: ARPAccount = {
          accountId,
          relayUrl: account.relayUrl,
          token: account.token,
          agentId: account.agentId,
          channels: account.channels ?? [],
          enabled: true,
        };

        const messageHandler = async (message: ARPMessage, acct: ARPAccount) => {
          const context = processInbound(message, acct, ctx.log ?? logger);
          if (!context) return;

          // TODO: Wire proper native ingress via OpenClaw runtime
          // For now, send a fallback response so mentions don't hang
          try {
            const channelId = message.channelId;
            if (channelId) {
              await sendToARP(
                acct,
                channelId,
                `[ARP Plugin] Received message but native ingress not fully wired yet. Message type: ${message.type}`,
                {
                  flowId: context.metadata.flowId,
                  isSynthesis: context.metadata.isSynthesis,
                },
                ctx.log ?? logger
              );
            }
          } catch (err) {
            ctx.log?.error(`[arp] Failed to send fallback response: ${err}`);
            // Send error fallback to prevent stalling
            try {
              const channelId = message.channelId;
              if (channelId) {
                await sendToARP(
                  acct,
                  channelId,
                  `[ARP Plugin] Error processing message: ${err}`,
                  {},
                  ctx.log ?? logger
                );
              }
            } catch (e) {
              ctx.log?.error(`[arp] Failed to send error fallback: ${e}`);
            }
          }
        };

        const gateway = new ARPGateway(arpAccount, messageHandler, ctx.log ?? logger);
        gateways.set(accountId, gateway);

        try {
          await gateway.connect();
          ctx.log?.info(`[arp] Gateway started for ${accountId}`);
        } catch (err) {
          ctx.log?.error(`[arp] Failed to start gateway for ${accountId}: ${err}`);
          gateways.delete(accountId);
        }
      },

      stopAccount: async (ctx: any) => {
        const accountId = ctx.account?.accountId ?? 'default';
        const gateway = gateways.get(accountId);
        if (gateway) {
          await gateway.disconnect();
          gateways.delete(accountId);
          ctx.log?.info(`[arp] Gateway stopped for ${accountId}`);
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
