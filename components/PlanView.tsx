"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { deleteFloorPlanAction, savePlanPositionsAction } from "@/lib/actions";
import type { FloorPlan, HostStatus, PlanMarker } from "@/lib/types";
import { ConfirmSubmit, Modal, SubmitButton, useFormAction } from "./forms";
import { PlanForm } from "./PlansList";
import { STATUS_LABEL, StatusBadge, StatusIcon } from "./StatusBadge";
import { useLiveData } from "./useLiveData";

export interface PlanHost {
  id: number;
  name: string;
  sector: string;
}

interface Point {
  x: number;
  y: number;
}

const STATUS_ORDER: HostStatus[] = ["offline", "unreachable", "unstable", "maintenance", "online", "unknown", "paused"];
const KEY_STEP = 0.005;
const KEY_MOVES: Record<string, Point> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};

const clamp = (value: number) => Math.min(1, Math.max(0, value));
const at = ({ x, y }: Point) => ({ left: `${x * 100}%`, top: `${y * 100}%` });

function markerTitle(marker: PlanMarker) {
  return [marker.name, marker.address, STATUS_LABEL[marker.status], marker.reason].filter(Boolean).join(" · ");
}

function Legend({ markers }: { markers: PlanMarker[] }) {
  const present = STATUS_ORDER.filter((status) => markers.some((marker) => marker.status === status));
  return (
    <div className="plan-legend">
      {present.map((status) => (
        <span key={status} className="plan-legend__item">
          <StatusBadge status={status} />
          {markers.filter((marker) => marker.status === status).length}
        </span>
      ))}
    </div>
  );
}

function PlanImage({ plan }: { plan: FloorPlan }) {
  return (
    <img src={`/api/planimetrie/${plan.id}/immagine?v=${plan.version}`} alt={`Pianta: ${plan.name}`} draggable={false} />
  );
}

function PlanEditor({
  plan,
  hosts,
  onDone,
}: {
  plan: FloorPlan;
  hosts: PlanHost[];
  onDone: () => void;
}) {
  const { state, pending, onSubmit } = useFormAction(savePlanPositionsAction);
  const [points, setPoints] = useState(
    () => new Map<number, Point>(plan.markers.map((marker) => [marker.hostId, { x: marker.x, y: marker.y }])),
  );
  const [picked, setPicked] = useState<number | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const stage = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (state?.ok) onDone();
  }, [state, onDone]);

  const move = (id: number, point: Point) => setPoints((current) => new Map(current).set(id, point));

  function remove(id: number) {
    setPoints((current) => {
      const next = new Map(current);
      next.delete(id);
      return next;
    });
  }

  function pointFrom(event: { clientX: number; clientY: number }) {
    const box = stage.current?.getBoundingClientRect();
    if (!box) return null;
    return { x: clamp((event.clientX - box.left) / box.width), y: clamp((event.clientY - box.top) / box.height) };
  }

  function onStageClick(event: MouseEvent) {
    const point = pointFrom(event);
    if (picked === null || !point) return;
    move(picked, point);
    setPicked(null);
  }

  function onPointerMove(event: PointerEvent, id: number) {
    if (dragging !== id) return;
    const point = pointFrom(event);
    if (point) move(id, point);
  }

  function onKeyDown(event: KeyboardEvent, id: number) {
    const direction = KEY_MOVES[event.key];
    const point = points.get(id);
    if (!direction || !point) return;
    event.preventDefault();
    const step = event.shiftKey ? KEY_STEP * 5 : KEY_STEP;
    move(id, { x: clamp(point.x + direction.x * step), y: clamp(point.y + direction.y * step) });
  }

  const needle = search.trim().toLowerCase();
  const waiting = hosts.filter((host) => !points.has(host.id) && host.name.toLowerCase().includes(needle));
  const placed = hosts.filter((host) => points.has(host.id));
  const pickedHost = hosts.find((host) => host.id === picked);
  const positions = placed.map((host) => ({ hostId: host.id, ...points.get(host.id) }));

  return (
    <div className="plan-layout">
      <div className="plan-scroll">
        <div
          ref={stage}
          className={`plan-stage ${picked !== null ? "plan-stage--placing" : ""}`}
          onClick={onStageClick}
        >
          <PlanImage plan={plan} />
          {placed.map((host) => (
            <button
              key={host.id}
              type="button"
              className="plan-marker plan-marker--edit"
              style={at(points.get(host.id) as Point)}
              aria-label={`Sposta ${host.name}. Usa le frecce.`}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => onKeyDown(event, host.id)}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                setDragging(host.id);
              }}
              onPointerMove={(event) => onPointerMove(event, host.id)}
              onPointerUp={() => setDragging(null)}
              onPointerCancel={() => setDragging(null)}
            >
              <span className="plan-marker__name">{host.name}</span>
            </button>
          ))}
        </div>
      </div>

      <form className="plan-side" onSubmit={onSubmit}>
        <input type="hidden" name="id" value={plan.id} />
        <input type="hidden" name="positions" value={JSON.stringify(positions)} />
        {state?.error && (
          <div className="notice notice--error" role="alert">
            {state.error}
          </div>
        )}
        <p className="form__hint" aria-live="polite">
          {pickedHost
            ? `Fai clic sulla pianta nel punto dove si trova ${pickedHost.name}.`
            : "Scegli un dispositivo dall'elenco, poi fai clic sulla pianta. Quelli già messi si spostano trascinandoli."}
        </p>

        <h2>Da posizionare</h2>
        <input
          className="input"
          type="search"
          placeholder="Cerca host"
          aria-label="Cerca host da posizionare"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <ul className="plan-list">
          {waiting.map((host) => (
            <li key={host.id}>
              <button
                type="button"
                className={`plan-pick ${picked === host.id ? "plan-pick--active" : ""}`}
                aria-pressed={picked === host.id}
                onClick={() => setPicked(picked === host.id ? null : host.id)}
              >
                <span className="truncate">{host.name}</span>
                {host.sector && <small className="truncate">{host.sector}</small>}
              </button>
            </li>
          ))}
          {waiting.length === 0 && <li className="muted">Nessun host da posizionare.</li>}
        </ul>

        <h2>Sulla pianta ({placed.length})</h2>
        <ul className="plan-list">
          {placed.map((host) => (
            <li key={host.id} className="plan-placed">
              <span className="truncate">{host.name}</span>
              <button
                type="button"
                className="btn btn--small"
                aria-label={`Togli ${host.name} dalla pianta`}
                onClick={() => remove(host.id)}
              >
                Togli
              </button>
            </li>
          ))}
        </ul>

        <div className="form__actions">
          <button type="button" className="btn" onClick={onDone}>
            Annulla
          </button>
          <SubmitButton pending={pending}>Salva posizioni</SubmitButton>
        </div>
      </form>
    </div>
  );
}

export function PlanView({ initial, hosts, canEdit }: { initial: FloorPlan; hosts: PlanHost[]; canEdit: boolean }) {
  const { data, error, reload } = useLiveData<FloorPlan>(`/api/planimetrie/${initial.id}`);
  const [editing, setEditing] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const plan = data ?? initial;

  const closeEditor = useCallback(() => {
    setEditing(false);
    reload();
  }, [reload]);
  const closeRename = useCallback(() => {
    setRenaming(false);
    reload();
  }, [reload]);

  return (
    <>
      <header className="page-head">
        <div>
          <h1>{plan.name}</h1>
          <p>
            <Link href="/planimetrie">Planimetrie</Link>
            {plan.markers.length > 0 && ` · ${plan.markers.length === 1 ? "1 dispositivo" : `${plan.markers.length} dispositivi`}`}
          </p>
        </div>
        {canEdit && !editing && (
          <div className="toolbar" style={{ marginBottom: 0 }}>
            <button type="button" className="btn btn--primary" onClick={() => setEditing(true)}>
              Modifica posizioni
            </button>
            <button type="button" className="btn" onClick={() => setRenaming(true)}>
              Nome e immagine
            </button>
            <form action={deleteFloorPlanAction}>
              <input type="hidden" name="id" value={plan.id} />
              <ConfirmSubmit label="Elimina" confirmLabel="Elimina la planimetria" />
            </form>
          </div>
        )}
      </header>

      {error && (
        <div className="notice notice--error" role="alert">
          {error}
        </div>
      )}

      {editing ? (
        <PlanEditor plan={plan} hosts={hosts} onDone={closeEditor} />
      ) : (
        <>
          <Legend markers={plan.markers} />
          {plan.markers.length === 0 && (
            <p className="form__hint">
              {canEdit ? "Nessun dispositivo sulla pianta: usa Modifica posizioni." : "Nessun dispositivo sulla pianta."}
            </p>
          )}
          <div className="plan-scroll">
            <div className="plan-stage">
              <PlanImage plan={plan} />
              {plan.markers.map((marker) => (
                <Link
                  key={marker.hostId}
                  href={`/host/${marker.hostId}`}
                  className={`plan-marker plan-marker--${marker.status}`}
                  style={at(marker)}
                  title={markerTitle(marker)}
                  aria-label={markerTitle(marker)}
                >
                  <StatusIcon status={marker.status} />
                  <span className="plan-marker__name">{marker.name}</span>
                </Link>
              ))}
            </div>
          </div>
        </>
      )}

      {renaming && (
        <Modal title="Nome e immagine" onClose={() => setRenaming(false)}>
          <PlanForm plan={plan} onDone={() => setRenaming(false)} onSaved={closeRename} />
        </Modal>
      )}
    </>
  );
}
