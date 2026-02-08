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
  // Ignore progress fetch after stop to prevent race condition
  const ignoreProgressFetchRef = useRef(false);
  // Ignore SSE events after stop
  const ignoreSSERef = useRef(false);
  // Timer for clearing ignore flags after stop
  const clearIgnoreFlagsTimerRef = useRef<NodeJS.Timeout | null>(null);

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
      // Ignore SSE events after stop
      if (ignoreSSERef.current) {
        return;
      }
      // Remove model from testing set only when ALL endpoints for this model are done
      if (event.type === "progress" && event.modelId && event.isModelComplete) {
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
    // Skip fetch if we just stopped detection (prevent race condition)
    if (ignoreProgressFetchRef.current) {
      return;
    }
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
    }
  }, []);

  // Auto-update isDetectionRunning when testingModelIds becomes empty
  // This ensures the button state updates when all models finish testing via SSE
  useEffect(() => {
    if (isDetectionRunning && testingModelIds.size === 0) {
      // Double-check with server to confirm detection is complete
      void Promise.resolve().then(fetchProgress);
    }
  }, [testingModelIds.size, isDetectionRunning, fetchProgress]);

  // Remove multiple models from testing set (for stop action)
  const removeTestingModels = useCallback((modelIds: string[]) => {
    setTestingModelIds((prev) => {
      const next = new Set(prev);
      modelIds.forEach((id) => next.delete(id));
      return next;
    });
    // Note: Removed fetchProgress() call here to prevent race condition
    // The SSE events will handle the final state update
  }, []);

  // Fetch initial detection progress on page load
  useEffect(() => {
    void Promise.resolve().then(fetchProgress);
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

  // Handle detection start from header - immediately update UI
  const handleDetectionStart = useCallback(async () => {
    // Cancel any pending clear-ignore-flags timer from previous stop
    if (clearIgnoreFlagsTimerRef.current) {
      clearTimeout(clearIgnoreFlagsTimerRef.current);
      clearIgnoreFlagsTimerRef.current = null;
    }
    // Clear ignore flags from previous stop
    ignoreProgressFetchRef.current = false;
    ignoreSSERef.current = false;

    setIsDetectionRunning(true);
    // Clear testing model IDs to reset UI to "untested" state
    setTestingModelIds(new Set());
    // Trigger dashboard refresh to show reset state
    setRefreshKey((k) => k + 1);
    // Fetch progress to get all model IDs that will be tested
    try {
      // Delay to let the backend reset model status and queue jobs
      await new Promise((resolve) => setTimeout(resolve, 500));
      await fetchProgress();
    } catch (error) {
    }
  }, [fetchProgress]);

  // Handle detection stop from header
  const handleDetectionStop = useCallback(() => {
    setIsDetectionRunning(false);
    setTestingModelIds(new Set());
    // Set ignore flags to prevent race condition with pending responses
    ignoreProgressFetchRef.current = true;
    ignoreSSERef.current = true;
    // Cancel any pending clear-ignore-flags timer
    if (clearIgnoreFlagsTimerRef.current) {
      clearTimeout(clearIgnoreFlagsTimerRef.current);
    }
    // Clear ignore flags after 3 seconds to resume normal operation
    clearIgnoreFlagsTimerRef.current = setTimeout(() => {
      ignoreProgressFetchRef.current = false;
      ignoreSSERef.current = false;
      clearIgnoreFlagsTimerRef.current = null;
    }, 3000);
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
        onDetectionStart={handleDetectionStart}
        onDetectionStop={handleDetectionStop}
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
