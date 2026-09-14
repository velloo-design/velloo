import { z } from "zod";

/**
 * One schema per velloo-cloud response velloo reads.
 *
 * These are the shapes that used to be `as` casts at the call sites — an
 * assertion the compiler believes and nothing checks, so a cloud answering
 * something else produced a `TypeError` several frames away from the request.
 * Declared here, they parse through `cloudFetch` / `cloudJson` and a mismatch
 * becomes a `ProtocolViolation` naming the operation.
 *
 * `z.object` strips unknown keys rather than rejecting them: a cloud that
 * grows a field must not break an older velloo that never asked for it. What
 * these enforce is that the fields velloo *does* read are the type it reads
 * them as.
 */

const Visibility = z.enum(["public", "private"]);

/** `GET /v1/auth/config` — every field optional; different callers want different ones. */
export const AuthConfigResponseSchema = z.object({
  appUrl: z.string().optional(),
  issuer: z.string().optional(),
  clientId: z.string().optional(),
});

/** `GET /health` — a cloud without the endpoint 404s, which never reaches here. */
export const HealthResponseSchema = z.object({
  ok: z.boolean().optional(),
  db: z.object({ ok: z.boolean().optional() }).optional(),
  blob: z.object({ ok: z.boolean().optional() }).optional(),
});

/** `GET /v1/me` — the account behind a CLI token. */
export const AccountResponseSchema = z.object({
  email: z.string(),
  name: z.string().optional(),
  /** Plan tier — "free" | "team" | "business" | "enterprise". */
  tier: z.string().optional(),
  /**
   * Pay-as-you-go credit balance in micros ($1 = 1_000_000). Null when the
   * cloud couldn't price it (its account service briefly down) — distinct from
   * absent, which is a cloud that reports no balance at all.
   */
  creditMicros: z.number().nullable().optional(),
});
export type CloudAccount = z.infer<typeof AccountResponseSchema>;

export const PRICING_URL = "https://velloo.design/pricing";

/**
 * Whether a plan can publish private or password-protected links. Free links
 * are public only — velloo-cloud refuses the rest with a 403, and this lets a
 * client say so before the publish rather than after it. An unknown tier (an
 * older cloud, or `/v1/me` unreachable) stays allowed: the cloud is the
 * authority, and a wrong "no" would block a paying account.
 */
export function protectedSharesAllowed(tier: string | undefined): boolean {
  return tier !== "free";
}

/** The one sentence every surface uses for that refusal. */
export const PROTECTED_SHARES_UNAVAILABLE =
  "private and password-protected links need a Team or Business plan — free accounts publish public links only";

/** One publish destination the folder could land in. */
export const PublishSlotSchema = z.object({
  slug: z.string(),
  url: z.string(),
  title: z.string(),
  teamId: z.string().nullable(),
  visibility: Visibility,
  passwordProtected: z.boolean(),
  latestVersionId: z.string().nullable(),
  lastPublishedAt: z.string().nullable(),
  context: z.object({
    boardIds: z.array(z.string()),
    selectionFingerprint: z.string().nullable(),
    contextKnown: z.boolean(),
    repo: z.string().nullable(),
    branch: z.string().nullable(),
  }),
});
export type CloudPublishSlot = z.infer<typeof PublishSlotSchema>;

/** `GET /v1/publish-destinations`. */
export const PublishDestinationsResponseSchema = z.object({
  effectiveTeamId: z.string().nullable(),
  slots: z.array(PublishSlotSchema),
});
export type CloudPublishDestinations = z.infer<typeof PublishDestinationsResponseSchema>;

/** `POST /v1/links` — 201 created, or 200 reusing the folder's existing link. */
export const LinkResponseSchema = z.object({
  slug: z.string(),
  visibility: Visibility.optional(),
  passwordProtected: z.boolean().optional(),
});

/** `PUT /v1/links/:slug/access`. */
export const LinkAccessResponseSchema = z.object({
  visibility: Visibility,
  passwordProtected: z.boolean(),
});

/** `POST /v1/links/:slug/versions`. */
export const VersionUploadResponseSchema = z.object({
  files: z.number(),
  bytes: z.number(),
  /** Absolute on hosted clouds, relative in dev. */
  url: z.string(),
  /** Effective plan + version retention, from folderId-aware clouds. */
  tier: z.string().optional(),
  history: z.object({ retained: z.boolean(), versions: z.number(), pruned: z.number() }).optional(),
});

/** One row of `GET /v1/links`. */
export const PublishedDesignSchema = z.object({
  slug: z.string(),
  title: z.string().nullable(),
  url: z.string(),
  visibility: Visibility,
  passwordProtected: z.boolean(),
  canManage: z.boolean(),
  mine: z.boolean(),
  ownerEmail: z.string().nullable().optional(),
  git: z
    .object({ repo: z.string().optional(), branch: z.string().optional() })
    .nullable()
    .optional(),
  published: z.boolean(),
  lastPublishedAt: z.string().nullable(),
});
export type CloudPublishedDesign = z.infer<typeof PublishedDesignSchema>;

export const PublishedDesignsResponseSchema = z.object({
  links: z.array(PublishedDesignSchema).optional(),
});

/** `GET /v1/teams/mine`. */
export const TeamSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** The team a publish lands in when none is named. Absent on older clouds. */
  isDefault: z.boolean().optional(),
});
export type CloudTeam = z.infer<typeof TeamSchema>;

export const TeamsResponseSchema = z.object({ teams: z.array(TeamSchema) });

/** OAuth device flow — the auth service's shapes, not the cloud's own. */
export const DeviceCodeResponseSchema = z.object({
  device_code: z.string(),
  user_code: z.string(),
  verification_uri: z.string(),
  verification_uri_complete: z.string(),
  expires_in: z.number(),
  interval: z.number(),
});

/** The polling reply: a token, or one of the flow's defined non-answers. */
export const DeviceTokenResponseSchema = z.object({
  access_token: z.string().optional(),
  error: z.string().optional(),
  error_description: z.string().optional(),
});

/** `POST /v1/auth/cli-token` — the device grant exchanged for a `vlk_` token. */
export const CliTokenResponseSchema = z.object({
  token: z.string(),
  email: z.string(),
});
export type DeviceLoginResult = z.infer<typeof CliTokenResponseSchema>;

/** One generation intent, priced. `GET /v1/assets/intents`. */
export const IntentPriceSchema = z.object({
  intent: z.string(),
  summary: z.string(),
  /** List price per asset in micros; what a run actually costs is in its reply. */
  priceMicros: z.number(),
  output: z.enum(["image", "svg"]),
  aspects: z.array(z.string()),
  defaultAspect: z.string(),
  reference: z.enum(["forbidden", "optional", "required"]),
});
export type IntentPrice = z.infer<typeof IntentPriceSchema>;

export const IntentCatalogResponseSchema = z.object({
  intents: z.array(IntentPriceSchema),
  maxCount: z.number().optional(),
});

export const GeneratedAssetPayloadSchema = z.object({
  kind: z.enum(["image", "svg"]),
  dataUrl: z.string(),
});

/**
 * `POST /v1/assets/generate`. The `assets` array is current; a pre-variant
 * cloud answered with one top-level `kind`/`dataUrl`, which normalizes to the
 * same thing rather than being a second code path at the call site.
 */
export const GenerateResponseSchema = z
  .object({
    id: z.string(),
    intent: z.string().optional(),
    chargedMicros: z.number(),
    balanceMicros: z.number(),
    assets: z.array(GeneratedAssetPayloadSchema).min(1).optional(),
    kind: z.enum(["image", "svg"]).optional(),
    dataUrl: z.string().optional(),
  })
  .transform((r, ctx) => {
    const assets =
      r.assets ?? (r.dataUrl && r.kind ? [{ kind: r.kind, dataUrl: r.dataUrl }] : null);
    if (!assets) {
      ctx.addIssue({ code: "custom", message: "no assets in the generation reply" });
      return z.NEVER;
    }
    return {
      id: r.id,
      intent: r.intent ?? "",
      assets,
      chargedMicros: r.chargedMicros,
      balanceMicros: r.balanceMicros,
    };
  });
export type GenerateResponse = z.infer<typeof GenerateResponseSchema>;

/** `GET /v1/feedback/token-key` — the blind-signature issuer's public key. */
export const FeedbackIssuerResponseSchema = z.object({
  scheme: z.string(),
  publicKey: z.string(),
});

/** `POST /v1/feedback/tokens` — blind signatures over the submitted requests. */
export const FeedbackSignaturesResponseSchema = z.object({
  signatures: z.array(z.string()),
});
