import "./styles.css";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ThemeProvider } from "./components/theme";

createRoot(document.getElementById("root")).render(
  <ThemeProvider accent="violet">
    <App />
  </ThemeProvider>,
);
