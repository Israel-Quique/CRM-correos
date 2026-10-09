import cors from 'cors';
import multer from 'multer';

export default function registerLogsRoutes(app, deps) {
  const { pool, sessions, authMiddleware, writeSystemLog, hashPassword, createSession, sanitizeUser, sanitizeManagedUser, fetchJsonWithTimeout, getCachedValue, setCachedValue, getNormalizedTimeoutMs, ensureDatabaseReady, reloadLocalEnv, getTrackingApiDefaults, fetchAllTrackingPackagesCatalog, buildTrackingCatalogFallbackPayload, getCachedTrackingPackagesCatalog, getContactPackagesApiDefaults, fetchAllContactPackagesCatalog, getCachedContactPackagesCatalog, normalizeReference, buildEmsPipelineCards, pipelineStageKeys, getEmsPipelineMonthKey, getPackagePipelineSyncSnapshot, ensurePackagePipelineSync, extractPackageCode, normalizePackageCodeForLookup, fetchExactPackageCodeMatches, getPackageCodeValuesForLookup, findPackageCodeInPaginatedApi, normalizeEmsStageOverrideValue, getStoredEmsStageOverrides, saveEmsStageOverride, maybeStartTestModeConversation, getStoredWhatsAppConfig, getContactGroups, getStoredProntsConfig, getStoredPipelineConfig, defaultProntsConfig, defaultPipelineConfig, formatRelativeDate, formatCurrency, sanitizeWhatsAppConfig, buildPackagePipelineSyncFallback, normalizeGroupColor, defaultIntegrations, siteBlocks } = deps;

  // GET /api/logs/report
  app.get('/api/logs/report', authMiddleware, async (request, response) => {
  const requestedHours = Number(request.query.hours ?? 24)
  const requestedLimit = Number(request.query.limit ?? 100)
  const requestedPage = Number(request.query.page ?? 1)
  const requestedPerPage = Number(request.query.per_page ?? 10)
  const hours = Number.isFinite(requestedHours) ? Math.min(Math.max(requestedHours, 1), 720) : 24
  const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 500) : 100
  const page = Number.isFinite(requestedPage) ? Math.max(1, Math.floor(requestedPage)) : 1
  const perPage = Number.isFinite(requestedPerPage) ? Math.min(Math.max(Math.floor(requestedPerPage), 1), 50) : 10
  const level = String(request.query.level ?? '').trim().toLowerCase()
  const pathFilter = String(request.query.path ?? '').trim()
  const monthFilter = String(request.query.month ?? '').trim()
  const isMonthFilter = /^\d{4}-\d{2}$/.test(monthFilter)
  const filters = ['created_at >= now() - ($1 * interval \'1 hour\')']
  const params = [hours]
  const baseFilters = [...filters]
  const baseParams = [...params]

  if (['info', 'warn', 'error'].includes(level)) {
    params.push(level)
    filters.push(`level = $${params.length}`)
    baseParams.push(level)
    baseFilters.push(`level = $${baseParams.length}`)
  }

  if (pathFilter) {
    params.push(`%${pathFilter}%`)
    filters.push(`path ilike $${params.length}`)
    baseParams.push(`%${pathFilter}%`)
    baseFilters.push(`path ilike $${baseParams.length}`)
  }

  if (isMonthFilter) {
    const [yearRaw, monthRaw] = monthFilter.split('-')
    const year = Number(yearRaw)
    const month = Number(monthRaw)

    if (Number.isFinite(year) && Number.isFinite(month) && month >= 1 && month <= 12) {
      const monthStart = new Date(Date.UTC(year, month - 1, 1))
      const nextMonthStart = new Date(Date.UTC(year, month, 1))
      params.push(monthStart, nextMonthStart)
      filters.push(`created_at >= $${params.length - 1} and created_at < $${params.length}`)
    }
  }

  try {
    await ensureDatabaseReady()

    const whereClause = filters.join(' and ')
    const baseWhereClause = baseFilters.join(' and ')
    const offset = (page - 1) * perPage
    const [summaryResult, endpointResult, recentResult, countResult, monthResult] = await Promise.all([
      pool.query(
        `
          select level, count(*)::integer as count
          from system_logs
          where ${whereClause}
          group by level
          order by level;
        `,
        params,
      ),
      pool.query(
        `
          select coalesce(path, '/') as path, count(*)::integer as count,
                 round(avg(duration_ms))::integer as average_duration_ms,
                 count(*) filter (where status_code >= 400)::integer as errors
          from system_logs
          where ${baseWhereClause}
          group by coalesce(path, '/')
          order by count(*) desc
          limit $${params.length + 1};
        `,
        [...params, limit],
      ),
      pool.query(
        `
          select id, created_at, level, event, method, path, status_code,
                 duration_ms, user_id, details
          from system_logs
          where ${whereClause}
          order by created_at desc, id desc
          limit $${params.length + 1}
          offset $${params.length + 2};
        `,
        [...params, perPage, offset],
      ),
      pool.query(
        `
          select count(*)::integer as total
          from system_logs
          where ${whereClause};
        `,
        params,
      ),
      pool.query(
        `
          select to_char(date_trunc('month', created_at), 'YYYY-MM') as month_key,
                 count(*)::integer as count
          from system_logs
          where ${baseWhereClause}
          group by month_key
          order by month_key desc
          limit 12;
        `,
        baseParams,
      ),
    ])

    const totalItems = Number(countResult.rows?.[0]?.total ?? 0)
    const totalPages = Math.max(1, Math.ceil(totalItems / perPage))

    response.json({
      generatedAt: new Date().toISOString(),
      period: { hours, level: level || null, path: pathFilter || null, month: isMonthFilter ? monthFilter : null },
      totals: summaryResult.rows.reduce(
        (totals, row) => ({ ...totals, total: totals.total + row.count, [row.level]: row.count }),
        { total: 0, info: 0, warn: 0, error: 0 },
      ),
      byEndpoint: endpointResult.rows,
      months: monthResult.rows.map((row) => ({
        value: row.month_key,
        count: row.count,
        label: new Intl.DateTimeFormat('es-BO', {
          month: 'long',
          year: 'numeric',
          timeZone: 'America/La_Paz',
        }).format(new Date(`${row.month_key}-01T00:00:00.000Z`)),
      })),
      recent: recentResult.rows,
      pagination: {
        page,
        perPage,
        totalItems,
        totalPages,
      },
    })
  } catch (error) {
    response.status(500).json({
      message: 'No se pudo generar el reporte de logs.',
      error: error instanceof Error ? error.message : 'Error desconocido.',
    })
  }
})

}
