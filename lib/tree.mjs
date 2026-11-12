// Disposizione della mappa della topologia: da sinistra a destra, la profondità è la colonna,
// ogni foglia ha la sua riga e un genitore sta a metà tra il primo e l'ultimo figlio.

/**
 * `hosts`: [{ id, parentId, name }]. Un genitore che non c'è (eliminato, o non visibile
 * all'utente) rende l'host una radice. I cicli si spezzano: chi chiude il giro diventa radice.
 */
export function layoutTree(hosts) {
  const byId = new Map(hosts.map((host) => [host.id, host]));
  const children = new Map(hosts.map((host) => [host.id, []]));
  const roots = [];
  const sortByName = (a, b) => String(a.name ?? "").localeCompare(String(b.name ?? ""), "it") || a.id - b.id;

  for (const host of hosts) {
    if (host.parentId !== null && host.parentId !== undefined && byId.has(host.parentId) && !closesLoop(host, byId)) {
      children.get(host.parentId).push(host);
    } else roots.push(host);
  }
  for (const list of children.values()) list.sort(sortByName);
  roots.sort((a, b) => children.get(b.id).length - children.get(a.id).length || sortByName(a, b));

  const nodes = new Map();
  const edges = [];
  let nextRow = 0;
  let depthMax = 0;

  function place(host, depth) {
    depthMax = Math.max(depthMax, depth);
    const kids = children.get(host.id);
    let row;
    if (kids.length === 0) row = nextRow++;
    else {
      const rows = kids.map((child) => {
        edges.push({ from: host.id, to: child.id });
        return place(child, depth + 1);
      });
      row = (rows[0] + rows[rows.length - 1]) / 2;
    }
    nodes.set(host.id, { id: host.id, depth, row, children: kids.length });
    return row;
  }

  // Gli host isolati (senza genitore né figli) vanno in fondo, in una griglia a parte
  const linked = roots.filter((root) => children.get(root.id).length > 0);
  const alone = roots.filter((root) => children.get(root.id).length === 0);
  for (const root of linked) place(root, 0);
  return { nodes, edges, rows: nextRow, depth: linked.length > 0 ? depthMax + 1 : 0, alone: alone.map((host) => host.id) };
}

function closesLoop(host, byId) {
  const seen = new Set([host.id]);
  let current = byId.get(host.parentId);
  while (current) {
    // Tornare all'host vuol dire che è dentro un giro; un giro più in alto lo spezza un altro
    if (current.id === host.id) return true;
    if (seen.has(current.id)) return false;
    seen.add(current.id);
    current = current.parentId === null || current.parentId === undefined ? undefined : byId.get(current.parentId);
  }
  return false;
}

/** Il percorso dall'host alla radice: serve a evidenziare la catena di un guasto. */
export function pathToRoot(id, parents) {
  const path = [];
  const seen = new Set();
  let current = id;
  while (current !== null && current !== undefined && !seen.has(current)) {
    path.push(current);
    seen.add(current);
    current = parents.get(current) ?? null;
  }
  return path;
}
