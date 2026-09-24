import {
  type CloudError,
  type CloudGuest,
  type CloudGuestInvite,
  cloudFetch,
  GuestInviteResponseSchema,
  GuestLinkResponseSchema,
  GuestsResponseSchema,
  httpFailureFrom,
  unreachable,
} from "@velloo/protocol";
import { err, ok, type Result } from "@velloo/result";

/**
 * A board's guests: people outside the organization it is shared with by
 * email. Each one opens the board through a personal link that only ever
 * reaches this board; minting a new one (a resend, or a link to copy) retires
 * the old one, because the cloud keeps only a hash of it.
 */

interface GuestTarget {
  baseUrl: string;
  token: string;
  slug: string;
}

const guestsUrl = ({ baseUrl, slug }: GuestTarget, rest = ""): string =>
  `${baseUrl}/v1/links/${encodeURIComponent(slug)}/guests${rest}`;

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export async function listGuests(target: GuestTarget): Promise<Result<CloudGuest[], CloudError>> {
  const body = await cloudFetch(guestsUrl(target), GuestsResponseSchema, {
    operation: "listing guests",
    token: target.token,
  });
  return body.ok ? ok(body.value.guests) : body;
}

export function inviteGuest(
  target: GuestTarget,
  guest: { email: string; name?: string | undefined },
): Promise<Result<CloudGuestInvite, CloudError>> {
  return cloudFetch(guestsUrl(target), GuestInviteResponseSchema, {
    operation: "inviting a guest",
    token: target.token,
    ...json({ email: guest.email, ...(guest.name ? { name: guest.name } : {}) }),
  });
}

/** Email the guest a fresh link; the one they had stops working. */
export function resendGuestLink(
  target: GuestTarget,
  guestId: string,
): Promise<Result<CloudGuestInvite, CloudError>> {
  return cloudFetch(
    guestsUrl(target, `/${encodeURIComponent(guestId)}/resend`),
    GuestInviteResponseSchema,
    { operation: "resending a guest's link", token: target.token, ...json({}) },
  );
}

/** A fresh link to hand over by hand, not emailed; the one they had stops working. */
export async function mintGuestLink(
  target: GuestTarget,
  guestId: string,
): Promise<Result<string, CloudError>> {
  const body = await cloudFetch(
    guestsUrl(target, `/${encodeURIComponent(guestId)}/link`),
    GuestLinkResponseSchema,
    { operation: "making a guest link", token: target.token, ...json({}) },
  );
  return body.ok ? ok(body.value.guestUrl) : body;
}

export async function removeGuest(
  target: GuestTarget,
  guestId: string,
): Promise<Result<void, CloudError>> {
  const res = await fetch(guestsUrl(target, `/${encodeURIComponent(guestId)}`), {
    method: "DELETE",
    headers: { authorization: `Bearer ${target.token}` },
  }).catch((error: unknown) => error);
  if (!(res instanceof Response)) return err(unreachable(res, { url: target.baseUrl }));
  if (!res.ok) return err(await httpFailureFrom("removing a guest", res));
  return ok(undefined);
}
