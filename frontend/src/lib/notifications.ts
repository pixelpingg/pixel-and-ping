export interface NotificationRow {
  id: string;
  title: string;
  message: string;
  level: string;
  isRead: boolean;
  metadata: string | null;
  createdAt: string;
}

/**
 * Broadcasts (see worker/src/routes/notifications.ts's POST /broadcast)
 * store per-locale title/message text in `metadata` as
 * `{ broadcast: true, titles: {en,fa,ru,zh}, messages: {...} }`. System-
 * generated notifications (server down, endpoint unhealthy, etc.) have
 * no such metadata and always fall back to their plain `title`/`message`
 * column, which is intentionally English-only — translating system
 * alerts is a separate, much larger undertaking than translating the
 * handful of messages an admin explicitly composes.
 */
export function localizedNotificationText(n: NotificationRow, field: "titles" | "messages", locale: string): string {
  const fallback = field === "titles" ? n.title : n.message;
  if (!n.metadata) return fallback;
  try {
    const meta = JSON.parse(n.metadata);
    const bag = meta?.[field];
    if (bag && typeof bag === "object") return bag[locale] ?? bag[Object.keys(bag)[0]] ?? fallback;
  } catch {
    /* not a broadcast notification / unparsable metadata */
  }
  return fallback;
}
