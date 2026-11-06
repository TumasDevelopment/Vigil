import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePing } from "../worker/ping.mjs";
import { nextState } from "../worker/state.mjs";
import { hashPassword, verifyPassword } from "../lib/password.mjs";

const at = (seconds) => new Date(seconds * 1000);
const ok = { sent: 3, received: 3 };
const lost = { sent: 3, received: 0 };

test("parsePing legge un host raggiungibile", () => {
  const out = `--- 192.168.1.254 ping statistics ---
3 packets transmitted, 3 received, 0% packet loss, time 402ms
rtt min/avg/max/mdev = 0.312/0.451/0.620/0.127 ms`;
  assert.deepEqual(parsePing(out), { sent: 3, received: 3, rttMin: 0.312, rttAvg: 0.451, rttMax: 0.62 });
});

test("parsePing legge la perdita parziale", () => {
  const out = `3 packets transmitted, 2 received, 33.3333% packet loss, time 410ms
rtt min/avg/max/mdev = 1.000/2.000/3.000/1.000 ms`;
  assert.equal(parsePing(out).received, 2);
});

test("parsePing legge un host muto, senza riga rtt", () => {
  const out = "3 packets transmitted, 0 received, 100% packet loss, time 2050ms";
  assert.deepEqual(parsePing(out), { sent: 3, received: 0, rttMin: null, rttAvg: null, rttMax: null });
});

test("parsePing rifiuta output sconosciuto", () => {
  assert.equal(parsePing("ping: nome: Name or service not known"), null);
});

test("un solo ciclo fallito non manda offline", () => {
  const prev = { status: "online", since: at(0), failStreak: 0, failSince: null };
  const next = nextState(prev, lost, at(10), 2);
  assert.equal(next.status, "online");
  assert.equal(next.failStreak, 1);
  assert.equal(next.openOutageAt, null);
});

test("l'interruzione parte dal primo ciclo fallito", () => {
  const prev = { status: "online", since: at(0), failStreak: 1, failSince: at(10) };
  const next = nextState(prev, lost, at(20), 2);
  assert.equal(next.status, "offline");
  assert.deepEqual(next.openOutageAt, at(10));
  assert.deepEqual(next.since, at(10));
});

test("un host già offline non apre una seconda interruzione", () => {
  const prev = { status: "offline", since: at(10), failStreak: 5, failSince: at(10) };
  assert.equal(nextState(prev, lost, at(60), 2).openOutageAt, null);
});

test("il ritorno online chiude l'interruzione", () => {
  const prev = { status: "offline", since: at(10), failStreak: 5, failSince: at(10) };
  const next = nextState(prev, ok, at(70), 2);
  assert.equal(next.status, "online");
  assert.deepEqual(next.closeOutageAt, at(70));
  assert.equal(next.failStreak, 0);
});

test("un ciclo perso seguito da una risposta azzera il conteggio", () => {
  const prev = { status: "online", since: at(0), failStreak: 1, failSince: at(10) };
  const next = nextState(prev, ok, at(20), 2);
  assert.equal(next.failStreak, 0);
  assert.equal(next.failSince, null);
  assert.deepEqual(next.since, at(0));
  assert.equal(next.closeOutageAt, null);
});

test("un host nuovo e muto arriva offline dopo la soglia", () => {
  const first = nextState(null, lost, at(0), 2);
  assert.equal(first.status, "unknown");
  const second = nextState(first, lost, at(10), 2);
  assert.equal(second.status, "offline");
  assert.deepEqual(second.openOutageAt, at(0));
});

test("le password si verificano e quelle errate no", async () => {
  const hash = await hashPassword("una-password-lunga");
  assert.equal(await verifyPassword("una-password-lunga", hash), true);
  assert.equal(await verifyPassword("sbagliata", hash), false);
  assert.equal(await verifyPassword("x", "formato-non-valido"), false);
});
