import assert from "node:assert/strict";
import { test } from "node:test";
import {
  collectSystemFacts,
  networkCards,
  parseDefaultGateway,
  parseNameservers,
  parseOsRelease,
} from "../worker/system-facts.mjs";

test("os-release si legge con e senza virgolette", () => {
  const text = ['PRETTY_NAME="Debian GNU/Linux 13 (trixie)"', "NAME=Debian", 'VERSION="13 (trixie)"', "VERSION_ID=13", "VERSION_CODENAME=trixie", "# commento"].join("\n");
  assert.deepEqual(parseOsRelease(text), { name: "Debian GNU/Linux 13 (trixie)", version: "13 (trixie)", codename: "trixie" });
  assert.deepEqual(parseOsRelease("NAME='Alpine Linux'\nVERSION_ID=3.22.1"), { name: "Alpine Linux", version: "3.22.1", codename: null });
  assert.deepEqual(parseOsRelease(""), { name: null, version: null, codename: null });
});

test("il gateway predefinito si legge da /proc/net/route", () => {
  const route = [
    "Iface\tDestination\tGateway \tFlags\tRefCnt\tUse\tMetric\tMask\t\tMTU\tWindow\tIRTT",
    "eth0\t0001A8C0\t00000000\t0001\t0\t0\t100\t00FFFFFF\t0\t0\t0",
    "eth0\t00000000\t0101A8C0\t0003\t0\t0\t100\t00000000\t0\t0\t0",
  ].join("\n");
  assert.deepEqual(parseDefaultGateway(route), { address: "192.168.1.1", iface: "eth0" });
  // Una rotta predefinita senza gateway (per esempio su una VPN punto-punto) non vale
  assert.equal(parseDefaultGateway("Iface\tDestination\tGateway\tFlags\nwg0\t00000000\t00000000\t0001"), null);
  assert.equal(parseDefaultGateway(""), null);
});

test("i server DNS senza doppioni", () => {
  const text = "# generato\nnameserver 192.168.1.1\nnameserver  9.9.9.9\nnameserver 192.168.1.1\noptions edns0\nnameserver fd00::1";
  assert.deepEqual(parseNameservers(text), ["192.168.1.1", "9.9.9.9", "fd00::1"]);
});

test("solo le schede vere, IPv4 prima di IPv6 e senza fe80", () => {
  const cards = networkCards({
    lo: [{ family: "IPv4", address: "127.0.0.1", cidr: "127.0.0.1/8", internal: true, mac: "00:00:00:00:00:00" }],
    docker0: [{ family: "IPv4", address: "172.17.0.1", cidr: "172.17.0.1/16", internal: false, mac: "02:42:ac:11:00:01" }],
    eth0: [
      { family: "IPv6", address: "fe80::1", cidr: "fe80::1/64", internal: false, mac: "aa:bb:cc:dd:ee:ff" },
      { family: "IPv6", address: "2001:db8::5", cidr: "2001:db8::5/64", internal: false, mac: "aa:bb:cc:dd:ee:ff" },
      { family: "IPv4", address: "192.168.1.5", cidr: "192.168.1.5/24", internal: false, mac: "aa:bb:cc:dd:ee:ff" },
    ],
  });
  assert.deepEqual(cards, [{ name: "eth0", mac: "aa:bb:cc:dd:ee:ff", addresses: ["192.168.1.5/24", "2001:db8::5/64"] }]);
});

test("la raccolta sul server vero restituisce i campi attesi", async () => {
  const facts = await collectSystemFacts();
  assert.equal(typeof facts.os.kernel, "string");
  assert.equal(typeof facts.hostname, "string");
  assert.ok(facts.cpu.cores > 0);
  assert.ok(facts.memTotal > 0);
  assert.match(facts.software.node, /^v\d+/);
  assert.match(facts.software.vigil ?? "", /^\d+\.\d+/);
  assert.ok(Array.isArray(facts.network.cards));
  assert.ok(facts.workerStartedAt <= Date.now() / 1000);
});
