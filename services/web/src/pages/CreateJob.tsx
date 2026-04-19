import { useQuery, useMutation } from '@tanstack/react-query';
import { Alert, Button, Card, Form, Input, Select, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import { rpc } from '../rpc';

interface FormValues {
  sessionId: string;
  task: string;
  githubUrl?: string;
  workflowId?: string;
}

export function CreateJob() {
  const navigate = useNavigate();
  const [form] = Form.useForm<FormValues>();

  const sessionsQuery = useQuery({
    queryKey: ['sessions'],
    queryFn: () => rpc.sessions.list(),
  });

  const workflowsQuery = useQuery({
    queryKey: ['workflows'],
    queryFn: () => rpc.workflows.list(),
  });

  const mutation = useMutation({
    mutationFn: (values: FormValues) =>
      rpc.jobs.create({
        sessionId: values.sessionId,
        task: values.task,
        githubUrl: values.githubUrl || undefined,
        workflowId: values.workflowId || undefined,
      }),
    onSuccess: (job) => navigate(`/jobs/${job.id}`),
  });

  return (
    <Card title="Submit a job">
      <Form
        form={form}
        layout="vertical"
        onFinish={(values) => mutation.mutate(values)}
      >
        <Form.Item
          name="sessionId"
          label="Session"
          rules={[{ required: true, message: 'select a session' }]}
        >
          <Select
            placeholder="Select a session"
            loading={sessionsQuery.isLoading}
            options={sessionsQuery.data?.map((s) => ({ value: s.id, label: s.title }))}
          />
        </Form.Item>

        <Form.Item
          name="task"
          label="What do you want done?"
          extra={<Typography.Text type="secondary">First line is the job title.</Typography.Text>}
          rules={[{ required: true, message: 'describe the task' }]}
        >
          <Input.TextArea
            rows={6}
            placeholder={
              'fix the failing tests\n\nThe unit tests in src/foo.test.ts are red; figure out why and fix them.'
            }
          />
        </Form.Item>

        <Form.Item
          name="workflowId"
          label="Workflow"
          extra={
            <Typography.Text type="secondary">
              Leave empty to use the session default.
            </Typography.Text>
          }
        >
          <Select
            allowClear
            placeholder="Session default"
            loading={workflowsQuery.isLoading}
            options={workflowsQuery.data?.map((wf) => ({
              value: wf.id,
              label: wf.name,
            }))}
          />
        </Form.Item>

        {mutation.error && (
          <Alert type="error" message={String(mutation.error)} style={{ marginBottom: 16 }} />
        )}

        <Button type="primary" htmlType="submit" loading={mutation.isPending}>
          Submit Job
        </Button>
      </Form>
    </Card>
  );
}
