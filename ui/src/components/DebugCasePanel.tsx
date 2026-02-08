import { useState } from 'react';
import type {
  Case,
  CausalEvent,
  Character,
  Location,
  CasebookEntry,
  Fact,
  Question,
} from '@shared/index';

const SECTIONS = [
  'Overview',
  'Events',
  'Characters',
  'Locations',
  'Casebook',
  'Facts',
  'Questions',
] as const;

type SectionId = (typeof SECTIONS)[number];

interface DebugCasePanelProps {
  gameCase: Case;
  onClose: () => void;
}

function KeyValue({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="grid grid-cols-[10rem_1fr] gap-2 py-1 text-sm">
      <dt className="text-stone-500 font-medium">{label}</dt>
      <dd className={mono ? 'font-mono text-xs break-all' : ''}>{value}</dd>
    </div>
  );
}

function OverviewSection({ gameCase }: { gameCase: Case }) {
  const [introExpanded, setIntroExpanded] = useState(false);
  const intro = gameCase.introduction;
  const showExpand = intro.length > 200;

  return (
    <div className="space-y-6">
      <KeyValue label="caseDate" value={gameCase.caseDate} mono />
      <KeyValue label="title" value={gameCase.title} />
      <KeyValue label="difficulty" value={gameCase.difficulty} mono />
      <div>
        <div className="text-stone-500 font-medium text-sm mb-1">setting</div>
        <div className="space-y-1 pl-4 border-l-2 border-stone-200 text-sm">
          <KeyValue label="era" value={gameCase.setting.era} />
          <KeyValue label="date" value={gameCase.setting.date} />
          <KeyValue label="atmosphere" value={gameCase.setting.atmosphere} />
        </div>
      </div>
      <div>
        <div className="flex items-center justify-between">
          <span className="text-stone-500 font-medium text-sm">introduction</span>
          {showExpand && (
            <button
              type="button"
              onClick={() => setIntroExpanded((e) => !e)}
              className="text-xs text-stone-500 hover:text-stone-700"
            >
              {introExpanded ? 'Collapse' : 'Expand'}
            </button>
          )}
        </div>
        <pre className="mt-1 p-3 bg-stone-100 rounded text-xs whitespace-pre-wrap font-sans text-stone-700 max-h-48 overflow-y-auto">
          {introExpanded || !showExpand ? intro : `${intro.slice(0, 200)}...`}
        </pre>
      </div>
      <div>
        <div className="text-stone-500 font-medium text-sm mb-2">optimalPath</div>
        <ol className="list-decimal list-inside space-y-1 font-mono text-xs">
          {gameCase.optimalPath.map((entryId, i) => {
            const entry = gameCase.casebook[entryId];
            const label = entry ? entry.label : entryId;
            return (
              <li key={i}>
                <span className="text-stone-600">{entryId}</span>
                {entry && (
                  <span className="text-stone-500 ml-2">— {label}</span>
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

function EventRow({ event }: { event: CausalEvent }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-stone-200 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full text-left px-3 py-2 flex items-center justify-between bg-stone-50 hover:bg-stone-100"
      >
        <span className="font-mono text-sm">{event.eventId}</span>
        <span className="text-stone-500 text-xs">t{event.timestamp}</span>
      </button>
      {open && (
        <div className="p-3 pt-0 space-y-2 text-sm border-t border-stone-200">
          <KeyValue label="description" value={event.description} />
          <KeyValue label="agent" value={event.agent} mono />
          <KeyValue label="location" value={event.location} mono />
          <KeyValue label="necessity" value={event.necessity} mono />
          <KeyValue
            label="causes"
            value={event.causes.length ? event.causes.join(', ') : '—'}
            mono
          />
          <KeyValue
            label="reveals"
            value={event.reveals.length ? event.reveals.join(', ') : '—'}
            mono
          />
          <div>
            <div className="text-stone-500 font-medium text-sm mb-1">involvement</div>
            <pre className="p-2 bg-stone-100 rounded text-xs font-mono">
              {JSON.stringify(event.involvement, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

function EventsSection({ gameCase }: { gameCase: Case }) {
  const events = Object.values(gameCase.events).sort(
    (a, b) => a.timestamp - b.timestamp,
  );
  return (
    <div className="space-y-2">
      {events.length === 0 ? (
        <p className="text-stone-500 text-sm">No events.</p>
      ) : (
        events.map((ev) => <EventRow key={ev.eventId} event={ev} />)
      )}
    </div>
  );
}

function CharacterRow({ character }: { character: Character }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-stone-200 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full text-left px-3 py-2 flex items-center justify-between bg-stone-50 hover:bg-stone-100"
      >
        <span className="font-medium text-sm">{character.name}</span>
        <span className="font-mono text-xs text-stone-500">{character.characterId}</span>
      </button>
      {open && (
        <div className="p-3 pt-0 space-y-2 text-sm border-t border-stone-200">
          <KeyValue label="role" value={character.role} />
          <KeyValue label="description" value={character.description} />
          {character.currentStatus != null && (
            <KeyValue label="currentStatus" value={character.currentStatus} />
          )}
          <KeyValue
            label="wants"
            value={
              character.wants.length ? character.wants.join('; ') : '—'
            }
          />
          <KeyValue
            label="hides"
            value={
              character.hides.length ? character.hides.join(', ') : '—'
            }
            mono
          />
          <div>
            <div className="text-stone-500 font-medium text-sm mb-1">tone</div>
            <pre className="p-2 bg-stone-100 rounded text-xs font-mono">
              {JSON.stringify(character.tone, null, 2)}
            </pre>
          </div>
          <div>
            <div className="text-stone-500 font-medium text-sm mb-1">knowledgeState</div>
            <pre className="p-2 bg-stone-100 rounded text-xs font-mono max-h-32 overflow-y-auto">
              {JSON.stringify(character.knowledgeState, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

function CharactersSection({ gameCase }: { gameCase: Case }) {
  const chars = Object.values(gameCase.characters);
  return (
    <div className="space-y-2">
      {chars.length === 0 ? (
        <p className="text-stone-500 text-sm">No characters.</p>
      ) : (
        chars.map((c) => <CharacterRow key={c.characterId} character={c} />)
      )}
    </div>
  );
}

function LocationRow({ location }: { location: Location }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-stone-200 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full text-left px-3 py-2 flex items-center justify-between bg-stone-50 hover:bg-stone-100"
      >
        <span className="font-medium text-sm">{location.name}</span>
        <span className="font-mono text-xs text-stone-500">{location.locationId}</span>
      </button>
      {open && (
        <div className="p-3 pt-0 space-y-2 text-sm border-t border-stone-200">
          <KeyValue label="type" value={location.type} mono />
          <KeyValue label="description" value={location.description} />
          {location.parent != null && (
            <KeyValue label="parent" value={location.parent} mono />
          )}
          <KeyValue
            label="adjacentTo"
            value={location.adjacentTo.length ? location.adjacentTo.join(', ') : '—'}
            mono
          />
          <KeyValue
            label="visibleFrom"
            value={location.visibleFrom.length ? location.visibleFrom.join(', ') : '—'}
            mono
          />
          <KeyValue
            label="audibleFrom"
            value={location.audibleFrom.length ? location.audibleFrom.join(', ') : '—'}
            mono
          />
        </div>
      )}
    </div>
  );
}

function LocationsSection({ gameCase }: { gameCase: Case }) {
  const locs = Object.values(gameCase.locations);
  return (
    <div className="space-y-2">
      {locs.length === 0 ? (
        <p className="text-stone-500 text-sm">No locations.</p>
      ) : (
        locs.map((loc) => <LocationRow key={loc.locationId} location={loc} />)
      )}
    </div>
  );
}

function CasebookEntryRow({ entry }: { entry: CasebookEntry }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-stone-200 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full text-left px-3 py-2 flex items-center justify-between bg-stone-50 hover:bg-stone-100"
      >
        <span className="font-medium text-sm">{entry.label}</span>
        <span className="font-mono text-xs text-stone-500">{entry.entryId}</span>
      </button>
      {open && (
        <div className="p-3 pt-0 space-y-2 text-sm border-t border-stone-200">
          <KeyValue label="address" value={entry.address} />
          <KeyValue label="locationId" value={entry.locationId} mono />
          <KeyValue label="type" value={entry.type} mono />
          <KeyValue
            label="characters"
            value={entry.characters.length ? entry.characters.join(', ') : '—'}
            mono
          />
          <KeyValue
            label="revealsFactIds"
            value={
              entry.revealsFactIds.length ? entry.revealsFactIds.join(', ') : '—'
            }
            mono
          />
          <div>
            <div className="text-stone-500 font-medium text-sm mb-1">scene</div>
            <pre className="p-2 bg-stone-100 rounded text-xs whitespace-pre-wrap font-sans text-stone-700 max-h-48 overflow-y-auto">
              {entry.scene}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

function CasebookSection({ gameCase }: { gameCase: Case }) {
  const entries = Object.values(gameCase.casebook);
  return (
    <div className="space-y-2">
      {entries.length === 0 ? (
        <p className="text-stone-500 text-sm">No casebook entries.</p>
      ) : (
        entries.map((e) => <CasebookEntryRow key={e.entryId} entry={e} />)
      )}
    </div>
  );
}

function FactRow({ fact }: { fact: Fact }) {
  return (
    <div className="border border-stone-200 rounded-lg p-3 text-sm">
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="font-mono text-xs text-stone-500">{fact.factId}</span>
        <span className="text-xs px-1.5 py-0.5 rounded bg-stone-200 text-stone-600">
          {fact.category}
        </span>
        {fact.critical && (
          <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">
            critical
          </span>
        )}
      </div>
      <p className="text-stone-700">{fact.description}</p>
    </div>
  );
}

function FactsSection({ gameCase }: { gameCase: Case }) {
  const facts = Object.values(gameCase.facts);
  return (
    <div className="space-y-2">
      {facts.length === 0 ? (
        <p className="text-stone-500 text-sm">No facts.</p>
      ) : (
        facts.map((f) => <FactRow key={f.factId} fact={f} />)
      )}
    </div>
  );
}

function QuestionRow({ q }: { q: Question }) {
  return (
    <div className="border border-stone-200 rounded-lg p-3 text-sm space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs text-stone-500">{q.questionId}</span>
        <span className="text-xs text-stone-500">{q.points} pts · {q.difficulty}</span>
      </div>
      <p className="font-medium text-stone-800">{q.text}</p>
      <KeyValue label="answer" value={q.answer} />
      <KeyValue
        label="requiredFacts"
        value={q.requiredFacts.length ? q.requiredFacts.join(', ') : '—'}
        mono
      />
    </div>
  );
}

function QuestionsSection({ gameCase }: { gameCase: Case }) {
  const questions = gameCase.questions;
  return (
    <div className="space-y-2">
      {questions.length === 0 ? (
        <p className="text-stone-500 text-sm">No questions.</p>
      ) : (
        questions.map((q) => <QuestionRow key={q.questionId} q={q} />)
      )}
    </div>
  );
}

export function DebugCasePanel({ gameCase, onClose }: DebugCasePanelProps) {
  const [activeSection, setActiveSection] = useState<SectionId>('Overview');

  const renderSection = () => {
    switch (activeSection) {
      case 'Overview':
        return <OverviewSection gameCase={gameCase} />;
      case 'Events':
        return <EventsSection gameCase={gameCase} />;
      case 'Characters':
        return <CharactersSection gameCase={gameCase} />;
      case 'Locations':
        return <LocationsSection gameCase={gameCase} />;
      case 'Casebook':
        return <CasebookSection gameCase={gameCase} />;
      case 'Facts':
        return <FactsSection gameCase={gameCase} />;
      case 'Questions':
        return <QuestionsSection gameCase={gameCase} />;
      default:
        return null;
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label="Case debug"
    >
      <div
        className="absolute inset-0 bg-stone-900/50"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative w-full max-w-2xl h-full bg-white shadow-xl flex flex-col">
        <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-stone-200">
          <h2 className="text-lg font-semibold text-stone-800">Case debug</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-stone-500 hover:text-stone-700 px-2 py-1 rounded border border-stone-300"
          >
            Close
          </button>
        </div>
        <div className="shrink-0 flex gap-1 px-4 py-2 border-b border-stone-200 overflow-x-auto">
          {SECTIONS.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveSection(id)}
              className={`shrink-0 px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                activeSection === id
                  ? 'bg-stone-800 text-white'
                  : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
              }`}
            >
              {id}
            </button>
          ))}
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-4">
          {renderSection()}
        </div>
      </div>
    </div>
  );
}
