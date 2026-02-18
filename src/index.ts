// @openclaw/arp - Agent Relay Protocol Channel Plugin
// 
// This plugin enables OpenClaw to communicate with ARP (Agent Relay Protocol)
// for multi-agent coordination and structured conversations.

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { createARPChannel } from './channel.js';
import { setARPRuntime } from './runtime.js';
import { updateChannelMemory } from './api.js';

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
        const cfg = api.config;
        const accounts = cfg.channels?.arp?.accounts ?? {};
        const account = accounts['default'];
        
        if (!account) {
          return {
            content: [{ type: 'text', text: 'Error: No ARP account configured' }],
          };
        }

        const arpAccount = {
          accountId: 'default',
          relayUrl: account.relayUrl,
          token: account.token,
          agentId: account.agentId,
          channels: account.channels ?? [],
          enabled: true,
        };

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

    logger.info('[arp] ARP channel plugin registered');
  },
};

export default plugin;
