// Main page component

"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { Header, EndpointFilter, StatusFilter } from "@/components/layout/header";
import { LoginModal } from "@/components/ui/login-modal";
import { Dashboard } from "@/components/dashboard";
import { useSSE } from "@/hooks/use-sse";

// Polling interval for testing status (5 seconds)
const TESTING_STATUS_POLL_INTERVAL = 5000;
// Debounce delay for refreshKey updates (ms)
const REFRESH_DEBOUNCE_DELAY = 500;

export default function Home() {
  const [showLogin, setShowLogin] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // Filter state (shared between Header and Dashboard)
  const [search, setSearch] = useState("");
  const [endpointFilter, setEndpointFilter] = useState<EndpointFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  // Testing models state (track which models are currently being tested)
  const [testingModelIds, setTestingModelIds] = useState<Set<string>>(new Set());

  // Detection running state
  const [isDetectionRunning, setIsDetectionRunning] = useState(false);

  // Track if polling should be active
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  // Debounce timer for refreshKey updates
  const refreshDebounceRef = useRef<NodeJS.Timeout | null>(null);
  // Track SSE connection state for polling logic
  const sseConnectedRef = useRef(false);

  // Add models to testing set
  const addTestingModels = useCallback((modelIds: string[]) => {
    setTestingModelIds((prev) => {
      const next = new Set(prev);
      modelIds.forEach((id) => next.add(id));
      return next;
    });
  }, []);

  // Remove model from testing set
  const removeTestingModel = useCallback((modelId: string) => {
    setTestingModelIds((prev) => {
      const next = new Set(prev);
      next.delete(modelId);
      return next;
    });
  }, []);

  // Debounced refresh function for SSE events
  const debouncedRefresh = useCallback(() => {
    // Clear existing debounce timer
    if (refreshDebounceRef.current) {
      clearTimeout(refreshDebounceRef.current);
    }
    // Set new debounce timer
    refreshDebounceRef.current = setTimeout(() => {
      setRefreshKey((k) => k + 1);
      refreshDebounceRef.current = null;
    }, REFRESH_DEBOUNCE_DELAY);
  }, []);

  // SSE for real-time updates - must be before useEffects that depend on isConnected
  const { isConnected } = useSSE({
    onProgress: (event) => {
      // Remove model from testing set when test completes
      if (event.type === "progress" && event.modelId) {
        removeTestingModel(event.modelId);
      }
      // Trigger dashboard refresh with debounce to avoid rapid re-renders
      debouncedRefresh();
    },
  });

  // Keep ref in sync with isConnected state
  useEffect(() => {
    sseConnectedRef.current = isConnected;
  }, [isConnected]);

  // Fetch detection progress (used for initial load and polling fallback)
  const fetchProgress = useCallback(async () => {
    try {
      const response = await fetch("/api/detect");
      if (response.ok) {
        const data = await response.json();
        // Update testing model IDs
        if (data.testingModelIds && Array.isArray(data.testingModelIds)) {
          if (sseConnectedRef.current) {
            // SSE is connected: only merge new IDs, don't overwrite
            // This prevents polling from re-adding models that SSE already removed
            setTestingModelIds((prev) => {
              const next = new Set(prev);
              data.testingModelIds.forEach((id: string) => next.add(id));
              return next;
            });
          } else {
            // SSE not connected: full replacement (fallback mode)
            setTestingModelIds(new Set(data.testingModelIds));
          }
          // Update detection running state
          setIsDetectionRunning(data.testingModelIds.length > 0);
        } else {
          setIsDetectionRunning(false);
        }
      }
    } catch (error) {
      console.error("[Page] Failed to fetch detection progress:", error);
    }
  }, []);

  // Remove multiple models from testing set (for stop action)
  const removeTestingModels = useCallback((modelIds: string[]) => {
    setTestingModelIds((prev) => {
      const next = new Set(prev);
      modelIds.forEach((id) => next.delete(id));
      return next;
    });
    // Trigger refresh after stopping
    fetchProgress();
  }, [fetchProgress]);

  // Fetch initial detection progress on page load
  useEffect(() => {
    fetchProgress();
  }, [fetchProgress]);

  // Poll for testing status when detection is running AND SSE is not connected
  // SSE is the primary source of truth; polling is only a fallback
  useEffect(() => {
    // Clear existing interval
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }

    // Only start polling if:
    // 1. Detection is running or we have testing models
    // 2. SSE is NOT connected (polling is fallback only)
    if ((isDetectionRunning || testingModelIds.size > 0) && !isConnected) {
      pollIntervalRef.current = setInterval(fetchProgress, TESTING_STATUS_POLL_INTERVAL);
    }

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [isDetectionRunning, testingModelIds.size, isConnected, fetchProgress]);

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (refreshDebounceRef.current) {
        clearTimeout(refreshDebounceRef.current);
      }
    };
  }, []);

  return (
    <div className="min-h-screen flex flex-col">
      <Header
        onLoginClick={() => setShowLogin(true)}
        isConnected={isConnected}
        isDetectionRunning={isDetectionRunning}
        search={search}
        onSearchChange={setSearch}
        endpointFilter={endpointFilter}
        onEndpointFilterChange={setEndpointFilter}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
      />

      <main className="flex-1 container mx-auto px-4 py-6">
        <Dashboard
          refreshKey={refreshKey}
          search={search}
          endpointFilter={endpointFilter}
          statusFilter={statusFilter}
          testingModelIds={testingModelIds}
          onTestModels={addTestingModels}
          onStopModels={removeTestingModels}
        />
      </main>

      <footer className="border-t border-border py-4">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          <a
            href="https://github.com/chxcodepro/model-check"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground transition-colors"
          >
            模型检测
          </a>
          {" - API 渠道可用性检测系统"}
        </div>
      </footer>

      <LoginModal isOpen={showLogin} onClose={() => setShowLogin(false)} />
    </div>
  );
}
