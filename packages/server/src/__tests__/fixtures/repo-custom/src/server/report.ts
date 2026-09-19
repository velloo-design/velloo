"use server";
import { readFileSync } from "node:fs";

export function renderReport(): string {
  return readFileSync("/dev/null", "utf8");
}
