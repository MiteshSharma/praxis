import type { FleetDto, FleetGraphDto, FleetJobDto } from '@shared/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Background,
  Controls,
  type Edge,
  Handle,
  type Node,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
} from '@xyflow/react';
import { Badge, Button, Card, Descriptions, Popconfirm, Space, Tag, Typography } from 'antd';
import dagre from 'dagre';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
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

const FLEET_STATUS_COLOR: Record<string, string> = {
  running: '#1677ff',
  scouting: '#722ed1',
  planning: '#fa8c16',
  implementing: '#1677ff',
  completed: '#52c41a',
  failed: '#ff4d4f',
  cancelled: '#8c8c8c',
  draft: '#8c8c8c',
  paused: '#fa8c16',
};

const NODE_WIDTH = 220;
const NODE_HEIGHT = 80;
const FLEET_NODE_WIDTH = 260;
const FLEET_NODE_HEIGHT = 72;
const FLEET_ROOT_ID = '__fleet__';

function layoutGraph(graphData: FleetGraphDto, fleetId: string): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'TB', nodesep: 50, ranksep: 70 });
  g.setDefaultEdgeLabel(() => ({}));

  // Fleet root node
  g.setNode(FLEET_ROOT_ID, { width: FLEET_NODE_WIDTH, height: FLEET_NODE_HEIGHT });

  for (const node of graphData.nodes) {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }

  // Fleet → every job node
  for (const node of graphData.nodes) {
    g.setEdge(FLEET_ROOT_ID, node.id);
  }
  // Existing dep edges between jobs
  for (const edge of graphData.edges) {
    g.setEdge(edge.from, edge.to);
  }

  dagre.layout(g);

  const fleetPos = g.node(FLEET_ROOT_ID);
  const fleetRootNode: Node = {
    id: FLEET_ROOT_ID,
    type: 'fleetRoot',
    position: { x: fleetPos.x - FLEET_NODE_WIDTH / 2, y: fleetPos.y - FLEET_NODE_HEIGHT / 2 },
    data: { fleetId },
  };

  const jobNodes: Node[] = graphData.nodes.map((n) => {
    const pos = g.node(n.id);
    return {
      id: n.id,
      position: { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 },
      data: n,
      style: {
        background: STATUS_COLOR[n.status] ?? '#d9d9d9',
        border: n.noChanges ? '2px dashed #8c8c8c' : '1px solid rgba(0,0,0,0.12)',
        borderRadius: 8,
        padding: '8px 12px',
        width: NODE_WIDTH,
        minHeight: NODE_HEIGHT,
        opacity: n.status === 'cancelled' ? 0.5 : 1,
        cursor: 'pointer',
      },
      type: 'jobNode',
    };
  });

  // Fleet → job edges (structural)
  const fleetEdges: Edge[] = graphData.nodes.map((n) => ({
    id: `${FLEET_ROOT_ID}-${n.id}`,
    source: FLEET_ROOT_ID,
    target: n.id,
    style: { stroke: '#d9d9d9', strokeWidth: 1.5 },
  }));

  // Job → job dep edges
  const depEdges: Edge[] = graphData.edges.map((e) => ({
    id: e.id,
    source: e.from,
    target: e.to,
    animated: !e.satisfied,
    style: { stroke: e.satisfied ? '#52c41a' : '#8c8c8c', strokeWidth: 1.5 },
  }));

  return { nodes: [fleetRootNode, ...jobNodes], edges: [...fleetEdges, ...depEdges] };
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

// Custom fleet root node — shows fleet title + live progress bar
function FleetRootNode({ data }: { data: { fleetId: string } }) {
  const fleetQuery = useQuery({
    queryKey: ['fleet', data.fleetId],
    queryFn: () => rpc.fleets.get({ fleetId: data.fleetId }),
    enabled: !!data.fleetId,
  });

  const fleet = fleetQuery.data;
  const color = fleet ? (FLEET_STATUS_COLOR[fleet.status] ?? '#1677ff') : '#1677ff';
  const done = fleet ? fleet.completedJobs + fleet.noopJobs : 0;
  const total = fleet?.totalJobs ?? 0;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const isActive =
    fleet && ['running', 'scouting', 'implementing', 'planning'].includes(fleet.status);

  return (
    <div
      style={{
        width: FLEET_NODE_WIDTH,
        minHeight: FLEET_NODE_HEIGHT,
        background: color,
        borderRadius: 10,
        padding: '10px 14px',
        color: '#fff',
        boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
        position: 'relative',
      }}
    >
      <Handle
        type="source"
        position={Position.Bottom}
        style={{ background: color, border: 'none' }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        {isActive && <span className="fleet-node-pulse" style={{ color: '#fff' }} />}
        <span
          style={{
            fontWeight: 700,
            fontSize: 13,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
          }}
        >
          {fleet?.title ?? '…'}
        </span>
        <span style={{ fontSize: 10, opacity: 0.85, whiteSpace: 'nowrap' }}>
          {fleet?.status ?? ''}
        </span>
      </div>
      {total > 0 && (
        <div>
          <div
            style={{
              background: 'rgba(255,255,255,0.25)',
              borderRadius: 4,
              height: 4,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                background: '#fff',
                width: `${pct}%`,
                height: '100%',
                borderRadius: 4,
                transition: 'width 0.4s',
              }}
            />
          </div>
          <div style={{ fontSize: 10, opacity: 0.85, marginTop: 3 }}>
            {done}/{total} done
          </div>
        </div>
      )}
    </div>
  );
}

function JobNode({ data }: { data: FleetGraphDto['nodes'][0] }) {
  const isLight = data.status === 'running' || data.status === 'queued';
  const textColor = isLight ? '#fff' : '#000';
  const isActive = data.status === 'running' || data.status === 'queued';

  const liveLabel = data.jobStatus ? (JOB_STATUS_LABEL[data.jobStatus] ?? data.jobStatus) : null;
  const statusLabel = data.status === 'running' && liveLabel ? liveLabel : data.status;

  return (
    <div style={{ fontSize: 12, color: textColor }}>
      <Handle
        type="target"
        position={Position.Top}
        style={{ background: 'transparent', border: 'none' }}
      />
      <div
        style={{
          fontWeight: 600,
          marginBottom: 2,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {data.sessionTitle ?? data.sessionId.slice(0, 8)}
      </div>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
        <Tag style={{ margin: 0, fontSize: 10, padding: '0 4px' }}>{data.jobType}</Tag>
        {isActive && <span className="fleet-node-pulse" style={{ color: textColor }} />}
        <span style={{ fontSize: 10, opacity: 0.9 }}>{statusLabel}</span>
        {data.noChanges && (
          <Tag color="default" style={{ margin: 0, fontSize: 10, padding: '0 4px' }}>
            no-op
          </Tag>
        )}
      </div>
      {data.currentStep && data.status === 'running' && (
        <div
          style={{
            fontSize: 10,
            marginTop: 2,
            opacity: 0.8,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {data.currentStep}
        </div>
      )}
      <Handle
        type="source"
        position={Position.Bottom}
        style={{ background: 'transparent', border: 'none' }}
      />
    </div>
  );
}

function JobDetailPanel({ job, onClose }: { job: FleetJobDto; onClose: () => void }) {
  const navigate = useNavigate();
  const liveLabel = job.jobStatus ? (JOB_STATUS_LABEL[job.jobStatus] ?? job.jobStatus) : null;

  return (
    <Card
      title={job.sessionTitle || 'Job Detail'}
      extra={
        <Button size="small" onClick={onClose}>
          ✕
        </Button>
      }
      style={{ height: '100%', overflow: 'auto' }}
    >
      {job.status === 'running' && liveLabel && (
        <div
          style={{
            background: '#e6f4ff',
            border: '1px solid #91caff',
            borderRadius: 6,
            padding: '8px 12px',
            marginBottom: 12,
            fontSize: 13,
          }}
        >
          <span style={{ fontWeight: 600 }}>⚡ {liveLabel}</span>
          {job.currentStep && (
            <div style={{ marginTop: 4, fontSize: 12, color: '#555' }}>Step: {job.currentStep}</div>
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
          <Descriptions.Item label="Job status">{liveLabel ?? job.jobStatus}</Descriptions.Item>
        )}
        <Descriptions.Item label="Type">
          <Tag>{job.jobType}</Tag>
        </Descriptions.Item>
        <Descriptions.Item label="Wave">{job.wave}</Descriptions.Item>
        <Descriptions.Item label="Task" style={{ whiteSpace: 'pre-wrap' }}>
          {job.task}
        </Descriptions.Item>
        {job.jobId && job.status !== 'running' && (
          <Descriptions.Item label="Job">
            <button
              type="button"
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                color: 'var(--ant-color-primary)',
              }}
              onClick={() => navigate(`/jobs/${job.jobId}`)}
            >
              View job →
            </button>
          </Descriptions.Item>
        )}
        {job.prUrl && (
          <Descriptions.Item label="PR">
            <a href={job.prUrl} target="_blank" rel="noopener noreferrer">
              {job.prUrl}
            </a>
          </Descriptions.Item>
        )}
        {job.noChanges && <Descriptions.Item label="No changes">Yes (no-op)</Descriptions.Item>}
        {job.retryCount > 0 && (
          <Descriptions.Item label="Retries">{job.retryCount}</Descriptions.Item>
        )}
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

function FleetSummary({ fleet }: { fleet: FleetDto }) {
  return (
    <div style={{ padding: 16 }}>
      <Typography.Title level={5} style={{ margin: '0 0 12px' }}>
        Fleet Summary
      </Typography.Title>
      <Space direction="vertical" style={{ width: '100%' }}>
        <div>
          Total jobs: <strong>{fleet.totalJobs}</strong>
        </div>
        <div>
          Completed: <strong style={{ color: '#52c41a' }}>{fleet.completedJobs}</strong>
        </div>
        <div>
          No-op: <strong style={{ color: '#8c8c8c' }}>{fleet.noopJobs}</strong>
        </div>
        <div>
          Running: <strong style={{ color: '#1677ff' }}>{fleet.runningJobs}</strong>
        </div>
        <div>
          Failed: <strong style={{ color: '#ff4d4f' }}>{fleet.failedJobs}</strong>
        </div>
        <div>
          Pending:{' '}
          <strong>
            {fleet.totalJobs -
              fleet.completedJobs -
              fleet.noopJobs -
              fleet.failedJobs -
              fleet.runningJobs}
          </strong>
        </div>
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
    queryFn: () => rpc.fleets.get({ fleetId: fleetId ?? '' }),
    enabled: !!fleetId,
    refetchInterval: (data) => {
      const status = data?.state?.data?.status;
      return status && ['running', 'scouting', 'implementing', 'planning'].includes(status)
        ? 5000
        : false;
    },
  });

  const graphQuery = useQuery({
    queryKey: ['fleet-graph', fleetId],
    queryFn: () => rpc.fleets.getGraph({ fleetId: fleetId ?? '' }),
    enabled: !!fleetId,
    refetchInterval: () => {
      const fleetStatus = fleetQuery.data?.status;
      return fleetStatus &&
        ['running', 'scouting', 'implementing', 'planning'].includes(fleetStatus)
        ? 5000
        : false;
    },
  });

  const cancelMutation = useMutation({
    mutationFn: () => rpc.fleets.cancel({ fleetId: fleetId ?? '' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['fleet', fleetId] }),
  });

  const { nodes: layoutNodes, edges: layoutEdges } = useMemo(() => {
    if (!graphQuery.data || !fleetId) return { nodes: [], edges: [] };
    return layoutGraph(graphQuery.data, fleetId);
  }, [graphQuery.data, fleetId]);

  const nodeTypes = useMemo(
    () => ({
      fleetRoot: FleetRootNode,
      jobNode: ({ data }: { data: FleetGraphDto['nodes'][0] }) => <JobNode data={data} />,
    }),
    [],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(layoutNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layoutEdges);

  useEffect(() => {
    setNodes(layoutNodes);
    setEdges(layoutEdges);
  }, [layoutNodes, layoutEdges, setNodes, setEdges]);

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      if (node.id === FLEET_ROOT_ID) return;
      setSelectedJobId(node.id === selectedJobId ? null : node.id);
    },
    [selectedJobId],
  );

  const fleet = fleetQuery.data;
  const selectedJob = fleet?.jobs.find((j) => j.id === selectedJobId) ?? null;

  const isRunning =
    fleet && ['running', 'scouting', 'implementing', 'planning'].includes(fleet.status);

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div
        style={{
          padding: '12px 24px',
          borderBottom: '1px solid #f0f0f0',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <Button type="text" onClick={() => navigate('/fleets')} style={{ padding: '0 4px' }}>
          ← Fleets
        </Button>
        <div style={{ flex: 1 }}>
          <Typography.Title level={4} style={{ margin: 0 }}>
            {fleet?.title ?? '…'}
          </Typography.Title>
          {fleet?.goal && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {fleet.goal}
            </Typography.Text>
          )}
        </div>
        {fleet && (
          <Space>
            <Badge
              status={
                fleet.status === 'completed'
                  ? 'success'
                  : fleet.status === 'failed'
                    ? 'error'
                    : ['running', 'scouting', 'implementing'].includes(fleet.status)
                      ? 'processing'
                      : 'default'
              }
              text={fleet.status}
            />
            {isRunning && (
              <Popconfirm title="Cancel this fleet?" onConfirm={() => cancelMutation.mutate()}>
                <Button danger size="small" loading={cancelMutation.isPending}>
                  Cancel
                </Button>
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
            fitViewOptions={{ padding: 0.15 }}
          >
            <Background />
            <Controls />
          </ReactFlow>
        </div>

        {/* Right panel */}
        <div
          style={{
            width: selectedJob ? '40%' : 240,
            borderLeft: '1px solid #f0f0f0',
            overflow: 'auto',
          }}
        >
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
