// @openclaw/arp - Agent Relay Protocol Channel Plugin
// 
// This plugin enables OpenClaw to communicate with ARP (Agent Relay Protocol)
// for multi-agent coordination and structured conversations.

import { createARPChannel } from './channel.js';

export const id = 'arp';
export const name = '@openclaw/arp';

export default function register(api: any) {
  const logger = api.logger;
  
  logger.info('[arp] Registering ARP channel plugin');

  // Create and register the channel
  const channel = createARPChannel(api);
  api.registerChannel({ plugin: channel });

  logger.info('[arp] ARP channel plugin registered');

  // Return cleanup function
  return {
    cleanup: async () => {
      logger.info('[arp] Cleaning up ARP channel plugin');
      // Cleanup is handled by gateway.stop calls
    },
  };
}
