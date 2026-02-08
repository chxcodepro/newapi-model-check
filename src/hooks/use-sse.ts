// SSE hook for real-time progress updates

"use client";

import { useEffect, useState, useCallback, useRef } from "react";

interface ProgressEvent {
  type: "connected" | "progress" | "heartbeat" | "error";
  channelId?: string;
  modelId?: string;
  modelName?: string;
  status?: "SUCCESS" | "FAIL";
  latency?: number;
  timestamp?: number;
  message?: string;
  isModelComplete?: boolean; // true when all endpoints for this model are done
}

interface UseSSEOptions {
  onProgress?: (event: ProgressEvent) => void;
  autoConnect?: boolean;
  maxRetries?: number;
}

const MAX_RECONNECT_DELAY = 30000; // 30 seconds max
const INITIAL_RECONNECT_DELAY = 1000; // 1 second initial

export function useSSE(options: UseSSEOptions = {}) {
  const { autoConnect = true, maxRetries = 10 } = options;
  const [isConnected, setIsConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<ProgressEvent | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const retryCountRef = useRef(0);
  const reconnectDelayRef = useRef(INITIAL_RECONNECT_DELAY);
  const connectRef = useRef<(() => void) | null>(null);
  // Store callback in ref to avoid triggering reconnection
  const onProgressRef = useRef(options.onProgress);

  // Update ref when callback changes
  useEffect(() => {
    onProgressRef.current = options.onProgress;
  }, [options.onProgress]);

  const connect = useCallback(() => {
    // Prevent duplicate connections
    if (eventSourceRef.current?.readyState === EventSource.OPEN) {
      return;
    }

    // Close existing connection if any
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    const eventSource = new EventSource("/api/sse/progress");
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      setIsConnected(true);
      // Reset retry state on successful connection
      retryCountRef.current = 0;
      reconnectDelayRef.current = INITIAL_RECONNECT_DELAY;
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as ProgressEvent;
        setLastEvent(data);

        if (data.type === "connected") {
          setIsConnected(true);
        }

        // Log progress events for debugging
        if (data.type === "progress") {
        }

        // Call callback via ref (won't cause re-renders)
        onProgressRef.current?.(data);
      } catch (error) {
      }
    };

    eventSource.onerror = () => {
      setIsConnected(false);
      eventSource.close();
      eventSourceRef.current = null;

      // Check if we should retry
      if (retryCountRef.current >= maxRetries) {
        return;
      }

      retryCountRef.current++;

      // Exponential backoff with jitter
      const jitter = Math.random() * 1000;
      const delay = Math.min(reconnectDelayRef.current + jitter, MAX_RECONNECT_DELAY);

      reconnectTimeoutRef.current = setTimeout(() => {
        connectRef.current?.();
      }, delay);

      // Increase delay for next retry (exponential backoff)
      reconnectDelayRef.current = Math.min(reconnectDelayRef.current * 2, MAX_RECONNECT_DELAY);
    };
  }, [maxRetries]); // Only depends on maxRetries, not onProgress

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
      setIsConnected(false);
    }

    // Reset retry state
    retryCountRef.current = 0;
    reconnectDelayRef.current = INITIAL_RECONNECT_DELAY;
  }, []);

  // Manual reconnect (resets retry count)
  const reconnect = useCallback(() => {
    disconnect();
    retryCountRef.current = 0;
    reconnectDelayRef.current = INITIAL_RECONNECT_DELAY;
    connect();
  }, [disconnect, connect]);

  useEffect(() => {
    if (autoConnect) {
      connect();
    }

    return () => {
      disconnect();
    };
  }, [autoConnect, connect, disconnect]);

  return {
    isConnected,
    lastEvent,
    connect,
    disconnect,
    reconnect,
  };
}
