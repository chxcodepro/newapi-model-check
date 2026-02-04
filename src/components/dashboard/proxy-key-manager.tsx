// Proxy Key Manager component
// Lists and manages proxy API keys

"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Key,
  Plus,
  Pencil,
  Trash2,
  Copy,
  Check,
  Loader2,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  ToggleLeft,
  ToggleRight,
} from "lucide-react";
import { useAuth } from "@/components/providers/auth-provider";
import { useToast } from "@/components/ui/toast";
import { ProxyKeyModal } from "./proxy-key-modal";
import { cn } from "@/lib/utils";

interface ProxyKeyData {
  id: string;
  name: string;
  key: string;
  enabled: boolean;
  allowAllModels: boolean;
  allowedChannelIds: string[] | null;
  allowedModelIds: string[] | null;
  lastUsedAt: string | null;
  usageCount: number;
  createdAt: string;
  source?: "database" | "env" | "auto";
}

interface ProxyKeyManagerProps {
  className?: string;
}

export function ProxyKeyManager({ className }: ProxyKeyManagerProps) {
  const { token } = useAuth();
  const { toast } = useToast();

  const [isExpanded, setIsExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [keys, setKeys] = useState<ProxyKeyData[]>([]);

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [editingKey, setEditingKey] = useState<ProxyKeyData | null>(null);

  // Copy state
  const [copyingId, setCopyingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Delete state
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // Mount ref for safe async state updates
  const mountedRef = useRef(true);

  // Track mount state
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Fetch keys
  const fetchKeys = useCallback(async () => {
    if (!token) return;

    setLoading(true);
    try {
      const response = await fetch("/api/proxy-keys", {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) throw new Error("Failed to fetch keys");

      const data = await response.json();
      if (mountedRef.current) {
        setKeys(data.keys);
      }
    } catch (error) {
      console.error("Failed to fetch proxy keys:", error);
      if (mountedRef.current) {
        toast("获取密钥列表失败", "error");
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [token, toast]);

  // Load keys when expanded
  useEffect(() => {
    if (isExpanded && token) {
      fetchKeys();
    }
  }, [isExpanded, token, fetchKeys]);

  // Copy key to clipboard
  const handleCopy = async (id: string) => {
    setCopyingId(id);
    try {
      const response = await fetch(`/api/proxy-keys/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) throw new Error("Failed to get key");

      const data = await response.json();
      await navigator.clipboard.writeText(data.key.key);
      if (mountedRef.current) {
        setCopiedId(id);
        setTimeout(() => {
          if (mountedRef.current) setCopiedId(null);
        }, 2000);
        toast("已复制到剪贴板", "success");
      }
    } catch (error) {
      console.error("Failed to copy key:", error);
      if (mountedRef.current) {
        toast("复制失败", "error");
      }
    } finally {
      if (mountedRef.current) {
        setCopyingId(null);
      }
    }
  };

  // Toggle key enabled status
  const handleToggleEnabled = async (key: ProxyKeyData) => {
    try {
      const response = await fetch(`/api/proxy-keys/${key.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ enabled: !key.enabled }),
      });

      if (!response.ok) throw new Error("Failed to update key");

      if (mountedRef.current) {
        fetchKeys();
        toast(key.enabled ? "密钥已禁用" : "密钥已启用", "success");
      }
    } catch (error) {
      console.error("Failed to toggle key:", error);
      if (mountedRef.current) {
        toast("操作失败", "error");
      }
    }
  };

  // Delete key
  const handleDelete = async (id: string) => {
    try {
      const response = await fetch(`/api/proxy-keys/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) throw new Error("Failed to delete key");

      if (mountedRef.current) {
        setDeleteConfirm(null);
        fetchKeys();
        toast("密钥已删除", "success");
      }
    } catch (error) {
      console.error("Failed to delete key:", error);
      if (mountedRef.current) {
        toast("删除失败", "error");
      }
    }
  };

  // Regenerate key
  const handleRegenerate = async (id: string) => {
    try {
      const response = await fetch(`/api/proxy-keys/${id}/regenerate`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) throw new Error("Failed to regenerate key");

      const data = await response.json();
      await navigator.clipboard.writeText(data.key.key);
      if (mountedRef.current) {
        fetchKeys();
        toast("密钥已重新生成并复制到剪贴板", "success");
      }
    } catch (error) {
      console.error("Failed to regenerate key:", error);
      if (mountedRef.current) {
        toast("重新生成失败", "error");
      }
    }
  };

  // Format date
  const formatDate = (isoString: string | null): string => {
    if (!isoString) return "-";
    const date = new Date(isoString);
    return date.toLocaleString("zh-CN", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className={cn("rounded-lg border border-border bg-card", className)}>
      {/* Header */}
      <div className="flex items-center gap-2 p-4 overflow-hidden">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex-1 flex items-center justify-between gap-2 hover:bg-accent/50 px-3 py-2 -ml-3 rounded transition-colors min-w-0"
        >
          <div className="flex items-center gap-2 min-w-0">
            <Key className="h-5 w-5 text-muted-foreground shrink-0" />
            <span className="font-medium truncate">代理密钥管理</span>
            {keys.length > 0 && (
              <span className="text-sm text-muted-foreground shrink-0">
                ({keys.length})
              </span>
            )}
          </div>
          {isExpanded ? (
            <ChevronUp className="h-5 w-5 text-muted-foreground shrink-0" />
          ) : (
            <ChevronDown className="h-5 w-5 text-muted-foreground shrink-0" />
          )}
        </button>

        {/* Add button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            setEditingKey(null);
            setShowModal(true);
          }}
          className="inline-flex items-center gap-1 px-2 sm:px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors shrink-0"
          title="添加密钥"
        >
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">添加</span>
        </button>
      </div>

      {/* Content */}
      {isExpanded && (
        <div className="border-t border-border p-4 space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : keys.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              暂无代理密钥，点击上方按钮添加
            </div>
          ) : (
            <div className="space-y-3">
              {keys.map((key) => {
                const isBuiltIn = key.source === "env" || key.source === "auto";
                return (
                <div
                  key={key.id}
                  className={cn(
                    "flex flex-col p-3 rounded-md border bg-background",
                    !key.enabled && "border-red-500/30 bg-red-500/5",
                    isBuiltIn && key.enabled && "border-blue-500/30 bg-blue-500/5"
                  )}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span className={cn("font-medium truncate", !key.enabled && "text-muted-foreground")}>
                        {key.name}
                      </span>
                      {key.source === "env" && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-500">
                          环境变量
                        </span>
                      )}
                      {key.source === "auto" && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-yellow-500/10 text-yellow-600">
                          自动生成
                        </span>
                      )}
                      {!key.enabled && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-red-500/10 text-red-500">
                          已禁用
                        </span>
                      )}
                    </div>
                    {!isBuiltIn && (
                      <button
                        onClick={() => handleToggleEnabled(key)}
                        className="p-1 hover:bg-accent rounded transition-colors"
                        title={key.enabled ? "禁用密钥" : "启用密钥"}
                      >
                        {key.enabled ? (
                          <ToggleRight className="h-5 w-5 text-green-500" />
                        ) : (
                          <ToggleLeft className="h-5 w-5 text-muted-foreground" />
                        )}
                      </button>
                    )}
                  </div>

                  <div className="text-sm font-mono text-muted-foreground truncate mb-1">
                    {key.key}
                  </div>

                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span>
                      {key.allowAllModels ? "所有模型" : "自定义权限"}
                    </span>
                    {!isBuiltIn && (
                      <>
                        <span>使用 {key.usageCount} 次</span>
                        <span>最后使用: {formatDate(key.lastUsedAt)}</span>
                      </>
                    )}
                    {isBuiltIn && key.source === "auto" && (
                      <span className="text-yellow-600">重启后会变化</span>
                    )}
                  </div>

                  <div className="flex items-center gap-1 mt-3 pt-2 border-t border-border">
                    <button
                      onClick={() => handleCopy(key.id)}
                      disabled={copyingId === key.id}
                      className="p-2 rounded-md hover:bg-accent transition-colors disabled:opacity-50"
                      title="复制密钥"
                    >
                      {copyingId === key.id ? (
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      ) : copiedId === key.id ? (
                        <Check className="h-4 w-4 text-green-500" />
                      ) : (
                        <Copy className="h-4 w-4 text-muted-foreground" />
                      )}
                    </button>
                    {!isBuiltIn && (
                      <>
                        <button
                          onClick={() => handleRegenerate(key.id)}
                          className="p-2 rounded-md hover:bg-accent transition-colors"
                          title="重新生成"
                        >
                          <RefreshCw className="h-4 w-4 text-blue-500" />
                        </button>
                        <button
                          onClick={() => {
                            setEditingKey(key);
                            setShowModal(true);
                          }}
                          className="p-2 rounded-md hover:bg-accent transition-colors"
                          title="编辑"
                        >
                          <Pencil className="h-4 w-4 text-muted-foreground" />
                        </button>
                        {deleteConfirm === key.id ? (
                          <div className="flex items-center gap-1 ml-auto">
                            <button
                              onClick={() => handleDelete(key.id)}
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
                            onClick={() => setDeleteConfirm(key.id)}
                            className="p-2 rounded-md hover:bg-accent transition-colors"
                            title="删除"
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );})}
            </div>
          )}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <ProxyKeyModal
          isOpen={showModal}
          onClose={() => {
            setShowModal(false);
            setEditingKey(null);
          }}
          editingKey={editingKey}
          onSuccess={() => {
            setShowModal(false);
            setEditingKey(null);
            fetchKeys();
          }}
        />
      )}
    </div>
  );
}
