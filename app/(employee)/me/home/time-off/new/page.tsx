import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TimeOffForm } from "./form";

export default function TimeOffNew() {
  return (
    <main className="px-4 py-6 space-y-4">
      <Button asChild variant="ghost" size="sm">
        <Link href="/me/home">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
      </Button>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Request time off</CardTitle>
        </CardHeader>
        <CardContent>
          <TimeOffForm />
        </CardContent>
      </Card>
    </main>
  );
}
