import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./styles.css";

// `velloo init`'s setup page: served by the init server before any design
// exists, so it never mounts the canvas or opens its socket.
const InitWizard = lazy(() =>
  import("./init/InitWizard.tsx").then((m) => ({ default: m.InitWizard })),
);

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("missing #root");

createRoot(rootEl).render(
  <StrictMode>
    {window.location.pathname === "/init" ? (
      <Suspense>
        <InitWizard />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
);
