import crypto from 'node:crypto'
import { existsSync } from 'node:fs'
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import cors from 'cors'
import dotenv from 'dotenv'
import express from 'express'
import multer from 'multer'
import { parsePhoneNumberFromString } from 'libphonenumber-js'
import pg from 'pg'

dotenv.config()

const { Pool } = pg
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const app = express()
const port = Number(process.env.PORT || 3001)
const connectionString = process.env.DATABASE_URL
const mediaStorageDir = path.join(__dirname, 'media')
const logsStorageDir = path.join(__dirname, 'logs')
const clientDistDir = path.join(__dirname, '..', '..', 'frontend', 'dist')
const clientIndexPath = path.join(clientDistDir, 'index.html')
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 16 * 1024 * 1024,
  },
})

if (!connectionString) {
  throw new Error('Falta DATABASE_URL. Crea un archivo .env basado en .env.example.')
}

const pool = new Pool({
  connectionString,
  ssl:
    process.env.DATABASE_SSL === 'true'
      ? {
          rejectUnauthorized: false,
        }
      : undefined,
})

app.use('/media', express.static(mediaStorageDir))

const defaultIntegrations = [
  'WhatsApp',
  'Instagram',
  'Facebook',
  'Zoom',
  'Google Drive',
  'Stripe',
  'Mailchimp',
  'Shopify',
]

const siteBlocks = [
  'Landing de captacion conectada al CRM',
  'Sitio de ventas con formulario y agenda',
  'Micrositio para webinars y eventos',
  'Portal de seguimiento comercial por cliente',
]

const whatsappDefaults = {
  accessToken: process.env.WHATSAPP_META_ACCESS_TOKEN?.trim() ?? '',
  phoneNumberId: process.env.WHATSAPP_META_PHONE_NUMBER_ID?.trim() ?? '1208373325701350',
  businessAccountId: process.env.WHATSAPP_META_BUSINESS_ACCOUNT_ID?.trim() ?? '',
  apiVersion: process.env.WHATSAPP_META_API_VERSION?.trim() ?? 'v23.0',
  senderNumber: process.env.WHATSAPP_META_SENDER_NUMBER?.trim() ?? '+59169670289',
  testModeEnabled:
    process.env.WHATSAPP_TEST_MODE == null ? true : process.env.WHATSAPP_TEST_MODE === 'true',
  testModeNumber: process.env.WHATSAPP_TEST_MODE_NUMBER?.trim() ?? '+59164229403',
  webhookVerifyToken:
    process.env.WHATSAPP_META_WEBHOOK_VERIFY_TOKEN?.trim() ?? crypto.randomBytes(12).toString('hex'),
}

const aiDefaults = {
  baseUrl: process.env.AI_BASE_URL?.trim() ?? 'http://localhost:11434',
  model: process.env.AI_MODEL?.trim() ?? 'llama3.1:8b',
  systemPrompt:
    process.env.AI_SYSTEM_PROMPT?.trim() ??
    [
      'Eres un asistente comercial para un CRM omnicanal de Correos de Bolivia.',
      'Responde siempre en espanol claro, directo y profesional.',
      'Responde en 2 o 3 frases como maximo y no superes 40 palabras.',
      'Tu tarea es sugerir respuestas utiles para WhatsApp sin inventar datos.',
      'Si falta contexto, produce una respuesta segura y neutral.',
    ].join(' '),
}

const getTrackingApiDefaults = () => ({
  baseUrl: process.env.TRACKING_API_URL?.trim() ?? 'https://dev.correos.gob.bo:18100',
  token:
    process.env.TRACKING_SQLSERVER_TOKEN?.trim() ??
    process.env.TRACKING_API_TOKEN?.trim() ??
    '2|FDN7orInEH6N2OprbvS0m0Xy6TkK3yvIhYjm1uwJ4e44bd99',
})

const getContactPackagesApiDefaults = () => ({
  endpoint:
    process.env.PAQUETES_CONTACTOS_API_URL?.trim() ??
    'https://dev.correos.gob.bo:18100/api/paquetes-contactos',
  token:
    process.env.PAQUETES_CONTACTOS_API_TOKEN?.trim() ??
    process.env.TRACKING_SQLSERVER_TOKEN?.trim() ??
    process.env.TRACKING_API_TOKEN?.trim() ??
    'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJodHRwOlwvXC9kZXYuY29ycmVvcy5nb2IuYm86MTgxMDAiLCJhdWQiOiJib2xpcG9zdC1kaXJlY2Npb25lcy1kZXN0aW5vIiwic3ViIjoiMiIsImp0aSI6IjhiMmM1YzM0YzFkZDkxODU3MTQ5Y2Q1YmVlYTM4M2MzYmMwMjMxOGJkYWI1NzRiZmFmNDgzYjAyMGRmN2Y1MmQiLCJuYW1lIjoiUG9zdG1hbiBwYXF1ZXRlcyBjb250YWN0b3MiLCJpYXQiOjE3ODczMzMxOTR9._6br-DyMNSkMen2NN2qBUouWjRlwk6A6KlUaYN1xcEQ',
})

const reloadLocalEnv = () => {
  try {
    dotenv.config({
      path: path.join(__dirname, '..', '..', '.env'),
      override: true,
    })
  } catch {
    // ignore env reload errors
  }
}

const sessions = new Map()
let initializationError = null

const getLogFilePath = () =>
  path.join(logsStorageDir, `app-${new Date().toISOString().slice(0, 10)}.log`)

const writeSystemLog = async ({
  level = 'info',
  event,
  request = null,
  statusCode = null,
  durationMs = null,
  details = {},
}) => {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    event,
    method: request?.method ?? null,
    path: request?.originalUrl ?? request?.path ?? null,
    statusCode,
    durationMs,
    userId: request?.session?.id ?? null,
    ipAddress: request?.ip ?? null,
    details,
  }

  try {
    await mkdir(logsStorageDir, { recursive: true })
    await appendFile(getLogFilePath(), `${JSON.stringify(entry)}\n`, 'utf8')
  } catch (error) {
    console.error('No se pudo escribir el log en archivo:', error.message)
  }

  try {
    await pool.query(
      `
        insert into system_logs (
          level, event, method, path, status_code, duration_ms, user_id, ip_address, details
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb);
      `,
      [
        entry.level,
        entry.event,
        entry.method,
        entry.path,
        entry.statusCode,
        entry.durationMs,
        entry.userId,
        entry.ipAddress,
        JSON.stringify(entry.details),
      ],
    )
  } catch (error) {
    console.error('No se pudo guardar el log en PostgreSQL:', error.message)
  }
}

const hashPassword = (password) =>
  crypto.scryptSync(password, 'crm-integrador-salt', 64).toString('hex')

const createSession = (user) => {
  const token = crypto.randomBytes(24).toString('hex')
  sessions.set(token, {
    id: user.id,
    fullName: user.full_name,
    email: user.email,
    role: user.role_name,
    createdAt: new Date().toISOString(),
  })
  return token
}

const sanitizeUser = (user) => ({
  id: user.id,
  fullName: user.full_name,
  email: user.email,
  role: user.role_name,
})

const sanitizeManagedUser = (user) => ({
  id: user.id,
  fullName: user.full_name,
  email: user.email,
  role: user.role_name,
  createdAt: user.created_at,
})

const getBearerToken = (request) => {
  const authHeader = request.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) return null
  return authHeader.slice('Bearer '.length)
}

const authMiddleware = (request, response, next) => {
  const token = getBearerToken(request)

  if (!token || !sessions.has(token)) {
    response.status(401).json({ message: 'Sesion no valida. Inicia sesion nuevamente.' })
    return
  }

  request.session = sessions.get(token)
  request.sessionToken = token
  next()
}

const fetchJsonWithTimeout = async (url, options = {}, timeoutMs = 15000) => {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeoutId)
  }
}

app.get('/api/tracking/paquetes', cors(), authMiddleware, async (request, response) => {
  try {
    reloadLocalEnv()
    const trackingApiDefaults = getTrackingApiDefaults()

    if (String(request.query.all ?? '').trim() === '1') {
      const allItems = []
      const seenKeys = new Set()
      const pageSize = 12
      const maxPages = 500

      for (let page = 1; page <= maxPages; page += 1) {
        const upstreamUrl = new URL('/api/tracking/paquetes', trackingApiDefaults.baseUrl)
        upstreamUrl.searchParams.set('page', String(page))
        upstreamUrl.searchParams.set('per_page', String(pageSize))

        const upstreamResponse = await fetchJsonWithTimeout(upstreamUrl, {
          headers: {
            Authorization: `Bearer ${trackingApiDefaults.token}`,
            Accept: 'application/json',
          },
        })

        if (!upstreamResponse.ok) {
          const rawBody = await upstreamResponse.text()
          let payload = null

          try {
            payload = rawBody ? JSON.parse(rawBody) : null
          } catch {
            payload = { raw: rawBody }
          }

          response.status(upstreamResponse.status).json(payload)
          return
        }

        const payload = await upstreamResponse.json().catch(() => null)
        const pageItems = Array.isArray(payload?.data) ? payload.data : []
        if (!pageItems.length) {
          break
        }

        for (const item of pageItems) {
          const catalogKey = String(item?.mailitm_pid ?? item?.codigo_s10 ?? item?.codigo ?? '').trim()
          if (!catalogKey || seenKeys.has(catalogKey)) {
            continue
          }

          seenKeys.add(catalogKey)
          allItems.push(item)
        }
      }

      allItems.sort((firstItem, secondItem) => {
        const firstDate = Date.parse(
          String(firstItem?.fecha_registro ?? firstItem?.eventos?.[0]?.fecha ?? '').trim(),
        )
        const secondDate = Date.parse(
          String(secondItem?.fecha_registro ?? secondItem?.eventos?.[0]?.fecha ?? '').trim(),
        )

        if (Number.isFinite(firstDate) && Number.isFinite(secondDate) && firstDate !== secondDate) {
          return firstDate - secondDate
        }

        return String(firstItem?.codigo_s10 ?? firstItem?.codigo ?? '').localeCompare(
          String(secondItem?.codigo_s10 ?? secondItem?.codigo ?? ''),
          'es',
        )
      })

      response.json({
        data: allItems,
        total: allItems.length,
        paginacion: {
          total_registros: allItems.length,
          ultima_pagina: 1,
          pagina_actual: 1,
          por_pagina: allItems.length || 1,
          per_page: allItems.length || 1,
        },
      })
      return
    }

    const upstreamUrl = new URL('/api/tracking/paquetes', trackingApiDefaults.baseUrl)
    const searchParams = new URLSearchParams()

    for (const [key, value] of Object.entries(request.query)) {
      if (Array.isArray(value)) {
        if (value[0] != null) {
          searchParams.set(key, String(value[0]))
        }
        continue
      }

      if (value != null) {
        searchParams.set(key, String(value))
      }
    }

    upstreamUrl.search = searchParams.toString()

    const upstreamResponse = await fetchJsonWithTimeout(upstreamUrl, {
      headers: {
        Authorization: `Bearer ${trackingApiDefaults.token}`,
        Accept: 'application/json',
      },
    })

    const rawBody = await upstreamResponse.text()
    let payload = null

    try {
      payload = rawBody ? JSON.parse(rawBody) : null
    } catch {
      payload = { raw: rawBody }
    }

    response.status(upstreamResponse.status).json(payload)
  } catch (error) {
    response.status(502).json({
      error: 'No se pudo consultar la API de tracking.',
      message: error instanceof Error ? error.message : 'Error desconocido.',
    })
  }
})

app.get('/api/internacionales/paquetes-contactos', cors(), authMiddleware, async (request, response) => {
  try {
    reloadLocalEnv()
    const contactPackagesApiDefaults = getContactPackagesApiDefaults()
    const upstreamUrl = new URL(contactPackagesApiDefaults.endpoint)
    const searchParams = new URLSearchParams()

    for (const [key, value] of Object.entries(request.query)) {
      if (Array.isArray(value)) {
        if (value[0] != null) {
          searchParams.set(key, String(value[0]))
        }
        continue
      }

      if (value != null) {
        searchParams.set(key, String(value))
      }
    }

    upstreamUrl.search = searchParams.toString()

    const upstreamResponse = await fetchJsonWithTimeout(upstreamUrl, {
      headers: {
        Authorization: `Bearer ${contactPackagesApiDefaults.token}`,
        Accept: 'application/json',
      },
    })

    const rawBody = await upstreamResponse.text()
    let payload = null

    try {
      payload = rawBody ? JSON.parse(rawBody) : null
    } catch {
      payload = { raw: rawBody }
    }

    response.status(upstreamResponse.status).json(payload)
  } catch (error) {
    response.status(502).json({
      error: 'No se pudo consultar la API de paquetes-contactos.',
      message: error instanceof Error ? error.message : 'Error desconocido.',
    })
  }
})

const normalizeReference = (value) => String(value ?? '').trim()
const normalizePhoneNumber = (value) => normalizeReference(value).replace(/[^\d]/g, '')
const normalizeBoliviaTestNumber = (value) => {
  const digits = normalizePhoneNumber(value)

  if (digits.length === 8) {
    return `591${digits}`
  }

  if (digits.length === 11 && digits.startsWith('591')) {
    return digits
  }

  return digits
}
const getBoliviaTestNumberCandidates = (value) => {
  const canonical = normalizeBoliviaTestNumber(value)

  if (!canonical) {
    return []
  }

  const candidates = new Set([canonical])

  if (canonical.startsWith('591') && canonical.length === 11) {
    candidates.add(canonical.slice(3))
  }

  return [...candidates]
}
const normalizeBoolean = (value, fallback = false) => {
  if (typeof value === 'boolean') return value
  const normalized = normalizeReference(value).toLowerCase()
  if (normalized === 'true') return true
  if (normalized === 'false') return false
  return fallback
}

const ensureMediaStorageDir = async () => {
  await mkdir(mediaStorageDir, { recursive: true })
}

const getMediaKindFromMimeType = (mimeType) => {
  if (mimeType.startsWith('image/')) {
    return 'image'
  }

  if (mimeType.startsWith('audio/')) {
    return 'audio'
  }

  return 'file'
}

const getMediaExtensionFromMimeType = (mimeType) => {
  if (mimeType === 'image/jpeg') return '.jpg'
  if (mimeType === 'image/png') return '.png'
  if (mimeType === 'image/webp') return '.webp'
  if (mimeType === 'audio/ogg') return '.ogg'
  if (mimeType === 'audio/mpeg') return '.mp3'
  if (mimeType === 'audio/mp4') return '.m4a'
  if (mimeType === 'audio/amr') return '.amr'
  return ''
}

const sanitizeMediaFilename = (value) =>
  normalizeReference(value)
    .replace(/[^\w.-]+/g, '_')
    .replace(/^_+|_+$/g, '')

const saveMediaBufferToDisk = async ({ buffer, mimeType, originalName, prefix }) => {
  await ensureMediaStorageDir()

  const safePrefix = sanitizeMediaFilename(prefix || 'media')
  const safeOriginalName = sanitizeMediaFilename(originalName || '')
  const extension = getMediaExtensionFromMimeType(normalizeReference(mimeType)) || path.extname(safeOriginalName)
  const filename = `${safePrefix}-${crypto.randomUUID()}${extension || ''}`
  const absolutePath = path.join(mediaStorageDir, filename)

  await writeFile(absolutePath, buffer)

  return {
    filename,
    absolutePath,
    mediaUrl: `/media/${encodeURIComponent(filename)}`,
  }
}

const getWebhookMediaDescriptor = (message) => {
  const mediaTypes = ['image', 'audio']

  for (const type of mediaTypes) {
    const media = message?.[type]
    if (!media || typeof media !== 'object') {
      continue
    }

    const mediaId = normalizeReference(media.id)
    if (!mediaId) {
      continue
    }

    return {
      kind: type,
      mediaId,
      mimeType: normalizeReference(media.mime_type),
      caption: normalizeReference(media.caption),
    }
  }

  return null
}

const downloadWhatsAppMedia = async ({ accessToken, apiVersion, phoneNumberId, mediaId }) => {
  const metadataEndpoint = `https://graph.facebook.com/${apiVersion}/${mediaId}?phone_number_id=${phoneNumberId}`
  const metadataResponse = await fetch(metadataEndpoint, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })

  const metadata = await metadataResponse.json().catch(() => null)

  if (!metadataResponse.ok) {
    throw new Error(
      metadata?.error?.message ||
        metadata?.error?.error_user_msg ||
        metadata?.message ||
        'No se pudo obtener el archivo multimedia de WhatsApp.',
    )
  }

  if (!metadata?.url) {
    throw new Error('WhatsApp no devolvio una URL de descarga para el archivo multimedia.')
  }

  const downloadResponse = await fetch(metadata.url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })

  if (!downloadResponse.ok) {
    throw new Error('No se pudo descargar el archivo multimedia desde WhatsApp.')
  }

  const arrayBuffer = await downloadResponse.arrayBuffer()
  const mimeType = normalizeReference(metadata.mime_type) || 'application/octet-stream'

  return {
    buffer: Buffer.from(arrayBuffer),
    mimeType,
    filename: normalizeReference(metadata.filename) || `${mediaId}${getMediaExtensionFromMimeType(mimeType)}`,
  }
}

const parsePhoneNumberCandidate = (value) => {
  const digits = normalizePhoneNumber(value)

  if (!digits) {
    return null
  }

  return (
    parsePhoneNumberFromString(digits, 'BO') ??
    parsePhoneNumberFromString(`+${digits}`)
  )
}

const isCellPhoneNumber = (value) => {
  const phoneNumber = parsePhoneNumberCandidate(value)

  if (!phoneNumber) {
    return false
  }

  const phoneType = phoneNumber.getType?.()
  return phoneType === 'MOBILE' || phoneType === 'FIXED_LINE_OR_MOBILE'
}

const getWhatsAppNumberCandidates = (value) => {
  const digits = normalizePhoneNumber(value)
  const candidates = new Set()

  if (digits) {
    candidates.add(digits)
  }

  const phoneNumber = parsePhoneNumberCandidate(value)

  if (phoneNumber?.isPossible()) {
    candidates.add(phoneNumber.number.replace(/[^\d]/g, ''))
    candidates.add(`${phoneNumber.countryCallingCode}${phoneNumber.nationalNumber}`)
  }

  return [...candidates]
}

const normalizeWhatsAppReference = (value) => {
  const phoneNumber = parsePhoneNumberCandidate(value)

  if (phoneNumber?.isPossible()) {
    return phoneNumber.number
  }

  const digits = normalizePhoneNumber(value)
  return digits ? `+${digits}` : ''
}

const whatsappReferencesMatch = (firstValue, secondValue) => {
  const firstCandidates = new Set(getWhatsAppNumberCandidates(firstValue))
  return getWhatsAppNumberCandidates(secondValue).some((candidate) => firstCandidates.has(candidate))
}

const maskToken = (value) => {
  const token = normalizeReference(value)
  if (!token) return ''
  if (token.length <= 8) return '********'
  return `${token.slice(0, 4)}...${token.slice(-4)}`
}

const resolveWhatsAppReference = (contact) => {
  const profiles = Array.isArray(contact?.social_profiles) ? contact.social_profiles : []
  const whatsappProfile = profiles.find(
    (profile) => normalizeReference(profile?.channel).toLowerCase() === 'whatsapp',
  )

  return whatsappProfile?.reference ? normalizeReference(whatsappProfile.reference) : null
}

const findContactByWhatsAppReference = async (reference, client = pool) => {
  const normalizedNumber = normalizePhoneNumber(reference)

  if (!normalizedNumber) {
    return null
  }

  const result = await client.query(
    `
      select id, name, company, social_profiles
      from contacts
      where exists (
        select 1
        from jsonb_array_elements(social_profiles) as profile
        where lower(coalesce(profile->>'channel', '')) = 'whatsapp'
          and regexp_replace(coalesce(profile->>'reference', ''), '[^0-9]', '', 'g') = $1
      )
      order by id asc
      limit 1;
    `,
    [normalizedNumber],
  )

  if (result.rows[0]) {
    return result.rows[0]
  }

  const fallbackResult = await client.query(
    `
      select id, name, company, social_profiles
      from contacts
      where exists (
        select 1
        from jsonb_array_elements(social_profiles) as profile
        where lower(coalesce(profile->>'channel', '')) = 'whatsapp'
      )
      order by id asc;
    `,
  )

  return (
    fallbackResult.rows.find((contact) => {
      const whatsappReference = resolveWhatsAppReference(contact)
      return whatsappReferencesMatch(reference, whatsappReference)
    }) ?? null
  )
}

const linkOrphanWhatsAppMessages = async (contactId, reference, client = pool) => {
  const numberCandidates = getWhatsAppNumberCandidates(reference)

  if (!contactId || numberCandidates.length === 0) {
    return
  }

  await client.query(
    `
      update message_logs
      set contact_id = $1
      where contact_id is null
        and channel = 'WhatsApp'
        and regexp_replace(coalesce(recipient_reference, ''), '[^0-9]', '', 'g') = any($2::text[]);
    `,
    [contactId, numberCandidates],
  )
}

const ensureInboundWhatsAppContact = async (reference, client = pool) => {
  const normalizedNumber = normalizePhoneNumber(reference)

  if (!normalizedNumber) {
    return null
  }

  const existingContact = await findContactByWhatsAppReference(normalizedNumber, client)

  if (existingContact) {
    await client.query(
      `
        update contacts
        set updated_at = now()
        where id = $1;
      `,
      [existingContact.id],
    )

    await linkOrphanWhatsAppMessages(existingContact.id, normalizedNumber, client)

    return existingContact
  }

  const contactName = `WhatsApp ${normalizedNumber}`
  const whatsappReference = `+${normalizedNumber}`
  const result = await client.query(
    `
      insert into contacts (
        name,
        company,
        channel,
        social_profiles,
        segment,
        owner_name,
        status,
        score,
        updated_at
      )
      values ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, now())
      returning id, name, company, social_profiles;
    `,
    [
      contactName,
      '',
      'WhatsApp',
      JSON.stringify([{ channel: 'WhatsApp', reference: whatsappReference }]),
      'Sin segmento',
      'Camila',
      'Nuevo',
      80,
    ],
  )

  return result.rows[0] ?? null
}

const sanitizeWhatsAppConfig = (config) => ({
  phoneNumberId: normalizeReference(config.phoneNumberId),
  businessAccountId: normalizeReference(config.businessAccountId),
  apiVersion: normalizeReference(config.apiVersion) || whatsappDefaults.apiVersion,
  senderNumber: normalizeReference(config.senderNumber),
  testModeEnabled: normalizeBoolean(config.testModeEnabled, whatsappDefaults.testModeEnabled),
  testModeNumber:
    normalizeBoliviaTestNumber(config.testModeNumber) || normalizeBoliviaTestNumber(whatsappDefaults.testModeNumber),
  webhookVerifyToken: normalizeReference(config.webhookVerifyToken),
  hasAccessToken: Boolean(normalizeReference(config.accessToken)),
  accessTokenMask: maskToken(config.accessToken),
})

const getAcceptedWebhookVerifyTokens = (config) =>
  [
    normalizeReference(config?.webhookVerifyToken),
    normalizeReference(process.env.WHATSAPP_META_WEBHOOK_VERIFY_TOKEN),
    normalizeReference(process.env.WEBHOOK_VERIFY_TOKEN),
  ].filter(Boolean)

const getStoredWhatsAppConfig = async (client = pool) => {
  const result = await client.query(
    `
      select settings
      from integration_settings
      where integration_key = $1
      limit 1;
    `,
    ['whatsapp_meta'],
  )

  const settings = result.rows[0]?.settings ?? {}

  return {
    accessToken: normalizeReference(settings.accessToken) || whatsappDefaults.accessToken,
    phoneNumberId: normalizeReference(settings.phoneNumberId) || whatsappDefaults.phoneNumberId,
    businessAccountId:
      normalizeReference(settings.businessAccountId) || whatsappDefaults.businessAccountId,
    apiVersion: normalizeReference(settings.apiVersion) || whatsappDefaults.apiVersion,
    senderNumber: normalizeReference(settings.senderNumber) || whatsappDefaults.senderNumber,
    testModeEnabled: normalizeBoolean(settings.testModeEnabled, whatsappDefaults.testModeEnabled),
    testModeNumber:
      normalizeBoliviaTestNumber(settings.testModeNumber) || normalizeBoliviaTestNumber(whatsappDefaults.testModeNumber),
    webhookVerifyToken:
      normalizeReference(settings.webhookVerifyToken) || whatsappDefaults.webhookVerifyToken,
  }
}

const saveWhatsAppConfig = async (partialConfig) => {
  const currentConfig = await getStoredWhatsAppConfig()
  const nextConfig = {
    ...currentConfig,
    ...partialConfig,
  }

  await pool.query(
    `
      insert into integration_settings (integration_key, settings, updated_at)
      values ($1, $2::jsonb, now())
      on conflict (integration_key) do update
      set settings = excluded.settings,
          updated_at = now();
    `,
    ['whatsapp_meta', JSON.stringify(nextConfig)],
  )

  return nextConfig
}

const EmsStageKeys = ['received', 'transit', 'regional', 'courier', 'delivered']

const normalizeEmsStageOverrideKey = (value) => normalizeReference(value).toUpperCase()

const normalizeEmsStageOverrideValue = (value) => {
  const normalized = normalizeReference(value).toLowerCase()

  if (EmsStageKeys.includes(normalized)) {
    return normalized
  }

  return normalizeEmsStatus(normalized)
}

const normalizeEmsStageOverrideMap = (settings = {}) =>
  Object.entries(settings ?? {})
    .map(([key, value]) => [normalizeEmsStageOverrideKey(key), normalizeEmsStageOverrideValue(value)])
    .filter(([key, value]) => Boolean(key) && Boolean(value))
    .reduce((accumulator, [key, value]) => {
      accumulator[key] = value
      return accumulator
    }, {})

const getStoredEmsStageOverrides = async (client = pool) => {
  const result = await client.query(
    `
      select settings
      from integration_settings
      where integration_key = $1
      limit 1;
    `,
    ['crm_ems_stage_overrides'],
  )

  const settings = result.rows[0]?.settings ?? {}
  return normalizeEmsStageOverrideMap(settings)
}

const saveEmsStageOverrides = async (partialOverrides = {}) => {
  const currentOverrides = await getStoredEmsStageOverrides()
  const nextOverrides = {
    ...currentOverrides,
    ...normalizeEmsStageOverrideMap(partialOverrides),
  }

  await pool.query(
    `
      insert into integration_settings (integration_key, settings, updated_at)
      values ($1, $2::jsonb, now())
      on conflict (integration_key) do update
      set settings = excluded.settings,
          updated_at = now();
    `,
    ['crm_ems_stage_overrides', JSON.stringify(nextOverrides)],
  )

  return nextOverrides
}

const saveEmsStageOverride = async (packageCode, stage) => {
  const key = normalizeEmsStageOverrideKey(packageCode)
  const normalizedStage = normalizeEmsStageOverrideValue(stage)

  if (!key || !normalizedStage) {
    return getStoredEmsStageOverrides()
  }

  return saveEmsStageOverrides({ [key]: normalizedStage })
}

const extractTrackingApiPhoneCandidates = (item) => [
  item?.telefono,
  item?.phone,
  item?.numero_telefono,
  item?.numeroTelefono,
  item?.telefonos?.remitente,
  item?.telefonos?.destinatario,
  item?.origen?.telefono,
  item?.destino?.telefono,
].map(normalizePhoneNumber).filter(Boolean)

const extractContactPackagesPhoneCandidates = (item) => [
  item?.remitente?.telefono,
  item?.destinatario?.telefono,
  item?.origen?.telefono,
  item?.destino?.telefono,
].map(normalizePhoneNumber).filter(Boolean)

const getTrackingLatestEvent = (item) => {
  const events = Array.isArray(item?.eventos) ? item.eventos : []

  return events
    .slice()
    .sort((firstEvent, secondEvent) => {
      const firstTime = Date.parse(normalizeReference(firstEvent?.fecha))
      const secondTime = Date.parse(normalizeReference(secondEvent?.fecha))
      return (Number.isNaN(secondTime) ? 0 : secondTime) - (Number.isNaN(firstTime) ? 0 : firstTime)
    })[0] ?? null
}

const getPackageStageRank = (stage) => {
  if (stage === 'received') return 0
  if (stage === 'transit') return 1
  if (stage === 'regional') return 2
  if (stage === 'courier') return 3
  if (stage === 'delivered') return 4
  return -1
}

const inferTrackingPackageStage = (item) => {
  const latestEvent = getTrackingLatestEvent(item)
  const eventStage = normalizeEmsStatus(
    [
      latestEvent?.evento_api,
      latestEvent?.evento_original,
      latestEvent?.detalle,
      latestEvent?.movimiento_bolivia,
    ]
      .map(normalizeReference)
      .filter(Boolean)
      .join(' | '),
  )

  return eventStage ?? normalizeEmsStatus(item?.estado_postal) ?? 'received'
}

const getPackageLifecycleInstruction = (stage) => {
  if (stage === 'delivered') {
    return 'El paquete ya aparece entregado. Debes confirmar recepcion, cerrar el caso con tono cordial y solo ofrecer ayuda adicional si el cliente lo necesita.'
  }

  if (stage === 'transit') {
    return 'El paquete esta en transito o seguimiento. Debes informar el avance, mencionar la ubicacion o ultimo evento disponible y explicar el siguiente paso sin inventar fechas exactas.'
  }

  if (stage === 'regional') {
    return 'El paquete ya fue recibido en la ciudad o regional de destino. Debes informar que esta en el lugar de destino y explicar que pasara a reparto.'
  }

  if (stage === 'courier') {
    return 'El paquete esta con el cartero y va rumbo a su destino. Debes comunicar que se encuentra en reparto sin prometer un horario exacto.'
  }

  return 'El paquete fue recibido en origen, en admisiones o almacen. Debes confirmar que fue identificado y explicar que continuara su proceso de despacho.'
}

const getPackageContextDateValue = (value) => {
  const normalized = normalizeReference(value)
  if (!normalized) return 0

  const directTimestamp = Date.parse(normalized)
  if (Number.isFinite(directTimestamp)) {
    return directTimestamp
  }

  const normalizedForParse = normalized.replace(' ', 'T')
  const fallbackTimestamp = Date.parse(normalizedForParse)
  return Number.isFinite(fallbackTimestamp) ? fallbackTimestamp : 0
}

const getPackageLocationLabel = (value, fallback = 'Sin dato') => {
  if (typeof value === 'string') {
    return normalizeReference(value) || fallback
  }

  return normalizeReference(value?.nombre) || normalizeReference(value?.codigo) || fallback
}

const getPackageDepartmentLabel = (value, fallback = '') => {
  if (typeof value === 'string') {
    return fallback
  }

  return (
    normalizeReference(value?.departamento?.nombre) ||
    normalizeReference(value?.departamento?.descripcion) ||
    normalizeReference(value?.departamento) ||
    normalizeReference(value?.ciudad?.nombre) ||
    normalizeReference(value?.ciudad) ||
    normalizeReference(value?.regional?.nombre) ||
    normalizeReference(value?.regional) ||
    fallback
  )
}

const getTrackingDestinationAddress = (item) =>
  normalizeReference(item?.destinatario?.direccion) ||
  normalizeReference(item?.destino?.direccion) ||
  ''

const getTrackingDestinationPlace = (item) =>
  getPackageDepartmentLabel(item?.destino) ||
  normalizeReference(item?.destinatario?.direccion) ||
  getPackageLocationLabel(item?.destino, 'Sin destino')

const PACKAGE_CODE_STOP_WORDS = new Set([
  'CODIGO',
  'CODIGOES',
  'CODIGOSEGUIMIENTO',
  'SEGUIMIENTO',
  'TRACKING',
  'PAQUETE',
  'ENVIO',
  'MENSAJE',
  'NUMERO',
  'OFICIAL',
])

const extractPackageCodeCandidates = (messageBody) => {
  const normalized = normalizeReference(messageBody).toUpperCase()
  if (!normalized) return []

  const rawMatches = normalized.match(/[A-Z0-9]{8,30}/g) || []
  const uniqueCandidates = []
  const seen = new Set()

  for (const candidate of rawMatches) {
    const compactCandidate = candidate.replace(/[^A-Z0-9]/g, '')
    const digitCount = (compactCandidate.match(/\d/g) || []).length
    const letterCount = (compactCandidate.match(/[A-Z]/g) || []).length

    if (digitCount === 0) continue
    if (digitCount < 4 && compactCandidate.length < 10) continue
    if (letterCount === 0 && compactCandidate.length < 8) continue
    if (letterCount > 0 && compactCandidate.length < 10) continue
    if (PACKAGE_CODE_STOP_WORDS.has(compactCandidate)) continue
    if (seen.has(compactCandidate)) continue

    seen.add(compactCandidate)
    uniqueCandidates.push(compactCandidate)
  }

  return uniqueCandidates.sort((first, second) => second.length - first.length)
}

const extractPackageCode = (messageBody) => {
  return extractPackageCodeCandidates(messageBody)[0] || ''
}

const fetchMatchingPackageContext = async (reference, packageCode = '') => {
  const normalizedReference = normalizeReference(reference)
  const targetCandidates = new Set([
    normalizePhoneNumber(normalizedReference),
    ...getWhatsAppNumberCandidates(normalizedReference),
    ...getBoliviaTestNumberCandidates(normalizedReference),
  ].filter(Boolean))

  if (targetCandidates.size === 0) {
    return {
      matched: false,
      isTestModeNumber: false,
      stage: null,
      currentPackageCode: '',
      currentPackageUpdatedAt: 0,
      packageCodes: [],
      summaryText: '',
      lifecycleInstruction: '',
    }
  }

  reloadLocalEnv()

  const trackingApiDefaults = getTrackingApiDefaults()
  const trackingUrl = new URL('/api/tracking/paquetes', trackingApiDefaults.baseUrl)
  trackingUrl.searchParams.set('page', '1')
  trackingUrl.searchParams.set('per_page', '100')

  const contactPackagesApiDefaults = getContactPackagesApiDefaults()
  const contactUrl = new URL(contactPackagesApiDefaults.endpoint)
  contactUrl.searchParams.set('page', '1')
  contactUrl.searchParams.set('per_page', '100')

  const [trackingResponse, contactResponse] = await Promise.all([
    fetchJsonWithTimeout(trackingUrl, {
      headers: {
        Authorization: `Bearer ${trackingApiDefaults.token}`,
        Accept: 'application/json',
      },
    }).catch(() => null),
    fetchJsonWithTimeout(contactUrl, {
      headers: {
        Authorization: `Bearer ${contactPackagesApiDefaults.token}`,
        Accept: 'application/json',
      },
    }).catch(() => null),
  ])

  const [trackingPayload, contactPayload] = await Promise.all([
    trackingResponse?.ok ? trackingResponse.json().catch(() => null) : null,
    contactResponse?.ok ? contactResponse.json().catch(() => null) : null,
  ])

  const trackingItems = Array.isArray(trackingPayload?.data) ? trackingPayload.data : []
  const contactItems = Array.isArray(contactPayload?.data) ? contactPayload.data : []
  const stageOverrides = await getStoredEmsStageOverrides()

  const normalizedPackageCode = normalizeReference(packageCode).toUpperCase()
  const matchesCode = (item) => {
    if (!normalizedPackageCode) return true
    return [item?.codigo_s10, item?.codigo, item?.codigoSeguimiento, item?.tracking]
      .map(normalizeReference)
      .some((value) => value.toUpperCase() === normalizedPackageCode)
  }

  const matchingTrackingItems = trackingItems.filter(
    (item) =>
      normalizedPackageCode
        ? matchesCode(item)
        : extractTrackingApiPhoneCandidates(item).some((candidate) =>
            getBoliviaTestNumberCandidates(candidate).some((normalizedCandidate) => targetCandidates.has(normalizedCandidate)) ||
            targetCandidates.has(candidate),
          ),
  )

  const matchingContactItems = contactItems.filter(
    (item) =>
      normalizedPackageCode
        ? matchesCode(item)
        : extractContactPackagesPhoneCandidates(item).some((candidate) =>
            getBoliviaTestNumberCandidates(candidate).some((normalizedCandidate) => targetCandidates.has(normalizedCandidate)) ||
            targetCandidates.has(candidate),
          ),
  )

  const trackingPackageEntries = matchingTrackingItems.map((item) => {
    const latestEvent = getTrackingLatestEvent(item)
    const statusText =
      normalizeReference(item?.estado_postal) ||
      normalizeReference(latestEvent?.evento_api) ||
      normalizeReference(latestEvent?.evento_original) ||
      'Sin estado'
    const packageCode =
      normalizeReference(item?.codigo_s10) || normalizeReference(item?.codigo) || 'Sin codigo'
    const latestLocation =
      normalizeReference(latestEvent?.oficina) ||
      normalizeReference(latestEvent?.detalle) ||
      normalizeReference(latestEvent?.movimiento_bolivia) ||
      getPackageLocationLabel(item?.destino, 'Sin ubicacion') ||
      'Sin ubicacion'
    const originDepartment = getPackageDepartmentLabel(item?.origen)
    const destinationDepartment = getPackageDepartmentLabel(item?.destino)
    const destinationLabel = getTrackingDestinationPlace(item)
    const stage = inferTrackingPackageStage(item)
    const updatedAt =
      getPackageContextDateValue(latestEvent?.fecha) ||
      getPackageContextDateValue(item?.fecha_registro)

    return {
      code: packageCode,
      source: 'tracking',
      stage,
      updatedAt,
      originLabel: getPackageLocationLabel(item?.origen, 'Sin origen'),
      originDepartment,
      destinationLabel,
      destinationDepartment,
      summary: [
        `Tracking ${packageCode}`,
        `estado ${statusText}`,
        `origen ${getPackageLocationLabel(item?.origen, 'Sin origen')}`,
        originDepartment ? `departamento origen ${originDepartment}` : '',
        `destino ${destinationLabel}`,
        destinationDepartment ? `departamento destino ${destinationDepartment}` : '',
        `ultimo punto ${latestLocation}`,
        normalizeReference(latestEvent?.fecha) ? `fecha ${normalizeReference(latestEvent?.fecha)}` : '',
      ]
        .filter(Boolean)
        .join(' | '),
    }
  })

  const contactPackageEntries = matchingContactItems.map((item) => {
    const packageCode = normalizeReference(item?.codigo) || normalizeReference(item?.id) || 'Sin codigo'
    const originDepartment = getPackageDepartmentLabel(item?.origen)
    const destinationDepartment = getPackageDepartmentLabel(item?.destino)
    const destinationLabel =
      getPackageDepartmentLabel(item?.destino) ||
      getPackageLocationLabel(item?.destino, 'Sin destino') ||
      normalizeReference(item?.destinatario?.direccion)
    return {
      code: packageCode,
      source: 'contact',
      stage: 'received',
      updatedAt: getPackageContextDateValue(item?.fecha_registro),
      originLabel: getPackageLocationLabel(item?.origen, 'Sin origen'),
      originDepartment,
      destinationLabel,
      destinationDepartment,
      destinationAddress: normalizeReference(item?.destinatario?.direccion) || '',
      summary: [
        `Paquete-contacto ${packageCode}`,
        `tipo ${normalizeReference(item?.tipo) || 'Sin tipo'}`,
        `remitente ${normalizeReference(item?.remitente?.nombre) || 'Sin remitente'}`,
        `destinatario ${normalizeReference(item?.destinatario?.nombre) || 'Sin destinatario'}`,
        originDepartment ? `departamento origen ${originDepartment}` : '',
        `destino ${destinationLabel}`,
        destinationDepartment ? `departamento destino ${destinationDepartment}` : '',
        normalizeReference(item?.fecha_registro) ? `registro ${normalizeReference(item?.fecha_registro)}` : '',
      ]
        .filter(Boolean)
        .join(' | '),
    }
  })

  const trackingSummaries = trackingPackageEntries.slice(0, 3).map((entry) => entry.summary)
  const contactSummaries = contactPackageEntries.slice(0, 3).map((entry) => entry.summary)
  const packageEntries = [...trackingPackageEntries, ...contactPackageEntries]
  const latestPackageEntry =
    packageEntries
      .slice()
      .sort((firstEntry, secondEntry) => {
        if (secondEntry.updatedAt !== firstEntry.updatedAt) {
          return secondEntry.updatedAt - firstEntry.updatedAt
        }
        return getPackageStageRank(firstEntry.stage) - getPackageStageRank(secondEntry.stage)
      })[0] ?? null
  const relatedEntries = latestPackageEntry
    ? packageEntries.filter((entry) => entry.code === latestPackageEntry.code)
    : []
  const getEntrySpecificityScore = (entry) => {
    let score = 0
    if (normalizeReference(entry?.destinationDepartment)) score += 8
    if (normalizeReference(entry?.destinationAddress)) score += 4
    if (normalizeReference(entry?.destinationLabel)) score += 2
    if (entry?.source === 'contact') score += 3
    return score
  }
  const mostSpecificEntry =
    relatedEntries
      .slice()
      .sort((firstEntry, secondEntry) => getEntrySpecificityScore(secondEntry) - getEntrySpecificityScore(firstEntry))[0] ??
    latestPackageEntry
  const overrideStage =
    normalizedPackageCode && stageOverrides[normalizedPackageCode]
      ? stageOverrides[normalizedPackageCode]
      : latestPackageEntry?.code
        ? stageOverrides[normalizeReference(latestPackageEntry.code).toUpperCase()] ?? null
        : null
  const stage = overrideStage ?? mostSpecificEntry?.stage ?? latestPackageEntry?.stage ?? null

  const summarySections = []

  if (trackingSummaries.length > 0) {
    summarySections.push(`Tracking API:\n- ${trackingSummaries.join('\n- ')}`)
  }

  if (contactSummaries.length > 0) {
    summarySections.push(`Paquetes-Contactos API:\n- ${contactSummaries.join('\n- ')}`)
  }

  const testModeNumber = normalizeBoliviaTestNumber(whatsappDefaults.testModeNumber)
  const isTestModeNumber =
    targetCandidates.has(testModeNumber) || targetCandidates.has(testModeNumber?.replace(/^591/, '') || '')

  return {
    matched: matchingTrackingItems.length > 0 || matchingContactItems.length > 0,
    isTestModeNumber,
    stage,
    currentPackageCode: latestPackageEntry?.code ?? '',
    currentPackageUpdatedAt: latestPackageEntry?.updatedAt ?? 0,
    currentOriginLabel: mostSpecificEntry?.originLabel ?? latestPackageEntry?.originLabel ?? '',
    currentOriginDepartment: mostSpecificEntry?.originDepartment ?? latestPackageEntry?.originDepartment ?? '',
    currentDestinationLabel: mostSpecificEntry?.destinationLabel ?? latestPackageEntry?.destinationLabel ?? '',
    currentDestinationDepartment:
      mostSpecificEntry?.destinationDepartment ?? latestPackageEntry?.destinationDepartment ?? '',
    currentDestinationAddress: mostSpecificEntry?.destinationAddress ?? latestPackageEntry?.destinationAddress ?? '',
    packageCodes: [...new Set(packageEntries.map((entry) => entry.code).filter(Boolean))],
    summaryText: summarySections.join('\n\n'),
    lifecycleInstruction: getPackageLifecycleInstruction(stage),
  }
}

const isTestModeNumberListedInApis = async (targetNumber) => {
  const packageContext = await fetchMatchingPackageContext(targetNumber)
  return packageContext.matched
}

const getStoredAiAgentConfig = async (client = pool) => {
  const result = await client.query(
    `
      select settings
      from integration_settings
      where integration_key = $1
      limit 1;
    `,
    ['crm_ai_agent'],
  )

  const settings = result.rows[0]?.settings ?? {}
  const fallbackEnabled = process.env.AI_AUTO_REPLY === undefined ? true : process.env.AI_AUTO_REPLY !== 'false'
  const assistedContactIds = Array.isArray(settings.assistedContactIds)
    ? settings.assistedContactIds
        .map((value) => Number(value))
        .filter((value, index, values) => Number.isInteger(value) && value > 0 && values.indexOf(value) === index)
    : []

  return {
    enabled:
      typeof settings.enabled === 'boolean'
        ? settings.enabled
        : String(settings.enabled ?? '').toLowerCase() === 'true'
          ? true
          : fallbackEnabled,
    assistedContactIds,
  }
}

const saveAiAgentConfig = async (partialConfig) => {
  const currentConfig = await getStoredAiAgentConfig()
  const nextAssistedContactIds = Array.isArray(partialConfig.assistedContactIds)
    ? partialConfig.assistedContactIds
        .map((value) => Number(value))
        .filter((value, index, values) => Number.isInteger(value) && value > 0 && values.indexOf(value) === index)
    : currentConfig.assistedContactIds
  const nextConfig = {
    ...currentConfig,
    ...partialConfig,
    assistedContactIds: nextAssistedContactIds,
  }

  await pool.query(
    `
      insert into integration_settings (integration_key, settings, updated_at)
      values ($1, $2::jsonb, now())
      on conflict (integration_key) do update
      set settings = excluded.settings,
          updated_at = now();
    `,
    ['crm_ai_agent', JSON.stringify(nextConfig)],
  )

  return nextConfig
}

const validateWhatsAppConfig = (config) => {
  if (!normalizeReference(config.accessToken)) {
    return 'Configura el token de acceso permanente de Meta.'
  }

  if (!normalizeReference(config.phoneNumberId)) {
    return 'Configura el phone_number_id de WhatsApp Business.'
  }

  return null
}

const normalizeContactPayload = (body) => {
  const { name, company, channels, channelReferences, segment, owner, status, score } = body ?? {}

  const normalizedChannels = Array.isArray(channels)
    ? channels.filter((channel) => typeof channel === 'string' && channel.trim().length > 0)
    : []

  const socialProfiles = normalizedChannels.map((channel) => ({
    channel,
    reference:
      normalizeReference(channel).toLowerCase() === 'whatsapp'
        ? normalizeWhatsAppReference(channelReferences?.[channel])
        : typeof channelReferences?.[channel] === 'string'
          ? channelReferences[channel].trim()
          : '',
  }))

  return {
    name: normalizeReference(name),
    company: normalizeReference(company),
    segment: normalizeReference(segment),
    owner: normalizeReference(owner),
    status: normalizeReference(status),
    score,
    normalizedChannels,
    socialProfiles,
  }
}

const escapeSql = (value) => String(value ?? '').replaceAll("'", "''")

const normalizeGroupColor = (value) => {
  const color = normalizeReference(value)
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#0f6b60'
}

const formatGroupMessage = (template, contact) =>
  String(template ?? '')
    .replaceAll('{{name}}', normalizeReference(contact?.name))
    .replaceAll('{{company}}', normalizeReference(contact?.company))
    .replaceAll('{{owner}}', normalizeReference(contact?.owner_name))
    .replaceAll('{{segment}}', normalizeReference(contact?.segment))

const getContactGroups = async (client = pool) => {
  const result = await client.query(
    `
      select
        g.id,
        g.name,
        g.description,
        g.color,
        count(m.contact_id)::int as member_count,
        coalesce(
          jsonb_agg(
            distinct jsonb_build_object(
              'id', c.id,
              'name', c.name,
              'company', c.company
            )
          ) filter (where c.id is not null),
          '[]'::jsonb
        ) as members
      from contact_groups g
      left join contact_group_members m on m.group_id = g.id
      left join contacts c on c.id = m.contact_id
      group by g.id, g.name, g.description, g.color
      order by g.updated_at desc, g.id desc;
    `,
  )

  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    color: row.color,
    memberCount: row.member_count,
    members: row.members ?? [],
  }))
}

const uploadWhatsAppMedia = async ({ accessToken, apiVersion, phoneNumberId, file }) => {
  const endpoint = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/media`
  const formData = new FormData()
  formData.append('messaging_product', 'whatsapp')
  formData.append(
    'file',
    new Blob([file.buffer], { type: file.mimetype }),
    file.originalname || 'media',
  )

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    body: formData,
  })

  const payload = await response.json().catch(() => null)

  if (!response.ok) {
    throw new Error(
      payload?.error?.message ||
        payload?.error?.error_user_msg ||
        payload?.message ||
        'No se pudo cargar el archivo multimedia en WhatsApp.',
    )
  }

  return payload
}

const sendWhatsAppCloudMessage = async ({
  accessToken,
  apiVersion,
  phoneNumberId,
  to,
  body,
  media,
}) => {
  const endpoint = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`
  let messagePayload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: {
      body,
      preview_url: false,
    },
  }

  if (media) {
    const uploadedMedia = await uploadWhatsAppMedia({
      accessToken,
      apiVersion,
      phoneNumberId,
      file: media.file,
    })

    if (!uploadedMedia?.id) {
      throw new Error('WhatsApp no devolvio el identificador del archivo subido.')
    }

    if (media.kind === 'image') {
      messagePayload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'image',
        image: {
          id: uploadedMedia.id,
          ...(body ? { caption: body } : {}),
        },
      }
    } else if (media.kind === 'audio') {
      messagePayload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'audio',
        audio: {
          id: uploadedMedia.id,
        },
      }
    } else {
      throw new Error('Tipo de media no soportado.')
    }
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(messagePayload),
  })

  const raw = await response.text()
  let payload = null

  try {
    payload = raw ? JSON.parse(raw) : null
  } catch {
    payload = raw ? { raw } : null
  }

  if (!response.ok) {
    const apiMessage =
      payload?.error?.error_user_msg ||
      payload?.error?.message ||
      payload?.raw ||
      'Meta rechazo el envio del mensaje.'

    throw new Error(apiMessage)
  }

  return payload
}

const getWebhookMessageBody = (message) => {
  const mediaDescriptor = getWebhookMediaDescriptor(message)

  if (mediaDescriptor?.caption) {
    return mediaDescriptor.caption
  }

  if (mediaDescriptor?.kind === 'image') {
    return '[image]'
  }

  if (mediaDescriptor?.kind === 'audio') {
    return '[audio]'
  }

  if (typeof message?.text?.body === 'string' && message.text.body.trim()) {
    return message.text.body.trim()
  }

  if (typeof message?.button?.text === 'string' && message.button.text.trim()) {
    return message.button.text.trim()
  }

  if (typeof message?.interactive?.button_reply?.title === 'string' && message.interactive.button_reply.title.trim()) {
    return message.interactive.button_reply.title.trim()
  }

  if (typeof message?.interactive?.list_reply?.title === 'string' && message.interactive.list_reply.title.trim()) {
    return message.interactive.list_reply.title.trim()
  }

  if (typeof message?.type === 'string' && message.type.trim()) {
    return `[${message.type.trim()}]`
  }

  return ''
}

const getAiConfig = () => ({
  baseUrl: normalizeReference(process.env.AI_BASE_URL) || aiDefaults.baseUrl,
  model: normalizeReference(process.env.AI_MODEL) || aiDefaults.model,
  systemPrompt: normalizeReference(process.env.AI_SYSTEM_PROMPT) || aiDefaults.systemPrompt,
})

const getAvailableAiModels = async (baseUrl) => {
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/tags`)

  if (!response.ok) {
    throw new Error('No se pudo consultar la lista de modelos disponibles en Ollama.')
  }

  const payload = await response.json().catch(() => null)

  return Array.isArray(payload?.models)
    ? payload.models
        .map((model) => normalizeReference(model?.name))
        .filter(Boolean)
    : []
}

const resolveAiModel = async (config) => {
  const configuredModel = normalizeReference(config.model)
  const availableModels = await getAvailableAiModels(config.baseUrl)

  if (configuredModel && availableModels.includes(configuredModel)) {
    return configuredModel
  }

  if (availableModels.length > 0) {
    console.warn(
      `El modelo de IA "${configuredModel || '(sin configurar)'}" no esta disponible. Se usara "${availableModels[0]}".`,
    )
    return availableModels[0]
  }

  return configuredModel
}

const buildAiConversationContext = (messages) =>
  messages
    .slice(-8)
    .map((message) => {
      const author = message.direction === 'inbound' ? 'Cliente' : 'Equipo CRM'
      return `${author}: ${normalizeReference(message.message_text ?? message.message)}`
    })
    .filter(Boolean)
    .join('\n')

const emsStatusToContactStatus = (emsStatus) => {
  if (emsStatus === 'transit') return 'En seguimiento'
  if (emsStatus === 'regional') return 'Recibido Destino'
  if (emsStatus === 'courier') return 'Cartero'
  if (emsStatus === 'delivered') return 'Activo'
  return 'Nuevo'
}

const getEmsStatusRank = (status) => {
  if (status === 'received') return 0
  if (status === 'transit') return 1
  if (status === 'regional') return 2
  if (status === 'courier') return 3
  if (status === 'delivered') return 4
  return 0
}

const normalizeEmsStatus = (value) => {
  const normalized = normalizeReference(value).toLowerCase()

  if (
    normalized.includes('cartero') ||
    normalized.includes('courier') ||
    normalized.includes('reparto') ||
    normalized.includes('distribucion') ||
    normalized.includes('distribución')
  ) {
    return 'courier'
  }

  if (normalized.includes('recibido destino') || normalized.includes('recibido regional')) {
    return 'regional'
  }

  if (
    normalized.includes('ventanilla') ||
    normalized.includes('almacen origen') ||
    normalized.includes('almacen') ||
    normalized.includes('almacén') ||
    normalized.includes('admis') ||
    normalized.includes('recepcion') ||
    normalized.includes('recibido origen') ||
    normalized.includes('sucursal de origen')
  ) {
    return 'received'
  }

  if (normalized === 'recibido' || normalized === 'recibida' || normalized === 'received') {
    return 'received'
  }

  if (
    normalized.includes('entregad') ||
    normalized.includes('entreg') ||
    normalized.includes('deliver') ||
    normalized.includes('csat') ||
    normalized.includes('cerrad') ||
    normalized.includes('activo') ||
    normalized.includes('complet')
  ) {
    return 'delivered'
  }

  if (
    normalized.includes('camino') ||
    normalized.includes('transit') ||
    normalized.includes('tránsito') ||
    normalized.includes('transito') ||
    normalized.includes('seguim') ||
    normalized.includes('aduan') ||
    normalized.includes('eta') ||
    normalized.includes('pendient') ||
    normalized.includes('vuelo')
  ) {
    return 'transit'
  }

  if (
    normalized.includes('received') ||
    normalized.includes('admis') ||
    normalized.includes('almacen') ||
    normalized.includes('almacén') ||
    normalized.includes('nuevo') ||
    normalized.includes('retenc') ||
    normalized.includes('inici') ||
    normalized.includes('pendient')
  ) {
    return 'received'
  }

  return null
}

const inferEmsStatusFromText = (text) => {
  const normalized = normalizeReference(text).toLowerCase()

  if (
    normalized.includes('entregad') ||
    normalized.includes('entregado') ||
    normalized.includes('ya lleg') ||
    normalized.includes('acaba de llegar') ||
    normalized.includes('acabo de llegar') ||
    normalized.includes('acaba lleg') ||
    normalized.includes('acabo de llegar') ||
    normalized.includes('acabado de llegar') ||
    normalized.includes('me llego') ||
    normalized.includes('me llego') ||
    normalized.includes('llego el paquete') ||
    normalized.includes('llego el paquete') ||
    normalized.includes('paquete lleg') ||
    normalized.includes('ya fue entreg') ||
    normalized.includes('entrega realizada') ||
    normalized.includes('llego') ||
    normalized.includes('llegar') ||
    normalized.includes('arribo') ||
    normalized.includes('arribo') ||
    normalized.includes('recibido') ||
    normalized.includes('gracias por confirmar') ||
    normalized.includes('cerramos') ||
    normalized.includes('5 estrellas')
  ) {
    return 'delivered'
  }

  if (
    normalized.includes('en camino') ||
    normalized.includes('transito') ||
    normalized.includes('transito') ||
    normalized.includes('aduana') ||
    normalized.includes('despacho') ||
    normalized.includes('eta') ||
    normalized.includes('vuelo') ||
    normalized.includes('seguimiento')
  ) {
    return 'transit'
  }

  if (
    normalized.includes('factura') ||
    normalized.includes('documento') ||
    normalized.includes('gu?a') ||
    normalized.includes('guia') ||
    normalized.includes('retenci?n') ||
    normalized.includes('retencion') ||
    normalized.includes('recib') ||
    normalized.includes('hola')
  ) {
    return 'received'
  }

  return null
}

const syncContactEmsStatus = async ({ contactId, currentContact = null, recentMessages = null } = {}) => {
  const resolvedContactId = Number(contactId)

  if (!Number.isInteger(resolvedContactId) || resolvedContactId <= 0) {
    return null
  }

  const contact =
    currentContact ??
    (await pool.query(
      `
        select id, name, company, segment, owner_name, status, social_profiles
        from contacts
        where id = $1
        limit 1;
      `,
      [resolvedContactId],
    )).rows[0]

  if (!contact) {
    return null
  }

  const messages =
    recentMessages ??
    (
      await pool.query(
        `
          select direction, message_text, created_at
          from message_logs
          where contact_id = $1
          order by created_at desc, id desc
          limit 8;
        `,
        [resolvedContactId],
      )
    ).rows

  const whatsappReference = resolveWhatsAppReference(contact)
  const packageContext = whatsappReference ? await fetchMatchingPackageContext(whatsappReference) : null

  const conversationContext = buildAiConversationContext(messages.slice().reverse())

  let inferredStatus = packageContext?.matched && packageContext.stage ? packageContext.stage : null

  inferredStatus = inferredStatus ?? inferEmsStatusFromText(conversationContext || contact.status) ?? 'received'

  const currentStage = normalizeEmsStatus(contact.status) || 'received'
  const nextStage =
    packageContext?.matched && packageContext.stage
      ? packageContext.stage
      : getEmsStatusRank(inferredStatus) >= getEmsStatusRank(currentStage)
        ? inferredStatus
        : currentStage

  const nextContactStatus = emsStatusToContactStatus(nextStage)
  if (nextContactStatus !== contact.status) {
    const updated = await pool.query(
      `
        update contacts
        set status = $1,
            updated_at = now()
        where id = $2
        returning id, status, updated_at;
      `,
      [nextContactStatus, resolvedContactId],
    )

    return updated.rows[0] ?? null
  }

  return {
    id: contact.id,
    status: contact.status,
  }
}

const buildFallbackAgentReply = ({ contact, messageBody, currentStatus, packageContext = null }) => {
  const normalizedMessage = normalizeReference(messageBody).toLowerCase()
  const contactName = normalizeReference(contact?.name) || 'Hola'
  const originText =
    normalizeReference(packageContext?.currentOriginDepartment) ||
    normalizeReference(packageContext?.currentOriginLabel)
  const destinationText =
    normalizeReference(packageContext?.currentDestinationDepartment) ||
    normalizeReference(packageContext?.currentDestinationLabel) ||
    normalizeReference(packageContext?.currentDestinationAddress)
  const isDeliveryQuestion =
    normalizedMessage.includes('llego') ||
    normalizedMessage.includes('llegó') ||
    normalizedMessage.includes('entregado') ||
    normalizedMessage.includes('paquete') ||
    normalizedMessage.includes('envio') ||
    normalizedMessage.includes('envío')
  const isGreetingOnly = isGreetingMessage(messageBody)
  const isPackageInquiry = isPackageInquiryMessage(messageBody)

  if (isGreetingOnly) {
    return `${getBoliviaDayGreeting()}. ¿En qué podemos ayudarle con su envío?`
  }

  if (isPackageInquiry && !hasPackageCode(messageBody)) {
    return 'Con mucho gusto le ayudo a consultar su paquete. ¿Podría indicarme el código de seguimiento, por favor?'
  }

  if (packageContext?.matched && packageContext.stage === 'delivered') {
    return `Perfecto, ${contactName}. Veo el paquete como entregado. Gracias por confirmarlo; si necesitas algo adicional, quedo atento para ayudarte.`
  }

  if (packageContext?.matched && packageContext.stage === 'transit') {
    return isDeliveryQuestion
      ? `Gracias, ${contactName}. Veo tu paquete en transito y con seguimiento activo. Te compartire la siguiente novedad apenas tengamos un nuevo movimiento confirmado.`
      : `Gracias por escribirnos, ${contactName}. Tu paquete sigue en transito y ya estamos monitoreando el avance para avisarte la siguiente actualizacion.`
  }

  if (packageContext?.matched && packageContext.stage === 'regional') {
    return `Su paquete ${packageContext.currentPackageCode || ''} ya se encuentra en nuestra sucursal de destino${destinationText ? `, ${destinationText}` : ''}. Le informaremos cuando pase a reparto.`
      .replace('  ', ' ')
  }

  if (packageContext?.matched && packageContext.stage === 'courier') {
    return `Su paquete ${packageContext.currentPackageCode || ''} está con el cartero y se dirige a su destino. Le informaremos cuando se confirme la entrega.`.replace('  ', ' ')
  }

  if (packageContext?.matched && packageContext.stage === 'received') {
    return `Gracias por escribirnos, ${contactName}. Ya identificamos tu paquete y figura como recibido en nuestra sucursal de origen${originText ? `, ${originText}` : ''}${destinationText ? `, con destino a ${destinationText}` : ''}. Te iremos guiando con la siguiente actualizacion disponible.`
  }

  if (currentStatus === 'Recibido Destino') {
    return `Tu paquete ya puede pasar a recoger su paquete en la sucursal de destino${destinationText ? `, ${destinationText}` : ''}.`
  }

  if (currentStatus === 'Nuevo') {
    return `Tu paquete fue recibido en nuestra sucursal de origen${originText ? `, ${originText}` : ''}${destinationText ? `, con destino a ${destinationText}` : ''}. En cuanto sea despachado, te compartimos la siguiente actualizacion.`
  }

  if (currentStatus === 'Activo' || currentStatus === 'Entregado') {
    return `¡Perfecto, ${contactName}! Gracias por avisarnos. Damos tu caso por entregado y quedamos atentos por si necesitas algo más.`
  }

  if (currentStatus === 'En seguimiento') {
    return isDeliveryQuestion
      ? `¡Gracias, ${contactName}! Veo tu paquete en seguimiento y ya estamos revisando el avance. Te confirmo apenas tengamos una actualización.`
      : `Gracias por escribirnos, ${contactName}. Ya estamos revisando tu envío y te compartiremos la actualización en cuanto avance.`
  }

  return `Gracias por escribirnos, ${contactName}. Estamos revisando tu caso y te responderemos con una actualización apenas la tengamos.`
}

const getBoliviaDayGreeting = () => {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      hour12: false,
      timeZone: 'America/La_Paz',
    }).format(new Date()),
  )

  if (hour >= 19 || hour < 6) {
    return 'Buenas noches'
  }

  if (hour >= 12) {
    return 'Buenas tardes'
  }

  return 'Buenos dias'
}

const isGreetingMessage = (messageBody) =>
  /^(?:(?:hola|buenas?)\s+)?(?:buenos?\s+(?:dias|días)|buenas?\s+(?:tardes|noches)|hola|buenas)[!.,?\s]*$/i.test(
    normalizeReference(messageBody),
  )

const isPackageInquiryMessage = (messageBody) => {
  const normalized = normalizeReference(messageBody).toLowerCase()
  return /\b(paquete|envio|envío|seguimiento|codigo|código|tracking|donde esta|dónde está|ubicacion|ubicación)\b/.test(
    normalized,
  )
}

const hasPackageCode = (messageBody) => {
  const normalized = normalizeReference(messageBody)
  return Boolean(extractPackageCode(normalized)) || /\b\d{8,}\b/.test(normalized)
}

const isClosingWhatsAppMessage = (messageBody) => {
  const normalized = normalizeReference(messageBody).toLowerCase()

  if (!normalized) {
    return false
  }

  return [
    'gracias',
    'muchas gracias',
    'esta bien',
    'está bien',
    'perfecto',
    'ok',
    'de acuerdo',
    'adios',
    'adiós',
    'hasta luego',
    'chao',
    'cerrado',
    'cerrar',
    'ya esta',
    'ya está',
    'listo',
    'todo bien',
    'no gracias',
  ].some((phrase) => normalized.includes(phrase))
}

const wait = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

const AUTO_REPLY_SETTLE_DELAY_MS = Number.parseInt(process.env.WHATSAPP_AUTO_REPLY_SETTLE_DELAY_MS || '2500', 10)
const WHATSAPP_REMINDER_INTERVAL_MS = Number.parseInt(
  process.env.WHATSAPP_REMINDER_INTERVAL_MS || String(2 * 60 * 60 * 1000),
  10,
)

const shouldSkipAutoReplyBecauseNewerInboundExists = async ({ contactId, sender, inboundMessageId }) => {
  if (!Number.isInteger(inboundMessageId) || inboundMessageId <= 0) {
    return false
  }

  await wait(Number.isFinite(AUTO_REPLY_SETTLE_DELAY_MS) ? Math.max(AUTO_REPLY_SETTLE_DELAY_MS, 0) : 2500)

  const newerInboundResult = await pool.query(
    `
      select id
      from message_logs
      where channel = 'WhatsApp'
        and direction = 'inbound'
        and id > $1
        and (
          contact_id = $2
          or regexp_replace(coalesce(recipient_reference, ''), '[^0-9]', '', 'g') = any($3::text[])
        )
      order by id asc
      limit 1;
    `,
    [inboundMessageId, contactId ?? -1, getWhatsAppNumberCandidates(sender)],
  )

  return Boolean(newerInboundResult.rows[0]?.id)
}

const shouldSkipAutoReplyBecauseCooldownIsActive = async ({ contactId, sender }) => {
  const outboundHistoryResult = await pool.query(
    `
      select created_at, message_text
      from message_logs
      where channel = 'WhatsApp'
        and direction = 'outbound'
        and (
          contact_id = $1
          or regexp_replace(coalesce(recipient_reference, ''), '[^0-9]', '', 'g') = any($2::text[])
        )
      order by created_at desc, id desc
      limit 1;
    `,
    [contactId ?? -1, getWhatsAppNumberCandidates(sender)],
  )

  const lastOutbound = outboundHistoryResult.rows[0] ?? null

  if (!lastOutbound?.created_at) {
    return false
  }

  const lastOutboundAt = new Date(lastOutbound.created_at).getTime()
  if (!Number.isFinite(lastOutboundAt)) {
    return false
  }

  if (Date.now() - lastOutboundAt < WHATSAPP_REMINDER_INTERVAL_MS) {
    return true
  }

  return isClosingWhatsAppMessage(lastOutbound.message_text)
}

const buildInitialPackageOutreachMessage = ({ contactName, packageContext }) => {
  const safeName = normalizeReference(contactName)
  const greeting = getBoliviaDayGreeting()
  const customerName = safeName ? `, ${safeName}` : ''
  return `${greeting}${customerName}. Soy Jaimito, del equipo de Correos de Bolivia. ¿En qué podemos ayudarle con su envío?`
}

const maybeStartTestModeConversation = async (request = null) => {
  await ensureDatabaseReady()

  const finishWithoutSending = async (reason, extraDetails = {}) => {
    await writeSystemLog({
      event: 'whatsapp_test_mode_auto_start_skipped',
      request,
      statusCode: 200,
      details: {
        reason,
        ...extraDetails,
      },
    }).catch(() => {})

    return { started: false, reason, ...extraDetails }
  }

  const config = await getStoredWhatsAppConfig()
  const configError = validateWhatsAppConfig(config)

  if (configError) {
    return finishWithoutSending('invalid-config', { detail: configError })
  }

  const testModeEnabled = normalizeBoolean(config.testModeEnabled, whatsappDefaults.testModeEnabled)
  if (!testModeEnabled) {
    return finishWithoutSending('test-mode-disabled')
  }

  const testModeNumber =
    normalizeBoliviaTestNumber(config.testModeNumber) || normalizeBoliviaTestNumber(whatsappDefaults.testModeNumber)

  if (!testModeNumber) {
    return finishWithoutSending('missing-test-number')
  }

  const packageContext = await fetchMatchingPackageContext(testModeNumber)
  if (!packageContext.matched) {
    return finishWithoutSending('number-not-found-in-apis', {
      recipient: normalizePhoneNumber(testModeNumber),
    })
  }

  const normalizedTarget = normalizePhoneNumber(testModeNumber)
  const contact =
    (await findContactByWhatsAppReference(normalizedTarget)) ??
    (await ensureInboundWhatsAppContact(normalizedTarget))

  if (!contact?.id) {
    return finishWithoutSending('contact-not-available', {
      recipient: normalizedTarget,
    })
  }

  const outboundHistoryResult = await pool.query(
    `
      select id, message_text, created_at
      from message_logs
      where channel = 'WhatsApp'
        and direction = 'outbound'
        and (
          contact_id = $1
          or regexp_replace(coalesce(recipient_reference, ''), '[^0-9]', '', 'g') = any($2::text[])
        )
      order by created_at desc, id desc;
    `,
    [contact.id, getWhatsAppNumberCandidates(normalizedTarget)],
  )

  const packageTimestamp = Number(packageContext.currentPackageUpdatedAt) || 0
  const alreadyStartedForCurrentPackage = outboundHistoryResult.rows.some((row) => {
    const messageText = normalizeReference(row.message_text)
    const outboundTimestamp = getPackageContextDateValue(row.created_at)

    if (!packageContext.currentPackageCode) {
      return packageTimestamp > 0 ? outboundTimestamp >= packageTimestamp : true
    }

    return messageText.includes(packageContext.currentPackageCode) && (
      packageTimestamp > 0 ? outboundTimestamp >= packageTimestamp : true
    )
  })

  if (alreadyStartedForCurrentPackage) {
    return finishWithoutSending('conversation-already-started', {
      contactId: contact.id,
      recipient: normalizedTarget,
      packageCode: packageContext.currentPackageCode,
      packageUpdatedAt: packageContext.currentPackageUpdatedAt,
    })
  }

  const outboundMessage = buildInitialPackageOutreachMessage({
    contactName: contact.name,
    packageContext,
  })

  const providerResponse = await sendWhatsAppCloudMessage({
    accessToken: config.accessToken,
    apiVersion: config.apiVersion,
    phoneNumberId: config.phoneNumberId,
    to: normalizedTarget,
    body: outboundMessage,
  })

  const providerMessageId =
    providerResponse?.messages?.[0]?.id ?? providerResponse?.message_id ?? null

  await pool.query(
    `
      insert into message_logs (
        contact_id,
        channel,
        direction,
        recipient_reference,
        message_text,
        provider_name,
        provider_message_id,
        status
      )
      values ($1, 'WhatsApp', 'outbound', $2, $3, 'Meta Cloud API', $4, 'sent');
    `,
    [contact.id, normalizedTarget, outboundMessage, providerMessageId],
  )

  await syncContactEmsStatus({
    contactId: contact.id,
  })

  await writeSystemLog({
    event: 'whatsapp_test_mode_auto_start',
    request,
    statusCode: 200,
    details: {
      contactId: contact.id,
      recipient: normalizedTarget,
      packageStage: packageContext.stage,
      providerMessageId,
    },
  })

  return {
    started: true,
    contactId: contact.id,
    recipient: normalizedTarget,
    packageStage: packageContext.stage,
    providerMessageId,
  }
}

const callOllamaGenerate = async ({ prompt }) => {
  const config = getAiConfig()
  const endpoint = `${config.baseUrl.replace(/\/$/, '')}/api/generate`
  const model = await resolveAiModel(config)

  if (!model) {
    throw new Error('No hay un modelo de IA disponible en Ollama.')
  }

  const response = await fetchJsonWithTimeout(
    endpoint,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        prompt,
        system: config.systemPrompt,
        stream: false,
      }),
    },
    12000,
  )

  const raw = await response.text()
  let payload = null

  try {
    payload = raw ? JSON.parse(raw) : null
  } catch {
    payload = raw ? { raw } : null
  }

  if (!response.ok) {
    throw new Error(payload?.error || payload?.raw || 'La IA local no respondio correctamente.')
  }

  return {
    model: payload?.model || model,
    response: normalizeReference(payload?.response),
  }
}

const SPANISH_LANGUAGE_HINTS = [
  'hola',
  'gracias',
  'buenos dias',
  'buenas tardes',
  'buenas noches',
  'por favor',
  'seguimiento',
  'paquete',
  'envio',
  'envío',
  'mensaje',
  'codigo',
  'código',
  'estado',
  'cliente',
  'necesito',
  'podria',
  'podría',
  'puede',
]

const FOREIGN_LANGUAGE_HINTS = [' the ', ' and ', ' you ', ' please ', ' hello ', ' thanks ', ' where ', ' shipment ', ' package ', ' tracking ', ' order ', ' merci ', ' danke ', ' bonjour ']

const looksLikeSpanishText = (text) => {
  const normalized = ` ${normalizeReference(text).toLowerCase().replace(/\s+/g, ' ')} `

  if (!normalized.trim()) {
    return true
  }

  if (/[áéíóúñü¿¡]/.test(normalized)) {
    return true
  }

  if (
    [
      'hola',
      'gracias',
      'buenas',
      'buenos dias',
      'buenas tardes',
      'buenas noches',
      'por favor',
      'claro',
      'perfecto',
      'si ',
      'sí ',
    ].some((token) => normalized.includes(` ${token} `) || normalized.trim().startsWith(token))
  ) {
    return true
  }

  const spanishHits = SPANISH_LANGUAGE_HINTS.reduce(
    (count, token) => count + (normalized.includes(` ${token} `) || normalized.includes(token) ? 1 : 0),
    0,
  )

  return spanishHits >= 2
}

const translateTextToSpanishForAi = async (text) => {
  const normalized = normalizeReference(text)
  if (!normalized) {
    return ''
  }

  if (looksLikeSpanishText(normalized)) {
    return normalized
  }

  try {
    const aiResult = await callOllamaGenerate({
      prompt: [
        'Traduce al español neutro el siguiente texto para un agente de WhatsApp.',
        'No expliques nada. Devuelve solo la traduccion final.',
        'Si el texto ya esta en español, devuelvelo sin cambios.',
        'Conserva nombres propios, codigos, numeros, fechas y URLs.',
        '',
        `Texto original:\n${normalized}`,
      ].join('\n'),
    })

    return normalizeReference(aiResult.response) || normalized
  } catch (error) {
    console.warn('No se pudo traducir el texto al español para la IA:', error.message)
    return normalized
  }
}

const autoReplyInboundWhatsAppMessage = async ({ contactId, sender, messageBody, inboundMessageId }) => {
  const agentConfig = await getStoredAiAgentConfig()
  const autoReplyEnabled =
    agentConfig.enabled || (Number.isInteger(contactId) && agentConfig.assistedContactIds.includes(contactId))

  if (!autoReplyEnabled) {
    await writeSystemLog({
      event: 'whatsapp_auto_reply_skipped',
      statusCode: 200,
      details: {
        reason: 'disabled',
        contactId: contactId ?? null,
        sender: normalizePhoneNumber(sender),
      },
    })
    return null
  }

  try {
    if (
      await shouldSkipAutoReplyBecauseNewerInboundExists({
        contactId,
        sender,
        inboundMessageId,
      })
    ) {
      await writeSystemLog({
        event: 'whatsapp_auto_reply_skipped',
        statusCode: 200,
        details: {
          reason: 'superseded-by-newer-inbound',
          contactId: contactId ?? null,
          sender: normalizePhoneNumber(sender),
          inboundMessageId: inboundMessageId ?? null,
        },
      })
      return null
    }

    if (isClosingWhatsAppMessage(messageBody)) {
      await writeSystemLog({
        event: 'whatsapp_auto_reply_skipped',
        statusCode: 200,
        details: {
          reason: 'conversation-closed',
          contactId: contactId ?? null,
          sender: normalizePhoneNumber(sender),
        },
      })
      return null
    }

    if (await shouldSkipAutoReplyBecauseCooldownIsActive({ contactId, sender })) {
      await writeSystemLog({
        event: 'whatsapp_auto_reply_skipped',
        statusCode: 200,
        details: {
          reason: 'cooldown-active',
          contactId: contactId ?? null,
          sender: normalizePhoneNumber(sender),
          cooldownMs: WHATSAPP_REMINDER_INTERVAL_MS,
        },
      })
      return null
    }

    await writeSystemLog({
      event: 'whatsapp_auto_reply_started',
      statusCode: 200,
      details: {
        contactId: contactId ?? null,
        sender: normalizePhoneNumber(sender),
      },
    })

    const config = await getStoredWhatsAppConfig()
    const accessToken = normalizeReference(config.accessToken)
    const phoneNumberId = normalizeReference(config.phoneNumberId)

    if (!accessToken || !phoneNumberId) {
      return null
    }

    let contact = null

    if (Number.isInteger(contactId) && contactId > 0) {
      const contactResult = await pool.query(
        `
          select id, name, company, segment, owner_name, status
          from contacts
          where id = $1
          limit 1;
        `,
        [contactId],
      )
      contact = contactResult.rows[0] ?? null
    }

    const recentMessagesResult = await pool.query(
      `
        select direction, message_text
        from message_logs
        where contact_id = $1
          and ($2::bigint is null or id <= $2::bigint)
        order by created_at desc, id desc
        limit 8;
      `,
      [contactId || -1, inboundMessageId ?? null],
    )

    await syncContactEmsStatus({
      contactId,
      currentContact: contact,
      recentMessages: recentMessagesResult.rows,
    })

    if (Number.isInteger(contactId) && contactId > 0) {
      const refreshedContactResult = await pool.query(
        `
          select id, name, company, segment, owner_name, status
          from contacts
          where id = $1
          limit 1;
        `,
        [contactId],
      )
      contact = refreshedContactResult.rows[0] ?? contact
    }

    const recentConversation = recentMessagesResult.rows
      .slice()
      .reverse()
      .map((row) => `${row.direction === 'inbound' ? 'Cliente' : 'Equipo'}: ${normalizeReference(row.message_text)}`)
      .filter(Boolean)
      .join('\n')

    const translatedMessageBody = await translateTextToSpanishForAi(messageBody)
    const translatedRecentConversation = await translateTextToSpanishForAi(recentConversation)

    const packageCode = extractPackageCode(messageBody)
    const packageContext = await fetchMatchingPackageContext(sender, packageCode)
    const isGreetingOnly = isGreetingMessage(translatedMessageBody)
    const isPackageInquiryWithoutCode = isPackageInquiryMessage(translatedMessageBody) && !hasPackageCode(messageBody)
    const packageCodeNotFound = Boolean(packageCode) && !packageContext.matched

    const prompt = [
      'Responde como una persona real, con tono cercano y natural.',
      'Prioriza respuestas cortas y fluidas para WhatsApp: 1 o 2 frases, maximo 32 palabras.',
      'Si el cliente saluda o inicia la conversacion, responde primero con un saludo cordial y formal, por ejemplo: "Buenos dias, ¿en que podemos ayudarle?".',
      'No menciones el paquete, su estado ni su ubicacion si el cliente solo esta saludando o no ha preguntado por el envio.',
      'Si pregunta por un paquete, envio, seguimiento o ubicacion y no proporciona un codigo de seguimiento, pide primero ese codigo. No consultes ni informes otro paquete por el numero de telefono.',
      'Si el cliente pregunta donde esta el paquete o hacia donde va, responde primero con el estado actual y luego con el destino o direccion disponible.',
      'Eres un agente de soporte y ventas para CRM Omnicanal.',
      'Primero ya se clasificó el contacto en EMS; ahora debes responder el mensaje con naturalidad.',
      'Tu tarea es responder mensajes de WhatsApp de forma breve, natural y profesional.',
      'Responde solo en español, en 2 o 3 frases como máximo y con no más de 40 palabras.',
      'Ve directo al punto: evita introducciones largas, listas y explicaciones innecesarias, pero conserva un saludo formal cuando corresponda.',
      'Responde únicamente lo que pregunta el cliente. Haz una sola pregunta final solo si necesitas aclarar algo.',
      '',
      contact
        ? `Contacto: ${contact.name || 'Sin nombre'}\nEmpresa: ${contact.company || 'No registrada'}\nSegmento: ${contact.segment || 'Sin segmento'}\nEstado: ${contact.status || 'Sin estado'}`
        : 'Contacto: Cliente de WhatsApp',
      packageContext.matched
        ? 'Existe contexto real del paquete obtenido desde las APIs internas. Debes usarlo para explicar la etapa del paquete y guiar la conversacion hasta el cierre, sin inventar ubicaciones ni fechas exactas.'
        : 'Si no hay datos de APIs, responde solo con el historial disponible.',
      packageContext.matched
        ? `Contexto del paquete para ${normalizeReference(sender)}:\n${packageContext.summaryText}\n\nRegla de etapa:\n${packageContext.lifecycleInstruction}`
        : '',
      '',
      translatedRecentConversation ? `Conversacion reciente:\n${translatedRecentConversation}` : 'No hay historial previo.',
      '',
      `Mensaje del cliente: ${translatedMessageBody}`,
      '',
      'Devuelve solo el texto final de la respuesta, sin comillas, sin explicaciones ni markdown.',
    ].join('\n')

    let finalReply = isGreetingOnly
      ? `${getBoliviaDayGreeting()}. Soy Jaimito, del equipo de Correos de Bolivia. ¿En qué podemos ayudarle?`
      : isPackageInquiryWithoutCode
        ? 'Con mucho gusto le ayudo a consultar su paquete. ¿Podría indicarme el código de seguimiento, por favor?'
        : packageCodeNotFound
          ? `No pude localizar el paquete ${packageCode}. Verifique el código e inténtelo nuevamente, por favor.`
          : packageCode && packageContext.matched
            ? buildFallbackAgentReply({
                contact,
                messageBody: translatedMessageBody,
                currentStatus: contact?.status ?? 'Nuevo',
                packageContext,
              })
        : ''

    try {
      if (!finalReply) {
        const aiReply = await callOllamaGenerate({ prompt })
        finalReply = aiReply.response
      }
    } catch (error) {
      console.warn('Ollama no respondio, se usara respuesta de respaldo:', error.message)
      await writeSystemLog({
        event: 'whatsapp_auto_reply_fallback',
        statusCode: 200,
        details: {
          contactId: contactId ?? null,
          sender: normalizePhoneNumber(sender),
          reason: error.message,
        },
      })
    }

    if (!finalReply) {
      finalReply = buildFallbackAgentReply({
        contact,
        messageBody: translatedMessageBody,
        currentStatus: contact?.status ?? 'Nuevo',
        packageContext,
      })
    }

    if (!finalReply) {
      return null
    }

    const response = await sendWhatsAppCloudMessage({
      accessToken,
      apiVersion: config.apiVersion,
      phoneNumberId,
      to: normalizePhoneNumber(sender),
      body: finalReply,
    })

    const providerMessageId = response?.messages?.[0]?.id ?? response?.message_id ?? null

    await pool.query(
      `
        insert into message_logs (
          contact_id,
          channel,
          direction,
          recipient_reference,
          message_text,
          provider_name,
          provider_message_id,
          status
        )
        values ($1, 'WhatsApp', 'outbound', $2, $3, 'Meta Cloud API', $4, 'sent');
      `,
      [contactId ?? null, normalizePhoneNumber(sender), finalReply, providerMessageId],
    )

    await syncContactEmsStatus({
      contactId,
    })

    await writeSystemLog({
      event: 'whatsapp_auto_reply_sent',
      statusCode: 200,
      details: {
        contactId: contactId ?? null,
        sender: normalizePhoneNumber(sender),
        providerMessageId,
      },
    })

    return { providerMessageId, response: finalReply }
  } catch (error) {
    console.error('No se pudo responder automaticamente con IA:', error.message)
    await writeSystemLog({
      event: 'whatsapp_auto_reply_failed',
      statusCode: 500,
      details: {
        contactId: contactId ?? null,
        sender: normalizePhoneNumber(sender),
        error: error.message,
      },
    })
    return null
  }
}

let autoReplyQueue = Promise.resolve()

const enqueueAutoReply = (job) => {
  const queuedJob = autoReplyQueue.then(() => autoReplyInboundWhatsAppMessage(job))

  autoReplyQueue = queuedJob.catch((error) => {
    console.error('Fallo un trabajo de la cola de respuestas IA:', error.message)
    return null
  })

  return autoReplyQueue
}

const persistInboundWhatsAppWebhook = async (payload) => {
  const entries = Array.isArray(payload?.entry) ? payload.entry : []
  const config = await getStoredWhatsAppConfig()

  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : []

    for (const change of changes) {
      const value = change?.value ?? {}
      const statuses = Array.isArray(value?.statuses) ? value.statuses : []
      const messages = Array.isArray(value?.messages) ? value.messages : []

      for (const statusItem of statuses) {
        const providerMessageId = normalizeReference(statusItem?.id)
        const normalizedStatus = normalizeReference(statusItem?.status).toLowerCase()
        const errorDetails = Array.isArray(statusItem?.errors)
          ? statusItem.errors
              .map((error) =>
                normalizeReference(error?.title) ||
                normalizeReference(error?.message) ||
                normalizeReference(error?.code),
              )
              .filter(Boolean)
              .join(' | ')
          : ''

        if (!providerMessageId || !normalizedStatus) {
          continue
        }

        const nextStatus =
          normalizedStatus === 'read'
            ? 'read'
            : normalizedStatus === 'delivered'
              ? 'delivered'
              : normalizedStatus === 'failed'
                ? 'failed'
                : 'sent'

        await pool.query(
          `
            update message_logs
            set status = $1,
                error_message = case
                  when $2 <> '' then $2
                  else error_message
                end
            where provider_message_id = $3;
          `,
          [nextStatus, errorDetails, providerMessageId],
        )

        await writeSystemLog({
          event: 'whatsapp_message_status',
          statusCode: 200,
          details: {
            providerMessageId,
            status: nextStatus,
            error: errorDetails || null,
          },
        }).catch(() => {})
      }

      for (const message of messages) {
        const from = normalizeReference(message?.from)
        const providerMessageId = normalizeReference(message?.id)
        const messageBody = getWebhookMessageBody(message)
        const mediaDescriptor = getWebhookMediaDescriptor(message)

        if (!from || !providerMessageId || !messageBody) {
          continue
        }

        const existing = await pool.query(
          `
            select id
            from message_logs
            where provider_message_id = $1
            limit 1;
          `,
          [providerMessageId],
        )

        if (existing.rows[0]) {
          continue
        }

        const matchedContact = await ensureInboundWhatsAppContact(from)
        let mediaDetails = null

        if (
          mediaDescriptor &&
          normalizeReference(config.accessToken) &&
          normalizeReference(config.phoneNumberId)
        ) {
          try {
            const downloadedMedia = await downloadWhatsAppMedia({
              accessToken: config.accessToken,
              apiVersion: config.apiVersion,
              phoneNumberId: config.phoneNumberId,
              mediaId: mediaDescriptor.mediaId,
            })

            mediaDetails = await saveMediaBufferToDisk({
              buffer: downloadedMedia.buffer,
              mimeType: downloadedMedia.mimeType || mediaDescriptor.mimeType || 'application/octet-stream',
              originalName: downloadedMedia.filename || mediaDescriptor.kind,
              prefix: `inbound-${providerMessageId}`,
            })
          } catch (error) {
            console.error('No se pudo descargar el media entrante:', error.message)
          }
        }

        const inboundLogResult = await pool.query(
          `
          insert into message_logs (
            contact_id,
            channel,
            direction,
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
          values ($1, 'WhatsApp', 'inbound', $2, $3, 'Meta Cloud API', $4, 'received', $5, $6, $7, $8)
          returning id;
          `,
          [
            matchedContact?.id ?? null,
            normalizePhoneNumber(from),
            messageBody,
            providerMessageId,
            mediaDetails?.mediaUrl ?? null,
            mediaDescriptor?.kind ?? null,
            mediaDescriptor?.mimeType || mediaDetails?.mimeType || null,
            mediaDetails?.filename ?? null,
          ],
        )

        void enqueueAutoReply({
          contactId: matchedContact?.id ?? null,
          sender: from,
          messageBody,
          inboundMessageId: inboundLogResult.rows[0]?.id ?? null,
        })

        await syncContactEmsStatus({
          contactId: matchedContact?.id ?? null,
          currentContact: matchedContact,
        })
      }
    }
  }
}

const seedData = async () => {
  const client = await pool.connect()

  try {
    await client.query(`
      insert into users (full_name, email, password_hash, role_name)
      values
        ('Gonzalo Fabris', 'gonzalo.fabris@correos.gob.bo', '${hashPassword('123456')}', 'Administradores'),
        ('Admin General', 'admin', '${hashPassword('admin')}', 'Administradores')
      on conflict (email) do update
      set
        full_name = excluded.full_name,
        password_hash = excluded.password_hash,
        role_name = excluded.role_name;
    `)

    await client.query(`
      insert into integration_settings (integration_key, settings)
      values (
        'whatsapp_meta',
        jsonb_build_object(
          'accessToken', '${escapeSql(whatsappDefaults.accessToken)}',
          'phoneNumberId', '${escapeSql(whatsappDefaults.phoneNumberId)}',
          'businessAccountId', '${escapeSql(whatsappDefaults.businessAccountId)}',
          'apiVersion', '${escapeSql(whatsappDefaults.apiVersion)}',
          'senderNumber', '${escapeSql(whatsappDefaults.senderNumber)}',
          'testModeEnabled', ${whatsappDefaults.testModeEnabled ? 'true' : 'false'},
          'testModeNumber', '${escapeSql(whatsappDefaults.testModeNumber)}',
          'webhookVerifyToken', '${escapeSql(whatsappDefaults.webhookVerifyToken)}'
        )
      )
      on conflict (integration_key) do nothing;
    `)
  } finally {
    client.release()
  }
}

const initializeDatabase = async () => {
  const initPath = path.join(__dirname, 'db', 'init.sql')
  const sql = await readFile(initPath, 'utf8')
  await pool.query(sql)
  await seedData()
}

const formatCurrency = (value) =>
  new Intl.NumberFormat('es-BO', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Number(value))

const formatRelativeDate = (dateString) => {
  const date = new Date(dateString)
  const diffMinutes = Math.round((Date.now() - date.getTime()) / 60000)

  if (diffMinutes < 60) return `Hace ${diffMinutes} min`
  if (diffMinutes < 1440) return `Hace ${Math.round(diffMinutes / 60)} h`
  return `Hace ${Math.round(diffMinutes / 1440)} d`
}

app.use(cors())
app.use(express.json())
app.use((request, response, next) => {
  const startedAt = Date.now()

  response.once('finish', () => {
    const statusCode = response.statusCode
    const level = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info'
    void writeSystemLog({
      level,
      event: 'request.completed',
      request,
      statusCode,
      durationMs: Date.now() - startedAt,
      details: {
        userAgent: request.get('user-agent') ?? null,
      },
    })
  })

  next()
})

const ensureDatabaseReady = async () => {
  if (initializationError) {
    throw initializationError
  }

  await initializationPromise

  if (initializationError) {
    throw initializationError
  }
}

app.get('/api/health', async (_request, response) => {
  try {
    await ensureDatabaseReady()
    await pool.query('select 1')
    response.json({ status: 'ok', date: '2026-08-14' })
  } catch (error) {
    response.status(500).json({ status: 'error', message: error.message })
  }
})

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
  const baseFilters = ['created_at >= now() - ($1 * interval \'1 hour\')']
  const baseParams = [hours]

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
          where ${whereClause}
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

app.get('/api/auth/session', authMiddleware, (request, response) => {
  response.json({ user: request.session })
})

app.post('/api/auth/logout', authMiddleware, (request, response) => {
  sessions.delete(request.sessionToken)
  response.json({ ok: true })
})

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
      emsStageOverrides,
    ] = await Promise.all([
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
          (
            select max(ml.created_at)
            from message_logs ml
            where (
              ml.contact_id = c.id
              or (
                regexp_replace(coalesce(ml.recipient_reference, ''), '[^0-9]', '', 'g') = (
                  select regexp_replace(coalesce(profile->>'reference', ''), '[^0-9]', '', 'g')
                  from jsonb_array_elements(c.social_profiles) as profile
                  where lower(coalesce(profile->>'channel', '')) = 'whatsapp'
                  limit 1
                )
              )
            )
          ) as last_message_at,
          (
            select max(ml.created_at)
            from message_logs ml
            where ml.direction = 'inbound'
              and (
                ml.contact_id = c.id
                or (
                  regexp_replace(coalesce(ml.recipient_reference, ''), '[^0-9]', '', 'g') = (
                    select regexp_replace(coalesce(profile->>'reference', ''), '[^0-9]', '', 'g')
                    from jsonb_array_elements(c.social_profiles) as profile
                    where lower(coalesce(profile->>'channel', '')) = 'whatsapp'
                    limit 1
                  )
                )
              )
          ) as last_inbound_at
          ,
          (
            select ml.message_text
            from message_logs ml
            where (
              ml.contact_id = c.id
              or (
                regexp_replace(coalesce(ml.recipient_reference, ''), '[^0-9]', '', 'g') = (
                  select regexp_replace(coalesce(profile->>'reference', ''), '[^0-9]', '', 'g')
                  from jsonb_array_elements(c.social_profiles) as profile
                  where lower(coalesce(profile->>'channel', '')) = 'whatsapp'
                  limit 1
                )
              )
            )
            order by ml.created_at desc, ml.id desc
            limit 1
          ) as last_message_text,
          (
            select ml.direction
            from message_logs ml
            where (
              ml.contact_id = c.id
              or (
                regexp_replace(coalesce(ml.recipient_reference, ''), '[^0-9]', '', 'g') = (
                  select regexp_replace(coalesce(profile->>'reference', ''), '[^0-9]', '', 'g')
                  from jsonb_array_elements(c.social_profiles) as profile
                  where lower(coalesce(profile->>'channel', '')) = 'whatsapp'
                  limit 1
                )
              )
            )
            order by ml.created_at desc, ml.id desc
            limit 1
          ) as last_message_direction
        from contacts c
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
      getStoredEmsStageOverrides(),
    ])

    const contacts = contactsResult.rows.map((row) => ({
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

    const deals = dealsResult.rows.map((row) => ({
      id: row.id,
      title: row.title,
      stage: row.stage,
      amount: formatCurrency(row.amount),
      owner: row.owner_name,
    }))

    const campaigns = campaignsResult.rows
    const agents = agentsResult.rows
    const socialContacts = contacts.filter((contact) => contact.channel !== 'Email').length
    const hotLeads = contacts.filter((contact) => contact.score >= 85).length
    const totalSales = dealsResult.rows.reduce((total, row) => total + Number(row.amount), 0)

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
      contactGroups,
      emsStageOverrides,
      integrations: defaultIntegrations,
      siteBlocks,
      channelConfig: {
        whatsapp: sanitizeWhatsAppConfig(whatsappConfig),
      },
    })
  } catch (error) {
    response.status(500).json({
      message: 'No se pudo cargar el dashboard desde PostgreSQL.',
      error: error.message,
    })
  }
})

app.get('/api/ems/stage-overrides', authMiddleware, async (_request, response) => {
  try {
    await ensureDatabaseReady()
    const overrides = await getStoredEmsStageOverrides()
    response.json({ ok: true, overrides })
  } catch (error) {
    response.status(500).json({
      message: 'No se pudo cargar el estado de los paquetes EMS.',
      error: error.message,
    })
  }
})

app.put('/api/ems/stage-overrides', authMiddleware, async (request, response) => {
  const packageCode = normalizeReference(request.body?.packageCode)
  const stage = normalizeEmsStageOverrideValue(request.body?.stage)

  if (!packageCode) {
    response.status(400).json({ message: 'Debes indicar el codigo del paquete.' })
    return
  }

  if (!['received', 'transit', 'regional', 'courier', 'delivered'].includes(stage)) {
    response.status(400).json({ message: 'El estado indicado no es valido.' })
    return
  }

  try {
    await ensureDatabaseReady()
    const overrides = await saveEmsStageOverride(packageCode, stage)
    response.json({ ok: true, packageCode: packageCode.toUpperCase(), stage, overrides })
  } catch (error) {
    response.status(500).json({
      message: 'No se pudo guardar el estado del paquete.',
      error: error.message,
    })
  }
})

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
      config: sanitizeWhatsAppConfig(savedConfig),
    })
  } catch (error) {
    response.status(500).json({
      message: 'No se pudo actualizar el modo de prueba de WhatsApp.',
      error: error.message,
    })
  }
})

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
    const testModeNumber =
      normalizeBoliviaTestNumber(config.testModeNumber) || normalizeBoliviaTestNumber(whatsappDefaults.testModeNumber)

    if (testModeEnabled) {
      if (normalizeBoliviaTestNumber(normalizedNumber) !== testModeNumber) {
        response.status(403).json({
          message: `El modo prueba esta activo. Solo se permite enviar mensajes al numero +${testModeNumber}.`,
        })
        return
      }

      const testNumberPresent = await isTestModeNumberListedInApis(testModeNumber)

      if (!testNumberPresent) {
        response.status(403).json({
          message: `El modo prueba esta activo, pero el numero +${testModeNumber} no aparece en las APIs de Internacionales o Paquetes.`,
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
      model: config.model,
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
      model: getAiConfig().model,
      message: 'La IA local en Docker no esta disponible.',
      error: error.message,
    })
  }
})

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
      packageContext.matched
        ? `Contexto del paquete para ${whatsappReference || 'sin numero'}:\n${packageContext.summaryText}\n\nRegla de etapa:\n${packageContext.lifecycleInstruction}`
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
    ].join('\n')

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

const initializationPromise = initializeDatabase().catch((error) => {
  initializationError = error
  console.error('No se pudo inicializar PostgreSQL:', error.message)
})

if (existsSync(clientIndexPath)) {
  app.use(express.static(clientDistDir))

  app.get(/^\/(?!api(?:\/|$)|media(?:\/|$)).*/, (_request, response) => {
    response.sendFile(clientIndexPath)
  })
}

app.listen(port, () => {
  const frontendMessage = existsSync(clientIndexPath)
    ? ` y frontend en http://localhost:${port}`
    : ''
  console.log(`CRM API disponible en http://localhost:${port}${frontendMessage}`)
})
