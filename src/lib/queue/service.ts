// Detection Service - Orchestrates detection jobs

import prisma from "@/lib/prisma";
import { getEndpointsToTest, fetchModels } from "@/lib/detection";
import {
  addDetectionJobsBulk,
  getQueueStats,
  getTestingModelIds,
  clearStoppedFlag,
  isQueueRunning,
} from "./queue";
import type { DetectionJobData } from "@/lib/detection/types";

/**
 * Resolve the correct apiKey for a model.
 * If model has channelKeyId, use the ChannelKey's apiKey; otherwise use channel's default apiKey.
 */
async function resolveApiKey(
  model: { channelKeyId?: string | null },
  channelApiKey: string
): Promise<string> {
  if (model.channelKeyId) {
    const channelKey = await prisma.channelKey.findUnique({
      where: { id: model.channelKeyId },
      select: { apiKey: true },
    });
    if (channelKey) return channelKey.apiKey;
  }
  return channelApiKey;
}

/**
 * Build detection jobs for a list of models under a channel.
 * Resolves the correct apiKey for each model (channelKey vs default).
 */
async function buildJobsForModels(
  channel: { id: string; baseUrl: string; apiKey: string; proxy: string | null },
  models: { id: string; modelName: string; channelKeyId?: string | null }[]
): Promise<DetectionJobData[]> {
  const jobs: DetectionJobData[] = [];

  // Group models by channelKeyId to batch-resolve keys
  const keyIdSet = new Set<string>();
  for (const m of models) {
    if (m.channelKeyId) keyIdSet.add(m.channelKeyId);
  }

  // Fetch all needed channel keys in one query
  const keyMap = new Map<string, string>();
  if (keyIdSet.size > 0) {
    const keys = await prisma.channelKey.findMany({
      where: { id: { in: Array.from(keyIdSet) } },
      select: { id: true, apiKey: true },
    });
    for (const k of keys) {
      keyMap.set(k.id, k.apiKey);
    }
  }

  for (const model of models) {
    const apiKey = model.channelKeyId && keyMap.has(model.channelKeyId)
      ? keyMap.get(model.channelKeyId)!
      : channel.apiKey;

    const endpointsToTest = getEndpointsToTest(model.modelName);

    for (const endpointType of endpointsToTest) {
      jobs.push({
        channelId: channel.id,
        modelId: model.id,
        modelName: model.modelName,
        baseUrl: channel.baseUrl,
        apiKey,
        proxy: channel.proxy,
        endpointType,
      });
    }
  }

  return jobs;
}

function getDetectionCounts(jobs: DetectionJobData[]): { modelCount: number; jobCount: number } {
  const modelIds = new Set<string>();
  for (const job of jobs) {
    modelIds.add(job.modelId);
  }

  return {
    modelCount: modelIds.size,
    jobCount: jobs.length,
  };
}

/**
 * Trigger detection for all enabled channels
 * Optionally sync models from remote API before detection
 */
export async function triggerFullDetection(syncModelsFirst: boolean = false): Promise<{
  channelCount: number;
  modelCount: number;
  jobCount: number;
  jobIds: string[];
  syncResults?: { channelId: string; added: number; total: number }[];
}> {

  // Clear stopped flag from previous detection stop
  await clearStoppedFlag();

  // Fetch all enabled channels
  const channels = await prisma.channel.findMany({
    where: { enabled: true },
  });

  // Reset all models status to "untested" state before detection
  // This clears the UI display while preserving checkLogs history
  const channelIds = channels.map((c) => c.id);
  if (channelIds.length > 0) {
    await prisma.model.updateMany({
      where: { channelId: { in: channelIds } },
      data: {
        lastStatus: null,
        lastLatency: null,
        lastCheckedAt: null,
        detectedEndpoints: [],
      },
    });
  }

  // Optionally sync models from remote API first
  let syncResults: { channelId: string; added: number; total: number }[] | undefined;
  if (syncModelsFirst) {
    syncResults = [];
    for (const channel of channels) {
      try {
        const result = await syncChannelModels(channel.id);
        syncResults.push({
          channelId: channel.id,
          added: result.added,
          total: result.total,
        });
      } catch (error) {
      }
    }
  }

  // Re-fetch channels with updated models
  const channelsWithModels = await prisma.channel.findMany({
    where: { enabled: true },
    include: {
      models: {
        select: {
          id: true,
          modelName: true,
          detectedEndpoints: true,
          channelKeyId: true,
        },
      },
    },
  });

  const jobs: DetectionJobData[] = [];

  for (const channel of channelsWithModels) {
    const channelJobs = await buildJobsForModels(channel, channel.models);
    jobs.push(...channelJobs);
  }

  if (jobs.length === 0) {
    return { channelCount: 0, modelCount: 0, jobCount: 0, jobIds: [], syncResults };
  }

  // Add all jobs to queue
  const jobIds = await addDetectionJobsBulk(jobs);
  const { modelCount, jobCount } = getDetectionCounts(jobs);

  return {
    channelCount: channelsWithModels.length,
    modelCount,
    jobCount,
    jobIds,
    syncResults,
  };
}

/**
 * Trigger detection for a specific channel
 * @param channelId - The channel ID
 * @param modelIds - Optional array of model IDs to test (for filtered testing)
 */
export async function triggerChannelDetection(
  channelId: string,
  modelIds?: string[]
): Promise<{
  modelCount: number;
  jobCount: number;
  jobIds: string[];
}> {

  // Clear stopped flag from previous detection stop
  await clearStoppedFlag();

  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    include: {
      models: {
        select: {
          id: true,
          modelName: true,
          detectedEndpoints: true,
          channelKeyId: true,
        },
      },
    },
  });

  if (!channel) {
    throw new Error(`Channel not found: ${channelId}`);
  }

  if (!channel.enabled) {
    throw new Error(`Channel is disabled: ${channelId}`);
  }

  // Filter models if modelIds provided
  const modelsToTest = modelIds
    ? channel.models.filter((m) => modelIds.includes(m.id))
    : channel.models;

  // Reset models status to "untested" state before detection
  if (modelsToTest.length > 0) {
    const modelIdsToReset = modelsToTest.map((m) => m.id);
    await prisma.model.updateMany({
      where: { id: { in: modelIdsToReset } },
      data: {
        lastStatus: null,
        lastLatency: null,
        lastCheckedAt: null,
        detectedEndpoints: [],
      },
    });
  }

  const jobs = await buildJobsForModels(channel, modelsToTest);

  if (jobs.length === 0) {
    return { modelCount: 0, jobCount: 0, jobIds: [] };
  }

  const jobIds = await addDetectionJobsBulk(jobs);
  const { modelCount, jobCount } = getDetectionCounts(jobs);

  return { modelCount, jobCount, jobIds };
}

/**
 * Trigger detection for a specific model (all endpoints)
 */
export async function triggerModelDetection(modelId: string): Promise<{
  jobIds: string[];
}> {

  // Clear stopped flag from previous detection stop
  await clearStoppedFlag();

  const model = await prisma.model.findUnique({
    where: { id: modelId },
    include: { channel: true },
  });

  if (!model) {
    throw new Error(`Model not found: ${modelId}`);
  }

  if (!model.channel.enabled) {
    throw new Error(`Channel is disabled: ${model.channel.id}`);
  }

  // Reset model status to "untested" state before detection
  await prisma.model.update({
    where: { id: modelId },
    data: {
      lastStatus: null,
      lastLatency: null,
      lastCheckedAt: null,
      detectedEndpoints: [],
    },
  });

  // Resolve apiKey
  const apiKey = await resolveApiKey(model, model.channel.apiKey);

  // Get all endpoints to test for this model
  const endpointsToTest = getEndpointsToTest(model.modelName);

  const jobs: DetectionJobData[] = endpointsToTest.map((endpointType) => ({
    channelId: model.channel.id,
    modelId: model.id,
    modelName: model.modelName,
    baseUrl: model.channel.baseUrl,
    apiKey,
    proxy: model.channel.proxy,
    endpointType,
  }));

  const jobIds = await addDetectionJobsBulk(jobs);

  return { jobIds };
}

/**
 * Sync models from channel's /v1/models endpoint
 * Supports multiple keys, keyword filtering, and cleans old models
 */
export async function syncChannelModels(
  channelId: string,
  selectedModels?: string[],
  selectedModelPairs?: Array<{ modelName: string; keyId: string | null }>
): Promise<{
  added: number;
  removed: number;
  total: number;
}> {
  const getModelSignature = (modelName: string, channelKeyId: string | null | undefined) =>
    `${modelName}\u0000${channelKeyId ?? "__main__"}`;

  // If selectedModels provided, save them directly without fetching from API
  if (selectedModels) {
    const uniqueSelectedModels = Array.from(
      new Set(
        selectedModels
          .map((modelName) => modelName.trim())
          .filter(Boolean)
      )
    );

    const selectedChannel = await prisma.channel.findUnique({
      where: { id: channelId },
      select: { id: true, keyMode: true },
    });
    if (!selectedChannel) {
      throw new Error(`Channel not found: ${channelId}`);
    }

    if (selectedChannel.keyMode === "multi" && selectedModelPairs && selectedModelPairs.length > 0) {
      const selectedNameSet = new Set(uniqueSelectedModels);
      const targetPairMap = new Map<string, { modelName: string; channelKeyId: string | null }>();
      for (const pair of selectedModelPairs) {
        const modelName = pair.modelName.trim();
        if (!modelName || !selectedNameSet.has(modelName)) continue;
        const channelKeyId = pair.keyId ?? null;
        const signature = getModelSignature(modelName, channelKeyId);
        if (!targetPairMap.has(signature)) {
          targetPairMap.set(signature, { modelName, channelKeyId });
        }
      }
      const targetPairs = Array.from(targetPairMap.values());

      const existingModels = await prisma.model.findMany({
        where: { channelId },
        select: { id: true, modelName: true, channelKeyId: true },
      });

      const targetSignatureSet = new Set(
        targetPairs.map((m) => getModelSignature(m.modelName, m.channelKeyId))
      );
      const toDeleteIds = existingModels
        .filter((m) => !targetSignatureSet.has(getModelSignature(m.modelName, m.channelKeyId)))
        .map((m) => m.id);

      let removedCount = 0;
      if (toDeleteIds.length > 0) {
        const result = await prisma.model.deleteMany({
          where: { id: { in: toDeleteIds } },
        });
        removedCount = result.count;
      }

      const existingSignatureSet = new Set(
        existingModels.map((m) => getModelSignature(m.modelName, m.channelKeyId))
      );
      const toCreate = targetPairs
        .filter((m) => !existingSignatureSet.has(getModelSignature(m.modelName, m.channelKeyId)))
        .map((m) => ({
          channelId,
          modelName: m.modelName,
          channelKeyId: m.channelKeyId,
        }));

      let addedCount = 0;
      if (toCreate.length > 0) {
        const result = await prisma.model.createMany({
          data: toCreate,
          skipDuplicates: true,
        });
        addedCount = result.count;
      }

      return {
        added: addedCount,
        removed: removedCount,
        total: targetPairs.length,
      };
    }

    const existingModels = await prisma.model.findMany({
      where: { channelId },
      select: { id: true, modelName: true },
    });

    const selectedNameSet = new Set(uniqueSelectedModels);
    const toDeleteIds = existingModels
      .filter((m) => !selectedNameSet.has(m.modelName))
      .map((m) => m.id);

    let removedCount = 0;
    if (toDeleteIds.length > 0) {
      const result = await prisma.model.deleteMany({
        where: { id: { in: toDeleteIds } },
      });
      removedCount = result.count;
    }

    const existingNameSet = new Set(existingModels.map((m) => m.modelName));
    const toCreate = uniqueSelectedModels
      .filter((modelName) => !existingNameSet.has(modelName))
      .map((modelName) => ({
        channelId,
        modelName,
      }));

    let addedCount = 0;
    if (toCreate.length > 0) {
      const result = await prisma.model.createMany({
        data: toCreate,
        skipDuplicates: true,
      });
      addedCount = result.count;
    }

    return {
      added: addedCount,
      removed: removedCount,
      total: uniqueSelectedModels.length,
    };
  }

  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    include: {
      channelKeys: {
        select: { id: true, apiKey: true },
      },
    },
  });

  if (!channel) {
    throw new Error(`Channel not found: ${channelId}`);
  }

  // Collect all keys. In multi mode, main key should also participate.
  const rawKeys: { keyId: string | null; apiKey: string }[] = [
    { keyId: null, apiKey: channel.apiKey },
    ...channel.channelKeys.map((k) => ({ keyId: k.id, apiKey: k.apiKey })),
  ];

  // De-duplicate identical key strings to avoid duplicate fetches/results.
  const keySeen = new Set<string>();
  const allKeys = rawKeys.filter((k) => {
    const key = k.apiKey.trim();
    if (!key || keySeen.has(key)) return false;
    keySeen.add(key);
    return true;
  });

  // Fetch models from all keys concurrently
  const fetchResults = await Promise.allSettled(
    allKeys.map(async ({ keyId, apiKey }) => {
      const result = await fetchModels(channel.baseUrl, apiKey, channel.proxy);
      return { keyId, models: result.models, error: result.error };
    })
  );

  // Merge results:
  // - multi mode: keep model-key pairs (true multi-key routing)
  // - single mode: keep one key per model (first key that has it wins)
  const modelKeyMap = new Map<string, string | null>();
  const modelKeyPairs: Array<{ modelName: string; keyId: string | null }> = [];
  let hasAnySuccess = false;

  for (const result of fetchResults) {
    if (result.status === "fulfilled" && !result.value.error) {
      hasAnySuccess = true;
      for (const modelName of result.value.models) {
        if (channel.keyMode === "multi") {
          modelKeyPairs.push({ modelName, keyId: result.value.keyId });
        } else if (!modelKeyMap.has(modelName)) {
          modelKeyMap.set(modelName, result.value.keyId);
        }
      }
    }
  }

  if (!hasAnySuccess) {
    // All keys failed — report the first error
    const firstError = fetchResults.find(
      (r) => r.status === "fulfilled" && r.value.error
    );
    const errorMsg = firstError && firstError.status === "fulfilled"
      ? firstError.value.error
      : "所有 Key 请求失败";
    throw new Error(`获取模型列表失败: ${errorMsg}`);
  }

  // Get enabled keywords for filtering
  const keywords = await prisma.modelKeyword.findMany({
    where: { enabled: true },
    select: { keyword: true },
  });

  // Apply keyword filtering (case-insensitive)
  if (keywords.length > 0) {
    const lowerKeywords = keywords.map((k) => k.keyword.toLowerCase());
    if (channel.keyMode === "multi") {
      const filteredPairsMap = new Map<string, { modelName: string; keyId: string | null }>();
      for (const entry of modelKeyPairs) {
        const lowerName = entry.modelName.toLowerCase();
        if (!lowerKeywords.some((kw) => lowerName.includes(kw))) {
          continue;
        }
        const pairKey = `${entry.modelName}\u0000${entry.keyId ?? "__main__"}`;
        if (!filteredPairsMap.has(pairKey)) {
          filteredPairsMap.set(pairKey, entry);
        }
      }
      modelKeyPairs.length = 0;
      modelKeyPairs.push(...filteredPairsMap.values());
    } else {
      const filteredModels = new Map<string, string | null>();
      for (const [modelName, keyId] of modelKeyMap) {
        const lowerName = modelName.toLowerCase();
        if (lowerKeywords.some((kw) => lowerName.includes(kw))) {
          filteredModels.set(modelName, keyId);
        }
      }
      modelKeyMap.clear();
      for (const [modelName, keyId] of filteredModels) {
        modelKeyMap.set(modelName, keyId);
      }
    }
  } else {
    if (channel.keyMode === "multi") {
      const dedupPairsMap = new Map<string, { modelName: string; keyId: string | null }>();
      for (const entry of modelKeyPairs) {
        const pairKey = `${entry.modelName}\u0000${entry.keyId ?? "__main__"}`;
        if (!dedupPairsMap.has(pairKey)) {
          dedupPairsMap.set(pairKey, entry);
        }
      }
      modelKeyPairs.length = 0;
      modelKeyPairs.push(...dedupPairsMap.values());
    }
  }

  const existingModels = await prisma.model.findMany({
    where: { channelId },
    select: { id: true, modelName: true, channelKeyId: true },
  });

  const targetModels = channel.keyMode === "multi"
    ? modelKeyPairs.map(({ modelName, keyId }) => ({
      modelName,
      channelKeyId: keyId,
    }))
    : Array.from(modelKeyMap.entries()).map(([modelName, keyId]) => ({
      modelName,
      channelKeyId: keyId,
    }));

  const targetSignatureSet = new Set(
    targetModels.map((m) => getModelSignature(m.modelName, m.channelKeyId))
  );
  const toDeleteIds = existingModels
    .filter((m) => !targetSignatureSet.has(getModelSignature(m.modelName, m.channelKeyId)))
    .map((m) => m.id);

  let removedCount = 0;
  if (toDeleteIds.length > 0) {
    const result = await prisma.model.deleteMany({
      where: { id: { in: toDeleteIds } },
    });
    removedCount = result.count;
  }

  const existingSignatureSet = new Set(
    existingModels.map((m) => getModelSignature(m.modelName, m.channelKeyId))
  );
  const toCreate = targetModels
    .filter((m) => !existingSignatureSet.has(getModelSignature(m.modelName, m.channelKeyId)))
    .map((m) => ({
      channelId,
      modelName: m.modelName,
      channelKeyId: m.channelKeyId,
    }));

  let addedCount = 0;
  if (toCreate.length > 0) {
    const result = await prisma.model.createMany({
      data: toCreate,
      skipDuplicates: true,
    });
    addedCount = result.count;
  }

  return {
    added: addedCount,
    removed: removedCount,
    total: targetModels.length,
  };
}

/**
 * Get detection progress
 */
export async function getDetectionProgress() {
  const [stats, testingModelIds] = await Promise.all([
    getQueueStats(),
    getTestingModelIds(),
  ]);

  return {
    ...stats,
    isRunning: isQueueRunning(stats),
    progress:
      stats.total > 0 || stats.completed > 0 || stats.failed > 0
        ? Math.round(((stats.completed + stats.failed) / (stats.total + stats.completed + stats.failed)) * 100)
        : 0,
    testingModelIds,
  };
}

/**
 * Trigger detection for selected channels/models (scheduled detection)
 * @param channelIds - Array of channel IDs to test (null = all enabled channels)
 * @param modelIdsByChannel - Map of channel IDs to model IDs to test (null = all models per channel)
 */
export async function triggerSelectiveDetection(
  channelIds: string[] | null,
  modelIdsByChannel: Record<string, string[]> | null
): Promise<{
  channelCount: number;
  modelCount: number;
  jobCount: number;
  jobIds: string[];
  syncResults?: { channelId: string; added: number; total: number }[];
}> {

  // Clear stopped flag from previous detection stop
  await clearStoppedFlag();

  // If no specific channels selected, fall back to full detection
  if (!channelIds || channelIds.length === 0) {
    return triggerFullDetection(true);
  }

  // Fetch selected channels
  const channels = await prisma.channel.findMany({
    where: {
      id: { in: channelIds },
      enabled: true,
    },
  });

  if (channels.length === 0) {
    return { channelCount: 0, modelCount: 0, jobCount: 0, jobIds: [] };
  }

  // Sync models from remote API for selected channels
  const syncResults: { channelId: string; added: number; total: number }[] = [];
  for (const channel of channels) {
    try {
      const result = await syncChannelModels(channel.id);
      syncResults.push({
        channelId: channel.id,
        added: result.added,
        total: result.total,
      });
    } catch (error) {
    }
  }

  // Re-fetch channels with models
  const channelsWithModels = await prisma.channel.findMany({
    where: {
      id: { in: channelIds },
      enabled: true,
    },
    include: {
      models: {
        select: {
          id: true,
          modelName: true,
          detectedEndpoints: true,
          channelKeyId: true,
        },
      },
    },
  });

  const jobs: DetectionJobData[] = [];

  for (const channel of channelsWithModels) {
    // Get models to test for this channel
    let modelsToTest = channel.models;

    // If specific models are selected for this channel, filter them
    if (modelIdsByChannel && modelIdsByChannel[channel.id]) {
      const selectedModelIds = modelIdsByChannel[channel.id];
      modelsToTest = channel.models.filter((m) => selectedModelIds.includes(m.id));
    }

    const channelJobs = await buildJobsForModels(channel, modelsToTest);
    jobs.push(...channelJobs);
  }

  if (jobs.length === 0) {
    return { channelCount: 0, modelCount: 0, jobCount: 0, jobIds: [], syncResults };
  }

  const jobIds = await addDetectionJobsBulk(jobs);
  const { modelCount, jobCount } = getDetectionCounts(jobs);

  return {
    channelCount: channelsWithModels.length,
    modelCount,
    jobCount,
    jobIds,
    syncResults,
  };
}
