import { useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
} from 'reactflow';
import 'reactflow/dist/style.css';

/** Stable references so React Flow does not warn about new nodeTypes/edgeTypes each render */
const NODE_TYPES = {};
const EDGE_TYPES = {};

const defaultOptions = {
  nodesDraggable: false,
  nodesConnectable: false,
  elementsSelectable: true,
  panOnDrag: true,
  zoomOnScroll: true,
  fitView: true,
  fitViewOptions: { padding: 0.2 },
};

interface GraphContainerProps {
  nodes: Node[];
  edges: Edge[];
  /** Min height for the graph canvas (React Flow requires explicit width and height) */
  className?: string;
}

export function GraphContainer({
  nodes,
  edges,
  className = 'w-full h-[420px]',
}: GraphContainerProps) {
  const nodeIds = useMemo(() => new Set(nodes.map((n) => n.id)), [nodes]);
  const validEdges = useMemo(
    () =>
      edges.filter(
        (e) => nodeIds.has(e.source) && nodeIds.has(e.target),
      ),
    [edges, nodeIds],
  );

  return (
    <div
      className={className}
      style={{ width: '100%', height: 420 }}
    >
      <ReactFlow
        nodes={nodes}
        edges={validEdges}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        {...defaultOptions}
      >
        <Background gap={12} size={1} color="#e7e5e4" />
        <Controls showInteractive={false} />
        <MiniMap
          nodeColor="#d6d3d1"
          maskColor="rgb(255 255 255 / 0.8)"
          className="!bg-stone-100"
        />
      </ReactFlow>
    </div>
  );
}
