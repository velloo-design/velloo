import { Eye, EyeOff, Lock } from "lucide-react";
import { useState } from "react";
import type { BoardMeta, PublishTargets } from "../../api.ts";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "../ui/alert.tsx";
import { Button } from "../ui/button.tsx";
import { Checkbox } from "../ui/checkbox.tsx";
import { Input } from "../ui/input.tsx";
import { Label } from "../ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select.tsx";
import { Switch } from "../ui/switch.tsx";

type Slot = PublishTargets["slots"][number];

/** Who can open the link. "team" is a private link whose audience is one team. */
export type PublishVisibility = "public" | "private" | "team";

/** The same words `velloo publish` asks with, so the two never describe a link differently. */
const VISIBILITY_LABELS = {
  public: "Public — anyone with the link",
  private: "Private — everyone in your organization",
  team: (team: string) => `Only ${team} — that team, plus your organization's owner and admins`,
} as const;

interface Props {
  title: string;
  onTitleChange(title: string): void;
  boards: BoardMeta[];
  boardIds: string[];
  onToggleBoard(boardId: string, on: boolean): void;
  destinationSlug: string;
  onDestinationChange(slug: string): void;
  matchingSlots: Slot[];
  selectedSlot: Slot | null;
  destinationError: string | undefined;
  /** The plan allows private and password-protected links. */
  protectedShares: boolean;
  visibility: PublishVisibility;
  onVisibilityChange(visibility: PublishVisibility): void;
  /** The chosen team's name when a team-only link is on offer; null when it isn't. */
  teamOnlyName: string | null;
  password: string;
  onPasswordChange(password: string): void;
  upgradeUrl: string | null;
  teams: PublishTargets["teams"];
  teamId: string | null;
  onTeamChange(teamId: string): void;
  /**
   * Whether outsiders may comment. Null hides the switch: a private or
   * team-only link with no password is out of their reach anyway.
   */
  publicComments: { on: boolean; keepsExisting: boolean } | null;
  onPublicCommentsChange(on: boolean): void;
}

/** The choices a publish is made of: title, boards, destination, access and team. */
export function PublishForm(props: Props) {
  const { boards, boardIds } = props;
  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="publish-title">Title</Label>
        <Input
          id="publish-title"
          value={props.title}
          onChange={(e) => props.onTitleChange(e.target.value)}
          placeholder="Board title"
        />
      </div>

      {boards.length > 0 ? (
        <div className="grid gap-2">
          <Label>Boards</Label>
          <div className="max-h-40 overflow-y-auto rounded-md border">
            {boards.map((board) => (
              <div
                key={board.id}
                className="flex items-center gap-2 px-2.5 py-1.5 text-sm hover:bg-accent/50"
              >
                <Checkbox
                  id={`publish-board-${board.id}`}
                  checked={boardIds.includes(board.id)}
                  onCheckedChange={(v) => props.onToggleBoard(board.id, v === true)}
                />
                <Label
                  htmlFor={`publish-board-${board.id}`}
                  className="flex-1 cursor-pointer truncate font-normal"
                >
                  {board.name}
                </Label>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {board.frameCount} frame{board.frameCount === 1 ? "" : "s"}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          This folder has no boards, so every screen is published.
        </p>
      )}

      <div className="grid gap-2">
        <Label htmlFor="publish-destination">Destination</Label>
        <Select
          value={props.destinationSlug}
          onValueChange={props.onDestinationChange}
          disabled={Boolean(props.destinationError)}
        >
          <SelectTrigger id="publish-destination">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {props.matchingSlots.map((slot) => (
              <SelectItem key={slot.slug} value={slot.slug}>
                Update {slot.title || "Untitled design"}
              </SelectItem>
            ))}
            <SelectItem value="new">Create a new link</SelectItem>
          </SelectContent>
        </Select>
        {props.destinationError ? (
          <p className="text-xs text-destructive">{props.destinationError}</p>
        ) : props.selectedSlot ? (
          <p className="text-[11px] text-muted-foreground">
            Matches this team, board selection, and source.
          </p>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            Creates a separate live URL and keeps existing review links unchanged.
          </p>
        )}
      </div>

      {props.protectedShares ? (
        <AccessFields {...props} />
      ) : (
        <PublicOnly upgradeUrl={props.upgradeUrl} />
      )}

      {props.publicComments ? (
        <div className="flex items-start justify-between gap-3">
          <div className="grid gap-0.5">
            <Label htmlFor="publish-public-comments">
              Let people outside your organization comment
            </Label>
            <p className="text-[11px] text-muted-foreground">
              {props.publicComments.keepsExisting
                ? "They give their name to comment. Left alone, the link keeps its current setting."
                : "They give their name to comment."}
            </p>
          </div>
          <Switch
            id="publish-public-comments"
            checked={props.publicComments.on}
            onCheckedChange={props.onPublicCommentsChange}
          />
        </div>
      ) : null}

      {props.teams.length > 1 && props.teamId ? (
        <div className="grid gap-2">
          <Label htmlFor="publish-team">Team</Label>
          <Select value={props.teamId} onValueChange={props.onTeamChange}>
            <SelectTrigger id="publish-team">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {props.teams.map((team) => (
                <SelectItem key={team.id} value={team.id}>
                  {team.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}
    </div>
  );
}

function AccessFields({
  visibility,
  onVisibilityChange,
  teamOnlyName,
  password,
  onPasswordChange,
}: Props) {
  const [showPassword, setShowPassword] = useState(false);
  return (
    <>
      <div className="grid gap-2">
        <Label htmlFor="publish-visibility">Visibility</Label>
        <Select
          value={visibility}
          onValueChange={(v) => onVisibilityChange(v === "private" || v === "team" ? v : "public")}
        >
          <SelectTrigger id="publish-visibility">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="public">{VISIBILITY_LABELS.public}</SelectItem>
            <SelectItem value="private">{VISIBILITY_LABELS.private}</SelectItem>
            {teamOnlyName ? (
              <SelectItem value="team">{VISIBILITY_LABELS.team(teamOnlyName)}</SelectItem>
            ) : null}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="publish-password">Password (optional)</Label>
        <div className="relative">
          <Input
            id="publish-password"
            className="pr-10"
            type={showPassword ? "text" : "password"}
            minLength={3}
            autoComplete="new-password"
            placeholder="3+ characters"
            value={password}
            onChange={(e) => onPasswordChange(e.target.value)}
          />
          <Button
            type="button"
            variant="ghost"
            className="absolute right-0 top-0 h-9 w-9 p-0"
            onClick={() => setShowPassword((value) => !value)}
            title={showPassword ? "Hide password" : "Show password"}
            aria-label={showPassword ? "Hide password" : "Show password"}
            aria-pressed={showPassword}
          >
            {showPassword ? <EyeOff /> : <Eye />}
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Anyone with the password can view, signed in or not. Send it separately from the link.
        </p>
      </div>
    </>
  );
}

/** A free plan publishes public links only — said up front, with the way up. */
function PublicOnly({ upgradeUrl }: { upgradeUrl: string | null }) {
  return (
    <>
      <div className="grid gap-2">
        <Label htmlFor="publish-visibility">Visibility</Label>
        <Input
          id="publish-visibility"
          readOnly
          value={VISIBILITY_LABELS.public}
          className="bg-muted/40 text-muted-foreground"
        />
      </div>
      {/* An offer, not an error: `note` keeps screen readers from
          announcing it the way the Alert's default `alert` role would. */}
      <Alert role="note" data-testid="protected-shares-upsell">
        <Lock />
        <AlertTitle>Private and password-protected links</AlertTitle>
        <AlertDescription className="text-xs">
          Share only with your organization, or behind a password. Free accounts publish public
          links — upgrade your plan to unlock both.
        </AlertDescription>
        {upgradeUrl && (
          <AlertAction>
            <Button size="xs" variant="secondary" asChild>
              <a href={upgradeUrl} target="_blank" rel="noreferrer">
                Upgrade
              </a>
            </Button>
          </AlertAction>
        )}
      </Alert>
    </>
  );
}
