import assert from "node:assert/strict";
import { test } from "node:test";
import {
  countStatus,
  describeScope,
  groupHosts,
  inAccount,
  inScope,
  mean,
  meanSeries,
  overlapSeconds,
  parseDeviceType,
} from "../lib/scope.ts";

const hosts = [
  { id: 1, sector: "Produzione", type: "stampante", status: "online" },
  { id: 2, sector: "Produzione", type: "switch", status: "offline" },
  { id: 3, sector: "Uffici", type: "stampante", status: "unstable" },
  { id: 4, sector: "", type: "server", status: "paused" },
  { id: 5, sector: "Àrea verde", type: "altro", status: "unknown" },
];

const ids = (scope) => hosts.filter((host) => inScope(host, scope)).map((host) => host.id);

test("un account senza scelte non vede nulla, a differenza di una vista", () => {
  const host = { id: 1, sector: "Uffici", type: "server" };
  assert.equal(inAccount(host, { sectors: [], hostIds: [] }), false);
  assert.equal(inScope(host, { sectors: [], types: [], hostIds: [] }), true);
});

test("un account vede i settori interi e i dispositivi scelti uno per uno", () => {
  const account = { sectors: ["Uffici", ""], hostIds: [7] };
  assert.equal(inAccount({ id: 1, sector: "Uffici" }, account), true);
  assert.equal(inAccount({ id: 2, sector: "" }, account), true, "Senza settore si può scegliere");
  assert.equal(inAccount({ id: 7, sector: "Produzione" }, account), true);
  assert.equal(inAccount({ id: 8, sector: "Produzione" }, account), false);
});

test("un profilo senza scelte mostra tutti gli host", () => {
  assert.deepEqual(ids({ sectors: [], types: [], hostIds: [] }), [1, 2, 3, 4, 5]);
});

test("settori e tipi si combinano", () => {
  assert.deepEqual(ids({ sectors: ["Produzione"], types: ["stampante"], hostIds: [] }), [1]);
  assert.deepEqual(ids({ sectors: ["Produzione"], types: [], hostIds: [] }), [1, 2]);
  assert.deepEqual(ids({ sectors: [], types: ["stampante"], hostIds: [] }), [1, 3]);
});

test("gli host scelti a mano si aggiungono ai filtri", () => {
  assert.deepEqual(ids({ sectors: ["Uffici"], types: [], hostIds: [4] }), [3, 4]);
  assert.deepEqual(ids({ sectors: [], types: [], hostIds: [2] }), [2]);
});

test("la stringa vuota indica gli host senza settore", () => {
  assert.deepEqual(ids({ sectors: [""], types: [], hostIds: [] }), [4]);
});

test("i settori sono in ordine alfabetico e senza settore va in fondo", () => {
  const groups = groupHosts(hosts, "sector");
  assert.deepEqual(
    groups.map((group) => group.label),
    ["Àrea verde", "Produzione", "Uffici", "Senza settore"],
  );
  assert.equal(groups[3].key, "");
});

test("i tipi seguono l'ordine fisso, non quello degli host", () => {
  assert.deepEqual(
    groupHosts(hosts, "type").map((group) => group.key),
    ["server", "switch", "stampante", "altro"],
  );
});

test("senza raggruppamento resta un solo gruppo, anche vuoto", () => {
  assert.equal(groupHosts(hosts, "none")[0].hosts.length, 5);
  assert.equal(groupHosts([], "none").length, 1);
});

test("il conteggio esclude gli host in pausa", () => {
  assert.deepEqual(countStatus(hosts), {
    monitored: 4,
    online: 1,
    unstable: 1,
    offline: 1,
    unreachable: 0,
    unknown: 1,
    maintenance: 0,
  });
});

test("chi è in manutenzione esce dai monitorati, chi non è raggiungibile resta", () => {
  const counts = countStatus([{ status: "maintenance" }, { status: "unreachable" }, { status: "online" }]);
  assert.equal(counts.monitored, 2);
  assert.equal(counts.maintenance, 1);
  assert.equal(counts.unreachable, 1);
});

test("i secondi di manutenzione dentro un'interruzione", () => {
  assert.equal(overlapSeconds(100, 200, []), 0);
  assert.equal(overlapSeconds(100, 200, [[120, 150]]), 30);
  assert.equal(overlapSeconds(100, 200, [[0, 110], [190, 500]]), 20);
  assert.equal(overlapSeconds(100, 200, [[0, 500]]), 100);
  assert.equal(overlapSeconds(100, 200, [[300, 400]]), 0);
  // Due finestre sovrapposte, anche in disordine, non contano doppio
  assert.equal(overlapSeconds(100, 200, [[140, 180], [120, 150]]), 60);
  assert.equal(overlapSeconds(100, 200, [[120, 180], [130, 140]]), 60);
});

test("la media per punto ignora gli intervalli senza dati", () => {
  assert.equal(mean([null, null]), null);
  assert.deepEqual(meanSeries([[1, null, 3], [3, null]], 3), [2, null, 3]);
});

test("l'importazione accetta chiave, etichetta e sinonimi", () => {
  assert.equal(parseDeviceType("Stampanti"), "stampante");
  assert.equal(parseDeviceType(" nas "), "storage");
  assert.equal(parseDeviceType("firewall"), "router");
  assert.equal(parseDeviceType("PLC"), "macchina");
  assert.equal(parseDeviceType("tostapane"), null);
});

test("la descrizione del profilo è leggibile", () => {
  assert.equal(describeScope({ sectors: [], types: [], hostIds: [] }), "Tutti gli host");
  assert.equal(
    describeScope({ sectors: ["", "Uffici"], types: ["wifi"], hostIds: [1, 2] }),
    "Senza settore, Uffici · Access point · 2 host scelti",
  );
});
