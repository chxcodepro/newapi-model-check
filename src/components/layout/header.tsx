// Header component with theme toggle, SSE status, scheduler info, filters, and login button

"use client";

import { useState, useEffect, useRef } from "react";
import { Sun, Moon, LogIn, LogOut, Activity, Play, Square, Loader2, Wifi, WifiOff, Clock, Zap, Timer, Search, Filter, X, Github } from "lucide-react";
import { useTheme } from "@/components/providers/theme-provider";
import { useAuth } from "@/components/providers/auth-provider";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

// Filter types
export type EndpointFilter = "all" | "CHAT" | "CLAUDE" | "GEMINI" | "CODEX";
export type StatusFilter = "all" | "healthy" | "unhealthy" | "unknown";

interface SchedulerStatus {
  detection: {
    enabled: boolean;
    running: boolean;
    schedule: string;
    nextRun: string | null;
  };
  cleanup: {
    running: boolean;
    schedule: string;
    nextRun: string | null;
    retentionDays: number;
  };
}

interface HeaderProps {
  onLoginClick: () => void;
  isConnected?: boolean;
  isDetectionRunning?: boolean;
  // Filter props
  search?: string;
  onSearchChange?: (value: string) => void;
  endpointFilter?: EndpointFilter;
  onEndpointFilterChange?: (value: EndpointFilter) => void;
  statusFilter?: StatusFilter;
  onStatusFilterChange?: (value: StatusFilter) => void;
}

// Worker configuration (matching worker.ts)
const WORKER_CONCURRENCY = 5;
const MIN_DELAY_MS = 3000;
const MAX_DELAY_MS = 5000;

export function Header({
  onLoginClick,
  isConnected = false,
  isDetectionRunning = false,
  search = "",
  onSearchChange,
  endpointFilter = "all",
  onEndpointFilterChange,
  statusFilter = "all",
  onStatusFilterChange,
}: HeaderProps) {
  const { resolvedTheme, setTheme } = useTheme();
  const { isAuthenticated, token, logout } = useAuth();
  const { toast, update } = useToast();
  const [isDetecting, setIsDetecting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [isHoveringStop, setIsHoveringStop] = useState(false);
  const [schedulerStatus, setSchedulerStatus] = useState<SchedulerStatus | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [countdown, setCountdown] = useState<string>("-");
  const filterRef = useRef<HTMLDivElement>(null);

  // Close filter panel when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(event.target as Node)) {
        setShowFilters(false);
      }
    };

    if (showFilters) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showFilters]);

  // Fetch scheduler status
  useEffect(() => {
    const fetchSchedulerStatus = async () => {
      try {
        const response = await fetch("/api/scheduler");
        if (response.ok) {
          const data = await response.json();
          setSchedulerStatus(data);
        }
      } catch (error) {
        console.error("Failed to fetch scheduler status:", error);
      }
    };

    fetchSchedulerStatus();
    // Refresh every minute
    const interval = setInterval(fetchSchedulerStatus, 60000);
    return () => clearInterval(interval);
  }, []);

  // Real-time countdown timer
  useEffect(() => {
    if (!schedulerStatus?.detection.enabled || !schedulerStatus?.detection.nextRun) {
      setCountdown("-");
      return;
    }

    const updateCountdown = () => {
      const nextRun = new Date(schedulerStatus.detection.nextRun!);
      const now = new Date();
      const diffMs = nextRun.getTime() - now.getTime();

      if (diffMs <= 0) {
        setCountdown("执行中...");
        return;
      }

      const diffSecs = Math.floor(diffMs / 1000);
      const hours = Math.floor(diffSecs / 3600);
      const mins = Math.floor((diffSecs % 3600) / 60);
      const secs = diffSecs % 60;

      if (hours > 0) {
        setCountdown(`${hours}h${mins}m${secs}s`);
      } else if (mins > 0) {
        setCountdown(`${mins}m${secs}s`);
      } else {
        setCountdown(`${secs}s`);
      }
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [schedulerStatus?.detection.enabled, schedulerStatus?.detection.nextRun]);

  const toggleTheme = () => {
    setTheme(resolvedTheme === "dark" ? "light" : "dark");
  };

  const handleTriggerDetection = async () => {
    if (isDetecting) return;

    setIsDetecting(true);
    const toastId = toast("正在启动全量检测...", "loading");

    try {
      const response = await fetch("/api/detect", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({}),
      });

      const data = await response.json();

      if (response.ok) {
        update(toastId, data.message || "检测已启动", "success");
      } else {
        update(toastId, data.error || "启动检测失败", "error");
      }
    } catch {
      update(toastId, "网络错误", "error");
    } finally {
      setIsDetecting(false);
    }
  };

  const handleStopDetection = async () => {
    if (isStopping) return;

    setIsStopping(true);
    const toastId = toast("正在停止检测...", "loading");

    try {
      const response = await fetch("/api/detect", {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await response.json();

      if (response.ok) {
        update(toastId, data.message || "检测已停止", "success");
      } else {
        update(toastId, data.error || "停止检测失败", "error");
      }
    } catch {
      update(toastId, "网络错误", "error");
    } finally {
      setIsStopping(false);
    }
  };

  // Format next run time
  const formatNextRun = (isoString: string | null): string => {
    if (!isoString) return "-";
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = date.getTime() - now.getTime();

    if (diffMs < 0) return "即将执行";

    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);

    if (diffMins < 60) return `${diffMins}分钟后`;
    if (diffHours < 24) return `${diffHours}h${diffMins % 60}m`;
    return date.toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  // Check if any filter is active
  const hasActiveFilters = search || endpointFilter !== "all" || statusFilter !== "all";
  const activeFilterCount = [search, endpointFilter !== "all", statusFilter !== "all"].filter(Boolean).length;

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto flex h-14 items-center justify-between px-2 sm:px-4 gap-1 sm:gap-2">
        {/* Logo - compact on mobile */}
        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
          <Activity className="h-5 w-5 text-primary" />
          <span className="font-semibold hidden sm:inline">NewAPI 监控</span>
          <a
            href="https://github.com/chxcodepro/newapi-model-check"
            target="_blank"
            rel="noopener noreferrer"
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors hidden sm:block"
            title="GitHub 仓库"
          >
            <Github className="h-4 w-4" />
          </a>
        </div>

        {/* Scheduler Info - Desktop: full info, Mobile: countdown only */}
        <div className="flex items-center gap-1 sm:gap-3 text-xs text-muted-foreground">
          {/* Next detection time - always visible */}
          <div
            className={cn(
              "flex items-center gap-1 px-1.5 sm:px-2 py-1 rounded",
              schedulerStatus?.detection.enabled === false ? "bg-red-500/10" : "bg-muted/50"
            )}
            title={schedulerStatus?.detection.enabled === false ? "自动检测已禁用" : "下次自动检测"}
          >
            <Clock className={cn(
              "h-3 w-3",
              schedulerStatus?.detection.enabled === false ? "text-red-500" : "text-blue-500"
            )} />
            <span className={cn(
              "font-medium text-[10px] sm:text-xs",
              schedulerStatus?.detection.enabled === false ? "text-red-500" : "text-foreground"
            )}>
              {schedulerStatus
                ? schedulerStatus.detection.enabled
                  ? countdown
                  : "已禁用"
                : "-"}
            </span>
          </div>

          {/* Concurrency - desktop only */}
          <div className="hidden lg:flex items-center gap-1 px-2 py-1 rounded bg-muted/50" title="并发数">
            <Zap className="h-3 w-3 text-yellow-500" />
            <span className="font-medium text-foreground">{WORKER_CONCURRENCY}</span>
          </div>

          {/* Interval - desktop only */}
          <div className="hidden lg:flex items-center gap-1 px-2 py-1 rounded bg-muted/50" title="检测间隔">
            <Timer className="h-3 w-3 text-green-500" />
            <span className="font-medium text-foreground">{MIN_DELAY_MS/1000}-{MAX_DELAY_MS/1000}s</span>
          </div>
        </div>

        {/* Actions - compact layout */}
        <div className="flex items-center gap-0.5 sm:gap-1 shrink-0">
          {/* Filter Button with Dropdown */}
          {onSearchChange && (
            <div className="relative" ref={filterRef}>
              <button
                onClick={() => setShowFilters(!showFilters)}
                className={cn(
                  "inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-sm font-medium transition-colors",
                  hasActiveFilters
                    ? "bg-blue-500 text-white hover:bg-blue-600"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                )}
                title="筛选"
              >
                <Filter className="h-4 w-4" />
                <span className="hidden sm:inline">筛选</span>
                {activeFilterCount > 0 && (
                  <span className="ml-0.5 px-1 py-0.5 text-xs rounded-full bg-white/20">
                    {activeFilterCount}
                  </span>
                )}
              </button>

              {/* Filter Dropdown Panel */}
              {showFilters && (
                <div className="absolute right-0 top-full mt-2 w-72 p-4 rounded-lg border border-border bg-card shadow-lg z-50">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-medium">筛选条件</span>
                    <button
                      onClick={() => setShowFilters(false)}
                      className="p-1 rounded hover:bg-accent"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="space-y-3">
                    {/* Search */}
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">搜索模型</label>
                      <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <input
                          type="text"
                          value={search}
                          onChange={(e) => onSearchChange(e.target.value)}
                          placeholder="输入模型名称..."
                          className="w-full pl-8 pr-3 py-2 rounded-md border border-input bg-background text-sm"
                        />
                      </div>
                    </div>

                    {/* Endpoint Filter */}
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">端点类型</label>
                      <select
                        value={endpointFilter}
                        onChange={(e) => onEndpointFilterChange?.(e.target.value as EndpointFilter)}
                        className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm"
                      >
                        <option value="all">所有端点</option>
                        <option value="CHAT">Chat</option>
                        <option value="CLAUDE">Claude CLI</option>
                        <option value="GEMINI">Gemini CLI</option>
                        <option value="CODEX">Codex CLI</option>
                      </select>
                    </div>

                    {/* Status Filter */}
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">状态</label>
                      <select
                        value={statusFilter}
                        onChange={(e) => onStatusFilterChange?.(e.target.value as StatusFilter)}
                        className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm"
                      >
                        <option value="all">所有状态</option>
                        <option value="healthy">正常</option>
                        <option value="unhealthy">异常</option>
                        <option value="unknown">未检测</option>
                      </select>
                    </div>

                    {/* Clear Filters */}
                    {hasActiveFilters && (
                      <button
                        onClick={() => {
                          onSearchChange("");
                          onEndpointFilterChange?.("all");
                          onStatusFilterChange?.("all");
                        }}
                        className="w-full py-2 text-sm text-blue-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950 rounded-md transition-colors"
                      >
                        清除所有筛选
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* SSE Connection Status */}
          <div className="flex items-center px-1 py-1 rounded-md text-sm" title={isConnected ? "实时连接已建立" : "连接断开"}>
            {isConnected ? (
              <Wifi className="h-4 w-4 text-green-500" />
            ) : (
              <WifiOff className="h-4 w-4 text-red-500" />
            )}
          </div>

          {/* Trigger/Stop Detection (admin only) */}
          {isAuthenticated && (
            isDetectionRunning ? (
              <button
                onClick={handleStopDetection}
                onMouseEnter={() => setIsHoveringStop(true)}
                onMouseLeave={() => setIsHoveringStop(false)}
                disabled={isStopping}
                className={cn(
                  "inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
                  isHoveringStop || isStopping
                    ? "bg-red-500 text-white hover:bg-red-600"
                    : "bg-blue-500 text-white"
                )}
                title={isHoveringStop ? "停止检测" : "检测进行中"}
              >
                {isStopping ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : isHoveringStop ? (
                  <Square className="h-4 w-4" />
                ) : (
                  <Loader2 className="h-4 w-4 animate-spin" />
                )}
                <span className="hidden sm:inline">
                  {isStopping ? "停止中" : isHoveringStop ? "停止" : "检测中"}
                </span>
              </button>
            ) : (
              <button
                onClick={handleTriggerDetection}
                disabled={isDetecting}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                title="开始全量检测"
              >
                {isDetecting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
                <span className="hidden sm:inline">{isDetecting ? "启动中" : "检测"}</span>
              </button>
            )
          )}

          {/* Theme Toggle */}
          <button
            onClick={toggleTheme}
            className="inline-flex items-center justify-center rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
            title={resolvedTheme === "dark" ? "切换到浅色模式" : "切换到深色模式"}
          >
            {resolvedTheme === "dark" ? (
              <Sun className="h-4 w-4" />
            ) : (
              <Moon className="h-4 w-4" />
            )}
          </button>

          {/* Login/Logout */}
          {isAuthenticated ? (
            <button
              onClick={logout}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">退出</span>
            </button>
          ) : (
            <button
              onClick={onLoginClick}
              className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <LogIn className="h-4 w-4" />
              <span className="hidden sm:inline">登录</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
