import cors from 'cors';
import multer from 'multer';

export default function registerAuthRoutes(app, deps) {
  const { pool, sessions, authMiddleware, writeSystemLog, hashPassword, createSession, sanitizeUser, sanitizeManagedUser, fetchJsonWithTimeout, getCachedValue, setCachedValue, getNormalizedTimeoutMs, ensureDatabaseReady, reloadLocalEnv, getTrackingApiDefaults, fetchAllTrackingPackagesCatalog, buildTrackingCatalogFallbackPayload, getCachedTrackingPackagesCatalog, getContactPackagesApiDefaults, fetchAllContactPackagesCatalog, getCachedContactPackagesCatalog, normalizeReference, buildEmsPipelineCards, pipelineStageKeys, getEmsPipelineMonthKey, getPackagePipelineSyncSnapshot, ensurePackagePipelineSync, extractPackageCode, normalizePackageCodeForLookup, fetchExactPackageCodeMatches, getPackageCodeValuesForLookup, findPackageCodeInPaginatedApi, normalizeEmsStageOverrideValue, getStoredEmsStageOverrides, saveEmsStageOverride, maybeStartTestModeConversation, getStoredWhatsAppConfig, getContactGroups, getStoredProntsConfig, getStoredPipelineConfig, defaultProntsConfig, defaultPipelineConfig, formatRelativeDate, formatCurrency, sanitizeWhatsAppConfig, buildPackagePipelineSyncFallback, normalizeGroupColor, defaultIntegrations, siteBlocks } = deps;

  // POST /api/auth/login
  app.post('/api/auth/login', async (request, response) => {
  const { email, password } = request.body ?? {}

  if (!email || !password) {
    response.status(400).json({ message: 'Correo y contrasena son requeridos.' })
    return
  }

  try {
    await ensureDatabaseReady()

    const result = await pool.query(
      `
        select id, full_name, email, password_hash, role_name
        from users
        where lower(email) = lower($1)
        limit 1;
      `,
      [email],
    )

    const user = result.rows[0]

    if (!user || user.password_hash !== hashPassword(password)) {
      response.status(401).json({ message: 'Credenciales invalidas.' })
      return
    }

    const token = createSession(user)
    response.json({ token, user: sanitizeUser(user) })
  } catch (error) {
    response.status(500).json({ message: 'No se pudo iniciar sesion.', error: error.message })
  }
})

  // POST /api/auth/demo
  app.post('/api/auth/demo', async (_request, response) => {
  try {
    await ensureDatabaseReady()

    const result = await pool.query(
      `
        select id, full_name, email, role_name
        from users
        where lower(email) = lower($1)
        limit 1;
      `,
      ['gonzalo.fabris@correos.gob.bo'],
    )

    const user = result.rows[0]

    if (!user) {
      response.status(404).json({ message: 'Usuario demo no encontrado.' })
      return
    }

    const token = createSession(user)
    response.json({ token, user: sanitizeUser(user) })
  } catch (error) {
    response.status(500).json({ message: 'No se pudo iniciar sesion demo.', error: error.message })
  }
})

  // GET /api/auth/session
  app.get('/api/auth/session', authMiddleware, (request, response) => {
  response.json({ user: request.session })
})

  // POST /api/auth/logout
  app.post('/api/auth/logout', authMiddleware, (request, response) => {
  sessions.delete(request.sessionToken)
  response.json({ ok: true })
})

}
