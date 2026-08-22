import type { ComponentRegistry } from "@velloo/provider";
import { registry as snapshotRegistry } from "@velloo/shadcn-snapshot";
import { Box, Button, Card, Container, Heading, Input, Stack, Text } from "./components-inline.tsx";

/**
 * The no-library registry for a `none`-CSS folder (inline `style` channel). Same
 * shape as the Tailwind `registry`, but the primitives + typography are the
 * inline-styled variants so they paint with the JIT off. The remaining helpers
 * are structural (an SVG, an image, a gradient layer) — they carry no Tailwind
 * visual defaults that the inline channel would lose — so they're reused
 * verbatim from the snapshot, same as the Tailwind registry.
 */
const REUSED_HELPER_IDS = ["Icon", "SVG", "Image", "Layer", "Divider", "Gradient", "Placeholder"];

function reusedHelpers(): ComponentRegistry {
  const out: ComponentRegistry = {};
  for (const id of REUSED_HELPER_IDS) {
    const component = snapshotRegistry[id];
    if (component) out[id] = component;
  }
  return out;
}

export const inlineRegistry: ComponentRegistry = {
  Box,
  Stack,
  Container,
  Card,
  Button,
  Input,
  Heading,
  Text,
  ...reusedHelpers(),
};
