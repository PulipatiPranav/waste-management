'use client';

import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';

import { SOCKET_ORIGIN } from '../env';
import { getAccessToken } from '../auth/session';

/** Mirrors the API's StopStatusChangedEvent — the payload of `delivery.stop_status_changed`. */
export interface StopStatusEvent {
  stopId: string;
  runId: string;
  partnerId: string;
  zoneId: string;
  subscriptionId: string;
  status: 'PENDING' | 'DELIVERED' | 'FAILED' | 'SKIPPED';
  reason: string | null;
  runStatus: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';
  at: string;
}

interface DeliveryFeed {
  connected: boolean;
  events: StopStatusEvent[];
}

/**
 * Subscribes to the Phase 3 delivery gateway (`/delivery` namespace) for a live feed of stop
 * status changes. The token goes in the handshake `auth` payload — NOT the query string, which
 * proxies and browser history log — matching how the gateway authenticates. Only staff sockets
 * are admitted to the admin room, so a non-staff console user simply sees nothing.
 *
 * Keeps the most recent `max` events in memory; the feed is a live tail, not a store.
 */
export function useDeliveryFeed(max = 50): DeliveryFeed {
  const [connected, setConnected] = useState(false);
  const [events, setEvents] = useState<StopStatusEvent[]>([]);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const token = getAccessToken();
    if (token === null) return;

    const socket = io(`${SOCKET_ORIGIN}/delivery`, {
      auth: { token },
      transports: ['websocket'],
      reconnectionAttempts: 5,
    });
    socketRef.current = socket;

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', () => setConnected(false));
    socket.on('delivery.stop_status_changed', (event: StopStatusEvent) => {
      setEvents((prev) => [event, ...prev].slice(0, max));
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [max]);

  return { connected, events };
}
