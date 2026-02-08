// Scheduler configuration modal
// Allows setting cron schedule, concurrency, delay, and channel/model selection

"use client";

import { useState, useEffect, FormEvent } from "react";
import { X, Loader2, Clock } from "lucide-react";
import { useAuth } from "@/components/providers/auth-provider";
import { useToast } from "@/components/ui/toast";
import { ChannelModelSelector, type ChannelWithModels } from "@/components/ui/channel-model-selector";
import { cn } from "@/lib/utils";

interface SchedulerConfig {
  enabled: boolean;
  cronSchedule: string;
  timezone: string;
  channelConcurrency: number;
  maxGlobalConcurrency: number;
  minDelayMs: number;
  maxDelayMs: number;
  detectAllChannels: boolean;
  selectedChannelIds: string[] | null;
  selectedModelIds: Record<string, string[]> | null;
}

interface SchedulerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave?: () => void;
}

type ScheduleMode = "every_30_minutes" | "hourly" | "daily" | "weekly";

const SCHEDULE_OPTIONS: Array<{ label: string; value: ScheduleMode }> = [
  { label: "每30分钟", value: "every_30_minutes" },
  { label: "每小时", value: "hourly" },
  { label: "每天一次（可选时间）", value: "daily" },
  { label: "每周一次（可选星期+时间）", value: "weekly" },
];

const WEEKDAY_OPTIONS = [
  { label: "周日", value: "0" },
  { label: "周一", value: "1" },
  { label: "周二", value: "2" },
  { label: "周三", value: "3" },
  { label: "周四", value: "4" },
  { label: "周五", value: "5" },
  { label: "周六", value: "6" },
];

interface ParsedSchedule {
  mode: ScheduleMode;
  dailyTime: string;
  weeklyDay: string;
  weeklyTime: string;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function parseCronToHumanSchedule(cronSchedule: string): ParsedSchedule {
  const trimmed = cronSchedule.trim();

  if (trimmed === "*/30 * * * *") {
    return { mode: "every_30_minutes", dailyTime: "09:00", weeklyDay: "1", weeklyTime: "09:00" };
  }

  if (trimmed === "0 * * * *") {
    return { mode: "hourly", dailyTime: "09:00", weeklyDay: "1", weeklyTime: "09:00" };
  }

  const dailyMatch = trimmed.match(/^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+\*$/);
  if (dailyMatch) {
    const minute = Number(dailyMatch[1]);
    const hour = Number(dailyMatch[2]);
    return {
      mode: "daily",
      dailyTime: `${pad2(hour)}:${pad2(minute)}`,
      weeklyDay: "1",
      weeklyTime: `${pad2(hour)}:${pad2(minute)}`,
    };
  }

  const weeklyMatch = trimmed.match(/^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+([0-6])$/);
  if (weeklyMatch) {
    const minute = Number(weeklyMatch[1]);
    const hour = Number(weeklyMatch[2]);
    const weekday = weeklyMatch[3];
    return {
      mode: "weekly",
      dailyTime: `${pad2(hour)}:${pad2(minute)}`,
      weeklyDay: weekday,
      weeklyTime: `${pad2(hour)}:${pad2(minute)}`,
    };
  }

  return { mode: "hourly", dailyTime: "09:00", weeklyDay: "1", weeklyTime: "09:00" };
}

function buildCronFromHumanSchedule(
  mode: ScheduleMode,
  dailyTime: string,
  weeklyDay: string,
  weeklyTime: string
): string {
  if (mode === "every_30_minutes") return "*/30 * * * *";
  if (mode === "hourly") return "0 * * * *";

  if (mode === "daily") {
    const [hourStr = "9", minuteStr = "0"] = dailyTime.split(":");
    const hour = Number(hourStr);
    const minute = Number(minuteStr);
    return `${minute} ${hour} * * *`;
  }

  const [hourStr = "9", minuteStr = "0"] = weeklyTime.split(":");
  const hour = Number(hourStr);
  const minute = Number(minuteStr);
  return `${minute} ${hour} * * ${weeklyDay}`;
}

export function SchedulerModal({ isOpen, onClose, onSave }: SchedulerModalProps) {
  const { token } = useAuth();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState<SchedulerConfig | null>(null);
  const [channels, setChannels] = useState<ChannelWithModels[]>([]);
  const [nextRun, setNextRun] = useState<string | null>(null);

  // Form state
  const [enabled, setEnabled] = useState(true);
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>("hourly");
  const [dailyTime, setDailyTime] = useState("09:00");
  const [weeklyDay, setWeeklyDay] = useState("1");
  const [weeklyTime, setWeeklyTime] = useState("09:00");
  const [channelConcurrency, setChannelConcurrency] = useState(5);
  const [maxGlobalConcurrency, setMaxGlobalConcurrency] = useState(30);
  const [minDelayMs, setMinDelayMs] = useState(3000);
  const [maxDelayMs, setMaxDelayMs] = useState(5000);
  const [selectedChannelIds, setSelectedChannelIds] = useState<string[]>([]);
  const [selectedModelIds, setSelectedModelIds] = useState<Record<string, string[]>>({});

  // Load config on open
  useEffect(() => {
    if (!isOpen || !token) return;

    const controller = new AbortController();

    const loadConfig = async () => {
      setLoading(true);
      try {
        const response = await fetch("/api/scheduler/config", {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });

        if (controller.signal.aborted) return;

        if (!response.ok) throw new Error("Failed to load config");

        const data = await response.json();

        if (controller.signal.aborted) return;

        setConfig(data.config);
        setChannels(data.channels);
        setNextRun(data.nextRun);

        // Initialize form state
        setEnabled(data.config.enabled);
        const parsedSchedule = parseCronToHumanSchedule(data.config.cronSchedule);
        setScheduleMode(parsedSchedule.mode);
        setDailyTime(parsedSchedule.dailyTime);
        setWeeklyDay(parsedSchedule.weeklyDay);
        setWeeklyTime(parsedSchedule.weeklyTime);
        setChannelConcurrency(data.config.channelConcurrency);
        setMaxGlobalConcurrency(data.config.maxGlobalConcurrency);
        setMinDelayMs(data.config.minDelayMs);
        setMaxDelayMs(data.config.maxDelayMs);

        // If detectAllChannels is true, select all channels and models
        if (data.config.detectAllChannels) {
          const allChannelIds = data.channels.map((c: ChannelWithModels) => c.id);
          const allModelIds: Record<string, string[]> = {};
          data.channels.forEach((c: ChannelWithModels) => {
            allModelIds[c.id] = c.models.map((m) => m.id);
          });
          setSelectedChannelIds(allChannelIds);
          setSelectedModelIds(allModelIds);
        } else {
          setSelectedChannelIds(data.config.selectedChannelIds || []);
          setSelectedModelIds(data.config.selectedModelIds || {});
        }
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
        if (!controller.signal.aborted) {
          toast("加载配置失败", "error");
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    loadConfig();
    return () => controller.abort();
  }, [isOpen, token, toast]);

  // Handle save
  const handleSave = async (e: FormEvent) => {
    e.preventDefault();

    setSaving(true);
    try {
      const cronSchedule = buildCronFromHumanSchedule(scheduleMode, dailyTime, weeklyDay, weeklyTime);
      const localTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

      // Check if all channels and all their models are selected
      const isAllSelected = channels.length > 0 && channels.every((channel) => {
        const selected = selectedModelIds[channel.id] || [];
        return selected.length === channel.models.length;
      });

      // If no channel selected, auto-disable scheduler
      const hasSelectedChannels = selectedChannelIds.length > 0;
      const finalEnabled = hasSelectedChannels ? enabled : false;

      if (!hasSelectedChannels && enabled) {
        toast("未选择检测范围，已自动关闭定时检测", "warning");
      }

      const response = await fetch("/api/scheduler/config", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          enabled: finalEnabled,
          cronSchedule,
          timezone: localTimezone,
          channelConcurrency,
          maxGlobalConcurrency,
          minDelayMs,
          maxDelayMs,
          detectAllChannels: isAllSelected,
          selectedChannelIds: isAllSelected ? null : selectedChannelIds,
          selectedModelIds: isAllSelected ? null : selectedModelIds,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "保存失败");
      }

      const data = await response.json();
      setNextRun(data.nextRun);
      toast("配置已保存", "success");
      onSave?.();
      onClose();
    } catch (error) {
      toast(error instanceof Error ? error.message : "保存失败", "error");
    } finally {
      setSaving(false);
    }
  };

  // Handle selection change from ChannelModelSelector
  const handleSelectionChange = (channelIds: string[], modelIds: Record<string, string[]>) => {
    setSelectedChannelIds(channelIds);
    setSelectedModelIds(modelIds);
  };

  // Format next run time
  const formatNextRun = (isoString: string | null): string => {
    if (!isoString) return "-";
    const date = new Date(isoString);
    return date.toLocaleString("zh-CN", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="scheduler-modal-title"
    >
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative bg-card rounded-lg shadow-xl border border-border w-[680px] max-w-[95vw] m-4">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 id="scheduler-modal-title" className="text-lg font-semibold flex items-center gap-2">
            <Clock className="h-5 w-5 text-blue-500" />
            定时检测设置
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded-md hover:bg-accent transition-colors"
            aria-label="关闭"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <form onSubmit={handleSave} className="px-5 py-4 space-y-4">
            {/* Enable toggle */}
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">启用自动检测</label>
              <button
                type="button"
                onClick={() => setEnabled(!enabled)}
                className={cn(
                  "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
                  enabled ? "bg-primary" : "bg-muted"
                )}
              >
                <span
                  className={cn(
                    "inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
                    enabled ? "translate-x-6" : "translate-x-1"
                  )}
                />
              </button>
            </div>

            {/* Cron schedule */}
            <div>
              <label className="block text-sm font-medium mb-1.5">执行时间</label>
              <select
                value={scheduleMode}
                onChange={(e) => setScheduleMode(e.target.value as ScheduleMode)}
                className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm"
              >
                {SCHEDULE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              {scheduleMode === "daily" && (
                <div className="mt-2">
                  <label className="block text-xs text-muted-foreground mb-1">每天几点执行</label>
                  <input
                    type="time"
                    value={dailyTime}
                    onChange={(e) => setDailyTime(e.target.value)}
                    className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm"
                  />
                </div>
              )}
              {scheduleMode === "weekly" && (
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">每周几执行</label>
                    <select
                      value={weeklyDay}
                      onChange={(e) => setWeeklyDay(e.target.value)}
                      className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm"
                    >
                      {WEEKDAY_OPTIONS.map((day) => (
                        <option key={day.value} value={day.value}>
                          {day.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">几点执行</label>
                    <input
                      type="time"
                      value={weeklyTime}
                      onChange={(e) => setWeeklyTime(e.target.value)}
                      className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm"
                    />
                  </div>
                </div>
              )}
              {nextRun && enabled && (
                <p className="text-xs text-muted-foreground mt-1">
                  下次执行: {formatNextRun(nextRun)}
                </p>
              )}
              <p className="text-xs text-muted-foreground mt-1">
                时区: 本地时区（{Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"}）
              </p>
            </div>

            {/* Concurrency and Delay in one row */}
            <div className="grid grid-cols-4 gap-3">
              <div>
                <label className="block text-xs text-muted-foreground mb-1">全局并发</label>
                <input
                  type="number"
                  min="1"
                  max="100"
                  value={maxGlobalConcurrency}
                  onChange={(e) => setMaxGlobalConcurrency(parseInt(e.target.value) || 30)}
                  className="w-full px-2 py-2 rounded-md border border-input bg-background text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">渠道并发</label>
                <input
                  type="number"
                  min="1"
                  max="20"
                  value={channelConcurrency}
                  onChange={(e) => setChannelConcurrency(parseInt(e.target.value) || 5)}
                  className="w-full px-2 py-2 rounded-md border border-input bg-background text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">最小间隔</label>
                <input
                  type="number"
                  min="0"
                  max="60000"
                  step="500"
                  value={minDelayMs}
                  onChange={(e) => setMinDelayMs(parseInt(e.target.value) || 0)}
                  className="w-full px-2 py-2 rounded-md border border-input bg-background text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">最大间隔</label>
                <input
                  type="number"
                  min="0"
                  max="60000"
                  step="500"
                  value={maxDelayMs}
                  onChange={(e) => setMaxDelayMs(parseInt(e.target.value) || 0)}
                  className="w-full px-2 py-2 rounded-md border border-input bg-background text-sm"
                />
              </div>
            </div>

            {/* Detection scope - directly use ChannelModelSelector */}
            <div>
              <label className="block text-sm font-medium mb-2">检测范围</label>
              <div className="border border-border rounded-md p-3">
                <ChannelModelSelector
                  channels={channels}
                  selectedChannelIds={selectedChannelIds}
                  selectedModelIds={selectedModelIds}
                  onSelectionChange={handleSelectionChange}
                  selectAllLabel="全部渠道"
                  maxHeight="12rem"
                />
              </div>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-3 border-t border-border">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-md border border-input bg-background text-sm font-medium hover:bg-accent transition-colors"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center gap-2"
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                保存
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
