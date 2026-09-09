import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Width override for a `DropdownMenuContent` hung off an icon button.
 *
 * Upstream sizes the panel to its trigger (`w-(--radix-dropdown-menu-trigger-width)`),
 * which is right for a select-shaped control and wrong for a 24px ⋯ button:
 * every such menu collapses to the `min-w-32` floor and its labels wrap to two
 * lines. `w-auto` shrink-wraps to the content instead — the same sizing
 * `DropdownMenuSubContent` already gets, which is why the submenus always
 * looked right and their parents didn't.
 */
export const ICON_MENU_WIDTH = "w-auto";
