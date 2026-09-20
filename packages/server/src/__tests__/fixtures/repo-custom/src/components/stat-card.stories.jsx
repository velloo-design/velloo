import { StatCard } from "./stat-card";

const meta = {
  component: StatCard,
  args: { label: "Revenue" },
};
export default meta;

export const Positive = { args: { value: "$12k", tone: "positive" } };
export const WithHandler = { args: { value: "3", onSelect: () => {} } };
