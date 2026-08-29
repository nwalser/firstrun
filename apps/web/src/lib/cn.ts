import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * The shadcn class helper: conditional classes, then Tailwind conflict
 * resolution so a caller's `px-6` beats a component's default `px-4` instead of
 * depending on stylesheet order.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
