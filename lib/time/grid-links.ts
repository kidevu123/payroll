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
