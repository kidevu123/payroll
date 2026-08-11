import { getTranslations } from "next-intl/server";
import { ExceptionBadge } from "@/components/domain/exception-badge";
import { formatOptionalTimeShort } from "@/lib/utils";
import type { MissedPunchReviewContext } from "@/lib/missed-punch/review-context";
import type { MissedPunchIssue } from "@/lib/missed-punch/claim";
import { cn } from "@/lib/utils";

type DisplayIssue = "MISSING_IN" | "MISSING_OUT" | "NO_PUNCH";

function isBadgeIssue(issue: MissedPunchIssue | null): issue is DisplayIssue {
  return (
    issue === "MISSING_IN" ||
    issue === "MISSING_OUT" ||
    issue === "NO_PUNCH"
  );
}

function highlightProposed(
  side: "in" | "out",
  ctx: MissedPunchReviewContext,
): boolean {
  if (ctx.issue === "MISSING_OUT") return side === "out";
  if (ctx.issue === "MISSING_IN") return side === "in";
  return true;
}

function mergedIn(ctx: MissedPunchReviewContext): Date | null {
  return ctx.onFileClockIn ?? ctx.proposedClockIn;
}

function mergedOut(ctx: MissedPunchReviewContext): Date | null {
  return ctx.onFileClockOut ?? ctx.proposedClockOut;
}

export async function MissedPunchReviewSummary({
  ctx,
  timezone,
}: {
  ctx: MissedPunchReviewContext;
  timezone: string;
}) {
  const t = await getTranslations("missedPunchReview");

  const approveHint =
    ctx.issue === "MISSING_OUT"
      ? t("approveHintMissingOut")
      : ctx.issue === "MISSING_IN"
        ? t("approveHintMissingIn")
        : ctx.proposedClockIn && ctx.proposedClockOut
          ? t("approveHintFull")
          : t("approveHintProposed");

  const timeCell = (
    label: string,
    time: Date | null | undefined,
    highlight: boolean,
  ) => (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-text-muted shrink-0">{label}</span>
      <span
        className={cn(
          "tabular-nums",
          highlight
            ? "font-semibold text-warning-900 bg-warning-100 px-1.5 py-0.5 rounded"
            : time
              ? "text-text font-medium"
              : "text-text-muted",
        )}
      >
        {formatOptionalTimeShort(time ?? null, timezone)}
      </span>
    </div>
  );

  const showOnFile =
    ctx.onFileClockIn !== null || ctx.onFileClockOut !== null;
  const showProposed =
    (ctx.proposedClockIn !== null &&
      ctx.proposedClockIn !== ctx.onFileClockIn) ||
    (ctx.proposedClockOut !== null &&
      ctx.proposedClockOut !== ctx.onFileClockOut) ||
    (!showOnFile &&
      (ctx.proposedClockIn !== null || ctx.proposedClockOut !== null));

  return (
    <div className="space-y-2">
      {isBadgeIssue(ctx.issue) ? (
        <ExceptionBadge issue={ctx.issue} className="text-[10px]" />
      ) : null}

      {showOnFile ? (
        <div className="rounded-input border border-border bg-surface-2/50 px-2 py-1.5 space-y-0.5">
          <p className="text-micro uppercase text-text-muted">
            {t("onFile")}
          </p>
          {timeCell(t("clockIn"), ctx.onFileClockIn, false)}
          {timeCell(t("clockOut"), ctx.onFileClockOut, false)}
        </div>
      ) : null}

      {showProposed ? (
        <div className="rounded-input border border-warning-200 bg-warning-50/60 px-2 py-1.5 space-y-0.5">
          <p className="text-micro uppercase text-warning-900">
            {t("employeeProposes")}
          </p>
          {ctx.proposedClockIn !== null &&
          ctx.proposedClockIn !== ctx.onFileClockIn
            ? timeCell(
                t("clockIn"),
                ctx.proposedClockIn,
                highlightProposed("in", ctx),
              )
            : null}
          {ctx.proposedClockOut !== null
            ? timeCell(
                t("clockOut"),
                ctx.proposedClockOut,
                highlightProposed("out", ctx),
              )
            : null}
        </div>
      ) : null}

      <p className="text-center text-[10px] text-text-muted">{t("afterApprove")}</p>
      <p className="text-center tabular-nums text-[11px] font-medium tabular-nums">
        {formatOptionalTimeShort(mergedIn(ctx), timezone)}
        <span className="text-text-muted font-normal mx-1">→</span>
        <span
          className={cn(
            highlightProposed("out", ctx) && ctx.onFileClockOut === null
              ? "text-warning-900"
              : "text-text",
          )}
        >
          {formatOptionalTimeShort(mergedOut(ctx), timezone)}
        </span>
      </p>

      <p className="text-[10px] text-warning-900/90 leading-snug">{approveHint}</p>
    </div>
  );
}
