// Authentik admin-API client.
//
// Scope is deliberately tiny and CREATE-ONLY: payroll may create a missing
// user and put it in the payroll group. It never updates or deletes an
// Authentik user — Authentik is the source of truth for profile identity, so
// writing back would fight it.
//
// Endpoints verified against the running instance's source (authentik
// core/api/users.py, core/api/groups.py):
//   GET  /core/users/?email=<email>        exact filter
//   GET  /core/users/?username=<username>  exact filter
//   POST /core/users/                      UserSerializer
//   GET  /core/groups/?name=<name>         exact filter
//   POST /core/groups/<uuid>/add_user/     body { pk }
//
// The token is never logged and never interpolated into an error message.

import { z } from "zod";

const REQUEST_TIMEOUT_MS = 10_000;

export class AuthentikApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "AuthentikApiError";
  }
}

const akUserSchema = z.object({
  pk: z.number(),
  uuid: z.string(),
  username: z.string(),
  name: z.string().default(""),
  email: z.string().default(""),
  is_active: z.boolean().default(true),
});
const akListSchema = z.object({ results: z.array(akUserSchema) });
const akGroupListSchema = z.object({
  results: z.array(z.object({ pk: z.string(), name: z.string() })),
});

export type AuthentikUser = {
  pk: number;
  uuid: string;
  username: string;
  name: string;
  email: string;
  isActive: boolean;
};
export type AuthentikGroup = { pk: string; name: string };

export type AuthentikClient = {
  findUserByEmail(email: string): Promise<AuthentikUser | null>;
  findUserByUsername(username: string): Promise<AuthentikUser | null>;
  createUser(input: {
    username: string;
    name: string;
    email: string;
    attributes: Record<string, unknown>;
  }): Promise<AuthentikUser>;
  findGroupByName(name: string): Promise<AuthentikGroup | null>;
  addUserToGroup(groupPk: string, userPk: number): Promise<void>;
};

export function readAuthentikConfig(): { apiUrl: string; token: string } | null {
  const apiUrl = process.env.AUTHENTIK_API_URL?.replace(/\/+$/, "");
  const token = process.env.AUTHENTIK_API_TOKEN;
  if (!apiUrl || !token) return null;
  return { apiUrl, token };
}

function toUser(raw: z.infer<typeof akUserSchema>): AuthentikUser {
  return {
    pk: raw.pk,
    uuid: raw.uuid,
    username: raw.username,
    name: raw.name,
    email: raw.email,
    isActive: raw.is_active,
  };
}

export function createAuthentikClient(
  config: { apiUrl: string; token: string },
  fetchImpl: typeof fetch = fetch,
): AuthentikClient {
  async function request(
    path: string,
    init?: { method?: string; body?: unknown },
  ): Promise<unknown> {
    const url = `${config.apiUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let resp: Response;
    try {
      resp = await fetchImpl(url, {
        method: init?.method ?? "GET",
        headers: {
          Authorization: `Bearer ${config.token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
        signal: controller.signal,
      });
    } catch (err) {
      throw new AuthentikApiError(
        `${init?.method ?? "GET"} ${path} failed: ${err instanceof Error ? err.message : "network error"}`,
      );
    } finally {
      clearTimeout(timer);
    }
    const text = await resp.text();
    if (!resp.ok) {
      // Path only — never the URL with query values, never the token.
      throw new AuthentikApiError(
        `${init?.method ?? "GET"} ${path.split("?")[0]} -> ${resp.status} ${text.slice(0, 200)}`,
        resp.status,
      );
    }
    if (text.length === 0) return {};
    try {
      return JSON.parse(text);
    } catch {
      throw new AuthentikApiError(`${path.split("?")[0]}: response was not JSON.`);
    }
  }

  async function findOne(query: string): Promise<AuthentikUser | null> {
    const parsed = akListSchema.safeParse(await request(`/core/users/?${query}`));
    if (!parsed.success) throw new AuthentikApiError("Unexpected /core/users/ payload.");
    const first = parsed.data.results[0];
    return first ? toUser(first) : null;
  }

  return {
    findUserByEmail: (email) => findOne(`email=${encodeURIComponent(email)}`),
    findUserByUsername: (username) => findOne(`username=${encodeURIComponent(username)}`),

    async createUser(input) {
      const raw = await request("/core/users/", {
        method: "POST",
        body: {
          username: input.username,
          name: input.name,
          email: input.email,
          is_active: true,
          type: "internal",
          path: "users",
          attributes: input.attributes,
        },
      });
      const parsed = akUserSchema.safeParse(raw);
      if (!parsed.success) throw new AuthentikApiError("Unexpected create-user payload.");
      return toUser(parsed.data);
    },

    async findGroupByName(name) {
      const parsed = akGroupListSchema.safeParse(
        await request(`/core/groups/?name=${encodeURIComponent(name)}`),
      );
      if (!parsed.success) throw new AuthentikApiError("Unexpected /core/groups/ payload.");
      return parsed.data.results[0] ?? null;
    },

    async addUserToGroup(groupPk, userPk) {
      await request(`/core/groups/${encodeURIComponent(groupPk)}/add_user/`, {
        method: "POST",
        body: { pk: userPk },
      });
    },
  };
}

/** Null when the integration is not configured — every caller treats that as "do nothing". */
export function getAuthentikClient(): AuthentikClient | null {
  const config = readAuthentikConfig();
  return config ? createAuthentikClient(config) : null;
}
