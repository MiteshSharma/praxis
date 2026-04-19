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

// ── Shared form values ────────────────────────────────────────────────────────

interface AgentFormValues {
  kind: 'agent' | 'skill';
  name: string;
  description?: string;
  model: string;
  systemPrompt: string;
  allowedTools: string[];
  dependsOn?: string[];
}

// ── Create / Edit modal ───────────────────────────────────────────────────────

function AgentFormModal({
  open,
  onClose,
  onSaved,
  editingAgent,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  editingAgent?: AgentDto | null;
}) {
  const isEdit = !!editingAgent;
  const [form] = Form.useForm<AgentFormValues>();
  const [error, setError] = useState<string | null>(null);
  const kind = Form.useWatch('kind', form);

  // Load all agents for the dependsOn selector (only relevant when kind=skill)
  const agentsQuery = useQuery({
    queryKey: ['agents', { kind: 'agent' }],
    queryFn: () => rpc.agents.list({ kind: 'agent', limit: 100 }),
    enabled: open,
  });

  const createMutation = useMutation({
    mutationFn: (v: AgentFormValues) =>
      rpc.agents.create({ source: 'form', ...v }),
    onSuccess: () => { onSaved(); onClose(); setError(null); form.resetFields(); },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : String(err)),
  });

  const updateMutation = useMutation({
    mutationFn: (v: AgentFormValues) =>
      rpc.agents.update({ agentId: editingAgent!.id, ...v }),
    onSuccess: () => { onSaved(); onClose(); setError(null); form.resetFields(); },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : String(err)),
  });

  const isPending = createMutation.isPending || updateMutation.isPending;

  const def = editingAgent?.latestVersion?.definition as {
    model?: string; systemPrompt?: string; allowedTools?: string[]; dependsOn?: string[]
  } | undefined;

  const initialValues: AgentFormValues = editingAgent
    ? {
        kind: editingAgent.kind,
        name: editingAgent.name,
        description: editingAgent.description || undefined,
        model: def?.model ?? 'claude-sonnet-4-6',
        systemPrompt: def?.systemPrompt ?? '',
        allowedTools: def?.allowedTools ?? [],
        dependsOn: def?.dependsOn ?? [],
      }
    : { kind: 'agent', model: 'claude-sonnet-4-6', allowedTools: ['Read', 'Glob', 'Grep', 'Bash', 'Edit', 'Write'], systemPrompt: '', dependsOn: [] };

  return (
    <Modal
      title={isEdit ? `Edit ${editingAgent?.kind}` : 'Create agent / skill'}
      open={open}
      onCancel={() => { onClose(); setError(null); form.resetFields(); }}
      footer={null}
      width={580}
      destroyOnClose
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={initialValues}
        onFinish={(v) => isEdit ? updateMutation.mutate(v) : createMutation.mutate(v)}
        style={{ marginTop: 16 }}
      >
        {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} />}

        <Form.Item name="kind" label="Kind" rules={[{ required: true }]}>
          <Select
            disabled={isEdit}
            options={[{ value: 'agent', label: 'Agent' }, { value: 'skill', label: 'Skill' }]}
          />
        </Form.Item>

        <Form.Item name="name" label="Name" rules={[{ required: true }]}>
          <Input placeholder="e.g. Coder, Code Reviewer, Plan review loop" />
        </Form.Item>

        <Form.Item name="description" label="Description">
          <Input placeholder="What this agent / skill does" />
        </Form.Item>

        <Form.Item name="model" label="Model" rules={[{ required: true }]}>
          <Select options={MODEL_OPTIONS} />
        </Form.Item>

        <Form.Item name="systemPrompt" label="System prompt" rules={[{ required: true }]}>
          <Input.TextArea rows={6} placeholder="You are a senior software engineer…" />
        </Form.Item>

        <Form.Item name="allowedTools" label="Allowed tools">
          <Select mode="multiple" options={TOOL_OPTIONS} placeholder="Pick tools" />
        </Form.Item>

        {/* dependsOn: only shown for skills — declares which agents form the base context */}
        {(kind === 'skill' || editingAgent?.kind === 'skill') && (
          <Form.Item
            name="dependsOn"
            label="Depends on (agents)"
            extra="When this skill is used standalone in a workflow step, these agents' prompts are loaded as base context first."
          >
            <Select
              mode="multiple"
              placeholder="Select agents this skill depends on"
              options={(agentsQuery.data ?? []).map((a) => ({ value: a.id, label: a.name }))}
              loading={agentsQuery.isLoading}
            />
          </Form.Item>
        )}

        <Button type="primary" htmlType="submit" loading={isPending}>
          {isEdit ? 'Save' : 'Create'}
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

function AgentDetailDrawer({
  id,
  onClose,
  onEdit,
}: {
  id: string;
  onClose: () => void;
  onEdit: (agent: AgentDto) => void;
}) {
  const qc = useQueryClient();

  const detailQuery = useQuery({
    queryKey: ['agent', id],
    queryFn: () => rpc.agents.get({ agentId: id }),
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

  // For skills: resolve dependsOn agent names
  const allAgentsQuery = useQuery({
    queryKey: ['agents', { kind: 'agent' }],
    queryFn: () => rpc.agents.list({ kind: 'agent', limit: 100 }),
    enabled: detailQuery.data?.kind === 'skill',
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

  const def = agent?.latestVersion?.definition as {
    dependsOn?: string[];
  } | undefined;
  const dependsOnIds: string[] = def?.dependsOn ?? [];
  const agentMap = Object.fromEntries((allAgentsQuery.data ?? []).map((a) => [a.id, a.name]));

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
      extra={agent && <Button size="small" onClick={() => onEdit(agent)}>Edit</Button>}
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

          {/* Skills: show depends-on agents */}
          {agent.kind === 'skill' && (
            <>
              <Typography.Text strong>Depends on</Typography.Text>
              {dependsOnIds.length === 0 ? (
                <Typography.Text type="secondary">No agent dependencies.</Typography.Text>
              ) : (
                <Space wrap>
                  {dependsOnIds.map((depId) => (
                    <Tag key={depId} color="blue">{agentMap[depId] ?? depId}</Tag>
                  ))}
                </Space>
              )}
            </>
          )}

          {/* Agents: show attached skills */}
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
  const [editingAgent, setEditingAgent] = useState<AgentDto | null>(null);

  const listQuery = useQuery({
    queryKey: ['agents'],
    queryFn: () => rpc.agents.list({ limit: 100 }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => rpc.agents.delete({ agentId: id }),
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
      width: 120,
      render: (_: unknown, row: AgentDto) => (
        <Space size={4}>
          <Button type="link" size="small" onClick={() => setEditingAgent(row)}>Edit</Button>
          <Popconfirm
            title="Delete?"
            onConfirm={() => deleteMutation.mutate(row.id)}
            okText="Delete"
            okButtonProps={{ danger: true }}
          >
            <Button type="text" danger size="small">Delete</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h1 className="page-title">Agents &amp; Skills</h1>
          <p className="page-subtitle">Agents run workflow steps. Skills are reusable modules attached to agents or used standalone.</p>
        </div>
        <Space>
          <Button onClick={() => setShowImport(true)}>Import</Button>
          <Button type="primary" onClick={() => setShowCreate(true)}>Create</Button>
        </Space>
      </div>

      {listQuery.error && <Alert type="error" message={String(listQuery.error)} style={{ marginBottom: 16 }} />}

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

      {selected && (
        <AgentDetailDrawer
          id={selected}
          onClose={() => setSelected(null)}
          onEdit={(agent) => { setSelected(null); setEditingAgent(agent); }}
        />
      )}

      <AgentFormModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onSaved={invalidate}
      />
      <AgentFormModal
        open={!!editingAgent}
        onClose={() => setEditingAgent(null)}
        onSaved={() => {
          invalidate();
          qc.invalidateQueries({ queryKey: ['agent', editingAgent?.id] });
        }}
        editingAgent={editingAgent}
      />
      <ImportModal open={showImport} onClose={() => setShowImport(false)} onCreated={invalidate} />
    </div>
  );
}
