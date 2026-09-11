import cors from 'cors';
import multer from 'multer';

export default function registerContact-groupsRoutes(app, deps) {
  const { pool, sessions, authMiddleware, writeSystemLog, hashPassword, createSession, sanitizeUser, sanitizeManagedUser, fetchJsonWithTimeout, getCachedValue, setCachedValue, getNormalizedTimeoutMs, ensureDatabaseReady, reloadLocalEnv, getTrackingApiDefaults, fetchAllTrackingPackagesCatalog, buildTrackingCatalogFallbackPayload, getCachedTrackingPackagesCatalog, getContactPackagesApiDefaults, fetchAllContactPackagesCatalog, getCachedContactPackagesCatalog, normalizeReference, buildEmsPipelineCards, pipelineStageKeys, getEmsPipelineMonthKey, getPackagePipelineSyncSnapshot, ensurePackagePipelineSync, extractPackageCode, normalizePackageCodeForLookup, fetchExactPackageCodeMatches, getPackageCodeValuesForLookup, findPackageCodeInPaginatedApi, normalizeEmsStageOverrideValue, getStoredEmsStageOverrides, saveEmsStageOverride, maybeStartTestModeConversation, getStoredWhatsAppConfig, getContactGroups, getStoredProntsConfig, getStoredPipelineConfig, defaultProntsConfig, defaultPipelineConfig, formatRelativeDate, formatCurrency, sanitizeWhatsAppConfig, buildPackagePipelineSyncFallback, normalizeGroupColor, defaultIntegrations, siteBlocks } = deps;

  // POST /api/contact-groups
  app.post('/api/contact-groups', authMiddleware, async (request, response) => {
  const { name, description, color, contactIds } = request.body ?? {}
  const normalizedName = normalizeReference(name)
  const normalizedDescription = normalizeReference(description)
  const normalizedColor = normalizeGroupColor(color)
  const ids = Array.isArray(contactIds)
    ? [...new Set(contactIds.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0))]
    : []

  if (!normalizedName) {
    response.status(400).json({ message: 'Escribe un nombre para el grupo.' })
    return
  }

  try {
    await ensureDatabaseReady()
    const client = await pool.connect()

    try {
      await client.query('begin')

      const groupResult = await client.query(
        `
          insert into contact_groups (name, description, color, updated_at)
          values ($1, $2, $3, now())
          returning id, name, description, color;
        `,
        [normalizedName, normalizedDescription, normalizedColor],
      )

      const group = groupResult.rows[0]

      if (ids.length > 0) {
        await client.query(
          `
            insert into contact_group_members (group_id, contact_id)
            select $1, contact.id
            from unnest($2::int[]) as contact(id)
            on conflict (group_id, contact_id) do nothing;
          `,
          [group.id, ids],
        )
      }

      await client.query('commit')

      const [groups] = await Promise.all([getContactGroups(client)])
      const createdGroup = groups.find((item) => item.id === group.id)

      response.status(201).json({
        ok: true,
        group: createdGroup ?? {
          id: group.id,
          name: group.name,
          description: group.description,
          color: group.color,
          memberCount: ids.length,
        },
      })
    } catch (error) {
      await client.query('rollback').catch(() => {})
      throw error
    } finally {
      client.release()
    }
  } catch (error) {
    response.status(500).json({
      message: 'No se pudo crear el grupo de contactos.',
      error: error.message,
    })
  }
})

  // POST /api/contact-groups/:id/members
  app.post('/api/contact-groups/:id/members', authMiddleware, async (request, response) => {
  const groupId = Number(request.params.id)
  const ids = Array.isArray(request.body?.contactIds)
    ? [...new Set(request.body.contactIds.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0))]
    : []

  if (!Number.isInteger(groupId) || groupId <= 0) {
    response.status(400).json({ message: 'El identificador del grupo no es valido.' })
    return
  }

  if (ids.length === 0) {
    response.status(400).json({ message: 'Selecciona al menos un contacto para agrupar.' })
    return
  }

  try {
    await ensureDatabaseReady()

    const groupResult = await pool.query(
      `
        select id
        from contact_groups
        where id = $1
        limit 1;
      `,
      [groupId],
    )

    if (!groupResult.rows[0]) {
      response.status(404).json({ message: 'No se encontro el grupo seleccionado.' })
      return
    }

    await pool.query(
      `
        insert into contact_group_members (group_id, contact_id)
        select $1, contact.id
        from unnest($2::int[]) as contact(id)
        on conflict (group_id, contact_id) do nothing;
      `,
      [groupId, ids],
    )

    await pool.query(
      `
        update contact_groups
        set updated_at = now()
        where id = $1;
      `,
      [groupId],
    )

    const groups = await getContactGroups()
    response.json({
      ok: true,
      group: groups.find((item) => item.id === groupId) ?? null,
    })
  } catch (error) {
    response.status(500).json({
      message: 'No se pudo actualizar el grupo.',
      error: error.message,
    })
  }
})

  // DELETE /api/contact-groups/:groupId/members/:contactId
  app.delete('/api/contact-groups/:groupId/members/:contactId', authMiddleware, async (request, response) => {
  const groupId = Number(request.params.groupId)
  const contactId = Number(request.params.contactId)

  if (!Number.isInteger(groupId) || groupId <= 0) {
    response.status(400).json({ message: 'El identificador del grupo no es valido.' })
    return
  }

  if (!Number.isInteger(contactId) || contactId <= 0) {
    response.status(400).json({ message: 'El identificador del contacto no es valido.' })
    return
  }

  try {
    await ensureDatabaseReady()

    const deletedResult = await pool.query(
      `
        delete from contact_group_members
        where group_id = $1 and contact_id = $2;
      `,
      [groupId, contactId],
    )

    if ((deletedResult.rowCount ?? 0) === 0) {
      response.status(404).json({ message: 'Ese contacto no pertenece al grupo seleccionado.' })
      return
    }

    await pool.query(
      `
        update contact_groups
        set updated_at = now()
        where id = $1;
      `,
      [groupId],
    )

    const groups = await getContactGroups()

    response.json({
      ok: true,
      group: groups.find((item) => item.id === groupId) ?? null,
    })
  } catch (error) {
    response.status(500).json({
      message: 'No se pudo quitar el contacto del grupo.',
      error: error.message,
    })
  }
})

  // POST /api/contact-groups/:id/messages/send
  app.post('/api/contact-groups/:id/messages/send', authMiddleware, async (request, response) => {
  const groupId = Number(request.params.id)
  const template = typeof request.body?.message === 'string' ? request.body.message.trim() : ''

  if (!Number.isInteger(groupId) || groupId <= 0) {
    response.status(400).json({ message: 'El identificador del grupo no es valido.' })
    return
  }

  if (!template) {
    response.status(400).json({ message: 'Escribe el mensaje que se enviara al grupo.' })
    return
  }

  if (template.length > 4096) {
    response.status(400).json({ message: 'El mensaje supera el limite de 4096 caracteres de WhatsApp.' })
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

    const groupResult = await pool.query(
      `
        select g.id, g.name
        from contact_groups g
        where g.id = $1
        limit 1;
      `,
      [groupId],
    )

    const group = groupResult.rows[0]

    if (!group) {
      response.status(404).json({ message: 'No se encontro el grupo seleccionado.' })
      return
    }

    const membersResult = await pool.query(
      `
        select c.id, c.name, c.company, c.segment, c.owner_name, c.social_profiles
        from contact_group_members m
        join contacts c on c.id = m.contact_id
        where m.group_id = $1
        order by c.name asc;
      `,
      [groupId],
    )

    const members = membersResult.rows

    if (members.length === 0) {
      response.status(400).json({ message: 'El grupo no tiene contactos asignados.' })
      return
    }

    const results = []

    for (const member of members) {
      const targetReference = resolveWhatsAppReference(member)
      const normalizedNumber = normalizePhoneNumber(targetReference)

      if (!normalizedNumber) {
        results.push({
          contactId: member.id,
          name: member.name,
          recipient: '',
          status: 'skipped',
          error: 'El contacto no tiene una referencia de WhatsApp valida.',
        })
        continue
      }

      const message = formatGroupMessage(template, member).trim()

      if (!message) {
        results.push({
          contactId: member.id,
          name: member.name,
          recipient: normalizedNumber,
          status: 'skipped',
          error: 'El mensaje personalizado quedo vacio.',
        })
        continue
      }

      try {
        const providerResponse = await sendWhatsAppCloudMessage({
          accessToken: config.accessToken,
          apiVersion: config.apiVersion,
          phoneNumberId: config.phoneNumberId,
          to: normalizedNumber,
          body: message,
        })

        const providerMessageId =
          providerResponse?.messages?.[0]?.id ?? providerResponse?.message_id ?? null

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
          [member.id, normalizedNumber, message, providerMessageId],
        )

        results.push({
          contactId: member.id,
          name: member.name,
          recipient: normalizedNumber,
          status: 'sent',
          messageId: providerMessageId,
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
            [member.id, normalizedNumber, message, error.message],
          )
          .catch(() => {})

        results.push({
          contactId: member.id,
          name: member.name,
          recipient: normalizedNumber,
          status: 'failed',
          error: error.message,
        })
      }
    }

    response.json({
      ok: true,
      group: {
        id: group.id,
        name: group.name,
      },
      sentCount: results.filter((item) => item.status === 'sent').length,
      failedCount: results.filter((item) => item.status === 'failed').length,
      skippedCount: results.filter((item) => item.status === 'skipped').length,
      results,
    })
  } catch (error) {
    response.status(500).json({
      message: 'No se pudo enviar el mensaje al grupo.',
      error: error.message,
    })
  }
})

}
