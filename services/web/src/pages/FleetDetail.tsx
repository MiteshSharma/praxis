import type { FleetGraphDto, FleetJobDto } from '@shared/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, Descriptions, Popconfirm, Space, Tag, Typography } from 'antd';
import dagre from 'dagre';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Background,
  Controls,
  type Edge,
  type Node,
  ReactFlow,
  useEdgesState,
  useNodesState,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { rpc } from '../rpc';

const STATUS_COLOR: Record<string, string> = {
  pending: '#d9d9d9',
  queued: '#91caff',
  running: '#1677ff',
  completed: '#52c41a',
  noop: '#bfbfbf',
  failed: '#ff4d4f',
  cancelled: '#d9d9d9',
};

const NODE_WIDTH = 220;
const NODE_HEIGHT = 80;

function layoutGraph(graphData: FleetGraphDto): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 40, ranksep: 80 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const node of graphData.nodes) {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const edge of graphData.edges) {
    g.setEdge(edge.from, edge.to);
  }

  dagre.layout(g);

  const nodes: Node[] = graphData.nodes.map((n) => {
    const pos = g.node(n.id);
    return {
      id: n.id,
      position: { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 },
      data: n,
      style: {
        background: STATUS_COLOR[n.status] ?? '#d9d9d9',
        border: n.noChanges ? '2px dashed #8c8c8c' : '1px solid #d9d9d9',
        borderRadius: 8,
        padding: '8px 12px',
        width: NODE_WIDTH,
        minHeight: NODE_HEIGHT,
        opacity: n.status === 'cancelled' ? 0.5 : 1,
      },
      type: 'default',
    };
  });

  const edges: Edge[] = graphData.edges.map((e) => ({
    id: e.id,
    source: e.from,
    target: e.to,
    animated: !e.satisfied,
    style: { stroke: e.satisfied ? '#52c41a' : '#8c8c8c' },
  }));

  return { nodes, edges };
}

// Maps fine-grained Praxis job status to a short human label shown on the node
const JOB_STATUS_LABEL: Record<string, string> = {
  queued: 'queued',
  provisioning: 'provisioning…',
  preparing: 'preparing…',
  building: 'planning…',
  plan_ready: 'plan ready',
  plan_review: 'awaiting review',
  plan_revising: 'revising plan…',
  plan_rejected: 'plan rejected',
  executing: 'executing…',
  checking: 'checking…',
  learning: 'learning…',
  publishing: 'publishing…',
  completed: 'completed',
  failed: 'failed',
  cancelled: 'cancelled',
};

function NodeLabel({ data }: { data: FleetGraphDto['nodes'][0] }) {
  const isLight = data.status === 'running' || data.status === 'queued';
  const textColor = isLight ? '#fff' : '#000';
  const isActive = data.status === 'running' || data.status === 'queued';

  // Prefer fine-grained Praxis job status when available, else fall back to fleet job status
  const liveLabel = data.jobStatus ? (JOB_STATUS_LABEL[data.jobStatus] ?? data.jobStatus) : null;
  const statusLabel = (data.status === 'running' && liveLabel) ? liveLabel : data.status;

  return (
    <div style={{ fontSize: 12, color: textColor }}>
      <div style={{ fontWeight: 600, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {data.sessionTitle ?? data.sessionId.slice(0, 8)}
      </div>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
        <Tag style={{ margin: 0, fontSize: 10, padding: '0 4px' }}>{data.jobType}</Tag>
        {isActive && <span className="fleet-node-pulse" style={{ color: textColor }} />}
        <span style={{ fontSize: 10, opacity: 0.9 }}>{statusLabel}</span>
        {data.noChanges && <Tag color="default" style={{ margin: 0, fontSize: 10, padding: '0 4px' }}>no-op</Tag>}
      </div>
      {data.currentStep && data.status === 'running' && (
        <div style={{ fontSize: 10, marginTop: 2, opacity: 0.8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {data.currentStep}
        </div>
      )}
    </div>
  );
}

function JobDetailPanel({ job, onClose }: { job: FleetJobDto; onClose: () => void }) {
  const navigate = useNavigate();
  const liveLabel = job.jobStatus ? (JOB_STATUS_LABEL[job.jobStatus] ?? job.jobStatus) : null;

  return (
    <Card
      title={job.sessionTitle || 'Job Detail'}
      extra={<Button size="small" onClick={onClose}>✕</Button>}
      style={{ height: '100%', overflow: 'auto' }}
    >
      {/* Live activity banner when running */}
      {job.status === 'running' && liveLabel && (
        <div style={{
          background: '#e6f4ff',
          border: '1px solid #91caff',
          borderRadius: 6,
          padding: '8px 12px',
          marginBottom: 12,
          fontSize: 13,
        }}>
          <span style={{ fontWeight: 600 }}>⚡ {liveLabel}</span>
          {job.currentStep && (
            <div style={{ marginTop: 4, fontSize: 12, color: '#555' }}>
              Step: {job.currentStep}
            </div>
          )}
          {job.jobId && (
            <Button
              type="link"
              size="small"
              style={{ padding: 0, marginTop: 4, display: 'block' }}
              onClick={() => navigate(`/jobs/${job.jobId}`)}
            >
              View live job →
            </Button>
          )}
        </div>
      )}

      <Descriptions size="small" column={1} bordered>
        <Descriptions.Item label="Fleet status">
          <Badge color={STATUS_COLOR[job.status]} text={job.status} />
        </Descriptions.Item>
        {job.jobStatus && job.status !== 'running' && (
          <Descriptions.Item label="Job status">
            {liveLabel ?? job.jobStatus}
          </Descriptions.Item>
        )}
        <Descriptions.Item label="Type"><Tag>{job.jobType}</Tag></Descriptions.Item>
        <Descriptions.Item label="Wave">{job.wave}</Descriptions.Item>
        <Descriptions.Item label="Task" style={{ whiteSpace: 'pre-wrap' }}>{job.task}</Descriptions.Item>
        {job.jobId && job.status !== 'running' && (
          <Descriptions.Item label="Job">
            <a onClick={() => navigate(`/jobs/${job.jobId}`)}>View job →</a>
          </Descriptions.Item>
        )}
        {job.prUrl && (
          <Descriptions.Item label="PR">
            <a href={job.prUrl} target="_blank" rel="noopener noreferrer">{job.prUrl}</a>
          </Descriptions.Item>
        )}
        {job.noChanges && <Descriptions.Item label="No changes">Yes (no-op)</Descriptions.Item>}
        {job.retryCount > 0 && <Descriptions.Item label="Retries">{job.retryCount}</Descriptions.Item>}
        {job.report && (
          <Descriptions.Item label="Report">
            <pre style={{ fontSize: 11, maxHeight: 300, overflow: 'auto', margin: 0 }}>
              {JSON.stringify(job.report, null, 2)}
            </pre>
          </Descriptions.Item>
        )}
      </Descriptions>
    </Card>
  );
}

function FleetSummary({ fleet }: { fleet: { totalJobs: number; completedJobs: number; noopJobs: number; failedJobs: number; runningJobs: number } }) {
  return (
    <div style={{ padding: 16 }}>
      <Typography.Title level={5} style={{ margin: '0 0 12px' }}>Fleet Summary</Typography.Title>
      <Space direction="vertical" style={{ width: '100%' }}>
        <div>Total jobs: <strong>{fleet.totalJobs}</strong></div>
        <div>Completed: <strong style={{ color: '#52c41a' }}>{fleet.completedJobs}</strong></div>
        <div>No-op: <strong style={{ color: '#8c8c8c' }}>{fleet.noopJobs}</strong></div>
        <div>Running: <strong style={{ color: '#1677ff' }}>{fleet.runningJobs}</strong></div>
        <div>Failed: <strong style={{ color: '#ff4d4f' }}>{fleet.failedJobs}</strong></div>
        <div>Pending: <strong>{fleet.totalJobs - fleet.completedJobs - fleet.noopJobs - fleet.failedJobs - fleet.runningJobs}</strong></div>
      </Space>
    </div>
  );
}

export function FleetDetail() {
  const { fleetId } = useParams<{ fleetId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  const fleetQuery = useQuery({
    queryKey: ['fleet', fleetId],
    queryFn: () => rpc.fleets.get({ fleetId: fleetId! }),
    enabled: !!fleetId,
    refetchInterval: (data) => {
      const status = data?.state?.data?.status;
      return status && ['running', 'scouting', 'implementing', 'planning'].includes(status) ? 5000 : false;
    },
  });

  const graphQuery = useQuery({
    queryKey: ['fleet-graph', fleetId],
    queryFn: () => rpc.fleets.getGraph({ fleetId: fleetId! }),
    enabled: !!fleetId,
    refetchInterval: (data) => {
      const fleetStatus = fleetQuery.data?.status;
      return fleetStatus && ['running', 'scouting', 'implementing', 'planning'].includes(fleetStatus) ? 5000 : false;
    },
  });

  const cancelMutation = useMutation({
    mutationFn: () => rpc.fleets.cancel({ fleetId: fleetId! }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['fleet', fleetId] }),
  });

  const { nodes: layoutNodes, edges: layoutEdges } = useMemo(() => {
    if (!graphQuery.data) return { nodes: [], edges: [] };
    return layoutGraph(graphQuery.data);
  }, [graphQuery.data]);

  const nodeTypes = useMemo(
    () => ({ default: ({ data }: { data: FleetGraphDto['nodes'][0] }) => <NodeLabel data={data} /> }),
    [],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(layoutNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layoutEdges);

  // Sync React Flow state whenever graph data reloads (polling or initial fetch)
  useEffect(() => {
    setNodes(layoutNodes);
    setEdges(layoutEdges);
  }, [layoutNodes, layoutEdges, setNodes, setEdges]);

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      setSelectedJobId(node.id === selectedJobId ? null : node.id);
    },
    [selectedJobId],
  );

  const fleet = fleetQuery.data;
  const selectedJob = fleet?.jobs.find((j) => j.id === selectedJobId) ?? null;

  const isRunning = fleet && ['running', 'scouting', 'implementing', 'planning'].includes(fleet.status);

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ padding: '12px 24px', borderBottom: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', gap: 12 }}>
        <Button type="text" onClick={() => navigate('/fleets')} style={{ padding: '0 4px' }}>← Fleets</Button>
        <div style={{ flex: 1 }}>
          <Typography.Title level={4} style={{ margin: 0 }}>{fleet?.title ?? '…'}</Typography.Title>
          {fleet?.goal && <Typography.Text type="secondary" style={{ fontSize: 12 }}>{fleet.goal}</Typography.Text>}
        </div>
        {fleet && (
          <Space>
            <Badge
              status={
                fleet.status === 'completed' ? 'success' :
                fleet.status === 'failed' ? 'error' :
                ['running', 'scouting', 'implementing'].includes(fleet.status) ? 'processing' :
                'default'
              }
              text={fleet.status}
            />
            {isRunning && (
              <Popconfirm title="Cancel this fleet?" onConfirm={() => cancelMutation.mutate()}>
                <Button danger size="small" loading={cancelMutation.isPending}>Cancel</Button>
              </Popconfirm>
            )}
          </Space>
        )}
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* DAG */}
        <div style={{ flex: selectedJob ? '0 0 60%' : '1 1 auto' }}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={onNodeClick}
            nodeTypes={nodeTypes}
            fitView
          >
            <Background />
            <Controls />
          </ReactFlow>
        </div>

        {/* Right panel */}
        <div style={{ width: selectedJob ? '40%' : 240, borderLeft: '1px solid #f0f0f0', overflow: 'auto' }}>
          {selectedJob ? (
            <JobDetailPanel job={selectedJob} onClose={() => setSelectedJobId(null)} />
          ) : (
            fleet && <FleetSummary fleet={fleet} />
          )}
        </div>
      </div>
    </div>
  );
}
