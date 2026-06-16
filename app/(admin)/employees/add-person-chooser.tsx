import Link from "next/link";
import { Clock, FileText, KeyRound, ChevronRight } from "lucide-react";

/**
 * Step 1 of the "Add person" flow. Replaces the old forced-Classification
 * dropdown with an intuitive 3-way fork. Each card links back to
 * /employees/new with a `?kind=` query param that Step 2 reads to decide
 * which form to render (and how to pre-select the employee classification).
 *
 * Pure server component — just links, no client state needed.
 */

type ChoiceKind = "hourly" | "salaried" | "login";

type Choice = {
  kind: ChoiceKind;
  icon: typeof Clock;
  title: string;
  blurb: string;
  example: string;
};

const CHOICES: ReadonlyArray<Choice> = [
  {
    kind: "hourly",
    icon: Clock,
    title: "Hourly",
    blurb: "Punches a clock on a schedule. Their punches roll up into payroll.",
    example: "e.g. line staff on the weekly, semi-monthly, or monthly cycle.",
  },
  {
    kind: "salaried",
    icon: FileText,
    title: "Salaried",
    blurb:
      "Paid externally. No clock — you upload their paystub on a cadence.",
    example: "e.g. Seri, Sahil.",
  },
  {
    kind: "login",
    icon: KeyRound,
    title: "Login only",
    blurb:
      "No clock, no pay through the app. Just an app login and a role.",
    example: "e.g. an accountant who needs Cash drawer + Reports access.",
  },
];

export function AddPersonChooser() {
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {CHOICES.map(({ kind, icon: Icon, title, blurb, example }) => (
        <li key={kind}>
          <Link
            href={`/employees/new?kind=${kind}`}
            className="group flex h-full flex-col gap-3 rounded-card border border-border/70 bg-surface p-5 shadow-card transition-[box-shadow,border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-brand-700/50 hover:shadow-card-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          >
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-input bg-brand-700/10 text-brand-700">
              <Icon className="h-5 w-5" aria-hidden="true" />
            </span>
            <span className="flex items-center gap-1 text-base font-semibold text-text">
              {title}
              <ChevronRight
                className="h-4 w-4 text-text-muted transition-transform duration-200 group-hover:translate-x-0.5"
                aria-hidden="true"
              />
            </span>
            <span className="text-sm text-text-muted">{blurb}</span>
            <span className="mt-auto text-xs text-text-muted/80">{example}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
