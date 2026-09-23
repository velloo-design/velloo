import { describe, expect, test } from "bun:test";
import type { CloudTeam } from "@velloo/protocol";
import { publishedDesignSubtitle } from "../cloud-published.ts";
import { type CloudPublishSlot, uploadLinkBundle } from "../cloud-upload.ts";
import { describePublishedAccess, publishTeamFor } from "../commands/publish.ts";
import { exactPublishSlots, publishableTeams, resolvePublishTeam } from "../publish/core.ts";
import { describePublishError } from "../publish/errors.ts";
import { publishedDesignAccess } from "../publish/manage.ts";

const DESIGN = "11111111-1111-4111-8111-111111111111";
const MARKETING = "22222222-2222-4222-8222-222222222222";
const LEGAL = "33333333-3333-4333-8333-333333333333";

const team = (id: string, name: string, overrides: Partial<CloudTeam> = {}): CloudTeam => ({
  id,
  name,
  role: "member",
  canPublish: true,
  ...overrides,
});

const slot = (overrides: Partial<CloudPublishSlot> = {}): CloudPublishSlot => ({
  slug: "review",
  url: "/s/review/",
  title: "Review",
  teamId: MARKETING,
  visibility: "private",
  passwordProtected: false,
  latestVersionId: null,
  lastPublishedAt: "2030-01-01T00:00:00.000Z",
  context: {
    boardIds: ["home"],
    selectionFingerprint: null,
    contextKnown: true,
    repo: null,
    branch: null,
  },
  ...overrides,
});

function expectError(result: ReturnType<typeof resolvePublishTeam>): string {
  if (result.ok) throw new Error(`expected an error, got ${JSON.stringify(result.value)}`);
  return describePublishError(result.error);
}

describe("choosing the publish team", () => {
  test("no organization publishes personally", () => {
    expect(resolvePublishTeam([])).toEqual({ ok: true, value: { kind: "personal" } });
  });

  test("the one publishable team is used without asking", () => {
    const teams = [
      team(DESIGN, "Design"),
      team(LEGAL, "Legal", { canPublish: false, role: "member" }),
    ];
    expect(resolvePublishTeam(teams)).toEqual({
      ok: true,
      value: { kind: "team", team: teams[0] as CloudTeam },
    });
  });

  test("more than one publishable team has to be chosen", () => {
    const teams = [team(DESIGN, "Design"), team(MARKETING, "Marketing")];
    const resolved = resolvePublishTeam(teams);
    expect(resolved.ok && resolved.value.kind).toBe("choose");
  });

  test("an older cloud that says nothing about canPublish counts every team", () => {
    const teams = [
      { id: DESIGN, name: "Design" },
      { id: MARKETING, name: "Marketing" },
    ];
    expect(publishableTeams(teams)).toHaveLength(2);
  });

  test("--team matches publishable teams by name or UUID only", () => {
    const teams = [team(DESIGN, "Design"), team(LEGAL, "Legal", { canPublish: false })];
    const byName = resolvePublishTeam(teams, "design");
    expect(byName.ok && byName.value.kind === "team" && byName.value.team.id).toBe(DESIGN);
    const byId = resolvePublishTeam(teams, DESIGN);
    expect(byId.ok && byId.value.kind === "team" && byId.value.team.id).toBe(DESIGN);
    expect(expectError(resolvePublishTeam(teams, "Legal"))).toContain(
      "you can only publish to teams you're on",
    );
    expect(expectError(resolvePublishTeam(teams, "Nope"))).toContain("no team named");
  });

  test("a reviewer is told why, in the cloud's words", () => {
    const teams = [team(DESIGN, "Design", { role: "reviewer", canPublish: false })];
    expect(expectError(resolvePublishTeam(teams))).toBe(
      "reviewers can view and comment on boards, but not publish them",
    );
    expect(expectError(resolvePublishTeam(teams, "Design"))).toContain("reviewers");
  });

  test("a non-owner on a lapsed plan is told the Free-plan rule", () => {
    const teams = [team(DESIGN, "Design", { canPublish: false })];
    expect(expectError(resolvePublishTeam(teams))).toContain(
      "on the Free plan only the organization owner publishes",
    );
  });
});

describe("the team a destination lands in", () => {
  const teams = [team(DESIGN, "Design"), team(MARKETING, "Marketing")];
  const choose = { kind: "choose" as const, teams };

  test("updating a slot keeps the slot's team, without asking", async () => {
    const picked = await publishTeamFor({
      resolution: choose,
      destination: { mode: "update", slug: "review", expectedVersionId: null },
      slots: [slot()],
      teams,
      interactive: true,
      pick: async () => {
        throw new Error("should not ask");
      },
    });
    expect(picked?.id).toBe(MARKETING);
  });

  test("a new link asks which team", async () => {
    const offered: string[] = [];
    const picked = await publishTeamFor({
      resolution: choose,
      destination: { mode: "new" },
      slots: [],
      teams,
      interactive: true,
      pick: async (candidates) => {
        offered.push(...candidates.map((candidate) => candidate.name));
        return DESIGN;
      },
    });
    expect(offered).toEqual(["Design", "Marketing"]);
    expect(picked?.id).toBe(DESIGN);
  });

  test("without a terminal, it names the teams and --team", async () => {
    expect(
      publishTeamFor({
        resolution: choose,
        destination: { mode: "new" },
        slots: [],
        teams,
        interactive: false,
      }),
    ).rejects.toThrow(
      "you can publish to more than one team — choose one (Design, Marketing) with --team",
    );
  });

  test("cancelling the team prompt cancels the publish", async () => {
    expect(
      publishTeamFor({
        resolution: choose,
        destination: { mode: "new" },
        slots: [],
        teams,
        interactive: true,
        pick: async () => Symbol("cancel"),
      }),
    ).rejects.toThrow("cancelled");
  });

  test("an undecided team matches slots in any publishable team", () => {
    const source = {
      boardIds: ["home"],
      teamId: null,
      candidateTeamIds: [DESIGN, MARKETING],
      repo: null,
      branch: null,
    };
    const inLegal = slot({ slug: "legal", teamId: LEGAL });
    const personal = slot({ slug: "personal", teamId: null });
    expect(exactPublishSlots([slot(), inLegal, personal], source).map((s) => s.slug)).toEqual([
      "review",
    ]);
  });
});

describe("saying who a link is for", () => {
  test("team-only, organization, and public links read differently", () => {
    expect(
      describePublishedAccess(
        {
          visibility: "private",
          passwordProtected: false,
          audience: [{ type: "team", id: DESIGN, name: "Design" }],
        },
        { teamName: "Design" },
      ),
    ).toEqual(["private — only Design", "team: Design"]);
    expect(describePublishedAccess({ visibility: "private", passwordProtected: false })).toEqual([
      "private — anyone signed in at your organization",
    ]);
    expect(
      describePublishedAccess(
        { visibility: "public", passwordProtected: false, publicComments: true },
        {},
      ),
    ).toEqual([
      "public — anyone with the link",
      "comments: open to people outside your organization (they give their name)",
    ]);
  });

  test("public commenting is not mentioned for a link outsiders cannot open", () => {
    expect(
      describePublishedAccess({
        visibility: "private",
        passwordProtected: false,
        publicComments: true,
      }),
    ).toEqual(["private — anyone signed in at your organization"]);
  });

  test("publish list shows the team and never needs an owner email", () => {
    expect(
      publishedDesignAccess({
        visibility: "private",
        passwordProtected: false,
        audience: [{ type: "team", id: DESIGN, name: "Design" }],
        teamName: "Design",
      }),
    ).toBe("only Design · team Design");
    expect(
      publishedDesignAccess({
        visibility: "public",
        passwordProtected: false,
        teamName: null,
        publicComments: true,
      }),
    ).toBe("public · public comments on");
    expect(
      publishedDesignSubtitle({
        lastPublishedAt: null,
        ownerEmail: null,
        ownerName: "Ana",
        git: null,
      }),
    ).toContain("by Ana");
  });
});

describe("what travels to the cloud", () => {
  async function captureBodies(existing: boolean) {
    const bodies: Record<string, unknown>[] = [];
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        const { pathname } = new URL(req.url);
        if (pathname === "/v1/links" && req.method === "POST") {
          bodies.push((await req.json()) as Record<string, unknown>);
          return Response.json(
            { slug: "s", visibility: "private", passwordProtected: false },
            { status: existing ? 200 : 201 },
          );
        }
        if (pathname === "/v1/links/s/access" && req.method === "PUT") {
          bodies.push((await req.json()) as Record<string, unknown>);
          return Response.json({
            visibility: "private",
            passwordProtected: false,
            audience: [{ type: "team", id: DESIGN, name: "Design" }],
            publicComments: false,
          });
        }
        if (pathname === "/v1/links/s/versions") {
          return Response.json({ files: 1, bytes: 1, url: "/s/s/" }, { status: 201 });
        }
        return new Response("not found", { status: 404 });
      },
    });
    try {
      const form = new FormData();
      form.append("file", new File(["{}"], "design.json"));
      const uploaded = await uploadLinkBundle({
        baseUrl: `http://localhost:${server.port}`,
        token: "t",
        link: {
          title: "x",
          visibility: "private",
          publishMode: existing ? "update" : "new",
          ...(existing ? { slug: "s", expectedVersionId: null } : {}),
          teamId: DESIGN,
          audience: [{ type: "team", id: DESIGN }],
          publicComments: false,
        },
        form,
      });
      return { bodies, uploaded };
    } finally {
      server.stop(true);
    }
  }

  test("a new link carries its team, audience, and commenting choice", async () => {
    const { bodies } = await captureBodies(false);
    expect(bodies[0]).toMatchObject({
      teamId: DESIGN,
      visibility: "private",
      audience: [{ type: "team", id: DESIGN }],
      publicComments: false,
    });
  });

  test("an updated link has its access re-set, audience included", async () => {
    const { bodies, uploaded } = await captureBodies(true);
    expect(bodies[1]).toMatchObject({
      visibility: "private",
      audience: [{ type: "team", id: DESIGN }],
      publicComments: false,
    });
    expect(uploaded.ok && uploaded.value.link.audience?.[0]?.name).toBe("Design");
  });
});
