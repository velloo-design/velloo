import { afterEach, beforeEach, expect, test } from "bun:test";
import type { ComponentDescriptor } from "@velloo/provider";
import type { Screen } from "@velloo/schema";
import { $, domSuite, mount, settle } from "./dom.ts";
import { type FakeServer, serveFolder } from "./fake-server.ts";

/**
 * The fidelity chip on a library's OWN components, not only the app's: a
 * folder whose adapter has no browser bundle must show that its components
 * are server-rendered, and a multi-library folder must ask about the library
 * the selected screen actually renders with.
 */

const { Inspector } = await import("../components/Inspector.tsx");
const { LibraryDetail } = await import("../components/LibraryDetail.tsx");
const { useCanvas } = await import("../store.ts");
const { libraryStatusKey } = await import("../store/fidelity.ts");

const button: ComponentDescriptor = {
  id: "Button",
  category: "ui",
  source: "velloo",
  props: [],
} as ComponentDescriptor;

let server: FakeServer;

beforeEach(() => {
  server = serveFolder({ boards: { main: ["home", "promo"] } });
  server.manifest = [button];
  const promo = server.design.screens.find((s) => s.id === "promo");
  if (promo) promo.library = "marketing";
  useCanvas.getState().resetLibraryStatus();
  useCanvas.setState({
    design: server.design,
    components: null,
    componentsLoading: false,
    selection: null,
    libraryItem: null,
    screens: {},
  });
});

afterEach(() => {
  server.restore();
});

function selectButton(screenId = "home") {
  const screen = {
    id: screenId,
    name: screenId,
    tree: { $ref: "Button", props: {} },
  } as unknown as Screen;
  useCanvas.setState({
    screens: { [screenId]: screen },
    selection: { screenId, path: "" },
  });
}

domSuite("Library component fidelity", () => {
  test("the inspector says a component is server-rendered when that is what happens", async () => {
    server.libraryStatus = {
      ui: {
        Button: {
          id: "Button",
          status: "server-rendered",
          note: "There is no component library behind it.",
        },
      },
    };
    selectButton();
    const view = await mount(<Inspector />);
    try {
      await settle(300);
      expect($("[data-fidelity]")?.dataset.fidelity).toBe("server-rendered");
    } finally {
      await view.unmount();
    }
  });

  test("an unestablished fidelity shows as unchecked rather than nothing", async () => {
    server.libraryStatus = { ui: { Button: { id: "Button", status: "unchecked" } } };
    const view = await mount(
      <LibraryDetail item={{ kind: "component", id: "Button" }} snippets={[]} />,
    );
    try {
      await settle(300);
      expect($("[data-fidelity]")?.dataset.fidelity).toBe("unchecked");
    } finally {
      await view.unmount();
    }
  });

  test("an exact verdict nothing has mounted yet stays quiet", async () => {
    server.libraryStatus = { ui: { Button: { id: "Button", status: "exact" } } };
    selectButton();
    const view = await mount(<Inspector />);
    try {
      await settle(300);
      expect($("[data-fidelity]")).toBeNull();
    } finally {
      await view.unmount();
    }
  });

  test("a screen on a second library asks about that library's Button, not the default's", async () => {
    server.libraryStatus = {
      ui: { Button: { id: "Button", status: "server-rendered" } },
      marketing: { Button: { id: "Button", status: "unchecked" } },
    };
    selectButton("promo");
    const view = await mount(<Inspector />);
    try {
      await settle(300);
      expect(server.calls).toContain("/api/components/status?ids=Button&library=marketing");
      expect($("[data-fidelity]")?.dataset.fidelity).toBe("unchecked");
      const status = useCanvas.getState().libraryStatus;
      expect(status[libraryStatusKey("marketing", "Button")]?.status).toBe("unchecked");
      expect(status[libraryStatusKey("ui", "Button")]).toBeUndefined();
    } finally {
      await view.unmount();
    }
  });
});

domSuite("Library fidelity cache", () => {
  const key = () => libraryStatusKey("ui", "Button");
  const asks = () => server.calls.filter((c) => c.startsWith("/api/components/status")).length;

  test("a reset while an ask is in flight leaves nothing stuck, and the stale answer lands nowhere", async () => {
    server.libraryStatus = { ui: { Button: { id: "Button", status: "server-rendered" } } };
    const inner = globalThis.fetch;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
      await gate;
      return inner(...args);
    }) as typeof fetch;
    const stale = useCanvas.getState().loadLibraryStatus("ui", ["Button"]);
    useCanvas.getState().resetLibraryStatus();
    globalThis.fetch = inner;

    server.libraryStatus = { ui: { Button: { id: "Button", status: "unchecked" } } };
    await useCanvas.getState().loadLibraryStatus("ui", ["Button"]);
    expect(useCanvas.getState().libraryStatus[key()]?.status).toBe("unchecked");

    // The gated ask reaches the daemon only now, so it answers differently.
    server.libraryStatus = { ui: { Button: { id: "Button", status: "fallback" } } };
    release();
    await stale;
    expect(useCanvas.getState().libraryStatus[key()]?.status).toBe("unchecked");

    useCanvas.getState().resetLibraryStatus();
    const before = asks();
    await useCanvas.getState().loadLibraryStatus("ui", ["Button"]);
    expect(asks()).toBe(before + 1);
    expect(useCanvas.getState().libraryStatus[key()]).not.toBeUndefined();
  });

  test("a known verdict is not asked for again until a reset", async () => {
    server.libraryStatus = { ui: { Button: { id: "Button", status: "server-rendered" } } };
    await useCanvas.getState().loadLibraryStatus("ui", ["Button"]);
    const before = asks();
    await useCanvas.getState().loadLibraryStatus("ui", ["Button"]);
    expect(asks()).toBe(before);
    useCanvas.getState().resetLibraryStatus();
    expect(useCanvas.getState().libraryStatus).toEqual({});
  });
});
