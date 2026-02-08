// Channel manager component - Add, edit, delete, sync channels

"use client";

import { useState, useEffect, useCallback, FormEvent } from "react";
import {
  Plus,
  Pencil,
  Trash2,
  RefreshCw,
  X,
  Loader2,
  ChevronDown,
  ChevronUp,
  Settings,
  Copy,
  Check,
  Download,
  Upload,
  Cloud,
} from "lucide-react";
import { useAuth } from "@/components/providers/auth-provider";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

interface Channel {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  proxy: string | null;
  enabled: boolean;
  sortOrder?: number;
  _count?: { models: number };
}

interface ChannelManagerProps {
  onUpdate: () => void;
  className?: string;
}

interface ChannelFormData {
  name: string;
  baseUrl: string;
  apiKey: string;
  proxy: string;
}

const initialFormData: ChannelFormData = {
  name: "",
  baseUrl: "",
  apiKey: "",
  proxy: "",
};

export function ChannelManager({ onUpdate, className }: ChannelManagerProps) {
  const { token } = useAuth();
  const { toast } = useToast();
  const [isExpanded, setIsExpanded] = useState(false);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [editingChannel, setEditingChannel] = useState<Channel | null>(null);
  const [formData, setFormData] = useState<ChannelFormData>(initialFormData);
  const [submitting, setSubmitting] = useState(false);

  // Sync state
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [syncingAll, setSyncingAll] = useState(false);
  // Per-channel sync status message (shown on the channel card)
  const [syncStatus, setSyncStatus] = useState<Record<string, { message: string; type: "success" | "error" }>>({});
  const [draggingChannelId, setDraggingChannelId] = useState<string | null>(null);

  // Delete confirmation
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // Copy API key state
  const [copyingId, setCopyingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Import/Export state
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importMode, setImportMode] = useState<"merge" | "replace">("merge");
  const [importText, setImportText] = useState("");

  // Pagination state
  const [channelPage, setChannelPage] = useState(1);
  const CHANNELS_PER_PAGE = 12;

  // 云通知 state
  const [showWebDAVModal, setShowWebDAVModal] = useState(false);
  const [webdavUploading, setWebdavUploading] = useState(false);
  const [webdavDownloading, setWebdavDownloading] = useState(false);
  const [webdavConfig, setWebdavConfig] = useState({
    url: "",
    username: "",
    password: "",
    filename: "channels.json",
  });
  const [webdavEnvConfigured, setWebdavEnvConfigured] = useState(false);
  const [webdavMode, setWebdavMode] = useState<"merge" | "replace">("merge");

  // Handle ESC key to close modals
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (showModal) setShowModal(false);
        if (showImportModal) setShowImportModal(false);
        if (showWebDAVModal) setShowWebDAVModal(false);
      }
    };
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [showModal, showImportModal, showWebDAVModal]);

  // Load cloud sync config from localStorage and API
  useEffect(() => {
    const loadWebdavConfig = async () => {
      // First load from localStorage
      let config = {
        url: "",
        username: "",
        password: "",
        filename: "channels.json",
      };

      if (typeof window !== "undefined") {
        const saved = sessionStorage.getItem("webdav-config");
        if (saved) {
          try {
            const parsed = JSON.parse(saved);
            config = { ...config, ...parsed };
          } catch {
            // ignore parse errors
          }
        }
      }

      // Then try to get env config from API
      if (token) {
        try {
          const response = await fetch("/api/channel/webdav", {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (response.ok) {
            const envConfig = await response.json();
            setWebdavEnvConfigured(envConfig.configured);

            // Use env config as default if localStorage is empty
            if (!config.url && envConfig.url) {
              config.url = envConfig.url;
            }
            if (!config.username && envConfig.username) {
              config.username = envConfig.username;
            }
            if (!config.filename && envConfig.filename) {
              config.filename = envConfig.filename;
            }
            // Don't load password from env for security, but show hint
          }
        } catch {
          // ignore API errors
        }
      }

      setWebdavConfig(config);
    };

    loadWebdavConfig();
  }, [token]);

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };

  // Fetch channels
  const fetchChannels = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/channel", {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        signal,
      });
      if (!response.ok) throw new Error("获取渠道列表失败");
      const data = await response.json();
      if (!signal?.aborted) {
        setChannels(data.channels || []);
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      if (!signal?.aborted) {
        setError(err instanceof Error ? err.message : "未知错误");
      }
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, [token]);

  useEffect(() => {
    if (isExpanded && token) {
      const controller = new AbortController();
      fetchChannels(controller.signal);
      return () => controller.abort();
    }
  }, [isExpanded, token, fetchChannels]);

  // Open add modal
  const handleAdd = () => {
    setEditingChannel(null);
    setFormData(initialFormData);
    setShowModal(true);
  };

  // Open edit modal
  const handleEdit = (channel: Channel) => {
    setEditingChannel(channel);
    setFormData({
      name: channel.name,
      baseUrl: channel.baseUrl,
      apiKey: "", // Don't pre-fill API key for security
      proxy: channel.proxy || "",
    });
    setShowModal(true);
  };

  // Submit form (create or update)
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const body = {
        ...formData,
        proxy: formData.proxy || null,
      };

      if (editingChannel) {
        // Update - only include apiKey if provided
        const updateBody: Record<string, unknown> = {
          id: editingChannel.id,
          name: body.name,
          baseUrl: body.baseUrl,
          proxy: body.proxy,
        };
        if (body.apiKey) {
          updateBody.apiKey = body.apiKey;
        }

        const response = await fetch("/api/channel", {
          method: "PUT",
          headers,
          body: JSON.stringify(updateBody),
        });
        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || "更新渠道失败");
        }
      } else {
        // Create
        if (!body.apiKey) {
          throw new Error("API Key 不能为空");
        }
        const response = await fetch("/api/channel", {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        });
        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || "创建渠道失败");
        }

        // Auto sync models after creating channel
        const createData = await response.json();

        if (createData.channel?.id) {
          try {
            await fetch(`/api/channel/${createData.channel.id}/sync`, {
              method: "POST",
              headers,
            });
          } catch {
            // Ignore sync errors, channel is created
          }
        }
      }

      setShowModal(false);
      fetchChannels();
      onUpdate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败");
    } finally {
      setSubmitting(false);
    }
  };

  // Delete channel
  const handleDelete = async (id: string) => {
    try {
      const response = await fetch(`/api/channel?id=${id}`, {
        method: "DELETE",
        headers,
      });
      if (!response.ok) throw new Error("删除渠道失败");

      setDeleteConfirm(null);
      fetchChannels();
      onUpdate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
    }
  };

  // Sync models
  const handleSync = async (id: string) => {
    setSyncingId(id);
    // Clear any previous status for this channel
    setSyncStatus((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    try {
      const response = await fetch(`/api/channel/${id}/sync`, {
        method: "POST",
        headers,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "同步失败");

      toast(`获取到 ${data.total} 个模型`, "success");
    } catch (err) {
      // Show error message on the channel card instead of global error
      const message = err instanceof Error ? err.message : "同步失败";
      setSyncStatus((prev) => ({ ...prev, [id]: { message, type: "error" } }));

      // Auto clear after 8 seconds for errors
      setTimeout(() => {
        setSyncStatus((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      }, 8000);
    } finally {
      setSyncingId(null);
    }
  };

  const handleSyncAll = async () => {
    if (syncingAll || channels.length === 0) return;

    setSyncingAll(true);
    setError(null);

    try {
      const concurrency = 3;
      let totalModels = 0;
      let failedCount = 0;

      for (let index = 0; index < channels.length; index += concurrency) {
        const batch = channels.slice(index, index + concurrency);
        const results = await Promise.allSettled(
          batch.map(async (channel) => {
            const response = await fetch(`/api/channel/${channel.id}/sync`, {
              method: "POST",
              headers,
            });
            const data = await response.json();
            if (!response.ok) {
              throw new Error(data.error || "同步失败");
            }
            return Number(data.total) || 0;
          })
        );

        for (const result of results) {
          if (result.status === "fulfilled") {
            totalModels += result.value;
          } else {
            failedCount += 1;
          }
        }
      }

      if (failedCount > 0) {
        toast(`全量同步完成，获取到 ${totalModels} 个模型，${failedCount} 个渠道失败`, "error");
      } else {
        toast(`全量同步完成，获取到 ${totalModels} 个模型`, "success");
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : "全量同步失败", "error");
    } finally {
      setSyncingAll(false);
      onUpdate();
    }
  };

  const persistChannelOrder = async (orderedChannels: Channel[]) => {
    const orders = orderedChannels.map((channel, index) => ({
      id: channel.id,
      sortOrder: index,
    }));

    const response = await fetch("/api/channel", {
      method: "PUT",
      headers,
      body: JSON.stringify({ orders }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || "排序保存失败");
    }
  };

  const handleDropChannel = async (targetChannelId: string) => {
    if (!draggingChannelId || draggingChannelId === targetChannelId) {
      setDraggingChannelId(null);
      return;
    }

    const previousChannels = channels;
    const fromIndex = previousChannels.findIndex((channel) => channel.id === draggingChannelId);
    const toIndex = previousChannels.findIndex((channel) => channel.id === targetChannelId);

    if (fromIndex < 0 || toIndex < 0) {
      setDraggingChannelId(null);
      return;
    }

    const nextChannels = [...previousChannels];
    const [moved] = nextChannels.splice(fromIndex, 1);
    nextChannels.splice(toIndex, 0, moved);

    setChannels(nextChannels);
    setDraggingChannelId(null);

    try {
      await persistChannelOrder(nextChannels);
      onUpdate();
    } catch (err) {
      setChannels(previousChannels);
      toast(err instanceof Error ? err.message : "排序失败", "error");
    }
  };

  // Copy API key
  const handleCopyApiKey = async (id: string) => {
    setCopyingId(id);
    try {
      const response = await fetch(`/api/channel/${id}/key`, { headers });
      if (!response.ok) throw new Error("获取 API Key 失败");
      const data = await response.json();
      await navigator.clipboard.writeText(data.apiKey);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "复制失败");
    } finally {
      setCopyingId(null);
    }
  };

  // Export channels
  const handleExport = async () => {
    setExporting(true);
    setError(null);
    try {
      const response = await fetch("/api/channel/export", { headers });
      if (!response.ok) throw new Error("导出失败");
      const data = await response.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `channels-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast("导出成功", "success");
    } catch (err) {
      toast(err instanceof Error ? err.message : "导出失败", "error");
    } finally {
      setExporting(false);
    }
  };

  // Import channels
  const handleImport = async () => {
    setImporting(true);
    setError(null);
    try {
      const data = JSON.parse(importText);
      const response = await fetch("/api/channel/import", {
        method: "POST",
        headers,
        body: JSON.stringify({ ...data, mode: importMode }),
      });
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || "导入失败");
      }
      const result = await response.json();
      setShowImportModal(false);
      setImportText("");
      fetchChannels();
      onUpdate();
      const syncInfo = result.syncedModels > 0 ? `, 同步模型 ${result.syncedModels}` : "";
      toast(`导入成功: 新增 ${result.imported}, 更新 ${result.updated}, 跳过 ${result.skipped}${syncInfo}`, "success");
    } catch (err) {
      toast(err instanceof Error ? err.message : "导入失败", "error");
    } finally {
      setImporting(false);
    }
  };

  // Handle file import
  const handleFileImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      setImportText(event.target?.result as string);
    };
    reader.readAsText(file);
  };

  // 云通知 sync
  const handleWebDAVSync = async (action: "upload" | "download") => {
    if (action === "upload") {
      setWebdavUploading(true);
    } else {
      setWebdavDownloading(true);
    }
    setError(null);

    // Save config to sessionStorage before request (password excluded for security)
    // Note: Password is not persisted - user must re-enter or rely on env variable
    sessionStorage.setItem("webdav-config", JSON.stringify({
      url: webdavConfig.url,
      username: webdavConfig.username,
      filename: webdavConfig.filename,
    }));

    try {
      const response = await fetch("/api/channel/webdav", {
        method: "POST",
        headers,
        body: JSON.stringify({
          action,
          ...webdavConfig,
          mode: webdavMode,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "同步失败");

      if (action === "download") {
        fetchChannels();
        onUpdate();
        const syncInfo = result.syncedModels > 0 ? `, 同步模型 ${result.syncedModels}` : "";
        const dupInfo = result.duplicates > 0 ? `, 重复跳过 ${result.duplicates}` : "";
        toast(`下载成功: 新增 ${result.imported}, 跳过 ${result.skipped}${dupInfo}${syncInfo}`, "success");
      } else {
        const mergeInfo = result.mergedFromRemote > 0 ? `, 合并远端 ${result.mergedFromRemote}` : "";
        toast(`上传成功: 本地 ${result.localCount} 个渠道, 共上传 ${result.totalUploaded} 个${mergeInfo}`, "success");
      }
      setShowWebDAVModal(false);
    } catch (err) {
      toast(err instanceof Error ? err.message : "同步失败", "error");
    } finally {
      if (action === "upload") {
        setWebdavUploading(false);
      } else {
        setWebdavDownloading(false);
      }
    }
  };

  return (
    <div className={cn("rounded-lg border border-border bg-card", className)}>
      {/* Header - Toggle */}
      <div className="flex items-center gap-2 p-4 overflow-hidden">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex-1 flex items-center justify-between gap-2 hover:bg-accent/50 px-3 py-2 -ml-3 rounded transition-colors min-w-0"
        >
          <div className="flex items-center gap-2 min-w-0">
            <Settings className="h-5 w-5 text-muted-foreground shrink-0" />
            <span className="font-medium truncate">渠道管理</span>
            {channels.length > 0 && (
              <span className="text-sm text-muted-foreground shrink-0">
                ({channels.length})
              </span>
            )}
          </div>
          {isExpanded ? (
            <ChevronUp className="h-5 w-5 text-muted-foreground shrink-0" />
          ) : (
            <ChevronDown className="h-5 w-5 text-muted-foreground shrink-0" />
          )}
        </button>

        {/* Action buttons - compact on mobile */}
        <div className="flex items-center gap-1 shrink-0">
          {/* Add channel button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleAdd();
            }}
            className="inline-flex items-center gap-1 px-2 sm:px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
            title="添加渠道"
            aria-label="添加渠道"
          >
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">添加</span>
          </button>

          {/* Import button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowImportModal(true);
            }}
            className="inline-flex items-center justify-center w-8 h-8 rounded-md border border-input bg-background hover:bg-accent transition-colors"
            title="导入渠道"
            aria-label="导入渠道"
          >
            <Upload className="h-4 w-4" />
          </button>

          {/* Export button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleExport();
            }}
            disabled={exporting}
            className="inline-flex items-center justify-center w-8 h-8 rounded-md border border-input bg-background hover:bg-accent transition-colors disabled:opacity-50"
            title="导出渠道"
            aria-label="导出渠道"
          >
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          </button>

          {/* Sync all models button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleSyncAll();
            }}
            disabled={syncingAll || channels.length === 0}
            className="inline-flex items-center justify-center w-8 h-8 rounded-md border border-input bg-background hover:bg-accent transition-colors disabled:opacity-50"
            title="全量同步模型"
            aria-label="全量同步模型"
          >
            {syncingAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </button>

          {/* 云通知按钮 */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowWebDAVModal(true);
            }}
            className="inline-flex items-center justify-center w-8 h-8 rounded-md border border-input bg-background hover:bg-accent transition-colors"
            title="云通知"
            aria-label="云通知"
          >
            <Cloud className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Content */}
      {isExpanded && (
        <div className="border-t border-border p-4 space-y-4">
          {/* Error */}
          {error && (
            <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm">
              {error}
            </div>
          )}

          {/* Channel list */}
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : channels.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              暂无渠道，点击上方按钮添加
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {channels
                  .slice((channelPage - 1) * CHANNELS_PER_PAGE, channelPage * CHANNELS_PER_PAGE)
                  .map((channel) => (
                <div
                  key={channel.id}
                  draggable
                  onDragStart={() => setDraggingChannelId(channel.id)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => handleDropChannel(channel.id)}
                  onDragEnd={() => setDraggingChannelId(null)}
                  className={cn(
                    "flex flex-col p-3 rounded-md border border-border bg-background",
                    draggingChannelId === channel.id && "opacity-60"
                  )}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span className="font-medium truncate">
                        {channel.name}
                      </span>
                    </div>
                  </div>
                  <div className="text-sm text-muted-foreground truncate">
                    {channel.baseUrl}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {channel._count?.models || 0} 个模型 | Key:{" "}
                    {channel.apiKey}
                  </div>
                  {/* Sync status message */}
                  {syncStatus[channel.id] && (
                    <div
                      className={cn(
                        "text-xs mt-2 px-2 py-1 rounded",
                        syncStatus[channel.id].type === "success"
                          ? "bg-green-500/10 text-green-600 dark:text-green-400"
                          : "bg-destructive/10 text-destructive"
                      )}
                    >
                      {syncStatus[channel.id].message}
                    </div>
                  )}
                  <div className="flex items-center gap-1 mt-3 pt-2 border-t border-border">
                    <button
                      onClick={() => handleCopyApiKey(channel.id)}
                      disabled={copyingId === channel.id}
                      className="p-2 rounded-md hover:bg-accent transition-colors disabled:opacity-50"
                      title="复制 API Key"
                      aria-label="复制 API Key"
                    >
                      {copyingId === channel.id ? (
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      ) : copiedId === channel.id ? (
                        <Check className="h-4 w-4 text-green-500" />
                      ) : (
                        <Copy className="h-4 w-4 text-muted-foreground" />
                      )}
                    </button>
                    <button
                      onClick={() => handleSync(channel.id)}
                      disabled={syncingId === channel.id}
                      className="p-2 rounded-md hover:bg-accent transition-colors disabled:opacity-50"
                      title="同步模型列表"
                      aria-label="同步模型列表"
                    >
                      <RefreshCw
                        className={cn(
                          "h-4 w-4 text-blue-500",
                          syncingId === channel.id && "animate-spin"
                        )}
                      />
                    </button>
                    <button
                      onClick={() => handleEdit(channel)}
                      className="p-2 rounded-md hover:bg-accent transition-colors"
                      title="编辑"
                      aria-label="编辑渠道"
                    >
                      <Pencil className="h-4 w-4 text-muted-foreground" />
                    </button>
                    {deleteConfirm === channel.id ? (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleDelete(channel.id)}
                          className="px-2 py-1 text-xs rounded bg-destructive text-destructive-foreground"
                        >
                          确认
                        </button>
                        <button
                          onClick={() => setDeleteConfirm(null)}
                          className="px-2 py-1 text-xs rounded bg-muted"
                        >
                          取消
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setDeleteConfirm(channel.id)}
                        className="p-2 rounded-md hover:bg-accent transition-colors"
                        title="删除"
                        aria-label="删除渠道"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Pagination */}
            {channels.length > CHANNELS_PER_PAGE && (
              <div className="flex items-center justify-center gap-2 pt-2">
                <button
                  onClick={() => setChannelPage((p) => Math.max(1, p - 1))}
                  disabled={channelPage <= 1}
                  className={cn(
                    "px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                    channelPage <= 1
                      ? "text-muted-foreground cursor-not-allowed"
                      : "text-foreground hover:bg-accent"
                  )}
                >
                  <ChevronUp className="h-4 w-4 rotate-[-90deg]" />
                </button>
                <span className="text-sm text-muted-foreground">
                  {channelPage} / {Math.ceil(channels.length / CHANNELS_PER_PAGE)}
                </span>
                <button
                  onClick={() => setChannelPage((p) => Math.min(Math.ceil(channels.length / CHANNELS_PER_PAGE), p + 1))}
                  disabled={channelPage >= Math.ceil(channels.length / CHANNELS_PER_PAGE)}
                  className={cn(
                    "px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                    channelPage >= Math.ceil(channels.length / CHANNELS_PER_PAGE)
                      ? "text-muted-foreground cursor-not-allowed"
                      : "text-foreground hover:bg-accent"
                  )}
                >
                  <ChevronDown className="h-4 w-4 rotate-[-90deg]" />
                </button>
              </div>
            )}
          </>
          )}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="channel-modal-title"
        >
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setShowModal(false)}
            aria-hidden="true"
          />
          <div className="relative w-full max-w-lg mx-4 bg-card rounded-lg shadow-lg border border-border max-h-[90vh] overflow-y-auto">
            {/* Modal header */}
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h2 id="channel-modal-title" className="text-lg font-semibold">
                {editingChannel ? "编辑渠道" : "添加渠道"}
              </h2>
              <button
                onClick={() => setShowModal(false)}
                className="p-1 rounded-md hover:bg-accent transition-colors"
                aria-label="关闭"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Modal form */}
            <form onSubmit={handleSubmit} className="p-4 space-y-4">
              {/* Name */}
              <div>
                <label className="block text-sm font-medium mb-1">
                  渠道名称 <span className="text-destructive">*</span>
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) =>
                    setFormData({ ...formData, name: e.target.value })
                  }
                  className="w-full px-3 py-2 rounded-md border border-input bg-background"
                  placeholder="OpenAI"
                  required
                />
              </div>

              {/* Base URL */}
              <div>
                <label className="block text-sm font-medium mb-1">
                  Base URL <span className="text-destructive">*</span>
                </label>
                <input
                  type="url"
                  value={formData.baseUrl}
                  onChange={(e) =>
                    setFormData({ ...formData, baseUrl: e.target.value })
                  }
                  className="w-full px-3 py-2 rounded-md border border-input bg-background"
                  placeholder="https://api.openai.com"
                  required
                />
              </div>

              {/* API Key */}
              <div>
                <label className="block text-sm font-medium mb-1">
                  API Key{" "}
                  {!editingChannel && (
                    <span className="text-destructive">*</span>
                  )}
                </label>
                <input
                  type="password"
                  value={formData.apiKey}
                  onChange={(e) =>
                    setFormData({ ...formData, apiKey: e.target.value })
                  }
                  className="w-full px-3 py-2 rounded-md border border-input bg-background"
                  placeholder={
                    editingChannel ? "留空保持不变" : "sk-xxx..."
                  }
                  required={!editingChannel}
                />
              </div>

              {/* Proxy */}
              <div>
                <label className="block text-sm font-medium mb-1">
                  代理地址
                </label>
                <input
                  type="text"
                  value={formData.proxy}
                  onChange={(e) =>
                    setFormData({ ...formData, proxy: e.target.value })
                  }
                  className="w-full px-3 py-2 rounded-md border border-input bg-background"
                  placeholder="http://... 或 socks5://...（可选）"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  支持 HTTP/HTTPS/SOCKS5 代理
                </p>
              </div>

              {/* Error in modal */}
              {error && submitting && (
                <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm">
                  {error}
                </div>
              )}

              {/* Submit */}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 rounded-md border border-input bg-background text-sm font-medium hover:bg-accent transition-colors"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center gap-2"
                >
                  {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                  {editingChannel ? "保存" : "添加"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Import Modal */}
      {showImportModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="import-modal-title"
        >
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setShowImportModal(false)}
            aria-hidden="true"
          />
          <div className="relative w-full max-w-lg mx-4 bg-card rounded-lg shadow-lg border border-border max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h2 id="import-modal-title" className="text-lg font-semibold">导入渠道</h2>
              <button
                onClick={() => setShowImportModal(false)}
                className="p-1 rounded-md hover:bg-accent transition-colors"
                aria-label="关闭"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-4 space-y-4">
              {/* Import mode */}
              <div>
                <label className="block text-sm font-medium mb-1">导入模式</label>
                <select
                  value={importMode}
                  onChange={(e) => setImportMode(e.target.value as "merge" | "replace")}
                  className="w-full px-3 py-2 rounded-md border border-input bg-background"
                >
                  <option value="merge">合并（更新同名渠道）</option>
                  <option value="replace">替换（删除所有现有渠道）</option>
                </select>
              </div>

              {/* File input */}
              <div>
                <label className="block text-sm font-medium mb-1">选择文件</label>
                <input
                  type="file"
                  accept=".json"
                  onChange={handleFileImport}
                  className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm"
                />
              </div>

              {/* JSON textarea */}
              <div>
                <label className="block text-sm font-medium mb-1">或粘贴 JSON</label>
                <textarea
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  className="w-full px-3 py-2 rounded-md border border-input bg-background font-mono text-sm h-40"
                  placeholder='{"version":"1.0","channels":[...]}'
                />
              </div>

              {/* Error in modal */}
              {error && importing && (
                <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm">
                  {error}
                </div>
              )}

              {/* Submit */}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowImportModal(false)}
                  className="px-4 py-2 rounded-md border border-input bg-background text-sm font-medium hover:bg-accent transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleImport}
                  disabled={importing || !importText.trim()}
                  className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center gap-2"
                >
                  {importing && <Loader2 className="h-4 w-4 animate-spin" />}
                  导入
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 云通知 Modal */}
      {showWebDAVModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="webdav-modal-title"
        >
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setShowWebDAVModal(false)}
            aria-hidden="true"
          />
          <div className="relative w-full max-w-lg mx-4 bg-card rounded-lg shadow-lg border border-border max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h2 id="webdav-modal-title" className="text-lg font-semibold">云通知</h2>
              <button
                onClick={() => setShowWebDAVModal(false)}
                className="p-1 rounded-md hover:bg-accent transition-colors"
                aria-label="关闭"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-4 space-y-4">
              {/* Env config hint */}
              {webdavEnvConfigured && (
                <div className="p-3 rounded-md bg-green-500/10 border border-green-500/20 text-sm text-green-600 dark:text-green-400">
                  已从环境变量加载云通知配置。密码留空将使用环境变量中的密码。
                </div>
              )}

              {/* Jianguoyun hint */}
              <div className="p-3 rounded-md bg-blue-500/10 border border-blue-500/20 text-sm text-blue-600 dark:text-blue-400">
                坚果云用户：需先在网页端创建同步文件夹，URL 填写到该文件夹路径。密码需使用应用密码（非登录密码）。
              </div>

              {/* 云服务 URL */}
              <div>
                <label className="block text-sm font-medium mb-1">
                  服务地址 <span className="text-destructive">*</span>
                </label>
                <input
                  type="url"
                  value={webdavConfig.url}
                  onChange={(e) => setWebdavConfig({ ...webdavConfig, url: e.target.value })}
                  className="w-full px-3 py-2 rounded-md border border-input bg-background"
                  placeholder="https://dav.jianguoyun.com/dav/你的文件夹"
                />
              </div>

              {/* Username */}
              <div>
                <label className="block text-sm font-medium mb-1">用户名</label>
                <input
                  type="text"
                  value={webdavConfig.username}
                  onChange={(e) => setWebdavConfig({ ...webdavConfig, username: e.target.value })}
                  className="w-full px-3 py-2 rounded-md border border-input bg-background"
                  placeholder="邮箱或用户名"
                />
              </div>

              {/* Password */}
              <div>
                <label className="block text-sm font-medium mb-1">密码</label>
                <input
                  type="password"
                  value={webdavConfig.password}
                  onChange={(e) => setWebdavConfig({ ...webdavConfig, password: e.target.value })}
                  className="w-full px-3 py-2 rounded-md border border-input bg-background"
                  placeholder={webdavEnvConfigured ? "留空使用环境变量密码" : "应用密码"}
                />
              </div>

              {/* Filename */}
              <div>
                <label className="block text-sm font-medium mb-1">文件路径</label>
                <input
                  type="text"
                  value={webdavConfig.filename}
                  onChange={(e) => setWebdavConfig({ ...webdavConfig, filename: e.target.value })}
                  className="w-full px-3 py-2 rounded-md border border-input bg-background"
                  placeholder="channels.json"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  可包含子目录（如 backup/channels.json），子目录会自动创建
                </p>
              </div>

              {/* Sync mode */}
              <div>
                <label className="block text-sm font-medium mb-1">同步模式</label>
                <select
                  value={webdavMode}
                  onChange={(e) => setWebdavMode(e.target.value as "merge" | "replace")}
                  className="w-full px-3 py-2 rounded-md border border-input bg-background"
                >
                  <option value="merge">合并（保留已有渠道，仅添加新渠道）</option>
                  <option value="replace">替换（清空后重新导入）</option>
                </select>
              </div>

              {/* Error in modal */}
              {error && (webdavUploading || webdavDownloading) && (
                <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm">
                  {error}
                </div>
              )}

              {/* Actions */}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowWebDAVModal(false)}
                  className="px-4 py-2 rounded-md border border-input bg-background text-sm font-medium hover:bg-accent transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={() => handleWebDAVSync("download")}
                  disabled={webdavUploading || webdavDownloading || !webdavConfig.url}
                  className="px-4 py-2 rounded-md border border-input bg-background text-sm font-medium hover:bg-accent disabled:opacity-50 transition-colors flex items-center gap-2"
                >
                  {webdavDownloading && <Loader2 className="h-4 w-4 animate-spin" />}
                  <Download className="h-4 w-4" />
                  下载
                </button>
                <button
                  onClick={() => handleWebDAVSync("upload")}
                  disabled={webdavUploading || webdavDownloading || !webdavConfig.url}
                  className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center gap-2"
                >
                  {webdavUploading && <Loader2 className="h-4 w-4 animate-spin" />}
                  <Upload className="h-4 w-4" />
                  上传
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
