import cors from 'cors';
import multer from 'multer';

export default function registerPipelineRoutes(app, deps) {
  const { pool, sessions, authMiddleware, writeSystemLog, hashPassword, createSession, sanitizeUser, sanitizeManagedUser, fetchJsonWithTimeout, getCachedValue, setCachedValue, getNormalizedTimeoutMs, ensureDatabaseReady, reloadLocalEnv, getTrackingApiDefaults, fetchAllTrackingPackagesCatalog, buildTrackingCatalogFallbackPayload, getCachedTrackingPackagesCatalog, getContactPackagesApiDefaults, fetchAllContactPackagesCatalog, getCachedContactPackagesCatalog, normalizeReference, buildEmsPipelineCards, pipelineStageKeys, getEmsPipelineMonthKey, getPackagePipelineSyncSnapshot, ensurePackagePipelineSync, extractPackageCode, normalizePackageCodeForLookup, fetchExactPackageCodeMatches, getPackageCodeValuesForLookup, findPackageCodeInPaginatedApi, normalizeEmsStageOverrideValue, getStoredEmsStageOverrides, saveEmsStageOverride, maybeStartTestModeConversation, getStoredWhatsAppConfig, getContactGroups, getStoredProntsConfig, getStoredPipelineConfig, defaultProntsConfig, defaultPipelineConfig, formatRelativeDate, formatCurrency, sanitizeWhatsAppConfig, buildPackagePipelineSyncFallback, normalizeGroupColor, defaultIntegrations, siteBlocks } = deps;

  // POST /api/pipeline/sync-packages
  app.post('/api/pipeline/sync-packages', authMiddleware, async (request, response) => {
  try {
    const result = await ensurePackagePipelineSync({ force: true })
    response.json({
      ok: true,
      ...result,
    })
  } catch (error) {
    await writeSystemLog({
      level: 'warn',
      event: 'package_pipeline_sync_fallback_used',
      request,
      statusCode: 200,
      details: {
        error: error instanceof Error ? error.message : 'Error desconocido.',
      },
    }).catch(() => {})

    response.json(buildPackagePipelineSyncFallback(error))
  }
})

}
