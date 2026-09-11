import cors from 'cors';
import multer from 'multer';

export default function registerTrackingRoutes(app, deps) {
  const { pool, sessions, authMiddleware, writeSystemLog, hashPassword, createSession, sanitizeUser, sanitizeManagedUser, fetchJsonWithTimeout, getCachedValue, setCachedValue, getNormalizedTimeoutMs, ensureDatabaseReady, reloadLocalEnv, getTrackingApiDefaults, fetchAllTrackingPackagesCatalog, buildTrackingCatalogFallbackPayload, getCachedTrackingPackagesCatalog, getContactPackagesApiDefaults, fetchAllContactPackagesCatalog, getCachedContactPackagesCatalog, normalizeReference, buildEmsPipelineCards, pipelineStageKeys, getEmsPipelineMonthKey, getPackagePipelineSyncSnapshot, ensurePackagePipelineSync, extractPackageCode, normalizePackageCodeForLookup, fetchExactPackageCodeMatches, getPackageCodeValuesForLookup, findPackageCodeInPaginatedApi, normalizeEmsStageOverrideValue, getStoredEmsStageOverrides, saveEmsStageOverride, maybeStartTestModeConversation, getStoredWhatsAppConfig, getContactGroups, getStoredProntsConfig, getStoredPipelineConfig, defaultProntsConfig, defaultPipelineConfig, formatRelativeDate, formatCurrency, sanitizeWhatsAppConfig, buildPackagePipelineSyncFallback, normalizeGroupColor, defaultIntegrations, siteBlocks } = deps;

  // GET /api/tracking/paquetes
  app.get('/api/tracking/paquetes', cors(), authMiddleware, async (request, response) => {
  try {
    reloadLocalEnv()
    const trackingApiDefaults = getTrackingApiDefaults()

    if (String(request.query.all ?? '').trim() === '1') {
      let payload = null
      try {
        payload = await fetchAllTrackingPackagesCatalog({
          forceRefresh: String(request.query.fresh ?? '').trim() === '1',
        })
      } catch (error) {
        await writeSystemLog({
          level: 'warn',
          event: 'tracking_catalog_remote_failed',
          request,
          statusCode: 200,
          details: {
            error: error instanceof Error ? error.message : 'Error desconocido.',
            source: 'catalog',
          },
        }).catch(() => {})
        payload = buildTrackingCatalogFallbackPayload('local-cache')
      }
      response.json(payload)
      return
    }

    const upstreamUrl = new URL('/api/tracking/paquetes', trackingApiDefaults.baseUrl)
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

    let upstreamResponse = null
    try {
      upstreamResponse = await fetchJsonWithTimeout(upstreamUrl, {
        headers: {
          Authorization: `Bearer ${trackingApiDefaults.token}`,
          Accept: 'application/json',
        },
      })
    } catch (error) {
      const cachedCatalog = getCachedTrackingPackagesCatalog()
      if (cachedCatalog?.data) {
        const page = Math.max(1, Number.parseInt(String(request.query.page ?? '1'), 10) || 1)
        const perPage = Math.max(1, Number.parseInt(String(request.query.per_page ?? '12'), 10) || 12)
        const fromIndex = Math.max(0, (page - 1) * perPage)
        const toIndex = Math.min(cachedCatalog.data.length, fromIndex + perPage)
        const pageItems = cachedCatalog.data.slice(fromIndex, toIndex)

        await writeSystemLog({
          level: 'warn',
          event: 'tracking_page_remote_failed',
          request,
          statusCode: 200,
          details: {
            error: error instanceof Error ? error.message : 'Error desconocido.',
            source: 'local-cache',
            page,
            perPage,
            total: cachedCatalog.data.length,
          },
        }).catch(() => {})

        response.json({
          data: pageItems,
          total: cachedCatalog.data.length,
          cachedAt: cachedCatalog.cachedAt ?? new Date().toISOString(),
          source: 'local-cache',
          fallback: true,
          pagination: {
            page,
            per_page: perPage,
            total: cachedCatalog.data.length,
            last_page: Math.max(1, Math.ceil(cachedCatalog.data.length / perPage)),
          },
          paginacion: {
            pagina_actual: page,
            por_pagina: perPage,
            total_registros: cachedCatalog.data.length,
            ultima_pagina: Math.max(1, Math.ceil(cachedCatalog.data.length / perPage)),
            desde: cachedCatalog.data.length === 0 ? 0 : fromIndex + 1,
            hasta: toIndex,
          },
        })
        return
      }

      throw error
    }

    const rawBody = await upstreamResponse.text()
    let payload = null

    try {
      payload = rawBody ? JSON.parse(rawBody) : null
    } catch {
      payload = { raw: rawBody }
    }

    response.status(upstreamResponse.status).json(payload)
  } catch (error) {
    const fallbackPayload = buildTrackingCatalogFallbackPayload('local-cache')
    if (Array.isArray(fallbackPayload.data)) {
      const page = Math.max(1, Number.parseInt(String(request.query.page ?? '1'), 10) || 1)
      const perPage = Math.max(1, Number.parseInt(String(request.query.per_page ?? '12'), 10) || 12)
      const fromIndex = Math.max(0, (page - 1) * perPage)
      const toIndex = Math.min(fallbackPayload.data.length, fromIndex + perPage)
      response.json({
        data: fallbackPayload.data.slice(fromIndex, toIndex),
        total: fallbackPayload.data.length,
        cachedAt: fallbackPayload.cachedAt,
        source: fallbackPayload.source,
        fallback: true,
        pagination: {
          page,
          per_page: perPage,
          total: fallbackPayload.data.length,
          last_page: Math.max(1, Math.ceil(fallbackPayload.data.length / perPage)),
        },
        paginacion: {
          pagina_actual: page,
          por_pagina: perPage,
          total_registros: fallbackPayload.data.length,
          ultima_pagina: Math.max(1, Math.ceil(fallbackPayload.data.length / perPage)),
          desde: fallbackPayload.data.length === 0 ? 0 : fromIndex + 1,
          hasta: toIndex,
        },
      })
      return
    }

    response.status(502).json({
      error: 'No se pudo consultar la API de tracking.',
      message: error instanceof Error ? error.message : 'Error desconocido.',
    })
  }
})

}
