import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultSubnet, ipToNumber, numberToIp, parseSubnet, subnetAddresses } from "../lib/subnet.mjs";
import {
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

test("si rifiutano le reti troppo ampie", () => {
  assert.match(parseSubnet("10.0.0.0/21").error, /troppo ampia/);
  assert.match(parseSubnet("10.0.0.0/8").error, /troppo ampia/);
  assert.equal(parseSubnet("10.0.0.0/22").size, 1024);
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
