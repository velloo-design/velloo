import { select } from "@clack/prompts";
import { PRICING_URL, PROTECTED_SHARES_UNAVAILABLE } from "@velloo/protocol";

type PublishPrivacyMode = "public" | "private" | "password";

export interface PublishPrivacyChoice {
  visibility: "public" | "private";
  password: boolean;
}

export interface PublishPrivacyArgs {
  visibility?: string | undefined;
  private?: boolean | undefined;
  public?: boolean | undefined;
  password?: boolean | undefined;
}

type ChoosePrivacyMode = (protectedShares: boolean) => Promise<PublishPrivacyMode | symbol>;

interface ResolvePrivacyOptions {
  /** Whether the account's plan allows private/password links (see `protectedSharesAllowed`). */
  protectedShares?: boolean;
  choose?: ChoosePrivacyMode;
}

/**
 * What is wrong with the privacy flags on their own, before any prompt runs —
 * so `velloo publish --private` on a free plan stops before the board picker
 * rather than after it. Null when they are fine.
 */
export function privacyFlagsError(args: PublishPrivacyArgs, protectedShares = true): string | null {
  if (
    args.visibility !== undefined &&
    args.visibility !== "public" &&
    args.visibility !== "private"
  ) {
    return `--visibility must be 'public' or 'private', got '${args.visibility}'`;
  }
  if (args.private && args.public) return "--private and --public cannot be used together";
  if (args.private && args.visibility === "public") {
    return "--private conflicts with --visibility public";
  }
  if (args.public && args.visibility === "private") {
    return "--public conflicts with --visibility private";
  }
  const wantsProtected =
    args.private === true || args.visibility === "private" || args.password === true;
  if (wantsProtected && !protectedShares) {
    return `${PROTECTED_SHARES_UNAVAILABLE}. Publish with --public, or upgrade at ${PRICING_URL}`;
  }
  return null;
}

/**
 * Resolve the access policy before a publish starts. An omitted policy is a
 * deliberate interactive choice, never an implicit public link. Automation
 * must name its intent with --public, --private, --password, or --visibility.
 */
export async function resolvePublishPrivacy(
  args: PublishPrivacyArgs,
  interactive: boolean,
  { protectedShares = true, choose = promptForPrivacyMode }: ResolvePrivacyOptions = {},
): Promise<PublishPrivacyChoice> {
  const invalid = privacyFlagsError(args, protectedShares);
  if (invalid) throw new Error(invalid);

  const explicit =
    args.visibility !== undefined ||
    args.private === true ||
    args.public === true ||
    args.password === true;
  if (explicit) {
    return {
      visibility: args.private || args.visibility === "private" ? "private" : "public",
      password: args.password === true,
    };
  }

  if (!interactive) {
    throw new Error(
      "privacy mode is required without a terminal; pass --public, --private, --password, or --visibility",
    );
  }

  const mode = await choose(protectedShares);
  if (typeof mode === "symbol") throw new Error("cancelled");
  if (mode !== "public" && !protectedShares) throw new Error(PROTECTED_SHARES_UNAVAILABLE);
  return mode === "private"
    ? { visibility: "private", password: false }
    : { visibility: "public", password: mode === "password" };
}

/**
 * The protected modes stay listed on a free plan — disabled, with the plan
 * that unlocks them — so the option is discoverable rather than missing.
 */
async function promptForPrivacyMode(
  protectedShares: boolean,
): Promise<PublishPrivacyMode | symbol> {
  const locked = protectedShares ? {} : { disabled: true, hint: "Team & Business plans" };
  return select({
    message: protectedShares
      ? "Who should be able to view this publish?"
      : `Who should be able to view this publish? (free plan: public links — ${PRICING_URL})`,
    initialValue: "public",
    options: [
      { value: "public", label: "Public", hint: "anyone with the link" },
      { value: "private", label: "Private", hint: "only your organization", ...locked },
      {
        value: "password",
        label: "Password protected",
        hint: "anyone with the password",
        ...locked,
      },
    ],
  }) as Promise<PublishPrivacyMode | symbol>;
}
