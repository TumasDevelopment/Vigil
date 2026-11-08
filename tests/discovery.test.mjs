import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addressList,
  defaultSubnet,
  ipToNumber,
  maskToPrefix,
  numberToIp,
  parseSubnet,
  scanConcurrency,
  scanSeconds,
  subnetAddresses,
} from "../lib/subnet.mjs";
import {
  answered,
  guessType,
  neighbourAnswered,
  parseNeighbours,
  parseVendors,
  shortName,
  vendorOf,
} from "../worker/discovery.mjs";

test("gli indirizzi si convertono nei due sensi", () => {
  assert.equal(ipToNumber("192.168.1.179"), 3232235955);
  assert.equal(numberToIp(3232235955), "192.168.1.179");
  assert.equal(numberToIp(ipToNumber("255.255.255.255")), "255.255.255.255");
  assert.equal(ipToNumber("192.168.1.256"), null);
  assert.equal(ipToNumber("192.168.1"), null);
  assert.equal(ipToNumber("010.1.1.1"), null);
});

test("una sottorete si normalizza al suo primo indirizzo", () => {
  assert.equal(parseSubnet("192.168.1.179/24").cidr, "192.168.1.0/24");
  assert.equal(parseSubnet(" 192.168.1.0/24 ").cidr, "192.168.1.0/24");
  assert.equal(parseSubnet("172.31.255.0/23").cidr, "172.31.254.0/23");
  assert.equal(parseSubnet("10.0.0.5/32").cidr, "10.0.0.5/32");
});

test("si rifiuta ciò che non è una sottorete", () => {
  for (const input of ["", "192.168.1.0", "192.168.1.0/33", "192.168.1.0/-1", "192.168.1.999/24", "192.168.1.0/24; rm -rf /", "tutto"]) {
    assert.ok(parseSubnet(input).error, input);
  }
});

test("vanno bene reti private di qualsiasi ampiezza", () => {
  assert.equal(parseSubnet("10.0.0.0/8").size, 16_777_216);
  assert.equal(parseSubnet("10.20.30.40/8").cidr, "10.0.0.0/8");
  assert.equal(parseSubnet("172.16.0.0/12").cidr, "172.16.0.0/12");
  assert.equal(parseSubnet("172.20.5.0/16").cidr, "172.20.0.0/16");
  assert.equal(parseSubnet("192.168.0.0/16").size, 65_536);
  assert.equal(parseSubnet("10.0.0.0/21").cidr, "10.0.0.0/21");
  assert.equal(parseSubnet("192.168.7.9/20").cidr, "192.168.0.0/20");
});

test("la maschera si può scrivere per esteso", () => {
  assert.equal(parseSubnet("192.168.1.0/255.255.255.0").cidr, "192.168.1.0/24");
  assert.equal(parseSubnet("192.168.1.0 255.255.255.0").cidr, "192.168.1.0/24");
  assert.equal(parseSubnet("192.168.1.0 / 24").cidr, "192.168.1.0/24");
  assert.equal(parseSubnet("10.0.0.0/255.0.0.0").cidr, "10.0.0.0/8");
  assert.equal(parseSubnet("172.16.4.0/255.255.252.0").cidr, "172.16.4.0/22");
  assert.equal(parseSubnet("10.1.2.3/255.255.255.255").cidr, "10.1.2.3/32");
  assert.match(parseSubnet("192.168.1.0/255.0.255.0").error, /maschera/);
  assert.match(parseSubnet("192.168.1.0/255.255.255.256").error, /maschera/);
  assert.equal(maskToPrefix("255.255.255.128"), 25);
  assert.equal(maskToPrefix("0.0.0.0"), 0);
  assert.equal(maskToPrefix("255.255.0.255"), null);
});

test("una rete che esce dagli indirizzi privati è troppo ampia", () => {
  for (const input of ["10.0.0.0/7", "172.0.0.0/8", "172.16.0.0/11", "192.168.0.0/15", "0.0.0.0/0", "0.0.0.0/0.0.0.0"]) {
    assert.match(parseSubnet(input).error, /troppo ampia/, input);
  }
});

test("si cercano solo reti private", () => {
  for (const input of ["8.8.8.0/24", "172.15.0.0/24", "172.32.0.0/24", "192.169.0.0/24", "169.254.0.0/24", "127.0.0.0/28"]) {
    assert.match(parseSubnet(input).error, /private/, input);
  }
  for (const input of ["10.255.0.0/24", "172.16.0.0/24", "172.31.0.0/24", "192.168.255.0/24"]) {
    assert.ok(parseSubnet(input).cidr, input);
  }
});

test("il loopback vale solo per le prove", () => {
  assert.match(parseSubnet("127.0.0.0/28").error, /private/);
  assert.equal(parseSubnet("127.0.0.0/28", { allowLoopback: true }).cidr, "127.0.0.0/28");
  assert.match(parseSubnet("8.8.8.0/24", { allowLoopback: true }).error, /private/);
});

test("rete e broadcast non si provano", () => {
  const list = subnetAddresses(parseSubnet("192.168.1.0/24"));
  assert.equal(list.length, 254);
  assert.equal(list[0], "192.168.1.1");
  assert.equal(list.at(-1), "192.168.1.254");
  assert.equal(subnetAddresses(parseSubnet("10.0.0.0/22")).length, 1022);
  assert.deepEqual(subnetAddresses(parseSubnet("10.0.0.4/30")), ["10.0.0.5", "10.0.0.6"]);
  assert.deepEqual(subnetAddresses(parseSubnet("10.0.0.4/31")), ["10.0.0.4", "10.0.0.5"]);
  assert.deepEqual(subnetAddresses(parseSubnet("10.0.0.4/32")), ["10.0.0.4"]);
});

test("gli indirizzi di una rete grande non si costruiscono tutti", () => {
  const list = addressList(parseSubnet("10.0.0.0/8"));
  assert.equal(list.length, 16_777_214);
  assert.equal(list.at(0), "10.0.0.1");
  assert.equal(list.at(255), "10.0.1.0");
  assert.equal(list.at(list.length - 1), "10.255.255.254");
  assert.equal(list.at(list.length), undefined);
  assert.equal(list.at(-1), undefined);
});

test("la stima della durata cresce con la rete", () => {
  assert.equal(scanConcurrency(254), 24);
  assert.equal(scanConcurrency(65_534), 48);
  assert.ok(scanSeconds(254) < 15);
  assert.ok(scanSeconds(1022) < 60);
  const slash16 = scanSeconds(65_534);
  assert.ok(slash16 > 20 * 60 && slash16 < 40 * 60, String(slash16));
  assert.ok(scanSeconds(16_777_214) > 2 * 86_400);
  // Ciò che resta usa le corsie della rete intera
  assert.equal(scanSeconds(480, 65_534), 10 * 1.05);
});

test("si tiene solo chi ha risposto, con il suo MAC", () => {
  const neighbours = parseNeighbours(
    [
      "192.168.1.1 dev eth0 lladdr aa:bb:cc:dd:ee:01 REACHABLE",
      "192.168.1.3 dev eth0 lladdr aa:bb:cc:dd:ee:03 STALE",
      "192.168.1.4 dev eth0 lladdr aa:bb:cc:dd:ee:04 PROBE",
      "192.168.1.5 dev eth0  FAILED",
    ].join("\n"),
  );
  const probed = [
    { address: "192.168.1.1", rtt: 0.4, ports: [] },
    { address: "192.168.1.2", rtt: null, ports: [80] },
    { address: "192.168.1.3", rtt: null, ports: [] },
    { address: "192.168.1.4", rtt: null, ports: [] },
    { address: "192.168.1.5", rtt: null, ports: [] },
    { address: "192.168.1.6", rtt: null, ports: [] },
  ];
  assert.deepEqual(answered(probed, neighbours), [
    { address: "192.168.1.1", rtt: 0.4, ports: [], mac: "aa:bb:cc:dd:ee:01" },
    { address: "192.168.1.2", rtt: null, ports: [80], mac: null },
    { address: "192.168.1.3", rtt: null, ports: [], mac: "aa:bb:cc:dd:ee:03" },
  ]);
});

test("la sottorete proposta è quella della scheda vera", () => {
  const card = (cidr, internal = false) => ({ family: "IPv4", cidr, internal });
  assert.equal(
    defaultSubnet({
      lo: [card("127.0.0.1/8", true)],
      docker0: [card("172.17.0.1/16")],
      ens33: [{ family: "IPv6", cidr: "fe80::1/64", internal: false }, card("192.168.1.179/24")],
    }),
    "192.168.1.0/24",
  );
  assert.equal(defaultSubnet({ eth0: [card("10.8.1.5/16")] }), "10.8.0.0/22");
  assert.equal(defaultSubnet({ eth0: [card("8.8.8.8/24")] }), "");
  assert.equal(defaultSubnet({}), "");
});

test("la tabella dei vicini si legge con il MAC e lo stato", () => {
  const out = `192.168.1.254 dev ens33 lladdr 00:1a:2b:3c:4d:5e REACHABLE
192.168.1.20 dev ens33 lladdr aa:bb:cc:dd:ee:ff STALE
192.168.1.21 dev ens33  FAILED
192.168.1.22 dev ens33 INCOMPLETE
192.168.1.23 dev ens33 lladdr 11:22:33:44:55:66 router DELAY`;
  const map = parseNeighbours(out);
  assert.equal(map.size, 3);
  assert.deepEqual(map.get("192.168.1.254"), { mac: "00:1a:2b:3c:4d:5e", state: "REACHABLE" });
  assert.equal(map.get("192.168.1.23").state, "DELAY");
  assert.equal(neighbourAnswered(map.get("192.168.1.254")), true);
  assert.equal(neighbourAnswered(map.get("192.168.1.20")), true);
  assert.equal(neighbourAnswered(map.get("192.168.1.23")), false);
  assert.equal(neighbourAnswered(map.get("192.168.1.21")), false);
});

test("il produttore si trova dal MAC, solo per quelli richiesti", () => {
  const text = `OUI/MA-L\t\tOrganization
10-E9-92   (hex)\t\tINGRAM MICRO SERVICES
10E992     (base 16)\t\tINGRAM MICRO SERVICES
00-1A-2B   (hex)\t\tAyecom Technology Co., Ltd.
AA-BB-CC   (hex)\t\tAltro`;
  const vendors = parseVendors(text, ["10:e9:92:01:02:03", "00:1a:2b:3c:4d:5e"]);
  assert.equal(vendors.size, 2);
  assert.equal(vendorOf(vendors, "10:e9:92:ff:ff:ff"), "INGRAM MICRO SERVICES");
  assert.equal(vendorOf(vendors, "aa:bb:cc:00:00:00"), null);
  assert.equal(vendorOf(vendors, null), null);
});

test("il tipo si stima da porte e produttore", () => {
  assert.equal(guessType([9100], null), "stampante");
  assert.equal(guessType([80], "Kyocera Display Corporation"), "stampante");
  assert.equal(guessType([554, 80], null), "telecamera");
  assert.equal(guessType([443], "Synology Incorporated"), "storage");
  assert.equal(guessType([80], "Siemens AG"), "macchina");
  assert.equal(guessType([22, 443], "Cisco Systems, Inc"), "switch");
  assert.equal(guessType([445, 3389], null), "pc");
  assert.equal(guessType([22], null), "server");
  assert.equal(guessType([80], null), "altro");
  assert.equal(guessType([], null), "altro");
});

test("il nome DNS si accorcia e si scarta se non è un nome", () => {
  assert.equal(shortName("server1.azienda.local."), "server1");
  assert.equal(shortName("stampante-2"), "stampante-2");
  assert.equal(shortName("<script>.evil"), null);
  assert.equal(shortName(""), null);
  assert.equal(shortName(null), null);
  assert.equal(shortName("a".repeat(120)).length, 80);
});
