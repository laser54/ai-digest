export function encodeDigestStreamEvent(type, payload) {
  return `${JSON.stringify({ type, ...payload })}\n`;
}
