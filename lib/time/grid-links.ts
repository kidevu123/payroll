export type TimeGridPunchLink = {
  periodId: string;
  clockIn: Date | string;
};

export function resolveTimeCellPeriodId(args: {
  currentPeriodId: string;
  isAllTab: boolean;
  punches: TimeGridPunchLink[];
}): string {
  if (!args.isAllTab || args.punches.length === 0) {
    return args.currentPeriodId;
  }

  const [first] = [...args.punches].sort((a, b) => {
    const aTime = a.clockIn instanceof Date ? a.clockIn : new Date(a.clockIn);
    const bTime = b.clockIn instanceof Date ? b.clockIn : new Date(b.clockIn);
    return aTime.getTime() - bTime.getTime();
  });

  return first?.periodId || args.currentPeriodId;
}

export function safeLocalReturnTo(
  value: string | undefined,
  fallback: string,
): string {
  if (!value) return fallback;
  if (!value.startsWith("/") || value.startsWith("//")) return fallback;
  return value;
}

export function buildTimeEditorHref(args: {
  periodId: string;
  date: string;
  employeeId: string;
  returnTo?: string | undefined;
}): string {
  const base = `/time/${args.periodId}/${args.date}/${args.employeeId}`;
  const safeReturnTo = safeLocalReturnTo(args.returnTo, "");
  if (!safeReturnTo) return base;
  return `${base}?${new URLSearchParams({ returnTo: safeReturnTo })}`;
}
