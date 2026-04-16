import { useQuery, useMutation } from '@tanstack/react-query';
import { Alert, Button, Card, Form, Input, Select, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import { rpc } from '../rpc';

interface FormValues {
  githubUrl: string;
  githubBranch: string;
  input: string;
  workflowVersionId?: string;
}

export function CreateJob() {
  const navigate = useNavigate();
  const [form] = Form.useForm<FormValues>();

  const workflowsQuery = useQuery({
    queryKey: ['workflows'],
    queryFn: () => rpc.workflows.list(),
  });

  const mutation = useMutation({
    mutationFn: (values: FormValues) =>
      rpc.jobs.create({
        githubUrl: values.githubUrl,
        githubBranch: values.githubBranch || 'main',
        input: values.input,
        workflowVersionId: values.workflowVersionId || undefined,
      }),
    onSuccess: ({ jobId }) => navigate(`/jobs/${jobId}`),
  });

  return (
    <Card title="Run a new job">
      <Form
        form={form}
        layout="vertical"
        initialValues={{ githubBranch: 'main' }}
        onFinish={(values) => mutation.mutate(values)}
      >
        <Form.Item
          name="githubUrl"
          label="GitHub URL"
          rules={[{ required: true, type: 'url', message: 'enter a valid GitHub URL' }]}
        >
          <Input placeholder="https://github.com/you/your-repo" />
        </Form.Item>

        <Form.Item name="githubBranch" label="Branch">
          <Input placeholder="main" />
        </Form.Item>

        <Form.Item
          name="input"
          label="What do you want done?"
          extra={<Typography.Text type="secondary">First line is the title.</Typography.Text>}
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
          name="workflowVersionId"
          label="Workflow"
          extra={
            <Typography.Text type="secondary">
              Leave empty to use the default plan → execute flow.
            </Typography.Text>
          }
        >
          <Select
            allowClear
            placeholder="Default workflow (plan → execute)"
            loading={workflowsQuery.isLoading}
            options={workflowsQuery.data?.map((wf) => ({
              value: wf.latestVersion?.id ?? '',
              label: `${wf.name} v${wf.latestVersion?.version ?? 1}`,
            }))}
          />
        </Form.Item>

        {mutation.error && (
          <Alert type="error" message={String(mutation.error)} style={{ marginBottom: 16 }} />
        )}

        <Button type="primary" htmlType="submit" loading={mutation.isPending}>
          Run
        </Button>
      </Form>
    </Card>
  );
}
