import type { PlatformConfigDto, ProviderConfigDto, SettingDto } from '@shared/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { rpc } from '../rpc';

// ── Providers ─────────────────────────────────────────────────────────────────

type Provider = 'anthropic' | 'openai' | 'openrouter' | 'azure';

const PROVIDERS: Array<{
  id: Provider;
  name: string;
  description: string;
  modelExamples: string[];
  docsHint: string;
  extraFields?: Array<{ key: string; label: string; placeholder: string; required: boolean }>;
}> = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    description: 'Claude models — the default provider.',
    docsHint: 'Get your API key at console.anthropic.com',
    modelExamples: ['claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-4-5-20251001'],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    description: 'GPT-4o, o-series, and Codex models.',
    docsHint: 'Get your API key at platform.openai.com',
    modelExamples: ['gpt-4o', 'gpt-4o-mini', 'o3', 'o4-mini', 'codex-mini-latest'],
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    description: 'Route to 200+ models via a single key. Prefix model names with openrouter/.',
    docsHint: 'Get your API key at openrouter.ai/keys',
    modelExamples: [
      'openrouter/anthropic/claude-opus-4',
      'openrouter/google/gemini-2.5-pro',
      'openrouter/google/gemini-2.0-flash-001',
      'openrouter/moonshot/kimi-k2',
    ],
    extraFields: [
      { key: 'site_url', label: 'Site URL', placeholder: 'https://yourapp.com', required: false },
      { key: 'site_name', label: 'Site name', placeholder: 'My App', required: false },
    ],
  },
  {
    id: 'azure',
    name: 'Azure AI Foundry',
    description:
      'Azure OpenAI deployments. Model name must be your deployment name (not the underlying model), prefixed with azure/.',
    docsHint:
      'Endpoint and key are in Azure portal → Azure OpenAI → Keys and Endpoint. The model name after azure/ must match your deployment name exactly.',
    modelExamples: ['azure/<your-deployment-name>'],
    extraFields: [
      {
        key: 'endpoint',
        label: 'Endpoint',
        placeholder:
          'https://<resource>.openai.azure.com/ or https://<project>.services.ai.azure.com/models',
        required: true,
      },
      {
        key: 'api_version',
        label: 'API version',
        placeholder: '2025-01-01-preview (leave blank for default)',
        required: false,
      },
    ],
  },
];

function ProviderBadge({ configured }: { configured: boolean }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        fontSize: 11,
        fontWeight: 600,
        padding: '2px 8px',
        borderRadius: 20,
        background: configured ? 'var(--c-success-bg, #e6f9f0)' : 'var(--c-surface-2, #f5f5f5)',
        color: configured ? 'var(--c-success)' : 'var(--c-text-3)',
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: configured ? 'var(--c-success)' : 'var(--c-border)',
        }}
      />
      {configured ? 'Configured' : 'Not configured'}
    </span>
  );
}

function ProviderModal({
  provider,
  current,
  onClose,
}: {
  provider: (typeof PROVIDERS)[number];
  current: ProviderConfigDto | undefined;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [apiKey, setApiKey] = useState('');
  const [extras, setExtras] = useState<Record<string, string>>(current?.config ?? {});
  const [error, setError] = useState('');

  const upsert = useMutation({
    mutationFn: () =>
      rpc.providers.upsert({ provider: provider.id, apiKey: apiKey.trim(), config: extras }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['providers'] });
      onClose();
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Failed to save'),
  });

  const remove = useMutation({
    mutationFn: () => rpc.providers.delete({ provider: provider.id }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['providers'] });
      onClose();
    },
  });

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div
        style={{
          background: 'var(--c-surface)',
          border: '1px solid var(--c-border)',
          borderRadius: 12,
          padding: 24,
          width: 460,
          maxWidth: '90vw',
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 2 }}>
          Configure {provider.name}
        </div>
        <div style={{ fontSize: 12, color: 'var(--c-text-3)', marginBottom: 18 }}>
          {provider.docsHint}
        </div>

        <div style={{ marginBottom: 14 }}>
          <label
            htmlFor="provider-api-key"
            style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6 }}
          >
            API Key
            {current?.configured && (
              <span style={{ fontWeight: 400, color: 'var(--c-text-3)' }}>
                {' '}
                — leave blank to keep {current.maskedKey}
              </span>
            )}
          </label>
          <input
            id="provider-api-key"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={current?.configured ? 'Enter new key to replace' : 'sk-…'}
            style={{
              width: '100%',
              padding: '8px 10px',
              borderRadius: 6,
              border: '1px solid var(--c-border)',
              fontSize: 13,
              background: 'var(--c-bg)',
              color: 'var(--c-text)',
              boxSizing: 'border-box',
            }}
          />
        </div>

        {provider.extraFields?.map((f) => (
          <div key={f.key} style={{ marginBottom: 14 }}>
            <label
              htmlFor={`provider-extra-${f.key}`}
              style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6 }}
            >
              {f.label}
              {!f.required && (
                <span style={{ fontWeight: 400, color: 'var(--c-text-3)' }}> (optional)</span>
              )}
            </label>
            <input
              id={`provider-extra-${f.key}`}
              type="text"
              value={extras[f.key] ?? ''}
              onChange={(e) => setExtras((p) => ({ ...p, [f.key]: e.target.value }))}
              placeholder={f.placeholder}
              style={{
                width: '100%',
                padding: '8px 10px',
                borderRadius: 6,
                border: '1px solid var(--c-border)',
                fontSize: 13,
                background: 'var(--c-bg)',
                color: 'var(--c-text)',
                boxSizing: 'border-box',
              }}
            />
          </div>
        ))}

        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--c-text-3)', marginBottom: 5 }}>
            Model examples
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {provider.modelExamples.map((m) => (
              <code
                key={m}
                style={{
                  fontSize: 11,
                  padding: '2px 7px',
                  borderRadius: 4,
                  background: 'var(--c-surface-2, #f5f5f5)',
                  color: 'var(--c-text)',
                }}
              >
                {m}
              </code>
            ))}
          </div>
        </div>

        {error && (
          <p style={{ color: 'var(--c-error)', fontSize: 12, marginBottom: 12 }}>{error}</p>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}>
          <div>
            {current?.configured && (
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                style={{ color: 'var(--c-error)' }}
                onClick={() => remove.mutate()}
                disabled={remove.isPending}
              >
                {remove.isPending ? 'Removing…' : 'Remove'}
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn btn-sm btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-sm"
              style={{ background: 'var(--c-primary)', color: '#fff', border: 'none' }}
              disabled={upsert.isPending || (!apiKey.trim() && !current?.configured)}
              onClick={() => upsert.mutate()}
            >
              {upsert.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProvidersSection() {
  const { data: providers = [], isLoading } = useQuery({
    queryKey: ['providers'],
    queryFn: () => rpc.providers.list(),
  });
  const [configuring, setConfiguring] = useState<Provider | null>(null);
  const configuringProvider = PROVIDERS.find((p) => p.id === configuring);
  const currentConfig = (id: Provider) => providers.find((d) => d.provider === id);

  return (
    <section style={{ marginBottom: 36 }}>
      <SectionHeader
        title="Providers"
        description="API keys for AI providers. Keys are stored securely and used for all jobs. Environment variables are used as fallback if no key is configured here."
      />
      {isLoading ? (
        <p className="muted small">Loading…</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {PROVIDERS.map((provider) => {
            const config = currentConfig(provider.id);
            return (
              <div
                key={provider.id}
                style={{
                  background: 'var(--c-surface)',
                  border: '1px solid var(--c-border)',
                  borderRadius: 10,
                  padding: '14px 18px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 16,
                }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 3 }}>
                    <span style={{ fontWeight: 600, fontSize: 14 }}>{provider.name}</span>
                    <ProviderBadge configured={config?.configured ?? false} />
                    {config?.configured && config.maskedKey && (
                      <span
                        style={{ fontSize: 11, color: 'var(--c-text-3)', fontFamily: 'monospace' }}
                      >
                        {config.maskedKey}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--c-text-3)' }}>
                    {provider.description}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={() => setConfiguring(provider.id)}
                >
                  {config?.configured ? 'Update' : 'Configure'}
                </button>
              </div>
            );
          })}
        </div>
      )}
      {configuring && configuringProvider && (
        <ProviderModal
          provider={configuringProvider}
          current={currentConfig(configuring)}
          onClose={() => setConfiguring(null)}
        />
      )}
    </section>
  );
}

// ── Auxiliary models ───────────────────────────────────────────────────────────

const MODEL_EXAMPLES = [
  { label: 'Anthropic Haiku (recommended — fast & cheap)', value: 'claude-haiku-4-5-20251001' },
  { label: 'Anthropic Sonnet', value: 'claude-sonnet-4-6' },
  { label: 'OpenAI GPT-4o Mini', value: 'gpt-4o-mini' },
  { label: 'OpenRouter — Gemini Flash', value: 'openrouter/google/gemini-2.0-flash-001' },
  { label: 'OpenRouter — Kimi K2', value: 'openrouter/moonshot/kimi-k2' },
  { label: 'Azure — (use your deployment name)', value: 'azure/' },
];

function SettingRow({
  setting,
  onSave,
}: { setting: SettingDto; onSave: (key: string, value: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(setting.value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const isDefault = setting.value === setting.defaultValue;

  async function handleSave() {
    if (!value.trim()) return;
    setSaving(true);
    setError('');
    try {
      await onSave(setting.key, value.trim());
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    setValue(setting.value);
    setEditing(false);
    setError('');
  }

  return (
    <div
      style={{
        background: 'var(--c-surface)',
        border: '1px solid var(--c-border)',
        borderRadius: 10,
        padding: '16px 20px',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 16,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ fontWeight: 600, fontSize: 14 }}>{formatKey(setting.key)}</span>
            {isDefault && (
              <span
                style={{
                  fontSize: 11,
                  padding: '1px 7px',
                  borderRadius: 10,
                  background: 'var(--c-surface-2, #f5f5f5)',
                  color: 'var(--c-text-3)',
                }}
              >
                default
              </span>
            )}
          </div>
          <p
            style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--c-text-3)', lineHeight: 1.5 }}
          >
            {setting.description}
          </p>

          {editing ? (
            <div>
              <input
                type="text"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={setting.defaultValue}
                style={{
                  width: '100%',
                  padding: '7px 10px',
                  borderRadius: 6,
                  border: '1px solid var(--c-primary)',
                  fontSize: 13,
                  background: 'var(--c-bg)',
                  color: 'var(--c-text)',
                  boxSizing: 'border-box',
                  fontFamily: 'monospace',
                  marginBottom: 8,
                }}
              />
              <div style={{ fontSize: 11, color: 'var(--c-text-3)', marginBottom: 8 }}>
                Examples:{' '}
                {MODEL_EXAMPLES.map((ex) => (
                  <button
                    key={ex.value}
                    type="button"
                    onClick={() => setValue(ex.value)}
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: '1px 4px',
                      cursor: 'pointer',
                      fontSize: 11,
                      color: 'var(--c-primary)',
                      textDecoration: 'underline',
                    }}
                    title={ex.label}
                  >
                    {ex.value}
                  </button>
                ))}
              </div>
              {error && (
                <p style={{ color: 'var(--c-error)', fontSize: 12, margin: '0 0 8px' }}>{error}</p>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn btn-sm btn-ghost" onClick={handleCancel}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  style={{ background: 'var(--c-primary)', color: '#fff', border: 'none' }}
                  disabled={saving || !value.trim()}
                  onClick={handleSave}
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
                {!isDefault && (
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    style={{ color: 'var(--c-text-3)' }}
                    onClick={() => setValue(setting.defaultValue)}
                  >
                    Reset to default
                  </button>
                )}
              </div>
            </div>
          ) : (
            <code
              style={{
                fontSize: 12,
                padding: '3px 8px',
                borderRadius: 5,
                background: 'var(--c-surface-2, #f5f5f5)',
                color: 'var(--c-text)',
              }}
            >
              {setting.value}
            </code>
          )}
        </div>

        {!editing && (
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => {
              setValue(setting.value);
              setEditing(true);
            }}
          >
            Edit
          </button>
        )}
      </div>
    </div>
  );
}

function AuxiliaryModelsSection() {
  const qc = useQueryClient();

  const { data = [], isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: () => rpc.settings.list(),
  });

  const update = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) =>
      rpc.settings.update({ key, value }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  });

  return (
    <section style={{ marginBottom: 36 }}>
      <SectionHeader
        title="Auxiliary models"
        description="Models used for learning and report passes after each job. These run single-turn with no tools — a fast, cheap model (Haiku, Flash, GPT-4o Mini) gives equivalent quality at a fraction of the cost. Must match a configured provider above."
      />
      {isLoading ? (
        <p className="muted small">Loading…</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {data.map((s) => (
            <SettingRow
              key={s.key}
              setting={s}
              onSave={async (key, value) => {
                await update.mutateAsync({ key, value });
              }}
            />
          ))}
        </div>
      )}
    </section>
  );
}

// ── Shared ────────────────────────────────────────────────────────────────────

function SectionHeader({ title, description }: { title: string; description: string }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <h3 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 600 }}>{title}</h3>
      <p style={{ margin: 0, fontSize: 12, color: 'var(--c-text-3)', lineHeight: 1.6 }}>
        {description}
      </p>
    </div>
  );
}

function formatKey(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Messaging (platform configs) ──────────────────────────────────────────────

const SLACK_FIELDS: Array<{ key: string; label: string; placeholder: string; isSecret: boolean }> =
  [
    { key: 'botToken', label: 'Bot token', placeholder: 'xoxb-…', isSecret: true },
    { key: 'signingSecret', label: 'Signing secret', placeholder: '…', isSecret: true },
  ];

function SlackModal({
  current,
  onClose,
}: {
  current: PlatformConfigDto | undefined;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [enabled, setEnabled] = useState(current?.enabled ?? true);
  const [error, setError] = useState('');

  const upsert = useMutation({
    mutationFn: () =>
      rpc.platformConfigs.upsert({
        platform: 'slack',
        secrets,
        enabled,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['platformConfigs'] });
      onClose();
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Failed to save'),
  });

  const remove = useMutation({
    mutationFn: () => rpc.platformConfigs.delete({ platform: 'slack' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['platformConfigs'] });
      onClose();
    },
  });

  const hasSecrets = SLACK_FIELDS.some((f) => secrets[f.key]?.trim());
  const canSave = current?.configured ? hasSecrets || true : hasSecrets;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div
        style={{
          background: 'var(--c-surface)',
          border: '1px solid var(--c-border)',
          borderRadius: 12,
          padding: 24,
          width: 460,
          maxWidth: '90vw',
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 2 }}>Configure Slack</div>
        <div style={{ fontSize: 12, color: 'var(--c-text-3)', marginBottom: 18 }}>
          Create a Slack app, add the <code>chat:write</code> and <code>channels:history</code>{' '}
          scopes, and subscribe to <code>message.channels</code> events.
        </div>

        {SLACK_FIELDS.map((f) => (
          <div key={f.key} style={{ marginBottom: 14 }}>
            <label
              htmlFor={`slack-field-${f.key}`}
              style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6 }}
            >
              {f.label}
              {current?.configured && current.maskedSecrets?.[f.key] && (
                <span style={{ fontWeight: 400, color: 'var(--c-text-3)' }}>
                  {' '}
                  — current: <code>{current.maskedSecrets[f.key]}</code>
                </span>
              )}
            </label>
            <input
              id={`slack-field-${f.key}`}
              type="password"
              value={secrets[f.key] ?? ''}
              onChange={(e) => setSecrets((p) => ({ ...p, [f.key]: e.target.value }))}
              placeholder={current?.configured ? 'Leave blank to keep existing' : f.placeholder}
              style={{
                width: '100%',
                padding: '8px 10px',
                borderRadius: 6,
                border: '1px solid var(--c-border)',
                fontSize: 13,
                background: 'var(--c-bg)',
                color: 'var(--c-text)',
                boxSizing: 'border-box',
              }}
            />
          </div>
        ))}

        <div style={{ marginBottom: 18, display: 'flex', alignItems: 'center', gap: 10 }}>
          <input
            type="checkbox"
            id="slack-enabled"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            style={{ width: 15, height: 15 }}
          />
          <label htmlFor="slack-enabled" style={{ fontSize: 13, cursor: 'pointer' }}>
            Enable Slack integration
          </label>
        </div>

        {error && (
          <p style={{ color: 'var(--c-error)', fontSize: 12, marginBottom: 12 }}>{error}</p>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}>
          <div>
            {current?.configured && (
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                style={{ color: 'var(--c-error)' }}
                onClick={() => remove.mutate()}
                disabled={remove.isPending}
              >
                {remove.isPending ? 'Removing…' : 'Remove'}
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn btn-sm btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-sm"
              style={{ background: 'var(--c-primary)', color: '#fff', border: 'none' }}
              disabled={upsert.isPending || !canSave}
              onClick={() => upsert.mutate()}
            >
              {upsert.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function MessagingSection() {
  const { data: platforms = [], isLoading } = useQuery({
    queryKey: ['platformConfigs'],
    queryFn: () => rpc.platformConfigs.list(),
  });
  const [showSlack, setShowSlack] = useState(false);
  const slack = platforms.find((p) => p.platform === 'slack');

  return (
    <section style={{ marginBottom: 36 }}>
      <SectionHeader
        title="Messaging"
        description="Connect a messaging platform so Praxis can accept tasks, notify on plan-ready, and report job outcomes."
      />
      {isLoading ? (
        <p className="muted small">Loading…</p>
      ) : (
        <div
          style={{
            background: 'var(--c-surface)',
            border: '1px solid var(--c-border)',
            borderRadius: 10,
            padding: '14px 18px',
            display: 'flex',
            alignItems: 'center',
            gap: 16,
          }}
        >
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 3 }}>
              <span style={{ fontWeight: 600, fontSize: 14 }}>Slack</span>
              <ProviderBadge configured={slack?.configured ?? false} />
              {slack?.enabled && slack?.configured && (
                <span
                  style={{
                    fontSize: 11,
                    padding: '1px 7px',
                    borderRadius: 10,
                    background: '#e8f5e9',
                    color: '#2e7d32',
                  }}
                >
                  enabled
                </span>
              )}
            </div>
            <div style={{ fontSize: 12, color: 'var(--c-text-3)' }}>
              Receive tasks from Slack messages and send plan / completion notifications back.
            </div>
            {slack?.configured && (
              <div
                style={{
                  fontSize: 11,
                  color: 'var(--c-text-3)',
                  marginTop: 4,
                  fontFamily: 'monospace',
                }}
              >
                Webhook URL: <code>/channels/slack/events</code>
              </div>
            )}
          </div>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setShowSlack(true)}>
            {slack?.configured ? 'Update' : 'Configure'}
          </button>
        </div>
      )}
      {showSlack && <SlackModal current={slack} onClose={() => setShowSlack(false)} />}
    </section>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function SettingsPage() {
  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: '24px 0' }}>
      <div style={{ marginBottom: 28 }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Settings</h2>
        <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--c-text-3)' }}>
          Global configuration for Praxis. Changes take effect on the next job run.
        </p>
      </div>

      <ProvidersSection />
      <MessagingSection />
      <AuxiliaryModelsSection />
    </div>
  );
}
