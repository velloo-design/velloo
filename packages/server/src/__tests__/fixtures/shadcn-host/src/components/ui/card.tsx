import type { HTMLAttributes } from "react";

export function Card(props: HTMLAttributes<HTMLDivElement>) {
  return <section {...props} data-host-card="true" />;
}

export function CardHeader(props: HTMLAttributes<HTMLDivElement>) {
  return <header {...props} data-host-card-header="true" />;
}

export function CardTitle(props: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 {...props} data-host-card-title="true" />;
}

export function CardContent(props: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} data-host-card-content="true" />;
}
