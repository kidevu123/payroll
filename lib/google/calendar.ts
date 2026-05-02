// Push events to a Google Calendar. Stand-alone — uses fetch + the
// access token from refreshAccessToken().

import { logger } from "@/lib/telemetry";
import { open as openSealed, type SealedSecret } from "@/lib/crypto/vault";
import { getSetting, setSetting } from "@/lib/settings/runtime";
import { refreshAccessToken } from "./oauth";

const EVENTS_BASE = "https://www.googleapis.com/calendar/v3/calendars";

export type TimeOffEvent = {
  /** Sticks to the calendar permanently as a stable id. Avoid collisions
   *  on re-push by deriving from the time-off-request id. */
  externalId: string;
  summary: string;
  description?: string;
  /** YYYY-MM-DD all-day. */
  startDate: string;
  /** YYYY-MM-DD all-day, exclusive end (Google convention). */
  endDateExclusive: string;
};

/**
 * Get a fresh access token using the stored refresh token. Surfaces a
 * clear error if the calendar isn't connected.
 */
async function freshAccessToken(): Promise<{ accessToken: string; calendarId: string }> {
  const cfg = await getSetting("googleCalendar");
  if (!cfg.refreshTokenSealed || !cfg.calendarId) {
    throw new Error("Google Calendar not connected.");
  }
  const sealed = JSON.parse(cfg.refreshTokenSealed) as SealedSecret;
  const refreshToken = openSealed(sealed);
  const { access_token } = await refreshAccessToken(refreshToken);
  return { accessToken: access_token, calendarId: cfg.calendarId };
}

/** Insert (or upsert via id) a time-off event on the configured calendar. */
export async function pushTimeOffEvent(input: TimeOffEvent): Promise<void> {
  const { accessToken, calendarId } = await freshAccessToken();
  // Google requires icalUID-style ids to be all-lowercase ascii;
  // collapse uuids to a deterministic form.
  const id = `payroll-${input.externalId}`.replace(/[^a-z0-9]/g, "");

  const body = {
    id,
    summary: input.summary,
    description: input.description ?? "",
    start: { date: input.startDate },
    end: { date: input.endDateExclusive },
    transparency: "transparent",
  };

  // Try update first (idempotent). If 404, fall back to insert.
  const updateRes = await fetch(
    `${EVENTS_BASE}/${encodeURIComponent(calendarId)}/events/${id}`,
    {
      method: "PUT",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  if (updateRes.ok) {
    await stampLastPushed();
    return;
  }
  if (updateRes.status !== 404 && updateRes.status !== 410) {
    const text = await updateRes.text().catch(() => "");
    logger.error(
      { status: updateRes.status, body: text.slice(0, 500), id },
      "google.calendar.update_failed",
    );
    throw new Error(`Calendar update failed: ${updateRes.status}`);
  }

  const insertRes = await fetch(
    `${EVENTS_BASE}/${encodeURIComponent(calendarId)}/events`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  if (!insertRes.ok) {
    const text = await insertRes.text().catch(() => "");
    logger.error(
      { status: insertRes.status, body: text.slice(0, 500), id },
      "google.calendar.insert_failed",
    );
    throw new Error(`Calendar insert failed: ${insertRes.status}`);
  }
  await stampLastPushed();
}

export async function deleteTimeOffEvent(externalId: string): Promise<void> {
  const { accessToken, calendarId } = await freshAccessToken();
  const id = `payroll-${externalId}`.replace(/[^a-z0-9]/g, "");
  const res = await fetch(
    `${EVENTS_BASE}/${encodeURIComponent(calendarId)}/events/${id}`,
    {
      method: "DELETE",
      headers: { authorization: `Bearer ${accessToken}` },
    },
  );
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    throw new Error(`Calendar delete failed: ${res.status}`);
  }
}

async function stampLastPushed(): Promise<void> {
  // Best-effort timestamp update for the /settings/google-calendar
  // panel. Failure here doesn't matter — the source of truth is the
  // calendar itself.
  try {
    const cfg = await getSetting("googleCalendar");
    // Use the same audit context shape setSetting requires. There's no
    // request-bound user when this fires from inside a calendar push,
    // so we tag it as a system action under the owner's id (read from
    // the env, optional). If unset, just skip the stamp.
    const actorId = process.env.SYSTEM_OWNER_USER_ID;
    if (!actorId) return;
    await setSetting(
      "googleCalendar",
      { ...cfg, lastPushedAt: new Date().toISOString() },
      { actorId, actorRole: "OWNER" },
    );
  } catch (err) {
    logger.warn({ err }, "google.calendar.stamp_last_pushed_failed");
  }
}
