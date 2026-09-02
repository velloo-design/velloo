import { helpersRegistry } from "@velloo/helpers";
import type { ComponentRegistry } from "@velloo/provider";
import { Box, Button, Card, Container, Heading, Input, Stack, Text } from "./components-inline.tsx";

/**
 * The no-library registry for a `none`-CSS folder (inline `style` channel). Same
 * shape as the Tailwind `registry`, but the primitives + typography are the
 * inline-styled variants so they paint with the JIT off. The remaining helpers
 * are structural (an SVG, an image, a gradient layer) — they carry no Tailwind
 * visual defaults that the inline channel would lose — so they're reused
 * verbatim from `@velloo/helpers`, same as the Tailwind registry. `Prose` joins
 * them: its `typeset` class is velloo-owned CSS that `themeToCss` ships on every
 * channel, not a Tailwind utility, so it needs no inline variant.
 */
const REUSED_HELPER_IDS = [
  "Prose",
  "Icon",
  "SVG",
  "Image",
  "Layer",
  "Divider",
  "Gradient",
  "Placeholder",
];

export const inlineRegistry: ComponentRegistry = {
  Box,
  Stack,
  Container,
  Card,
  Button,
  Input,
  Heading,
  Text,
  ...helpersRegistry(REUSED_HELPER_IDS),
};
