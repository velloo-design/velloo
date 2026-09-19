import { Badge, Panel, StatCard } from "./components";
import { Broken } from "./components/broken";
import Hero from "./components/hero";
import { ThemedButton } from "./components/theme";
import { renderReport } from "./server/report";

export function App() {
  return (
    <main>
      <Hero title="Operations" />
      <StatCard label="Uptime" value="99.9%" tone="positive" />
      <Panel>
        <Panel.Header title="Services" />
        <Badge variant="outline">Healthy</Badge>
      </Panel>
      <ThemedButton>Deploy</ThemedButton>
      <Broken />
      {String(renderReport)}
    </main>
  );
}
