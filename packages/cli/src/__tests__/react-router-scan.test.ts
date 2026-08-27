import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanAppRoutes } from "../scan/routes.ts";

let tmp: string;

beforeEach(async () => {
  tmp = join(tmpdir(), `velloo-rr-scan-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(join(tmp, "src"), { recursive: true });
  await writeFile(
    join(tmp, "package.json"),
    JSON.stringify({
      dependencies: { react: "19.2.6", "react-router-dom": "7.1.0", vite: "6.0.0" },
    }),
  );
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("react-router scan", () => {
  test("parses a createBrowserRouter object tree instead of walking src/pages/", async () => {
    // src/pages/ holds components that are NOT routes — the router config is
    // the source of truth (this mirrors the chainlit frontend layout).
    await mkdir(join(tmp, "src", "pages"), { recursive: true });
    for (const f of ["Home", "Thread", "PageLayout", "ResumeButton", "UnarchiveButton"]) {
      await writeFile(join(tmp, "src", "pages", `${f}.tsx`), "export default () => null;");
    }
    await writeFile(
      join(tmp, "src", "router.tsx"),
      `
import { Navigate, Outlet, createBrowserRouter } from 'react-router-dom';
const Home = () => null;
function RootLayout() {
  return (<><Outlet /></>);
}
export const router = createBrowserRouter(
  [
    {
      element: <RootLayout />,
      children: [
        {
          element: <PageLayout />,
          children: [
            { path: '/', element: <Home /> },
            { path: '/thread/:id?', element: <Thread /> },
            { path: '/element/:id', element: <Element /> }
          ]
        },
        { path: '/login', element: <Login /> },
        { path: '/login/callback', element: <AuthCallback /> },
        { path: '*', element: <Navigate replace to="/" /> }
      ]
    }
  ],
  { basename: getRouterBasename() }
);
`,
    );

    const { framework, routes } = await scanAppRoutes(tmp);
    expect(framework).toBe("react-router");
    expect(routes.map((r) => r.routePath)).toEqual([
      "/",
      "/element/[id]",
      "/login",
      "/login/callback",
      "/thread/[id]",
    ]);
    const ids = routes.map((r) => r.id);
    expect(ids).not.toContain("resumebutton");
    expect(ids).not.toContain("pagelayout");
  });

  test("parses <Route> JSX trees with nested relative paths", async () => {
    await writeFile(
      join(tmp, "src", "App.tsx"),
      `
import { Routes, Route, Navigate } from 'react-router-dom';
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout onReady={() => track()}> }>
        <Route index element={<Dashboard />} />
        <Route path="settings" element={<Settings />}>
          <Route path="profile" element={<Profile />} />
        </Route>
        <Route path="users/:userId" element={<User />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Route>
    </Routes>
  );
}
`,
    );

    const { framework, routes } = await scanAppRoutes(tmp);
    expect(framework).toBe("react-router");
    expect(routes.map((r) => r.routePath)).toEqual([
      "/",
      "/settings",
      "/settings/profile",
      "/users/[userId]",
    ]);
  });

  test("falls back to the generic pages walk when no router config parses", async () => {
    await mkdir(join(tmp, "src", "pages"), { recursive: true });
    await writeFile(join(tmp, "src", "pages", "about.tsx"), "export default () => null;");

    const { framework, routes } = await scanAppRoutes(tmp);
    expect(framework).toBe("react-router");
    expect(routes.map((r) => r.routePath)).toEqual(["/about"]);
  });

  test("skips test/story files when hunting for route configs", async () => {
    await mkdir(join(tmp, "src", "stories"), { recursive: true });
    await writeFile(
      join(tmp, "src", "stories", "nav.stories.tsx"),
      `<Routes><Route path="/story-only" element={<X />} /></Routes>`,
    );
    await writeFile(
      join(tmp, "src", "main.tsx"),
      `createBrowserRouter([{ path: '/real', element: <Real /> }])`,
    );

    const { routes } = await scanAppRoutes(tmp);
    expect(routes.map((r) => r.routePath)).toEqual(["/real"]);
  });
});
