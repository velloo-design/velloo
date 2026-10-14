import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

/**
 * Call an operation through the guided façade the way an agent does: through
 * whichever of `read_velloo` / `call_velloo` lists it. Read from the client's
 * own tool listing, so a test asks the same question a client would.
 */
export async function facadeCaller(client: Client) {
  const { tools } = await client.listTools();
  const reads = new Set(
    (
      tools.find((tool) => tool.name === "read_velloo")?.inputSchema as
        | { properties?: { operation?: { enum?: string[] } } }
        | undefined
    )?.properties?.operation?.enum ?? [],
  );
  return (operation: string, args: Record<string, unknown> = {}) =>
    client.callTool({
      name: reads.has(operation) ? "read_velloo" : "call_velloo",
      arguments: { operation, arguments: args },
    });
}
