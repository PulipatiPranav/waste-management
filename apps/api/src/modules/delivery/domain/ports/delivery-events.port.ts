import { type StopStatus } from '../stop-status';

export interface StopStatusChangedEvent {
  stopId: string;
  runId: string;
  partnerId: string;
  zoneId: string;
  subscriptionId: string;
  status: StopStatus;
  reason: string | null;
  runStatus: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';
  at: string;
}

/**
 * Outbound realtime events.
 *
 * A port so the use case does not know a WebSocket exists. It calls `publish` and moves
 * on; whether that reaches a socket.io room, a Redis pub/sub fan-out across replicas, or
 * nothing at all in a test, is the adapter's problem.
 *
 * Publishing MUST NOT be able to fail the delivery. A partner standing at a customer's
 * door has recorded the delivery; if the admin dashboard misses the live update because
 * a socket was down, that is a cosmetic problem and the dashboard can refetch. The
 * adapter swallows and logs its own errors — see the gateway.
 */
export interface DeliveryEventPublisher {
  stopStatusChanged(event: StopStatusChangedEvent): void;
}

export const DELIVERY_EVENT_PUBLISHER = Symbol('DELIVERY_EVENT_PUBLISHER');
