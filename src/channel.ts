// ARP Channel Plugin Definition

import type { ARPAccount, ARPMessage } from './types.js';
import { ARPGateway } from './gateway.js';
import { processInbound } from './inbound.js';
import { sendToARP } from './outbound.js';
import { getARPRuntime } from './runtime.js';

const CHANNEL_ID = 'arp' as const;

// Store active gateways per account
const gateways = new Map<string, ARPGateway>();

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

          const channelId = message.channelId;
          if (!channelId) return;

          try {
            await handleARPInbound({
              context,
              message,
              account: acct,
              config: ctx.cfg,
              log: ctx.log ?? logger,
            });
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            ctx.log?.error(`[arp] Failed to process inbound: ${errMsg}`);
            // Send error response to prevent flow from stalling
            try {
              await sendToARP(
                acct,
                channelId,
                `[ARP Plugin] Error processing message: ${errMsg}`,
                { flowId: context.metadata.flowId },
                ctx.log ?? logger,
              );
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

        // Parse chatId to get channelId and optional flowId
        const [channelId, flowId] = chatId.split(':');

        const result = await sendToARP(
          account,
          channelId,
          text,
          { flowId },
          logger,
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

// --- Inbound message handler using OpenClaw runtime ---

import type { InboundContext } from './inbound.js';

async function handleARPInbound(params: {
  context: InboundContext;
  message: ARPMessage;
  account: ARPAccount;
  config: any;
  log: any;
}): Promise<void> {
  const { context, message, account, config, log } = params;
  const core = getARPRuntime();

  const channelId = message.channelId!;
  const senderId = context.metadata.senderId ?? 'arp-system';

  // Resolve agent route (session key + agent binding)
  const route = core.channel.routing.resolveAgentRoute({
    cfg: config,
    channel: CHANNEL_ID,
    accountId: account.accountId,
    peer: {
      kind: 'group',
      id: channelId,
    },
  });

  // Resolve session store path
  const storePath = core.channel.session.resolveStorePath(config.session?.store, {
    agentId: route.agentId,
  });

  // Format envelope (adds timestamp/channel headers)
  const envelopeOptions = core.channel.reply.resolveEnvelopeFormatOptions(config);
  const previousTimestamp = core.channel.session.readSessionUpdatedAt({
    storePath,
    sessionKey: route.sessionKey,
  });

  const fromLabel = `arp:${senderId}`;
  const body = core.channel.reply.formatAgentEnvelope({
    channel: 'ARP',
    from: fromLabel,
    timestamp: Date.now(),
    previousTimestamp,
    envelope: envelopeOptions,
    body: context.message,
  });

  // Build finalized message context
  const ctxPayload = core.channel.reply.finalizeInboundContext({
    Body: body,
    RawBody: context.message,
    CommandBody: context.message,
    From: `arp:${channelId}`,
    To: `arp:${channelId}`,
    SessionKey: route.sessionKey,
    AccountId: route.accountId,
    ChatType: 'group',
    ConversationLabel: fromLabel,
    SenderName: senderId,
    SenderId: senderId,
    GroupSubject: context.metadata.topic ?? channelId,
    Provider: CHANNEL_ID,
    Surface: CHANNEL_ID,
    WasMentioned: message.type === 'mention_notification' ? true : undefined,
    Timestamp: Date.now(),
    OriginatingChannel: CHANNEL_ID,
    OriginatingTo: `arp:${channelId}`,
  });

  // Record inbound session (persists session state)
  await core.channel.session.recordInboundSession({
    storePath,
    sessionKey: ctxPayload.SessionKey ?? route.sessionKey,
    ctx: ctxPayload,
    onRecordError: (err: unknown) => {
      log?.error(`[arp] Failed updating session meta: ${String(err)}`);
    },
  });

  // Dispatch reply — triggers agent processing and delivers response via callback
  await core.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
    ctx: ctxPayload,
    cfg: config,
    dispatcherOptions: {
      deliver: async (payload: { text?: string }) => {
        const text = payload.text ?? '';
        if (!text.trim()) return;

        await sendToARP(
          account,
          channelId,
          text,
          {
            flowId: context.metadata.flowId,
            isSynthesis: context.metadata.isSynthesis,
          },
          log,
        );
      },
      onError: (err: unknown, info: { kind: string }) => {
        log?.error(`[arp] ${info.kind} reply failed: ${String(err)}`);
      },
    },
  });

  log?.info(`[arp] Processed ${message.type} for channel ${channelId}`);
}
