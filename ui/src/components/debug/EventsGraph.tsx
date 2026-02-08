import { useMemo } from 'react';
import type { Node, Edge } from 'reactflow';
import type { Case } from '@shared/index';
import { getLayoutedElements } from './layout.ts';
import { GraphContainer } from './GraphContainer.tsx';

function truncate(s: string, max: number) {
  if (s.length <= max) return s;
  return s.slice(0, max) + '…';
}

export function EventsGraph({ gameCase }: { gameCase: Case }) {
  const { nodes, edges } = useMemo(() => {
    const events = Object.values(gameCase.events).sort(
      (a, b) => a.timestamp - b.timestamp,
    );
    const nodeList: Node[] = events.map((ev, i) => ({
      id: ev.eventId,
      type: 'default',
      position: { x: 0, y: i * 60 },
      data: {
        label: (
          <span className="font-mono text-xs block">
            <span className="text-stone-500">t{ev.timestamp}</span>{' '}
            {truncate(ev.description, 36)}
            {ev.necessity === 'required' && (
              <span className="ml-1 text-amber-600">(required)</span>
            )}
          </span>
        ),
      },
      style: {
        backgroundColor: ev.necessity === 'required' ? '#fef3c7' : '#f5f5f4',
        border: `1px solid ${ev.necessity === 'required' ? '#f59e0b' : '#e7e5e4'}`,
        borderRadius: 6,
        minWidth: 180,
        fontSize: 11,
      },
    }));

    const edgeList: Edge[] = [];
    for (const ev of events) {
      for (const causeId of ev.causes) {
        if (gameCase.events[causeId]) {
          edgeList.push({
            id: `cause:${causeId}-${ev.eventId}`,
            source: causeId,
            target: ev.eventId,
            label: 'causes',
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
      <p className="text-stone-500 text-sm py-4">No events to visualize.</p>
    );
  }

  return <GraphContainer nodes={nodes} edges={edges} />;
}
