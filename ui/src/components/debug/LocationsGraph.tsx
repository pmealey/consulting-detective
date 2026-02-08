import { useMemo } from 'react';
import type { Node, Edge } from 'reactflow';
import type { Case } from '@shared/index';
import { getLayoutedElements } from './layout.ts';
import { GraphContainer } from './GraphContainer.tsx';

export function LocationsGraph({ gameCase }: { gameCase: Case }) {
  const { nodes, edges } = useMemo(() => {
    const locs = Object.values(gameCase.locations);
    const nodeList: Node[] = locs.map((loc) => ({
      id: loc.locationId,
      type: 'default',
      position: { x: 0, y: 0 },
      data: {
        label: (
          <span className="font-mono text-xs">
            {loc.name}
          </span>
        ),
      },
      style: {
        backgroundColor: '#f5f5f4',
        border: '1px solid #e7e5e4',
        borderRadius: 6,
        fontSize: 11,
      },
    }));

    const edgeIds = new Set<string>();
    const edgeList: Edge[] = [];

    for (const loc of locs) {
      for (const targetId of loc.accessibleFrom) {
        const eid = `acc:${loc.locationId}-${targetId}`;
        if (!edgeIds.has(eid)) {
          edgeIds.add(eid);
          edgeList.push({
            id: eid,
            source: loc.locationId,
            target: targetId,
            label: 'access',
            labelStyle: { fontSize: 9 },
            labelBgStyle: { fill: '#fafaf9' },
            labelBgBorderRadius: 4,
          });
        }
      }
      for (const targetId of loc.visibleFrom) {
        const eid = `vis:${loc.locationId}-${targetId}`;
        if (!edgeIds.has(eid)) {
          edgeIds.add(eid);
          edgeList.push({
            id: eid,
            source: loc.locationId,
            target: targetId,
            label: 'visible',
            labelStyle: { fontSize: 9 },
            labelBgStyle: { fill: '#fafaf9' },
            labelBgBorderRadius: 4,
          });
        }
      }
      for (const targetId of loc.audibleFrom) {
        const eid = `aud:${loc.locationId}-${targetId}`;
        if (!edgeIds.has(eid)) {
          edgeIds.add(eid);
          edgeList.push({
            id: eid,
            source: loc.locationId,
            target: targetId,
            label: 'audible',
            labelStyle: { fontSize: 9 },
            labelBgStyle: { fill: '#fafaf9' },
            labelBgBorderRadius: 4,
          });
        }
      }
    }

    return getLayoutedElements(nodeList, edgeList, 'TB');
  }, [gameCase]);

  if (nodes.length === 0) {
    return (
      <p className="text-stone-500 text-sm py-4">No locations to visualize.</p>
    );
  }

  return <GraphContainer nodes={nodes} edges={edges} />;
}
