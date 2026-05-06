// Server-side surface guard. The (admin) layout already does a
// path-based redirect, but defense-in-depth: this guarantees the
// role × surface matrix is enforced for /ngteco/* even if the
// middleware-injected x-pathname header is somehow missing.

import { requireSurface } from "@/lib/auth-guards";

export default async function Layout({ children }: { children: React.ReactNode }) {
  await requireSurface("/ngteco");
  return <>{children}</>;
}
