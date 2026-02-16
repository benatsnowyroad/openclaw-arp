// @openclaw/arp - Agent Relay Protocol Channel Plugin
// 
// This plugin enables OpenClaw to communicate with ARP (Agent Relay Protocol)
// for multi-agent coordination and structured conversations.

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { createARPChannel } from './channel.js';

const plugin = {
  id: 'arp',
  name: '@openclaw/arp',
  description: 'Agent Relay Protocol channel plugin for OpenClaw',
  configSchema: emptyPluginConfigSchema(),
  
  register(api: OpenClawPluginApi) {
    const logger = api.logger;
    
    logger.info('[arp] Registering ARP channel plugin');

    // Create and register the channel
    const channel = createARPChannel(api);
    api.registerChannel({ plugin: channel });

    logger.info('[arp] ARP channel plugin registered');
  },
};

export default plugin;
