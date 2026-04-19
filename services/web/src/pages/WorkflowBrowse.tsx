import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AgentDto, WorkflowDto } from '@shared/contracts';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Drawer,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import { useState } from 'react';
import { rpc } from '../rpc';

// ── Create (form) modal ───────────────────────────────────────────────────────

// agentOrSkillId stores either an agentId (prefixed "agent:") or a skillId (prefixed "skill:")
// so a single dropdown can hold both kinds.
interface FormStep {
  kind: 'plan' | 'execute' | 'check';
  name: string;
  agentOrSkillId?: string;
  condition?: 'previous_check_failed';
  command?: string;
  timeoutSeconds?: number;
}

interface CreateWorkflowValues {
  name: string;
  description?: string;
  steps: FormStep[];
}

function StepRow({
  fieldName,
  stepNumber,
  agents,
  skills,
  onRemove,
}: {
  fieldName: number;
  stepNumber: number;
  agents: AgentDto[];
  skills: AgentDto[];
  onRemove: () => void;
}) {
  const form = Form.useFormInstance();
  const kind = Form.useWatch(['steps', fieldName, 'kind'], form);
  const agentOrSkillId = Form.useWatch(['steps', fieldName, 'agentOrSkillId'], form);

  // If selected value is a skill, check for declared agent dependencies
  const selectedSkillId = agentOrSkillId?.startsWith('skill:') ? agentOrSkillId.slice(6) : undefined;
  const selectedSkill = skills.find((s) => s.id === selectedSkillId);
  const dependsOn: string[] = (selectedSkill?.latestVersion?.definition as { dependsOn?: string[] })?.dependsOn ?? [];

  // Combined options: agents first (blue), then skills (purple)
  const combinedOptions = [
    ...(agents.length
      ? [{ label: <Typography.Text type="secondary" style={{ fontSize: 11 }}>Agents</Typography.Text>, options: agents.map((a) => ({ value: `agent:${a.id}`, label: a.name })) }]
      : []),
    ...(skills.length
      ? [{ label: <Typography.Text type="secondary" style={{ fontSize: 11 }}>Skills</Typography.Text>, options: skills.map((s) => ({ value: `skill:${s.id}`, label: s.name })) }]
      : []),
  ];

  return (
    <Card
      size="small"
      style={{ marginBottom: 8 }}
      title={<Typography.Text type="secondary" style={{ fontSize: 12 }}>Step {stepNumber}</Typography.Text>}
      extra={<Button type="text" size="small" danger onClick={onRemove}>Remove</Button>}
    >
      {/* Kind + Name row */}
      <div style={{ display: 'flex', gap: 8 }}>
        <Form.Item
          name={[fieldName, 'kind']}
          rules={[{ required: true, message: 'Required' }]}
          style={{ flex: '0 0 120px', marginBottom: 8 }}
        >
          <Select
            placeholder="Kind"
            options={[
              { value: 'plan', label: 'Plan' },
              { value: 'execute', label: 'Execute' },
              { value: 'check', label: 'Check' },
            ]}
          />
        </Form.Item>

        <Form.Item
          name={[fieldName, 'name']}
          rules={[{ required: true, message: 'Name required' }]}
          style={{ flex: 1, marginBottom: 8 }}
        >
          <Input placeholder="Step name" />
        </Form.Item>
      </div>

      {/* Single agent-or-skill selector for plan / execute steps */}
      {(kind === 'plan' || kind === 'execute') && (
        <>
          <Form.Item
            name={[fieldName, 'agentOrSkillId']}
            label="Agent or skill"
            style={{ marginBottom: 8 }}
          >
            <Select
              allowClear
              placeholder="Select agent or skill (optional — uses default if blank)"
              options={combinedOptions}
            />
          </Form.Item>

          {/* Dependency hint: shown when selected skill has declared agent dependencies */}
          {dependsOn.length > 0 && (
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 8, fontSize: 12 }}
              message={
                <>
                  This skill depends on:{' '}
                  <strong>
                    {dependsOn.map((id) => agents.find((a) => a.id === id)?.name ?? id).join(', ')}
                  </strong>
                  . Their prompts will be loaded automatically as base context.
                </>
              }
            />
          )}

          {kind === 'execute' && (
            <Form.Item
              name={[fieldName, 'condition']}
              label="Condition"
              style={{ marginBottom: 0 }}
            >
              <Select
                allowClear
                placeholder="Always run"
                options={[{ value: 'previous_check_failed', label: 'If previous check failed' }]}
              />
            </Form.Item>
          )}
        </>
      )}

      {/* Command for check steps */}
      {kind === 'check' && (
        <div style={{ display: 'flex', gap: 8 }}>
          <Form.Item
            name={[fieldName, 'command']}
            label="Command"
            rules={[{ required: true, message: 'Command required' }]}
            style={{ flex: 1, marginBottom: 0 }}
          >
            <Input placeholder="npm test" />
          </Form.Item>
          <Form.Item
            name={[fieldName, 'timeoutSeconds']}
            label="Timeout (s)"
            style={{ flex: '0 0 110px', marginBottom: 0 }}
          >
            <Input type="number" placeholder="300" />
          </Form.Item>
        </div>
      )}
    </Card>
  );
}

function toFormStep(s: Record<string, unknown>): FormStep {
  const agent = s.agent as { agentId?: string } | undefined;
  const agentOrSkillId = agent?.agentId
    ? `agent:${agent.agentId}`
    : s.skillId
      ? `skill:${s.skillId as string}`
      : undefined;
  return {
    kind: s.kind as 'plan' | 'execute' | 'check',
    name: s.name as string,
    agentOrSkillId,
    condition: s.condition as 'previous_check_failed' | undefined,
    command: s.command as string | undefined,
    timeoutSeconds: s.timeoutSeconds as number | undefined,
  };
}

function CreateWorkflowModal({
  open,
  onClose,
  onCreated,
  workflowId,
  initialValues,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  workflowId?: string;
  initialValues?: CreateWorkflowValues;
}) {
  const isEdit = !!workflowId;
  const qc = useQueryClient();
  const [form] = Form.useForm<CreateWorkflowValues>();
  const [error, setError] = useState<string | null>(null);

  const agentsQuery = useQuery({
    queryKey: ['agents', { kind: 'agent' }],
    queryFn: () => rpc.agents.list({ kind: 'agent', limit: 100 }),
    enabled: open,
  });

  const skillsQuery = useQuery({
    queryKey: ['agents', { kind: 'skill' }],
    queryFn: () => rpc.agents.list({ kind: 'skill', limit: 100 }),
    enabled: open,
  });

  // Decode agentOrSkillId prefix back to agentId / skillId before sending to API
  function decodeSteps(steps: FormStep[]) {
    return steps.map((s) => {
      const { agentOrSkillId, ...rest } = s;
      const agentId = agentOrSkillId?.startsWith('agent:') ? agentOrSkillId.slice(6) : undefined;
      const skillId = agentOrSkillId?.startsWith('skill:') ? agentOrSkillId.slice(6) : undefined;
      return { ...rest, agentId, skillId };
    });
  }

  const mutation = useMutation({
    mutationFn: (v: CreateWorkflowValues) => {
      const steps = decodeSteps(v.steps);
      if (isEdit) {
        return rpc.workflows.update({ workflowId, name: v.name, description: v.description, steps });
      }
      return rpc.workflows.create({ source: 'form', name: v.name, description: v.description, steps });
    },
    onSuccess: () => {
      onCreated();
      if (isEdit) {
        qc.invalidateQueries({ queryKey: ['workflow', workflowId] });
      }
      onClose();
      setError(null);
      form.resetFields();
    },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : String(err)),
  });

  const defaultInitialValues: CreateWorkflowValues = {
    name: '',
    steps: [
      { kind: 'plan', name: 'Plan', agentOrSkillId: undefined },
      { kind: 'execute', name: 'Implement', agentOrSkillId: undefined },
    ],
  };

  return (
    <Modal
      title={isEdit ? 'Edit workflow' : 'Create workflow'}
      open={open}
      onCancel={() => { onClose(); setError(null); form.resetFields(); }}
      footer={null}
      width={660}
      destroyOnClose
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={initialValues ?? defaultInitialValues}
        onFinish={(v) => mutation.mutate(v)}
        style={{ marginTop: 16 }}
      >
        {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} />}

        <Form.Item name="name" label="Name" rules={[{ required: true }]}>
          <Input placeholder="e.g. Plan with review" />
        </Form.Item>

        <Form.Item name="description" label="Description">
          <Input placeholder="What this workflow does" />
        </Form.Item>

        <Form.List name="steps" rules={[{ validator: async (_, steps) => { if (!steps || steps.length === 0) return Promise.reject(new Error('Add at least one step')); } }]}>
          {(fields, { add, remove }, { errors }) => (
            <>
              {fields.map((field, index) => (
                <StepRow
                  key={field.key}
                  fieldName={field.name}
                  stepNumber={index + 1}
                  agents={agentsQuery.data ?? []}
                  skills={skillsQuery.data ?? []}
                  onRemove={() => remove(field.name)}
                />
              ))}

              <Form.ErrorList errors={errors} />

              <Space style={{ marginTop: 4 }}>
                <Button size="small" onClick={() => add({ kind: 'plan', name: 'Plan', agentOrSkillId: undefined })}>+ Plan step</Button>
                <Button size="small" onClick={() => add({ kind: 'execute', name: 'Implement', agentOrSkillId: undefined })}>+ Execute step</Button>
                <Button size="small" onClick={() => add({ kind: 'check', name: 'Verify' })}>+ Check step</Button>
              </Space>
            </>
          )}
        </Form.List>

        <Button type="primary" htmlType="submit" loading={mutation.isPending} style={{ marginTop: 16 }}>
          {isEdit ? 'Save' : 'Create'}
        </Button>
      </Form>
    </Modal>
  );
}

// ── Import (markdown / GitHub) modal ─────────────────────────────────────────

interface ImportFormValues {
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
    mutationFn: (v: ImportFormValues) => rpc.workflows.create(v),
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
      title="Import workflow"
      open={open}
      onCancel={() => { onClose(); setError(null); form.resetFields(); }}
      footer={null}
      destroyOnClose
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{ source: 'github' }}
        onFinish={(v) => mutation.mutate(v)}
        style={{ marginTop: 16 }}
      >
        {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} />}

        <Form.Item name="source" label="Source">
          <Select options={[{ value: 'github', label: 'GitHub URL' }, { value: 'inline', label: 'Paste markdown' }]} />
        </Form.Item>

        {source === 'github' || !source ? (
          <>
            <Form.Item name="githubUrl" label="GitHub URL" rules={[{ required: true }]}>
              <Input placeholder="github.com/org/repo/path/to/workflow.md" />
            </Form.Item>
            <Form.Item name="commitSha" label="Commit SHA (optional)">
              <Input placeholder="Leave blank for latest" />
            </Form.Item>
          </>
        ) : (
          <Form.Item name="inlineContent" label="Markdown" rules={[{ required: true }]} extra="Frontmatter must have kind: workflow">
            <Input.TextArea rows={10} />
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

function WorkflowDetailDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const detailQuery = useQuery({
    queryKey: ['workflow', id],
    queryFn: () => rpc.workflows.get({ workflowId: id }),
  });

  const agentsQuery = useQuery({
    queryKey: ['agents', { kind: 'agent' }],
    queryFn: () => rpc.agents.list({ kind: 'agent', limit: 100 }),
  });

  const skillsQuery = useQuery({
    queryKey: ['agents', { kind: 'skill' }],
    queryFn: () => rpc.agents.list({ kind: 'skill', limit: 100 }),
  });

  const agentMap = Object.fromEntries((agentsQuery.data ?? []).map((a) => [a.id, a.name]));
  const skillMap = Object.fromEntries((skillsQuery.data ?? []).map((s) => [s.id, s.name]));

  const wf = detailQuery.data;

  const steps = wf?.latestVersion
    ? ((wf.latestVersion.definition as { steps?: unknown[] })?.steps ?? [])
    : [];

  return (
    <Drawer title={wf?.name ?? 'Loading…'} open onClose={onClose} width={480}>
      {wf && (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Descriptions size="small" column={1}>
            <Descriptions.Item label="Description">{wf.description || '—'}</Descriptions.Item>
            {wf.latestVersion && (
              <>
                <Descriptions.Item label="Version">v{wf.latestVersion.version}</Descriptions.Item>
                <Descriptions.Item label="Source">{wf.latestVersion.source}</Descriptions.Item>
              </>
            )}
          </Descriptions>

          {steps.length > 0 && (
            <>
              <Typography.Text strong>Steps</Typography.Text>
              <Table
                size="small"
                dataSource={steps.map((s, i) => ({ ...s as object, _i: i }))}
                rowKey="_i"
                pagination={false}
                columns={[
                  {
                    title: '#',
                    dataIndex: '_i',
                    width: 32,
                    render: (n: number) => <Typography.Text type="secondary">{n + 1}</Typography.Text>,
                  },
                  {
                    title: 'Kind',
                    dataIndex: 'kind',
                    width: 80,
                    render: (k: string) => <Tag>{k}</Tag>,
                  },
                  { title: 'Name', dataIndex: 'name' },
                  {
                    title: 'Agent / Command',
                    render: (_: unknown, row: Record<string, unknown>) => {
                      if (row.command) return <Typography.Text code style={{ fontSize: 11 }}>{String(row.command)}</Typography.Text>;
                      const agentRef = row.agent as { ref?: string; agentId?: string } | undefined;
                      const agentName = agentRef?.agentId ? agentMap[agentRef.agentId] : undefined;
                      const skillName = row.skillId ? skillMap[row.skillId as string] : undefined;
                      if (agentName && skillName) {
                        return <Typography.Text style={{ fontSize: 12 }}>{agentName} + <Tag style={{ fontSize: 11 }}>{skillName}</Tag></Typography.Text>;
                      }
                      if (agentName) return <Typography.Text style={{ fontSize: 12 }}>{agentName}</Typography.Text>;
                      if (skillName) return <Tag color="blue" style={{ fontSize: 11 }}>{skillName}</Tag>;
                      return <Typography.Text type="secondary">default</Typography.Text>;
                    },
                  },
                ]}
              />
            </>
          )}
        </Space>
      )}
    </Drawer>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function WorkflowBrowse() {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [editingWorkflow, setEditingWorkflow] = useState<WorkflowDto | null>(null);

  const listQuery = useQuery({
    queryKey: ['workflows'],
    queryFn: () => rpc.workflows.list(),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['workflows'] });

  const columns = [
    {
      title: 'Name',
      dataIndex: 'name',
      render: (name: string, row: WorkflowDto) => (
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
      title: 'Steps',
      render: (_: unknown, row: WorkflowDto) => {
        const steps = (row.latestVersion?.definition as { steps?: unknown[] })?.steps ?? [];
        return steps.length ? (
          <Space size={4}>
            {(steps as Array<{ kind: string }>).map((s, i) => (
              <Tag key={i} style={{ fontSize: 11 }}>{s.kind}</Tag>
            ))}
          </Space>
        ) : '—';
      },
    },
    {
      title: 'Version',
      render: (_: unknown, row: WorkflowDto) =>
        row.latestVersion ? (
          <Tag>v{row.latestVersion.version} · {row.latestVersion.source}</Tag>
        ) : '—',
    },
    {
      title: 'Created',
      dataIndex: 'createdAt',
      render: (ts: string) => new Date(ts).toLocaleDateString(),
    },
    {
      title: 'Actions',
      render: (_: unknown, row: WorkflowDto) => (
        <Button
          type="link"
          size="small"
          onClick={() => setEditingWorkflow(row)}
        >
          Edit
        </Button>
      ),
    },
  ];

  const editingInitialValues: CreateWorkflowValues | undefined = editingWorkflow
    ? {
        name: editingWorkflow.name,
        description: editingWorkflow.description ?? undefined,
        steps: (
          (editingWorkflow.latestVersion?.definition as { steps?: Record<string, unknown>[] })?.steps ?? []
        ).map(toFormStep),
      }
    : undefined;

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h1 className="page-title">Workflows</h1>
          <p className="page-subtitle">Compose agents and checks into multi-step pipelines.</p>
        </div>
        <Space>
          <Button onClick={() => setShowImport(true)}>Import</Button>
          <Button type="primary" onClick={() => setShowCreate(true)}>Create workflow</Button>
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
          locale={{ emptyText: 'No workflows yet. Click Create workflow to build one.' }}
        />
      </Card>

      {selected && <WorkflowDetailDrawer id={selected} onClose={() => setSelected(null)} />}

      <CreateWorkflowModal open={showCreate} onClose={() => setShowCreate(false)} onCreated={invalidate} />
      <ImportModal open={showImport} onClose={() => setShowImport(false)} onCreated={invalidate} />
      <CreateWorkflowModal
        open={!!editingWorkflow}
        onClose={() => setEditingWorkflow(null)}
        onCreated={invalidate}
        workflowId={editingWorkflow?.id}
        initialValues={editingInitialValues}
      />
    </div>
  );
}
