// Proxy Key Modal - Create or edit a proxy API key

"use client";

import { useState, useEffect, FormEvent } from "react";
import { X, Loader2, Copy, RefreshCw, Check } from "lucide-react";
import { useAuth } from "@/components/providers/auth-provider";
import { useToast } from "@/components/ui/toast";
import { ChannelModelSelector, type ChannelWithModels } from "@/components/ui/channel-model-selector";
import { cn } from "@/lib/utils";

interface ProxyKeyData {
  id: string;
  name: string;
  key: string;
  enabled: boolean;
  allowAllModels: boolean;
  allowedChannelIds: string[] | null;
  allowedModelIds: string[] | null;
}

interface ProxyKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  editingKey: ProxyKeyData | null;
  onSuccess: () => void;
}

export function ProxyKeyModal({ isOpen, onClose, editingKey, onSuccess }: ProxyKeyModalProps) {
  const { token } = useAuth();
  const { toast } = useToast();

  const [saving, setSaving] = useState(false);
  const [loadingChannels, setLoadingChannels] = useState(true);
  const [channels, setChannels] = useState<ChannelWithModels[]>([]);

  // Form state
  const [name, setName] = useState("");
  const [generatedKey, setGeneratedKey] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [allowAllModels, setAllowAllModels] = useState(true);
  const [selectedChannelIds, setSelectedChannelIds] = useState<string[]>([]);
  const [selectedModelIds, setSelectedModelIds] = useState<Record<string, string[]>>({});

  // Copy state
  const [copied, setCopied] = useState(false);

  // Load channels for selector
  useEffect(() => {
    if (!isOpen || !token) return;

    const controller = new AbortController();

    const loadChannels = async () => {
      setLoadingChannels(true);
      try {
        const response = await fetch("/api/scheduler/config", {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });

        if (controller.signal.aborted) return;

        if (response.ok) {
          const data = await response.json();
          if (!controller.signal.aborted) {
            setChannels(data.channels);
          }
        }
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
        console.error("Failed to load channels:", error);
      } finally {
        if (!controller.signal.aborted) {
          setLoadingChannels(false);
        }
      }
    };

    loadChannels();
    return () => controller.abort();
  }, [isOpen, token]);

  // Initialize form state
  useEffect(() => {
    if (editingKey) {
      setName(editingKey.name);
      setEnabled(editingKey.enabled);
      setAllowAllModels(editingKey.allowAllModels);
      setSelectedChannelIds(editingKey.allowedChannelIds || []);
      setSelectedModelIds((editingKey.allowedModelIds as unknown as Record<string, string[]>) || {});
      setGeneratedKey(""); // Don't show key in edit mode
    } else {
      setName("");
      setEnabled(true);
      setAllowAllModels(true);
      setSelectedChannelIds([]);
      setSelectedModelIds({});
      // Auto-generate a key
      handleGenerateKey();
    }
  }, [editingKey, isOpen]);

  // Generate a new key value
  const handleGenerateKey = () => {
    // Generate key on client side (will be regenerated server-side if not provided)
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let result = "sk-";
    for (let i = 0; i < 48; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setGeneratedKey(result);
  };

  // Copy key to clipboard
  const handleCopy = async () => {
    if (!generatedKey) return;
    await navigator.clipboard.writeText(generatedKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Handle save
  const handleSave = async (e: FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      toast("请输入密钥名称", "error");
      return;
    }

    setSaving(true);
    try {
      if (editingKey) {
        // Update existing key
        const response = await fetch(`/api/proxy-keys/${editingKey.id}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            name: name.trim(),
            enabled,
            allowAllModels,
            allowedChannelIds: allowAllModels ? null : selectedChannelIds,
            allowedModelIds: allowAllModels ? null : selectedModelIds,
          }),
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || "更新失败");
        }

        toast("密钥已更新", "success");
      } else {
        // Create new key
        const response = await fetch("/api/proxy-keys", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            name: name.trim(),
            key: generatedKey || undefined,
            enabled,
            allowAllModels,
            allowedChannelIds: allowAllModels ? null : selectedChannelIds,
            allowedModelIds: allowAllModels ? null : selectedModelIds,
          }),
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || "创建失败");
        }

        const data = await response.json();
        // Copy the key to clipboard
        if (data.key?.key) {
          await navigator.clipboard.writeText(data.key.key);
          toast("密钥已创建并复制到剪贴板", "success");
        } else {
          toast("密钥已创建", "success");
        }
      }

      onSuccess();
    } catch (error) {
      console.error("Failed to save proxy key:", error);
      toast(error instanceof Error ? error.message : "操作失败", "error");
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="proxy-key-modal-title"
    >
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative w-full max-w-lg mx-4 bg-card rounded-lg shadow-lg border border-border max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border sticky top-0 bg-card z-10">
          <h2 id="proxy-key-modal-title" className="text-lg font-semibold">
            {editingKey ? "编辑代理密钥" : "创建代理密钥"}
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded-md hover:bg-accent transition-colors"
            aria-label="关闭"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSave} className="p-4 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-sm font-medium mb-1">
              名称 <span className="text-destructive">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm"
              placeholder="例如: 开发测试"
              required
            />
          </div>

          {/* Key value (only for creation) */}
          {!editingKey && (
            <div>
              <label className="block text-sm font-medium mb-1">密钥值</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={generatedKey}
                  onChange={(e) => setGeneratedKey(e.target.value)}
                  className="flex-1 px-3 py-2 rounded-md border border-input bg-background text-sm font-mono"
                  placeholder="sk-..."
                  readOnly
                />
                <button
                  type="button"
                  onClick={handleGenerateKey}
                  className="p-2 rounded-md border border-input hover:bg-accent transition-colors"
                  title="生成新密钥"
                >
                  <RefreshCw className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="p-2 rounded-md border border-input hover:bg-accent transition-colors"
                  title="复制"
                >
                  {copied ? (
                    <Check className="h-4 w-4 text-green-500" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Enable toggle */}
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">启用此密钥</label>
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

          {/* Access permissions */}
          <div>
            <label className="block text-sm font-medium mb-2">访问权限</label>
            <div className="space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="accessMode"
                  checked={allowAllModels}
                  onChange={() => setAllowAllModels(true)}
                  className="w-4 h-4 text-primary"
                />
                <span className="text-sm">所有已检测可用模型</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="accessMode"
                  checked={!allowAllModels}
                  onChange={() => setAllowAllModels(false)}
                  className="w-4 h-4 text-primary"
                />
                <span className="text-sm">自定义权限</span>
              </label>
            </div>
          </div>

          {/* Channel/Model selector */}
          {!allowAllModels && (
            <div className="border border-border rounded-md p-3">
              {loadingChannels ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <ChannelModelSelector
                  channels={channels}
                  selectedChannelIds={selectedChannelIds}
                  selectedModelIds={selectedModelIds}
                  onSelectionChange={(channelIds, modelIds) => {
                    setSelectedChannelIds(channelIds);
                    setSelectedModelIds(modelIds);
                  }}
                  selectAllLabel="全选所有渠道"
                />
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2 border-t border-border">
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
              {editingKey ? "保存" : "创建"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
