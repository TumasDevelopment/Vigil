import { TopologyMap, type TopologyLone, type TopologyNode } from "@/components/TopologyMap";
import { requireUser } from "@/lib/auth";
import { getHostSummaries } from "@/lib/queries";
import { layoutTree } from "@/lib/tree.mjs";

export const metadata = { title: "Topologia · Vigil" };
export const dynamic = "force-dynamic";

interface Placed {
  id: number;
  depth: number;
  row: number;
  children: number;
}

export default async function TopologyPage() {
  const user = await requireUser();
  const hosts = await getHostSummaries(user);
  const layout = layoutTree(hosts.map((host) => ({ id: host.id, parentId: host.parentId, name: host.name }))) as {
    nodes: Map<number, Placed>;
    edges: { from: number; to: number }[];
    rows: number;
    depth: number;
    alone: number[];
  };

  const nodes: TopologyNode[] = [];
  const lone: TopologyLone[] = [];
  const alone = new Set(layout.alone);
  // Le linee vere sono quelle della disposizione: un giro spezzato lascia parentId ma non la linea
  const parentOf = new Map(layout.edges.map((edge) => [edge.to, edge.from]));
  for (const host of hosts) {
    const placed = layout.nodes.get(host.id);
    if (placed) {
      nodes.push({
        id: host.id,
        name: host.name,
        address: host.address,
        status: host.status,
        parentId: parentOf.get(host.id) ?? null,
        depth: placed.depth,
        row: placed.row,
        children: placed.children,
      });
    } else if (alone.has(host.id)) {
      lone.push({ id: host.id, name: host.name, address: host.address, status: host.status });
    }
  }
  lone.sort((a, b) => a.name.localeCompare(b.name, "it"));

  return <TopologyMap nodes={nodes} lone={lone} rows={layout.rows} depth={layout.depth} />;
}
