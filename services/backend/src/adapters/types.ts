/** Normalized message from any platform (Slack, etc.) */
export interface IncomingMessage {
  /** Platform identifier, e.g. "slack" */
  platform: string;
  /** Channel/chat identifier (e.g. Slack channel ID) */
  chatId: string;
  /** Thread identifier within the chat, if any (e.g. Slack thread_ts) */
  threadId: string | null;
  /** Text content of the message */
  text: string;
  /** Platform-specific user identifier */
  userId: string | null;
  /** Display name of the sender */
  userName: string | null;
  /** Opaque raw payload for platform-specific use */
  raw: unknown;
}

export interface SendOptions {
  /** Thread to reply into (platform-specific ID) */
  threadId?: string;
}

export interface SendResult {
  /** The thread/message identifier (e.g. Slack message ts used as thread_ts) */
  threadId: string;
}

/**
 * Platform adapter — one implementation per messaging platform.
 * Implement parseWebhook, send, and formatText.
 */
export interface PlatformAdapter {
  readonly platform: string;

  /**
   * Parse a raw webhook request body + headers into an IncomingMessage.
   * Returns null for events that should be ignored (bot messages, unsupported types).
   * Throws on invalid signatures.
   */
  parseWebhook(body: unknown, headers: Record<string, string>): Promise<IncomingMessage | null>;

  /** Send a message to the platform. Returns the thread ID of the sent message. */
  send(chatId: string, text: string, options?: SendOptions): Promise<SendResult>;

  /** Format plain text with platform-appropriate markup (mrkdwn, markdown, etc.) */
  formatText(text: string): string;
}
