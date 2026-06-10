import { cn } from "@/lib/utils";

export function SettingsSectionHeader({
  title,
  description,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("space-y-1 border-b border-border/60 pb-4", className)}>
      <h2 className="text-heading font-semibold tracking-tight text-text">
        {title}
      </h2>
      {description ? (
        <p className="text-body text-text-muted leading-relaxed max-w-2xl">
          {description}
        </p>
      ) : null}
    </header>
  );
}
