// Channel and Model Selector component
// Used for selecting channels and models in scheduler settings and proxy key permissions

"use client";

import { useState, useMemo } from "react";
import { ChevronDown, ChevronRight, Check, Square, CheckSquare, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ModelInfo {
  id: string;
  modelName: string;
  lastStatus: boolean | null;
}

export interface ChannelWithModels {
  id: string;
  name: string;
  models: ModelInfo[];
}

interface ChannelModelSelectorProps {
  channels: ChannelWithModels[];
  selectedChannelIds: string[];
  selectedModelIds: Record<string, string[]>;
  onSelectionChange: (channelIds: string[], modelIds: Record<string, string[]>) => void;
  selectAllLabel?: string;
  showModelStatus?: boolean;
  maxHeight?: string;
  className?: string;
}

export function ChannelModelSelector({
  channels,
  selectedChannelIds,
  selectedModelIds,
  onSelectionChange,
  selectAllLabel = "全部渠道",
  showModelStatus = true,
  maxHeight = "16rem",
  className,
}: ChannelModelSelectorProps) {
  const [expandedChannels, setExpandedChannels] = useState<Set<string>>(new Set());

  // Check if all channels are fully selected (all models in each channel)
  const allChannelsSelected = useMemo(() => {
    if (channels.length === 0) return false;
    return channels.every((channel) => {
      const selected = selectedModelIds[channel.id] || [];
      return channel.models.length > 0 && selected.length === channel.models.length;
    });
  }, [channels, selectedModelIds]);

  // Check if some (but not all) channels/models are selected
  const someChannelsSelected = useMemo(() => {
    if (channels.length === 0) return false;
    const hasAnySelection = selectedChannelIds.length > 0;
    return hasAnySelection && !allChannelsSelected;
  }, [channels, selectedChannelIds, allChannelsSelected]);

  // Check if all models in a channel are selected
  const isChannelFullySelected = (channelId: string) => {
    const channel = channels.find((c) => c.id === channelId);
    if (!channel || channel.models.length === 0) return false;

    const selected = selectedModelIds[channelId] || [];
    return selected.length === channel.models.length;
  };

  // Check if some models in a channel are selected
  const isChannelPartiallySelected = (channelId: string) => {
    const channel = channels.find((c) => c.id === channelId);
    if (!channel || channel.models.length === 0) return false;

    const selected = selectedModelIds[channelId] || [];
    return selected.length > 0 && selected.length < channel.models.length;
  };

  // Toggle channel expansion
  const toggleChannelExpand = (channelId: string) => {
    setExpandedChannels((prev) => {
      const next = new Set(prev);
      if (next.has(channelId)) {
        next.delete(channelId);
      } else {
        next.add(channelId);
      }
      return next;
    });
  };

  // Select/deselect all channels
  const handleSelectAll = () => {
    if (allChannelsSelected) {
      // Deselect all
      onSelectionChange([], {});
    } else {
      // Select all channels and all their models
      const allChannelIds = channels.map((c) => c.id);
      const allModelIds: Record<string, string[]> = {};
      channels.forEach((c) => {
        allModelIds[c.id] = c.models.map((m) => m.id);
      });
      onSelectionChange(allChannelIds, allModelIds);
    }
  };

  // Select/deselect a channel (all its models)
  const handleChannelToggle = (channelId: string) => {
    const channel = channels.find((c) => c.id === channelId);
    if (!channel) return;

    const isSelected = selectedChannelIds.includes(channelId);

    if (isSelected) {
      // Deselect channel and all its models
      onSelectionChange(
        selectedChannelIds.filter((id) => id !== channelId),
        Object.fromEntries(
          Object.entries(selectedModelIds).filter(([id]) => id !== channelId)
        )
      );
    } else {
      // Select channel and all its models
      onSelectionChange(
        [...selectedChannelIds, channelId],
        {
          ...selectedModelIds,
          [channelId]: channel.models.map((m) => m.id),
        }
      );
    }
  };

  // Select/deselect a model
  const handleModelToggle = (channelId: string, modelId: string) => {
    const currentSelected = selectedModelIds[channelId] || [];
    const isSelected = currentSelected.includes(modelId);
    const channel = channels.find((c) => c.id === channelId);
    if (!channel) return;

    let newModelIds: string[];
    if (isSelected) {
      newModelIds = currentSelected.filter((id) => id !== modelId);
    } else {
      newModelIds = [...currentSelected, modelId];
    }

    // Update channel selection based on model selection
    let newChannelIds = [...selectedChannelIds];
    if (newModelIds.length === 0) {
      // No models selected, remove channel from selection
      newChannelIds = newChannelIds.filter((id) => id !== channelId);
    } else if (!newChannelIds.includes(channelId)) {
      // Some models selected, add channel to selection
      newChannelIds.push(channelId);
    }

    onSelectionChange(newChannelIds, {
      ...selectedModelIds,
      [channelId]: newModelIds,
    });
  };

  // Invert selection
  const handleInvertSelection = () => {
    const newChannelIds: string[] = [];
    const newModelIds: Record<string, string[]> = {};

    channels.forEach((channel) => {
      const currentSelected = selectedModelIds[channel.id] || [];
      const invertedModels = channel.models
        .filter((m) => !currentSelected.includes(m.id))
        .map((m) => m.id);

      if (invertedModels.length > 0) {
        newChannelIds.push(channel.id);
        newModelIds[channel.id] = invertedModels;
      }
    });

    onSelectionChange(newChannelIds, newModelIds);
  };

  return (
    <div className={cn("space-y-2", className)}>
      {/* Control buttons */}
      <div className="flex items-center gap-2 pb-2 border-b border-border">
        <button
          type="button"
          onClick={handleSelectAll}
          className="flex items-center gap-1 px-2 py-1 text-xs rounded hover:bg-accent transition-colors"
        >
          {allChannelsSelected ? (
            <CheckSquare className="h-3.5 w-3.5 text-primary" />
          ) : someChannelsSelected ? (
            <Minus className="h-3.5 w-3.5 text-primary" />
          ) : (
            <Square className="h-3.5 w-3.5 text-muted-foreground" />
          )}
          <span>{selectAllLabel}</span>
        </button>
        <button
          type="button"
          onClick={handleInvertSelection}
          className="px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-accent rounded transition-colors"
        >
          反选
        </button>
        <span className="text-xs text-muted-foreground ml-auto">
          已选 {selectedChannelIds.length}/{channels.length} 渠道
        </span>
      </div>

      {/* Channel list */}
      <div className="overflow-y-auto space-y-1" style={{ maxHeight }}>
        {channels.map((channel) => {
          const isExpanded = expandedChannels.has(channel.id);
          const isSelected = selectedChannelIds.includes(channel.id);
          const isPartial = isChannelPartiallySelected(channel.id);
          const isFull = isChannelFullySelected(channel.id);

          return (
            <div key={channel.id} className="border border-border rounded">
              {/* Channel header */}
              <div className="flex items-center gap-1 p-2 hover:bg-accent/50">
                <button
                  type="button"
                  onClick={() => toggleChannelExpand(channel.id)}
                  className="p-0.5 hover:bg-accent rounded"
                >
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => handleChannelToggle(channel.id)}
                  className="flex items-center gap-2 flex-1 text-left"
                >
                  {isFull ? (
                    <CheckSquare className="h-4 w-4 text-primary" />
                  ) : isPartial ? (
                    <Minus className="h-4 w-4 text-primary" />
                  ) : (
                    <Square className="h-4 w-4 text-muted-foreground" />
                  )}
                  <span className="text-sm font-medium">{channel.name}</span>
                  <span className="text-xs text-muted-foreground">
                    ({(selectedModelIds[channel.id] || []).length}/{channel.models.length})
                  </span>
                </button>
              </div>

              {/* Model list */}
              {isExpanded && channel.models.length > 0 && (
                <div className="border-t border-border px-2 py-1 space-y-0.5 bg-muted/30">
                  {channel.models.map((model) => {
                    const isModelSelected = (selectedModelIds[channel.id] || []).includes(model.id);

                    return (
                      <button
                        key={model.id}
                        type="button"
                        onClick={() => handleModelToggle(channel.id, model.id)}
                        className="flex items-center gap-2 w-full px-2 py-1 text-left hover:bg-accent rounded text-sm"
                      >
                        {isModelSelected ? (
                          <Check className="h-3.5 w-3.5 text-primary" />
                        ) : (
                          <div className="h-3.5 w-3.5" />
                        )}
                        <span className="truncate flex-1">{model.modelName}</span>
                        {showModelStatus && (
                          <span
                            className={cn(
                              "w-2 h-2 rounded-full shrink-0",
                              model.lastStatus === true && "bg-green-500",
                              model.lastStatus === false && "bg-red-500",
                              model.lastStatus === null && "bg-gray-400"
                            )}
                            title={
                              model.lastStatus === true
                                ? "正常"
                                : model.lastStatus === false
                                ? "异常"
                                : "未检测"
                            }
                          />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
