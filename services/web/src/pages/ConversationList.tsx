import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Form, Input, Modal } from 'antd';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { rpc } from '../rpc';

interface CreateForm {
  title: string;
  defaultGithubUrl?: string;
}

export function ConversationList() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [form] = Form.useForm<CreateForm>();

  const listQuery = useQuery({
    queryKey: ['conversations'],
    queryFn: () => rpc.conversations.list(),
  });

  const createMutation = useMutation({
    mutationFn: (values: CreateForm) =>
      rpc.conversations.create({
        title: values.title,
        defaultGithubUrl: values.defaultGithubUrl || undefined,
      }),
    onSuccess: (conv) => {
      qc.invalidateQueries({ queryKey: ['conversations'] });
      setShowCreate(false);
      form.resetFields();
      navigate(`/conversations/${conv.id}`);
    },
  });

  const conversations = listQuery.data ?? [];

  return (
    <div className="page-content">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Conversations</h1>
          <p className="page-subtitle">Chat-style threads that trigger AI coding jobs.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setShowCreate(true)}>
          New conversation
        </button>
      </div>

      {listQuery.error && (
        <Alert type="error" message={String(listQuery.error)} style={{ marginBottom: 16 }} />
      )}

      {/* Conversation list */}
      {listQuery.isLoading ? (
        <div className="empty-state">
          <p className="empty-state-title">Loading…</p>
        </div>
      ) : conversations.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path d="M21 3H3a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h5l3 3 3-3h7a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
            </svg>
          </div>
          <p className="empty-state-title">No conversations yet</p>
          <p className="empty-state-description">
            Create a conversation to start sending coding tasks to Praxis.
          </p>
          <button type="button" className="btn btn-primary" onClick={() => setShowCreate(true)}>
            New conversation
          </button>
        </div>
      ) : (
        <div className="conv-list">
          {conversations.map((conv) => (
            <button
              key={conv.id}
              type="button"
              className="conv-card"
              onClick={() => navigate(`/conversations/${conv.id}`)}
            >
              <div className="conv-card-body">
                <span className="conv-card-title">{conv.title}</span>
                {conv.defaultGithubUrl && (
                  <span className="conv-card-repo">
                    {conv.defaultGithubUrl.replace('https://github.com/', '')}
                  </span>
                )}
              </div>
              <span className="conv-card-date">
                {new Date(conv.updatedAt).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                })}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Create modal */}
      <Modal
        title="New conversation"
        open={showCreate}
        onCancel={() => setShowCreate(false)}
        footer={null}
        destroyOnClose
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={(values) => createMutation.mutate(values)}
          style={{ marginTop: 16 }}
        >
          <Form.Item name="title" label="Title" rules={[{ required: true }]}>
            <Input placeholder="Rate limiting work" />
          </Form.Item>
          <Form.Item
            name="defaultGithubUrl"
            label="Default GitHub URL"
            extra="Optional — jobs in this conversation use this repo by default."
          >
            <Input placeholder="https://github.com/you/your-repo" />
          </Form.Item>
          {createMutation.error && (
            <Alert
              type="error"
              message={String(createMutation.error)}
              style={{ marginBottom: 16 }}
            />
          )}
          <Button type="primary" htmlType="submit" loading={createMutation.isPending}>
            Create
          </Button>
        </Form>
      </Modal>
    </div>
  );
}
