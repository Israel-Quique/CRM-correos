import cors from 'cors';
import multer from 'multer';

export default function registerMessagesRoutes(app, deps) {
  const { pool, sessions, authMiddleware, writeSystemLog, hashPassword, createSession, sanitizeUser, sanitizeManagedUser, fetchJsonWithTimeout, getCachedValue, setCachedValue, getNormalizedTimeoutMs, ensureDatabaseReady, reloadLocalEnv, getTrackingApiDefaults, fetchAllTrackingPackagesCatalog, buildTrackingCatalogFallbackPayload, getCachedTrackingPackagesCatalog, getContactPackagesApiDefaults, fetchAllContactPackagesCatalog, getCachedContactPackagesCatalog, normalizeReference, buildEmsPipelineCards, pipelineStageKeys, getEmsPipelineMonthKey, getPackagePipelineSyncSnapshot, ensurePackagePipelineSync, extractPackageCode, normalizePackageCodeForLookup, fetchExactPackageCodeMatches, getPackageCodeValuesForLookup, findPackageCodeInPaginatedApi, normalizeEmsStageOverrideValue, getStoredEmsStageOverrides, saveEmsStageOverride, maybeStartTestModeConversation, getStoredWhatsAppConfig, getContactGroups, getStoredProntsConfig, getStoredPipelineConfig, defaultProntsConfig, defaultPipelineConfig, formatRelativeDate, formatCurrency, sanitizeWhatsAppConfig, buildPackagePipelineSyncFallback, normalizeGroupColor, defaultIntegrations, siteBlocks } = deps;

  // POST /api/messages/whatsapp/send
  app.post('/api/messages/whatsapp/send', authMiddleware, upload.single('attachment'), async (request, response) => {
  const { contactId, to } = request.body ?? {}
  const message = typeof request.body?.message === 'string' ? request.body.message.trim() : ''
  const attachment = request.file ?? null
  const requestedMediaKind =
    attachment?.mimetype?.startsWith('image/')
      ? 'image'
      : attachment?.mimetype?.startsWith('audio/')
        ? 'audio'
        : null

  if (!message && !attachment) {
    response.status(400).json({ message: 'Escribe un mensaje o adjunta una imagen/audio.' })
    return
  }

  if (message.length > 4096) {
    response.status(400).json({ message: 'El mensaje supera el limite de 4096 caracteres de WhatsApp.' })
    return
  }

  if (attachment && !requestedMediaKind) {
    response.status(400).json({ message: 'Solo se permiten imagenes o audios para enviar como adjunto.' })
    return
  }

  if (requestedMediaKind === 'audio' && message) {
    response.status(400).json({
      message: 'Los audios no admiten texto adicional. Envia solo el archivo de audio.',
    })
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

    let targetReference = normalizeReference(to)
    let targetContactId = Number.isInteger(Number(contactId)) ? Number(contactId) : null

    if (!targetReference && targetContactId !== null) {
      const contactResult = await pool.query(
        `
          select id, social_profiles
          from contacts
          where id = $1
          limit 1;
        `,
        [targetContactId],
      )

      const contact = contactResult.rows[0]

      if (!contact) {
        response.status(404).json({ message: 'No se encontro el contacto seleccionado.' })
        return
      }

      targetReference = resolveWhatsAppReference(contact)
    }

    if (targetReference && targetContactId === null) {
      const matchedContact = await findContactByWhatsAppReference(targetReference)
      targetContactId = matchedContact?.id ?? null
    }

    if (!targetReference) {
      response.status(400).json({
        message: 'El contacto no tiene una referencia de WhatsApp valida para enviar mensajes.',
      })
      return
    }

    const normalizedNumber = normalizePhoneNumber(targetReference)

    if (!normalizedNumber) {
      response.status(400).json({
        message: 'La referencia de WhatsApp debe contener un numero telefonico valido.',
      })
      return
    }

    const testModeEnabled = normalizeBoolean(config.testModeEnabled, whatsappDefaults.testModeEnabled)
    const testModeNumbers = getConfiguredWhatsAppTestNumbers(config)
    const testModeNumber = testModeNumbers[0] || normalizeBoliviaTestNumber(whatsappDefaults.testModeNumber)

    if (testModeEnabled) {
      const normalizedTargetNumber = normalizeBoliviaTestNumber(normalizedNumber)

      if (!testModeNumbers.includes(normalizedTargetNumber)) {
        response.status(403).json({
          message: 'El modo prueba esta activo. Solo se permite enviar mensajes a los numeros autorizados de prueba.',
        })
        return
      }

    }

    const storedAttachment = attachment
      ? await saveMediaBufferToDisk({
          buffer: attachment.buffer,
          mimeType: attachment.mimetype || 'application/octet-stream',
          originalName: attachment.originalname || 'attachment',
          prefix: `outbound-${normalizedNumber}`,
        })
      : null

    const messageMedia = attachment
      ? {
          kind: requestedMediaKind,
          file: attachment,
        }
      : null

    const providerResponse = await sendWhatsAppCloudMessage({
      accessToken: config.accessToken,
      apiVersion: config.apiVersion,
      phoneNumberId: config.phoneNumberId,
      to: normalizedNumber,
      body: message.trim(),
      media: messageMedia,
    })

    const providerMessageId =
      providerResponse?.messages?.[0]?.id ?? providerResponse?.message_id ?? null

    const messageTextForLog = attachment
      ? requestedMediaKind === 'image'
        ? message || '[image]'
        : '[audio]'
      : message.trim()

    await pool.query(
      `
        insert into message_logs (
          contact_id,
          channel,
          recipient_reference,
          message_text,
          provider_name,
          provider_message_id,
          status,
          media_path,
          media_kind,
          media_mime_type,
          media_filename
        )
        values ($1, 'WhatsApp', $2, $3, 'Meta Cloud API', $4, 'sent', $5, $6, $7, $8);
      `,
        [
          targetContactId,
          normalizedNumber,
          messageTextForLog,
          providerMessageId,
        storedAttachment?.mediaUrl ?? null,
        requestedMediaKind,
        attachment?.mimetype || null,
        storedAttachment?.filename ?? null,
        ],
      )

    await syncContactEmsStatus({
      contactId: targetContactId,
    })

    response.json({
      ok: true,
      provider: 'Meta Cloud API',
      recipient: normalizedNumber,
      messageId: providerMessageId,
      messageKind: attachment ? requestedMediaKind : 'text',
      mediaUrl: storedAttachment?.mediaUrl ?? null,
      mediaFilename: storedAttachment?.filename ?? null,
      raw: providerResponse,
    })
  } catch (error) {
    await pool
      .query(
        `
          insert into message_logs (
            contact_id,
            channel,
            recipient_reference,
            message_text,
            provider_name,
            status,
            error_message
          )
          values ($1, 'WhatsApp', $2, $3, 'Meta Cloud API', 'failed', $4);
        `,
        [
          Number.isInteger(Number(request.body?.contactId)) ? Number(request.body.contactId) : null,
          normalizeReference(request.body?.to),
          typeof request.body?.message === 'string' ? request.body.message.trim() : '',
          error.message,
        ],
      )
      .catch(() => {})

    response.status(500).json({
      message: 'No se pudo enviar el mensaje por WhatsApp Meta.',
      error: error.message,
    })
  }
})

}
