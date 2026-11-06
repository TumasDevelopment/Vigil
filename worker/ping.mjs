import { execFile } from "node:child_process";

export const PACKETS_PER_CHECK = 3;

/** Legge il riepilogo di iputils-ping. Restituisce null se l'output non è riconoscibile. */
export function parsePing(stdout) {
  const counts = /(\d+) packets transmitted, (\d+) (?:packets )?received/.exec(stdout);
  if (!counts) return null;

  const rtt = /=\s*([\d.]+)\/([\d.]+)\/([\d.]+)\/[\d.]+\s*ms/.exec(stdout);
  return {
    sent: Number(counts[1]),
    received: Number(counts[2]),
    rttMin: rtt ? Number(rtt[1]) : null,
    rttAvg: rtt ? Number(rtt[2]) : null,
    rttMax: rtt ? Number(rtt[3]) : null,
  };
}

/**
 * Pinga un host. Non fallisce mai: host irraggiungibili, DNS errato o timeout
 * risultano come 0 pacchetti ricevuti. execFile non passa dalla shell, e "--"
 * impedisce che l'indirizzo venga letto come opzione di ping.
 */
export function pingHost(address) {
  return new Promise((resolve) => {
    execFile(
      "ping",
      ["-n", "-q", "-c", String(PACKETS_PER_CHECK), "-i", "0.2", "-W", "1", "--", address],
      { timeout: 6000, killSignal: "SIGKILL", env: { ...process.env, LC_ALL: "C" } },
      (_error, stdout) => {
        resolve(
          parsePing(stdout ?? "") ?? {
            sent: PACKETS_PER_CHECK,
            received: 0,
            rttMin: null,
            rttAvg: null,
            rttMax: null,
          },
        );
      },
    );
  });
}
