import type { ButtonHTMLAttributes } from "react";

const buttonVariants = {
  variants: {
    variant: {
      default: "bg-black text-white",
      launch: "bg-fuchsia-600 text-white",
    },
    size: {
      default: "h-9 px-4",
      compact: "h-7 px-2",
    },
  },
  defaultVariants: {
    variant: "default",
    size: "default",
  },
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "launch";
  size?: "default" | "compact";
  busy?: boolean;
}

export function Button({ variant = "default", size = "default", busy, ...props }: ButtonProps) {
  return (
    <button
      {...props}
      data-host-button="true"
      data-host-variant={variant}
      data-host-size={size}
      aria-busy={busy || undefined}
    />
  );
}

void buttonVariants;
