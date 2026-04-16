import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  Collapse,
  Descriptions,
  Form,
  Input,
  Radio,
  Space,
  Spin,
  Tag,
  Typography,
} from 'antd';
import { useState } from 'react';
import Markdown from 'react-markdown';
import { rpc } from '../rpc';

interface PlanReviewCardProps {
  jobId: string;
}

const PLAN_STATUS_COLOR: Record<string, string> = {
  draft: 'default',
  ready: 'blue',
  needs_answers: 'orange',
  approved: 'success',
  rejected: 'error',
};

export function PlanReviewCard({ jobId }: PlanReviewCardProps) {
  const queryClient = useQueryClient();
  const [form] = Form.useForm<Record<string, string>>();
  const [additionalFeedback, setAdditionalFeedback] = useState('');

  const planQuery = useQuery({
    queryKey: ['job', jobId, 'latestPlan'],
    queryFn: () => rpc.jobs.getLatestPlan({ jobId }),
    refetchInterval: (q) => {
      const status = q.state.data?.status;
      return status === 'approved' || status === 'rejected' ? false : 3000;
    },
  });

  const historyQuery = useQuery({
    queryKey: ['job', jobId, 'planHistory'],
    queryFn: () => rpc.jobs.listPlans({ jobId }),
  });

  const approve = useMutation({
    mutationFn: () => rpc.jobs.approvePlan({ jobId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['job', jobId] }),
  });

  const revise = useMutation({
    mutationFn: (vars: { answers: Record<string, string>; additionalFeedback?: string }) =>
      rpc.jobs.revisePlan({ jobId, ...vars }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['job', jobId] });
      form.resetFields();
      setAdditionalFeedback('');
    },
  });

  const reject = useMutation({
    mutationFn: (reason?: string) => rpc.jobs.rejectPlan({ jobId, reason }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['job', jobId] }),
  });

  if (planQuery.isLoading) return <Spin />;
  if (planQuery.error) return <Alert type="error" message={String(planQuery.error)} />;

  const plan = planQuery.data;
  if (!plan) {
    return (
      <Card>
        <Typography.Text type="secondary">Waiting for plan to be submitted…</Typography.Text>
      </Card>
    );
  }

  const openQuestions = plan.data.openQuestions ?? [];
  const hasUnanswered = openQuestions.some((q) => !form.getFieldValue(q.id));

  const history = (historyQuery.data ?? []).filter((p) => p.id !== plan.id);

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Card
        title={
          <Space>
            <span>Plan v{plan.version}</span>
            <Tag color={PLAN_STATUS_COLOR[plan.status] ?? 'default'}>{plan.status.toUpperCase()}</Tag>
          </Space>
        }
      >
        <Descriptions size="small" column={1} style={{ marginBottom: 16 }}>
          <Descriptions.Item label="Summary">{plan.data.summary}</Descriptions.Item>
          {plan.data.affectedPaths.length > 0 && (
            <Descriptions.Item label="Affected files">
              {plan.data.affectedPaths.map((p) => (
                <Tag key={p} style={{ marginBottom: 2 }}>
                  {p}
                </Tag>
              ))}
            </Descriptions.Item>
          )}
          {(plan.data.risks ?? []).length > 0 && (
            <Descriptions.Item label="Risks">
              {(plan.data.risks ?? []).map((r, i) => (
                <Tag color="orange" key={i} style={{ marginBottom: 2 }}>
                  {r}
                </Tag>
              ))}
            </Descriptions.Item>
          )}
        </Descriptions>

        <Collapse ghost items={[{
          key: 'body',
          label: 'Full plan details',
          children: (
            <div style={{ maxHeight: 480, overflow: 'auto' }}>
              <Markdown>{plan.data.bodyMarkdown}</Markdown>
            </div>
          ),
        }]} />

        {openQuestions.length > 0 && (
          <>
            <Typography.Title level={5} style={{ marginTop: 16 }}>
              Open questions — answer before approving
            </Typography.Title>
            <Form form={form} layout="vertical">
              {openQuestions.map((q) => (
                <Form.Item
                  key={q.id}
                  name={q.id}
                  label={
                    <Space direction="vertical" size={0}>
                      <span>{q.question}</span>
                      {q.context && (
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          {q.context}
                        </Typography.Text>
                      )}
                    </Space>
                  }
                  rules={[{ required: true, message: 'Please answer this question' }]}
                >
                  {q.options ? (
                    <Radio.Group>
                      {q.options.map((opt) => (
                        <Radio key={opt} value={opt}>
                          {opt}
                        </Radio>
                      ))}
                    </Radio.Group>
                  ) : (
                    <Input.TextArea rows={2} />
                  )}
                </Form.Item>
              ))}
              <Form.Item label="Additional feedback (optional)">
                <Input.TextArea
                  rows={2}
                  value={additionalFeedback}
                  onChange={(e) => setAdditionalFeedback(e.target.value)}
                  placeholder="Any other changes you'd like…"
                />
              </Form.Item>
            </Form>
          </>
        )}

        {openQuestions.length === 0 && (
          <div style={{ marginTop: 16 }}>
            <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
              Request revision (optional)
            </Typography.Text>
            <Input.TextArea
              rows={3}
              value={additionalFeedback}
              onChange={(e) => setAdditionalFeedback(e.target.value)}
              placeholder="Describe what you'd like changed before execution…"
            />
          </div>
        )}

        {approve.error && <Alert type="error" message={String(approve.error)} style={{ marginBottom: 8 }} />}
        {revise.error && <Alert type="error" message={String(revise.error)} style={{ marginBottom: 8 }} />}
        {reject.error && <Alert type="error" message={String(reject.error)} style={{ marginBottom: 8 }} />}

        <Space style={{ marginTop: 8 }}>
          <Button
            type="primary"
            onClick={() => approve.mutate()}
            loading={approve.isPending}
            disabled={openQuestions.length > 0 && hasUnanswered}
          >
            Approve &amp; Execute
          </Button>

          {openQuestions.length > 0 && (
            <Button
              onClick={async () => {
                const values = await form.validateFields();
                revise.mutate({ answers: values, additionalFeedback: additionalFeedback || undefined });
              }}
              loading={revise.isPending}
            >
              Submit answers
            </Button>
          )}

          {openQuestions.length === 0 && (
            <Button
              onClick={() => {
                const feedback = additionalFeedback.trim();
                if (feedback) revise.mutate({ answers: {}, additionalFeedback: feedback });
              }}
              loading={revise.isPending}
              disabled={!additionalFeedback.trim()}
            >
              Request revision
            </Button>
          )}

          <Button
            danger
            onClick={() => reject.mutate(undefined)}
            loading={reject.isPending}
          >
            Reject
          </Button>
        </Space>
      </Card>

      {history.length > 0 && (
        <Collapse
          ghost
          items={[{
            key: 'history',
            label: `Previous versions (${history.length})`,
            children: (
              <Space direction="vertical" style={{ width: '100%' }}>
                {history.map((p) => (
                  <Card key={p.id} size="small" title={`v${p.version} — ${p.status}`}>
                    {p.feedbackFromUser && (
                      <Typography.Text type="secondary">
                        Feedback: {p.feedbackFromUser}
                      </Typography.Text>
                    )}
                    <Collapse ghost items={[{
                      key: 'body',
                      label: 'View plan',
                      children: <Markdown>{p.data.bodyMarkdown}</Markdown>,
                    }]} />
                  </Card>
                ))}
              </Space>
            ),
          }]}
        />
      )}
    </Space>
  );
}
