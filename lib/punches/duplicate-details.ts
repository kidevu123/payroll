type DuplicatePunchRow = {
  id: string;
  clockIn: Date;
  clockOut: Date | null;
  source: string;
  ngtecoRecordHash?: string | null;
};

type DuplicatePunchCluster = {
  employeeId: string;
  rows: DuplicatePunchRow[];
};

type EmployeeLabel = {
  id: string;
  displayName: string;
};

export type DuplicatePunchDetail = {
  employeeName: string;
  employeeId: string;
  localDate: string;
  localTimeRange: string;
  keepPunchId: string;
  voidPunchIds: string[];
  rows: Array<{
    id: string;
    source: string;
    localTimeRange: string;
    durationHours: string;
    willKeep: boolean;
  }>;
};

function formatLocalDate(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: timezone,
  }).format(date);
}

function formatLocalTime(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  }).format(date);
}

function durationMs(row: DuplicatePunchRow): number {
  return row.clockOut ? row.clockOut.getTime() - row.clockIn.getTime() : 0;
}

function rankDuplicateRows(
  rows: DuplicatePunchRow[],
): DuplicatePunchRow[] {
  return [...rows].sort((a, b) => {
    const aClosed = a.clockOut ? 1 : 0;
    const bClosed = b.clockOut ? 1 : 0;
    if (aClosed !== bClosed) return bClosed - aClosed;
    const aDur = durationMs(a);
    const bDur = durationMs(b);
    if (aDur !== bDur) return bDur - aDur;
    return a.id.localeCompare(b.id);
  });
}

function formatRange(row: DuplicatePunchRow, timezone: string): string {
  const start = formatLocalTime(row.clockIn, timezone);
  return row.clockOut
    ? `${start} - ${formatLocalTime(row.clockOut, timezone)}`
    : `${start} - open`;
}

export function buildDuplicatePunchDetails({
  timezone,
  employees,
  clusters,
}: {
  timezone: string;
  employees: EmployeeLabel[];
  clusters: DuplicatePunchCluster[];
}): DuplicatePunchDetail[] {
  const employeeNames = new Map(
    employees.map((employee) => [employee.id, employee.displayName]),
  );

  return clusters.map((cluster) => {
    const rankedRows = rankDuplicateRows(cluster.rows);
    const survivor = rankedRows[0]!;
    const voidedRows = rankedRows.slice(1);
    return {
      employeeName: employeeNames.get(cluster.employeeId) ?? cluster.employeeId,
      employeeId: cluster.employeeId,
      localDate: formatLocalDate(survivor.clockIn, timezone),
      localTimeRange: formatRange(survivor, timezone),
      keepPunchId: survivor.id,
      voidPunchIds: voidedRows.map((row) => row.id),
      rows: rankedRows.map((row) => ({
        id: row.id,
        source: row.source,
        localTimeRange: formatRange(row, timezone),
        durationHours: (durationMs(row) / 3_600_000).toFixed(3),
        willKeep: row.id === survivor.id,
      })),
    };
  });
}
