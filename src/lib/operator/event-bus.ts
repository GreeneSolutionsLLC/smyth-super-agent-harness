/**
 * SSE event bus for Operator engagement updates.
 *
 * The page opens an EventSource on /api/operator/events?sessionId=X.
 * The tick loop, on each decision, calls emitEvent() to push events
 * to all connected clients for that session.
 *
 * v1: in-memory only. Subscribers + emitters are per-process. Lost on restart.
 * For multi-process deploys, swap for Redis pub/sub or similar.
 */

type Subscriber = (event: OperatorEvent) => void;

interface OperatorEvent {
  type: "tick" | "decision" | "injection" | "status" | "scheduled";
  timestamp: string;
  data: any;
}

const subscribers = new Map<string, Set<Subscriber>>();

export function subscribe(sessionId: string, fn: Subscriber): () => void {
  if (!subscribers.has(sessionId)) subscribers.set(sessionId, new Set());
  subscribers.get(sessionId)!.add(fn);
  return () => {
    subscribers.get(sessionId)?.delete(fn);
    if (subscribers.get(sessionId)?.size === 0) subscribers.delete(sessionId);
  };
}

export function emitEvent(sessionId: string, event: OperatorEvent): void {
  const subs = subscribers.get(sessionId);
  if (!subs || subs.size === 0) return;
  for (const fn of subs) {
    try { fn(event); } catch { /* don't let one bad subscriber kill the others */ }
  }
}

export function subscriberCount(sessionId: string): number {
  return subscribers.get(sessionId)?.size || 0;
}
