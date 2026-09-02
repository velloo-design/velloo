import type { ComponentRegistry } from "@velloo/provider";
import { Box } from "./box.tsx";
import { Divider } from "./divider.tsx";
import { Gradient } from "./gradient.tsx";
import { Heading } from "./heading.tsx";
import { Icon } from "./icon.tsx";
import { Image } from "./image.tsx";
import { Layer } from "./layer.tsx";
import { Placeholder } from "./placeholder.tsx";
import { Prose } from "./prose.tsx";
import { SVG } from "./svg.tsx";
import { Text } from "./text.tsx";

const ALL: ComponentRegistry = {
  Box,
  Divider,
  Gradient,
  Heading,
  Icon,
  Image,
  Layer,
  Placeholder,
  Prose,
  SVG,
  Text,
};

/**
 * Build a registry subset of the velloo helpers. Each provider passes its own
 * deliberate id list (provider-none reuses nine, its inline channel seven,
 * provider-mui six; the shadcn snapshot takes all ten) — the *mechanism* is
 * shared, the lists are not. Unknown ids are skipped.
 */
export function helpersRegistry(ids: readonly string[]): ComponentRegistry {
  const out: ComponentRegistry = {};
  for (const id of ids) {
    const component = ALL[id];
    if (component) out[id] = component;
  }
  return out;
}
