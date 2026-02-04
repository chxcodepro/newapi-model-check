// Main dashboard component

"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { Summary } from "@/components/dashboard/summary";
import { ChannelCard } from "@/components/dashboard/channel-card";
import { ChannelManager } from "@/components/dashboard/channel-manager";
import { ProxyKeyManager } from "@/components/dashboard/proxy-key-manager";
import { useAuth } from "@/components/providers/auth-provider";
import { useToast } from "@/components/ui/toast";
import { Loader2 } from "lucide-react";

interface CheckLog {
  id: string;
  status: "SUCCESS" | "FAIL";
  latency: number | null;
  statusCode: number | null;
  endpointType: string;
  responseContent: string | null;
  errorMsg: string | null;
  createdAt: string;
}

interface Model {
  id: string;
  modelName: string;
  detectedEndpoints: string[] | null;
  lastStatus: boolean | null;
  lastLatency: number | null;
  lastCheckedAt: string | null;
  checkLogs: CheckLog[];
}

interface Channel {
  id: string;
  name: string;
  type: string;
  models: Model[];
}

interface DashboardData {
  authenticated: boolean;
  summary: {
    totalChannels: number;
    totalModels: number;
    healthyModels: number;
    healthRate: number;
  };
  channels: Channel[];
}

// Filter types (exported for parent components)
export type EndpointFilter = "all" | "CHAT" | "CLAUDE" | "GEMINI" | "CODEX";
export type StatusFilter = "all" | "healthy" | "unhealthy" | "unknown";

interface DashboardProps {
  refreshKey?: number;
  // Filter props from header
  search?: string;
  endpointFilter?: EndpointFilter;
  statusFilter?: StatusFilter;
  // Testing state from parent
  testingModelIds?: Set<string>;
  onTestModels?: (modelIds: string[]) => void;
  onStopModels?: (modelIds: string[]) => void;
}

export function Dashboard({
  refreshKey = 0,
  search = "",
  endpointFilter = "all",
  statusFilter = "all",
  testingModelIds = new Set(),
  onTestModels,
  onStopModels,
}: DashboardProps) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { isAuthenticated, token } = useAuth();
  const { toast, update } = useToast();

  const fetchData = useCallback(async (signal?: AbortSignal) => {
    try {
      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = {};
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      const response = await fetch("/api/dashboard", { headers, signal });
      if (!response.ok) {
        throw new Error("获取数据失败");
      }

      const result = await response.json();
      // Only update state if request wasn't aborted
      if (!signal?.aborted) {
        setData(result);
        setError(null);
      }
    } catch (err) {
      // Ignore abort errors
      if (err instanceof Error && err.name === "AbortError") {
        return;
      }
      if (!signal?.aborted) {
        setError(err instanceof Error ? err.message : "未知错误");
      }
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, []);

  // Delete channel handler
  const handleDeleteChannel = useCallback(async (channelId: string) => {
    if (!token) return;

    const toastId = toast("正在删除渠道...", "loading");
    try {
      const response = await fetch(`/api/channel?id=${channelId}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!response.ok) {
        throw new Error("删除渠道失败");
      }
      update(toastId, "渠道已删除", "success");
      fetchData();
    } catch (err) {
      update(toastId, err instanceof Error ? err.message : "删除失败", "error");
    }
  }, [token, toast, update, fetchData]);

  // Fetch data on mount and when refreshKey changes (SSE triggers)
  useEffect(() => {
    const controller = new AbortController();
    fetchData(controller.signal);
    return () => controller.abort();
  }, [fetchData, refreshKey]);

  // Filter and sort channels - default sort by status
  const filteredChannels = useMemo(() => {
    if (!data?.channels) return [];

    return data.channels
      .map((channel) => {
        // Filter models within channel
        const filteredModels = channel.models.filter((model) => {
          // Search filter
          if (search && !model.modelName.toLowerCase().includes(search.toLowerCase())) {
            return false;
          }

          // Endpoint filter - only filter if model has detected endpoints
          if (endpointFilter !== "all") {
            const endpoints = model.detectedEndpoints || [];
            if (endpoints.length === 0 || !endpoints.includes(endpointFilter)) {
              return false;
            }
          }

          // Status filter
          if (statusFilter !== "all") {
            if (statusFilter === "healthy" && model.lastStatus !== true) return false;
            if (statusFilter === "unhealthy" && model.lastStatus !== false) return false;
            if (statusFilter === "unknown" && model.lastStatus !== null) return false;
          }

          return true;
        });

        // Sort models by status (healthy first, then unhealthy, then unknown)
        const sortedModels = [...filteredModels].sort((a, b) => {
          const statusA = a.lastStatus === true ? 0 : a.lastStatus === false ? 1 : 2;
          const statusB = b.lastStatus === true ? 0 : b.lastStatus === false ? 1 : 2;
          return statusA - statusB;
        });

        return { ...channel, models: sortedModels };
      })
      .filter((channel) => channel.models.length > 0);
  }, [data?.channels, search, endpointFilter, statusFilter]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <p className="text-destructive">{error}</p>
        <button
          onClick={() => fetchData()}
          className="px-4 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
        >
          重试
        </button>
      </div>
    );
  }

  if (!data) {
    return null;
  }

  return (
    <div className="space-y-6">
      {/* Channel Manager (admin only) */}
      {isAuthenticated && <ChannelManager onUpdate={fetchData} />}

      {/* Proxy Key Manager (admin only) */}
      {isAuthenticated && <ProxyKeyManager />}

      {/* Summary Stats */}
      <Summary data={data.summary} />

      {/* Channels List */}
      {filteredChannels.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          {data.channels.length === 0 ? "暂无渠道配置" : "没有匹配的结果"}
        </div>
      ) : (
        <div className="grid gap-4">
          {filteredChannels.map((channel) => (
            <ChannelCard
              key={channel.id}
              channel={channel}
              onRefresh={fetchData}
              onDelete={handleDeleteChannel}
              testingModelIds={testingModelIds}
              onTestModels={onTestModels}
              onStopModels={onStopModels}
            />
          ))}
        </div>
      )}
    </div>
  );
}
