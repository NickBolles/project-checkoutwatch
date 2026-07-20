const windows = new Map<string, { startedAt: number; count: number }>();

export function allowStatusRequest(key: string, now = Date.now(), limit = 60, windowMs = 60_000) {
  const current = windows.get(key);
  if (!current || now - current.startedAt >= windowMs) {
    windows.set(key, { startedAt: now, count: 1 });
    return true;
  }
  current.count += 1;
  return current.count <= limit;
}
