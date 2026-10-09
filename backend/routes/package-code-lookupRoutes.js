import cors from 'cors';
import multer from 'multer';

export default function registerPackage-code-lookupRoutes(app, deps) {
  const { pool, sessions, authMiddleware, writeSystemLog, hashPassword, createSession, sanitizeUser, sanitizeManagedUser, fetchJsonWithTimeout, getCachedValue, setCachedValue, getNormalizedTimeoutMs, ensureDatabaseReady, reloadLocalEnv, getTrackingApiDefaults, fetchAllTrackingPackagesCatalog, buildTrackingCatalogFallbackPayload, getCachedTrackingPackagesCatalog, getContactPackagesApiDefaults, fetchAllContactPackagesCatalog, getCachedContactPackagesCatalog, normalizeReference, buildEmsPipelineCards, pipelineStageKeys, getEmsPipelineMonthKey, getPackagePipelineSyncSnapshot, ensurePackagePipelineSync, extractPackageCode, normalizePackageCodeForLookup, fetchExactPackageCodeMatches, getPackageCodeValuesForLookup, findPackageCodeInPaginatedApi, normalizeEmsStageOverrideValue, getStoredEmsStageOverrides, saveEmsStageOverride, maybeStartTestModeConversation, getStoredWhatsAppConfig, getContactGroups, getStoredProntsConfig, getStoredPipelineConfig, defaultProntsConfig, defaultPipelineConfig, formatRelativeDate, formatCurrency, sanitizeWhatsAppConfig, buildPackagePipelineSyncFallback, normalizeGroupColor, defaultIntegrations, siteBlocks } = deps;

  // GET /api/package-code-lookup
  app.get('/api/package-code-lookup', cors(), authMiddleware, async (request, response) => {
  try {
    reloadLocalEnv()

    const rawQuery = normalizeReference(request.query.code)
    const extractedCode = extractPackageCode(rawQuery)
    const normalizedCode = normalizePackageCodeForLookup(extractedCode || rawQuery)

    if (!normalizedCode) {
      response.status(400).json({
        error: 'Debes indicar un codigo para buscar.',
        query: rawQuery,
        extractedCode,
        normalizedCode,
      })
      return
    }

    const trackingApiDefaults = getTrackingApiDefaults()
    const contactPackagesApiDefaults = getContactPackagesApiDefaults()
    const trackingUrl = new URL('/api/tracking/paquetes', trackingApiDefaults.baseUrl)
    const contactUrl = new URL(contactPackagesApiDefaults.endpoint)
    const trackingHeaders = {
      Authorization: `Bearer ${trackingApiDefaults.token}`,
      Accept: 'application/json',
    }
    const contactHeaders = {
      Authorization: `Bearer ${contactPackagesApiDefaults.token}`,
      Accept: 'application/json',
    }

    const [trackingExact, contactExact] = await Promise.all([
      fetchExactPackageCodeMatches({
        url: trackingUrl,
        headers: trackingHeaders,
        queryParam: 'q',
        code: normalizedCode,
      }),
      fetchExactPackageCodeMatches({
        url: contactUrl,
        headers: contactHeaders,
        queryParam: 'codigo',
        code: normalizedCode,
      }),
    ])

    const trackingExactMatch =
      trackingExact.items.find((item) => getPackageCodeValuesForLookup(item).includes(normalizedCode)) ?? null
    const contactExactMatch =
      contactExact.items.find((item) => getPackageCodeValuesForLookup(item).includes(normalizedCode)) ?? null

    const [tracking, contact] =
      trackingExactMatch || contactExactMatch
        ? [
            {
              source: 'tracking',
              found: Boolean(trackingExactMatch),
              pagesChecked: 1,
              pageFound: trackingExactMatch ? 1 : null,
              totalItems: trackingExact.totalItems,
              statusCode: trackingExact.statusCode,
              code: normalizedCode,
              matchedFields: trackingExactMatch ? getPackageCodeValuesForLookup(trackingExactMatch) : [],
              record: trackingExactMatch,
              error: trackingExact.ok ? '' : 'No se pudo consultar la API de tracking.',
            },
            {
              source: 'contactos',
              found: Boolean(contactExactMatch),
              pagesChecked: 1,
              pageFound: contactExactMatch ? 1 : null,
              totalItems: contactExact.totalItems,
              statusCode: contactExact.statusCode,
              code: normalizedCode,
              matchedFields: contactExactMatch ? getPackageCodeValuesForLookup(contactExactMatch) : [],
              record: contactExactMatch,
              error: contactExact.ok ? '' : 'No se pudo consultar la API de paquetes-contactos.',
            },
          ]
        : await Promise.all([
            findPackageCodeInPaginatedApi({
              url: trackingUrl,
              headers: trackingHeaders,
              source: 'tracking',
              code: normalizedCode,
            }),
            findPackageCodeInPaginatedApi({
              url: contactUrl,
              headers: contactHeaders,
              source: 'contactos',
              code: normalizedCode,
            }),
          ])

    response.json({
      query: rawQuery,
      extractedCode,
      normalizedCode,
      found: tracking.found || contact.found,
      tracking,
      contact,
    })
  } catch (error) {
    response.status(502).json({
      error: 'No se pudo ejecutar la busqueda del codigo.',
      message: error instanceof Error ? error.message : 'Error desconocido.',
    })
  }
})

}
