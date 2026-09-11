import cors from 'cors';
import multer from 'multer';

export default function registerInternacionalesRoutes(app, deps) {
  const { pool, sessions, authMiddleware, writeSystemLog, hashPassword, createSession, sanitizeUser, sanitizeManagedUser, fetchJsonWithTimeout, getCachedValue, setCachedValue, getNormalizedTimeoutMs, ensureDatabaseReady, reloadLocalEnv, getTrackingApiDefaults, fetchAllTrackingPackagesCatalog, buildTrackingCatalogFallbackPayload, getCachedTrackingPackagesCatalog, getContactPackagesApiDefaults, fetchAllContactPackagesCatalog, getCachedContactPackagesCatalog, normalizeReference, buildEmsPipelineCards, pipelineStageKeys, getEmsPipelineMonthKey, getPackagePipelineSyncSnapshot, ensurePackagePipelineSync, extractPackageCode, normalizePackageCodeForLookup, fetchExactPackageCodeMatches, getPackageCodeValuesForLookup, findPackageCodeInPaginatedApi, normalizeEmsStageOverrideValue, getStoredEmsStageOverrides, saveEmsStageOverride, maybeStartTestModeConversation, getStoredWhatsAppConfig, getContactGroups, getStoredProntsConfig, getStoredPipelineConfig, defaultProntsConfig, defaultPipelineConfig, formatRelativeDate, formatCurrency, sanitizeWhatsAppConfig, buildPackagePipelineSyncFallback, normalizeGroupColor, defaultIntegrations, siteBlocks } = deps;

  // GET /api/internacionales/paquetes-contactos
  app.get('/api/internacionales/paquetes-contactos', cors(), authMiddleware, async (request, response) => {
  try {
    reloadLocalEnv()
    const contactPackagesApiDefaults = getContactPackagesApiDefaults()
    const upstreamUrl = new URL(contactPackagesApiDefaults.endpoint)
    const searchParams = new URLSearchParams()

    for (const [key, value] of Object.entries(request.query)) {
      if (Array.isArray(value)) {
        if (value[0] != null) {
          searchParams.set(key, String(value[0]))
        }
        continue
      }

      if (value != null) {
        searchParams.set(key, String(value))
      }
    }

    upstreamUrl.search = searchParams.toString()

    const upstreamResponse = await fetchJsonWithTimeout(upstreamUrl, {
      headers: {
        Authorization: `Bearer ${contactPackagesApiDefaults.token}`,
        Accept: 'application/json',
      },
    })

    const rawBody = await upstreamResponse.text()
    let payload = null

    try {
      payload = rawBody ? JSON.parse(rawBody) : null
    } catch {
      payload = { raw: rawBody }
    }

    response.status(upstreamResponse.status).json(payload)
  } catch (error) {
    try {
      const fallbackCatalog = await fetchAllContactPackagesCatalog()
      const page = Math.max(1, Number.parseInt(String(request.query.page ?? '1'), 10) || 1)
      const perPage = Math.max(1, Number.parseInt(String(request.query.per_page ?? '25'), 10) || 25)
      const total = Array.isArray(fallbackCatalog.data) ? fallbackCatalog.data.length : 0
      const lastPage = Math.max(1, Math.ceil(total / perPage))
      const fromIndex = Math.max(0, (page - 1) * perPage)
      const toIndex = Math.min(total, fromIndex + perPage)
      const pageItems = Array.isArray(fallbackCatalog.data) ? fallbackCatalog.data.slice(fromIndex, toIndex) : []

      await writeSystemLog({
        level: 'warn',
        event: 'contact_packages_catalog_fallback_used',
        request,
        statusCode: 200,
        details: {
          error: error instanceof Error ? error.message : 'Error desconocido.',
          total,
          page,
          perPage,
          source: fallbackCatalog.source ?? 'local-cache',
        },
      }).catch(() => {})

      response.json({
        data: pageItems,
        total,
        cachedAt: fallbackCatalog.cachedAt ?? new Date().toISOString(),
        source: fallbackCatalog.source ?? 'local-cache',
        fallback: true,
        pagination: {
          page,
          per_page: perPage,
          total,
          last_page: lastPage,
        },
        paginacion: {
          pagina_actual: page,
          por_pagina: perPage,
          total_registros: total,
          ultima_pagina: lastPage,
          desde: total === 0 ? 0 : fromIndex + 1,
          hasta: toIndex,
        },
      })
    } catch (fallbackError) {
      response.status(502).json({
        error: 'No se pudo consultar la API de paquetes-contactos.',
        message:
          fallbackError instanceof Error
            ? fallbackError.message
            : error instanceof Error
              ? error.message
              : 'Error desconocido.',
      })
    }
  }
})

  // GET /api/internacionales/paquetes-contactos/catalog
  app.get('/api/internacionales/paquetes-contactos/catalog', cors(), authMiddleware, async (_request, response) => {
  try {
    const catalog = await fetchAllContactPackagesCatalog()
    response.json(catalog)
  } catch (error) {
    response.status(502).json({
      error: 'No se pudo consultar el catalogo completo de paquetes-contactos.',
      message: error instanceof Error ? error.message : 'Error desconocido.',
    })
  }
})

}
