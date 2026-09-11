import cors from 'cors';
import multer from 'multer';

export default function registerContactsRoutes(app, deps) {
  const { pool, sessions, authMiddleware, writeSystemLog, hashPassword, createSession, sanitizeUser, sanitizeManagedUser, fetchJsonWithTimeout, getCachedValue, setCachedValue, getNormalizedTimeoutMs, ensureDatabaseReady, reloadLocalEnv, getTrackingApiDefaults, fetchAllTrackingPackagesCatalog, buildTrackingCatalogFallbackPayload, getCachedTrackingPackagesCatalog, getContactPackagesApiDefaults, fetchAllContactPackagesCatalog, getCachedContactPackagesCatalog, normalizeReference, buildEmsPipelineCards, pipelineStageKeys, getEmsPipelineMonthKey, getPackagePipelineSyncSnapshot, ensurePackagePipelineSync, extractPackageCode, normalizePackageCodeForLookup, fetchExactPackageCodeMatches, getPackageCodeValuesForLookup, findPackageCodeInPaginatedApi, normalizeEmsStageOverrideValue, getStoredEmsStageOverrides, saveEmsStageOverride, maybeStartTestModeConversation, getStoredWhatsAppConfig, getContactGroups, getStoredProntsConfig, getStoredPipelineConfig, defaultProntsConfig, defaultPipelineConfig, formatRelativeDate, formatCurrency, sanitizeWhatsAppConfig, buildPackagePipelineSyncFallback, normalizeGroupColor, defaultIntegrations, siteBlocks } = deps;

  // GET /api/contacts/:id/messages
  app.get('/api/contacts/:id/messages', authMiddleware, async (request, response) => {
  const contactId = Number(request.params.id)

  if (!Number.isInteger(contactId) || contactId <= 0) {
    response.status(400).json({ message: 'El identificador del contacto no es valido.' })
    return
  }

  try {
    await ensureDatabaseReady()

    const contactResult = await pool.query(
      `
        select id, name, company, social_profiles
        from contacts
        where id = $1
        limit 1;
      `,
      [contactId],
    )

    const contact = contactResult.rows[0]

    if (!contact) {
      response.status(404).json({ message: 'No se encontro el contacto solicitado.' })
      return
    }

    const whatsappReference = resolveWhatsAppReference(contact)
    const contactReferenceCandidates = getWhatsAppNumberCandidates(whatsappReference)

    const messagesResult = await pool.query(
      `
        select
          id,
          channel,
          direction,
          recipient_reference,
          message_text,
          provider_name,
          provider_message_id,
          status,
          error_message,
          media_path,
          media_kind,
          media_mime_type,
          media_filename,
          created_at
        from message_logs
        where contact_id = $1
           or (
             contact_id is null
             and array_length($2::text[], 1) is not null
             and regexp_replace(coalesce(recipient_reference, ''), '[^0-9]', '', 'g') = any($2::text[])
           )
        order by created_at asc, id asc;
      `,
      [contactId, contactReferenceCandidates],
    )

    response.json({
      contact: {
        id: contact.id,
        name: contact.name,
        company: contact.company,
        status: contact.status,
      },
      messages: messagesResult.rows.map((row) => ({
        id: row.id,
        channel: row.channel,
        direction: row.direction,
        recipientReference: row.recipient_reference,
        message: row.message_text,
        provider: row.provider_name,
        providerMessageId: row.provider_message_id,
        status: row.status,
        errorMessage: row.error_message,
        mediaUrl: row.media_path,
        mediaKind: row.media_kind,
        mediaMimeType: row.media_mime_type,
        mediaFilename: row.media_filename,
        createdAt: row.created_at,
      })),
    })
  } catch (error) {
    response.status(500).json({
      message: 'No se pudo cargar la conversacion del contacto.',
      error: error.message,
    })
  }
})

  // DELETE /api/contacts/:id/messages
  app.delete('/api/contacts/:id/messages', authMiddleware, async (request, response) => {
  const contactId = Number(request.params.id)

  if (!Number.isInteger(contactId) || contactId <= 0) {
    response.status(400).json({ message: 'El identificador del contacto no es valido.' })
    return
  }

  try {
    await ensureDatabaseReady()

    const contactResult = await pool.query(
      `
        select id, name, company, social_profiles
        from contacts
        where id = $1
        limit 1;
      `,
      [contactId],
    )

    const contact = contactResult.rows[0]

    if (!contact) {
      response.status(404).json({ message: 'No se encontro el contacto solicitado.' })
      return
    }

    const whatsappReference = resolveWhatsAppReference(contact)
    const contactReferenceCandidates = getWhatsAppNumberCandidates(whatsappReference)

    const deletedResult = await pool.query(
      `
        delete from message_logs
        where contact_id = $1
           or (
             contact_id is null
             and array_length($2::text[], 1) is not null
             and regexp_replace(coalesce(recipient_reference, ''), '[^0-9]', '', 'g') = any($2::text[])
           );
      `,
      [contactId, contactReferenceCandidates],
    )

    response.json({
      ok: true,
      deletedCount: deletedResult.rowCount ?? 0,
    })
  } catch (error) {
    response.status(500).json({
      message: 'No se pudo borrar la conversacion del contacto.',
      error: error.message,
    })
  }
})

  // POST /api/contacts
  app.post('/api/contacts', authMiddleware, async (request, response) => {
  const { name, company, segment, owner, status, score, normalizedChannels, socialProfiles } =
    normalizeContactPayload(request.body)

  if (!name || !segment || !owner || !status) {
    response.status(400).json({ message: 'Faltan campos requeridos para crear el contacto.' })
    return
  }

  if (normalizedChannels.length === 0) {
    response.status(400).json({ message: 'Selecciona al menos una red o canal de contacto.' })
    return
  }

  if (socialProfiles.some((profile) => !profile.reference)) {
    response
      .status(400)
      .json({ message: 'Completa el dato de referencia o contacto para cada red seleccionada.' })
    return
  }

  const whatsappProfile = socialProfiles.find(
    (profile) => normalizeReference(profile.channel).toLowerCase() === 'whatsapp',
  )

  if (whatsappProfile && !isCellPhoneNumber(whatsappProfile.reference)) {
    response.status(400).json({ message: 'El numero de WhatsApp debe ser un celular valido.' })
    return
  }

  try {
    await ensureDatabaseReady()

    const result = await pool.query(
      `
        insert into contacts (name, company, channel, social_profiles, segment, owner_name, status, score)
        values ($1, $2, $3, $4::jsonb, $5, $6, $7, $8)
        returning id, name, company, channel, social_profiles, segment, owner_name, status, score, updated_at;
      `,
      [
        name,
        company,
        normalizedChannels.join(', '),
        JSON.stringify(socialProfiles),
        segment,
        owner,
        status,
        Number(score) || 0,
      ],
    )

    const row = result.rows[0]
    const whatsappReference = resolveWhatsAppReference(row)

    await linkOrphanWhatsAppMessages(row.id, whatsappReference)

    response.status(201).json({
      id: row.id,
      name: row.name,
      company: row.company,
      channel: row.channel,
      socialProfiles: row.social_profiles ?? [],
      segment: row.segment,
      owner: row.owner_name,
      status: row.status,
      score: row.score,
      updatedAt: formatRelativeDate(row.updated_at),
    })
  } catch (error) {
    response.status(500).json({ message: 'No se pudo crear el contacto.', error: error.message })
  }
})

  // PUT /api/contacts/:id
  app.put('/api/contacts/:id', authMiddleware, async (request, response) => {
  const contactId = Number(request.params.id)
  const { name, company, segment, owner, status, score, normalizedChannels, socialProfiles } =
    normalizeContactPayload(request.body)

  if (!Number.isInteger(contactId) || contactId <= 0) {
    response.status(400).json({ message: 'El identificador del contacto no es valido.' })
    return
  }

  if (!name || !segment || !owner || !status) {
    response.status(400).json({ message: 'Faltan campos requeridos para actualizar el contacto.' })
    return
  }

  if (normalizedChannels.length === 0) {
    response.status(400).json({ message: 'Selecciona al menos una red o canal de contacto.' })
    return
  }

  if (socialProfiles.some((profile) => !profile.reference)) {
    response
      .status(400)
      .json({ message: 'Completa el dato de referencia o contacto para cada red seleccionada.' })
    return
  }

  const whatsappProfile = socialProfiles.find(
    (profile) => normalizeReference(profile.channel).toLowerCase() === 'whatsapp',
  )

  if (whatsappProfile && !isCellPhoneNumber(whatsappProfile.reference)) {
    response.status(400).json({ message: 'El numero de WhatsApp debe ser un celular valido.' })
    return
  }

  try {
    await ensureDatabaseReady()
    const existingContactResult = await pool.query(
      `
        select status
        from contacts
        where id = $1
        limit 1;
      `,
      [contactId],
    )
    const previousStatus = normalizeReference(existingContactResult.rows[0]?.status)

    const result = await pool.query(
      `
        update contacts
        set name = $1,
            company = $2,
            channel = $3,
            social_profiles = $4::jsonb,
            segment = $5,
            owner_name = $6,
            status = $7,
            score = $8,
            updated_at = now()
        where id = $9
        returning id, name, company, channel, social_profiles, segment, owner_name, status, score, updated_at;
      `,
      [
        name,
        company,
        normalizedChannels.join(', '),
        JSON.stringify(socialProfiles),
        segment,
        owner,
        status,
        Number(score) || 0,
        contactId,
      ],
    )

    const row = result.rows[0]

    if (!row) {
      response.status(404).json({ message: 'No se encontro el contacto seleccionado.' })
      return
    }

    const whatsappReference = resolveWhatsAppReference(row)

    await linkOrphanWhatsAppMessages(row.id, whatsappReference)

    if (previousStatus && previousStatus !== normalizeReference(row.status)) {
      await maybeSendTestModeStageUpdate(request).catch(async (error) => {
        await writeSystemLog({
          level: 'error',
          event: 'whatsapp_test_mode_stage_update_failed',
          request,
          statusCode: 500,
          details: {
            trigger: 'contact-status-update',
            contactId: row.id,
            previousStatus,
            nextStatus: normalizeReference(row.status),
            error: error instanceof Error ? error.message : 'Error desconocido.',
          },
        }).catch(() => {})
      })
    }

    response.json({
      id: row.id,
      name: row.name,
      company: row.company,
      channel: row.channel,
      socialProfiles: row.social_profiles ?? [],
      segment: row.segment,
      owner: row.owner_name,
      status: row.status,
      score: row.score,
      updatedAt: formatRelativeDate(row.updated_at),
    })
  } catch (error) {
    response.status(500).json({ message: 'No se pudo actualizar el contacto.', error: error.message })
  }
})

}
