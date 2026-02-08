import dagre from 'dagre';
import type { Node, Edge } from 'reactflow';

const NODE_WIDTH = 180;
const NODE_HEIGHT = 40;

type Direction = 'TB' | 'BT' | 'LR' | 'RL';

export function getLayoutedElements(
  nodes: Node[],
  edges: Edge[],
  direction: Direction = 'TB',
): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: direction, nodesep: 40, ranksep: 60 });

  nodes.forEach((node) => {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  });

  edges.forEach((edge) => {
    g.setEdge(edge.source, edge.target);
  });

  dagre.layout(g);

  const isHorizontal = direction === 'LR' || direction === 'RL';
  const sourcePos = (isHorizontal ? 'right' : 'bottom') as Node['sourcePosition'];
  const targetPos = (isHorizontal ? 'left' : 'top') as Node['targetPosition'];
  const layoutedNodes = nodes.map((node) => {
    const n = g.node(node.id);
    if (!n) return node;
    return {
      ...node,
      position: {
        x: n.x - NODE_WIDTH / 2,
        y: n.y - NODE_HEIGHT / 2,
      },
      sourcePosition: sourcePos,
      targetPosition: targetPos,
    };
  });

  return { nodes: layoutedNodes, edges };
}
