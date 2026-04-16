import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AgentDto } from '@shared/contracts';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Drawer,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import { useState } from 'react';
import { rpc } from '../rpc';

const TOOL_OPTIONS = [
  'Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash',
  'WebFetch', 'WebSearch', 'TodoWrite', 'TodoRead',
].map((t) => ({ value: t, label: t }));

const MODEL_OPTIONS = [
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { value: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
  { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
];

// ── Create (form) modal ───────────────────────────────────────────────────────

interface CreateFormValues {
  kind: 'agent' | 'skill';
  name: string;
  description?: string;
  model: string;
  systemPrompt: string;
  allowedTools: string[];
}

function CreateModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form] = Form.useForm<CreateFormValues>();
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (v: CreateFormValues) =>
      rpc.agents.create({ source: 'form', ...v }),
    onSuccess: () => {
      onCreated();
      onClose();
      setError(null);
      form.resetFields();
    },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : String(err)),
  });

  return (
    <Modal
      title="Create agent / skill"
      open={open}
      onCancel={() => { onClose(); setError(null); form.resetFields(); }}
      footer={null}
      width={580}
      destroyOnClose
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{ kind: 'agent', model: 'claude-sonnet-4-6', allowedTools: ['Read', 'Glob', 'Grep', 'Bash', 'Edit', 'Write'] }}
        onFinish={(v) => mutation.mutate(v)}
        style={{ marginTop: 16 }}
      >
        {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} />}

        <Form.Item name="kind" label="Kind" rules={[{ required: true }]}>
          <Select options={[{ value: 'agent', label: 'Agent' }, { value: 'skill', label: 'Skill' }]} />
        </Form.Item>

        <Form.Item name="name" label="Name" rules={[{ required: true }]}>
          <Input placeholder="e.g. Coder, Code Reviewer, Test Writer" />
        </Form.Item>

        <Form.Item name="description" label="Description">
          <Input placeholder="What this agent / skill does" />
        </Form.Item>

        <Form.Item name="model" label="Model" rules={[{ required: true }]}>
          <Select options={MODEL_OPTIONS} />
        </Form.Item>

        <Form.Item name="systemPrompt" label="System prompt" rules={[{ required: true }]}>
          <Input.TextArea
            rows={6}
            placeholder="You are a senior software engineer…"
          />
        </Form.Item>

        <Form.Item name="allowedTools" label="Allowed tools">
          <Select mode="multiple" options={TOOL_OPTIONS} placeholder="Pick tools" />
        </Form.Item>

        <Button type="primary" htmlType="submit" loading={mutation.isPending}>
          Create
        </Button>
      </Form>
    </Modal>
  );
}

// ── Import (markdown / GitHub) modal ─────────────────────────────────────────

interface ImportFormValues {
  kind: 'agent' | 'skill';
  source: 'inline' | 'github';
  inlineContent?: string;
  githubUrl?: string;
  commitSha?: string;
}

function ImportModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form] = Form.useForm<ImportFormValues>();
  const [error, setError] = useState<string | null>(null);
  const source = Form.useWatch('source', form);

  const mutation = useMutation({
    mutationFn: (v: ImportFormValues) => rpc.agents.create(v),
    onSuccess: () => {
      onCreated();
      onClose();
      setError(null);
      form.resetFields();
    },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : String(err)),
  });

  return (
    <Modal
      title="Import agent / skill"
      open={open}
      onCancel={() => { onClose(); setError(null); form.resetFields(); }}
      footer={null}
      destroyOnClose
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{ kind: 'agent', source: 'github' }}
        onFinish={(v) => mutation.mutate(v)}
        style={{ marginTop: 16 }}
      >
        {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} />}

        <Form.Item name="kind" label="Kind">
          <Select options={[{ value: 'agent', label: 'Agent' }, { value: 'skill', label: 'Skill' }]} />
        </Form.Item>

        <Form.Item name="source" label="Source">
          <Select options={[{ value: 'github', label: 'GitHub URL' }, { value: 'inline', label: 'Paste markdown' }]} />
        </Form.Item>

        {source === 'github' || !source ? (
          <>
            <Form.Item name="githubUrl" label="GitHub URL" rules={[{ required: true }]}>
              <Input placeholder="github.com/org/repo/path/to/agent.md" />
            </Form.Item>
            <Form.Item name="commitSha" label="Commit SHA (optional)">
              <Input placeholder="Leave blank for latest" />
            </Form.Item>
          </>
        ) : (
          <Form.Item name="inlineContent" label="Markdown" rules={[{ required: true }]} extra="Frontmatter must have kind: agent">
            <Input.TextArea rows={8} />
          </Form.Item>
        )}

        <Button type="primary" htmlType="submit" loading={mutation.isPending}>
          Import
        </Button>
      </Form>
    </Modal>
  );
}

// ── Detail drawer ─────────────────────────────────────────────────────────────

function AgentDetailDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();

  const detailQuery = useQuery({
    queryKey: ['agent', id],
    queryFn: () => rpc.agents.get({ id }),
  });

  const skillsQuery = useQuery({
    queryKey: ['agent-skills', id],
    queryFn: () => rpc.agents.listSkills({ agentId: id }),
    enabled: detailQuery.data?.kind === 'agent',
  });

  const allSkillsQuery = useQuery({
    queryKey: ['agents', { kind: 'skill' }],
    queryFn: () => rpc.agents.list({ kind: 'skill', limit: 100 }),
    enabled: detailQuery.data?.kind === 'agent',
  });

  const attachMutation = useMutation({
    mutationFn: ({ skillId, position }: { skillId: string; position: number }) =>
      rpc.agents.attachSkill({ agentId: id, skillId, position }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agent-skills', id] }),
  });

  const detachMutation = useMutation({
    mutationFn: (skillId: string) => rpc.agents.detachSkill({ agentId: id, skillId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agent-skills', id] }),
  });

  const agent = detailQuery.data;
  const attachedIds = new Set((skillsQuery.data ?? []).map((s) => s.id));
  const availableSkills = (allSkillsQuery.data ?? []).filter((s) => !attachedIds.has(s.id));

  return (
    <Drawer
      title={
        agent ? (
          <Space>
            <Tag color={agent.kind === 'skill' ? 'purple' : 'blue'}>{agent.kind}</Tag>
            {agent.name}
          </Space>
        ) : 'Loading…'
      }
      open
      onClose={onClose}
      width={480}
    >
      {!agent ? null : (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Descriptions size="small" column={1}>
            <Descriptions.Item label="Description">{agent.description || '—'}</Descriptions.Item>
            {agent.latestVersion && (
              <>
                <Descriptions.Item label="Version">v{agent.latestVersion.version}</Descriptions.Item>
                <Descriptions.Item label="Source">{agent.latestVersion.source}</Descriptions.Item>
              </>
            )}
          </Descriptions>

          {agent.latestVersion && (
            <>
              <Typography.Text strong>Definition</Typography.Text>
              <pre style={{ background: '#f5f5f5', borderRadius: 4, padding: 12, fontSize: 12, overflow: 'auto', maxHeight: 220, margin: 0 }}>
                {JSON.stringify(agent.latestVersion.definition, null, 2)}
              </pre>
            </>
          )}

          {agent.kind === 'agent' && (
            <>
              <Typography.Text strong>Attached skills</Typography.Text>

              {(skillsQuery.data ?? []).length === 0 ? (
                <Typography.Text type="secondary">No skills attached.</Typography.Text>
              ) : (
                <Table
                  size="small"
                  dataSource={skillsQuery.data ?? []}
                  rowKey="id"
                  pagination={false}
                  columns={[
                    { title: 'Name', dataIndex: 'name' },
                    {
                      title: '',
                      key: 'detach',
                      width: 70,
                      render: (_: unknown, row: AgentDto) => (
                        <Popconfirm title="Detach?" onConfirm={() => detachMutation.mutate(row.id)} okText="Detach">
                          <Button type="text" size="small" danger>Detach</Button>
                        </Popconfirm>
                      ),
                    },
                  ]}
                />
              )}

              {availableSkills.length > 0 && (
                <Select
                  style={{ width: '100%' }}
                  placeholder="Attach a skill…"
                  options={availableSkills.map((s) => ({ value: s.id, label: s.name }))}
                  onChange={(skillId: string) =>
                    attachMutation.mutate({ skillId, position: (skillsQuery.data ?? []).length })
                  }
                  value={null}
                />
              )}
            </>
          )}
        </Space>
      )}
    </Drawer>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function AgentBrowse() {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const listQuery = useQuery({
    queryKey: ['agents'],
    queryFn: () => rpc.agents.list({ limit: 100 }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => rpc.agents.delete({ id }),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['agents'] });
      if (selected === id) setSelected(null);
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['agents'] });

  const columns = [
    {
      title: 'Kind',
      dataIndex: 'kind',
      width: 80,
      render: (kind: string) => (
        <Tag color={kind === 'skill' ? 'purple' : 'blue'}>{kind}</Tag>
      ),
    },
    {
      title: 'Name',
      dataIndex: 'name',
      render: (name: string, row: AgentDto) => (
        <Button type="link" style={{ padding: 0 }} onClick={() => setSelected(row.id)}>
          {name}
        </Button>
      ),
    },
    {
      title: 'Description',
      dataIndex: 'description',
      render: (d: string) => <Typography.Text type="secondary">{d || '—'}</Typography.Text>,
    },
    {
      title: 'Version',
      render: (_: unknown, row: AgentDto) =>
        row.latestVersion ? (
          <Tag>v{row.latestVersion.version} · {row.latestVersion.source}</Tag>
        ) : '—',
    },
    {
      title: '',
      key: 'actions',
      width: 80,
      render: (_: unknown, row: AgentDto) => (
        <Popconfirm
          title="Delete?"
          onConfirm={() => deleteMutation.mutate(row.id)}
          okText="Delete"
          okButtonProps={{ danger: true }}
        >
          <Button type="text" danger size="small">Delete</Button>
        </Popconfirm>
      ),
    },
  ];

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>Agents &amp; Skills</Typography.Title>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Agents run workflow steps. Skills are reusable capability modules attached to agents.
          </Typography.Text>
        </div>
        <Space>
          <Button onClick={() => setShowImport(true)}>Import</Button>
          <Button type="primary" onClick={() => setShowCreate(true)}>Create</Button>
        </Space>
      </div>

      {listQuery.error && <Alert type="error" message={String(listQuery.error)} />}

      <Card>
        <Table
          dataSource={listQuery.data ?? []}
          columns={columns}
          rowKey="id"
          loading={listQuery.isLoading}
          pagination={false}
          locale={{ emptyText: 'No agents or skills yet. Click Create or Import to add one.' }}
        />
      </Card>

      {selected && <AgentDetailDrawer id={selected} onClose={() => setSelected(null)} />}

      <CreateModal open={showCreate} onClose={() => setShowCreate(false)} onCreated={invalidate} />
      <ImportModal open={showImport} onClose={() => setShowImport(false)} onCreated={invalidate} />
    </Space>
  );
}
