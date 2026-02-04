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
}

// Common cron presets
const CRON_PRESETS = [
  { label: "每6小时", value: "0 */6 * * *" },
  { label: "每4小时", value: "0 */4 * * *" },
  { label: "每天5次 (0,8,12,16,20点)", value: "0 0,8,12,16,20 * * *" },
  { label: "每天3次 (8,14,20点)", value: "0 8,14,20 * * *" },
  { label: "每天2次 (8,20点)", value: "0 8,20 * * *" },
  { label: "每天1次 (8点)", value: "0 8 * * *" },
  { label: "自定义", value: "custom" },
];

export function SchedulerModal({ isOpen, onClose }: SchedulerModalProps) {
  const { token } = useAuth();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState<SchedulerConfig | null>(null);
  const [channels, setChannels] = useState<ChannelWithModels[]>([]);
  const [nextRun, setNextRun] = useState<string | null>(null);

  // Form state
  const [enabled, setEnabled] = useState(true);
  const [cronPreset, setCronPreset] = useState("0 0,8,12,16,20 * * *");
  const [customCron, setCustomCron] = useState("");
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
        const matchingPreset = CRON_PRESETS.find((p) => p.value === data.config.cronSchedule);
        if (matchingPreset && matchingPreset.value !== "custom") {
          setCronPreset(matchingPreset.value);
        } else {
          setCronPreset("custom");
          setCustomCron(data.config.cronSchedule);
        }
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
        console.error("Failed to load scheduler config:", error);
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
      const cronSchedule = cronPreset === "custom" ? customCron : cronPreset;

      // Check if all channels and all their models are selected
      const isAllSelected = channels.length > 0 && channels.every((channel) => {
        const selected = selectedModelIds[channel.id] || [];
        return channel.models.length > 0 && selected.length === channel.models.length;
      });

      const response = await fetch("/api/scheduler/config", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          enabled,
          cronSchedule,
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
      onClose();
    } catch (error) {
      console.error("Failed to save scheduler config:", error);
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
      <div className="relative bg-card rounded-lg shadow-xl border border-border w-[420px] m-4">
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
                value={cronPreset}
                onChange={(e) => {
                  setCronPreset(e.target.value);
                  if (e.target.value !== "custom") {
                    setCustomCron("");
                  }
                }}
                className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm"
              >
                {CRON_PRESETS.map((preset) => (
                  <option key={preset.value} value={preset.value}>
                    {preset.label}
                  </option>
                ))}
              </select>
              {cronPreset === "custom" && (
                <input
                  type="text"
                  value={customCron}
                  onChange={(e) => setCustomCron(e.target.value)}
                  placeholder="0 */6 * * *"
                  className="w-full mt-2 px-3 py-2 rounded-md border border-input bg-background text-sm font-mono"
                />
              )}
              {nextRun && enabled && (
                <p className="text-xs text-muted-foreground mt-1">
                  下次执行: {formatNextRun(nextRun)}
                </p>
              )}
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
