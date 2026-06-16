import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Card, Drawer, Descriptions, Tag, List, Spin, message } from 'antd';
import api from '../api';

interface GraphNode {
  id: string;
  name: string;
  owner: string;
  latestVersion: number;
  health: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  fx?: number | null;
  fy?: number | null;
}

interface GraphEdge {
  source: string;
  target: string;
  entities: string[];
  fields: Record<string, string[]>;
}

interface DependencyGraph {
  nodes: Array<{
    id: string;
    name: string;
    owner: string;
    latestVersion: number;
    health: string;
  }>;
  edges: GraphEdge[];
}

function forceLayout(nodes: GraphNode[], edges: Array<{ source: string; target: string }>, width: number, height: number, iterations: number = 300) {
  const centerX = width / 2;
  const centerY = height / 2;
  const nodeRadius = 38;

  const nodeMap = new Map(nodes.map(n => [n.name, n]));

  for (const node of nodes) {
    node.x = centerX + (Math.random() - 0.5) * 300;
    node.y = centerY + (Math.random() - 0.5) * 300;
    node.vx = 0;
    node.vy = 0;
  }

  const k = Math.sqrt((width * height) / Math.max(nodes.length, 1)) * 0.5;

  for (let iter = 0; iter < iterations; iter++) {
    const alpha = 1 - iter / iterations;

    for (const node of nodes) {
      node.vx = 0;
      node.vy = 0;
    }

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[j].x - nodes[i].x;
        const dy = nodes[j].y - nodes[i].y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = (k * k) / dist;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        nodes[i].vx -= fx;
        nodes[i].vy -= fy;
        nodes[j].vx += fx;
        nodes[j].vy += fy;
      }
    }

    for (const edge of edges) {
      const source = nodeMap.get(edge.source);
      const target = nodeMap.get(edge.target);
      if (!source || !target) continue;

      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const force = (dist - k * 1.2) * 0.08;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;

      source.vx += fx;
      source.vy += fy;
      target.vx -= fx;
      target.vy -= fy;
    }

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[j].x - nodes[i].x;
        const dy = nodes[j].y - nodes[i].y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const minDist = nodeRadius * 2 + 10;

        if (dist < minDist) {
          const overlap = minDist - dist;
          const fx = (dx / dist) * overlap * 0.5;
          const fy = (dy / dist) * overlap * 0.5;
          nodes[i].x -= fx;
          nodes[i].y -= fy;
          nodes[j].x += fx;
          nodes[j].y += fy;
          nodes[i].vx *= 0.3;
          nodes[i].vy *= 0.3;
          nodes[j].vx *= 0.3;
          nodes[j].vy *= 0.3;
        }
      }
    }

    for (const node of nodes) {
      node.vx += (centerX - node.x) * 0.008 * alpha;
      node.vy += (centerY - node.y) * 0.008 * alpha;

      node.vx *= 0.55;
      node.vy *= 0.55;

      node.x += node.vx * alpha;
      node.y += node.vy * alpha;

      node.x = Math.max(nodeRadius + 20, Math.min(width - nodeRadius - 20, node.x));
      node.y = Math.max(nodeRadius + 10, Math.min(height - nodeRadius - 10, node.y));
    }
  }
}

function DependencyGraph() {
  const [graph, setGraph] = useState<DependencyGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<GraphEdge | null>(null);
  const [nodeDrawerVisible, setNodeDrawerVisible] = useState(false);
  const [edgeDrawerVisible, setEdgeDrawerVisible] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ nodeId: string; startX: number; startY: number; nodeStartX: number; nodeStartY: number } | null>(null);
  const [layoutNodes, setLayoutNodes] = useState<GraphNode[]>([]);
  const [containerSize, setContainerSize] = useState({ width: 900, height: 600 });

  useEffect(() => {
    loadGraph();
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    const updateSize = () => {
      if (containerRef.current) {
        setContainerSize({
          width: containerRef.current.clientWidth || 900,
          height: 600,
        });
      }
    };

    updateSize();

    const resizeObserver = new ResizeObserver(updateSize);
    resizeObserver.observe(containerRef.current);

    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
    if (graph && graph.nodes.length > 0 && containerSize.width > 0) {
      const nodes: GraphNode[] = graph.nodes.map(n => ({
        ...n,
        x: containerSize.width / 2,
        y: containerSize.height / 2,
        vx: 0,
        vy: 0,
      }));

      if (nodes.length === 1) {
        nodes[0].x = containerSize.width / 2;
        nodes[0].y = containerSize.height / 2;
      } else {
        forceLayout(nodes, graph.edges, containerSize.width, containerSize.height, 300);
      }

      nodes.forEach(n => {
        n.vx = 0;
        n.vy = 0;
      });

      setLayoutNodes(nodes);
    }
  }, [graph, containerSize]);

  const loadGraph = async () => {
    setLoading(true);
    try {
      const response = await api.get('/dependency-graph');
      setGraph(response.data.graph);
    } catch (err) {
      message.error('加载依赖关系图失败');
    } finally {
      setLoading(false);
    }
  };

  const nodeRadius = 38;
  const nodeMap = new Map(layoutNodes.map(n => [n.name, n]));

  const handleMouseDown = useCallback((e: React.MouseEvent, nodeName: string) => {
    e.preventDefault();
    e.stopPropagation();
    const node = layoutNodes.find(n => n.name === nodeName);
    if (!node) return;

    setLayoutNodes(prev =>
      prev.map(n =>
        n.name === nodeName
          ? { ...n, vx: 0, vy: 0 }
          : n
      )
    );

    dragRef.current = {
      nodeId: nodeName,
      startX: e.clientX,
      startY: e.clientY,
      nodeStartX: node.x,
      nodeStartY: node.y,
    };

    const handleMouseMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = ev.clientX - dragRef.current.startX;
      const dy = ev.clientY - dragRef.current.startY;
      setLayoutNodes(prev =>
        prev.map(n =>
          n.name === dragRef.current!.nodeId
            ? { ...n, x: dragRef.current!.nodeStartX + dx, y: dragRef.current!.nodeStartY + dy, vx: 0, vy: 0 }
            : n
        )
      );
    };

    const handleMouseUp = () => {
      dragRef.current = null;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [layoutNodes]);

  const isEdgeHighlighted = (edge: GraphEdge) => {
    if (!hoveredNode) return false;
    return edge.source === hoveredNode || edge.target === hoveredNode;
  };

  const isEdgeDimmed = (edge: GraphEdge) => {
    if (!hoveredNode) return false;
    return !isEdgeHighlighted(edge);
  };

  const getHealthColor = (health: string) => {
    switch (health) {
      case 'healthy': return '#52c41a';
      case 'degraded': return '#faad14';
      case 'unhealthy': return '#ff4d4f';
      default: return '#d9d9d9';
    }
  };

  if (loading) {
    return <div style={{ textAlign: 'center', padding: 100 }}><Spin size="large" /></div>;
  }

  if (!graph || graph.nodes.length === 0) {
    return <Card title="SubGraph 依赖关系"><div style={{ textAlign: 'center', padding: 40 }}>暂无依赖关系数据</div></Card>;
  }

  return (
    <div>
      <Card title="SubGraph 依赖关系图" extra={<span style={{ color: '#999', fontSize: 12 }}>拖拽节点可调整位置 | 悬停节点高亮关联边 | 点击查看详情</span>}>
        <div ref={containerRef} style={{ width: '100%' }}>
          <svg
            ref={svgRef}
            width="100%"
            height={600}
            style={{ border: '1px solid #f0f0f0', borderRadius: 8, background: '#fafafa' }}
          >
          <defs>
            <marker
              id="arrowhead"
              markerWidth="10"
              markerHeight="7"
              refX={nodeRadius}
              refY="3.5"
              orient="auto"
            >
              <polygon points="0 0, 10 3.5, 0 7" fill="#999" />
            </marker>
            <marker
              id="arrowhead-highlight"
              markerWidth="10"
              markerHeight="7"
              refX={nodeRadius}
              refY="3.5"
              orient="auto"
            >
              <polygon points="0 0, 10 3.5, 0 7" fill="#1890ff" />
            </marker>
          </defs>

          {graph.edges.map((edge, idx) => {
            const source = nodeMap.get(edge.source);
            const target = nodeMap.get(edge.target);
            if (!source || !target) return null;

            const highlighted = isEdgeHighlighted(edge);
            const dimmed = isEdgeDimmed(edge);

            const dx = target.x - source.x;
            const dy = target.y - source.y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;
            const unitX = dx / dist;
            const unitY = dy / dist;

            const startX = source.x + unitX * nodeRadius;
            const startY = source.y + unitY * nodeRadius;
            const endX = target.x - unitX * nodeRadius;
            const endY = target.y - unitY * nodeRadius;

            const midX = (startX + endX) / 2;
            const midY = (startY + endY) / 2;
            const offsetDist = 24;
            const curveX = midX + (-dy / dist) * offsetDist;
            const curveY = midY + (dx / dist) * offsetDist;

            return (
              <g key={`edge-${idx}`} onClick={() => { setSelectedEdge(edge); setEdgeDrawerVisible(true); }} style={{ cursor: 'pointer' }}>
                <path
                  d={`M ${startX} ${startY} Q ${curveX} ${curveY} ${endX} ${endY}`}
                  fill="none"
                  stroke={highlighted ? '#1890ff' : dimmed ? '#e8e8e8' : '#bbb'}
                  strokeWidth={highlighted ? 2.5 : 1.5}
                  markerEnd={highlighted ? 'url(#arrowhead-highlight)' : 'url(#arrowhead)'}
                  opacity={dimmed ? 0.3 : 1}
                />
                <text
                  x={curveX}
                  y={curveY - 8}
                  textAnchor="middle"
                  fontSize={10}
                  fill={highlighted ? '#1890ff' : '#999'}
                  opacity={dimmed ? 0.3 : 1}
                >
                  {edge.entities.join(', ')}
                </text>
              </g>
            );
          })}

          {layoutNodes.map(node => {
            const isHovered = hoveredNode === node.name;
            const relatedEdges = graph.edges.filter(e => e.source === node.name || e.target === node.name);
            const isDimmed = hoveredNode !== null && hoveredNode !== node.name && relatedEdges.length === 0;

            return (
              <g
                key={node.id}
                transform={`translate(${node.x}, ${node.y})`}
                onMouseEnter={() => setHoveredNode(node.name)}
                onMouseLeave={() => setHoveredNode(null)}
                onMouseDown={(e) => handleMouseDown(e, node.name)}
                onClick={() => { setSelectedNode(node); setNodeDrawerVisible(true); }}
                style={{ cursor: 'grab' }}
                opacity={isDimmed ? 0.3 : 1}
              >
                <circle
                  r={isHovered ? nodeRadius + 4 : nodeRadius}
                  fill="#fff"
                  stroke={getHealthColor(node.health)}
                  strokeWidth={isHovered ? 3 : 2}
                />
                <circle r={6} cx={nodeRadius - 10} cy={-nodeRadius + 10} fill={getHealthColor(node.health)} />
                <text
                  textAnchor="middle"
                  dy="-4"
                  fontSize={12}
                  fontWeight="bold"
                  fill="#333"
                >
                  {node.name.length > 12 ? node.name.substring(0, 12) + '...' : node.name}
                </text>
                <text
                  textAnchor="middle"
                  dy="12"
                  fontSize={9}
                  fill="#999"
                >
                  v{node.latestVersion}
                </text>
              </g>
            );
          })}
        </svg>
        </div>
      </Card>

      <Drawer
        title="SubGraph 信息"
        width={400}
        open={nodeDrawerVisible}
        onClose={() => setNodeDrawerVisible(false)}
      >
        {selectedNode && (
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="名称">{selectedNode.name}</Descriptions.Item>
            <Descriptions.Item label="Owner">{selectedNode.owner}</Descriptions.Item>
            <Descriptions.Item label="最新版本">v{selectedNode.latestVersion}</Descriptions.Item>
            <Descriptions.Item label="健康状态">
              <Tag color={getHealthColor(selectedNode.health) === '#52c41a' ? 'green' : getHealthColor(selectedNode.health) === '#faad14' ? 'orange' : getHealthColor(selectedNode.health) === '#ff4d4f' ? 'red' : 'default'}>
                {selectedNode.health === 'healthy' ? '健康' : selectedNode.health === 'degraded' ? '降级' : selectedNode.health === 'unhealthy' ? '异常' : '未知'}
              </Tag>
            </Descriptions.Item>
          </Descriptions>
        )}
      </Drawer>

      <Drawer
        title="引用详情"
        width={480}
        open={edgeDrawerVisible}
        onClose={() => setEdgeDrawerVisible(false)}
      >
        {selectedEdge && (
          <>
            <Descriptions column={1} bordered size="small" style={{ marginBottom: 16 }}>
              <Descriptions.Item label="来源 SubGraph">{selectedEdge.source}</Descriptions.Item>
              <Descriptions.Item label="目标 SubGraph">{selectedEdge.target}</Descriptions.Item>
            </Descriptions>

            <Card size="small" title="引用的 Entity" type="inner">
              <List
                size="small"
                dataSource={selectedEdge.entities}
                renderItem={(entityName) => (
                  <List.Item>
                    <div style={{ width: '100%' }}>
                      <strong>{entityName}</strong>
                      {selectedEdge.fields[entityName] && selectedEdge.fields[entityName].length > 0 && (
                        <div style={{ marginTop: 4 }}>
                          <span style={{ color: '#999', fontSize: 12 }}>引用字段: </span>
                          {selectedEdge.fields[entityName].map(f => (
                            <Tag key={f} style={{ marginBottom: 2 }}>{f}</Tag>
                          ))}
                        </div>
                      )}
                    </div>
                  </List.Item>
                )}
              />
            </Card>
          </>
        )}
      </Drawer>
    </div>
  );
}

export default DependencyGraph;
