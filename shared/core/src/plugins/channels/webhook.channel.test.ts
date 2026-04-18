import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We test WebhookChannel indirectly via the channelRegistry (self-registration pattern).
// Import after setting up vi.stubGlobal so the module picks up mocked fetch.

const mockFetch = vi.fn();

describe('WebhookChannel (via channelRegistry)', () => {
  let channelRegistry: import('../registry.js').PluginRegistry<
    import('../../channels/types.js').PraxisChannel
  >;

  beforeEach(async () => {
    vi.stubGlobal('fetch', mockFetch);
    // Import the registry and trigger self-registration by importing the channel
    const registryMod = await import('./registry.js');
    await import('./webhook.channel.js');
    channelRegistry = registryMod.channelRegistry;
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is registered as "webhook" in the channel registry', () => {
    expect(channelRegistry.has('webhook')).toBe(true);
  });

  it('onPlanReady POSTs the event as JSON to the configured URL', async () => {
    mockFetch.mockResolvedValue(new Response('', { status: 200 }));
    const channel = channelRegistry.create('webhook', { url: 'https://example.com/hook' });

    const event = {
      type: 'plan.ready' as const,
      jobId: 'job-1',
      planId: 'plan-1',
      callbackToken: 'tok-abc',
    };
    await channel.onPlanReady!(event as never);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://example.com/hook');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual(event);
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
  });

  it('throws when the server returns a non-2xx status', async () => {
    mockFetch.mockResolvedValue(new Response('Service Unavailable', { status: 503 }));
    const channel = channelRegistry.create('webhook', { url: 'https://example.com/hook' });

    await expect(channel.onPlanReady!({} as never)).rejects.toThrow('webhook POST failed: 503');
  });

  it('includes the response body text in the error message on failure', async () => {
    mockFetch.mockResolvedValue(new Response('not found', { status: 404 }));
    const channel = channelRegistry.create('webhook', { url: 'https://example.com/hook' });

    await expect(channel.onPlanReady!({} as never)).rejects.toThrow('404');
  });

  it('factory returns null when url is missing', () => {
    // PluginRegistry.create throws when factory returns null
    expect(() => channelRegistry.create('webhook', {})).toThrow(
      'plugin "webhook" failed to initialize',
    );
  });
});

describe('validateChannelConfig (webhook)', () => {
  it('throws for unknown channel type', async () => {
    const { validateChannelConfig } = await import('./registry.js');
    expect(() => validateChannelConfig('unknown-type', {})).toThrow(
      'unknown channel type: "unknown-type"',
    );
  });

  it('throws for webhook without url', async () => {
    await import('./webhook.channel.js'); // ensure self-registration
    const { validateChannelConfig } = await import('./registry.js');
    expect(() => validateChannelConfig('webhook', {})).toThrow('requires a "url"');
  });

  it('passes for webhook with url', async () => {
    await import('./webhook.channel.js');
    const { validateChannelConfig } = await import('./registry.js');
    expect(() => validateChannelConfig('webhook', { url: 'https://example.com' })).not.toThrow();
  });
});
