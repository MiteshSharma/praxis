import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Input, Tabs, notification } from 'antd';
import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { useNavigate, useParams } from 'react-router-dom';
import { rpc } from '../rpc';

export function MemoryEditor() {
  const params = useParams<{ '*': string }>();
  const repoKey = params['*'] ?? '';
  const navigate = useNavigate();

  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'view' | 'edit'>('view');

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['memories', 'get', repoKey],
    queryFn: () => rpc.memories.get({ repoKey }),
    enabled: !!repoKey,
  });

  useEffect(() => {
    if (data?.content !== undefined && draft === null) {
      setDraft(data.content);
    }
  }, [data?.content, draft]);

  const saveContent = draft ?? data?.content ?? '';

  const { mutate: save, isPending: saving } = useMutation({
    mutationFn: () => rpc.memories.update({ repoKey, content: saveContent }),
    onSuccess: ({ sizeBytes, entryCount }) => {
      notification.success({
        message: 'Memory saved',
        description: `${entryCount} entries · ${(sizeBytes / 1024).toFixed(1)} KB`,
      });
      queryClient.invalidateQueries({ queryKey: ['memories', 'get', repoKey] });
      queryClient.invalidateQueries({ queryKey: ['memories', 'list'] });
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      notification.error({ message: 'Save failed', description: msg, duration: 0 });
    },
  });

  const isDirty = draft !== null && draft !== data?.content;

  if (isLoading) {
    return (
      <div className="page-content">
        <p className="muted">Loading…</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="page-content">
        <div className="empty-state">
          <p className="empty-state-title">Not found</p>
          <p className="empty-state-description">
            No memory file exists for <code>{repoKey}</code>.
          </p>
          <button type="button" className="btn btn-secondary" onClick={() => navigate('/memories')}>
            ← Back to memory list
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page-content">
      {/* Breadcrumb */}
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() => navigate('/memories')}
        style={{ marginBottom: 16, paddingLeft: 0 }}
      >
        ← Back to memory list
      </button>

      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title" style={{ fontSize: 16 }}>
            {repoKey}
          </h1>
          <p className="page-subtitle">
            {data.entryCount} entries · {(data.sizeBytes / 1024).toFixed(1)} KB · updated{' '}
            {new Date(data.updatedAt).toLocaleString()}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {isDirty && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setDraft(data.content ?? null)}
            >
              Discard
            </button>
          )}
          <button
            type="button"
            className="btn btn-primary"
            disabled={!isDirty || saving}
            onClick={() => save()}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {/* Editor tabs */}
      <div
        style={{
          background: 'var(--c-surface)',
          border: '1px solid var(--c-border)',
          borderRadius: 10,
          overflow: 'hidden',
        }}
      >
        <Tabs
          activeKey={activeTab}
          onChange={(k) => setActiveTab(k as 'view' | 'edit')}
          style={{ padding: '0 16px' }}
          items={[
            {
              key: 'view',
              label: 'Preview',
              children: (
                <div className="prose" style={{ padding: '8px 0 16px', maxHeight: 600, overflowY: 'auto' }}>
                  <ReactMarkdown>{saveContent}</ReactMarkdown>
                </div>
              ),
            },
            {
              key: 'edit',
              label: 'Edit',
              children: (
                <Input.TextArea
                  value={saveContent}
                  onChange={(e) => setDraft(e.target.value)}
                  autoSize={{ minRows: 20 }}
                  style={{
                    fontFamily: "'Fira Code', 'Consolas', monospace",
                    fontSize: 12,
                    border: 'none',
                    borderRadius: 0,
                    padding: '8px 0 16px',
                    resize: 'none',
                  }}
                  variant="borderless"
                />
              ),
            },
          ]}
        />
      </div>

      <p className="small muted" style={{ marginTop: 12 }}>
        Memory may be updated by the next learning pass after a job on this repo completes.
      </p>
    </div>
  );
}
