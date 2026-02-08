import { useMemo } from 'react';
import type { Node, Edge } from 'reactflow';
import type { Case } from '@shared/index';
import { getLayoutedElements } from './layout.ts';
import { GraphContainer } from './GraphContainer.tsx';

function truncate(s: string, max: number) {
  if (s.length <= max) return s;
  return s.slice(0, max).trim() + '…';
}

export function DiscoveryGraph({ gameCase }: { gameCase: Case }) {
  const { nodes, edges } = useMemo(() => {
    const facts = Object.values(gameCase.facts);
    const entries = Object.values(gameCase.casebook);
    const introIds = new Set(gameCase.introductionFactIds ?? []);
    const optimalSet = new Set(gameCase.optimalPath ?? []);

    const nodeList: Node[] = [];
    const edgeList: Edge[] = [];

    facts.forEach((f) => {
      nodeList.push({
        id: `fact:${f.factId}`,
        type: 'default',
        position: { x: 0, y: 0 },
        data: {
          label: (
            <span className="text-xs block">
              <span className="text-stone-700">{truncate(f.description, 40)}</span>
              {introIds.has(f.factId) && (
                <span className="block mt-0.5 text-amber-700 font-medium text-[10px]">intro (seed)</span>
              )}
            </span>
          ),
        },
        style: {
          backgroundColor: introIds.has(f.factId) ? '#fef3c7' : '#f5f5f4',
          border: `1px solid ${introIds.has(f.factId) ? '#f59e0b' : '#e7e5e4'}`,
          borderRadius: 6,
          fontSize: 11,
          minWidth: 140,
          maxWidth: 200,
        },
      });
    });

    entries.forEach((e) => {
      nodeList.push({
        id: `entry:${e.entryId}`,
        type: 'default',
        position: { x: 0, y: 0 },
        data: {
          label: (
            <span className="text-xs block">
              <span className="text-stone-800 font-medium">{truncate(e.label, 28)}</span>
              {optimalSet.has(e.entryId) && (
                <span className="block mt-0.5 text-emerald-700 font-medium text-[10px]">optimal path</span>
              )}
            </span>
          ),
        },
        style: {
          backgroundColor: optimalSet.has(e.entryId) ? '#d1fae5' : '#e7e5e4',
          border: `1px solid ${optimalSet.has(e.entryId) ? '#059669' : '#d6d3d1'}`,
          borderRadius: 6,
          fontSize: 11,
          minWidth: 140,
          maxWidth: 200,
        },
      });
    });

    entries.forEach((entry) => {
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
    });

    return getLayoutedElements(nodeList, edgeList, 'LR');
  }, [gameCase]);

  if (nodes.length === 0) {
    return (
      <p className="text-stone-500 text-sm py-4">No facts or entries to visualize.</p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="rounded bg-stone-100 border border-stone-200 px-3 py-2 text-sm text-stone-600">
        <p className="font-medium text-stone-700 mb-1">What this graph shows</p>
        <p className="mb-1">
          <strong>Ovals</strong>: facts (knowledge) and casebook entries (places to visit).{' '}
          <span className="text-amber-700">Yellow</span> = intro seeds (from the opening).{' '}
          <span className="text-emerald-700">Green</span> = on the optimal solution path.
        </p>
        <p>
          <strong>Edges</strong>: &quot;unlocks&quot; = having this fact lets you see this entry in the casebook. &quot;reveals&quot; = visiting this entry gives you these facts. Investigation flows: intro facts → unlock entries → visit → new facts → unlock more entries.
        </p>
      </div>
      <GraphContainer nodes={nodes} edges={edges} />
    </div>
  );
}
