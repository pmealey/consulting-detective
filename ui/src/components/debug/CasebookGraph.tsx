import { useMemo } from 'react';
import type { Node, Edge } from 'reactflow';
import type { Case } from '@shared/index';
import { getLayoutedElements } from './layout.ts';
import { GraphContainer } from './GraphContainer.tsx';

function truncate(s: string, max: number) {
  if (s.length <= max) return s;
  return s.slice(0, max) + '…';
}

export function CasebookGraph({ gameCase }: { gameCase: Case }) {
  const { nodes, edges } = useMemo(() => {
    const entries = Object.values(gameCase.casebook);
    const facts = Object.values(gameCase.facts);
    const locations = gameCase.locations;
    const optimalPath = gameCase.optimalPath ?? [];
    const optimalSet = new Set(optimalPath);
    const optimalIndex = new Map(optimalPath.map((id, i) => [id, i]));

    const nodeList: Node[] = [];
    const edgeList: Edge[] = [];

    entries.forEach((entry) => {
      const loc = locations[entry.locationId];
      const locLabel = loc ? loc.name : entry.locationId;
      const inPath = optimalSet.has(entry.entryId);
      const pathStep = optimalIndex.get(entry.entryId);

      nodeList.push({
        id: `entry:${entry.entryId}`,
        type: 'default',
        position: { x: 0, y: 0 },
        data: {
          label: (
            <span className="font-mono text-xs block">
              <span className="font-medium text-stone-800">
                {truncate(entry.label, 28)}
              </span>
              <span className="text-stone-500 block mt-0.5">{locLabel}</span>
              {inPath && (
                <span className="text-emerald-600 text-[10px]">
                  path step {pathStep! + 1}
                </span>
              )}
            </span>
          ),
        },
        style: {
          backgroundColor: inPath ? '#d1fae5' : '#f5f5f4',
          border: `2px solid ${inPath ? '#059669' : '#e7e5e4'}`,
          borderRadius: 6,
          minWidth: 160,
          fontSize: 11,
        },
      });
    });

    facts.forEach((f) => {
      nodeList.push({
        id: `fact:${f.factId}`,
        type: 'default',
        position: { x: 0, y: 0 },
        data: {
          label: (
            <span className="font-mono text-xs">
              {truncate(f.description, 24)}
            </span>
          ),
        },
        style: {
          backgroundColor: '#e7e5e4',
          border: '1px solid #d6d3d1',
          borderRadius: 6,
          fontSize: 10,
        },
      });
    });

    entries.forEach((entry) => {
      for (const fid of entry.revealsFactIds) {
        edgeList.push({
          id: `rev:${entry.entryId}-${fid}`,
          source: `entry:${entry.entryId}`,
          target: `fact:${fid}`,
          label: 'reveals',
          labelStyle: { fontSize: 9 },
          labelBgStyle: { fill: '#fafaf9' },
          labelBgBorderRadius: 4,
        });
      }
      for (const fid of entry.requiresAnyFact ?? []) {
        edgeList.push({
          id: `req:${fid}-${entry.entryId}`,
          source: `fact:${fid}`,
          target: `entry:${entry.entryId}`,
          label: 'unlocks',
          labelStyle: { fontSize: 9 },
          labelBgStyle: { fill: '#fafaf9' },
          labelBgBorderRadius: 4,
        });
      }
    });

    for (let i = 0; i < optimalPath.length - 1; i++) {
      const a = `entry:${optimalPath[i]}`;
      const b = `entry:${optimalPath[i + 1]}`;
      edgeList.push({
        id: `path:${optimalPath[i]}-${optimalPath[i + 1]}`,
        source: a,
        target: b,
        label: 'optimal',
        type: 'smoothstep',
        animated: true,
        style: { stroke: '#059669', strokeWidth: 2 },
        labelStyle: { fontSize: 9, fill: '#059669' },
        labelBgStyle: { fill: '#d1fae5' },
        labelBgBorderRadius: 4,
      });
    }

    return getLayoutedElements(nodeList, edgeList, 'LR');
  }, [gameCase]);

  if (nodes.length === 0) {
    return (
      <p className="text-stone-500 text-sm py-4">No casebook entries or facts to visualize.</p>
    );
  }

  return <GraphContainer nodes={nodes} edges={edges} />;
}
