import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Manifest, PropDescriptor } from "@velloo/provider";
import { exportsName } from "./host-source.ts";
import { shadcnAddName } from "./install.ts";

/**
 * Bounded host-source enrichment for the inspector and agent catalogue.
 * It intentionally recognizes the two shapes shadcn customizations most often
 * add: CVA variant maps and explicit fields on `<Component>Props` interfaces.
 * It is not a TypeScript type checker; unsupported syntax leaves the trusted
 * snapshot descriptor unchanged rather than inventing metadata.
 */
export function enrichManifestFromHost(manifest: Manifest, uiDir: string | null): Manifest {
  if (!uiDir) return manifest;
  const byFile = new Map<string, string>();
  const read = (addName: string): string | null => {
    if (byFile.has(addName)) return byFile.get(addName) ?? null;
    for (const ext of ["tsx", "ts", "jsx", "js"]) {
      const path = join(uiDir, `${addName}.${ext}`);
      if (!existsSync(path)) continue;
      const source = readFileSync(path, "utf8");
      byFile.set(addName, source);
      return source;
    }
    byFile.set(addName, "");
    return null;
  };

  return manifest.map((descriptor) => {
    if (descriptor.source === "velloo") return descriptor;
    const source = read(shadcnAddName(descriptor.id));
    // Only describe a component the file actually exports. A fork that renames
    // the primitive (card.tsx → Panel, badge.tsx → StatusChip) would otherwise
    // graft ITS variants onto the snapshot descriptor of a component the app
    // does not have, and the inspector would offer props that do not exist.
    if (!source || !exportsName(source, descriptor.id)) return descriptor;
    const additions = [
      ...variantPropsFor(source, descriptor.id),
      ...declaredPropsFor(source, descriptor.id),
    ];
    if (additions.length === 0) return descriptor;
    const props = [...descriptor.props];
    for (const addition of additions) {
      const index = props.findIndex((prop) => prop.name === addition.name);
      if (index >= 0) props[index] = { ...props[index], ...addition };
      else props.push(addition);
    }
    return {
      ...descriptor,
      props,
      designModeNotes: appendNote(
        descriptor.designModeNotes,
        "Props include variants detected from the app's component source.",
      ),
    };
  });
}

function appendNote(current: string | undefined, next: string): string {
  return current ? `${current} ${next}` : next;
}

function variantPropsFor(source: string, componentId: string): PropDescriptor[] {
  const out: PropDescriptor[] = [];
  const variantsAt = source.indexOf("variants:");
  if (variantsAt < 0) return out;
  const open = source.indexOf("{", variantsAt);
  const block = balancedBlock(source, open);
  if (!block) return out;
  for (const [name, value] of objectEntries(block.slice(1, -1))) {
    const values = objectEntries(value.slice(1, -1)).map(([key]) => key);
    if (values.length === 0) continue;
    out.push({
      name,
      type: `${values.map((value) => JSON.stringify(value)).join(" | ")} | undefined`,
      optional: true,
      control: "enum",
      enumValues: values,
      ...(defaultVariant(source, name) ? { defaultValue: defaultVariant(source, name) } : {}),
    });
  }
  // Avoid applying one file's variant surface to compound part exports.
  const primary = componentId === pascal(shadcnAddName(componentId));
  return primary ? out : [];
}

function defaultVariant(source: string, name: string): string | undefined {
  const at = source.indexOf("defaultVariants:");
  if (at < 0) return undefined;
  const open = source.indexOf("{", at);
  const block = balancedBlock(source, open);
  if (!block) return undefined;
  return objectEntries(block.slice(1, -1))
    .find(([key]) => key === name)?.[1]
    .replace(/["'`\s]/g, "");
}

function declaredPropsFor(source: string, componentId: string): PropDescriptor[] {
  const patterns = [
    new RegExp(`interface\\s+${componentId}Props(?:\\s+extends[^\\{]+)?\\s*\\{`, "m"),
    new RegExp(`type\\s+${componentId}Props\\s*=.*?&\\s*\\{`, "m"),
  ];
  const match = patterns.map((pattern) => pattern.exec(source)).find(Boolean);
  if (!match || match.index === undefined) return [];
  const open = source.indexOf("{", match.index);
  const block = balancedBlock(source, open);
  if (!block) return [];
  const out: PropDescriptor[] = [];
  const property = /(?:^|[;{\n])\s*([A-Za-z_$][\w$]*)(\?)?\s*:\s*([^;\n}]+)/gm;
  for (const found of block.slice(1, -1).matchAll(property)) {
    const name = found[1];
    const raw = found[3]?.trim();
    if (!name || !raw || name === "children") continue;
    const enumValues = [...raw.matchAll(/["']([^"']+)["']/g)].map((value) => value[1] as string);
    const optional = found[2] === "?" || raw.includes("undefined");
    out.push({
      name,
      type: optional && !raw.includes("undefined") ? `${raw} | undefined` : raw,
      optional,
      control:
        enumValues.length > 0
          ? "enum"
          : /boolean/.test(raw)
            ? "boolean"
            : /number/.test(raw)
              ? "number"
              : "string",
      ...(enumValues.length > 0 ? { enumValues } : {}),
    });
  }
  return out;
}

function balancedBlock(source: string, open: number): string | null {
  if (open < 0 || source[open] !== "{") return null;
  let depth = 0;
  let quote = "";
  for (let index = open; index < source.length; index++) {
    const char = source[index] as string;
    const prev = source[index - 1];
    if (quote) {
      if (char === quote && prev !== "\\") quote = "";
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") depth++;
    if (char === "}" && --depth === 0) return source.slice(open, index + 1);
  }
  return null;
}

function objectEntries(body: string): [string, string][] {
  const out: [string, string][] = [];
  let index = 0;
  while (index < body.length) {
    while (index < body.length && /[\s,]/.test(body[index] as string)) index++;
    const keyMatch = /^(?:["']([^"']+)["']|([A-Za-z_$][\w$-]*))\s*:/.exec(body.slice(index));
    if (!keyMatch) break;
    const key = keyMatch[1] ?? keyMatch[2];
    if (!key) break;
    index += keyMatch[0].length;
    while (/\s/.test(body[index] ?? "")) index++;
    if (body[index] === "{") {
      const block = balancedBlock(body, index);
      if (!block) break;
      out.push([key, block]);
      index += block.length;
      continue;
    }
    const end = body.indexOf(",", index);
    const value = body.slice(index, end < 0 ? body.length : end).trim();
    out.push([key, value]);
    index = end < 0 ? body.length : end + 1;
  }
  return out;
}

function pascal(value: string): string {
  return value
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}
