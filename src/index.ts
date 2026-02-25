// @openclaw/arp - Agent Relay Protocol Channel Plugin
// 
// This plugin enables OpenClaw to communicate with ARP (Agent Relay Protocol)
// for multi-agent coordination and structured conversations.

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { createARPChannel } from './channel.js';
import { setARPRuntime } from './runtime.js';
import { updateChannelMemory, listTopics, createTopic, moveMessagesToTopic, listMessages } from './api.js';

const plugin = {
  id: 'arp',
  name: '@openclaw/arp',
  description: 'Agent Relay Protocol channel plugin for OpenClaw',
  configSchema: emptyPluginConfigSchema(),

  register(api: OpenClawPluginApi) {
    const logger = api.logger;

    logger.info('[arp] Registering ARP channel plugin');

    // Store runtime for use across modules (session routing, reply dispatch)
    setARPRuntime(api.runtime);

    // Create and register the channel
    const channel = createARPChannel(api);
    api.registerChannel({ plugin: channel });

    // Helper to resolve ARP account from config
    function resolveAccount() {
      const cfg = api.config;
      const accounts = cfg.channels?.arp?.accounts ?? {};
      const account = accounts['default'];
      if (!account) return null;
      return {
        accountId: 'default',
        relayUrl: account.relayUrl,
        token: account.token,
        agentId: account.agentId,
        channels: account.channels ?? [],
        enabled: true,
      };
    }

    function noAccountError() {
      return { content: [{ type: 'text' as const, text: 'Error: No ARP account configured' }] };
    }

    // Register update_channel_memory tool
    api.registerTool({
      name: 'update_channel_memory',
      description: 'Update the shared memory for an ARP channel. Use this to store important context, decisions, or information that should persist across sessions and be visible to all bots in the channel.',
      parameters: {
        type: 'object',
        properties: {
          channelId: {
            type: 'string',
            description: 'The ARP channel ID to update memory for',
          },
          content: {
            type: 'string',
            description: 'The new memory content (markdown). This REPLACES the existing content.',
          },
        },
        required: ['channelId', 'content'],
      },
      async execute(_id: string, params: { channelId: string; content: string }) {
        const arpAccount = resolveAccount();
        if (!arpAccount) return noAccountError();

        const success = await updateChannelMemory(arpAccount, params.channelId, params.content, logger);

        if (success) {
          logger.info(`[arp] Updated channel memory for ${params.channelId} (${params.content.length} chars)`);
          return {
            content: [{ type: 'text', text: `Channel memory updated successfully (${params.content.length} characters)` }],
          };
        } else {
          return {
            content: [{ type: 'text', text: 'Failed to update channel memory' }],
          };
        }
      },
    });

    // Register arp_list_topics tool
    api.registerTool({
      name: 'arp_list_topics',
      description: 'List all topics in an ARP channel, including message counts per topic.',
      parameters: {
        type: 'object',
        properties: {
          channelId: {
            type: 'string',
            description: 'The ARP channel ID',
          },
        },
        required: ['channelId'],
      },
      async execute(_id: string, params: { channelId: string }) {
        const arpAccount = resolveAccount();
        if (!arpAccount) return noAccountError();

        const topics = await listTopics(arpAccount, params.channelId, logger);
        logger.info(`[arp] Listed ${topics.length} topics for channel ${params.channelId}`);

        return {
          content: [{ type: 'text', text: JSON.stringify({ topics }, null, 2) }],
        };
      },
    });

    // Register arp_create_topic tool
    api.registerTool({
      name: 'arp_create_topic',
      description: 'Create a new topic in an ARP channel for organizing messages.',
      parameters: {
        type: 'object',
        properties: {
          channelId: {
            type: 'string',
            description: 'The ARP channel ID',
          },
          name: {
            type: 'string',
            description: 'Name for the new topic',
          },
        },
        required: ['channelId', 'name'],
      },
      async execute(_id: string, params: { channelId: string; name: string }) {
        const arpAccount = resolveAccount();
        if (!arpAccount) return noAccountError();

        const topic = await createTopic(arpAccount, params.channelId, params.name, logger);

        if (topic) {
          logger.info(`[arp] Created topic "${params.name}" in channel ${params.channelId}`);
          return {
            content: [{ type: 'text', text: JSON.stringify({ ok: true, topic }, null, 2) }],
          };
        } else {
          return {
            content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'Failed to create topic' }) }],
          };
        }
      },
    });

    // Register arp_move_messages tool
    api.registerTool({
      name: 'arp_move_messages',
      description: 'Move one or more messages to a topic in an ARP channel.',
      parameters: {
        type: 'object',
        properties: {
          channelId: {
            type: 'string',
            description: 'The ARP channel ID',
          },
          messageIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'Array of message IDs to move',
          },
          topicId: {
            type: 'string',
            description: 'The target topic ID to move messages into',
          },
        },
        required: ['channelId', 'messageIds', 'topicId'],
      },
      async execute(_id: string, params: { channelId: string; messageIds: string[]; topicId: string }) {
        const arpAccount = resolveAccount();
        if (!arpAccount) return noAccountError();

        const result = await moveMessagesToTopic(
          arpAccount, params.channelId, params.messageIds, params.topicId, logger
        );

        if (result.ok) {
          logger.info(`[arp] Moved ${result.updated} messages to topic ${params.topicId} in channel ${params.channelId}`);
        }

        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      },
    });

    // Register arp_list_messages tool
    api.registerTool({
      name: 'arp_list_messages',
      description: 'List messages in an ARP channel, optionally filtered by topic.',
      parameters: {
        type: 'object',
        properties: {
          channelId: {
            type: 'string',
            description: 'The ARP channel ID',
          },
          topicId: {
            type: 'string',
            description: 'Optional topic ID to filter messages by',
          },
          limit: {
            type: 'number',
            description: 'Max number of messages to return (default: server default)',
          },
          before: {
            type: 'string',
            description: 'Cursor for pagination — return messages before this message ID',
          },
        },
        required: ['channelId'],
      },
      async execute(_id: string, params: { channelId: string; topicId?: string; limit?: number; before?: string }) {
        const arpAccount = resolveAccount();
        if (!arpAccount) return noAccountError();

        const messages = await listMessages(
          arpAccount, params.channelId,
          { topicId: params.topicId, limit: params.limit, before: params.before },
          logger
        );

        logger.info(`[arp] Listed ${messages.length} messages for channel ${params.channelId}${params.topicId ? ` (topic: ${params.topicId})` : ''}`);

        return {
          content: [{ type: 'text', text: JSON.stringify({ messages }, null, 2) }],
        };
      },
    });

    logger.info('[arp] ARP channel plugin registered');
  },
};

export default plugin;
