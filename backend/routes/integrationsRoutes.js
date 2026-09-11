import cors from 'cors';
import multer from 'multer';

export default function registerIntegrationsRoutes(app, deps) {
  const { pool, sessions, authMiddleware, writeSystemLog, hashPassword, createSession, sanitizeUser, sanitizeManagedUser, fetchJsonWithTimeout, getCachedValue, setCachedValue, getNormalizedTimeoutMs, ensureDatabaseReady, reloadLocalEnv, getTrackingApiDefaults, fetchAllTrackingPackagesCatalog, buildTrackingCatalogFallbackPayload, getCachedTrackingPackagesCatalog, getContactPackagesApiDefaults, fetchAllContactPackagesCatalog, getCachedContactPackagesCatalog, normalizeReference, buildEmsPipelineCards, pipelineStageKeys, getEmsPipelineMonthKey, getPackagePipelineSyncSnapshot, ensurePackagePipelineSync, extractPackageCode, normalizePackageCodeForLookup, fetchExactPackageCodeMatches, getPackageCodeValuesForLookup, findPackageCodeInPaginatedApi, normalizeEmsStageOverrideValue, getStoredEmsStageOverrides, saveEmsStageOverride, maybeStartTestModeConversation, getStoredWhatsAppConfig, getContactGroups, getStoredProntsConfig, getStoredPipelineConfig, defaultProntsConfig, defaultPipelineConfig, formatRelativeDate, formatCurrency, sanitizeWhatsAppConfig, buildPackagePipelineSyncFallback, normalizeGroupColor, defaultIntegrations, siteBlocks } = deps;

  // GET /api/integrations/whatsapp-config
  app.get('/api/integrations/whatsapp-config', authMiddleware, async (_request, response) => {
  try {
    await ensureDatabaseReady()
    const config = await getStoredWhatsAppConfig()
    response.json({ config: sanitizeWhatsAppConfig(config) })
  } catch (error) {
    response.status(500).json({
      message: 'No se pudo cargar la configuracion de WhatsApp Meta.',
      error: error.message,
    })
  }
})

  // PUT /api/integrations/whatsapp-config
  app.put('/api/integrations/whatsapp-config', authMiddleware, async (request, response) => {
  const {
    accessToken,
    phoneNumberId,
    businessAccountId,
    apiVersion,
    senderNumber,
    webhookVerifyToken,
  } = request.body ?? {}

  try {
    await ensureDatabaseReady()

    const currentConfig = await getStoredWhatsAppConfig()
    const nextConfig = {
      ...currentConfig,
      accessToken:
        typeof accessToken === 'string' && accessToken.trim().length > 0
          ? accessToken.trim()
          : currentConfig.accessToken,
      phoneNumberId:
        typeof phoneNumberId === 'string' && phoneNumberId.trim().length > 0
          ? phoneNumberId.trim()
          : currentConfig.phoneNumberId,
      businessAccountId:
        typeof businessAccountId === 'string'
          ? businessAccountId.trim()
          : currentConfig.businessAccountId,
      apiVersion:
        typeof apiVersion === 'string' && apiVersion.trim().length > 0
          ? apiVersion.trim()
          : currentConfig.apiVersion,
      senderNumber:
        typeof senderNumber === 'string' && senderNumber.trim().length > 0
          ? senderNumber.trim()
          : currentConfig.senderNumber,
      webhookVerifyToken:
        typeof webhookVerifyToken === 'string' && webhookVerifyToken.trim().length > 0
          ? webhookVerifyToken.trim()
          : currentConfig.webhookVerifyToken,
    }

    const configError = validateWhatsAppConfig(nextConfig)
    if (configError) {
      response.status(400).json({ message: configError })
      return
    }

    const savedConfig = await saveWhatsAppConfig(nextConfig)
    response.json({
      message: 'Configuracion de WhatsApp Meta guardada.',
      config: sanitizeWhatsAppConfig(savedConfig),
    })
  } catch (error) {
    response.status(500).json({
      message: 'No se pudo guardar la configuracion de WhatsApp Meta.',
      error: error.message,
    })
  }
})

  // PUT /api/integrations/whatsapp-test-mode
  app.put('/api/integrations/whatsapp-test-mode', authMiddleware, async (request, response) => {
  try {
    await ensureDatabaseReady()

    const currentConfig = await getStoredWhatsAppConfig()
    const nextConfig = {
      ...currentConfig,
      testModeEnabled: normalizeBoolean(request.body?.enabled, currentConfig.testModeEnabled),
    }

    const savedConfig = await saveWhatsAppConfig(nextConfig)

    response.json({
      ok: true,
      enabled: normalizeBoolean(savedConfig.testModeEnabled),
      number: normalizeBoliviaTestNumber(savedConfig.testModeNumber),
      numbers: getConfiguredWhatsAppTestNumbers(savedConfig),
      config: sanitizeWhatsAppConfig(savedConfig),
    })
  } catch (error) {
    response.status(500).json({
      message: 'No se pudo actualizar el modo de prueba de WhatsApp.',
      error: error.message,
    })
  }
})

  // GET /api/integrations/whatsapp-test-numbers
  app.get('/api/integrations/whatsapp-test-numbers', authMiddleware, async (_request, response) => {
  try {
    await ensureDatabaseReady()
    const config = await getStoredWhatsAppConfig()
    response.json({
      items: getConfiguredWhatsAppTestNumbers(config).map((number, index) => ({
        id: number,
        number,
        isPrimary: index === 0,
      })),
    })
  } catch (error) {
    response.status(500).json({
      message: 'No se pudo obtener la lista de numeros de prueba.',
      error: error.message,
    })
  }
})

  // POST /api/integrations/whatsapp-test-numbers
  app.post('/api/integrations/whatsapp-test-numbers', authMiddleware, async (request, response) => {
  try {
    await ensureDatabaseReady()
    const number = normalizeBoliviaTestNumber(request.body?.number)
    if (!number) {
      response.status(400).json({ message: 'Ingresa un numero de prueba valido.' })
      return
    }

    const currentConfig = await getStoredWhatsAppConfig()
    const testModeNumbers = normalizeBoliviaTestNumberList(
      [...getConfiguredWhatsAppTestNumbers(currentConfig), number],
      [whatsappDefaults.testModeNumber],
    )
    const savedConfig = await saveWhatsAppConfig({ ...currentConfig, testModeNumbers })

    response.status(201).json({
      message: 'Numero de prueba agregado correctamente.',
      items: getConfiguredWhatsAppTestNumbers(savedConfig).map((value, index) => ({
        id: value,
        number: value,
        isPrimary: index === 0,
      })),
      config: sanitizeWhatsAppConfig(savedConfig),
    })
  } catch (error) {
    response.status(500).json({
      message: 'No se pudo agregar el numero de prueba.',
      error: error.message,
    })
  }
})

  // PUT /api/integrations/whatsapp-test-numbers/:number
  app.put('/api/integrations/whatsapp-test-numbers/:number', authMiddleware, async (request, response) => {
  try {
    await ensureDatabaseReady()
    const currentNumber = normalizeBoliviaTestNumber(request.params.number)
    const nextNumber = normalizeBoliviaTestNumber(request.body?.number)

    if (!currentNumber || !nextNumber) {
      response.status(400).json({ message: 'Los numeros de prueba indicados no son validos.' })
      return
    }

    const currentConfig = await getStoredWhatsAppConfig()
    const existingNumbers = getConfiguredWhatsAppTestNumbers(currentConfig)

    if (!existingNumbers.includes(currentNumber)) {
      response.status(404).json({ message: 'No se encontro el numero de prueba solicitado.' })
      return
    }

    const testModeNumbers = normalizeBoliviaTestNumberList(
      existingNumbers.map((value) => (value === currentNumber ? nextNumber : value)),
      [whatsappDefaults.testModeNumber],
    )
    const savedConfig = await saveWhatsAppConfig({ ...currentConfig, testModeNumbers })

    response.json({
      message: 'Numero de prueba actualizado correctamente.',
      items: getConfiguredWhatsAppTestNumbers(savedConfig).map((value, index) => ({
        id: value,
        number: value,
        isPrimary: index === 0,
      })),
      config: sanitizeWhatsAppConfig(savedConfig),
    })
  } catch (error) {
    response.status(500).json({
      message: 'No se pudo actualizar el numero de prueba.',
      error: error.message,
    })
  }
})

  // DELETE /api/integrations/whatsapp-test-numbers/:number
  app.delete('/api/integrations/whatsapp-test-numbers/:number', authMiddleware, async (request, response) => {
  try {
    await ensureDatabaseReady()
    const number = normalizeBoliviaTestNumber(request.params.number)
    const currentConfig = await getStoredWhatsAppConfig()
    const existingNumbers = getConfiguredWhatsAppTestNumbers(currentConfig)

    if (!existingNumbers.includes(number)) {
      response.status(404).json({ message: 'No se encontro el numero de prueba solicitado.' })
      return
    }

    const remainingNumbers = existingNumbers.filter((value) => value !== number)
    const testModeNumbers =
      remainingNumbers.length > 0
        ? remainingNumbers
        : normalizeBoliviaTestNumberList([whatsappDefaults.testModeNumber])

    const savedConfig = await saveWhatsAppConfig({ ...currentConfig, testModeNumbers })

    response.json({
      message: 'Numero de prueba eliminado correctamente.',
      items: getConfiguredWhatsAppTestNumbers(savedConfig).map((value, index) => ({
        id: value,
        number: value,
        isPrimary: index === 0,
      })),
      config: sanitizeWhatsAppConfig(savedConfig),
    })
  } catch (error) {
    response.status(500).json({
      message: 'No se pudo eliminar el numero de prueba.',
      error: error.message,
    })
  }
})

  // GET /api/integrations/whatsapp/webhook
  app.get('/api/integrations/whatsapp/webhook', async (request, response) => {
  try {
    await ensureDatabaseReady()
    const config = await getStoredWhatsAppConfig()
    const acceptedTokens = getAcceptedWebhookVerifyTokens(config)
    const mode = normalizeReference(request.query['hub.mode'])
    const token = normalizeReference(request.query['hub.verify_token'])
    const challenge = request.query['hub.challenge']

    if (
      mode === 'subscribe' &&
      acceptedTokens.includes(token) &&
      typeof challenge === 'string'
    ) {
      response.status(200).send(challenge)
      return
    }

    response.status(403).send('Webhook verification failed.')
  } catch (error) {
    response.status(500).send(error.message)
  }
})

  // POST /api/integrations/whatsapp/webhook
  app.post('/api/integrations/whatsapp/webhook', async (request, response) => {
  console.log('Webhook de WhatsApp recibido:', JSON.stringify(request.body))
  try {
    await ensureDatabaseReady()
    await persistInboundWhatsAppWebhook(request.body)
  } catch (error) {
    console.error('No se pudo guardar el webhook de WhatsApp:', error.message)
    response.status(500).json({
      received: false,
      message: 'No se pudo procesar el webhook de WhatsApp.',
    })
    return
  }
  response.status(200).json({ received: true })
})

}
