export function serializeForJson<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, v) => {
      if (v instanceof Date) return v.toISOString();
      return v;
    }),
  ) as T;
}

export function toolResult(data: unknown): string {
  return JSON.stringify(serializeForJson(data), null, 2);
}

export function toolFailure(message: string): string {
  return JSON.stringify({ error: message });
}
