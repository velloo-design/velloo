/**
 * Seed a board of deliberately broken screens, for exercising the render
 * guard, the mutation diagnostics, and the export/publish pre-flight.
 *
 * Drives the real MCP surface (`velloo mcp` over stdio) rather than writing
 * screen JSON, because a screen tree only changes through the mutation layer —
 * writing the files directly would skip the locks and the watcher.
 *
 * Usage: bun scripts/seed-render-errors.ts [folder]
 */

interface Rpc {
  jsonrpc: "2.0";
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
}

const folder = process.argv[2] ?? `${import.meta.dir}/../velloo`;

// The default "guided" surface hides the native mutation tools behind a
// façade; seeding wants them directly.
const child = Bun.spawn(
  ["bun", `${import.meta.dir}/../packages/cli/src/cli.ts`, "mcp", folder, "--surface", "full"],
  {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "inherit",
  },
);

const pending = new Map<number, (rpc: Rpc) => void>();
let nextId = 1;

void (async () => {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of child.stdout) {
    buffer += decoder.decode(chunk, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) {
        const rpc = JSON.parse(line) as Rpc;
        if (typeof rpc.id === "number") pending.get(rpc.id)?.(rpc);
      }
      newline = buffer.indexOf("\n");
    }
  }
})();

function send(method: string, params: unknown): Promise<Rpc> {
  const id = nextId++;
  const promise = new Promise<Rpc>((resolve) => pending.set(id, resolve));
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  return promise;
}

function notify(method: string, params: unknown): void {
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
}

async function call(name: string, args: unknown): Promise<string> {
  const rpc = await send("tools/call", { name, arguments: args });
  if (rpc.error) throw new Error(`${name}: ${rpc.error.message}`);
  const result = rpc.result as { isError?: boolean; content?: { text?: string }[] };
  const text = result.content?.[0]?.text ?? "";
  if (result.isError) throw new Error(`${name}: ${text}`);
  return text;
}

const box = (className: string, children: unknown[]) => ({
  $ref: "Box",
  props: { className },
  children,
});
const heading = (children: string) => ({ $ref: "Heading", props: { level: 2, children } });
const text = (children: string) => ({ $ref: "Text", props: { children } });

/** Nesting mistakes: the component reads a context no ancestor provides. */
const orphan = (ref: string, props: Record<string, unknown> = {}) => ({ $ref: ref, props });

const screens = [
  {
    id: "err-control",
    name: "Control — nothing broken",
    note: "renders clean; the baseline to compare the others against",
    tree: box("p-8 flex flex-col gap-4", [
      heading("Everything renders"),
      text(
        "No component on this screen throws. Use it to tell a real failure from a styling problem.",
      ),
      { $ref: "Button", props: { children: "A button" } },
      { $ref: "Badge", props: { variant: "secondary", children: "healthy" } },
    ]),
  },
  {
    id: "err-one-node",
    name: "One bad node",
    note: "siblings on both sides must still render — this is the containment case",
    tree: box("p-8 flex flex-col gap-4", [
      heading("One broken component"),
      text("The heading above and the button below must both survive it."),
      orphan("TabsTrigger", { value: "overview", children: "Overview" }),
      { $ref: "Button", props: { children: "Still here" } },
    ]),
  },
  {
    id: "err-bad-props",
    name: "Bad props, not nesting",
    note: "contained, but the message names no parent — the fix is the prop",
    tree: box("p-8 flex flex-col gap-4", [
      heading("Broken by its own props"),
      text("Icon with no name. Nothing to do with nesting, so the message names no parent."),
      { $ref: "Icon", props: {} },
      { $ref: "Button", props: { children: "Still here" } },
    ]),
  },
  {
    id: "err-uncontained",
    name: "Uncontained — the guard cannot pin it",
    note: "throws inside a library internal, so no stand-in: the whole screen 500s",
    tree: box("p-8 flex flex-col gap-4", [
      heading("Nothing renders here"),
      text("Slider throws deep inside Radix, where no stack frame carries a registry name."),
      { $ref: "Slider", props: { value: 50 } },
      { $ref: "Button", props: { children: "Not reached" } },
    ]),
  },
  {
    id: "err-several",
    name: "Several broken families",
    note: "four distinct components, four separate stand-ins and diagnostics",
    tree: box("p-8 flex flex-col gap-4", [
      heading("Four at once"),
      orphan("TabsTrigger", { value: "one", children: "Tabs" }),
      orphan("AccordionItem", { value: "one" }),
      orphan("AvatarImage", { src: "/assets/none.png", alt: "avatar" }),
      orphan("PopoverTrigger", { children: "Popover" }),
      text("Each one is replaced independently; the screen still renders."),
    ]),
  },
  {
    id: "err-guard-limit",
    name: "Past the stand-in ceiling",
    note: "9 individually-containable failures, one over the cap, so the screen fails anyway",
    // Every one of these is a component the guard *can* pin on its own. Nine of
    // them is one past MAX_STAND_INS, which is the whole point of the screen.
    tree: box("p-8 flex flex-col gap-3", [
      heading("Too many to contain"),
      orphan("TabsTrigger", { value: "a", children: "a" }),
      orphan("TabsList"),
      orphan("TabsContent", { value: "a" }),
      orphan("AccordionItem", { value: "a" }),
      orphan("AccordionContent"),
      orphan("AvatarImage", { src: "/assets/none.png", alt: "a" }),
      orphan("AvatarFallback", { children: "AB" }),
      orphan("PopoverTrigger", { children: "b" }),
      orphan("PopoverAnchor"),
    ]),
  },
];

const init = await send("initialize", {
  protocolVersion: "2024-11-05",
  capabilities: {},
  clientInfo: { name: "seed-render-errors", version: "1.0.0" },
});
if (init.error) throw new Error(`initialize: ${init.error.message}`);
notify("notifications/initialized", {});

const boardId = "render-errors";
console.log(`Seeding "${boardId}" into ${folder}\n`);

// Rebuild rather than append, so re-running after an edit leaves one board.
for (const screen of screens) await call("remove_screen", { screenId: screen.id }).catch(() => {});
await call("remove_board", { boardId }).catch(() => {});

await call("add_board", { name: "Render errors", id: boardId }).then(
  () => console.log(`  board  ${boardId}`),
  (error: Error) => console.log(`  board  ${boardId} (${error.message.split("\n")[0]})`),
);

let x = 0;
for (const screen of screens) {
  await call("add_screen", { name: screen.name, id: screen.id, tree: screen.tree }).then(
    () => console.log(`  screen ${screen.id.padEnd(16)} ${screen.note}`),
    (error: Error) =>
      console.log(`  screen ${screen.id.padEnd(16)} SKIPPED — ${error.message.split("\n")[0]}`),
  );
  await call("add_frame", {
    boardId,
    screenId: screen.id,
    x,
    y: 0,
    w: 720,
    h: 520,
    label: screen.name,
  }).catch(() => {});
  x += 800;
}

child.stdin.end();
child.kill();
console.log(`\nOpen the board to see them: the daemon is already serving this folder.`);
