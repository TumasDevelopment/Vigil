"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { pathToRoot } from "@/lib/tree.mjs";
import type { HostStatus } from "@/lib/types";
import { STATUS_LABEL } from "./StatusBadge";

export interface TopologyNode {
  id: number;
  name: string;
  address: string;
  status: HostStatus;
  parentId: number | null;
  depth: number;
  row: number;
  children: number;
}

export interface TopologyLone {
  id: number;
  name: string;
  address: string;
  status: HostStatus;
}

const COLUMN = 236;
const ROW = 46;
const NODE_W = 196;
const NODE_H = 34;
const PAD = 12;
const REFRESH_MS = 30_000;
const NAME_MAX = 22;

const short = (text: string) => (text.length > NAME_MAX ? `${text.slice(0, NAME_MAX - 1)}…` : text);

const ORDER: HostStatus[] = ["offline", "unreachable", "unstable", "maintenance", "online", "unknown", "paused"];

export function TopologyMap({ nodes, lone, rows, depth }: { nodes: TopologyNode[]; lone: TopologyLone[]; rows: number; depth: number }) {
  const router = useRouter();
  const [focus, setFocus] = useState<number | null>(null);

  // Gli stati cambiano: la pagina si ricarica da sola, come le altre viste
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [router]);

  const byId = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const parents = useMemo(
    () => new Map(nodes.filter((node) => node.parentId !== null && byId.has(node.parentId)).map((node) => [node.id, node.parentId])),
    [nodes, byId],
  );
  const chain = useMemo(() => new Set(focus === null ? [] : pathToRoot(focus, parents)), [focus, parents]);

  const counts = new Map<HostStatus, number>();
  for (const host of [...nodes, ...lone]) counts.set(host.status, (counts.get(host.status) ?? 0) + 1);

  const width = depth * COLUMN - (COLUMN - NODE_W) + PAD * 2;
  const height = rows * ROW - (ROW - NODE_H) + PAD * 2;
  const x = (node: TopologyNode) => PAD + node.depth * COLUMN;
  const y = (node: TopologyNode) => PAD + node.row * ROW;

  return (
    <div className="stack">
      <header className="page-head">
        <div>
          <h1>Topologia</h1>
          <p>Da chi dipende ogni dispositivo: se cade un nodo, chi sta a valle diventa «non raggiungibile».</p>
        </div>
      </header>

      <div className="topo-legend">
        {ORDER.filter((status) => counts.has(status)).map((status) => (
          <span key={status} className={`topo-legend__item topo--${status}`}>
            <i />
            {STATUS_LABEL[status]} <b>{counts.get(status)}</b>
          </span>
        ))}
      </div>

      <section className="panel">
        {nodes.length === 0 ? (
          <div className="empty">
            Nessun collegamento. Nella scheda di un host scegli il «dispositivo a monte» (lo switch o il router da cui
            dipende): la mappa si disegna da sola.
          </div>
        ) : (
          <div className="topo-scroll">
            <svg
              className="topo"
              width={width}
              height={height}
              viewBox={`0 0 ${width} ${height}`}
              role="img"
              aria-label="Mappa delle dipendenze tra dispositivi"
            >
              {nodes.map((node) => {
                if (node.parentId === null) return null;
                const parent = byId.get(node.parentId);
                if (!parent) return null;
                const x1 = x(parent) + NODE_W;
                const y1 = y(parent) + NODE_H / 2;
                const x2 = x(node);
                const y2 = y(node) + NODE_H / 2;
                const mid = (x1 + x2) / 2;
                const lit = chain.has(node.id) && chain.has(parent.id);
                return (
                  <path
                    key={`e${node.id}`}
                    className={`topo__edge topo--${node.status}${lit ? " is-lit" : ""}`}
                    d={`M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`}
                  />
                );
              })}
              {nodes.map((node) => (
                <Link
                  key={node.id}
                  href={`/host/${node.id}`}
                  className={`topo__node topo--${node.status}${chain.has(node.id) ? " is-lit" : ""}${
                    focus !== null && !chain.has(node.id) ? " is-dim" : ""
                  }`}
                  onMouseEnter={() => setFocus(node.id)}
                  onMouseLeave={() => setFocus(null)}
                  onFocus={() => setFocus(node.id)}
                  onBlur={() => setFocus(null)}
                >
                  <title>{`${node.name} · ${node.address} · ${STATUS_LABEL[node.status]}`}</title>
                  <rect x={x(node)} y={y(node)} width={NODE_W} height={NODE_H} rx={8} />
                  <circle cx={x(node) + 14} cy={y(node) + NODE_H / 2} r={4.5} />
                  <text x={x(node) + 26} y={y(node) + NODE_H / 2} dominantBaseline="central">
                    {short(node.name)}
                  </text>
                  {node.children > 0 && (
                    <text className="topo__count" x={x(node) + NODE_W - 10} y={y(node) + NODE_H / 2} dominantBaseline="central" textAnchor="end">
                      {node.children}
                    </text>
                  )}
                </Link>
              ))}
            </svg>
          </div>
        )}
      </section>

      {lone.length > 0 && (
        <section className="panel">
          <div className="panel__head">
            <h2 className="panel__title">Senza collegamenti</h2>
            <span className="muted">{lone.length} host</span>
          </div>
          <div className="topo-lone">
            {lone.map((host) => (
              <Link key={host.id} href={`/host/${host.id}`} className={`topo-chip topo--${host.status}`} title={host.address}>
                <i />
                {host.name}
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
