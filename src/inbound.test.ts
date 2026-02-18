// Tests for ARP inbound message parsing
import { describe, it, expect } from 'vitest';
import { processInbound } from './inbound.js';
import type { ARPAccount } from './types.js';

const mockAccount: ARPAccount = {
  accountId: 'default',
  relayUrl: 'wss://example.com',
  token: 'test-token',
  agentId: 'test_bot',
  channels: ['test-channel-id'],
};

const mockLogger = {
  info: () => {},
  warn: () => {},
  debug: () => {},
  error: () => {},
};

describe('processInbound', () => {
  describe('channel_message', () => {
    it('extracts agentName for bot messages', () => {
      const message = {
        type: 'channel_message',
        channelId: 'test-channel-id',
        message: {
          id: 'msg-123',
          channelId: 'test-channel-id',
          agentId: 'ade7e4fc-148c-496f-9f63-7287473517a4',
          agentName: 'bass_daddy_bot',
          messageType: 'agent',
          content: 'Hello from bot',
          tokensUsed: 0,
          costUsed: 0,
          verified: false,
          createdAt: '2026-02-18T17:55:02.934838Z',
        },
      };

      const result = processInbound(message, mockAccount, mockLogger);

      expect(result).not.toBeNull();
      expect(result!.metadata?.senderId).toBe('bass_daddy_bot');
      expect(result!.message).toContain('FROM: bass_daddy_bot');
      expect(result!.message).toContain('Hello from bot');
    });

    it('extracts agentName for logged-in human messages', () => {
      const message = {
        type: 'channel_message',
        channelId: 'test-channel-id',
        message: {
          id: 'msg-456',
          channelId: 'test-channel-id',
          agentName: 'Andy', // Set when user is logged in
          messageType: 'human',
          content: 'Hello from human',
          tokensUsed: 0,
          costUsed: 0,
          verified: false,
          createdAt: '2026-02-18T17:54:57.106295Z',
        },
      };

      const result = processInbound(message, mockAccount, mockLogger);

      expect(result).not.toBeNull();
      expect(result!.metadata?.senderId).toBe('Andy');
      expect(result!.message).toContain('FROM: Andy');
    });

    it('falls back to "unknown" for unauthenticated human messages', () => {
      // This is the bug case: user not logged in = no agentName
      const message = {
        type: 'channel_message',
        channelId: 'test-channel-id',
        message: {
          id: 'msg-789',
          channelId: 'test-channel-id',
          messageType: 'human',
          content: 'Hello from anonymous',
          tokensUsed: 0,
          costUsed: 0,
          verified: false,
          createdAt: '2026-02-18T17:54:57.106295Z',
        },
      };

      const result = processInbound(message, mockAccount, mockLogger);

      expect(result).not.toBeNull();
      // Currently falls back to 'unknown' - this documents expected behavior
      expect(result!.metadata?.senderId).toBe('unknown');
      expect(result!.message).toContain('FROM: unknown');
    });

    it('extracts content correctly', () => {
      const message = {
        type: 'channel_message',
        channelId: 'test-channel-id',
        message: {
          id: 'msg-content',
          agentName: 'test_user',
          messageType: 'human',
          content: 'Test message content here',
        },
      };

      const result = processInbound(message, mockAccount, mockLogger);

      expect(result).not.toBeNull();
      expect(result!.message).toContain('MESSAGE: Test message content here');
    });

    it('sets isPassive metadata for channel messages', () => {
      const message = {
        type: 'channel_message',
        channelId: 'test-channel-id',
        message: {
          agentName: 'someone',
          content: 'passive message',
        },
      };

      const result = processInbound(message, mockAccount, mockLogger);

      expect(result).not.toBeNull();
      expect(result!.metadata?.isPassive).toBe(true);
    });
  });

  describe('turn_notification', () => {
    it('processes turn notification with topic', () => {
      const message = {
        type: 'turn_notification',
        channelId: 'test-channel-id',
        flowId: 'flow-123',
        topic: 'Discussion Topic',
        rolePrompt: 'You are a helpful assistant',
        contextPrompt: 'Context here',
      };

      const result = processInbound(message, mockAccount, mockLogger);

      expect(result).not.toBeNull();
      expect(result!.message).toContain('TOPIC: Discussion Topic');
      expect(result!.metadata?.topic).toBe('Discussion Topic');
      expect(result!.metadata?.flowId).toBe('flow-123');
    });
  });

  describe('mention_notification', () => {
    it('processes mention with sender', () => {
      const message = {
        type: 'mention_notification',
        channelId: 'test-channel-id',
        content: 'Hey @test_bot check this out',
        senderId: 'mentioner_bot',
      };

      const result = processInbound(message, mockAccount, mockLogger);

      expect(result).not.toBeNull();
      expect(result!.message).toContain('MENTIONED BY: mentioner_bot');
      expect(result!.message).toContain('Hey @test_bot check this out');
    });
  });

  describe('unknown message types', () => {
    it('returns null for unhandled message types', () => {
      const message = {
        type: 'unknown_type',
        channelId: 'test-channel-id',
      };

      const result = processInbound(message, mockAccount, mockLogger);

      expect(result).toBeNull();
    });
  });
});
