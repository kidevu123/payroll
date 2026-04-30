# i18n glossary (English ↔ Spanish)

Authoritative term mapping for the Spanish translations in `messages/es.json`. Per §14, Spanish is first-class — not Google-translated.

| English | Español | Notes |
| --- | --- | --- |
| Payroll | Nómina | |
| Payslip / pay statement | Comprobante de pago | Plural: comprobantes de pago |
| Punch (clock-in/out event) | Marcaje | |
| Missed punch | Marcaje faltante | |
| Pay period | Período de pago | |
| Pay rate / hourly rate | Tarifa por hora | |
| Gross pay | Pago bruto | |
| Rounded pay | Pago redondeado | Surface alongside gross — never hide |
| Hours worked | Horas trabajadas | |
| Time off | Tiempo libre | |
| Approved | Aprobado | |
| Rejected | Rechazado | |
| Pending | Pendiente | |
| Sick leave | Licencia por enfermedad | |
| Personal leave | Permiso personal | |
| Unpaid leave | Permiso sin goce de sueldo | |
| Holiday | Día festivo | |
| Shift | Turno | |
| Day shift | Turno de día | The owner uses one shift named "Day" |
| Employee | Empleado / Empleada | Match grammatical gender to display name when possible |
| Owner | Propietario / Propietaria | |
| Admin | Administrador / Administradora | |
| Sign in | Iniciar sesión | |
| Sign out | Cerrar sesión | |
| Setup | Configuración inicial | First-run owner setup screen |
| Settings | Ajustes | |
| Dashboard | Panel | |
| Time off request | Solicitud de tiempo libre | |
| Missed punch request | Solicitud de marcaje faltante | |
| Notify / notification | Notificar / notificación | |
| Acknowledge | Confirmar | "I've reviewed" button → "Confirmar revisión" |
| Publish | Publicar | "Payroll published" → "Nómina publicada" |
| Lock period | Cerrar período | Locking is final-ish; soft-undoable but audited |
| Audit log | Registro de auditoría | |
| Run (payroll run) | Ejecución | "Current payroll run" → "Ejecución de nómina actual" |
| Ingest (NGTeco import) | Importación | "Ingest failed" → "Importación fallida" |

## Notes for translators

- Avoid US-business jargon ("crunch the numbers", "pay slip stub"). Use plain Spanish.
- Date and number formatting comes from `Intl` APIs — do not hardcode formats in strings.
- For sentence-case toggles in Spanish, use sentence case (Spanish prefers it for UI labels).
- For employees who chose `language: "es"`, also localize email "from" names if/when email is enabled.
- Owner expressed that Spanish ships in v1; recommend a native-speaker review pass before public release. Mark uncertain phrasings with `// TODO(es-review)` in the JSON files.
