import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const dynamic = "force-dynamic";

/** Il programma per il PC: non contiene segreti, il token arriva dal comando di installazione. */
export async function GET() {
  const script = await readFile(join(process.cwd(), "deploy", "avvisi-windows.ps1"), "utf8");
  return new Response(script, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}
