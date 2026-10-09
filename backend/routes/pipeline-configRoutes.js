import cors from 'cors';
import multer from 'multer';

export default function registerPipeline-configRoutes(app, deps) {
  const { pool, sessions, authMiddleware, writeSystemLog, hashPassword, createSession, sanitizeUser, sanitizeManagedUser, fetchJsonWithTimeout, getCachedValue, setCachedValue, getNormalizedTimeoutMs, ensureDatabaseReady, reloadLocalEnv, getTrackingApiDefaults, fetchAllTrackingPackagesCatalog, buildTrackingCatalogFallbackPayload, getCachedTrackingPackagesCatalog, getContactPackagesApiDefaults, fetchAllContactPackagesCatalog, getCachedContactPackagesCatalog, normalizeReference, buildEmsPipelineCards, pipelineStageKeys, getEmsPipelineMonthKey, getPackagePipelineSyncSnapshot, ensurePackagePipelineSync, extractPackageCode, normalizePackageCodeForLookup, fetchExactPackageCodeMatches, getPackageCodeValuesForLookup, findPackageCodeInPaginatedApi, normalizeEmsStageOverrideValue, getStoredEmsStageOverrides, saveEmsStageOverride, maybeStartTestModeConversation, getStoredWhatsAppConfig, getContactGroups, getStoredProntsConfig, getStoredPipelineConfig, defaultProntsConfig, defaultPipelineConfig, formatRelativeDate, formatCurrency, sanitizeWhatsAppConfig, buildPackagePipelineSyncFallback, normalizeGroupColor, defaultIntegrations, siteBlocks } = deps;

  // GET /api/pipeline-config
  app.get('/api/pipeline-config', authMiddleware, async (_request, response) => {
  try {
    await ensureDatabaseReady()
    const config = await getStoredPipelineConfig()
    response.json({ ok: true, config })
  } catch (error) {
    response.status(500).json({
      message: 'No se pudo cargar la configuracion del pipeline.',
      error: error.message,
    })
  }
})

  // PUT /api/pipeline-config
  app.put('/api/pipeline-config', authMiddleware, async (request, response) => {
  try {
    await ensureDatabaseReady()
    const config = await savePipelineConfig(request.body?.config)
    response.json({ ok: true, config })
  } catch (error) {
    response.status(500).json({
      message: 'No se pudo guardar la configuracion del pipeline.',
      error: error.message,
    })
  }
})

}
