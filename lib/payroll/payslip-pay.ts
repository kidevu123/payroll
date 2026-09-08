// "Does this payslip actually pay anything?" The publish job writes a
// payslip row for every hourly employee on the schedule, including people
// who did not work that week (zero hours, zero pay). Those rows keep the
// period math honest but must never reach the employee: no notification,
// no signature prompt, no line on the tablet's payday list. One predicate
// so every surface agrees on what "real pay" means.

export type PayslipPayFields = {
  hoursWorked: string | number;
  grossPayCents: number;
  taskPayCents: number;
  roundedPayCents: number;
};

export function payslipHasPay(p: PayslipPayFields): boolean {
  return (
    Number(p.hoursWorked) > 0 ||
    p.grossPayCents > 0 ||
    p.taskPayCents > 0 ||
    p.roundedPayCents > 0
  );
}
