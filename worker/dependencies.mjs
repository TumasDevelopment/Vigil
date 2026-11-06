// Chi è appena ripartito ha i servizi ancora in avvio e chi gli sta dietro ci mette un po' a tornare
export const HOST_SETTLE_MS = 120_000;

/**
 * Cosa dice lo stato di un host su chi dipende da lui.
 * "down": sta cadendo, è caduto o è appena tornato, quindi spiega i guasti a valle.
 * "unknown": in pausa o senza dati, non dice nulla.
 *
 * @param {{status?:string,since?:Date|null,failStreak?:number}|undefined} host
 * @param {Date} now
 */
export function hostHealth(host, now) {
  if (!host?.status) return "unknown";
  if (host.status === "offline" || host.failStreak > 0) return "down";
  if (host.status !== "online") return "unknown";
  return now.getTime() - new Date(host.since).getTime() < HOST_SETTLE_MS ? "down" : "healthy";
}

/**
 * Il dispositivo a monte che spiega il guasto di `id`, oppure null se il guasto è suo.
 * Risale la catena e restituisce il più alto ancora giù: è lì che sta il problema, ed è
 * l'unico che deve avvisare. Un anello sano interrompe la risalita, perché se lui risponde
 * il percorso fino a lì funziona.
 *
 * @param {number} id
 * @param {Map<number,{parentId:number|null,health:string}>} nodes
 */
export function findCause(id, nodes) {
  const seen = new Set([id]);
  let cause = null;
  let current = nodes.get(id)?.parentId ?? null;

  while (current !== null && !seen.has(current)) {
    seen.add(current);
    const node = nodes.get(current);
    if (!node || node.health === "healthy") break;
    if (node.health === "down") cause = current;
    current = node.parentId;
  }
  return cause;
}
