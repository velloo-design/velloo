import { describe, expect, test } from "bun:test";
import { type CloudError, describeCloudError } from "../cloud-errors.ts";
import { describePublishError, type PublishError } from "../publish/errors.ts";

/**
 * CLI errors are the product — a failed publish shows the user exactly one
 * line, and this is where it comes from. These assert every variant renders
 * something specific and actionable, so a new failure mode cannot quietly ship
 * as a vague sentence.
 */

const CLOUD_SAMPLES: CloudError[] = [
  { kind: "Unreachable", detail: "ECONNREFUSED" },
  { kind: "Unreachable", detail: "ECONNREFUSED", url: "http://127.0.0.1:1" },
  { kind: "Unreachable", detail: "timed out after 60s", url: "http://x", timedOut: true },
  { kind: "HttpFailure", operation: "upload", status: 413, detail: "bundle too large" },
  { kind: "HttpFailure", operation: "upload", status: 503, detail: "storage unavailable" },
  { kind: "LoggedOut" },
  { kind: "LoggedOut", detail: "your session expired" },
  { kind: "ProtocolViolation", detail: "the cloud reused a link" },
  { kind: "UploadRaceLost" },
  { kind: "InsecureCloudUrl", url: "http://cloud.example" },
];

const PUBLISH_ONLY_SAMPLES: PublishError[] = [
  { kind: "CloudUnhealthy", detail: "database probe failed" },
  { kind: "NoScreens", root: "/tmp/design" },
  { kind: "NoBoardScreens" },
  { kind: "TeamNotFound", requested: "design" },
  { kind: "TeamAmbiguous", requested: "design" },
];

describe("describeCloudError", () => {
  test("every variant renders a non-empty, non-fallback sentence", () => {
    for (const error of CLOUD_SAMPLES) {
      const message = describeCloudError(error);
      expect(message.length, `${error.kind} rendered empty`).toBeGreaterThan(0);
      expect(message, `${error.kind} hit the fallback`).not.toBe("the cloud request failed");
    }
  });

  test("the sample list covers the whole union", () => {
    expect(new Set(CLOUD_SAMPLES.map((e) => e.kind)).size).toBe(6);
  });

  test("Unreachable names the target when it knows it", () => {
    expect(
      describeCloudError({ kind: "Unreachable", detail: "x", url: "http://127.0.0.1:1" }),
    ).toContain("cannot reach http://127.0.0.1:1");
    // …and stays sensible when it does not.
    expect(describeCloudError({ kind: "Unreachable", detail: "x" })).toContain(
      "cannot reach the cloud",
    );
  });

  test("a 5xx says it is the cloud's problem, a 4xx does not", () => {
    const server = describeCloudError({
      kind: "HttpFailure",
      operation: "upload",
      status: 503,
      detail: "storage unavailable",
    });
    const client = describeCloudError({
      kind: "HttpFailure",
      operation: "upload",
      status: 413,
      detail: "bundle too large",
    });
    expect(server).toContain("the cloud is having trouble");
    expect(client).not.toContain("the cloud is having trouble");
  });

  test("LoggedOut always points at the recovery", () => {
    expect(describeCloudError({ kind: "LoggedOut" })).toContain("velloo login");
    expect(describeCloudError({ kind: "LoggedOut", detail: "session expired" })).toContain(
      "velloo login",
    );
  });

  test("UploadRaceLost warns against a blind retry", () => {
    const message = describeCloudError({ kind: "UploadRaceLost" });
    expect(message).toContain("may have succeeded");
    expect(message).toContain("before retrying");
  });
});

describe("describePublishError", () => {
  test("renders publishing's own variants", () => {
    for (const error of PUBLISH_ONLY_SAMPLES) {
      expect(describePublishError(error).length).toBeGreaterThan(0);
    }
  });

  test("delegates cloud variants to the cloud renderer", () => {
    for (const error of CLOUD_SAMPLES) {
      expect(describePublishError(error)).toBe(describeCloudError(error));
    }
  });

  test("NoScreens names the folder it looked in", () => {
    expect(describePublishError({ kind: "NoScreens", root: "/tmp/design" })).toContain(
      "/tmp/design",
    );
  });
});
