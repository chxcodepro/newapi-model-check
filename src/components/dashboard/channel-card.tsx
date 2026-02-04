// Channel card component with expandable model list

"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Clock, Zap, PlayCircle, Square, Loader2, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { StatusIndicator } from "@/components/ui/status-indicator";
import { Heatmap } from "@/components/ui/heatmap";
import { useAuth } from "@/components/providers/auth-provider";
import { useToast } from "@/components/ui/toast";

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

interface ChannelCardProps {
  channel: {
    id: string;
    name: string;
    type: string;
    models: Model[];
  };
  onRefresh?: () => void;
  onDelete?: (channelId: string) => void;
  className?: string;
  onEndpointFilterChange?: (endpoint: string | null) => void;
  activeEndpointFilter?: string | null;
  // Testing state from parent
  testingModelIds?: Set<string>;
  onTestModels?: (modelIds: string[]) => void;
  onStopModels?: (modelIds: string[]) => void;
}

const LOG_PREVIEW_LEN = 80;

/** Detect garbage content (HTML pages, base64, etc.) */
function isGarbageContent(text: string): boolean {
  if (/<(!DOCTYPE|html|head|body|div|script)\b/i.test(text)) return true;
  if (text.length > 200 && !text.slice(0, 200).includes(" ")) return true;
  return false;
}

/** Truncate and clean message for display */
function truncateMessage(text: string, max: number): string {
  if (isGarbageContent(text)) return "";
  if (text.length <= max) return text;
  return text.slice(0, max) + "...";
}

/** Log message display */
function LogMessage({ text, className }: { text: string; className?: string }) {
  const preview = truncateMessage(text, LOG_PREVIEW_LEN);
  if (!preview) return null;

  return (
    <span className={cn("break-all", className)}>
      {preview}
    </span>
  );
}

// Format endpoint type for display
function formatEndpointType(ep: string): { label: string; type: "chat" | "cli" } {
  switch (ep) {
    case "CHAT":
      return { label: "Chat", type: "chat" };
    case "CLAUDE":
      return { label: "Claude CLI", type: "cli" };
    case "GEMINI":
      return { label: "Gemini CLI", type: "cli" };
    case "CODEX":
      return { label: "Codex CLI", type: "cli" };
    default:
      return { label: ep, type: "chat" };
  }
}

// Helper function to check if a model is healthy based on checkLogs
// Model is healthy only if ALL tested endpoints are successful
function isModelHealthy(model: Model): boolean {
  if (model.checkLogs.length === 0) return false;

  // Get latest status for each endpoint type
  const endpointStatuses: Record<string, string> = {};
  for (const log of model.checkLogs) {
    if (!endpointStatuses[log.endpointType]) {
      endpointStatuses[log.endpointType] = log.status;
    }
  }

  // Model is healthy only if all tested endpoints are successful
  const statuses = Object.values(endpointStatuses);
  return statuses.length > 0 && statuses.every((s) => s === "SUCCESS");
}

// Helper function to check if a model has at least one available endpoint
// Model is available if ANY endpoint (chat OR cli) is successful
function isModelAvailable(model: Model): boolean {
  if (model.checkLogs.length === 0) return false;

  // Get latest status for each endpoint type
  const endpointStatuses: Record<string, string> = {};
  for (const log of model.checkLogs) {
    if (!endpointStatuses[log.endpointType]) {
      endpointStatuses[log.endpointType] = log.status;
    }
  }

  // Model is available if at least one endpoint is successful
  const statuses = Object.values(endpointStatuses);
  return statuses.length > 0 && statuses.some((s) => s === "SUCCESS");
}

// Helper function to get health counts by endpoint category (Chat vs CLI)
function getEndpointHealthCounts(models: Model[]): {
  chat: { healthy: number; total: number };
  cli: { healthy: number; total: number };
} {
  const result = {
    chat: { healthy: 0, total: 0 },
    cli: { healthy: 0, total: 0 },
  };

  for (const model of models) {
    // Get latest status for each endpoint type
    const endpointStatuses: Record<string, string> = {};
    for (const log of model.checkLogs) {
      if (!endpointStatuses[log.endpointType]) {
        endpointStatuses[log.endpointType] = log.status;
      }
    }

    // Check each detected endpoint
    const endpoints = model.detectedEndpoints || [];
    for (const ep of endpoints) {
      const { type: epCategory } = formatEndpointType(ep);
      const status = endpointStatuses[ep];

      if (epCategory === "chat") {
        result.chat.total++;
        if (status === "SUCCESS") {
          result.chat.healthy++;
        }
      } else {
        // cli
        result.cli.total++;
        if (status === "SUCCESS") {
          result.cli.healthy++;
        }
      }
    }
  }

  return result;
}

export function ChannelCard({ channel, onRefresh, onDelete, className, onEndpointFilterChange, activeEndpointFilter, testingModelIds = new Set(), onTestModels, onStopModels }: ChannelCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [localEndpointFilter, setLocalEndpointFilter] = useState<string | null>(null);
  const [hoveringChannelStop, setHoveringChannelStop] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const { isAuthenticated, token } = useAuth();
  const { toast, update } = useToast();

  // Use local filter if no external filter provided
  const currentFilter = onEndpointFilterChange ? activeEndpointFilter : localEndpointFilter;

  // Calculate healthy count based on checkLogs
  const healthyCount = channel.models.filter(isModelHealthy).length;
  const totalCount = channel.models.length;

  // Calculate health counts by endpoint category
  const endpointHealth = getEndpointHealthCounts(channel.models);

  // Build health summary text for collapsed view - only show total models count
  // Endpoint details are already shown in the colored badges on the right
  const healthSummary = `${totalCount} 个模型`;

  // Calculate channel status based on new logic
  const channelStatus = (() => {
    if (totalCount === 0) return "unknown" as const;
    const checkedModels = channel.models.filter((m) => m.checkLogs.length > 0);
    if (checkedModels.length === 0) return "unknown" as const;
    if (healthyCount === checkedModels.length) return "healthy" as const;
    if (healthyCount === 0) return "unhealthy" as const;
    return "partial" as const;
  })();

  // Check if all models are unavailable after detection
  // A model is unavailable only if BOTH chat and cli endpoints fail (no endpoint works)
  const checkedModels = channel.models.filter((m) => m.checkLogs.length > 0);
  const availableCount = checkedModels.filter(isModelAvailable).length;
  const isAllUnhealthy = checkedModels.length > 0 && availableCount === 0;

  // Handle endpoint filter click
  const handleEndpointClick = (endpoint: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const newFilter = currentFilter === endpoint ? null : endpoint;
    if (onEndpointFilterChange) {
      onEndpointFilterChange(newFilter);
    } else {
      setLocalEndpointFilter(newFilter);
    }
  };

  // Filter models by endpoint if local filter is active
  const displayedModels = localEndpointFilter
    ? channel.models.filter((m) => m.detectedEndpoints?.includes(localEndpointFilter))
    : channel.models;

  // Group models by endpoint type
  const endpointCounts = channel.models.reduce(
    (acc, model) => {
      const endpoints = model.detectedEndpoints || [];
      endpoints.forEach((ep) => {
        acc[ep] = (acc[ep] || 0) + 1;
      });
      return acc;
    },
    {} as Record<string, number>
  );

  // Check if any model in channel is testing
  const isChannelTesting = displayedModels.some((m) => testingModelIds.has(m.id));

  // Test or stop channel
  const handleChannelAction = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const modelIds = displayedModels.map((m) => m.id);

    if (!isAuthenticated) return;

    if (isChannelTesting) {
      // Stop testing
      onStopModels?.(modelIds);
      const toastId = toast("正在停止渠道测试...", "loading");
      try {
        const response = await fetch("/api/detect", {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        if (response.ok) {
          update(toastId, `渠道 ${channel.name} 测试已停止`, "success");
        } else {
          update(toastId, "停止失败", "error");
        }
      } catch {
        update(toastId, "网络错误", "error");
      }
    } else {
      // Start testing
      onTestModels?.(modelIds);
      const toastId = toast(`正在测试 ${modelIds.length} 个模型...`, "loading");
      try {
        const response = await fetch("/api/detect", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ channelId: channel.id, modelIds }),
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || "检测失败");
        }

        update(toastId, `渠道 ${channel.name} 测试已启动`, "success");
      } catch (err) {
        console.error("Test channel error:", err);
        update(toastId, `渠道 ${channel.name} 测试失败`, "error");
      }
    }
  };

  // Test single model
  const handleTestModel = async (modelId: string, modelName: string) => {
    if (!isAuthenticated) return;

    if (testingModelIds.has(modelId)) {
      // Stop testing
      onStopModels?.([modelId]);
      const toastId = toast(`正在停止模型 ${modelName}...`, "loading");
      try {
        const response = await fetch("/api/detect", {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        });
        if (response.ok) {
          update(toastId, `模型 ${modelName} 测试已停止`, "success");
        } else {
          update(toastId, "停止失败", "error");
        }
      } catch {
        update(toastId, "网络错误", "error");
      }
      return;
    }

    // Start testing
    onTestModels?.([modelId]);
    const toastId = toast(`正在测试模型 ${modelName}...`, "loading");

    try {
      const response = await fetch("/api/detect", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ modelId }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "检测失败");
      }

      update(toastId, `模型 ${modelName} 测试已启动`, "success");
    } catch (err) {
      console.error("Test model error:", err);
      update(toastId, `模型 ${modelName} 测试失败`, "error");
    }
  };

  return (
    <div
      className={cn(
        "rounded-lg border overflow-hidden transition-shadow",
        isAllUnhealthy
          ? "border-dashed border-red-400 dark:border-red-500 bg-red-50/30 dark:bg-red-900/10"
          : "border-border bg-card hover:shadow-md",
        className
      )}
    >
      {/* Header - Always visible */}
      <div className="flex items-center min-w-0">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex-1 p-4 flex items-center justify-between hover:bg-accent/50 transition-colors min-w-0 gap-2"
        >
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <StatusIndicator status={channelStatus} size="lg" pulse={channelStatus !== "unknown"} />
            <div className="text-left min-w-0">
              <h3 className={cn("font-medium truncate", isAllUnhealthy && "text-muted-foreground")}>{channel.name}</h3>
              <p className={cn("text-sm", isAllUnhealthy ? "text-red-500 dark:text-red-400" : "text-muted-foreground")}>
                {isAllUnhealthy ? `${totalCount} 个模型均不可用` : healthSummary}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4 shrink-0">
            {/* Endpoint counts - clickable filters with colored badges */}
            <div className="hidden sm:flex items-center gap-2 text-xs">
              {Object.entries(endpointCounts).map(([type, count]) => {
                const { label } = formatEndpointType(type);
                const isActive = currentFilter === type;

                // Different color schemes for each endpoint type
                const colorSchemes: Record<string, { active: string; inactive: string }> = {
                  CHAT: {
                    active: "bg-blue-500 text-white shadow-md ring-2 ring-blue-300",
                    inactive: "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 border border-blue-300 dark:border-blue-700 hover:bg-blue-200 dark:hover:bg-blue-800/50",
                  },
                  CLAUDE: {
                    active: "bg-orange-500 text-white shadow-md ring-2 ring-orange-300",
                    inactive: "bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300 border border-orange-300 dark:border-orange-700 hover:bg-orange-200 dark:hover:bg-orange-800/50",
                  },
                  GEMINI: {
                    active: "bg-cyan-500 text-white shadow-md ring-2 ring-cyan-300",
                    inactive: "bg-cyan-100 dark:bg-cyan-900/40 text-cyan-700 dark:text-cyan-300 border border-cyan-300 dark:border-cyan-700 hover:bg-cyan-200 dark:hover:bg-cyan-800/50",
                  },
                  CODEX: {
                    active: "bg-violet-500 text-white shadow-md ring-2 ring-violet-300",
                    inactive: "bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 border border-violet-300 dark:border-violet-700 hover:bg-violet-200 dark:hover:bg-violet-800/50",
                  },
                };

                const scheme = colorSchemes[type] || colorSchemes.CHAT;
                const colorClass = isActive ? scheme.active : scheme.inactive;

                return (
                  <button
                    key={type}
                    onClick={(e) => handleEndpointClick(type, e)}
                    className={cn(
                      "px-2.5 py-1 rounded-md font-medium transition-all cursor-pointer hover:scale-105",
                      colorClass
                    )}
                  >
                    {label}: {count}
                  </button>
                );
              })}
            </div>

            {/* Expand icon */}
            {isExpanded ? (
              <ChevronUp className="h-5 w-5 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-5 w-5 text-muted-foreground" />
            )}
          </div>
        </button>

        {/* Channel test/stop button */}
        {isAuthenticated && (
          <button
            onClick={handleChannelAction}
            onMouseEnter={() => setHoveringChannelStop(true)}
            onMouseLeave={() => setHoveringChannelStop(false)}
            className={cn(
              "p-4 transition-colors border-l border-border shrink-0",
              isChannelTesting && hoveringChannelStop
                ? "bg-red-500/10 hover:bg-red-500/20"
                : "hover:bg-accent/50"
            )}
            title={isChannelTesting
              ? (hoveringChannelStop ? "停止测试" : "测试中...")
              : `测试筛选后的 ${displayedModels.length} 个模型`
            }
          >
            {isChannelTesting ? (
              hoveringChannelStop ? (
                <Square className="h-5 w-5 text-red-500" />
              ) : (
                <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
              )
            ) : (
              <PlayCircle className="h-5 w-5 text-blue-500" />
            )}
          </button>
        )}

        {/* Delete button for all-unhealthy channel */}
        {isAuthenticated && isAllUnhealthy && onDelete && (
          deleteConfirm ? (
            <div className="flex items-center gap-1 px-2 shrink-0">
              <button
                onClick={() => {
                  onDelete(channel.id);
                  setDeleteConfirm(false);
                }}
                className="px-2 py-1 text-xs rounded bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                确认
              </button>
              <button
                onClick={() => setDeleteConfirm(false)}
                className="px-2 py-1 text-xs rounded bg-muted hover:bg-muted/80"
              >
                取消
              </button>
            </div>
          ) : (
            <button
              onClick={() => setDeleteConfirm(true)}
              className="p-4 transition-colors border-l border-border shrink-0 hover:bg-red-500/10"
              title="删除此渠道"
            >
              <Trash2 className="h-5 w-5 text-red-500" />
            </button>
          )
        )}
      </div>

      {/* Expanded content */}
      {isExpanded && (
        <div className="border-t border-border">
          {/* Local filter indicator */}
          {localEndpointFilter && (
            <div className="px-4 pt-3 flex items-center gap-2 text-xs text-muted-foreground">
              <span>筛选: {formatEndpointType(localEndpointFilter).label}</span>
              <button
                onClick={() => setLocalEndpointFilter(null)}
                className="text-blue-500 hover:underline"
              >
                清除
              </button>
            </div>
          )}
          <div className="p-4 grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {displayedModels.map((model) => (
              <ModelItem
                key={model.id}
                model={model}
                onTest={() => handleTestModel(model.id, model.modelName)}
                isTesting={testingModelIds.has(model.id)}
                canTest={isAuthenticated}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface ModelItemProps {
  model: Model;
  onTest: () => void;
  isTesting: boolean;
  canTest: boolean;
}

// Get latest check log for each endpoint type
function getEndpointStatuses(checkLogs: CheckLog[]): Record<string, CheckLog> {
  const statuses: Record<string, CheckLog> = {};
  for (const log of checkLogs) {
    // Only keep the first (most recent) log for each endpoint type
    if (!statuses[log.endpointType]) {
      statuses[log.endpointType] = log;
    }
  }
  return statuses;
}

// Endpoint badge component with status
function EndpointBadge({
  type,
  log,
}: {
  type: string;
  log: CheckLog | undefined;
}) {
  const { label } = formatEndpointType(type);
  const isSuccess = log?.status === "SUCCESS";
  const isFail = log?.status === "FAIL";
  const statusCode = log?.statusCode;

  // Color schemes for each endpoint type
  const colorSchemes: Record<string, { success: string; fail: string; unknown: string }> = {
    CHAT: {
      success: "bg-blue-500 text-white",
      fail: "bg-blue-500/20 text-blue-600 dark:text-blue-400 ring-1 ring-red-400",
      unknown: "bg-blue-500/10 text-blue-500",
    },
    CLAUDE: {
      success: "bg-orange-500 text-white",
      fail: "bg-orange-500/20 text-orange-600 dark:text-orange-400 ring-1 ring-red-400",
      unknown: "bg-orange-500/10 text-orange-500",
    },
    GEMINI: {
      success: "bg-cyan-500 text-white",
      fail: "bg-cyan-500/20 text-cyan-600 dark:text-cyan-400 ring-1 ring-red-400",
      unknown: "bg-cyan-500/10 text-cyan-500",
    },
    CODEX: {
      success: "bg-violet-500 text-white",
      fail: "bg-violet-500/20 text-violet-600 dark:text-violet-400 ring-1 ring-red-400",
      unknown: "bg-violet-500/10 text-violet-500",
    },
  };

  const scheme = colorSchemes[type] || colorSchemes.CHAT;
  const colorClass = isSuccess ? scheme.success : isFail ? scheme.fail : scheme.unknown;

  return (
    <span
      className={cn(
        "px-1.5 py-0.5 rounded font-medium text-xs inline-flex items-center gap-1",
        colorClass
      )}
      title={log ? `${label}: ${statusCode} - ${log.status}` : `${label}: 未检测`}
    >
      {label}
      {statusCode && (
        <span className={cn(
          "font-mono font-bold",
          isSuccess ? "opacity-90" : "text-red-500 dark:text-red-400"
        )}>
          {statusCode}
        </span>
      )}
    </span>
  );
}

function ModelItem({ model, onTest, isTesting, canTest }: ModelItemProps) {
  const [hoveringStop, setHoveringStop] = useState(false);

  // Only show endpoints that have been successfully detected (not pre-filled)
  const endpoints = (model.detectedEndpoints || []) as string[];
  const endpointStatuses = getEndpointStatuses(model.checkLogs);

  // Calculate overall status based on all endpoints
  const testedEndpoints = Object.keys(endpointStatuses);
  const hasBeenTested = testedEndpoints.length > 0;
  const allSuccess = hasBeenTested && testedEndpoints.every(
    (ep) => endpointStatuses[ep]?.status === "SUCCESS"
  );
  const anyFail = testedEndpoints.some(
    (ep) => endpointStatuses[ep]?.status === "FAIL"
  );

  // Overall status: all success = healthy, partial = partial, all fail = unhealthy, no tests = unknown
  const allFail = hasBeenTested && testedEndpoints.every(
    (ep) => endpointStatuses[ep]?.status === "FAIL"
  );
  const isHealthy = hasBeenTested && allSuccess;
  const isUnknown = !hasBeenTested;
  const isPartial = hasBeenTested && !allSuccess && !allFail;

  // Get the latest latency from any endpoint
  const latestLog = model.checkLogs[0];

  return (
    <div
      className={cn(
        "p-3 rounded-lg border-2 transition-all shadow-sm overflow-hidden",
        isTesting
          ? "border-blue-400 bg-gradient-to-br from-blue-50 to-sky-100 dark:from-blue-900/30 dark:to-sky-900/20 dark:border-blue-500 shadow-blue-100 dark:shadow-blue-900/20"
          : isUnknown
            ? "border-gray-300 bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-800 dark:to-gray-900 dark:border-gray-600"
            : isHealthy
              ? "border-emerald-400 bg-gradient-to-br from-emerald-50 to-green-100 dark:from-emerald-900/30 dark:to-green-900/20 dark:border-emerald-500 shadow-emerald-100 dark:shadow-emerald-900/20"
              : isPartial
                ? "border-amber-400 bg-gradient-to-br from-amber-50 to-yellow-100 dark:from-amber-900/30 dark:to-yellow-900/20 dark:border-amber-500 shadow-amber-100 dark:shadow-amber-900/20"
                : "border-red-400 bg-gradient-to-br from-red-50 to-rose-100 dark:from-red-900/30 dark:to-rose-900/20 dark:border-red-500 shadow-red-100 dark:shadow-red-900/20"
      )}
    >
      {/* Model name row */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <StatusIndicator
            status={isUnknown ? "unknown" : isHealthy ? "healthy" : isPartial ? "partial" : "unhealthy"}
            size="sm"
          />
          <span className="font-mono text-sm truncate font-medium max-w-[200px] sm:max-w-none" title={model.modelName}>
            {model.modelName}
          </span>
        </div>

        {/* Test/Stop button */}
        {canTest && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onTest();
            }}
            onMouseEnter={() => setHoveringStop(true)}
            onMouseLeave={() => setHoveringStop(false)}
            className={cn(
              "p-1 rounded transition-colors shrink-0",
              isTesting && hoveringStop
                ? "bg-red-500/10 hover:bg-red-500/20"
                : "hover:bg-accent"
            )}
            title={isTesting ? (hoveringStop ? "停止测试" : "测试中...") : "测试此模型"}
          >
            {isTesting ? (
              hoveringStop ? (
                <Square className="h-4 w-4 text-red-500" />
              ) : (
                <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
              )
            ) : (
              <PlayCircle className="h-4 w-4 text-blue-500" />
            )}
          </button>
        )}
      </div>

      {/* Endpoint status badges - only show if there are detected endpoints */}
      {endpoints.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap mb-2 overflow-x-auto">
          {endpoints.map((ep) => (
            <EndpointBadge
              key={ep}
              type={ep}
              log={endpointStatuses[ep]}
            />
          ))}
        </div>
      )}

      {/* Stats row */}
      <div className="flex items-center justify-between gap-2 text-xs overflow-hidden">
        <div className="flex items-center gap-1" />
        <div className="flex items-center gap-2 text-muted-foreground">
          <span className="flex items-center gap-0.5">
            <Zap className="h-3 w-3" />
            {latestLog?.latency ? `${latestLog.latency}ms` : "-"}
          </span>
          {latestLog?.createdAt && (
            <span className="flex items-center gap-0.5">
              <Clock className="h-3 w-3" />
              {formatRelativeTime(latestLog.createdAt)}
            </span>
          )}
        </div>
      </div>

      {/* Log details - show response content or error message */}
      {testedEndpoints.length > 0 && (
        <div className="mt-2 pt-2 border-t border-border/50 text-xs space-y-1.5">
          {testedEndpoints.map((ep) => {
            const log = endpointStatuses[ep];
            const isSuccess = log?.status === "SUCCESS";
            const { label } = formatEndpointType(ep);
            const content = isSuccess ? log.responseContent : log.errorMsg;

            if (!content) return null;

            return (
              <div key={ep} className={cn(
                "rounded px-2 py-1",
                isSuccess
                  ? "bg-emerald-50 dark:bg-emerald-900/20"
                  : "bg-red-50 dark:bg-red-900/20"
              )}>
                {testedEndpoints.length > 1 && (
                  <span className={cn(
                    "font-medium mr-1",
                    isSuccess ? "text-emerald-700 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
                  )}>
                    {label}:
                  </span>
                )}
                <LogMessage
                  text={content}
                  className={isSuccess ? "text-muted-foreground" : "text-red-500 dark:text-red-400"}
                />
              </div>
            );
          })}
        </div>
      )}

      {/* Heatmap */}
      {model.checkLogs.length > 0 && (
        <div className="mt-2 pt-2 border-t border-border/50">
          <Heatmap data={model.checkLogs} />
        </div>
      )}
    </div>
  );
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return "刚刚";
  if (diffMins < 60) return `${diffMins}分钟前`;
  if (diffHours < 24) return `${diffHours}小时前`;
  return `${diffDays}天前`;
}
