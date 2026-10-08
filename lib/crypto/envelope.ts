// Type guard for a value sealed by lib/crypto/vault (AES-GCM ciphertext +
// iv). Was copied into five files that read sealed settings.
export function isEnvelope(value: unknown): value is { ciphertext: string; iv: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "ciphertext" in value &&
    "iv" in value
  );
}
