"use client";

import { useMemo, useState } from "react";
import type { RangeKey } from "@/lib/ranges";
import { ALL_FILTER, groupHosts } from "@/lib/scope";
import type { EventsData } from "@/lib/types";
import { OutageTable } from "./OutageTable";
import { FilterSelect, HealthBanner, RangePicker, RefreshStatus } from "./Toolbar";
import { useLiveData } from "./useLiveData";

export function EventsClient({ initialRange, ackAs }: { initialRange: RangeKey; ackAs: string | null }) {
  const [range, setRange] = useState(initialRange);
  const [state, setState] = useState("");
  const [search, setSearch] = useState("");
  const [sector, setSector] = useState(ALL_FILTER);
  const [type, setType] = useState(ALL_FILTER);

  const live = useLiveData<EventsData>(`/api/eventi?range=${range}${state ? `&stato=${state}` : ""}`);
  const data = live.data;

  function changeRange(next: RangeKey) {
    setRange(next);
    window.history.replaceState(null, "", `?range=${next}`);
  }

  const sectorOptions = useMemo(() => groupHosts(data?.outages ?? [], "sector"), [data]);
  const typeOptions = useMemo(() => groupHosts(data?.outages ?? [], "type"), [data]);

  const needle = search.trim().toLowerCase();
  const outages = (data?.outages ?? [])
    .filter((outage) => sector === ALL_FILTER || outage.sector === sector)
    .filter((outage) => type === ALL_FILTER || outage.type === type)
    .filter(
      (outage) =>
        !needle ||
        outage.hostName.toLowerCase().includes(needle) ||
        outage.address.toLowerCase().includes(needle) ||
        (outage.service ?? "").toLowerCase().includes(needle) ||
        outage.note.toLowerCase().includes(needle),
    );

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Eventi</h1>
          <p>Storico delle interruzioni</p>
        </div>
      </header>

      <HealthBanner error={live.error} pinger={data?.pinger} />

      <div className="toolbar">
        <RangePicker value={range} onChange={changeRange} />
        <input
          className="input"
          type="search"
          placeholder="Cerca nome, IP, servizio o nota"
          aria-label="Cerca host"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        {sectorOptions.length > 1 && (
          <FilterSelect
            label="Settore"
            allLabel="Tutti i settori"
            value={sector}
            options={sectorOptions}
            onChange={setSector}
          />
        )}
        {typeOptions.length > 1 && (
          <FilterSelect label="Tipo" allLabel="Tutti i tipi" value={type} options={typeOptions} onChange={setType} />
        )}
        <select className="select" aria-label="Stato" value={state} onChange={(event) => setState(event.target.value)}>
          <option value="">Tutte</option>
          <option value="open">In corso</option>
          <option value="closed">Risolte</option>
          <option value="noted">Con nota, tutto lo storico</option>
        </select>
        <div className="toolbar__end">
          <RefreshStatus live={live} />
        </div>
      </div>

      {data && (
        <section className={`panel ${data.range !== range ? "is-refetching" : ""}`}>
          <OutageTable outages={outages} now={data.serverTime} range={range} ackAs={ackAs} onSaved={live.reload} />
        </section>
      )}
    </>
  );
}
