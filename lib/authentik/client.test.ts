import { describe, expect, it } from "vitest";
import { createAuthentikClient, AuthentikApiError } from "./client";

const CONFIG = { apiUrl: "https://auth.example.test/api/v3", token: "secret-token-value" };

type Call = { url: string; init: RequestInit | undefined };

function fakeFetch(responses: { status: number; body: unknown }[]) {
  const calls: Call[] = [];
  let i = 0;
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const r = responses[i++] ?? { status: 500, body: {} };
    // 204 is a null-body status: passing a body to the Response constructor
    // throws TypeError before the client ever sees the response.
    const body = r.status === 204 ? null : JSON.stringify(r.body);
    return new Response(body, {
      status: r.status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const AK_USER = {
  pk: 12,
  username: "juanh",
  name: "Juan Herrera",
  email: "juan@gmail.com",
  is_active: true,
};

describe("AuthentikClient", () => {
  it("finds a user by exact email and maps the payload", async () => {
    const { impl, calls } = fakeFetch([{ status: 200, body: { results: [AK_USER] } }]);
    const user = await createAuthentikClient(CONFIG, impl).findUserByEmail("juan@gmail.com");
    expect(user).toEqual({
      pk: 12,
      username: "juanh",
      name: "Juan Herrera",
      email: "juan@gmail.com",
      isActive: true,
    });
    expect(calls[0]!.url).toBe(
      "https://auth.example.test/api/v3/core/users/?email=juan%40gmail.com",
    );
  });

  it("sends the token as a bearer header", async () => {
    const { impl, calls } = fakeFetch([{ status: 200, body: { results: [] } }]);
    await createAuthentikClient(CONFIG, impl).findUserByEmail("nobody@x.com");
    const headers = new Headers(calls[0]!.init?.headers);
    expect(headers.get("authorization")).toBe("Bearer secret-token-value");
  });

  it("returns null when nothing matches", async () => {
    const { impl } = fakeFetch([{ status: 200, body: { results: [] } }]);
    expect(await createAuthentikClient(CONFIG, impl).findUserByEmail("nobody@x.com")).toBeNull();
  });

  it("creates a user as an active internal account with no password", async () => {
    const { impl, calls } = fakeFetch([{ status: 201, body: AK_USER }]);
    const created = await createAuthentikClient(CONFIG, impl).createUser({
      username: "juanh",
      name: "Juan Herrera",
      email: "juan@gmail.com",
      attributes: { payroll_user_id: "abc", payroll_role: "EMPLOYEE" },
    });
    expect(created.pk).toBe(12);
    expect(calls[0]!.init?.method).toBe("POST");
    const body = JSON.parse(String(calls[0]!.init?.body));
    expect(body).toEqual({
      username: "juanh",
      name: "Juan Herrera",
      email: "juan@gmail.com",
      is_active: true,
      type: "internal",
      path: "users",
      attributes: { payroll_user_id: "abc", payroll_role: "EMPLOYEE" },
    });
    expect(Object.keys(body)).not.toContain("password");
  });

  it("adds a user to a group by group uuid", async () => {
    const { impl, calls } = fakeFetch([{ status: 204, body: {} }]);
    await createAuthentikClient(CONFIG, impl).addUserToGroup("group-uuid-1", 12);
    expect(calls[0]!.url).toBe(
      "https://auth.example.test/api/v3/core/groups/group-uuid-1/add_user/",
    );
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({ pk: 12 });
  });

  it("throws AuthentikApiError on a non-2xx, and never puts the token in the message", async () => {
    // Two queued responses: the assertions below make two calls.
    const { impl } = fakeFetch([
      { status: 403, body: { detail: "forbidden" } },
      { status: 403, body: { detail: "forbidden" } },
    ]);
    const client = createAuthentikClient(CONFIG, impl);
    await expect(client.findUserByEmail("x@y.com")).rejects.toBeInstanceOf(AuthentikApiError);
    const err = await client.findUserByEmail("x@y.com").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AuthentikApiError);
    expect((err as AuthentikApiError).status).toBe(403);
    // Neither the token nor the queried email may reach an error string: both
    // end up in logs.
    expect((err as AuthentikApiError).message).not.toContain("secret-token-value");
    expect((err as AuthentikApiError).message).not.toContain("x@y.com");
  });
});
