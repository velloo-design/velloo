import { Badge, EnvBadge, Overlay, Panel, RegionTag, StatCard, Steps } from "./components";
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
        <Badge key="b" variant="outline">
          Healthy
        </Badge>
      </Panel>
      <Steps active={1}>
        <Steps.Step label="Build" />
        <Steps.Step label="Ship" />
      </Steps>
      <EnvBadge />
      <RegionTag />
      <Overlay title="Confirm" />
      <ThemedButton>Deploy</ThemedButton>
      <Broken />
      {String(renderReport)}
    </main>
  );
}
