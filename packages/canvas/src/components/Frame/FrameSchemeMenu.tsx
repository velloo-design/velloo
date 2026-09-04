import type { FrameScheme } from "@velloo/schema";
import { Check, Moon, Sun, SunMoon } from "lucide-react";
import {
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "../ui/dropdown-menu.tsx";
import { frameSchemeOptions } from "./frame-scheme.ts";

interface FrameSchemeMenuProps {
  frameLabel: string;
  scheme?: FrameScheme | undefined;
  canvasDefault: FrameScheme;
  onChange: (scheme: FrameScheme | null) => void;
}

function schemeIcon(scheme: FrameScheme | null) {
  if (scheme === "light") return <Sun />;
  if (scheme === "dark") return <Moon />;
  return <SunMoon />;
}

/** The frame's color-scheme pin, as a submenu of the frame's actions menu. */
export function FrameSchemeMenu({
  frameLabel,
  scheme,
  canvasDefault,
  onChange,
}: FrameSchemeMenuProps) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        {schemeIcon(scheme ?? null)}
        Color scheme
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        {frameSchemeOptions(frameLabel, canvasDefault, scheme).map((option) => (
          <DropdownMenuItem
            key={option.label}
            aria-label={option.ariaLabel}
            onSelect={() => onChange(option.value)}
          >
            {schemeIcon(option.value)}
            {option.label}
            {option.current ? <Check className="ml-auto" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
