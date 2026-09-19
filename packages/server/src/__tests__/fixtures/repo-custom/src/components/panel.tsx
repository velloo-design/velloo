import type { ReactNode } from "react";

export interface PanelProps {
  children?: ReactNode;
  style?: React.CSSProperties;
}

export interface PanelHeaderProps {
  title: string;
}

function PanelHeader({ title }: PanelHeaderProps) {
  return <h3 style={{ margin: 0 }}>{title}</h3>;
}

export function Panel({ children, style }: PanelProps) {
  return (
    <section className="fx-card" style={style}>
      {children}
    </section>
  );
}
Panel.Header = PanelHeader;
