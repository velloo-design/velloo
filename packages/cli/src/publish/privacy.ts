import { confirm, select } from "@clack/prompts";
import { PROTECTED_SHARES_UNAVAILABLE } from "@velloo/protocol";

type PublishPrivacyMode = "public" | "private" | "team" | "password";

export interface PublishPrivacyChoice {
  visibility: "public" | "private";
  password: boolean;
  /** Private to the publish's team rather than the whole organization. */
  teamOnly: boolean;
  /**
   * Whether people outside the organization may comment. Undefined leaves it
   * to the cloud: off for a new link, unchanged for an existing one.
   */
  publicComments?: boolean | undefined;
}

export interface PublishPrivacyArgs {
  visibility?: string | undefined;
  private?: boolean | undefined;
  public?: boolean | undefined;
  password?: boolean | undefined;
  "team-only"?: boolean | undefined;
  "public-comments"?: boolean | undefined;
}

interface PrivacyPromptOptions {
  protectedShares: boolean;
  upgradeUrl: string | undefined;
  /** Offer "Only <team>" — set when the organization has teams to tell apart. */
  teamName?: string | undefined;
}

type ChoosePrivacyMode = (options: PrivacyPromptOptions) => Promise<PublishPrivacyMode | symbol>;

/**
 * Where to send someone who needs a bigger plan. Which plan and what it costs
 * is the cloud's billing page to state, not this CLI's — so when we couldn't
 * resolve that page we point at it by name rather than guessing a URL.
 */
function upgradeHint(upgradeUrl: string | undefined): string {
  return upgradeUrl ? `upgrade at ${upgradeUrl}` : "upgrade from your cloud's billing page";
}

interface ResolvePrivacyOptions {
  /** Whether the account's plan allows private/password links (see `protectedSharesAllowed`). */
  protectedShares?: boolean;
  /** Where to upgrade — the cloud's billing page, when it could be resolved. */
  upgradeUrl?: string | undefined;
  /** The team this publish lands in, when there is one. `--team-only` needs it. */
  team?: { name: string } | undefined;
  /**
   * Whether the prompt offers a team-only option. Only worth asking where there
   * is more than one team, on a plan that has team-only boards.
   */
  offerTeamOnly?: boolean;
  choose?: ChoosePrivacyMode;
  askPublicComments?: () => Promise<boolean | symbol>;
  warn?: (message: string) => void;
}

/**
 * What is wrong with the privacy flags on their own, before any prompt runs —
 * so `velloo publish --private` on a free plan stops before the board picker
 * rather than after it. Null when they are fine.
 */
export function privacyFlagsError(
  args: PublishPrivacyArgs,
  protectedShares = true,
  upgradeUrl?: string,
): string | null {
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
  const teamOnly = args["team-only"] === true;
  if (teamOnly && (args.public || args.visibility === "public")) {
    return "--team-only is a private link; it cannot be combined with --public";
  }
  const wantsProtected =
    args.private === true || args.visibility === "private" || args.password === true || teamOnly;
  if (wantsProtected && !protectedShares) {
    return `${PROTECTED_SHARES_UNAVAILABLE}. Publish with --public, or ${upgradeHint(upgradeUrl)}`;
  }
  return null;
}

/**
 * Resolve the access policy before a publish starts. An omitted policy is a
 * deliberate interactive choice, never an implicit public link. Automation
 * must name its intent with --public, --private, --team-only, --password, or
 * --visibility.
 *
 * Public commenting is asked only after an interactive choice of a public or
 * password link — flags mean "don't ask me", so a flagged publish takes
 * `--public-comments` / `--no-public-comments` or leaves it to the cloud.
 */
export async function resolvePublishPrivacy(
  args: PublishPrivacyArgs,
  interactive: boolean,
  {
    protectedShares = true,
    upgradeUrl,
    team,
    offerTeamOnly = false,
    choose = promptForPrivacyMode,
    askPublicComments = promptForPublicComments,
    warn = () => {},
  }: ResolvePrivacyOptions = {},
): Promise<PublishPrivacyChoice> {
  const invalid = privacyFlagsError(args, protectedShares, upgradeUrl);
  if (invalid) throw new Error(invalid);

  const explicit =
    args.visibility !== undefined ||
    args.private === true ||
    args.public === true ||
    args.password === true ||
    args["team-only"] === true;

  let choice: PublishPrivacyChoice;
  if (explicit) {
    const teamOnly = args["team-only"] === true;
    if (teamOnly && !team) {
      throw new Error("--team-only needs an organization team to publish into");
    }
    choice = {
      visibility: teamOnly || args.private || args.visibility === "private" ? "private" : "public",
      password: args.password === true,
      teamOnly,
    };
  } else {
    if (!interactive) {
      throw new Error(
        "privacy mode is required without a terminal; pass --public, --private, --team-only, --password, or --visibility",
      );
    }
    const mode = await choose({
      protectedShares,
      upgradeUrl,
      ...(offerTeamOnly && team ? { teamName: team.name } : {}),
    });
    if (typeof mode === "symbol") throw new Error("cancelled");
    if (mode !== "public" && !protectedShares) throw new Error(PROTECTED_SHARES_UNAVAILABLE);
    choice =
      mode === "private" || mode === "team"
        ? { visibility: "private", password: false, teamOnly: mode === "team" }
        : { visibility: "public", password: mode === "password", teamOnly: false };
  }

  // Outsiders only ever reach a public link or one behind a password.
  const reachableOutside = choice.visibility === "public" || choice.password;
  const flag = args["public-comments"];
  if (flag !== undefined) {
    if (reachableOutside) return { ...choice, publicComments: flag };
    if (flag) {
      warn("--public-comments ignored: only people in your organization can open a private link");
    }
    return choice;
  }
  if (!explicit && reachableOutside) {
    const answer = await askPublicComments();
    if (typeof answer === "symbol") throw new Error("cancelled");
    return { ...choice, publicComments: answer };
  }
  return choice;
}

/**
 * The protected modes stay listed on a free plan — disabled, pointing at
 * billing — so the option is discoverable rather than missing.
 */
async function promptForPrivacyMode({
  protectedShares,
  upgradeUrl,
  teamName,
}: PrivacyPromptOptions): Promise<PublishPrivacyMode | symbol> {
  const locked = protectedShares ? {} : { disabled: true, hint: "requires a paid plan" };
  return select({
    message: protectedShares
      ? "Who should be able to view this publish?"
      : `Who should be able to view this publish? (free plan: public links — ${upgradeHint(upgradeUrl)})`,
    initialValue: "public",
    options: [
      { value: "public", label: "Public", hint: "anyone with the link" },
      { value: "private", label: "Private", hint: "everyone in your organization", ...locked },
      ...(teamName
        ? [
            {
              value: "team",
              label: `Only ${teamName}`,
              hint: "that team, plus your organization's owner and admins",
              ...locked,
            },
          ]
        : []),
      {
        value: "password",
        label: "Password protected",
        hint: "anyone with the password",
        ...locked,
      },
    ],
  }) as Promise<PublishPrivacyMode | symbol>;
}

function promptForPublicComments(): Promise<boolean | symbol> {
  return confirm({
    message: "Let people outside your organization comment? (they'll give their name)",
    initialValue: false,
  });
}
