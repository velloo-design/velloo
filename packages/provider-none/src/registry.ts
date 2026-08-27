import { helpersRegistry } from "@velloo/helpers";
import type { ComponentRegistry } from "@velloo/provider";
import { Box, Button, Card, Container, Input, Stack } from "./components.tsx";

/**
 * Framework-neutral velloo helpers (no portals, no providers, no shadcn
 * idioms) useful in no-lib designs. Reused verbatim from `@velloo/helpers`
 * instead of forking — these helpers haven't needed to change in a year.
 */
export const REUSED_HELPER_IDS = [
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
  ...helpersRegistry(REUSED_HELPER_IDS),
};
