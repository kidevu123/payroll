"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PrintPageButton({ label }: { label: string }) {
  return (
    <Button type="button" variant="outline" onClick={() => window.print()}>
      <Printer className="h-4 w-4" aria-hidden />
      {label}
    </Button>
  );
}
