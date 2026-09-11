import cors from 'cors';
import multer from 'multer';

export default function registerAiRoutes(app, deps) {
  const { pool, sessions, authMiddleware, writeSystemLog, hashPassword, createSession, sanitizeUser, sanitizeManagedUser, fetchJsonWithTimeout, getCachedValue, setCachedValue, getNormalizedTimeoutMs, ensureDatabaseReady, reloadLocalEnv, getTrackingApiDefaults, fetchAllTrackingPackagesCatalog, buildTrackingCatalogFallbackPayload, getCachedTrackingPackagesCatalog, getContactPackagesApiDefaults, fetchAllContactPackagesCatalog, getCachedContactPackagesCatalog, normalizeReference, buildEmsPipelineCards, pipelineStageKeys, getEmsPipelineMonthKey, getPackagePipelineSyncSnapshot, ensurePackagePipelineSync, extractPackageCode, normalizePackageCodeForLookup, fetchExactPackageCodeMatches, getPackageCodeValuesForLookup, findPackageCodeInPaginatedApi, normalizeEmsStageOverrideValue, getStoredEmsStageOverrides, saveEmsStageOverride, maybeStartTestModeConversation, getStoredWhatsAppConfig, getContactGroups, getStoredProntsConfig, getStoredPipelineConfig, defaultProntsConfig, defaultPipelineConfig, formatRelativeDate, formatCurrency, sanitizeWhatsAppConfig, buildPackagePipelineSyncFallback, normalizeGroupColor, defaultIntegrations, siteBlocks } = deps;

  // GET /api/ai/health
  app.get('/api/ai/health', authMiddleware, async (_request, response) => {
  try {
    const config = getAiConfig()
    const healthResponse = await fetch(`${config.baseUrl.replace(/\/$/, '')}/api/tags`)

    if (!healthResponse.ok) {
      throw new Error('La IA local no esta disponible.')
    }

    const payload = await healthResponse.json()
    response.json({
      ok: true,
      provider: 'ollama',
      baseUrl: config.baseUrl,
      model: config.generalModel,
      roles: {
        router: config.routerModel,
        tracking: config.trackingModel,
        general: config.generalModel,
      },
      models: Array.isArray(payload?.models)
        ? payload.models.map((model) => ({
            name: model.name,
            size: model.size,
            modifiedAt: model.modified_at,
          }))
        : [],
    })
  } catch (error) {
    response.status(503).json({
      ok: false,
      provider: 'ollama',
      baseUrl: getAiConfig().baseUrl,
      model: getAiConfig().generalModel,
      message: 'La IA local en Docker no esta disponible.',
      error: error.message,
    })
  }
})

  // GET /api/ai/agent
  app.get('/api/ai/agent', authMiddleware, async (_request, response) => {
  try {
    const config = await getStoredAiAgentConfig()
    response.json({
      ok: true,
      enabled: config.enabled,
      assistedContactIds: config.assistedContactIds,
    })
  } catch (error) {
    response.status(500).json({
      message: 'No se pudo leer el estado del agente IA.',
      error: error.message,
    })
  }
})

  // PUT /api/ai/agent
  app.put('/api/ai/agent', authMiddleware, async (request, response) => {
  try {
    const enabled = Boolean(request.body?.enabled)
    const config = await saveAiAgentConfig({ enabled })
    response.json({
      ok: true,
      enabled: config.enabled,
      assistedContactIds: config.assistedContactIds,
    })
  } catch (error) {
    response.status(500).json({
      message: 'No se pudo actualizar el estado del agente IA.',
      error: error.message,
    })
  }
})

  // PUT /api/ai/agent/contacts/:id
  app.put('/api/ai/agent/contacts/:id', authMiddleware, async (request, response) => {
  const contactId = Number(request.params.id)

  if (!Number.isInteger(contactId) || contactId <= 0) {
    response.status(400).json({ message: 'El identificador del contacto no es valido.' })
    return
  }

  try {
    const currentConfig = await getStoredAiAgentConfig()
    const enabled = Boolean(request.body?.enabled)
    const nextAssistedContactIds = enabled
      ? [...currentConfig.assistedContactIds, contactId]
      : currentConfig.assistedContactIds.filter((value) => value !== contactId)
    const config = await saveAiAgentConfig({ assistedContactIds: nextAssistedContactIds })

    response.json({
      ok: true,
      contactId,
      enabled,
      globalEnabled: config.enabled,
      assistedContactIds: config.assistedContactIds,
    })
  } catch (error) {
    response.status(500).json({
      message: 'No se pudo actualizar la IA de la conversacion.',
      error: error.message,
    })
  }
})

  // POST /api/ai/pronts-simulate-send
  app.post('/api/ai/pronts-simulate-send', authMiddleware, async (request, response) => {
  const rawContactId = Number(request.body?.contact?.id)
  const contactId = Number.isInteger(rawContactId) && rawContactId > 0 ? rawContactId : null
  const contactName = normalizeReference(request.body?.contact?.name) || 'Contacto de prueba'
  const company = normalizeReference(request.body?.contact?.company) || 'Sin empresa'
  const segment = normalizeReference(request.body?.contact?.segment) || 'Sin segmento'
  const owner = normalizeReference(request.body?.contact?.owner) || 'Sin owner'
  const status = normalizeReference(request.body?.contact?.status) || 'Sin estado'
  const whatsappReference = normalizeReference(request.body?.contact?.reference)
  const systemPrompt = normalizeReference(request.body?.systemPrompt)
  const userPrompt = normalizeReference(request.body?.userPrompt)
  const action = normalizeReference(request.body?.action) || 'Simulación'
  const columnLabel = normalizeReference(request.body?.columnLabel) || 'Columna'
  const temperature = Number(request.body?.temperature)

  if (!whatsappReference) {
    response.status(400).json({ message: 'La simulacion requiere un numero de WhatsApp valido.' })
    return
  }

  if (!systemPrompt || !userPrompt) {
    response.status(400).json({ message: 'La simulacion requiere system prompt y user prompt.' })
    return
  }

  try {
    await ensureDatabaseReady()

    const config = await getStoredWhatsAppConfig()
    const configError = validateWhatsAppConfig(config)

    if (configError) {
      response.status(400).json({ message: configError })
      return
    }

    const packageContext = await fetchMatchingPackageContext(whatsappReference)
    const normalizedNumber = normalizePhoneNumber(whatsappReference)

    if (!normalizedNumber) {
      response.status(400).json({
        message: 'La referencia de WhatsApp debe contener un numero telefonico valido.',
      })
      return
    }

    const testModeEnabled = normalizeBoolean(config.testModeEnabled, whatsappDefaults.testModeEnabled)
    const testModeNumbers = getConfiguredWhatsAppTestNumbers(config)

    if (testModeEnabled) {
      const normalizedTargetNumber = normalizeBoliviaTestNumber(normalizedNumber)

      if (!testModeNumbers.includes(normalizedTargetNumber)) {
        response.status(403).json({
          message: 'El modo prueba esta activo. Solo se permite enviar mensajes a los numeros autorizados de prueba.',
        })
        return
      }

      const availableTestNumber = (
        await Promise.all(
          testModeNumbers.map(async (number) => ((await isTestModeNumberListedInApis(number)) ? number : null)),
        )
      ).find(Boolean)

      if (!availableTestNumber) {
        response.status(403).json({
          message: 'El modo prueba esta activo, pero ninguno de los numeros autorizados aparece en las APIs de Internacionales o Paquetes.',
        })
        return
      }
    }

    const prompt = [
      `Columna activa: ${columnLabel}`,
      `Accion recomendada: ${action}`,
      `Cliente: ${contactName}`,
      `Empresa: ${company}`,
      `Segmento: ${segment}`,
      `Owner: ${owner}`,
      `Estado: ${status}`,
      packageContext.matched
        ? `Contexto real del paquete:\n  ${packageContext.summaryText}\n  \n  Regla de etapa:\n  ${packageContext.lifecycleInstruction}`
        : 'Sin contexto adicional de APIs para este numero.',
      '',
      'Solicitud del usuario para el modelo:',
      userPrompt,
      '',
      'Devuelve solo el mensaje final listo para enviar por WhatsApp. Sin encabezados ni explicaciones.',
    ].join('\n  ')

    const aiResult = await callOllamaGenerate({
      prompt,
      system: systemPrompt,
      timeoutMs: 45000,
      options: Number.isFinite(temperature)
        ? { temperature: Math.max(0, Math.min(1, temperature)) }
        : {},
    })

    const generatedMessage = normalizeReference(aiResult.response)

    if (!generatedMessage) {
      response.status(500).json({ message: 'La IA no devolvio un mensaje para enviar.' })
      return
    }

    const providerResponse = await sendWhatsAppCloudMessage({
      accessToken: config.accessToken,
      apiVersion: config.apiVersion,
      phoneNumberId: config.phoneNumberId,
      to: normalizedNumber,
      body: generatedMessage,
      media: null,
    })

    const providerMessageId =
      providerResponse?.messages?.[0]?.id ?? providerResponse?.message_id ?? null

    let targetContactId = contactId

    if (targetContactId === null) {
      const matchedContact = await findContactByWhatsAppReference(whatsappReference)
      targetContactId = matchedContact?.id ?? null
    }

    await pool.query(
      `
        insert into message_logs (
          contact_id,
          channel,
          recipient_reference,
          message_text,
          provider_name,
          provider_message_id,
          status
        )
        values ($1, 'WhatsApp', $2, $3, 'Meta Cloud API', $4, 'sent');
      `,
      [
        targetContactId,
        normalizedNumber,
        generatedMessage,
        providerMessageId,
      ],
    )

    response.json({
      ok: true,
      provider: 'ollama',
      model: aiResult.model,
      generatedMessage,
      recipient: normalizedNumber,
      providerMessageId,
      contact: {
        id: targetContactId,
        name: contactName,
      },
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'No se pudo ejecutar la simulacion del prompt.'
    const isOllamaUnavailable =
      errorMessage.includes('This operation was aborted') ||
      errorMessage.includes('The operation was aborted') ||
      errorMessage.includes('ECONNREFUSED') ||
      errorMessage.includes('fetch failed') ||
      errorMessage.includes('ENOTFOUND') ||
      errorMessage.includes('No se pudo consultar la lista de modelos disponibles en Ollama.') ||
      errorMessage.includes('No hay un modelo de IA disponible en Ollama.') ||
      errorMessage.includes('La IA local no respondio correctamente.')

    response.status(isOllamaUnavailable ? 503 : 500).json({
      message: isOllamaUnavailable
        ? 'El modelo no responde o no esta activo. Verifica que Ollama este abierto y que el modelo exista.'
        : 'No se pudo ejecutar la simulacion del prompt.',
      error: errorMessage,
    })
  }
})

  // POST /api/ai/suggest-reply
  app.post('/api/ai/suggest-reply', authMiddleware, async (request, response) => {
  const contactId = Number(request.body?.contactId)
  const customInstruction = normalizeReference(request.body?.instruction)
  const fallbackMessages = Array.isArray(request.body?.messages) ? request.body.messages : []

  if (!Number.isInteger(contactId) || contactId <= 0) {
    response.status(400).json({ message: 'El identificador del contacto no es valido.' })
    return
  }

  try {
    await ensureDatabaseReady()

    const contactResult = await pool.query(
      `
        select id, name, company, segment, owner_name, status, social_profiles
        from contacts
        where id = $1
        limit 1;
      `,
      [contactId],
    )

    const contact = contactResult.rows[0]

    if (!contact) {
      response.status(404).json({ message: 'No se encontro el contacto seleccionado.' })
      return
    }

    const messagesResult = await pool.query(
      `
        select direction, message_text, created_at
        from message_logs
        where contact_id = $1
        order by created_at asc, id asc;
      `,
      [contactId],
    )

    const conversationMessages =
      messagesResult.rows.length > 0
        ? messagesResult.rows
        : fallbackMessages.map((message) => ({
            direction: normalizeReference(message?.direction) || 'inbound',
            message_text: normalizeReference(message?.message),
          }))

    const conversationContext = buildAiConversationContext(conversationMessages)
    const whatsappReference = resolveWhatsAppReference(contact)
    const packageContext = await fetchMatchingPackageContext(whatsappReference)
    const translatedConversationContext = await translateTextToSpanishForAi(conversationContext)

    if (!translatedConversationContext && !packageContext.matched) {
      response.status(400).json({
        message: 'No hay contexto suficiente para generar una sugerencia de respuesta.',
      })
      return
    }

    const prompt = [
      'Eres un asistente de WhatsApp para seguimiento de paquetes de Correos de Bolivia.',
      `Contacto: ${contact.name}`,
      `Empresa: ${contact.company || 'No registrada'}`,
      `Segmento: ${contact.segment || 'Sin segmento'}`,
      `Owner: ${contact.owner_name || 'Sin owner'}`,
      `Estado: ${contact.status || 'Sin estado'}`,
      packageContext.matched
        ? 'Hay contexto real del paquete en APIs internas. Debes usarlo para ubicar la etapa del envio y sostener la conversacion desde el inicio hasta el cierre, sin inventar datos.'
        : 'Si no hay datos de APIs, usa solo el historial de la conversacion.',
      'Usa un estilo cercano, como Jaimito de Correos de Bolivia: saluda, pide la guia si falta y explica el estado de forma natural.',
      'Si el cliente pregunta por rastreo y no da guia, responde con una sola pregunta breve para pedir el numero de guia.',
      'Si ya hay guia y contexto real, responde con una actualizacion concreta, amable y facil de leer para WhatsApp.',
      packageContext.matched
        ? `Contexto del paquete para ${whatsappReference || 'sin numero'}:\n  ${packageContext.summaryText}\n  \n  Regla de etapa:\n  ${packageContext.lifecycleInstruction}`
        : 'Sin contexto de paquete en APIs.',
      '',
      'Conversacion reciente:',
      translatedConversationContext || 'Sin historial reciente.',
      '',
      customInstruction
        ? `Instruccion adicional: ${customInstruction}`
        : 'Instruccion adicional: redacta una respuesta de 2 o 3 frases, máximo 40 palabras, cordial y lista para enviar por WhatsApp.',
      '',
      'Devuelve solo el texto sugerido, sin comillas ni explicaciones. Usa máximo 40 palabras y 3 frases.',
    ].join('\n  ')

    const aiResult = await callOllamaGenerate({ prompt })

    response.json({
      ok: true,
      provider: 'ollama',
      model: aiResult.model,
      contact: {
        id: contact.id,
        name: contact.name,
      },
      suggestion: aiResult.response,
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'No se pudo generar la sugerencia con la IA local.'
    const isOllamaUnavailable =
      errorMessage.includes('ECONNREFUSED') ||
      errorMessage.includes('fetch failed') ||
      errorMessage.includes('ENOTFOUND') ||
      errorMessage.includes('No se pudo consultar la lista de modelos disponibles en Ollama.') ||
      errorMessage.includes('No hay un modelo de IA disponible en Ollama.') ||
      errorMessage.includes('La IA local no respondio correctamente.')

    response.status(isOllamaUnavailable ? 503 : 500).json({
      message: isOllamaUnavailable
        ? 'El modelo no responde o no esta activo. Verifica que Ollama este abierto y que el modelo exista.'
        : 'No se pudo generar la sugerencia con la IA local.',
      error: errorMessage,
    })
  }
})

}
