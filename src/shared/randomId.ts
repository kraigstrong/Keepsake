// RFC 4122 v4 UUID from crypto.getRandomValues (already polyfilled for
// the RN runtime by react-native-get-random-values, per
// src/supabase/secureStore.ts) — avoids a whole new dependency for
// something this small. Its own module (not colocated with a feature)
// so callers with no other reason to depend on Supabase/image code — the
// cooking-event outbox (Phase 15) chief among them — don't pull those in
// transitively just to mint an id.
export function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
