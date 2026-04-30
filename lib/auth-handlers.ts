// Re-export Auth.js handlers — kept in /lib/ so Edge runtime is configurable
// later if we ever need it.
import { handlers } from "@/lib/auth";
export const { GET, POST } = handlers;
