import type { FleetDto } from '@shared/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Badge,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Progress,
  Select,
  Switch,
  Table,
  Tag,
} from 'antd';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { rpc } from '../rpc';

const STATUS_COLOR: Record<string, string> = {
  draft: 'default',
  running: 'processing',
  scouting: 'processing',
  planning: 'processing',
  implementing: 'processing',
  paused: 'warning',
  completed: 'success',
  failed: 'error',
  cancelled: 'default',
};

interface CreateForm {
  title: string;
  goal: string;
  task: string;
  sessionIds: string[];
  autoApprove: boolean;
  maxParallel: number;
}

export function FleetList() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [createForm] = Form.useForm<CreateForm>();
  const [error, setError] = useState('');

  const fleetsQuery = useQuery({
    queryKey: ['fleets'],
    queryFn: () => rpc.fleets.list(),
  });

  const sessionsQuery = useQuery({
    queryKey: ['sessions'],
    queryFn: () => rpc.sessions.list(),
  });

  const createMutation = useMutation({
    mutationFn: (values: CreateForm) =>
      rpc.fleets.createFanOut({
        title: values.title,
        goal: values.goal,
        task: values.task,
        sessionIds: values.sessionIds,
        autoApprove: values.autoApprove,
        maxParallel: values.maxParallel,
      }),
    onSuccess: (fleet) => {
      qc.invalidateQueries({ queryKey: ['fleets'] });
      setShowCreate(false);
      createForm.resetFields();
      navigate(`/fleets/${fleet.id}`);
    },
    onError: (err: Error) => setError(err.message),
  });

  const columns = [
    {
      title: 'Title',
      dataIndex: 'title',
      key: 'title',
      render: (title: string, record: FleetDto) => (
        <button
          type="button"
          style={{
            background: 'none',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            color: 'inherit',
          }}
          onClick={() => navigate(`/fleets/${record.id}`)}
        >
          {title}
        </button>
      ),
    },
    {
      title: 'Mode',
      dataIndex: 'mode',
      key: 'mode',
      render: (mode: string) => (
        <Tag color={mode === 'orchestrated' ? 'purple' : 'blue'}>
          {mode === 'orchestrated' ? 'Orchestrated' : 'Fan-out'}
        </Tag>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => (
        <Badge
          status={STATUS_COLOR[status] as Parameters<typeof Badge>[0]['status']}
          text={status}
        />
      ),
    },
    {
      title: 'Progress',
      key: 'progress',
      render: (_: unknown, record: FleetDto) => {
        const done = record.completedJobs + record.noopJobs;
        const pct = record.totalJobs > 0 ? Math.round((done / record.totalJobs) * 100) : 0;
        return (
          <div style={{ minWidth: 120 }}>
            <Progress
              percent={pct}
              size="small"
              status={
                record.status === 'failed'
                  ? 'exception'
                  : record.status === 'completed'
                    ? 'success'
                    : 'active'
              }
              format={() => `${done}/${record.totalJobs}`}
            />
          </div>
        );
      },
    },
    {
      title: 'Created',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (v: string) => new Date(v).toLocaleString(),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
        }}
      >
        <h2 style={{ margin: 0 }}>Fleets</h2>
        <Button type="primary" onClick={() => setShowCreate(true)}>
          New Fleet
        </Button>
      </div>

      <Table
        dataSource={fleetsQuery.data ?? []}
        columns={columns}
        rowKey="id"
        loading={fleetsQuery.isLoading}
        pagination={{ pageSize: 20 }}
        onRow={(record) => ({ onClick: () => navigate(`/fleets/${record.id}`) })}
        style={{ cursor: 'pointer' }}
      />

      <Modal
        title="New Fan-Out Fleet"
        open={showCreate}
        onCancel={() => {
          setShowCreate(false);
          setError('');
          createForm.resetFields();
        }}
        footer={null}
        width={560}
      >
        {error && <Alert type="error" message={error} style={{ marginBottom: 12 }} />}
        <Form
          form={createForm}
          layout="vertical"
          initialValues={{ autoApprove: false, maxParallel: 10 }}
          onFinish={(values) => {
            setError('');
            createMutation.mutate(values);
          }}
        >
          <Form.Item name="title" label="Title" rules={[{ required: true }]}>
            <Input placeholder="e.g. Upgrade dependency X across all repos" />
          </Form.Item>
          <Form.Item name="goal" label="Goal" rules={[{ required: true }]}>
            <Input.TextArea
              rows={2}
              placeholder="High-level description of what this fleet should achieve"
            />
          </Form.Item>
          <Form.Item name="task" label="Task (sent to each session)" rules={[{ required: true }]}>
            <Input.TextArea rows={3} placeholder="Upgrade library X to v2.0.0 and run tests" />
          </Form.Item>
          <Form.Item
            name="sessionIds"
            label="Sessions"
            rules={[{ required: true, type: 'array', min: 1 }]}
          >
            <Select
              mode="multiple"
              loading={sessionsQuery.isLoading}
              placeholder="Select sessions (each owns a repo)"
              options={(sessionsQuery.data ?? []).map((s) => ({ value: s.id, label: s.title }))}
              filterOption={(input, opt) =>
                String(opt?.label ?? '')
                  .toLowerCase()
                  .includes(input.toLowerCase())
              }
            />
          </Form.Item>
          <div style={{ display: 'flex', gap: 16 }}>
            <Form.Item name="autoApprove" label="Auto-approve plans" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item name="maxParallel" label="Max parallel jobs">
              <InputNumber min={1} max={50} style={{ width: 80 }} />
            </Form.Item>
          </div>
          <Form.Item style={{ marginBottom: 0, textAlign: 'right' }}>
            <Button onClick={() => setShowCreate(false)} style={{ marginRight: 8 }}>
              Cancel
            </Button>
            <Button type="primary" htmlType="submit" loading={createMutation.isPending}>
              Create
            </Button>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
