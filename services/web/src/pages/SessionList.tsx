import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Form, Input, Modal } from 'antd';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { rpc } from '../rpc';

interface CreateForm {
  title: string;
  defaultGithubUrl?: string;
}

interface EditForm {
  title: string;
}

interface SessionRow {
  id: string;
  title: string;
  defaultGithubUrl: string | null;
  updatedAt: string;
}

export function SessionList() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [showCreate, setShowCreate] = useState(false);
  const [createForm] = Form.useForm<CreateForm>();

  const [editingSession, setEditingSession] = useState<SessionRow | null>(null);
  const [editForm] = Form.useForm<EditForm>();

  const [deletingSession, setDeletingSession] = useState<SessionRow | null>(null);
  const [deleteConfirmed, setDeleteConfirmed] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const listQuery = useQuery({
    queryKey: ['sessions'],
    queryFn: () => rpc.sessions.list(),
  });

  const createMutation = useMutation({
    mutationFn: (values: CreateForm) =>
      rpc.sessions.create({
        title: values.title,
        githubUrl: values.defaultGithubUrl || undefined,
      }),
    onSuccess: (session) => {
      qc.invalidateQueries({ queryKey: ['sessions'] });
      setShowCreate(false);
      createForm.resetFields();
      navigate(`/sessions/${session.id}`);
    },
  });

  const renameMutation = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      rpc.sessions.update({ sessionId: id, title }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sessions'] });
      setEditingSession(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => rpc.sessions.delete({ sessionId: id }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sessions'] });
      setDeletingSession(null);
      setDeleteConfirmed(false);
      setDeleteError('');
    },
    onError: (err) => {
      setDeleteError(String(err));
    },
  });

  const sessions = listQuery.data ?? [];

  const openEdit = (e: React.MouseEvent, session: SessionRow) => {
    e.stopPropagation();
    setEditingSession(session);
    editForm.setFieldsValue({ title: session.title });
  };

  const openDelete = (e: React.MouseEvent, session: SessionRow) => {
    e.stopPropagation();
    setDeletingSession(session);
    setDeleteConfirmed(false);
    setDeleteError('');
  };

  return (
    <div className="page-content">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Sessions</h1>
          <p className="page-subtitle">Chat-style threads that trigger AI coding jobs.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setShowCreate(true)}>
          New session
        </button>
      </div>

      {listQuery.error && (
        <Alert type="error" message={String(listQuery.error)} style={{ marginBottom: 16 }} />
      )}

      {listQuery.isLoading ? (
        <div className="empty-state">
          <p className="empty-state-title">Loading…</p>
        </div>
      ) : sessions.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path d="M21 3H3a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h5l3 3 3-3h7a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
            </svg>
          </div>
          <p className="empty-state-title">No sessions yet</p>
          <p className="empty-state-description">
            Create a session to start sending coding tasks to Praxis.
          </p>
          <button type="button" className="btn btn-primary" onClick={() => setShowCreate(true)}>
            New session
          </button>
        </div>
      ) : (
        <div className="conv-list">
          {sessions.map((session) => (
            <div
              key={session.id}
              className="conv-card"
              style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'default' }}
            >
              {/* Main clickable area */}
              <button
                type="button"
                style={{ flex: 1, background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', minWidth: 0 }}
                onClick={() => navigate(`/sessions/${session.id}`)}
              >
                <div className="conv-card-body">
                  <span className="conv-card-title">{session.title}</span>
                  {session.defaultGithubUrl && (
                    <span className="conv-card-repo">
                      {session.defaultGithubUrl.replace('https://github.com/', '')}
                    </span>
                  )}
                </div>
              </button>

              <span className="conv-card-date" style={{ flexShrink: 0 }}>
                {new Date(session.updatedAt).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                })}
              </span>

              {/* Actions */}
              <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  title="Rename"
                  onClick={(e) => openEdit(e, session)}
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <path d="M11.5 2.5a2.121 2.121 0 0 1 3 3L5 15H2v-3L11.5 2.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
                  </svg>
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  title="Delete"
                  style={{ color: 'var(--c-error)' }}
                  onClick={(e) => openDelete(e, session)}
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <path d="M2 4h12M5 4V2h6v2M6 7v5M10 7v5M3 4l1 10h8l1-10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create modal */}
      <Modal
        title="New session"
        open={showCreate}
        onCancel={() => { setShowCreate(false); createForm.resetFields(); }}
        footer={null}
        destroyOnClose
      >
        <Form
          form={createForm}
          layout="vertical"
          onFinish={(values) => createMutation.mutate(values)}
          style={{ marginTop: 16 }}
        >
          <Form.Item name="title" label="Title" rules={[{ required: true }]}>
            <Input placeholder="Rate limiting work" autoFocus />
          </Form.Item>
          <Form.Item
            name="defaultGithubUrl"
            label="GitHub URL"
            extra="Jobs in this session will use this repo by default."
          >
            <Input placeholder="https://github.com/you/your-repo" />
          </Form.Item>
          {createMutation.error && (
            <Alert type="error" message={String(createMutation.error)} style={{ marginBottom: 16 }} />
          )}
          <Button type="primary" htmlType="submit" loading={createMutation.isPending}>
            Create
          </Button>
        </Form>
      </Modal>

      {/* Rename modal */}
      <Modal
        title="Rename session"
        open={!!editingSession}
        onCancel={() => setEditingSession(null)}
        footer={null}
        destroyOnClose
      >
        <Form
          form={editForm}
          layout="vertical"
          onFinish={({ title }) => {
            if (editingSession) renameMutation.mutate({ id: editingSession.id, title });
          }}
          style={{ marginTop: 16 }}
        >
          <Form.Item name="title" label="Name" rules={[{ required: true }]}>
            <Input autoFocus />
          </Form.Item>
          {renameMutation.error && (
            <Alert type="error" message={String(renameMutation.error)} style={{ marginBottom: 16 }} />
          )}
          <Button type="primary" htmlType="submit" loading={renameMutation.isPending}>
            Save
          </Button>
        </Form>
      </Modal>

      {/* Delete confirmation modal */}
      <Modal
        title="Delete session"
        open={!!deletingSession}
        onCancel={() => { setDeletingSession(null); setDeleteConfirmed(false); setDeleteError(''); }}
        footer={null}
        destroyOnClose
      >
        {!deleteConfirmed ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 8 }}>
            <p style={{ margin: 0 }}>
              Are you sure you want to delete <strong>{deletingSession?.title}</strong>?
              This will permanently remove the session and all its messages.
            </p>
            <p style={{ margin: 0, color: 'var(--c-text-2)', fontSize: 13 }}>
              Sessions with active jobs cannot be deleted.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <Button onClick={() => setDeletingSession(null)}>Cancel</Button>
              <Button danger onClick={() => setDeleteConfirmed(true)}>
                Yes, delete
              </Button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 8 }}>
            <p style={{ margin: 0 }}>
              This action is permanent and cannot be undone. Confirm to proceed.
            </p>
            {deleteError && (
              <Alert type="error" message={deleteError} />
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <Button onClick={() => setDeleteConfirmed(false)}>Back</Button>
              <Button
                danger
                type="primary"
                loading={deleteMutation.isPending}
                onClick={() => deletingSession && deleteMutation.mutate(deletingSession.id)}
              >
                Delete permanently
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
