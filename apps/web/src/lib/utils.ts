import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** From Vercel's chatbot template: strips the function-call placeholder some models emit. */
export function sanitizeText(text: string): string {
  return text.replace("<has_function_call>", "");
}
