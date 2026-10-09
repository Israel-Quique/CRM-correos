import cors from 'cors';
import multer from 'multer';

export default function registerPronts-configRoutes(app, deps) {
  const { pool, sessions, authMiddleware, writeSystemLog, hashPassword, createSession, sanitizeUser, sanitizeManagedUser, fetchJsonWithTimeout, getCachedValue, setCachedValue, getNormalizedTimeoutMs, ensureDatabaseReady, reloadLocalEnv, getTrackingApiDefaults, fetchAllTrackingPackagesCatalog, buildTrackingCatalogFallbackPayload, getCachedTrackingPackagesCatalog, getContactPackagesApiDefaults, fetchAllContactPackagesCatalog, getCachedContactPackagesCatalog, normalizeReference, buildEmsPipelineCards, pipelineStageKeys, getEmsPipelineMonthKey, getPackagePipelineSyncSnapshot, ensurePackagePipelineSync, extractPackageCode, normalizePackageCodeForLookup, fetchExactPackageCodeMatches, getPackageCodeValuesForLookup, findPackageCodeInPaginatedApi, normalizeEmsStageOverrideValue, getStoredEmsStageOverrides, saveEmsStageOverride, maybeStartTestModeConversation, getStoredWhatsAppConfig, getContactGroups, getStoredProntsConfig, getStoredPipelineConfig, defaultProntsConfig, defaultPipelineConfig, formatRelativeDate, formatCurrency, sanitizeWhatsAppConfig, buildPackagePipelineSyncFallback, normalizeGroupColor, defaultIntegrations, siteBlocks } = deps;

  // GET /api/pronts-config
  app.get('/api/pronts-config', authMiddleware, async (_request, response) => {
  try {
    const config = await getStoredProntsConfig()
    response.json({ ok: true, configs: config })
  } catch (error) {
    response.status(500).json({
      message: 'No se pudo cargar la configuracion de prompts.',
      error: error.message,
    })
  }
})

  // PUT /api/pronts-config
  app.put('/api/pronts-config', authMiddleware, async (request, response) => {
  try {
    const config = await saveProntsConfig(request.body?.configs)
    response.json({ ok: true, configs: config })
  } catch (error) {
    response.status(500).json({
      message: 'No se pudo guardar la configuracion de prompts.',
      error: error.message,
    })
  }
})

}
