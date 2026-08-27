import type { PropDescriptor } from "@velloo/provider";
import { ValueField, type ValueKind } from "./ValueField.tsx";

interface Props {
  descriptor: PropDescriptor;
  /** Initial value from the design tree. Used to seed local draft state on mount. */
  initialValue: unknown;
  onChange(next: unknown): void;
}

function kindOf(descriptor: PropDescriptor): ValueKind {
  switch (descriptor.control) {
    case "boolean":
    case "number":
    case "color":
      return descriptor.control;
    case "icon":
    case "enum":
      // Without declared values these controls degrade to a plain text input.
      return descriptor.enumValues ? descriptor.control : "string";
    default:
      return "string";
  }
}

/**
 * Inspector prop editor: maps a manifest PropDescriptor onto the shared
 * ValueField. The parent passes a `key` tied to selection identity, so
 * switching selections remounts the field with a fresh value.
 */
export function PropField({ descriptor, initialValue, onChange }: Props) {
  const kind = kindOf(descriptor);
  return (
    <ValueField
      kind={kind}
      id={`prop-${descriptor.name}`}
      name={descriptor.name}
      label={
        <>
          {descriptor.name}
          {descriptor.optional ? null : <span className="text-destructive"> *</span>}
        </>
      }
      labelClassName="text-xs font-medium text-muted-foreground capitalize"
      initialValue={initialValue}
      onCommit={onChange}
      emptyAsUndefined
      allowUnset={descriptor.optional}
      enumValues={descriptor.enumValues}
      iconNames={kind === "icon" ? (descriptor.enumValues as string[]) : undefined}
      placeholder={kind === "color" ? "oklch(... 0 0) or #rrggbb" : undefined}
    />
  );
}
