// Tiny helper for tab pages whose UI lands in a later phase. Renders the
// section header with a clear "shipping in Phase N" empty state. The schemas
// already enforce the values; the UI just isn't wired yet.

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Construction } from "lucide-react";

export function PhaseStub({
  title,
  description,
  phase,
  detail,
}: {
  title: string;
  description: string;
  phase: number;
  detail?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <EmptyState
          icon={Construction}
          title={`Lands in Phase ${phase}`}
          description={
            detail ??
            "The data model and defaults are in place. The editing UI ships when this phase is built."
          }
        />
      </CardContent>
    </Card>
  );
}
