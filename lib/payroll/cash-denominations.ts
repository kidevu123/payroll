export const CASH_DENOMINATIONS = [100, 50, 20, 10, 5, 1] as const;

export type CashDenomination = (typeof CASH_DENOMINATIONS)[number];
export type CashBillCounts = Record<CashDenomination, number>;

export type CashDenominationInput = {
  employeeId: string;
  employeeName: string;
  roundedPayCents: number;
};

export type PayrollCashPayslip = {
  employeeId: string;
  roundedPayCents: number;
  voidedAt?: Date | string | null;
};

export type PayrollCashEmployee = {
  id: string;
  displayName: string;
};

export type PayrollCashComputedRow = {
  employee: PayrollCashEmployee;
  result: { roundedCents: number };
};

export type PayrollCashTempWorker = {
  id: string;
  workerName: string;
  amountCents: number;
  deletedAt?: Date | string | null;
};

export type CashDenominationRow = CashDenominationInput & {
  bills: CashBillCounts;
  remainderCents: number;
};

export type CashDenominationSummary = {
  rows: CashDenominationRow[];
  denominations: {
    value: CashDenomination;
    count: number;
    totalCents: number;
  }[];
  totalCents: number;
  remainderCents: number;
};

function emptyBillCounts(): CashBillCounts {
  return { 100: 0, 50: 0, 20: 0, 10: 0, 5: 0, 1: 0 };
}

function billsForAmount(cents: number): {
  bills: CashBillCounts;
  remainderCents: number;
} {
  const bills = emptyBillCounts();
  let remainingDollars = Math.floor(cents / 100);

  for (const denomination of CASH_DENOMINATIONS) {
    bills[denomination] = Math.floor(remainingDollars / denomination);
    remainingDollars %= denomination;
  }

  return { bills, remainderCents: cents % 100 };
}

export function buildCashDenominationSummary(
  inputs: CashDenominationInput[],
): CashDenominationSummary {
  const totals = emptyBillCounts();
  let totalCents = 0;
  let remainderCents = 0;

  const rows = inputs
    .filter((input) => input.roundedPayCents > 0)
    .map((input) => {
      const row = {
        ...input,
        ...billsForAmount(input.roundedPayCents),
      };
      totalCents += input.roundedPayCents;
      remainderCents += row.remainderCents;
      for (const denomination of CASH_DENOMINATIONS) {
        totals[denomination] += row.bills[denomination];
      }
      return row;
    })
    .sort((a, b) => a.employeeName.localeCompare(b.employeeName));

  return {
    rows,
    totalCents,
    remainderCents,
    denominations: CASH_DENOMINATIONS.map((value) => ({
      value,
      count: totals[value],
      totalCents: totals[value] * value * 100,
    })),
  };
}

export function buildPayrollCashInputs(args: {
  payslips: PayrollCashPayslip[];
  employees: PayrollCashEmployee[];
  computedRows: PayrollCashComputedRow[];
  tempWorkers: PayrollCashTempWorker[];
}): CashDenominationInput[] {
  const employeeById = new Map(args.employees.map((e) => [e.id, e]));
  const activePayslips = args.payslips.filter((p) => !p.voidedAt);
  const employeeInputs =
    activePayslips.length > 0
      ? activePayslips.flatMap((p) => {
          const employee = employeeById.get(p.employeeId);
          if (!employee) return [];
          return [
            {
              employeeId: p.employeeId,
              employeeName: employee.displayName,
              roundedPayCents: p.roundedPayCents,
            },
          ];
        })
      : args.computedRows.map((row) => ({
          employeeId: row.employee.id,
          employeeName: row.employee.displayName,
          roundedPayCents: row.result.roundedCents,
        }));

  const tempInputs = args.tempWorkers
    .filter((worker) => !worker.deletedAt)
    .map((worker) => ({
      employeeId: `temp:${worker.id}`,
      employeeName: worker.workerName,
      roundedPayCents: worker.amountCents,
    }));

  return [...employeeInputs, ...tempInputs];
}
