import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge Tailwind classes with conflict resolution.
 *   cn("px-2 py-1", condition && "text-brand", "px-3")
 *   → "py-1 text-brand px-3"
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
