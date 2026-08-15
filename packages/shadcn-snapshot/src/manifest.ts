/**
 * Manifest types moved to `@velloo/provider`. This module re-exports them
 * so existing imports (`from "@velloo/shadcn-snapshot"`) keep working
 * through the migration; consumers should prefer importing from
 * `@velloo/provider` going forward.
 */
export type {
  ComponentDescriptor,
  ControlType,
  Manifest,
  PropDescriptor,
} from "@velloo/provider";
