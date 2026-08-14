import type { Result } from "@velloo/result";
import type { MutationContext } from "../context.ts";
import {
  type AuditSnippetArgs,
  auditSnippet as auditSnippetImpl,
  type DarkModeAuditArgs,
  type DarkModeAuditResult,
  darkModeAudit as darkModeAuditImpl,
} from "../dark-mode-audit.ts";
import type { MutationError } from "../errors.ts";
import { type InspectArgs, type InspectResult, inspect as inspectImpl } from "../inspect.ts";

export function inspect(
  ctx: MutationContext,
  args: InspectArgs,
): Promise<Result<InspectResult, MutationError>> {
  return inspectImpl(ctx, args);
}
export function darkModeAudit(
  ctx: MutationContext,
  args: DarkModeAuditArgs,
): Promise<Result<DarkModeAuditResult, MutationError>> {
  return darkModeAuditImpl(ctx, args);
}
export function auditSnippet(
  ctx: MutationContext,
  args: AuditSnippetArgs,
): Promise<Result<DarkModeAuditResult, MutationError>> {
  return auditSnippetImpl(ctx, args);
}

export type {
  AuditSnippetArgs,
  DarkModeAuditArgs,
  DarkModeAuditResult,
  InspectArgs,
  InspectResult,
};
