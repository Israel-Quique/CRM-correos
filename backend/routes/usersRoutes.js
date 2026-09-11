import cors from 'cors';
import multer from 'multer';

export default function registerUsersRoutes(app, deps) {
  const { pool, sessions, authMiddleware, writeSystemLog, hashPassword, createSession, sanitizeUser, sanitizeManagedUser, fetchJsonWithTimeout, getCachedValue, setCachedValue, getNormalizedTimeoutMs, ensureDatabaseReady, reloadLocalEnv, getTrackingApiDefaults, fetchAllTrackingPackagesCatalog, buildTrackingCatalogFallbackPayload, getCachedTrackingPackagesCatalog, getContactPackagesApiDefaults, fetchAllContactPackagesCatalog, getCachedContactPackagesCatalog, normalizeReference, buildEmsPipelineCards, pipelineStageKeys, getEmsPipelineMonthKey, getPackagePipelineSyncSnapshot, ensurePackagePipelineSync, extractPackageCode, normalizePackageCodeForLookup, fetchExactPackageCodeMatches, getPackageCodeValuesForLookup, findPackageCodeInPaginatedApi, normalizeEmsStageOverrideValue, getStoredEmsStageOverrides, saveEmsStageOverride, maybeStartTestModeConversation, getStoredWhatsAppConfig, getContactGroups, getStoredProntsConfig, getStoredPipelineConfig, defaultProntsConfig, defaultPipelineConfig, formatRelativeDate, formatCurrency, sanitizeWhatsAppConfig, buildPackagePipelineSyncFallback, normalizeGroupColor, defaultIntegrations, siteBlocks } = deps;

  // GET /api/users
  app.get('/api/users', authMiddleware, async (_request, response) => {
  try {
    await ensureDatabaseReady()

    const result = await pool.query(`
      select id, full_name, email, role_name, created_at
      from users
      order by created_at desc, id desc;
    `)

    response.json({
      data: result.rows.map(sanitizeManagedUser),
      count: result.rowCount,
    })
  } catch (error) {
    response.status(500).json({
      message: 'No se pudo cargar la lista de usuarios.',
      error: error instanceof Error ? error.message : 'Error desconocido.',
    })
  }
})

  // POST /api/users
  app.post('/api/users', authMiddleware, async (request, response) => {
  const fullName = String(request.body?.fullName ?? request.body?.name ?? '').trim()
  const email = String(request.body?.email ?? '').trim().toLowerCase()
  const password = String(request.body?.password ?? '').trim()
  const roleName = String(request.body?.roleName ?? request.body?.role ?? 'Administradores').trim() || 'Administradores'

  if (!fullName || !email || !password) {
    response.status(400).json({ message: 'Nombre, correo y contrasena son requeridos.' })
    return
  }

  try {
    await ensureDatabaseReady()

    const result = await pool.query(
      `
        insert into users (full_name, email, password_hash, role_name)
        values ($1, $2, $3, $4)
        returning id, full_name, email, role_name, created_at;
      `,
      [fullName, email, hashPassword(password), roleName],
    )

    response.status(201).json({ user: sanitizeManagedUser(result.rows[0]) })
  } catch (error) {
    if (String(error?.code) === '23505') {
      response.status(409).json({ message: 'Ya existe un usuario con ese correo.' })
      return
    }

    response.status(500).json({
      message: 'No se pudo crear el usuario.',
      error: error instanceof Error ? error.message : 'Error desconocido.',
    })
  }
})

  // PUT /api/users/:id
  app.put('/api/users/:id', authMiddleware, async (request, response) => {
  const userId = Number(request.params.id)
  const fullName = String(request.body?.fullName ?? request.body?.name ?? '').trim()
  const email = String(request.body?.email ?? '').trim().toLowerCase()
  const password = String(request.body?.password ?? '').trim()
  const roleName = String(request.body?.roleName ?? request.body?.role ?? 'Administradores').trim() || 'Administradores'

  if (!Number.isFinite(userId)) {
    response.status(400).json({ message: 'Usuario invalido.' })
    return
  }

  if (!fullName || !email) {
    response.status(400).json({ message: 'Nombre y correo son requeridos.' })
    return
  }

  try {
    await ensureDatabaseReady()

    const params = [fullName, email, roleName, userId]
    const passwordSql = password ? ', password_hash = $4' : ''
    const query = `
      update users
      set full_name = $1,
          email = $2,
          role_name = $3
          ${passwordSql}
      where id = $${password ? 5 : 4}
      returning id, full_name, email, role_name, created_at;
    `
    const queryParams = password
      ? [fullName, email, roleName, hashPassword(password), userId]
      : params

    const result = await pool.query(query, queryParams)

    if (result.rowCount === 0) {
      response.status(404).json({ message: 'Usuario no encontrado.' })
      return
    }

    response.json({ user: sanitizeManagedUser(result.rows[0]) })
  } catch (error) {
    if (String(error?.code) === '23505') {
      response.status(409).json({ message: 'Ya existe un usuario con ese correo.' })
      return
    }

    response.status(500).json({
      message: 'No se pudo actualizar el usuario.',
      error: error instanceof Error ? error.message : 'Error desconocido.',
    })
  }
})

  // DELETE /api/users/:id
  app.delete('/api/users/:id', authMiddleware, async (request, response) => {
  const userId = Number(request.params.id)

  if (!Number.isFinite(userId)) {
    response.status(400).json({ message: 'Usuario invalido.' })
    return
  }

  if (request.session?.id === userId) {
    response.status(400).json({ message: 'No puedes eliminar tu propio usuario.' })
    return
  }

  try {
    await ensureDatabaseReady()

    const result = await pool.query('delete from users where id = $1 returning id;', [userId])

    if (result.rowCount === 0) {
      response.status(404).json({ message: 'Usuario no encontrado.' })
      return
    }

    response.json({ ok: true })
  } catch (error) {
    response.status(500).json({
      message: 'No se pudo eliminar el usuario.',
      error: error instanceof Error ? error.message : 'Error desconocido.',
    })
  }
})

}
