import cors from 'cors';
import multer from 'multer';

export default function registerEmsRoutes(app, deps) {
  const { pool, sessions, authMiddleware, writeSystemLog, hashPassword, createSession, sanitizeUser, sanitizeManagedUser, fetchJsonWithTimeout, getCachedValue, setCachedValue, getNormalizedTimeoutMs, ensureDatabaseReady, reloadLocalEnv, getTrackingApiDefaults, fetchAllTrackingPackagesCatalog, buildTrackingCatalogFallbackPayload, getCachedTrackingPackagesCatalog, getContactPackagesApiDefaults, fetchAllContactPackagesCatalog, getCachedContactPackagesCatalog, normalizeReference, buildEmsPipelineCards, pipelineStageKeys, getEmsPipelineMonthKey, getPackagePipelineSyncSnapshot, ensurePackagePipelineSync, extractPackageCode, normalizePackageCodeForLookup, fetchExactPackageCodeMatches, getPackageCodeValuesForLookup, findPackageCodeInPaginatedApi, normalizeEmsStageOverrideValue, getStoredEmsStageOverrides, saveEmsStageOverride, maybeStartTestModeConversation, getStoredWhatsAppConfig, getContactGroups, getStoredProntsConfig, getStoredPipelineConfig, defaultProntsConfig, defaultPipelineConfig, formatRelativeDate, formatCurrency, sanitizeWhatsAppConfig, buildPackagePipelineSyncFallback, normalizeGroupColor, defaultIntegrations, siteBlocks } = deps;

  // GET /api/ems/pipeline
  app.get('/api/ems/pipeline', authMiddleware, async (request, response) => {
  const scope = normalizeReference(request.query.scope).toLowerCase()
  const query = normalizeReference(request.query.query).toLowerCase()
  const month = normalizeReference(request.query.month).toLowerCase() || 'all'
  const page = Math.max(1, Number.parseInt(String(request.query.page ?? '1'), 10) || 1)
  const perPage = Math.max(1, Number.parseInt(String(request.query.per_page ?? '20'), 10) || 20)

  try {
    const { cards, customColumns } = await buildEmsPipelineCards()
    const customColumn = customColumns.find((column) => column.id === scope)

    const matchesMonth = (card) => {
      if (month === 'all') {
        return true
      }

      return getEmsPipelineMonthKey(card.updatedAt) === month
    }

    const matchesScope = (card) => {
      if (!scope || scope === 'all') {
        return true
      }

      if (pipelineStageKeys.includes(scope)) {
        return card.stage === scope
      }

      if (customColumn) {
        const title = normalizeReference(customColumn.title).toLowerCase()
        const allowedStates = Array.isArray(customColumn.allowedStates) ? customColumn.allowedStates : []
        return (
          normalizeReference(card.status).toLowerCase() === title ||
          allowedStates.includes(card.stage) ||
          allowedStates.includes(normalizeReference(card.status).toLowerCase())
        )
      }

      return card.stage === scope
    }

    const matchesQuery = (card) => {
      if (!query) {
        return true
      }

      return [
        card.code,
        card.title,
        card.summary,
        card.senderName,
        card.senderReference,
        card.recipientName,
        card.recipientReference,
        card.destination,
        card.status,
      ].some((value) => normalizeReference(value).toLowerCase().includes(query))
    }

    const filteredCards = cards.filter((card) => matchesMonth(card) && matchesScope(card) && matchesQuery(card))
    const totalItems = filteredCards.length
    const totalPages = Math.max(1, Math.ceil(totalItems / perPage))
    const currentPage = Math.min(page, totalPages)
    const fromIndex = (currentPage - 1) * perPage
    const pageItems = filteredCards.slice(fromIndex, fromIndex + perPage)

    response.json({
      scope: scope || 'all',
      page: currentPage,
      per_page: perPage,
      total: totalItems,
      total_pages: totalPages,
      data: pageItems,
      pagination: {
        page: currentPage,
        per_page: perPage,
        total_items: totalItems,
        total_pages: totalPages,
        has_more: currentPage < totalPages,
      },
    })
  } catch (error) {
    response.status(502).json({
      message: 'No se pudo cargar la paginacion del pipeline EMS.',
      error: error instanceof Error ? error.message : 'Error desconocido.',
    })
  }
})

  // GET /api/ems/month-options
  app.get('/api/ems/month-options', authMiddleware, async (_request, response) => {
  try {
    if (!getPackagePipelineSyncSnapshot()) {
      await ensurePackagePipelineSync()
    }
    const trackingCatalog = getCachedTrackingPackagesCatalog()?.data ?? []
    const contactCatalog = getCachedContactPackagesCatalog()?.data ?? []
    const monthMap = new Map()

    const registerMonth = (value) => {
      const key = getEmsPipelineMonthKey(value)
      if (!key) return
      monthMap.set(key, (monthMap.get(key) ?? 0) + 1)
    }

    trackingCatalog.forEach((item) => registerMonth(item?.fecha_registro || item?.eventos?.[0]?.fecha))
    contactCatalog.forEach((item) => registerMonth(item?.fecha_registro))

    const options = [...monthMap.entries()]
      .sort((first, second) => second[0].localeCompare(first[0]))
      .map(([value, count]) => {
        const [yearPart, monthPart] = value.split('-')
        const year = Number(yearPart)
        const month = Number(monthPart)
        const date = new Date(Date.UTC(year, month - 1, 1))
        const label = new Intl.DateTimeFormat('es-BO', {
          month: 'long',
          year: 'numeric',
          timeZone: 'America/La_Paz',
        }).format(date)

        return {
          value,
          label,
          count,
        }
      })

    response.json({ data: options })
  } catch (error) {
    response.status(502).json({
      message: 'No se pudieron cargar los meses del pipeline EMS.',
      error: error instanceof Error ? error.message : 'Error desconocido.',
    })
  }
})

  // GET /api/ems/stage-overrides
  app.get('/api/ems/stage-overrides', authMiddleware, async (_request, response) => {
  try {
    await ensureDatabaseReady()
    const overrides = await getStoredEmsStageOverrides()
    response.json({ overrides })
  } catch (error) {
    response.status(500).json({
      message: 'No se pudieron cargar los estados guardados del tablero EMS.',
      error: error instanceof Error ? error.message : 'Error desconocido.',
    })
  }
})

  // PUT /api/ems/stage-overrides
  app.put('/api/ems/stage-overrides', authMiddleware, async (request, response) => {
  const packageCode = normalizeReference(request.body?.packageCode).toUpperCase()
  const stage = normalizeEmsStageOverrideValue(request.body?.stage)

  if (!packageCode || !stage) {
    response.status(400).json({
      message: 'Falta el codigo del paquete o el estado EMS no es valido.',
    })
    return
  }

  try {
    await ensureDatabaseReady()
    const overrides = await saveEmsStageOverride(packageCode, stage)
    response.json({
      ok: true,
      packageCode,
      stage,
      overrides,
    })
  } catch (error) {
    response.status(500).json({
      message: 'No se pudo guardar el estado del paquete EMS.',
      error: error instanceof Error ? error.message : 'Error desconocido.',
    })
  }
})

}
