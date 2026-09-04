import { select } from "@clack/prompts";

export type PublishPrivacyMode = "public" | "private" | "password";

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

type ChoosePrivacyMode = () => Promise<PublishPrivacyMode | symbol>;

/**
 * Resolve the access policy before a publish starts. An omitted policy is a
 * deliberate interactive choice, never an implicit public link. Automation
 * must name its intent with --public, --private, --password, or --visibility.
 */
export async function resolvePublishPrivacy(
  args: PublishPrivacyArgs,
  interactive: boolean,
  choose: ChoosePrivacyMode = promptForPrivacyMode,
): Promise<PublishPrivacyChoice> {
  if (
    args.visibility !== undefined &&
    args.visibility !== "public" &&
    args.visibility !== "private"
  ) {
    throw new Error(`--visibility must be 'public' or 'private', got '${args.visibility}'`);
  }
  if (args.private && args.public) {
    throw new Error("--private and --public cannot be used together");
  }
  if (args.private && args.visibility === "public") {
    throw new Error("--private conflicts with --visibility public");
  }
  if (args.public && args.visibility === "private") {
    throw new Error("--public conflicts with --visibility private");
  }

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

  const mode = await choose();
  if (typeof mode === "symbol") throw new Error("cancelled");
  return mode === "private"
    ? { visibility: "private", password: false }
    : { visibility: "public", password: mode === "password" };
}

async function promptForPrivacyMode(): Promise<PublishPrivacyMode | symbol> {
  return select({
    message: "Who should be able to view this publish?",
    options: [
      { value: "public", label: "Public", hint: "anyone with the link" },
      { value: "private", label: "Private", hint: "only your organization" },
      { value: "password", label: "Password protected", hint: "anyone with the password" },
    ],
  }) as Promise<PublishPrivacyMode | symbol>;
}
