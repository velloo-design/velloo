import type { ComponentRegistry } from "@velloo/provider";
import { registry as snapshotRegistry } from "@velloo/shadcn-snapshot";
import { Box, Button, Card, Container, Input, Stack } from "./components.tsx";

/**
 * Components from `@velloo/shadcn-snapshot` that are framework-neutral
 * (no portals, no providers, no shadcn idioms) and useful in no-lib
 * designs. Reused verbatim instead of forking — these helpers haven't
 * needed to change in a year.
 */
const REUSED_HELPER_IDS = [
  "Heading",
  "Text",
  "Icon",
  "SVG",
  "Image",
  "Layer",
  "Divider",
  "Gradient",
  "Placeholder",
] as const;

function reusedHelpers(): ComponentRegistry {
  const out: ComponentRegistry = {};
  for (const id of REUSED_HELPER_IDS) {
    const component = snapshotRegistry[id];
    if (component) out[id] = component;
  }
  return out;
}

/**
 * The no-library provider's runtime registry. Five bare primitives
 * (`Box`, `Stack`, `Container`, `Card`, `Button`, `Input`) plus the
 * reusable velloo helpers from the shadcn snapshot. No `Avatar`,
 * `Tabs`, `Dialog`, etc. — those would require either a real component
 * library or a custom implementation; users in this mode either don't
 * need them or write them as snippets.
 */
export const registry: ComponentRegistry = {
  Box,
  Stack,
  Container,
  Card,
  Button,
  Input,
  ...reusedHelpers(),
};

export function isKnownComponent(ref: string): boolean {
  return ref in registry;
}
