import type { HallMonitorFinding, HallMonitorSeverity } from "./types";

export type HallMonitorDisplay = {
  severity: HallMonitorSeverity;
  severityLabel: string;
  title: string;
  meaning: string;
  action: string;
  bullets: string[];
  href?: string;
  hrefLabel?: string;
};

const SEVERITY_LABEL: Record<HallMonitorSeverity, string> = {
  fail: "Fix before payroll",
  warn: "Review this week",
  ok: "Looks good",
};

function simplifyNgtecoError(raw: string | null | undefined): string {
  if (!raw) return "The automatic time-clock import failed (no error message saved).";
  if (raw.includes("View Attendance Punch")) {
    return "Milo could not open the attendance page on NGTeco — the website may have changed or you need to log in again.";
  }
  if (raw.includes("username field")) {
    return "Milo could not log in to NGTeco — the login screen may have changed.";
  }
  if (raw.includes("challenge") || raw.includes("CAPTCHA")) {
    return "NGTeco asked for extra verification (CAPTCHA or 2FA). Log in manually once, then retry.";
  }
  return raw.length > 120 ? `${raw.slice(0, 120)}…` : raw;
}

function formatPollTime(iso: string | undefined, tz: string): string {
  if (!iso) return "unknown time";
  return new Date(iso).toLocaleString("en-US", {
    timeZone: tz,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Turn a stored finding into owner-friendly copy (works on old reports too). */
export function formatFindingForDisplay(
  f: HallMonitorFinding,
  ctx: { timezone: string; employeeNameById?: Map<string, string> },
): HallMonitorDisplay {
  const d = f.detail ?? {};
  const names = Array.isArray(d.names) ? (d.names as string[]) : [];
  const errors = Array.isArray(d.errors) ? (d.errors as (string | null)[]) : [];
  const samples = Array.isArray(d.samples) ? d.samples : [];
  const byIssue =
    d.byIssue && typeof d.byIssue === "object"
      ? (d.byIssue as Record<string, number>)
      : null;
  const periodRange =
    typeof d.periodStart === "string" && typeof d.periodEnd === "string"
      ? `${d.periodStart} – ${d.periodEnd}`
      : null;

  // New reports with explicit copy
  if (f.title && f.meaning && f.action) {
    return {
      severity: f.severity,
      severityLabel: SEVERITY_LABEL[f.severity],
      title: f.title,
      meaning: f.meaning,
      action: f.action,
      bullets: f.bullets ?? [],
      ...(f.href ? { href: f.href, hrefLabel: f.hrefLabel ?? "Open" } : {}),
    };
  }

  // Legacy / inferred copy from category + message
  if (f.category === "ngteco_sync") {
    if (f.message.includes("No successful")) {
      return {
        severity: f.severity,
        severityLabel: SEVERITY_LABEL[f.severity],
        title: "Time clock has never synced successfully",
        meaning:
          "Milo pulls punches from NGTeco automatically. Without a successful import, nobody’s hours update on their own.",
        action:
          "Open NGTeco settings, confirm credentials, and run Poll now until it succeeds.",
        bullets: [],
        href: "/ngteco",
        hrefLabel: "Open NGTeco",
      };
    }
    if (f.message.includes("ago")) {
      const hours = f.message.match(/(\d+)h/)?.[1] ?? "?";
      return {
        severity: f.severity,
        severityLabel: SEVERITY_LABEL[f.severity],
        title: `Time clock sync is ${hours} hours behind`,
        meaning:
          "New clock-ins and clock-outs from the fingerprint machines may not be in Milo yet. Payroll could be wrong until sync catches up.",
        action:
          "Run Poll now from the dashboard or NGTeco page. If it keeps failing, fix login first (see failed imports below).",
        bullets: [
          `Last good import: ${formatPollTime(d.finishedAt as string | undefined, ctx.timezone)}`,
          typeof d.eventsScraped === "number"
            ? `${d.eventsScraped} punch events were read on that run`
            : "",
        ].filter(Boolean),
        href: "/dashboard",
        hrefLabel: "Go to dashboard",
      };
    }
    if (f.message.includes("failed")) {
      const count = f.message.match(/(\d+)/)?.[1] ?? String(errors.length);
      return {
        severity: f.severity,
        severityLabel: SEVERITY_LABEL[f.severity],
        title: `${count} failed time-clock import(s) this week`,
        meaning:
          "The automatic login or scrape to NGTeco broke. When this happens, punches stop flowing into Milo until it is fixed.",
        action:
          "Try Poll now. If errors repeat, refresh NGTeco login (Settings → NGTeco) or update scraper selectors per the troubleshooting guide.",
        bullets: errors.slice(0, 4).map((e) => simplifyNgtecoError(e)),
        href: "/ngteco",
        hrefLabel: "Open NGTeco",
      };
    }
    return {
      severity: f.severity,
      severityLabel: SEVERITY_LABEL[f.severity],
      title: "Time clock sync",
      meaning: f.message,
      action: "Check NGTeco poll status and run Poll now.",
      bullets: [],
      href: "/ngteco",
      hrefLabel: "Open NGTeco",
    };
  }

  if (f.category === "roster" && names.length > 0) {
    return {
      severity: f.severity,
      severityLabel: SEVERITY_LABEL[f.severity],
      title: `${names.length} employee(s) not linked to the time clock`,
      meaning:
        "These people are active and hourly in Milo, but Milo does not know their NGTeco ID. Automatic imports will skip them — you would only see manual punches or fixes.",
      action:
        "Open each employee, set their NGTeco employee ref (from the time clock roster), then run Poll now.",
      bullets: names,
      href: "/employees",
      hrefLabel: "Open employees",
    };
  }

  if (f.category === "coverage" && f.message.includes("unresolved")) {
    const n = f.message.match(/(\d+)/)?.[1] ?? "?";
    return {
      severity: f.severity,
      severityLabel: SEVERITY_LABEL[f.severity],
      title: `${n} missed-punch problem(s) still open`,
      meaning:
        "Someone clocked oddly or not at all, and the issue is not closed yet. These can change pay if you run payroll before fixing or approving fixes.",
      action:
        "Open Calendar → Pending, or the Time grid. Close open shifts or approve employee corrections.",
      bullets: periodRange ? [`Pay period: ${periodRange}`] : [],
      href: "/calendar",
      hrefLabel: "Open calendar",
    };
  }

  if (f.category === "coverage" && f.message.includes("exception")) {
    const n = f.message.match(/(\d+)/)?.[1] ?? "?";
    const issueLines = byIssue
      ? Object.entries(byIssue).map(([k, v]) => {
          const label =
            k === "NO_PUNCH"
              ? "No punch on a work day"
              : k === "MISSING_OUT"
                ? "Clocked in but no clock-out"
                : k === "MISSING_IN"
                  ? "Clock-out only (missing clock-in)"
                  : k.replace(/_/g, " ").toLowerCase();
          return `${v}× ${label}`;
        })
      : [];
    return {
      severity: f.severity,
      severityLabel: SEVERITY_LABEL[f.severity],
      title: `${n} attendance issue(s) this week`,
      meaning:
        "Based on punches, time off, and holidays, Milo flagged days that still look wrong for this pay period.",
      action:
        "Review the Time grid and missed-punch alerts; fix or approve before locking the period.",
      bullets: issueLines,
      href: "/time",
      hrefLabel: "Open time grid",
    };
  }

  if (f.category === "punch_integrity" && f.message.includes("open shift")) {
    const n = f.message.match(/(\d+)/)?.[1] ?? "?";
    const empMap = ctx.employeeNameById;
    const lines = (
      samples as { employeeId?: string; clockIn?: string }[]
    ).map((s) => {
      const name = s.employeeId
        ? (empMap?.get(s.employeeId) ?? "Employee")
        : "Employee";
      const when = s.clockIn
        ? formatPollTime(s.clockIn, ctx.timezone)
        : "";
      return when ? `${name} — clocked in ${when}, no clock-out yet` : name;
    });
    return {
      severity: f.severity,
      severityLabel: SEVERITY_LABEL[f.severity],
      title: `${n} shift(s) missing a clock-out`,
      meaning:
        "Someone punched in but never punched out (or out was not imported). Hours for that day are incomplete until you close the shift.",
      action:
        "Open the Time grid, click the day, and close the open shift with the real clock-out time.",
      bullets: lines,
      href: "/time",
      hrefLabel: "Open time grid",
    };
  }

  if (f.category === "punch_integrity" && f.message.includes("duplicate")) {
    const n = f.message.match(/(\d+)/)?.[1] ?? "?";
    return {
      severity: f.severity,
      severityLabel: SEVERITY_LABEL[f.severity],
      title: `${n} possible duplicate punch(es)`,
      meaning:
        "The same shift may exist twice (common when poll and manual entry disagree by a minute). Duplicates can double hours if left alone.",
      action:
        "On the payroll period page, use Find duplicates and merge, keeping the correct shift.",
      bullets: periodRange ? [`Period: ${periodRange}`] : [],
      href: "/payroll",
      hrefLabel: "Open payroll",
    };
  }

  if (f.category === "pending_work" && f.message.includes("missed-punch")) {
    const n = f.message.match(/(\d+)/)?.[1] ?? "?";
    return {
      severity: f.severity,
      severityLabel: SEVERITY_LABEL[f.severity],
      title: `${n} employee fix waiting for your OK`,
      meaning:
        "Someone submitted a missed punch correction. Until you approve or reject it, payroll does not use their proposed time.",
      action:
        "Open Calendar → Pending. Check on-file clock-in vs what they proposed, then Approve or Reject.",
      bullets: [],
      href: "/calendar",
      hrefLabel: "Open pending",
    };
  }

  if (f.category === "pending_work" && f.message.includes("time-off")) {
    const n = f.message.match(/(\d+)/)?.[1] ?? "?";
    return {
      severity: f.severity,
      severityLabel: SEVERITY_LABEL[f.severity],
      title: `${n} time-off request(s) waiting`,
      meaning: "Employees asked for time off that you have not approved yet.",
      action: "Open Calendar and approve or reject each request.",
      bullets: [],
      href: "/calendar",
      hrefLabel: "Open calendar",
    };
  }

  if (f.category === "pay_math") {
    const driftSamples = samples as {
      name?: string;
      hoursDelta?: number;
      centsDelta?: number;
    }[];
    return {
      severity: f.severity,
      severityLabel: SEVERITY_LABEL[f.severity],
      title: "Pay on file does not match current punches",
      meaning:
        "Stored payslip hours or dollars differ from what Milo calculates from punches today. That can happen after edits, imports, or rate changes.",
      action:
        "Open the payroll period, look for Hours drift warnings, and recompute affected employees before publish.",
      bullets: driftSamples.slice(0, 8).map((s) => {
        const parts: string[] = [];
        if (s.name) parts.push(s.name);
        if (typeof s.hoursDelta === "number" && s.hoursDelta > 0.5)
          parts.push(`hours off by ${s.hoursDelta.toFixed(1)}`);
        if (typeof s.centsDelta === "number" && s.centsDelta > 100)
          parts.push(`pay off by $${(s.centsDelta / 100).toFixed(2)}`);
        return parts.join(" — ") || "Employee";
      }),
      href: "/payroll",
      hrefLabel: "Open payroll",
    };
  }

  if (f.severity === "ok") {
    return {
      severity: "ok",
      severityLabel: SEVERITY_LABEL.ok,
      title: "No urgent problems in this check",
      meaning: f.message,
      action: "Nothing required right now.",
      bullets: [],
    };
  }

  return {
    severity: f.severity,
    severityLabel: SEVERITY_LABEL[f.severity],
    title: f.category.replace(/_/g, " "),
    meaning: f.message,
    action: "Review in the admin screens linked from the dashboard.",
    bullets: [],
  };
}

export function sortFindingsForDisplay<T extends { severity: HallMonitorSeverity }>(
  items: T[],
): T[] {
  const order: Record<HallMonitorSeverity, number> = {
    fail: 0,
    warn: 1,
    ok: 2,
  };
  return [...items].sort((a, b) => order[a.severity] - order[b.severity]);
}
