export function serializeForJson<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, v) => {
      if (v instanceof Date) return v.toISOString();
      return v;
    }),
  ) as T;
}

export function toolJson<T>(data: T) {
  const serialized = serializeForJson(data);
  const text = JSON.stringify(serialized, null, 2);
  return {
    content: [{ type: "text" as const, text }],
    structuredContent: serialized,
  };
}

export function toolError(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true as const,
  };
}
