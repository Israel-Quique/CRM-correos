import cors from 'cors';
import multer from 'multer';

export default function registerDashboardRoutes(app, deps) {
  const { pool, sessions, authMiddleware, writeSystemLog, hashPassword, createSession, sanitizeUser, sanitizeManagedUser, fetchJsonWithTimeout, getCachedValue, setCachedValue, getNormalizedTimeoutMs, ensureDatabaseReady, reloadLocalEnv, getTrackingApiDefaults, fetchAllTrackingPackagesCatalog, buildTrackingCatalogFallbackPayload, getCachedTrackingPackagesCatalog, getContactPackagesApiDefaults, fetchAllContactPackagesCatalog, getCachedContactPackagesCatalog, normalizeReference, buildEmsPipelineCards, pipelineStageKeys, getEmsPipelineMonthKey, getPackagePipelineSyncSnapshot, ensurePackagePipelineSync, extractPackageCode, normalizePackageCodeForLookup, fetchExactPackageCodeMatches, getPackageCodeValuesForLookup, findPackageCodeInPaginatedApi, normalizeEmsStageOverrideValue, getStoredEmsStageOverrides, saveEmsStageOverride, maybeStartTestModeConversation, getStoredWhatsAppConfig, getContactGroups, getStoredProntsConfig, getStoredPipelineConfig, defaultProntsConfig, defaultPipelineConfig, formatRelativeDate, formatCurrency, sanitizeWhatsAppConfig, buildPackagePipelineSyncFallback, normalizeGroupColor, defaultIntegrations, siteBlocks } = deps;

  // GET /api/dashboard
  app.get('/api/dashboard', authMiddleware, async (request, response) => {
  try {
    await ensureDatabaseReady()
    await maybeStartTestModeConversation(request).catch(async (error) => {
      await writeSystemLog({
        level: 'error',
        event: 'whatsapp_test_mode_auto_start_failed',
        request,
        statusCode: 500,
        details: {
          error: error instanceof Error ? error.message : 'Error desconocido.',
        },
      }).catch(() => {})
    })

    const [
      contactsResult,
      dealsResult,
      campaignsResult,
      agentsResult,
      whatsappConfig,
      contactGroups,
      prontsConfig,
      pipelineConfig,
      emsStageOverrides,
    ] = await Promise.allSettled([
      pool.query(`
        select
          c.id,
          c.name,
          c.company,
          c.channel,
          c.social_profiles,
          c.segment,
          c.owner_name,
          c.status,
          c.score,
          c.updated_at,
          message_activity.last_message_at,
          message_activity.last_inbound_at,
          latest_message.message_text as last_message_text,
          latest_message.direction as last_message_direction
        from contacts c
        left join lateral (
          select regexp_replace(coalesce(profile->>'reference', ''), '[^0-9]', '', 'g') as whatsapp_reference
          from jsonb_array_elements(coalesce(c.social_profiles, '[]'::jsonb)) as profile
          where lower(coalesce(profile->>'channel', '')) = 'whatsapp'
          limit 1
        ) whatsapp_profile on true
        left join lateral (
          select
            max(ml.created_at) as last_message_at,
            max(ml.created_at) filter (where ml.direction = 'inbound') as last_inbound_at
          from message_logs ml
          where ml.contact_id = c.id
            or (
              coalesce(whatsapp_profile.whatsapp_reference, '') <> ''
              and regexp_replace(coalesce(ml.recipient_reference, ''), '[^0-9]', '', 'g') = whatsapp_profile.whatsapp_reference
            )
        ) message_activity on true
        left join lateral (
          select ml.message_text, ml.direction
          from message_logs ml
          where ml.contact_id = c.id
            or (
              coalesce(whatsapp_profile.whatsapp_reference, '') <> ''
              and regexp_replace(coalesce(ml.recipient_reference, ''), '[^0-9]', '', 'g') = whatsapp_profile.whatsapp_reference
            )
          order by ml.created_at desc, ml.id desc
          limit 1
        ) latest_message on true
        order by c.updated_at desc;
      `),
      pool.query(`
        select id, title, stage, amount, owner_name
        from deals
        order by id asc;
      `),
      pool.query(`
        select id, name, audience, progress, channel
        from campaigns
        order by id asc;
      `),
      pool.query(`
        select id, name, area, action, model
        from agents
        order by id asc;
      `),
      getStoredWhatsAppConfig(),
      getContactGroups(),
      getStoredProntsConfig(),
      getStoredPipelineConfig(),
      getStoredEmsStageOverrides(),
    ])

    const unwrap = (result, fallback) => (result.status === 'fulfilled' ? result.value : fallback)
    const contactsResultValue = unwrap(contactsResult, { rows: [] })
    const dealsResultValue = unwrap(dealsResult, { rows: [] })
    const campaignsResultValue = unwrap(campaignsResult, { rows: [] })
    const agentsResultValue = unwrap(agentsResult, { rows: [] })
    const whatsappConfigValue = unwrap(whatsappConfig, {})
    const contactGroupsValue = unwrap(contactGroups, [])
    const prontsConfigValue = unwrap(prontsConfig, defaultProntsConfig)
    const pipelineConfigValue = unwrap(pipelineConfig, defaultPipelineConfig)
    const emsStageOverridesValue = unwrap(emsStageOverrides, {})

    const rejectedResults = [
      ['contacts', contactsResult],
      ['deals', dealsResult],
      ['campaigns', campaignsResult],
      ['agents', agentsResult],
      ['whatsappConfig', whatsappConfig],
      ['contactGroups', contactGroups],
      ['prontsConfig', prontsConfig],
      ['pipelineConfig', pipelineConfig],
      ['emsStageOverrides', emsStageOverrides],
    ].filter(([, result]) => result.status === 'rejected')

    if (rejectedResults.length > 0) {
      await writeSystemLog({
        level: 'warn',
        event: 'dashboard_partially_recovered',
        request,
        statusCode: 200,
        details: {
          failedSections: rejectedResults.map(([name, result]) => ({
            name,
            error: result.reason instanceof Error ? result.reason.message : String(result.reason ?? 'Error desconocido.'),
          })),
        },
      }).catch(() => {})
    }

    const contacts = contactsResultValue.rows.map((row) => ({
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
      lastMessageText: row.last_message_text,
      lastMessageDirection: row.last_message_direction,
      whatsappConnection: {
        isConnected:
          Boolean(row.last_message_at) &&
          Date.now() - new Date(row.last_message_at).getTime() <= 24 * 60 * 60 * 1000,
        lastActivityAt: row.last_message_at,
        lastInboundAt: row.last_inbound_at,
      },
    }))

    const deals = dealsResultValue.rows.map((row) => ({
      id: row.id,
      title: row.title,
      stage: row.stage,
      amount: formatCurrency(row.amount),
      owner: row.owner_name,
    }))

    const campaigns = campaignsResultValue.rows
    const agents = agentsResultValue.rows
    const socialContacts = contacts.filter((contact) => contact.channel !== 'Email').length
    const hotLeads = contacts.filter((contact) => contact.score >= 85).length
    const totalSales = dealsResultValue.rows.reduce((total, row) => total + Number(row.amount), 0)

    response.json({
      metrics: {
        monthlySales: formatCurrency(totalSales),
        activeConversations: socialContacts * 4,
        activeLeads: contacts.length,
        totalContacts: contacts.length,
        hotLeads,
      },
      contacts,
      deals,
      campaigns,
      agents,
      contactGroups: contactGroupsValue,
      integrations: defaultIntegrations,
      siteBlocks,
      prontsConfig: prontsConfigValue,
      pipelineConfig: pipelineConfigValue,
      emsStageOverrides: emsStageOverridesValue,
      channelConfig: {
        whatsapp: sanitizeWhatsAppConfig(whatsappConfigValue),
      },
    })
  } catch (error) {
    response.status(500).json({
      message: 'No se pudo cargar el dashboard desde PostgreSQL.',
      error: error.message,
    })
  }
})

}
