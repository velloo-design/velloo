import { z } from "zod";

/**
 * The browser init wizard's contract with the setup server `velloo init`
 * runs before any design exists. The server reads the app and writes the
 * design; the page only asks. Every path the page sends is resolved and
 * checked by the server — a body naming somewhere else is refused, not
 * followed.
 */

export const InitGoalSchema = z.enum([
  "setup",
  "redesign-screen",
  "redesign-component",
  "custom",
  "capture-site",
  "sample",
  "blank",
]);
export type InitGoal = z.infer<typeof InitGoalSchema>;

export const InitStorageSchema = z.enum(["repository", "external", "custom"]);
export type InitStorage = z.infer<typeof InitStorageSchema>;

const InitRouteSchema = z.object({
  id: z.string(),
  name: z.string(),
  routePath: z.string(),
  /** The app it belongs to, relative to the app root, in a repo with several. */
  app: z.string().optional(),
});
export type InitRoute = z.infer<typeof InitRouteSchema>;

/** What the server read about the app the design will match. */
const InitAppSchema = z.object({
  /** UI code was found to read. Without it only the self-contained starts are offered. */
  found: z.boolean(),
  /** The library the design will be made of, as the app settles it. */
  library: z.object({ id: z.string(), label: z.string() }),
  /** One line on why that library, for the person to check. */
  libraryNote: z.string(),
  /** The UI library as found in the app, when there is one ("Material UI", "Mantine"). */
  uiLibrary: z.string().optional(),
  tailwind: z.number().int().optional(),
  /** The stylesheet the theme is read from, relative to the app root. */
  themeSource: z.string().optional(),
  /**
   * A DESIGN.md whose colors can theme the design. `recommended` is false when
   * it names few of the color roles and the app's stylesheet covers them better.
   */
  designMd: z
    .object({
      /** Relative to the app root. */
      path: z.string(),
      system: z.string(),
      mapped: z.number().int(),
      total: z.number().int(),
      recommended: z.boolean(),
    })
    .optional(),
  routes: z.array(InitRouteSchema),
});
export type InitApp = z.infer<typeof InitAppSchema>;

const InitGoalOptionSchema = z.object({
  value: InitGoalSchema,
  label: z.string(),
  hint: z.string(),
});

/** One way to connect an agent: its config for every project, or this project's. */
const InitAgentScopeSchema = z.object({
  /** The id `velloo connect` knows it by. */
  id: z.string(),
  /** Already carries Velloo, so there is nothing to do. */
  wired: z.boolean(),
});

/** An agent Velloo can be connected to outside the canvas (its own terminal or editor). */
const InitAgentOptionSchema = z.object({
  label: z.string(),
  /** Installed on this computer. */
  detected: z.boolean(),
  global: InitAgentScopeSchema.optional(),
  project: InitAgentScopeSchema.optional(),
});
export type InitAgentOption = z.infer<typeof InitAgentOptionSchema>;

export const InitStateSchema = z.object({
  /** The directory init ran in: the design and its listing go here. */
  launchRoot: z.string(),
  /** The app the design matches — the launch root, or an app inside it. */
  appRoot: z.string(),
  /**
   * The apps inside the launch root, when it is not one itself (a monorepo
   * root). The person picks one; empty when there is nothing to pick.
   */
  apps: z.array(z.object({ dir: z.string(), rel: z.string() })),
  app: InitAppSchema,
  /** A design this directory already has. */
  existing: z.object({ name: z.string(), folder: z.string() }).optional(),
  /** Where the design goes was chosen on the command line; the page doesn't ask. */
  fixed: z.object({ storage: InitStorageSchema, folder: z.string() }).optional(),
  /**
   * The libraries to choose from — offered only when there is no app to settle
   * it, since an app's own library is never asked.
   */
  libraries: z.array(z.object({ id: z.string(), label: z.string(), hint: z.string() })),
  storage: z.object({
    /** The in-repo folder, shown relative to the launch root ("velloo"). */
    repository: z.string(),
    /** Where Velloo-managed designs are kept, for display. */
    external: z.string(),
  }),
  /** A name for the design, from the app. */
  suggestedName: z.string(),
  goals: z.array(InitGoalOptionSchema),
  agents: z.array(InitAgentOptionSchema),
});
export type InitState = z.infer<typeof InitStateSchema>;

const PlaceSchema = {
  appRoot: z.string().min(1).max(4096),
  storage: InitStorageSchema,
  /** For `custom`: a folder path relative to the launch root, or absolute. */
  folder: z.string().max(4096).optional(),
  name: z.string().max(200).optional(),
};

/** Is this place free for a new design? */
export const InitCheckBodySchema = z.strictObject(PlaceSchema);
export type InitCheckBody = z.infer<typeof InitCheckBodySchema>;

export const InitPlaceSchema = z.object({
  /** Where the design would go, as the page shows it. */
  folder: z.string(),
  /**
   * Outside the repository: recorded on this computer only, so it can't
   * connect agents with project configs, which would live in the checkout.
   */
  local: z.boolean(),
  problem: z.string().optional(),
});
export type InitPlace = z.infer<typeof InitPlaceSchema>;

export const InitCreateBodySchema = z.strictObject({
  ...PlaceSchema,
  goal: InitGoalSchema,
  /** For `redesign-screen`: one of the app's routes, by id … */
  routeId: z.string().max(500).optional(),
  /** … or a screen the app doesn't have yet. */
  screenName: z.string().max(200).optional(),
  component: z.string().max(2000).optional(),
  request: z.string().max(10_000).optional(),
  captureUrl: z.string().max(2000).optional(),
  /** One of `InitState.libraries`; ignored when the app settles the library. */
  library: z.string().max(100).optional(),
  /** Follow the app's DESIGN.md for the theme, when there is one. */
  useDesignMd: z.boolean().optional(),
  /** Agents to connect outside the canvas: `global` or `project` ids from `InitState.agents`. */
  agents: z.array(z.string().max(100)).max(20),
});
export type InitCreateBody = z.infer<typeof InitCreateBodySchema>;

export const InitCreatedSchema = z.object({
  name: z.string(),
  folder: z.string(),
  /**
   * What the agent is asked to do first — set the design up for the app, then
   * the start the person chose. Absent when there is nothing to ask (the sample).
   */
  prompt: z.string().optional(),
  /** The agent sets the design up for the app before anything else. */
  setup: z.boolean(),
});
export type InitCreated = z.infer<typeof InitCreatedSchema>;

export const InitModelsBodySchema = z.strictObject({ provider: z.string().max(100) });

/** The models an agent offers, read from a session started for the purpose. */
export const InitModelsSchema = z.object({
  models: z.array(
    z.object({ id: z.string(), label: z.string(), description: z.string().optional() }),
  ),
  /** The model the agent would run on as things are. */
  model: z.string().optional(),
});
export type InitModels = z.infer<typeof InitModelsSchema>;

/**
 * Open the canvas. Naming a provider starts that agent in the canvas's Agent
 * tab, on `prompt` — the first task as the person left it — and on `model`
 * when they picked one.
 */
export const InitOpenBodySchema = z.strictObject({
  provider: z.string().max(100).optional(),
  model: z.string().max(200).optional(),
  prompt: z.string().max(100_000).optional(),
});
export type InitOpenBody = z.infer<typeof InitOpenBodySchema>;
