import { STYLE_CHANNELS, type StyleChannel, styleChannelOf } from "@velloo/provider";
import { err, ok, type Result } from "@velloo/result";
import type { Screen } from "@velloo/schema";
import type { MutationContext } from "./context.ts";
import { badRequest, type MutationError } from "./errors.ts";
import { providerForScreen } from "./lookup.ts";

/**
 * The style payload `update_props` accepts on its `style` channel: a className
 * string for Tailwind (shadcn), an object of properties for the `sx` (MUI) and
 * `style` channels. `null` clears the style entirely; object channels merge
 * shallowly, and an inner `null` removes that one key.
 */
export type StylePayload = string | Record<string, unknown> | null;

/** The style channel the screen's active framework adapter routes through. */
export function channelForScreen(ctx: MutationContext, screen: Screen): StyleChannel {
  return styleChannelOf(providerForScreen(ctx, screen), ctx.folder.config.styling?.framework);
}

/**
 * Reject a payload whose shape doesn't fit the channel, naming the shape the
 * channel does want — the agent uses one verb across frameworks, so the error
 * has to teach the difference rather than just fail.
 */
export function validateStylePayload(
  channel: StyleChannel,
  style: StylePayload,
): Result<null, MutationError> {
  if (style === null) return ok(null);
  const wantsString = channel.kind === "tailwind-classname";
  if (wantsString && typeof style !== "string") {
    return err(
      badRequest(
        `\`style\` on the "${channel.kind}" channel expects a className string (got ${typeof style}).`,
      ),
    );
  }
  if (!wantsString && (typeof style !== "object" || Array.isArray(style))) {
    return err(
      badRequest(
        `\`style\` on the "${channel.kind}" channel expects an object of ${channel.prop} properties (got ${Array.isArray(style) ? "array" : typeof style}).`,
      ),
    );
  }
  return ok(null);
}

/**
 * Fold a validated style payload into a node's props, under the channel's own
 * prop. Mutates and returns `props`.
 */
export function applyStyleToProps(
  channel: StyleChannel,
  props: Record<string, unknown>,
  style: StylePayload,
): Record<string, unknown> {
  const prop = channel.prop;
  if (style === null) {
    delete props[prop];
    return props;
  }
  if (typeof style === "string") {
    const trimmed = style.trim();
    if (trimmed === "") delete props[prop];
    else props[prop] = trimmed;
    return props;
  }
  const current = props[prop];
  const merged: Record<string, unknown> =
    current && typeof current === "object" && !Array.isArray(current)
      ? { ...(current as Record<string, unknown>) }
      : {};
  for (const [k, v] of Object.entries(style)) {
    if (v === null) delete merged[k];
    else merged[k] = v;
  }
  if (Object.keys(merged).length === 0) delete props[prop];
  else props[prop] = merged;
  return props;
}

/**
 * The channel a repository component's `style` payload lands in: only the
 * style props the component declares it accepts, and never translated — a
 * className string stays `className`, an object goes to `sx` where the
 * component takes one, else to `style`. Undiscovered components (placed by
 * explicit identity) are assumed to take the two React-universal props.
 */
export function repoStyleChannel(
  accepted: readonly string[] | undefined,
  style: StylePayload,
  ref: string,
): Result<StyleChannel, MutationError> {
  const props = accepted ?? ["className", "style"];
  if (style === null) {
    const prop = props.find((name) => ["className", "sx", "style"].includes(name)) ?? "style";
    return ok(STYLE_CHANNELS_BY_PROP[prop] ?? STYLE_CHANNELS.style);
  }
  if (typeof style === "string") {
    return props.includes("className")
      ? ok(STYLE_CHANNELS["tailwind-classname"])
      : err(
          badRequest(
            `${ref} takes no className; set its own props or \`style\` (${props.join(", ") || "none"}).`,
          ),
        );
  }
  if (props.includes("sx")) return ok(STYLE_CHANNELS.sx);
  if (props.includes("style")) return ok(STYLE_CHANNELS.style);
  return err(
    badRequest(`${ref} declares no style prop to take an object; set its own props instead.`),
  );
}

const STYLE_CHANNELS_BY_PROP: Record<string, StyleChannel> = {
  className: STYLE_CHANNELS["tailwind-classname"],
  sx: STYLE_CHANNELS.sx,
  style: STYLE_CHANNELS.style,
};
