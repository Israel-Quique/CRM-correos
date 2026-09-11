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

const { Pool } = pg
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
dotenv.config({ path: path.join(__dirname, '..', '.env') })
const app = express()
const port = Number(process.env.PORT || 3001)
const connectionString = process.env.DATABASE_URL
const mediaStorageDir = path.join(__dirname, 'media')
const logsStorageDir = path.join(__dirname, 'logs')
const clientDistDir = path.join(__dirname, '..', 'frontend', 'dist')
const clientIndexPath = path.join(clientDistDir, 'index.html')
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 16 * 1024 * 1024,
  },
})

// API responses are dynamic and session-aware, so we must avoid browser revalidation
// turning JSON endpoints into 304 responses without a body.
app.disable('etag')

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

const pipelineStageKeys = ['received', 'transit', 'regional', 'courier', 'delivered', 'cancelled']

const defaultProntsConfig = {
  received: {
    presetKey: 'received',
    systemPrompt:
      'Eres un agente aduanero senior e IA oficial de logística internacional EMS Conversa OS. Tu misión es auditar declaraciones juradas CN22/CN23, verificar valores declarados, detectar posibles retenciones aduaneras por monto superior a $150 USD y validar que el destinatario tenga teléfono completo.',
    userTemplate:
      'Audita el siguiente paquete ingresado:\n- Cliente: {cliente}\n- Tracking: {tracking}\n- Destino: {destino}\n- Peso: {peso}\n- Valor declarado: {valor}\n- Estado: {estado}\n- Grupo: {grupoNombre}',
    temperature: 0.2,
    action: 'Asignar Etiqueta IA y Notificar WhatsApp',
    sampleContactId: null,
    response:
      '// Presiona "Ejecutar Simulación de Prompt" para probar el comportamiento de esta columna en tiempo real.',
  },
  regional: {
    presetKey: 'regional',
    systemPrompt:
      'Eres un coordinador logístico EMS en regional. Confirmas que el paquete ya fue recibido en la regional, explicas el estado actual sin inventar tiempos y preparas al cliente para el siguiente movimiento operativo.',
    userTemplate:
      'Genera una actualización para el paquete recibido en regional:\n- Cliente: {cliente}\n- Tracking: {tracking}\n- Destino: {destino}\n- Peso: {peso}\n- Valor declarado: {valor}\n- Estado: {estado}\n- Grupo: {grupoNombre}',
    temperature: 0.3,
    action: 'Asignar Etiqueta IA y Notificar WhatsApp',
    sampleContactId: null,
    response:
      '// Presiona "Ejecutar Simulación de Prompt" para probar el comportamiento de esta columna en tiempo real.',
  },
  transit: {
    presetKey: 'transit',
    systemPrompt:
      'Eres un asistente inteligente de seguimiento aéreo internacional. Analizas rutas de despacho, congestiones en aeropuertos hub y notificas estimaciones de llegada ETA al cliente.',
    userTemplate:
      'Calcula la predicción de tránsito para el paquete en tránsito:\n- Guía EMS: {tracking}\n- Destinatario: {cliente}\n- Destino Final: {destino}\n- Grupo: {grupoNombre}',
    temperature: 0.4,
    action: 'Asignar Etiqueta IA y Notificar WhatsApp',
    sampleContactId: null,
    response:
      '// Presiona "Ejecutar Simulación de Prompt" para probar el comportamiento de esta columna en tiempo real.',
  },
  courier: {
    presetKey: 'courier',
    systemPrompt:
      'Eres un coordinador de reparto EMS. Comunicas que el paquete fue asignado al cartero y acompañas al cliente hasta la entrega, sin prometer horarios exactos.',
    userTemplate:
      'Genera una actualización para un paquete asignado a cartero:\n- Cliente: {cliente}\n- Tracking: {tracking}\n- Destino: {destino}\n- Estado: {estado}\n- Grupo: {grupoNombre}',
    temperature: 0.3,
    action: 'Notificar salida a reparto y preparar confirmación',
    sampleContactId: null,
    response:
      '// Presiona "Ejecutar Simulación de Prompt" para probar el comportamiento de esta columna en tiempo real.',
  },
  delivered: {
    presetKey: 'delivered',
    systemPrompt:
      'Eres el encargado de calidad y satisfacción al cliente de Conversa OS. Verificas acuses de recibo digital, solicitas valoración de 1 a 5 estrellas y registras la entrega con éxito.',
    userTemplate:
      'Procesa la confirmación de entrega para:\n- Cliente: {cliente}\n- Guía EMS: {tracking}\n- Destino: {destino}\n- Valor: {valor}\n- Estado: {estado}\n\nGenera un mensaje de cierre amable para WhatsApp.',
    temperature: 0.5,
    action: 'Mover Automáticamente a Siguiente Estado',
    sampleContactId: null,
    response:
      '// Presiona "Ejecutar Simulación de Prompt" para probar el comportamiento de esta columna en tiempo real.',
  },
  cancelled: {
    presetKey: 'cancelled',
    systemPrompt:
      'Eres un coordinador de excepciones EMS. Informas cancelaciones, anulaciones y rechazos con tono claro y directo, sin dejar dudas sobre el estado final.',
    userTemplate:
      'Genera una actualizacion para un envio cancelado:\n- Cliente: {cliente}\n- Tracking: {tracking}\n- Destino: {destino}\n- Estado: {estado}\n- Grupo: {grupoNombre}',
    temperature: 0.2,
    action: 'Registrar cancelacion y notificar WhatsApp',
    sampleContactId: null,
    response:
      '// Presiona "Ejecutar Simulacion de Prompt" para probar el comportamiento de esta columna en tiempo real.',
  },
}

const defaultPipelineConfig = {
  columns: {
    received: {
      title: 'Recibido Origen',
      helper: 'Ingresados o en recepción inicial',
    },
    transit: {
      title: 'En Camino',
      helper: 'En tránsito hacia el destino final',
    },
    regional: {
      title: 'Recibido Destino',
      helper: 'Paquetes ya recibidos en la regional',
    },
    courier: {
      title: 'Cartero',
      helper: 'Paquetes asignados a reparto',
    },
    delivered: {
      title: 'Entregado',
      helper: 'Entregas confirmadas o cerradas',
    },
    cancelled: {
      title: 'Cancelado',
      helper: 'Paquetes cancelados, anulados o rechazados',
    },
  },
  customColumns: [],
}

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
  model: process.env.AI_MODEL?.trim() ?? 'qwen2.5:7b',
  generalModel:
    process.env.AI_GENERAL_MODEL?.trim() ??
    process.env.AI_MODEL?.trim() ??
    'qwen2.5:7b',
  routerModel: process.env.AI_ROUTER_MODEL?.trim() ?? 'qwen2.5:0.5b',
  trackingModel: process.env.AI_TRACKING_MODEL?.trim() ?? 'llama3.2:3b',
  routerTimeoutMs: Number.parseInt(process.env.AI_ROUTER_TIMEOUT_MS || '2500', 10),
  generalTimeoutMs: Number.parseInt(process.env.AI_GENERAL_TIMEOUT_MS || '6000', 10),
  trackingTimeoutMs: Number.parseInt(process.env.AI_TRACKING_TIMEOUT_MS || '5000', 10),
  systemPrompt:
    process.env.AI_SYSTEM_PROMPT?.trim() ??
    [
      'Eres un asistente comercial para un CRM omnicanal de Correos de Bolivia.',
      'Responde siempre en espanol claro, directo y profesional.',
      'Responde en 2 o 3 frases como maximo y no superes 40 palabras.',
      'Tu tarea es sugerir respuestas utiles para WhatsApp sin inventar datos.',
      'Si falta contexto, produce una respuesta segura y neutral.',
    ].join(' '),
  routerSystemPrompt:
    process.env.AI_ROUTER_SYSTEM_PROMPT?.trim() ??
    [
      'Eres un enrutador de intenciones para WhatsApp de Correos de Bolivia.',
      'Clasifica cada mensaje del cliente en una sola palabra exacta:',
      'TRACKING, TARIFAS o GENERAL.',
      'TRACKING: seguimiento, ubicacion, estado, guia, paquete, rastreo.',
      'TARIFAS: precios, costos, cotizaciones, kilos, tarifas, cuanto cuesta enviar.',
      'GENERAL: saludos, horarios, politicas, reclamos, informacion no tarifaria.',
      'No expliques nada. Devuelve solo una palabra.',
    ].join(' '),
  trackingSystemPrompt:
    process.env.AI_TRACKING_SYSTEM_PROMPT?.trim() ??
    [
      'Eres Jaimito, asistente de tracking de Correos de Bolivia.',
      'Tu unica tarea es responder consultas de seguimiento de paquetes.',
      'Usa solo el contexto real del paquete y el historial entregado.',
      'No inventes estados, fechas ni ubicaciones.',
      'Responde en espanol, 1 o 2 frases, maximo 40 palabras.',
    ].join(' '),
}

const getTrackingApiDefaults = () => ({
  baseUrl: process.env.TRACKING_API_URL?.trim() ?? 'http://172.65.10.55:8103',
  token:
    process.env.TRACKING_SQLSERVER_TOKEN?.trim() ??
    process.env.TRACKING_API_TOKEN?.trim() ??
    '2|FDN7orInEH6N2OprbvS0m0Xy6TkK3yvIhYjm1uwJ4e44bd99',
})

const cloneJson = (value) => JSON.parse(JSON.stringify(value))

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

const getStoredContactPackageCode = (row) => {
  const profiles = Array.isArray(row?.social_profiles) ? row.social_profiles : []
  const emsProfile = profiles.find((profile) => normalizeReference(profile?.channel).toLowerCase() === 'ems')
  return normalizeReference(emsProfile?.reference)
}

const mapStoredContactToContactPackage = (row) => {
  const code = getStoredContactPackageCode(row)
  const destination = normalizeReference(row?.company).replace(/^Paquetes-Contactos API\s*·\s*/i, '')
  const whatsappProfile = (Array.isArray(row?.social_profiles) ? row.social_profiles : []).find(
    (profile) => normalizeReference(profile?.channel).toLowerCase() === 'whatsapp',
  )

  return {
    id: row.id,
    codigo: code,
    tipo: 'SIOP',
    fecha_registro: row?.updated_at,
    estado: {
      nombre: normalizeReference(row?.status) || 'Sin estado',
    },
    origen: {
      nombre: 'Integracion EMS',
      telefono: null,
    },
    remitente: {
      nombre: 'Integracion EMS',
      telefono: null,
    },
    destino: {
      nombre: destination || 'Sin destino',
      direccion: destination || '',
      telefono: normalizeReference(whatsappProfile?.reference) || null,
    },
    destinatario: {
      nombre: normalizeReference(row?.name) || 'Sin destinatario',
      telefono: normalizeReference(whatsappProfile?.reference) || null,
    },
  }
}

const mapStoredContactToTrackingPackage = (row) => {
  const code = getStoredContactPackageCode(row)
  const destination = normalizeReference(row?.company).replace(/^Tracking API\s*·\s*/i, '')
  const whatsappProfile = (Array.isArray(row?.social_profiles) ? row.social_profiles : []).find(
    (profile) => normalizeReference(profile?.channel).toLowerCase() === 'whatsapp',
  )

  return {
    mailitm_pid: row.id,
    codigo: code,
    codigo_s10: code,
    fecha_registro: row?.updated_at,
    numero_despacho: null,
    tipo_servicio: 'SITRA',
    peso: null,
    clase_correo: 'SITRA',
    contenido: normalizeReference(row?.segment) || 'Tracking API',
    estado_postal: normalizeReference(row?.status) || 'Sin estado',
    telefonos: {
      remitente: null,
      destinatario: normalizeReference(whatsappProfile?.reference) || null,
    },
    estado: {
      nombre: normalizeReference(row?.status) || 'Sin estado',
    },
    remitente: {
      nombre: 'Tracking API',
      telefono: null,
    },
    destinatario: {
      nombre: normalizeReference(row?.name) || 'Sin destinatario',
      telefono: normalizeReference(whatsappProfile?.reference) || null,
      direccion: destination || '',
    },
    origen: {
      nombre: 'Tracking API',
    },
    destino: {
      nombre: destination || 'Sin destino',
    },
    eventos: [],
  }
}

const fetchStoredTrackingPackagesPage = async ({ page = 1, perPage = 10 } = {}) => {
  await ensureDatabaseReady()
  const safePage = Math.max(1, Number.parseInt(String(page), 10) || 1)
  const safePerPage = Math.min(Math.max(1, Number.parseInt(String(perPage), 10) || 10), 200)
  const offset = (safePage - 1) * safePerPage

  const [itemsResult, countResult] = await Promise.all([
    pool.query(
      `
        select id, name, company, channel, social_profiles, segment, owner_name, status, score, updated_at
        from contacts
        where segment ilike '%Tracking API%'
        order by updated_at desc, id desc
        limit $1 offset $2;
      `,
      [safePerPage, offset],
    ),
    pool.query(`
      select count(*)::integer as total
      from contacts
      where segment ilike '%Tracking API%';
    `),
  ])

  const total = Number(countResult.rows[0]?.total ?? 0)
  const totalPages = Math.max(1, Math.ceil(total / safePerPage))

  return {
    data: itemsResult.rows.map(mapStoredContactToTrackingPackage),
    paginacion: {
      total_registros: total,
      pagina_actual: safePage,
      por_pagina: safePerPage,
      ultima_pagina: totalPages,
      desde: total === 0 ? 0 : offset + 1,
      hasta: Math.min(offset + safePerPage, total),
    },
    source: 'local-db',
  }
}

const fetchStoredContactPackagesPage = async ({ page = 1, perPage = 10 } = {}) => {
  await ensureDatabaseReady()
  const safePage = Math.max(1, Number.parseInt(String(page), 10) || 1)
  const safePerPage = Math.min(Math.max(1, Number.parseInt(String(perPage), 10) || 10), 200)
  const offset = (safePage - 1) * safePerPage

  const [itemsResult, countResult] = await Promise.all([
    pool.query(
      `
        select id, name, company, channel, social_profiles, segment, owner_name, status, score, updated_at
        from contacts
        where segment ilike '%Paquetes-contactos API%'
        order by updated_at desc, id desc
        limit $1 offset $2;
      `,
      [safePerPage, offset],
    ),
    pool.query(`
      select count(*)::integer as total
      from contacts
      where segment ilike '%Paquetes-contactos API%';
    `),
  ])

  const total = Number(countResult.rows[0]?.total ?? 0)
  const totalPages = Math.max(1, Math.ceil(total / safePerPage))

  return {
    data: itemsResult.rows.map(mapStoredContactToContactPackage),
    paginacion: {
      total_registros: total,
      pagina_actual: safePage,
      por_pagina: safePerPage,
      ultima_pagina: totalPages,
      desde: total === 0 ? 0 : offset + 1,
      hasta: Math.min(offset + safePerPage, total),
    },
    source: 'local-db',
  }
}

const getPackageEventsApiDefaults = () => ({
  endpoint:
    process.env.PAQUETES_EVENTOS_API_URL?.trim() ??
    'http://dev.correos.gob.bo:18100/api/paquetes-eventos',
  token:
    process.env.PAQUETES_EVENTOS_API_TOKEN?.trim() ??
    'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJodHRwOlwvXC9kZXYuY29ycmVvcy5nb2IuYm86MTgxMDAiLCJhdWQiOiJib2xpcG9zdC1kaXJlY2Npb25lcy1kZXN0aW5vIiwic3ViIjoiMTAsImp0aSI6IjU0NDE1OTNkYjM2MmExMjRlOThkYTQyZjNkMjgwNWE3NjZmZmZlZTk3ZTY2NzE1OWU3M2U1Y2FmNDYwN2Q4ZmUiLCJuYW1lIjoiRVZFTlRPUyBTSU9QIiwiaWF0IjoxNzg3NzU2ODQ5fQ.EKabodylKElq04t3EhXRwN7pxtAiWp5RuRvldZcFKq4',
})

const reloadLocalEnv = () => {
  try {
    dotenv.config({
      path: path.join(__dirname, '..', '.env'),
      override: true,
    })
  } catch {
    // ignore env reload errors
  }
}

const sessions = new Map()
const packageContextCache = new Map()
const packageEventsCache = new Map()
const aiModelCache = new Map()
const aiHealthCache = new Map()
const contactPackagesCatalogCache = new Map()
const packagePipelineSyncCache = new Map()
let initializationError = null
const PACKAGE_CONTEXT_TTL_MS = 20_000
const AI_MODEL_TTL_MS = 60_000
const AI_HEALTH_TTL_MS = 15_000
const CONTACT_PACKAGES_CATALOG_TTL_MS = 60_000
const PACKAGE_PIPELINE_SYNC_TTL_MS = Number.parseInt(
  process.env.PACKAGE_PIPELINE_SYNC_TTL_MS || '300000',
  10,
)

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

const describeFetchFailure = (error, fallbackMessage) => {
  const parts = [
    normalizeReference(error?.message),
    normalizeReference(error?.cause?.code),
    normalizeReference(error?.cause?.message),
  ].filter(Boolean)

  return parts.length > 0 ? `${fallbackMessage}: ${parts.join(' - ')}` : fallbackMessage
}

const getCachedValue = (cache, key) => {
  const cached = cache.get(key)
  if (!cached) return null
  if (cached.expiresAt <= Date.now()) {
    cache.delete(key)
    return null
  }
  return cached.value
}

const setCachedValue = (cache, key, value, ttlMs) => {
  cache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  })
  return value
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

const getNormalizedTimeoutMs = (value, fallbackMs) => {
  if (!Number.isFinite(value) || value <= 0) {
    return fallbackMs
  }

  return value
}

app.get('/api/tracking/paquetes', cors(), authMiddleware, async (request, response) => {
  try {
    reloadLocalEnv()
    const trackingApiDefaults = getTrackingApiDefaults()

    if (String(request.query.all ?? '').trim() === '1') {
      let payload = null
      try {
        payload = await fetchAllTrackingPackagesCatalog({
          forceRefresh: String(request.query.fresh ?? '').trim() === '1',
        })
      } catch (error) {
        const fallbackPayload = await fetchStoredTrackingPackagesPage({ page: 1, perPage: 200 })
        payload = {
          data: fallbackPayload.data,
          total: fallbackPayload.paginacion.total_registros,
          cachedAt: new Date().toISOString(),
          source: 'local-db',
          warning: 'No se pudo consultar la API externa de tracking; se muestran datos locales sincronizados.',
          upstreamError: error instanceof Error ? error.message : 'Error desconocido.',
        }
      }
      response.json(payload)
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
    const fallbackPayload = await fetchStoredTrackingPackagesPage({
      page: request.query.page,
      perPage: request.query.per_page,
    })

    response.json({
      ...fallbackPayload,
      warning: 'No se pudo consultar la API externa de tracking; se muestran datos locales sincronizados.',
      upstreamError: error instanceof Error ? error.message : 'Error desconocido.',
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
    const fallbackPayload = await fetchStoredContactPackagesPage({
      page: request.query.page,
      perPage: request.query.per_page,
    })

    response.json({
      ...fallbackPayload,
      warning: 'No se pudo consultar la API externa de paquetes-contactos; se muestran datos locales sincronizados.',
      upstreamError: error instanceof Error ? error.message : 'Error desconocido.',
    })
  }
})

const normalizeReference = (value) => String(value ?? '').trim()
const normalizePhoneNumber = (value) => normalizeReference(value).replace(/[^\d]/g, '')
const fetchAllContactPackagesCatalog = async ({ forceRefresh = false } = {}) => {
  const cacheKey = 'all'
  const cachedCatalog = getCachedValue(contactPackagesCatalogCache, cacheKey)
  if (!forceRefresh && cachedCatalog) {
    return cachedCatalog
  }

  const inFlightCacheKey = `${cacheKey}-in-flight`
  const pendingCatalog = getCachedValue(contactPackagesCatalogCache, inFlightCacheKey)
  if (!forceRefresh && pendingCatalog) {
    return pendingCatalog
  }

  reloadLocalEnv()
  const contactPackagesApiDefaults = getContactPackagesApiDefaults()
  const timeoutMs = Number.parseInt(process.env.CONTACT_PACKAGES_CATALOG_TIMEOUT_MS || '30000', 10)
  const upstreamUrl = new URL(contactPackagesApiDefaults.endpoint)

  const catalogPromise = fetchAllPaginatedItems({
    url: upstreamUrl,
    headers: {
      Authorization: `Bearer ${contactPackagesApiDefaults.token}`,
      Accept: 'application/json',
    },
    perPage: 200,
    maxPages: 500,
    timeoutMs,
  })
    .then((items) =>
      setCachedValue(
        contactPackagesCatalogCache,
        cacheKey,
        {
          data: items,
          total: items.length,
          cachedAt: new Date().toISOString(),
        },
        CONTACT_PACKAGES_CATALOG_TTL_MS,
      ),
    )
    .finally(() => {
      contactPackagesCatalogCache.delete(inFlightCacheKey)
    })

  setCachedValue(contactPackagesCatalogCache, inFlightCacheKey, catalogPromise, CONTACT_PACKAGES_CATALOG_TTL_MS)
  return catalogPromise
}

app.get('/api/internacionales/paquetes-contactos/catalog', cors(), authMiddleware, async (_request, response) => {
  try {
    const catalog = await fetchAllContactPackagesCatalog()
    response.json(catalog)
  } catch (error) {
    const fallbackPayload = await fetchStoredContactPackagesPage({ page: 1, perPage: 200 })
    response.json({
      data: fallbackPayload.data,
      total: fallbackPayload.paginacion.total_registros,
      cachedAt: new Date().toISOString(),
      source: 'local-db',
      warning: 'No se pudo consultar el catalogo externo de paquetes-contactos; se muestran datos locales sincronizados.',
      upstreamError: error instanceof Error ? error.message : 'Error desconocido.',
    })
  }
})

const fetchPackageEventsForCode = async (packageCode) => {
  const normalizedCode = normalizePackageCodeForLookup(packageCode)
  const cacheKey = normalizedCode || 'all'
  const cachedEvents = getCachedValue(packageEventsCache, cacheKey)
  if (cachedEvents) {
    return cachedEvents
  }

  reloadLocalEnv()

  const packageEventsApiDefaults = getPackageEventsApiDefaults()
  const timeoutMs = Number.parseInt(process.env.PACKAGE_EVENTS_CATALOG_TIMEOUT_MS || '30000', 10)
  const baseUrl = new URL(packageEventsApiDefaults.endpoint)
  const headers = {
    Authorization: `Bearer ${packageEventsApiDefaults.token}`,
    Accept: 'application/json',
  }

  const queryAttempts = normalizedCode
    ? [
        { codigo: normalizedCode },
        { codigo_s10: normalizedCode },
        { paquete: normalizedCode },
        { tracking: normalizedCode },
        { q: normalizedCode },
      ]
    : [{}]

  let matchedItems = []
  let statusCode = null
  let errorMessage = ''

  for (const queryParams of queryAttempts) {
    const attemptUrl = new URL(baseUrl.toString())
    for (const [key, value] of Object.entries(queryParams)) {
      attemptUrl.searchParams.set(key, String(value))
    }

    const response = await fetchJsonWithTimeout(attemptUrl, { headers }, timeoutMs).catch(() => null)
    if (!response?.ok) {
      statusCode = response?.status ?? 502
      errorMessage = response ? `La API respondio con estado ${response.status}.` : 'No se obtuvo respuesta de la API de eventos.'
      continue
    }

    statusCode = response.status
    const payload = await response.json().catch(() => null)
    const items = getPackageEventsPayloadItems(payload)
    const candidateItems = items.length > 0 ? items : payload && typeof payload === 'object' ? [payload] : []

    matchedItems = normalizedCode
      ? candidateItems.filter((item) => getPackageEventCodeValuesForLookup(item).includes(normalizedCode))
      : candidateItems

    if (matchedItems.length > 0) {
      break
    }
  }

  if (!matchedItems.length && normalizedCode) {
    const paginatedItems = await fetchAllPaginatedItems({
      url: baseUrl,
      headers,
      perPage: 100,
      maxPages: 500,
      timeoutMs,
      stopWhen: (pageItems) =>
        pageItems.some((item) => getPackageEventCodeValuesForLookup(item).includes(normalizedCode)),
    })

    matchedItems = paginatedItems.filter((item) => getPackageEventCodeValuesForLookup(item).includes(normalizedCode))
  }

  const result = {
    data: matchedItems,
    total: matchedItems.length,
    cachedAt: new Date().toISOString(),
    statusCode,
    error: errorMessage,
    code: normalizedCode,
  }

  return setCachedValue(packageEventsCache, cacheKey, result, CONTACT_PACKAGES_CATALOG_TTL_MS)
}

const fetchAllPackageEventsCatalog = async ({ forceRefresh = false } = {}) => {
  const cacheKey = 'all'
  const cachedEvents = getCachedValue(packageEventsCache, cacheKey)
  if (!forceRefresh && cachedEvents) {
    return cachedEvents
  }

  const inFlightCacheKey = `${cacheKey}-in-flight`
  const pendingEvents = getCachedValue(packageEventsCache, inFlightCacheKey)
  if (!forceRefresh && pendingEvents) {
    return pendingEvents
  }

  reloadLocalEnv()

  const packageEventsApiDefaults = getPackageEventsApiDefaults()
  const timeoutMs = Number.parseInt(process.env.PACKAGE_EVENTS_CATALOG_TIMEOUT_MS || '30000', 10)
  const baseUrl = new URL(packageEventsApiDefaults.endpoint)
  const headers = {
    Authorization: `Bearer ${packageEventsApiDefaults.token}`,
    Accept: 'application/json',
  }

  const catalogPromise = fetchAllPaginatedItems({
    url: baseUrl,
    headers,
    perPage: 200,
    maxPages: 500,
    timeoutMs,
  })
    .then((data) =>
      setCachedValue(
        packageEventsCache,
        cacheKey,
        {
          data,
          total: data.length,
          cachedAt: new Date().toISOString(),
        },
        CONTACT_PACKAGES_CATALOG_TTL_MS,
      ),
    )
    .finally(() => {
      packageEventsCache.delete(inFlightCacheKey)
    })

  setCachedValue(packageEventsCache, inFlightCacheKey, catalogPromise, CONTACT_PACKAGES_CATALOG_TTL_MS)
  return catalogPromise
}

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

const normalizeBoliviaTestNumberList = (values, fallbackValues = []) => {
  const sourceValues = Array.isArray(values) ? values : values != null ? [values] : []
  const normalized = sourceValues
    .map((value) => normalizeBoliviaTestNumber(value))
    .filter(Boolean)

  const fallbackNormalized = (Array.isArray(fallbackValues) ? fallbackValues : [fallbackValues])
    .map((value) => normalizeBoliviaTestNumber(value))
    .filter(Boolean)

  const combined = normalized.length > 0 ? normalized : fallbackNormalized
  return [...new Set(combined)]
}

const getConfiguredWhatsAppTestNumbers = (config) =>
  normalizeBoliviaTestNumberList(config?.testModeNumbers, [
    config?.testModeNumber,
    whatsappDefaults.testModeNumber,
  ])
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

  return parsePhoneNumberFromString(`+${digits}`)
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

const sanitizeWhatsAppConfig = (config) => {
  const testModeNumbers = normalizeBoliviaTestNumberList(
    config.testModeNumbers,
    [config.testModeNumber, whatsappDefaults.testModeNumber],
  )

  return {
    phoneNumberId: normalizeReference(config.phoneNumberId),
    businessAccountId: normalizeReference(config.businessAccountId),
    apiVersion: normalizeReference(config.apiVersion) || whatsappDefaults.apiVersion,
    senderNumber: normalizeReference(config.senderNumber),
    testModeEnabled: normalizeBoolean(config.testModeEnabled, whatsappDefaults.testModeEnabled),
    testModeNumber: testModeNumbers[0] || normalizeBoliviaTestNumber(whatsappDefaults.testModeNumber),
    testModeNumbers,
    webhookVerifyToken: normalizeReference(config.webhookVerifyToken),
    hasAccessToken: Boolean(normalizeReference(config.accessToken)),
    accessTokenMask: maskToken(config.accessToken),
  }
}

const getAcceptedWebhookVerifyTokens = (config) =>
  [
    normalizeReference(config?.webhookVerifyToken),
    normalizeReference(process.env.WHATSAPP_META_WEBHOOK_VERIFY_TOKEN),
    normalizeReference(process.env.WEBHOOK_VERIFY_TOKEN),
  ].filter(Boolean)

const getStoredSettingsByKey = async (integrationKey, client = pool) => {
  const result = await client.query(
    `
      select settings
      from integration_settings
      where integration_key = $1
      limit 1;
    `,
    [integrationKey],
  )

  return result.rows[0]?.settings ?? {}
}

const saveSettingsByKey = async (integrationKey, settings) => {
  await pool.query(
    `
      insert into integration_settings (integration_key, settings, updated_at)
      values ($1, $2::jsonb, now())
      on conflict (integration_key) do update
      set settings = excluded.settings,
          updated_at = now();
    `,
    [integrationKey, JSON.stringify(settings)],
  )

  return settings
}

const sanitizeProntsColumnConfig = (columnKey, config = {}) => {
  const fallback = defaultProntsConfig[columnKey] ?? defaultProntsConfig.received
  const sampleContactId = Number(config.sampleContactId)
  const temperature = Number(config.temperature)

  return {
    presetKey: pipelineStageKeys.includes(config.presetKey) ? config.presetKey : fallback.presetKey,
    systemPrompt: normalizeReference(config.systemPrompt) || fallback.systemPrompt,
    userTemplate: normalizeReference(config.userTemplate) || fallback.userTemplate,
    temperature:
      Number.isFinite(temperature) && temperature >= 0 && temperature <= 1
        ? Number(temperature.toFixed(1))
        : fallback.temperature,
    action: normalizeReference(config.action) || fallback.action,
    sampleContactId: Number.isInteger(sampleContactId) && sampleContactId > 0 ? sampleContactId : null,
    response: normalizeReference(config.response) || fallback.response,
  }
}

const getStoredProntsConfig = async (client = pool) => {
  const settings = await getStoredSettingsByKey('crm_pronts_config', client)
  const nextConfig = {}

  for (const columnKey of pipelineStageKeys) {
    nextConfig[columnKey] = sanitizeProntsColumnConfig(columnKey, settings?.[columnKey])
  }

  return nextConfig
}

const saveProntsConfig = async (partialConfig = {}) => {
  const currentConfig = await getStoredProntsConfig()
  const nextConfig = {}

  for (const columnKey of pipelineStageKeys) {
    nextConfig[columnKey] = sanitizeProntsColumnConfig(columnKey, {
      ...currentConfig[columnKey],
      ...(partialConfig?.[columnKey] ?? {}),
    })
  }

  await saveSettingsByKey('crm_pronts_config', nextConfig)
  return nextConfig
}

const sanitizePipelineColumnConfig = (columnKey, config = {}) => {
  const fallback = defaultPipelineConfig.columns[columnKey] ?? defaultPipelineConfig.columns.received

  return {
    title: normalizeReference(config.title) || fallback.title,
    helper: normalizeReference(config.helper) || fallback.helper,
  }
}

const sanitizeCustomPipelineColumn = (config = {}, fallbackIndex = 0) => {
  const rawId = normalizeReference(config.id).toLowerCase()
  const id =
    rawId
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^-+|-+$/g, '') || `custom-${fallbackIndex + 1}`

  const title = normalizeReference(config.title) || `Estado ${fallbackIndex + 1}`
  const helper = normalizeReference(config.helper) || 'Columna personalizada del flujo EMS'

  return { id, title, helper }
}

const buildPipelineConfigFromRows = (rows = []) => {
  const nextConfig = { columns: {}, customColumns: [] }
  const normalizedRows = rows.map((row) => ({
    stateKey: normalizeReference(row.state_key).toLowerCase(),
    title: normalizeReference(row.title),
    helper: normalizeReference(row.helper),
    stageOrder: Number(row.stage_order) || 0,
  }))
  const rowsByKey = new Map(normalizedRows.map((row) => [row.stateKey, row]))

  for (const columnKey of pipelineStageKeys) {
    nextConfig.columns[columnKey] = sanitizePipelineColumnConfig(columnKey, rowsByKey.get(columnKey) ?? {})
  }

  const seenIds = new Set()
  nextConfig.customColumns = normalizedRows
    .filter((row) => row.stateKey && !pipelineStageKeys.includes(row.stateKey))
    .sort((firstRow, secondRow) => {
      if (firstRow.stageOrder !== secondRow.stageOrder) {
        return firstRow.stageOrder - secondRow.stageOrder
      }

      return firstRow.stateKey.localeCompare(secondRow.stateKey)
    })
    .map((row, index) =>
      sanitizeCustomPipelineColumn(
        {
          id: row.stateKey,
          title: row.title,
          helper: row.helper,
        },
        index,
      ),
    )
    .filter((column) => {
      if (seenIds.has(column.id)) return false
      seenIds.add(column.id)
      return true
    })

  return nextConfig
}

const getStoredPipelineConfig = async (client = pool) => {
  const result = await client.query(
    `
      select state_key, title, helper, stage_order
      from pipeline_states
      where pipeline_key = $1
      order by stage_order asc, id asc;
    `,
    ['ems'],
  )

  return buildPipelineConfigFromRows(result.rows)
}

const EmsStageKeys = ['received', 'transit', 'regional', 'courier', 'delivered', 'cancelled']

const normalizeEmsStageOverrideKey = (value) => normalizeReference(value).toUpperCase()

const normalizeEmsStageOverrideValue = (value) => {
  const normalized = normalizeReference(value).toLowerCase()

  if (EmsStageKeys.includes(normalized)) {
    return normalized
  }

  return normalizeEmsStatus(normalized)
}

const normalizeEmsStageOverrideMap = (settings = {}) =>
  Object.fromEntries(
    Object.entries(settings)
      .map(([key, value]) => [normalizeEmsStageOverrideKey(key), normalizeEmsStageOverrideValue(value)])
      .filter(([key, value]) => Boolean(key) && Boolean(value)),
  )

const getStoredEmsStageOverrides = async (client = pool) => {
  const settings = await getStoredSettingsByKey('crm_ems_stage_overrides', client)
  return normalizeEmsStageOverrideMap(settings)
}

const saveEmsStageOverrides = async (partialOverrides = {}) => {
  const currentOverrides = await getStoredEmsStageOverrides()
  const nextOverrides = {
    ...currentOverrides,
    ...normalizeEmsStageOverrideMap(partialOverrides),
  }

  await saveSettingsByKey('crm_ems_stage_overrides', nextOverrides)
  packageContextCache.clear()
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

const savePipelineConfig = async (partialConfig = {}) => {
  const client = await pool.connect()

  try {
    await client.query('begin')
    const currentConfig = await getStoredPipelineConfig(client)
    const nextConfig = { columns: {}, customColumns: [] }

    for (const columnKey of pipelineStageKeys) {
      nextConfig.columns[columnKey] = sanitizePipelineColumnConfig(columnKey, {
        ...currentConfig.columns[columnKey],
        ...(partialConfig?.columns?.[columnKey] ?? {}),
      })
    }

    const rawCustomColumns = Array.isArray(partialConfig?.customColumns)
      ? partialConfig.customColumns
      : currentConfig.customColumns
    const seenIds = new Set()
    nextConfig.customColumns = rawCustomColumns
      .map((column, index) => sanitizeCustomPipelineColumn(column, index))
      .filter((column) => {
        if (seenIds.has(column.id)) return false
        seenIds.add(column.id)
        return true
      })

    const nextRows = [
      ...pipelineStageKeys.map((columnKey, index) => ({
        stateKey: columnKey,
        title: nextConfig.columns[columnKey].title,
        helper: nextConfig.columns[columnKey].helper,
        stageOrder: index + 1,
        isSystem: true,
      })),
      ...nextConfig.customColumns.map((column, index) => ({
        stateKey: column.id,
        title: column.title,
        helper: column.helper,
        stageOrder: pipelineStageKeys.length + index + 1,
        isSystem: false,
      })),
    ]

    for (const row of nextRows) {
      await client.query(
        `
          insert into pipeline_states (
            pipeline_key,
            state_key,
            title,
            helper,
            stage_order,
            is_system,
            updated_at
          )
          values ($1, $2, $3, $4, $5, $6, now())
          on conflict (pipeline_key, state_key) do update
          set title = excluded.title,
              helper = excluded.helper,
              stage_order = excluded.stage_order,
              is_system = excluded.is_system,
              updated_at = now();
        `,
        ['ems', row.stateKey, row.title, row.helper, row.stageOrder, row.isSystem],
      )
    }

    await client.query(
      `
        delete from pipeline_states
        where pipeline_key = $1
          and not (state_key = any($2::text[]));
      `,
      ['ems', nextRows.map((row) => row.stateKey)],
    )

    await client.query('commit')
    return nextConfig
  } catch (error) {
    await client.query('rollback').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}

const getStoredWhatsAppConfig = async (client = pool) => {
  const settings = await getStoredSettingsByKey('whatsapp_meta', client)

  return {
    accessToken: normalizeReference(settings.accessToken) || whatsappDefaults.accessToken,
    phoneNumberId: normalizeReference(settings.phoneNumberId) || whatsappDefaults.phoneNumberId,
    businessAccountId:
      normalizeReference(settings.businessAccountId) || whatsappDefaults.businessAccountId,
    apiVersion: normalizeReference(settings.apiVersion) || whatsappDefaults.apiVersion,
    senderNumber: normalizeReference(settings.senderNumber) || whatsappDefaults.senderNumber,
    testModeEnabled: normalizeBoolean(settings.testModeEnabled, whatsappDefaults.testModeEnabled),
    testModeNumbers: normalizeBoliviaTestNumberList(settings.testModeNumbers, [
      settings.testModeNumber,
      whatsappDefaults.testModeNumber,
    ]),
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
  nextConfig.testModeNumbers = normalizeBoliviaTestNumberList(nextConfig.testModeNumbers, [
    nextConfig.testModeNumber,
    whatsappDefaults.testModeNumber,
  ])
  nextConfig.testModeNumber = nextConfig.testModeNumbers[0] || normalizeBoliviaTestNumber(whatsappDefaults.testModeNumber)

  return saveSettingsByKey('whatsapp_meta', nextConfig)
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
  const events = Array.isArray(item?.eventos) ? item.eventos.filter(Boolean) : []
  return events[events.length - 1] ?? null
}

const getPackageLatestEvent = (item) => {
  return getTrackingLatestEvent(item)
}

const getRegisteredLatestPackageEvent = (events = []) => {
  const eventItems = Array.isArray(events) ? events.filter(Boolean) : []
  return eventItems[0] ?? null
}

const buildLatestPackageEventsByCode = (events = []) => {
  const latestEventsByCode = new Map()

  ;(Array.isArray(events) ? events : []).forEach((event) => {
    const eventCodes = getPackageEventCodeValuesForLookup(event)
    eventCodes.forEach((code) => {
      if (!code) return

      const currentEvent = latestEventsByCode.get(code)
      if (!currentEvent || getPackageEventTimestampValue(event) >= getPackageEventTimestampValue(currentEvent)) {
        latestEventsByCode.set(code, event)
      }
    })
  })

  return latestEventsByCode
}

const getNationalPackageStageFromEvent = (event) => {
  if (!event) return null

  const eventId = Number(event?.evento_id ?? event?.codigo_evento)
  if ([318, 295, 2239, 2240, 240, 2241, 297, 2242].includes(eventId)) return 'received'
  if ([168, 296].includes(eventId)) return 'transit'
  if ([310, 312, 183, 4410, 2103, 4405, 4404, 3345, 4400].includes(eventId)) return 'regional'
  if ([4409, 315].includes(eventId)) return 'courier'
  if (eventId === 316) return 'delivered'
  if (eventId === 4402) return 'cancelled'

  const eventText = normalizeReference(
    [event?.nombre, event?.evento_api, event?.evento_original, event?.movimiento_bolivia, event?.detalle]
      .filter(Boolean)
      .join(' '),
  ).toLowerCase()

  if (eventText.includes('cartero') || eventText.includes('reparto')) return 'courier'
  if (eventText.includes('listo para entregar') || eventText.includes('oficina de entrega')) return 'regional'
  if (eventText.includes('cancel') || eventText.includes('anul') || eventText.includes('rechaz')) return 'cancelled'
  if (eventText.includes('devuelto')) return 'cancelled'
  if (eventText.includes('entreg')) return 'delivered'
  if (eventText.includes('saca interna') || eventText.includes('salida') || eventText.includes('transito')) return 'transit'
  if (eventText.includes('recibido') || eventText.includes('origen')) return 'received'

  return null
}

const getPackageStageFromEvents = (item) => {
  return getNationalPackageStageFromEvent(getPackageLatestEvent(item))
}

const getPackageStageRank = (stage) => {
  if (stage === 'received') return 0
  if (stage === 'transit') return 1
  if (stage === 'regional') return 2
  if (stage === 'courier') return 3
  if (stage === 'delivered') return 4
  if (stage === 'cancelled') return 5
  return -1
}

const inferTrackingPackageStage = (item) => {
  const latestEvent = getTrackingLatestEvent(item)
  const eventStage = getPackageStageFromEvents(item)
  if (eventStage) return eventStage

  return (
    normalizeEmsStatus(
      [
        item?.estado_postal,
        latestEvent?.nombre,
        latestEvent?.evento_api,
        latestEvent?.evento_original,
        latestEvent?.detalle,
        latestEvent?.movimiento_bolivia,
      ]
        .map(normalizeReference)
        .filter(Boolean)
        .join(' | '),
    ) ?? 'received'
  )
}

const getPackageEventLabel = (event) =>
  normalizeReference(
    event?.nombre ||
      event?.evento_api ||
      event?.evento_original ||
      event?.movimiento_bolivia ||
      event?.detalle ||
      'Nuevo movimiento',
  )

const getPackageEventSignature = (event) => {
  if (!event) return ''

  return [
    event?.evento_id,
    event?.codigo_evento,
    getPackageEventLabel(event),
    getPackageEventLocation(event),
    normalizeReference(event?.fecha),
  ]
    .map((value) => normalizeReference(value).toUpperCase())
    .filter(Boolean)
    .join('|')
}

const inferContactPackageStage = (item) => {
  const statusText = normalizeReference(item?.estado?.nombre)
  const normalizedStatus = statusText.toLowerCase()
  const latestEventStage = getPackageStageFromEvents(item)

  if (latestEventStage) {
    return latestEventStage
  }

  if (
    normalizedStatus.includes('regional') ||
    normalizedStatus.includes('destino') ||
    normalizedStatus.includes('recibido destino') ||
    normalizedStatus.includes('recibido regional') ||
    normalizedStatus.includes('sucursal de destino') ||
    normalizedStatus.includes('pasar a recoger')
  ) {
    return 'regional'
  }

  if (
    normalizedStatus.includes('cartero') ||
    normalizedStatus.includes('reparto') ||
    normalizedStatus.includes('distribucion') ||
    normalizedStatus.includes('distribuciÃ³n')
  ) {
    return 'courier'
  }

  if (
    normalizedStatus.includes('entregad') ||
    normalizedStatus.includes('deliver') ||
    normalizedStatus.includes('cerrad')
  ) {
    return 'delivered'
  }

  if (
    normalizedStatus.includes('cancel') ||
    normalizedStatus.includes('anul') ||
    normalizedStatus.includes('rechaz') ||
    normalizedStatus.includes('cancelado') ||
    normalizedStatus.includes('cancelada')
  ) {
    return 'cancelled'
  }

  if (
    normalizedStatus.includes('camino') ||
    normalizedStatus.includes('transit') ||
    normalizedStatus.includes('trÃ¡nsito') ||
    normalizedStatus.includes('transito') ||
    normalizedStatus.includes('seguim') ||
    normalizedStatus.includes('aduan')
  ) {
    return 'transit'
  }

  if (
    normalizedStatus === 'recibido' ||
    normalizedStatus === 'recibida' ||
    normalizedStatus === 'received' ||
    normalizedStatus === 'ventanilla' ||
    normalizedStatus.includes('almacen') ||
    normalizedStatus.includes('almacén') ||
    normalizedStatus.includes('admis') ||
    normalizedStatus.includes('recepcion') ||
    normalizedStatus.includes('origen')
  ) {
    return 'received'
  }

  return normalizeEmsStatus(statusText) || 'received'
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

const getPackageContactStatusForStage = (stage) => {
  if (stage === 'transit') return 'En seguimiento'
  if (stage === 'regional') return 'Recibido Destino'
  if (stage === 'courier') return 'Cartero'
  if (stage === 'delivered') return 'Entregado'
  if (stage === 'cancelled') return 'Cancelado'
  return 'Nuevo'
}

const getPackageContactScoreForStage = (stage) => {
  if (stage === 'delivered') return 100
  if (stage === 'courier') return 85
  if (stage === 'regional') return 70
  if (stage === 'transit') return 55
  if (stage === 'cancelled') return 95
  return 40
}

const getPackageSyncEntrySpecificity = (entry) => {
  let score = 0
  if (normalizeReference(entry?.recipientName)) score += 8
  if (normalizeReference(entry?.destinationLabel)) score += 4
  if (normalizeReference(entry?.destinationAddress)) score += 4
  if (normalizeReference(entry?.originLabel)) score += 2
  if (normalizeReference(entry?.primaryPhone)) score += 2
  if (entry?.source === 'contact') score += 1
  return score
}

const mergeUniqueProfiles = (baseProfiles = [], nextProfiles = []) => {
  const seen = new Set()
  const merged = []

  for (const profile of [...(Array.isArray(baseProfiles) ? baseProfiles : []), ...(Array.isArray(nextProfiles) ? nextProfiles : [])]) {
    const channel = normalizeReference(profile?.channel)
    const reference = normalizeReference(profile?.reference)
    if (!channel && !reference) continue

    const key = `${channel.toLowerCase()}::${reference.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    merged.push({
      channel: profile?.channel ?? channel,
      reference,
    })
  }

  return merged
}

const getPackageCodeFromItem = (item) =>
  normalizePackageCodeForLookup(item?.codigo_s10 || item?.codigo || item?.codigoSeguimiento || item?.tracking)

const isNationalPackageCode = (code) => /^[A-Z]{1,2}\d+[A-Z]{2}$/.test(normalizePackageCodeForLookup(code)) && normalizePackageCodeForLookup(code).endsWith('BO')

const getPackageSyncPhoneCandidates = (item, source = 'tracking') => {
  if (source === 'contact') {
    return extractContactPackagesPhoneCandidates(item)
  }

  return extractTrackingApiPhoneCandidates(item)
}

const getPackageSyncDisplayName = (entry) => {
  return (
    normalizeReference(entry?.recipientName) ||
    normalizeReference(entry?.senderName) ||
    normalizeReference(entry?.destinationLabel) ||
    normalizeReference(entry?.originLabel) ||
    normalizeReference(entry?.code) ||
    'Paquete EMS'
  )
}

const getPackageSyncCompany = (entry) => {
  const sourceLabel = entry?.source === 'contact' ? 'Paquetes-Contactos API' : 'Tracking API'
  const destination = normalizeReference(entry?.destinationLabel)
  return destination ? `${sourceLabel} · ${destination}` : sourceLabel
}

const findPackageContactByCode = async (code, client = pool) => {
  const normalizedCode = normalizePackageCodeForLookup(code)
  if (!normalizedCode) {
    return null
  }

  const result = await client.query(
    `
      select id, name, company, channel, social_profiles, segment, owner_name, status, score
      from contacts
      where exists (
        select 1
        from jsonb_array_elements(coalesce(social_profiles, '[]'::jsonb)) as profile
        where lower(coalesce(profile->>'channel', '')) = 'ems'
          and upper(coalesce(profile->>'reference', '')) = $1
      )
      limit 1;
    `,
    [normalizedCode],
  )

  return result.rows[0] ?? null
}

const upsertPackageContact = async (client, entry) => {
  const existingContact = await findPackageContactByCode(entry.code, client)
  const phoneCandidates = Array.isArray(entry.phoneCandidates)
    ? entry.phoneCandidates
    : entry.phoneCandidates instanceof Set
      ? [...entry.phoneCandidates]
      : []
  const primaryPhone =
    normalizePhoneNumber(entry.primaryPhone) || phoneCandidates.map(normalizePhoneNumber).find(Boolean) || ''
  const nextSocialProfiles = mergeUniqueProfiles(existingContact?.social_profiles, [
    { channel: 'EMS', reference: entry.code },
    ...(primaryPhone ? [{ channel: 'WhatsApp', reference: `+${primaryPhone}` }] : []),
  ])

  const nextRow = {
    name: getPackageSyncDisplayName(entry),
    company: getPackageSyncCompany(entry),
    channel: primaryPhone ? 'WhatsApp, EMS' : 'EMS',
    socialProfiles: JSON.stringify(nextSocialProfiles),
    segment: entry.source === 'contact' ? 'Paquetes-contactos API' : 'Tracking API',
    ownerName: 'Integración EMS',
    status: getPackageContactStatusForStage(entry.stage),
    score: getPackageContactScoreForStage(entry.stage),
  }

  if (existingContact?.id) {
    const updateResult = await client.query(
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
        returning id, name, company, status, updated_at;
      `,
      [
        nextRow.name,
        nextRow.company,
        nextRow.channel,
        nextRow.socialProfiles,
        nextRow.segment,
        nextRow.ownerName,
        nextRow.status,
        nextRow.score,
        existingContact.id,
      ],
    )

    const updatedRow = updateResult.rows[0] ?? null
    return updatedRow ? { ...updatedRow, action: 'updated' } : null
  }

  const insertResult = await client.query(
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
      returning id, name, company, status, updated_at;
    `,
    [
      nextRow.name,
      nextRow.company,
      nextRow.channel,
      nextRow.socialProfiles,
      nextRow.segment,
      nextRow.ownerName,
      nextRow.status,
      nextRow.score,
    ],
  )

  const insertedRow = insertResult.rows[0] ?? null
  return insertedRow ? { ...insertedRow, action: 'created' } : null
}

const fetchAllTrackingPackagesCatalog = async ({ forceRefresh = false } = {}) => {
  const cacheKey = 'all'
  const cachedCatalog = getCachedValue(packagePipelineSyncCache, cacheKey)
  if (!forceRefresh && cachedCatalog) {
    return cachedCatalog
  }

  const inFlightCacheKey = `${cacheKey}-tracking-in-flight`
  const pendingCatalog = getCachedValue(packagePipelineSyncCache, inFlightCacheKey)
  if (!forceRefresh && pendingCatalog) {
    return pendingCatalog
  }

  reloadLocalEnv()

  const trackingApiDefaults = getTrackingApiDefaults()
  const trackingUrl = new URL('/api/tracking/paquetes', trackingApiDefaults.baseUrl)

  const catalogPromise = fetchAllPaginatedItems({
    url: trackingUrl,
    headers: {
      Authorization: `Bearer ${trackingApiDefaults.token}`,
      Accept: 'application/json',
    },
    perPage: 200,
    maxPages: 500,
  })
    .then((items) =>
      setCachedValue(
        packagePipelineSyncCache,
        cacheKey,
        {
          data: items,
          total: items.length,
          cachedAt: new Date().toISOString(),
        },
        CONTACT_PACKAGES_CATALOG_TTL_MS,
      ),
    )
    .finally(() => {
      packagePipelineSyncCache.delete(inFlightCacheKey)
    })

  setCachedValue(packagePipelineSyncCache, inFlightCacheKey, catalogPromise, CONTACT_PACKAGES_CATALOG_TTL_MS)
  return catalogPromise
}

const getCachedTrackingPackagesCatalog = () => {
  const cachedCatalog = getCachedValue(packagePipelineSyncCache, 'all')
  if (!cachedCatalog || !Array.isArray(cachedCatalog.data)) {
    return null
  }

  return cachedCatalog
}

const getCachedContactPackagesCatalog = () => {
  const cachedCatalog = getCachedValue(contactPackagesCatalogCache, 'all')
  if (!cachedCatalog || !Array.isArray(cachedCatalog.data)) {
    return null
  }

  return cachedCatalog
}

const getEmsPipelineMonthKey = (value) => {
  const normalized = normalizeReference(value)
  if (!normalized) return ''

  const parsed = Date.parse(normalized)
  if (!Number.isFinite(parsed)) return ''

  const date = new Date(parsed)
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

const getEmsStatusLabel = (status) => {
  if (status === 'received') return 'Recibido Origen'
  if (status === 'transit') return 'En Camino'
  if (status === 'regional') return 'Recibido Destino'
  if (status === 'courier') return 'Cartero'
  if (status === 'delivered') return 'Entregado'
  if (status === 'cancelled') return 'Cancelado'
  return normalizeReference(status) || 'Sin estado'
}

const getEmsStageFromContactStatus = (status) => {
  const normalizedStatus = normalizeReference(status).toLowerCase()
  if (normalizedStatus.includes('cancel')) return 'cancelled'
  if (normalizedStatus.includes('entregado') || normalizedStatus.includes('cerrado')) return 'delivered'
  if (normalizedStatus.includes('cartero') || normalizedStatus.includes('reparto')) return 'courier'
  if (normalizedStatus.includes('destino') || normalizedStatus.includes('regional')) return 'regional'
  if (
    normalizedStatus.includes('camino') ||
    normalizedStatus.includes('transito') ||
    normalizedStatus.includes('tránsito') ||
    normalizedStatus.includes('seguimiento')
  ) {
    return 'transit'
  }
  return 'received'
}

const getEmsPackageCodeFromContact = (contact) => {
  const profiles = Array.isArray(contact?.social_profiles) ? contact.social_profiles : []
  const emsProfile = profiles.find((profile) => normalizeReference(profile?.channel).toLowerCase() === 'ems')
  const profileReference = normalizeReference(emsProfile?.reference)
  if (profileReference) return profileReference

  return (
    extractPackageCode(
      [
        contact?.name,
        contact?.company,
        contact?.segment,
        JSON.stringify(contact?.social_profiles ?? []),
      ].join(' '),
    ) || ''
  )
}

const fetchStoredEmsPipelineContacts = async () => {
  await ensureDatabaseReady()
  const result = await pool.query(`
    select id, name, company, channel, social_profiles, segment, owner_name, status, score, updated_at
    from contacts
    where segment ilike '%Paquetes-contactos API%'
    order by updated_at desc, id desc;
  `)

  return result.rows
}

const buildEmsPipelineCards = async () => {
  // NO TOCAR: Pipeline Nacional validado. Usa Paquetes-Contactos API como fuente principal; Tracking API corresponde a Internacional.
  await Promise.all([
    getCachedContactPackagesCatalog() ? Promise.resolve() : fetchAllContactPackagesCatalog(),
    getCachedValue(packageEventsCache, 'all') ? Promise.resolve() : fetchAllPackageEventsCatalog().catch(() => null),
  ])

  const contactCatalog = getCachedContactPackagesCatalog()?.data ?? []
  const packageEventsCatalog = getCachedValue(packageEventsCache, 'all')?.data ?? []
  const storedContacts = await fetchStoredEmsPipelineContacts()
  const latestEventsByCode = buildLatestPackageEventsByCode(packageEventsCatalog)
  const [pipelineConfig, overrides] = await Promise.all([getStoredPipelineConfig(), getStoredEmsStageOverrides()])
  const customColumns = Array.isArray(pipelineConfig?.customColumns) ? pipelineConfig.customColumns : []
  const overrideMap = normalizeEmsStageOverrideMap(overrides)
  const cards = []
  const registeredCardCodes = new Set()

  contactCatalog.forEach((item, index) => {
    const code = normalizeReference(item?.codigo) || `CP-${index + 1}`
    if (!code) return
    const normalizedCode = normalizePackageCodeForLookup(code)
    if (registeredCardCodes.has(normalizedCode)) return
    registeredCardCodes.add(normalizedCode)

    const registeredLatestEvent = latestEventsByCode.get(normalizedCode)
    const stage = overrideMap[code] ?? getNationalPackageStageFromEvent(registeredLatestEvent) ?? inferContactPackageStage(item)
    const senderName =
      normalizeReference(item?.remitente?.nombre) || normalizeReference(item?.origen?.nombre) || 'Sin remitente'
    const recipientName =
      normalizeReference(item?.destinatario?.nombre) || normalizeReference(item?.destino?.nombre) || 'Sin destinatario'

    cards.push({
      id: `contact-${item?.id ?? code}`,
      stage,
      code,
      title: code,
      summary: `${senderName} -> ${recipientName}`,
      senderName,
      senderReference:
        normalizeReference(item?.remitente?.telefono) || normalizeReference(item?.origen?.telefono) || 'Sin referencia',
      recipientName,
      recipientReference:
        normalizeReference(item?.destinatario?.telefono) || normalizeReference(item?.destino?.telefono) || 'Sin referencia',
      destination:
        normalizeReference(item?.destino?.direccion) ||
        normalizeReference(item?.destino?.nombre) ||
        normalizeReference(item?.destinatario?.direccion) ||
        'Sin destino',
      status: getPackageEventLabel(registeredLatestEvent) || normalizeReference(item?.estado?.nombre) || getEmsStatusLabel(stage),
      updatedAt:
        getPackageContextDateValue(registeredLatestEvent?.fecha_registro) ||
        getPackageContextDateValue(registeredLatestEvent?.fecha) ||
        getPackageContextDateValue(item?.fecha_registro) ||
        new Date().toISOString(),
      sourceKind: 'contact',
    })
  })

  storedContacts.forEach((contact) => {
    const code = normalizePackageCodeForLookup(getEmsPackageCodeFromContact(contact))
    if (!code || registeredCardCodes.has(code)) return

    const registeredLatestEvent = latestEventsByCode.get(code)
    const stage = overrideMap[code] ?? getNationalPackageStageFromEvent(registeredLatestEvent) ?? getEmsStageFromContactStatus(contact?.status)
    const eventLabel = getPackageEventLabel(registeredLatestEvent) || getPackageEventTitle(registeredLatestEvent)
    const eventLocation = getPackageEventLocation(registeredLatestEvent)
    registeredCardCodes.add(code)
    cards.push({
      id: `stored-contact-${contact.id}`,
      stage,
      code,
      title: code,
      summary: eventLabel || normalizeReference(contact?.company) || normalizeReference(contact?.segment) || 'Paquete sincronizado',
      senderName: normalizeReference(contact?.owner_name) || 'Integracion EMS',
      senderReference: 'Sin referencia',
      recipientName: normalizeReference(contact?.name) || 'Sin destinatario',
      recipientReference:
        (Array.isArray(contact?.social_profiles)
          ? normalizeReference(
              contact.social_profiles.find((profile) => normalizeReference(profile?.channel).toLowerCase() === 'whatsapp')
                ?.reference,
            )
          : '') || 'Sin referencia',
      destination: eventLocation || normalizeReference(contact?.company) || 'Sin destino',
      status: eventLabel || normalizeReference(contact?.status) || getEmsStatusLabel(stage),
      updatedAt:
        getPackageContextDateValue(registeredLatestEvent?.fecha_registro) ||
        getPackageContextDateValue(registeredLatestEvent?.fecha) ||
        getPackageContextDateValue(registeredLatestEvent?.created_at) ||
        (contact?.updated_at ? new Date(contact.updated_at).toISOString() : new Date().toISOString()),
      sourceKind: 'stored-contact',
    })
  })

  cards.sort((firstCard, secondCard) => {
    const firstTime = Date.parse(firstCard.updatedAt)
    const secondTime = Date.parse(secondCard.updatedAt)
    if (Number.isFinite(firstTime) && Number.isFinite(secondTime) && firstTime !== secondTime) {
      return secondTime - firstTime
    }
    return String(firstCard.code).localeCompare(String(secondCard.code), 'es')
  })

  return { cards, customColumns }
}

const syncPackagePipelineFromApis = async () => {
  await ensureDatabaseReady()
  reloadLocalEnv()

  const [trackingItems, contactPackageCatalog] = await Promise.all([
    fetchAllTrackingPackagesCatalog({ forceRefresh: true }).then((payload) => payload.data ?? []),
    fetchAllContactPackagesCatalog({ forceRefresh: true }).then((payload) => payload.data ?? []),
  ])
  const latestEventsByCode = buildLatestPackageEventsByCode(
    await fetchAllPackageEventsCatalog({ forceRefresh: true })
      .then((payload) => payload.data ?? [])
      .catch(() => []),
  )

  const packageEntriesByCode = new Map()
  const registerEntry = (entry) => {
    if (!entry?.code) return

    const existing = packageEntriesByCode.get(entry.code)
    if (!existing) {
      packageEntriesByCode.set(entry.code, {
        ...entry,
        sources: new Set(entry.sources ?? []),
        phoneCandidates: new Set(entry.phoneCandidates ?? []),
      })
      return
    }

    existing.sources = new Set([...(existing.sources ?? []), ...(entry.sources ?? [])])
    existing.phoneCandidates = new Set([...(existing.phoneCandidates ?? []), ...(entry.phoneCandidates ?? [])])

    const shouldReplace =
      entry.updatedAt > existing.updatedAt ||
      (entry.updatedAt === existing.updatedAt &&
        getPackageSyncEntrySpecificity(entry) > getPackageSyncEntrySpecificity(existing))

    if (shouldReplace) {
      packageEntriesByCode.set(entry.code, {
        ...existing,
        ...entry,
        sources: existing.sources,
        phoneCandidates: existing.phoneCandidates,
      })
    }
  }

  trackingItems.forEach((item) => {
    const code = getPackageCodeFromItem(item)
    if (!code) return

    const registeredLatestEvent = latestEventsByCode.get(normalizePackageCodeForLookup(code))
    const latestEvent = registeredLatestEvent ?? getTrackingLatestEvent(item)
    const stage = getNationalPackageStageFromEvent(registeredLatestEvent) ?? inferTrackingPackageStage(item)
    registerEntry({
      code,
      source: 'tracking',
      stage,
      updatedAt:
        getPackageContextDateValue(latestEvent?.fecha_registro) ||
        getPackageContextDateValue(latestEvent?.fecha) ||
        getPackageContextDateValue(item?.fecha_registro) ||
        0,
      originLabel: getPackageLocationLabel(item?.origen, 'Sin origen'),
      destinationLabel: getTrackingDestinationPlace(item),
      destinationAddress: getTrackingDestinationAddress(item),
      recipientName:
        normalizeReference(item?.destinatario?.nombre) ||
        normalizeReference(item?.remitente?.nombre) ||
        '',
      senderName: normalizeReference(item?.remitente?.nombre) || '',
      primaryPhone: getPackageSyncPhoneCandidates(item, 'tracking')[0] || '',
      latestEventLabel: getPackageEventLabel(latestEvent),
      latestEventLocation: getPackageEventLocation(latestEvent),
      latestEventDate: normalizeReference(latestEvent?.fecha),
      latestEventSignature: getPackageEventSignature(latestEvent),
      sources: ['Tracking'],
      phoneCandidates: getPackageSyncPhoneCandidates(item, 'tracking'),
    })
  })

  contactPackageCatalog.forEach((item) => {
    const code = getPackageCodeFromItem(item)
    if (!code) return

    const registeredLatestEvent = latestEventsByCode.get(normalizePackageCodeForLookup(code))
    const stage = getNationalPackageStageFromEvent(registeredLatestEvent) ?? inferContactPackageStage(item)
    registerEntry({
      code,
      source: 'contact',
      stage,
      updatedAt:
        getPackageContextDateValue(registeredLatestEvent?.fecha_registro) ||
        getPackageContextDateValue(registeredLatestEvent?.fecha) ||
        getPackageContextDateValue(item?.fecha_registro) ||
        0,
      originLabel: getPackageLocationLabel(item?.origen, 'Sin origen'),
      destinationLabel:
        getPackageDepartmentLabel(item?.destino) ||
        getPackageLocationLabel(item?.destino, 'Sin destino') ||
        normalizeReference(item?.destinatario?.direccion) ||
        'Sin destino',
      destinationAddress:
        normalizeReference(item?.destinatario?.direccion) ||
        normalizeReference(item?.destino?.direccion) ||
        '',
      recipientName: normalizeReference(item?.destinatario?.nombre) || '',
      senderName: normalizeReference(item?.remitente?.nombre) || '',
      primaryPhone: getPackageSyncPhoneCandidates(item, 'contact')[0] || '',
      latestEventLabel: getPackageEventLabel(registeredLatestEvent) || normalizeReference(item?.estado?.nombre) || 'Paquete registrado',
      latestEventLocation: getPackageEventLocation(registeredLatestEvent) || getPackageLocationLabel(item?.origen, ''),
      latestEventDate: normalizeReference(registeredLatestEvent?.fecha_registro) || normalizeReference(registeredLatestEvent?.fecha) || normalizeReference(item?.fecha_registro),
      latestEventSignature: getPackageEventSignature(registeredLatestEvent) || [
        normalizeReference(item?.estado?.nombre) || 'Paquete registrado',
        normalizeReference(item?.fecha_registro),
      ]
        .map((value) => normalizeReference(value).toUpperCase())
        .filter(Boolean)
        .join('|'),
      sources: ['Paquetes-Contactos'],
      phoneCandidates: getPackageSyncPhoneCandidates(item, 'contact'),
    })
  })

  const packageEntries = [...packageEntriesByCode.values()]
  const client = await pool.connect()
  const syncedAt = new Date().toISOString()
  let createdCount = 0
  let updatedCount = 0
  const syncedEntries = []

  try {
    await client.query('begin')

    for (const entry of packageEntries) {
      const nextResult = await upsertPackageContact(client, entry)
      if (nextResult?.action === 'created') {
        createdCount += 1
      } else if (nextResult?.action === 'updated') {
        updatedCount += 1
      }
      if (nextResult?.id) {
        syncedEntries.push({ ...entry, contactId: nextResult.id })
      }
    }

    await client.query('commit')
  } catch (error) {
    await client.query('rollback').catch(() => {})
    throw error
  } finally {
    client.release()
  }

  await writeSystemLog({
    event: 'package_pipeline_sync_completed',
    statusCode: 200,
    details: {
      total: packageEntries.length,
      createdCount,
      updatedCount,
      syncedAt,
    },
  }).catch(() => {})

  await notifyPackageEventChanges(syncedEntries).catch(async (error) => {
    await writeSystemLog({
      level: 'error',
      event: 'package_event_change_notification_failed',
      statusCode: 500,
      details: {
        error: error instanceof Error ? error.message : 'Error desconocido.',
      },
    }).catch(() => {})
  })

  return {
    syncedAt,
    createdCount,
    updatedCount,
    total: packageEntries.length,
  }
}

const ensurePackagePipelineSync = async ({ force = false } = {}) => {
  const cached = getCachedValue(packagePipelineSyncCache, 'last-sync')
  if (!force && cached && cached.syncedAt) {
    const age = Date.now() - Date.parse(cached.syncedAt)
    if (Number.isFinite(age) && age >= 0 && age < PACKAGE_PIPELINE_SYNC_TTL_MS) {
      return cached
    }
  }

  const pending = getCachedValue(packagePipelineSyncCache, 'in-flight')
  if (!force && pending) {
    return pending
  }

  const syncPromise = syncPackagePipelineFromApis()
    .then((result) => {
      setCachedValue(packagePipelineSyncCache, 'last-sync', result, PACKAGE_PIPELINE_SYNC_TTL_MS)
      return result
    })
    .finally(() => {
      packagePipelineSyncCache.delete('in-flight')
    })

  setCachedValue(packagePipelineSyncCache, 'in-flight', syncPromise, PACKAGE_PIPELINE_SYNC_TTL_MS)
  return syncPromise
}

const getPackagePipelineSyncSnapshot = () => {
  const cached = getCachedValue(packagePipelineSyncCache, 'last-sync')
  return cached && typeof cached === 'object' ? cached : null
}

const buildPackageEventChangeMessage = ({ contact, entry }) => {
  const contactName = normalizeReference(contact?.name) || 'Hola'
  const packageCode = normalizeReference(entry?.code) || 'tu guia'
  const destination = normalizeReference(entry?.destinationLabel) || 'destino'
  const eventLabel = normalizeReference(entry?.latestEventLabel) || 'Nuevo movimiento registrado'
  const eventLocation = normalizeReference(entry?.latestEventLocation)
  const eventDate = normalizeReference(entry?.latestEventDate)
  const locationText = eventLocation ? ` en ${eventLocation}` : ''
  const dateText = eventDate ? ` (${eventDate})` : ''

  return [
    `¡Hola, ${contactName}! 👋 Tenemos una actualización de tu paquete ${packageCode}.`,
    '',
    `📍 Nuevo evento: ${eventLabel}${locationText}${dateText}.`,
    `🚚 Destino: ${destination}. Te avisaremos cuando se confirme el siguiente movimiento.`,
  ].join('\n')
}

const notifyPackageEventChanges = async (entries = []) => {
  const config = await getStoredWhatsAppConfig()
  const configError = validateWhatsAppConfig(config)

  if (configError) {
    return { sent: 0, skipped: entries.length, reason: configError }
  }

  let sent = 0
  let skipped = 0

  for (const entry of entries) {
    const packageCode = normalizePackageCodeForLookup(entry?.code)
    const eventSignature = normalizeReference(entry?.latestEventSignature)
    const targetPhone = normalizePhoneNumber(entry?.primaryPhone)

    if (!packageCode || !eventSignature || !targetPhone || !entry?.contactId) {
      skipped += 1
      continue
    }

    const lastObservedResult = await pool.query(
      `
        select details
        from system_logs
        where event in ('package_event_observed', 'whatsapp_package_event_update_sent')
          and details->>'packageCode' = $1
        order by created_at desc, id desc
        limit 1;
      `,
      [packageCode],
    )
    const lastSignature = normalizeReference(lastObservedResult.rows[0]?.details?.eventSignature)

    if (lastSignature === eventSignature) {
      skipped += 1
      continue
    }

    const baseDetails = {
      contactId: entry.contactId,
      recipient: targetPhone,
      packageCode,
      eventSignature,
      packageStage: entry.stage,
      eventLabel: entry.latestEventLabel,
      eventLocation: entry.latestEventLocation,
      eventDate: entry.latestEventDate,
    }

    if (!lastSignature) {
      await writeSystemLog({
        event: 'package_event_observed',
        statusCode: 200,
        details: baseDetails,
      }).catch(() => {})
      skipped += 1
      continue
    }

    const outboundHistoryResult = await pool.query(
      `
        select id
        from message_logs
        where channel = 'WhatsApp'
          and direction = 'outbound'
          and contact_id = $1
        order by created_at desc, id desc
        limit 1;
      `,
      [entry.contactId],
    )

    if (!outboundHistoryResult.rows[0]) {
      await writeSystemLog({
        event: 'package_event_observed',
        statusCode: 200,
        details: {
          ...baseDetails,
          reason: 'conversation-not-started',
        },
      }).catch(() => {})
      skipped += 1
      continue
    }

    const contact = await findPackageContactByCode(packageCode)
    const messageBody = buildPackageEventChangeMessage({ contact, entry })
    const providerResponse = await sendWhatsAppCloudMessage({
      accessToken: config.accessToken,
      apiVersion: config.apiVersion,
      phoneNumberId: config.phoneNumberId,
      to: targetPhone,
      body: messageBody,
    })
    const providerMessageId = providerResponse?.messages?.[0]?.id ?? providerResponse?.message_id ?? null

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
      [entry.contactId, targetPhone, messageBody, providerMessageId],
    )

    await writeSystemLog({
      event: 'whatsapp_package_event_update_sent',
      statusCode: 200,
      details: {
        ...baseDetails,
        providerMessageId,
      },
    }).catch(() => {})

    sent += 1
  }

  return { sent, skipped }
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

const getPaginatedPayloadItems = (payload) => {
  if (Array.isArray(payload)) return payload

  const candidateArrays = [
    payload?.data,
    payload?.items,
    payload?.eventos,
    payload?.results,
    payload?.records,
    payload?.paquetes,
  ]

  for (const candidate of candidateArrays) {
    if (Array.isArray(candidate)) return candidate
  }

  return []
}

const getPaginatedPayloadTotal = (payload) => {
  const numericCandidates = [
    payload?.total_registros,
    payload?.paginacion?.total_registros,
    payload?.total,
    payload?.paginacion?.total,
    payload?.pagination?.total_registros,
    payload?.pagination?.total,
    payload?.meta?.total,
    payload?.meta?.total_registros,
    payload?.meta?.count,
    payload?.count,
  ]

  for (const candidate of numericCandidates) {
    const numericValue = Number(candidate)
    if (Number.isFinite(numericValue) && numericValue >= 0) {
      return numericValue
    }
  }

  const lastPage = Number(
    payload?.last_page ||
    payload?.ultima_pagina ||
    payload?.paginacion?.ultima_pagina ||
    payload?.pagination?.last_page ||
    payload?.meta?.last_page,
  )
  const perPage = Number(
    payload?.per_page ||
    payload?.por_pagina ||
    payload?.paginacion?.por_pagina ||
    payload?.pagination?.per_page ||
    payload?.meta?.per_page,
  )

  if (Number.isFinite(lastPage) && lastPage > 0 && Number.isFinite(perPage) && perPage > 0) {
    return lastPage * perPage
  }

  return null
}

const fetchAllPaginatedItems = async ({
  url,
  headers,
  perPage = 100,
  maxPages = 50,
  stopWhen = null,
  timeoutMs = 30000,
}) => {
  const allItems = []

  for (let page = 1; page <= maxPages; page += 1) {
    const paginatedUrl = new URL(url.toString())
    paginatedUrl.searchParams.set('page', String(page))
    paginatedUrl.searchParams.set('per_page', String(perPage))

    let response = null
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      response = await fetchJsonWithTimeout(paginatedUrl, { headers }, timeoutMs).catch(() => null)
      if (response?.status !== 429) break

      const retryAfterSeconds = Number(response.headers?.get?.('retry-after'))
      const retryDelayMs = Number.isFinite(retryAfterSeconds)
        ? Math.min(Math.max(retryAfterSeconds * 1000, 1000), 10000)
        : attempt * 1500
      await sleep(retryDelayMs)
    }

    if (!response?.ok) {
      break
    }

    const payload = await response.json().catch(() => null)
    const pageItems = getPaginatedPayloadItems(payload)
    if (!pageItems.length) {
      break
    }

    allItems.push(...pageItems)

    if (typeof stopWhen === 'function' && stopWhen(pageItems, allItems, payload)) {
      break
    }

    const totalItems = getPaginatedPayloadTotal(payload)
    if (Number.isFinite(totalItems) && allItems.length >= totalItems) {
      break
    }
  }

  return allItems
}

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

  const shortCodeMatches = normalized.matchAll(/\b(?:CODIGO|C[OÓ]DIGO|GUIA|GU[IÍ]A|TRACKING|PAQUETE)\s*(?:N(?:RO|UMERO)?\.?|#|:)?\s*(\d{3,7})\b/g)

  for (const match of shortCodeMatches) {
    const compactCandidate = normalizePackageCodeForLookup(match[1])
    if (!compactCandidate || seen.has(compactCandidate) || PACKAGE_CODE_STOP_WORDS.has(compactCandidate)) {
      continue
    }

    seen.add(compactCandidate)
    uniqueCandidates.push(compactCandidate)
  }

  return uniqueCandidates.sort((first, second) => second.length - first.length)
}

const extractPackageCode = (messageBody) => {
  return extractPackageCodeCandidates(messageBody)[0] || ''
}

const normalizePackageCodeForLookup = (value) => {
  return normalizeReference(value).replace(/[^A-Z0-9]/gi, '').toUpperCase()
}

const getPackageCodeValuesForLookup = (item) => {
  return [item?.codigo_s10, item?.codigo, item?.codigoSeguimiento, item?.tracking]
    .map(normalizePackageCodeForLookup)
    .filter(Boolean)
}

const getPackageEventsPayloadItems = (payload) => {
  if (Array.isArray(payload)) {
    return payload
  }

  const candidateArrays = [
    payload?.data,
    payload?.items,
    payload?.eventos,
    payload?.results,
    payload?.records,
  ]

  for (const candidate of candidateArrays) {
    if (Array.isArray(candidate)) {
      return candidate
    }
  }

  return []
}

const getPackageEventCodeValuesForLookup = (item) => {
  return [
    item?.codigo_s10,
    item?.codigo,
    item?.codigoSeguimiento,
    item?.tracking,
    item?.paquete?.codigo_s10,
    item?.paquete?.codigo,
    item?.paquete?.codigoSeguimiento,
  ]
    .map(normalizePackageCodeForLookup)
    .filter(Boolean)
}

const getPackageEventTimestampValue = (item) => {
  const candidateValues = [
    item?.fecha_registro,
    item?.fecha,
    item?.created_at,
    item?.updated_at,
    item?.timestamp,
  ]

  for (const candidate of candidateValues) {
    const parsed = Date.parse(normalizeReference(candidate))
    if (!Number.isNaN(parsed)) {
      return parsed
    }
  }

  return 0
}

const getPackageEventTitle = (item) =>
  normalizeReference(item?.evento_api) ||
  normalizeReference(item?.evento_original) ||
  normalizeReference(item?.evento) ||
  normalizeReference(item?.estado?.nombre) ||
  normalizeReference(item?.estado) ||
  normalizeReference(item?.descripcion) ||
  normalizeReference(item?.detalle) ||
  'Evento sin nombre'

const getPackageEventLocation = (item) =>
  normalizeReference(item?.oficina) ||
  normalizeReference(item?.ubicacion) ||
  normalizeReference(item?.lugar) ||
  normalizeReference(item?.regional) ||
  normalizeReference(item?.departamento) ||
  normalizeReference(item?.ciudad) ||
  normalizeReference(item?.detalle) ||
  ''

const buildPackageEventsTimelineText = (events, packageCode = '') => {
  const orderedEvents = (Array.isArray(events) ? events : [])
    .slice()
    .sort((firstEvent, secondEvent) => getPackageEventTimestampValue(firstEvent) - getPackageEventTimestampValue(secondEvent))

  if (!orderedEvents.length) {
    return ''
  }

  const lines = orderedEvents.map((event, index) => {
    const timestamp = getPackageEventTimestampValue(event)
    const formattedTime = timestamp ? new Date(timestamp).toISOString() : 'sin fecha'
    const title = getPackageEventTitle(event)
    const location = getPackageEventLocation(event)
    const locationText = location ? ` | ${location}` : ''

    return `${index + 1}. ${formattedTime} | ${title}${locationText}`
  })

  const latestEvent = orderedEvents[orderedEvents.length - 1] ?? null
  const latestLocation = getPackageEventLocation(latestEvent) || 'sin ubicacion precisa'

  return [
    packageCode ? `Eventos del paquete ${packageCode}:` : 'Eventos del paquete:',
    ...lines,
    `Ultima ubicacion conocida: ${latestLocation}`,
  ].join('\n')
}

const findPackageCodeInPaginatedApi = async ({
  url,
  headers,
  source,
  code,
  perPage = 100,
  maxPages = 500,
}) => {
  let pagesChecked = 0
  let totalItems = 0
  let statusCode = null
  let errorMessage = ''

  for (let page = 1; page <= maxPages; page += 1) {
    const paginatedUrl = new URL(url.toString())
    paginatedUrl.searchParams.set('page', String(page))
    paginatedUrl.searchParams.set('per_page', String(perPage))

    const response = await fetchJsonWithTimeout(paginatedUrl, { headers }).catch(() => null)
    pagesChecked = page

    if (!response?.ok) {
      statusCode = response?.status ?? 502
      errorMessage = response ? `La API respondio con estado ${response.status}.` : 'No se obtuvo respuesta de la API.'
      break
    }

    statusCode = response.status
    const payload = await response.json().catch(() => null)
    const items = getPaginatedPayloadItems(payload)
    totalItems = getPaginatedPayloadTotal(payload) ?? Math.max(totalItems, page * perPage, items.length)

    const match = items.find((item) => getPackageCodeValuesForLookup(item).includes(code))
    if (match) {
      return {
        source,
        found: true,
        pagesChecked,
        pageFound: page,
        totalItems,
        statusCode,
        code,
        matchedFields: getPackageCodeValuesForLookup(match),
        record: match,
      }
    }

    if (!items.length) {
      break
    }

    if (totalItems > 0 && page * perPage >= totalItems) {
      break
    }
  }

  return {
    source,
    found: false,
    pagesChecked,
    pageFound: null,
    totalItems,
    statusCode,
    code,
    matchedFields: [],
    record: null,
    error: errorMessage,
  }
}

const fetchExactPackageCodeMatches = async ({
  url,
  headers,
  queryParam,
  code,
  perPage = 100,
  timeoutMs = 15000,
}) => {
  const lookupUrl = new URL(url.toString())
  lookupUrl.searchParams.set(queryParam, code)
  lookupUrl.searchParams.set('page', '1')
  lookupUrl.searchParams.set('per_page', String(perPage))

  const response = await fetchJsonWithTimeout(lookupUrl, { headers }, timeoutMs).catch(() => null)
  if (!response?.ok) {
    return {
      ok: false,
      statusCode: response?.status ?? 502,
      items: [],
      totalItems: 0,
    }
  }

  const payload = await response.json().catch(() => null)
  const items = getPaginatedPayloadItems(payload)
  return {
    ok: true,
    statusCode: response.status,
    items,
    totalItems: getPaginatedPayloadTotal(payload) ?? items.length,
    payload,
  }
}

const buildPackageAgentFacts = ({
  trackingItems = [],
  contactItems = [],
  normalizedPackageCode = '',
}) => {
  const facts = []

  if (normalizedPackageCode) {
    facts.push(`Codigo consultado: ${normalizedPackageCode}`)
    facts.push('Metodo de busqueda aplicado: primero coincidencia exacta por codigo; si no aparece, barrido paginado.')
  }

  if (contactItems[0]) {
    const item = contactItems[0]
    facts.push('Fuente principal sugerida: paquetes-contactos')
    facts.push(`Codigo exacto encontrado en paquetes-contactos: ${normalizeReference(item?.codigo) || normalizedPackageCode || 'Sin codigo'}`)
    facts.push(`Estado en paquetes-contactos: ${normalizeReference(item?.estado?.nombre) || 'Sin estado'}`)
    facts.push(`Tipo: ${normalizeReference(item?.tipo) || 'Sin tipo'}`)
    facts.push(`Origen: ${getPackageLocationLabel(item?.origen, 'Sin origen')}`)
    facts.push(`Destino: ${getPackageLocationLabel(item?.destino, 'Sin destino') || normalizeReference(item?.destinatario?.direccion) || 'Sin destino'}`)
    facts.push(`Remitente: ${normalizeReference(item?.remitente?.nombre) || 'Sin remitente'}`)
    facts.push(`Telefono remitente: ${normalizeReference(item?.remitente?.telefono) || 'Sin telefono'}`)
    facts.push(`Destinatario: ${normalizeReference(item?.destinatario?.nombre) || 'Sin destinatario'}`)
    facts.push(`Telefono destinatario: ${normalizeReference(item?.destinatario?.telefono) || 'Sin telefono'}`)
    facts.push(`Direccion destinatario: ${normalizeReference(item?.destinatario?.direccion) || normalizeReference(item?.destino?.direccion) || 'Sin direccion'}`)
    facts.push(`Fecha registro: ${normalizeReference(item?.fecha_registro) || 'Sin fecha'}`)
  }

  if (trackingItems[0]) {
    const item = trackingItems[0]
    const latestEvent = getTrackingLatestEvent(item)
    facts.push('Fuente adicional disponible: tracking')
    facts.push(`Codigo exacto encontrado en tracking: ${normalizeReference(item?.codigo_s10) || normalizeReference(item?.codigo) || normalizedPackageCode || 'Sin codigo'}`)
    facts.push(`Estado en tracking: ${normalizeReference(item?.estado?.nombre) || normalizeReference(item?.estado_postal) || 'Sin estado'}`)
    facts.push(`Origen tracking: ${getPackageLocationLabel(item?.origen, 'Sin origen')}`)
    facts.push(`Destino tracking: ${getTrackingDestinationPlace(item)}`)
    facts.push(`Ultimo evento tracking: ${normalizeReference(latestEvent?.evento_api) || normalizeReference(latestEvent?.evento_original) || 'Sin evento'}`)
    facts.push(`Ultima oficina tracking: ${normalizeReference(latestEvent?.oficina) || normalizeReference(latestEvent?.detalle) || 'Sin oficina'}`)
    facts.push(`Fecha ultimo evento tracking: ${normalizeReference(latestEvent?.fecha) || normalizeReference(item?.fecha_registro) || 'Sin fecha'}`)
  }

  return facts.filter(Boolean).join('\n')
}

const fetchMatchingPackageContext = async (reference, packageCode = '') => {
  const cacheKey = `${normalizePhoneNumber(reference)}::${normalizeReference(packageCode).toUpperCase()}`
  const cachedContext = getCachedValue(packageContextCache, cacheKey)
  if (cachedContext) {
    return cachedContext
  }

  const normalizedReference = normalizeReference(reference)
  const targetCandidates = new Set([
    normalizePhoneNumber(normalizedReference),
    ...getWhatsAppNumberCandidates(normalizedReference),
    ...getBoliviaTestNumberCandidates(normalizedReference),
  ].filter(Boolean))

  if (targetCandidates.size === 0) {
    return setCachedValue(packageContextCache, cacheKey, {
      matched: false,
      isTestModeNumber: false,
      stage: null,
      currentPackageCode: '',
      currentPackageUpdatedAt: 0,
      packageCodes: [],
      summaryText: '',
      agentFactsText: '',
      lifecycleInstruction: '',
    }, PACKAGE_CONTEXT_TTL_MS)
  }

  reloadLocalEnv()

  const trackingApiDefaults = getTrackingApiDefaults()
  const trackingUrl = new URL('/api/tracking/paquetes', trackingApiDefaults.baseUrl)

  const contactPackagesApiDefaults = getContactPackagesApiDefaults()
  const contactUrl = new URL(contactPackagesApiDefaults.endpoint)

  const normalizedPackageCode = normalizeReference(packageCode).toUpperCase()
  const matchesCode = (item) => {
    if (!normalizedPackageCode) return true
    return getPackageCodeValuesForLookup(item).includes(normalizedPackageCode)
  }

  const trackingHeaders = {
    Authorization: `Bearer ${trackingApiDefaults.token}`,
    Accept: 'application/json',
  }
  const contactHeaders = {
    Authorization: `Bearer ${contactPackagesApiDefaults.token}`,
    Accept: 'application/json',
  }

  let trackingItems = []
  let contactItems = []

  if (normalizedPackageCode) {
    const [exactTrackingResult, exactContactResult] = await Promise.all([
      fetchExactPackageCodeMatches({
        url: trackingUrl,
        headers: trackingHeaders,
        queryParam: 'q',
        code: normalizedPackageCode,
      }),
      fetchExactPackageCodeMatches({
        url: contactUrl,
        headers: contactHeaders,
        queryParam: 'codigo',
        code: normalizedPackageCode,
      }),
    ])

    trackingItems = exactTrackingResult.items
    contactItems = exactContactResult.items

    if (!trackingItems.length && !contactItems.length) {
      ;[trackingItems, contactItems] = await Promise.all([
        fetchAllPaginatedItems({
          url: trackingUrl,
          headers: trackingHeaders,
          perPage: 100,
          maxPages: 500,
          stopWhen: (pageItems) => pageItems.some((item) => matchesCode(item)),
        }),
        fetchAllPaginatedItems({
          url: contactUrl,
          headers: contactHeaders,
          perPage: 100,
          maxPages: 500,
          stopWhen: (pageItems) => pageItems.some((item) => matchesCode(item)),
        }),
      ])
    }
  } else {
    ;[trackingItems, contactItems] = await Promise.all([
      fetchAllPaginatedItems({
        url: trackingUrl,
        headers: trackingHeaders,
        perPage: 100,
        maxPages: 5,
      }),
      fetchAllPaginatedItems({
        url: contactUrl,
        headers: contactHeaders,
        perPage: 100,
        maxPages: 5,
      }),
    ])
  }

  const matchingTrackingItems = trackingItems.filter(
    (item) =>
      (normalizedPackageCode
        ? matchesCode(item)
        : extractTrackingApiPhoneCandidates(item).some((candidate) =>
            getBoliviaTestNumberCandidates(candidate).some((normalizedCandidate) => targetCandidates.has(normalizedCandidate)) ||
            targetCandidates.has(candidate),
          )),
  )

  const matchingContactItems = contactItems.filter(
    (item) =>
      (normalizedPackageCode
        ? matchesCode(item)
        : extractContactPackagesPhoneCandidates(item).some((candidate) =>
            getBoliviaTestNumberCandidates(candidate).some((normalizedCandidate) => targetCandidates.has(normalizedCandidate)) ||
            targetCandidates.has(candidate),
          )),
  )

  const trackingPackageEntries = matchingTrackingItems.map((item) => {
    const latestEvent = getTrackingLatestEvent(item)
    const statusText =
      normalizeReference(item?.estado?.nombre) ||
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
    const destinationAddress = getTrackingDestinationAddress(item)
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
      destinationAddress,
      summary: [
        `Tracking ${packageCode}`,
        `estado ${statusText}`,
        `origen ${getPackageLocationLabel(item?.origen, 'Sin origen')}`,
        originDepartment ? `departamento origen ${originDepartment}` : '',
        `destino ${destinationLabel}`,
        destinationDepartment ? `departamento destino ${destinationDepartment}` : '',
        destinationAddress ? `direccion destino ${destinationAddress}` : '',
        `ultimo punto ${latestLocation}`,
        normalizeReference(latestEvent?.fecha) ? `fecha ${normalizeReference(latestEvent?.fecha)}` : '',
      ]
        .filter(Boolean)
        .join(' | '),
    }
  })

  const contactPackageEntries = matchingContactItems.map((item) => {
    const packageCode = normalizeReference(item?.codigo) || normalizeReference(item?.id) || 'Sin codigo'
    const statusText = normalizeReference(item?.estado?.nombre) || 'Sin estado'
    const originDepartment = getPackageDepartmentLabel(item?.origen)
    const destinationDepartment = getPackageDepartmentLabel(item?.destino)
    const destinationLabel =
      getPackageDepartmentLabel(item?.destino) ||
      getPackageLocationLabel(item?.destino, 'Sin destino') ||
      normalizeReference(item?.destinatario?.direccion)
    const destinationAddress =
      normalizeReference(item?.destinatario?.direccion) ||
      normalizeReference(item?.destino?.direccion) ||
      ''
    return {
      code: packageCode,
      source: 'contact',
      stage: inferContactPackageStage(item),
      updatedAt: getPackageContextDateValue(item?.fecha_registro),
      originLabel: getPackageLocationLabel(item?.origen, 'Sin origen'),
      originDepartment,
      destinationLabel,
      destinationDepartment,
      destinationAddress,
      summary: [
        `Paquete-contacto ${packageCode}`,
        `estado ${statusText}`,
        `tipo ${normalizeReference(item?.tipo) || 'Sin tipo'}`,
        `remitente ${normalizeReference(item?.remitente?.nombre) || 'Sin remitente'}`,
        `destinatario ${normalizeReference(item?.destinatario?.nombre) || 'Sin destinatario'}`,
        originDepartment ? `departamento origen ${originDepartment}` : '',
        `destino ${destinationLabel}`,
        destinationDepartment ? `departamento destino ${destinationDepartment}` : '',
        destinationAddress ? `direccion destino ${destinationAddress}` : '',
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
  const mostAdvancedEntry =
    relatedEntries
      .slice()
      .sort((firstEntry, secondEntry) => {
        const stageDelta = getPackageStageRank(secondEntry.stage) - getPackageStageRank(firstEntry.stage)
        if (stageDelta !== 0) {
          return stageDelta
        }

        if (secondEntry.updatedAt !== firstEntry.updatedAt) {
          return secondEntry.updatedAt - firstEntry.updatedAt
        }

        return getEntrySpecificityScore(secondEntry) - getEntrySpecificityScore(firstEntry)
      })[0] ?? latestPackageEntry
  const stage = mostAdvancedEntry?.stage ?? latestPackageEntry?.stage ?? null

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
  const agentFactsText = buildPackageAgentFacts({
    trackingItems: matchingTrackingItems,
    contactItems: matchingContactItems,
    normalizedPackageCode,
  })
  const primaryPackageCode =
    normalizeReference(mostAdvancedEntry?.code) ||
    normalizeReference(latestPackageEntry?.code) ||
    normalizedPackageCode
  const packageEventsPayload = primaryPackageCode ? await fetchPackageEventsForCode(primaryPackageCode) : null
  const packageEvents = Array.isArray(packageEventsPayload?.data) ? packageEventsPayload.data : []
  const packageEventsText = buildPackageEventsTimelineText(packageEvents, primaryPackageCode)

  return setCachedValue(packageContextCache, cacheKey, {
    matched: matchingTrackingItems.length > 0 || matchingContactItems.length > 0,
    isTestModeNumber,
    stage,
    currentPackageCode: mostAdvancedEntry?.code ?? latestPackageEntry?.code ?? '',
    currentPackageUpdatedAt: mostAdvancedEntry?.updatedAt ?? latestPackageEntry?.updatedAt ?? 0,
    currentOriginLabel: mostSpecificEntry?.originLabel ?? mostAdvancedEntry?.originLabel ?? latestPackageEntry?.originLabel ?? '',
    currentOriginDepartment:
      mostSpecificEntry?.originDepartment ?? mostAdvancedEntry?.originDepartment ?? latestPackageEntry?.originDepartment ?? '',
    currentDestinationLabel:
      mostSpecificEntry?.destinationLabel ?? mostAdvancedEntry?.destinationLabel ?? latestPackageEntry?.destinationLabel ?? '',
    currentDestinationDepartment:
      mostSpecificEntry?.destinationDepartment ?? mostAdvancedEntry?.destinationDepartment ?? latestPackageEntry?.destinationDepartment ?? '',
    currentDestinationAddress:
      mostSpecificEntry?.destinationAddress ?? mostAdvancedEntry?.destinationAddress ?? latestPackageEntry?.destinationAddress ?? '',
    packageCodes: [...new Set(packageEntries.map((entry) => entry.code).filter(Boolean))],
    summaryText: summarySections.join('\n\n'),
    agentFactsText,
    packageEvents,
    packageEventsText,
    packageEventsCount: packageEvents.length,
    lifecycleInstruction: getPackageLifecycleInstruction(stage),
  }, PACKAGE_CONTEXT_TTL_MS)
}

const isTestModeNumberListedInApis = async (targetNumber) => {
  const packageContext = await fetchMatchingPackageContext(targetNumber)
  return packageContext.matched
}

app.get('/api/package-code-lookup', cors(), authMiddleware, async (request, response) => {
  try {
    reloadLocalEnv()

    const rawQuery = normalizeReference(request.query.code)
    const extractedCode = extractPackageCode(rawQuery)
    const normalizedCode = normalizePackageCodeForLookup(extractedCode || rawQuery)

    if (!normalizedCode) {
      response.status(400).json({
        error: 'Debes indicar un codigo para buscar.',
        query: rawQuery,
        extractedCode,
        normalizedCode,
      })
      return
    }

    const trackingApiDefaults = getTrackingApiDefaults()
    const contactPackagesApiDefaults = getContactPackagesApiDefaults()
    const trackingUrl = new URL('/api/tracking/paquetes', trackingApiDefaults.baseUrl)
    const contactUrl = new URL(contactPackagesApiDefaults.endpoint)
    const trackingHeaders = {
      Authorization: `Bearer ${trackingApiDefaults.token}`,
      Accept: 'application/json',
    }
    const contactHeaders = {
      Authorization: `Bearer ${contactPackagesApiDefaults.token}`,
      Accept: 'application/json',
    }

    const [trackingExact, contactExact] = await Promise.all([
      fetchExactPackageCodeMatches({
        url: trackingUrl,
        headers: trackingHeaders,
        queryParam: 'q',
        code: normalizedCode,
      }),
      fetchExactPackageCodeMatches({
        url: contactUrl,
        headers: contactHeaders,
        queryParam: 'codigo',
        code: normalizedCode,
      }),
    ])

    const trackingExactMatch =
      trackingExact.items.find((item) => getPackageCodeValuesForLookup(item).includes(normalizedCode)) ?? null
    const contactExactMatch =
      contactExact.items.find((item) => getPackageCodeValuesForLookup(item).includes(normalizedCode)) ?? null

    const [tracking, contact] =
      trackingExactMatch || contactExactMatch
        ? [
            {
              source: 'tracking',
              found: Boolean(trackingExactMatch),
              pagesChecked: 1,
              pageFound: trackingExactMatch ? 1 : null,
              totalItems: trackingExact.totalItems,
              statusCode: trackingExact.statusCode,
              code: normalizedCode,
              matchedFields: trackingExactMatch ? getPackageCodeValuesForLookup(trackingExactMatch) : [],
              record: trackingExactMatch,
              error: trackingExact.ok ? '' : 'No se pudo consultar la API de tracking.',
            },
            {
              source: 'contactos',
              found: Boolean(contactExactMatch),
              pagesChecked: 1,
              pageFound: contactExactMatch ? 1 : null,
              totalItems: contactExact.totalItems,
              statusCode: contactExact.statusCode,
              code: normalizedCode,
              matchedFields: contactExactMatch ? getPackageCodeValuesForLookup(contactExactMatch) : [],
              record: contactExactMatch,
              error: contactExact.ok ? '' : 'No se pudo consultar la API de paquetes-contactos.',
            },
          ]
        : await Promise.all([
            findPackageCodeInPaginatedApi({
              url: trackingUrl,
              headers: trackingHeaders,
              source: 'tracking',
              code: normalizedCode,
            }),
            findPackageCodeInPaginatedApi({
              url: contactUrl,
              headers: contactHeaders,
              source: 'contactos',
              code: normalizedCode,
            }),
          ])

    response.json({
      query: rawQuery,
      extractedCode,
      normalizedCode,
      found: tracking.found || contact.found,
      tracking,
      contact,
    })
  } catch (error) {
    response.status(502).json({
      error: 'No se pudo ejecutar la busqueda del codigo.',
      message: error instanceof Error ? error.message : 'Error desconocido.',
    })
  }
})

const getStoredAiAgentConfig = async (client = pool) => {
  const settings = await getStoredSettingsByKey('crm_ai_agent', client)
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

  return saveSettingsByKey('crm_ai_agent', nextConfig)
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

  let response

  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      body: formData,
    })
  } catch (error) {
    throw new Error(describeFetchFailure(error, 'No se pudo conectar con WhatsApp Meta para subir el archivo'))
  }

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

  let response

  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(messagePayload),
    })
  } catch (error) {
    throw new Error(describeFetchFailure(error, 'No se pudo conectar con WhatsApp Meta para enviar el mensaje'))
  }

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
  model:
    normalizeReference(process.env.AI_GENERAL_MODEL) ||
    normalizeReference(process.env.AI_MODEL) ||
    aiDefaults.generalModel,
  generalModel:
    normalizeReference(process.env.AI_GENERAL_MODEL) ||
    normalizeReference(process.env.AI_MODEL) ||
    aiDefaults.generalModel,
  routerModel: normalizeReference(process.env.AI_ROUTER_MODEL) || aiDefaults.routerModel,
  trackingModel: normalizeReference(process.env.AI_TRACKING_MODEL) || aiDefaults.trackingModel,
  systemPrompt: normalizeReference(process.env.AI_SYSTEM_PROMPT) || aiDefaults.systemPrompt,
  routerSystemPrompt:
    normalizeReference(process.env.AI_ROUTER_SYSTEM_PROMPT) || aiDefaults.routerSystemPrompt,
  trackingSystemPrompt:
    normalizeReference(process.env.AI_TRACKING_SYSTEM_PROMPT) || aiDefaults.trackingSystemPrompt,
  routerTimeoutMs: getNormalizedTimeoutMs(Number.parseInt(process.env.AI_ROUTER_TIMEOUT_MS || '', 10), aiDefaults.routerTimeoutMs),
  generalTimeoutMs: getNormalizedTimeoutMs(
    Number.parseInt(process.env.AI_GENERAL_TIMEOUT_MS || '', 10),
    aiDefaults.generalTimeoutMs,
  ),
  trackingTimeoutMs: getNormalizedTimeoutMs(
    Number.parseInt(process.env.AI_TRACKING_TIMEOUT_MS || '', 10),
    aiDefaults.trackingTimeoutMs,
  ),
})

const isAiServiceReachable = async (baseUrl, timeoutMs = 1500) => {
  const cacheKey = `${normalizeReference(baseUrl)}::${timeoutMs}`
  const cachedHealth = getCachedValue(aiHealthCache, cacheKey)

  if (cachedHealth != null) {
    return cachedHealth
  }

  try {
    const response = await fetchJsonWithTimeout(
      `${baseUrl.replace(/\/$/, '')}/api/tags`,
      {
        headers: {
          Accept: 'application/json',
        },
      },
      timeoutMs,
    )

    return setCachedValue(aiHealthCache, cacheKey, response.ok, AI_HEALTH_TTL_MS)
  } catch {
    return setCachedValue(aiHealthCache, cacheKey, false, AI_HEALTH_TTL_MS)
  }
}

const getAvailableAiModels = async (baseUrl) => {
  const response = await fetchJsonWithTimeout(
    `${baseUrl.replace(/\/$/, '')}/api/tags`,
    {
      headers: {
        Accept: 'application/json',
      },
    },
    3000,
  )

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

const resolveAiModel = async (config, fallbackModels = []) => {
  const configuredModel = normalizeReference(config.model)
  const normalizedFallbackModels = fallbackModels.map(normalizeReference).filter(Boolean)
  const cacheKey = `${normalizeReference(config.baseUrl)}::${configuredModel}::${normalizedFallbackModels.join('|')}`
  const cachedModel = getCachedValue(aiModelCache, cacheKey)
  if (cachedModel) {
    return cachedModel
  }
  const availableModels = await getAvailableAiModels(config.baseUrl)

  const candidateModels = [configuredModel, ...normalizedFallbackModels].filter(Boolean)

  for (const candidateModel of candidateModels) {
    if (availableModels.includes(candidateModel)) {
      return setCachedValue(aiModelCache, cacheKey, candidateModel, AI_MODEL_TTL_MS)
    }
  }

  if (availableModels.length > 0) {
    console.warn(
      `El modelo de IA "${configuredModel || '(sin configurar)'}" no esta disponible. Se usara "${availableModels[0]}".`,
    )
    return setCachedValue(aiModelCache, cacheKey, availableModels[0], AI_MODEL_TTL_MS)
  }

  return setCachedValue(aiModelCache, cacheKey, configuredModel, AI_MODEL_TTL_MS)
}

const AI_ROUTER_CATEGORIES = new Set(['TRACKING', 'TARIFAS', 'GENERAL'])

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
  if (emsStatus === 'cancelled') return 'Cancelado'
  return 'Nuevo'
}

const getEmsStatusRank = (status) => {
  if (status === 'received') return 0
  if (status === 'transit') return 1
  if (status === 'regional') return 2
  if (status === 'courier') return 3
  if (status === 'delivered') return 4
  if (status === 'cancelled') return 5
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

  if (
    normalized.includes('cancel') ||
    normalized.includes('anul') ||
    normalized.includes('rechaz') ||
    normalized.includes('devuelto') ||
    normalized.includes('retornado')
  ) {
    return 'cancelled'
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
    normalized.includes('recibido destino') ||
    normalized.includes('recibido regional') ||
    normalized.includes('sucursal de destino') ||
    normalized.includes('pasar a recoger')
  ) {
    return 'regional'
  }

  if (
    normalized === 'recibido' ||
    normalized === 'recibida' ||
    normalized.includes('recibido en origen') ||
    normalized.includes('sucursal de origen')
  ) {
    return 'received'
  }

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

const syncContactEmsStatus = async ({
  contactId,
  currentContact = null,
  recentMessages = null,
  providedPackageContext = null,
} = {}) => {
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
  const packageContext =
    providedPackageContext ??
    (whatsappReference ? await fetchMatchingPackageContext(whatsappReference) : null)

  const conversationContext = buildAiConversationContext(messages.slice().reverse())

  let inferredStatus =
    packageContext?.matched && packageContext.stage
      ? packageContext.stage
      : inferEmsStatusFromText(conversationContext || contact.status) || 'received'

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

const BOLIVIA_BRANCH_LOCATIONS = [
  {
    terms: ['la paz', 'oficina central', 'lapaz', 'sede central'],
    label: 'La Paz',
    address: 'Av. Mariscal Santa Cruz N 1260, esq. Calle Oruro (Edificio Telecomunicaciones).',
  },
  {
    terms: ['cochabamba', 'cbba'],
    label: 'Cochabamba',
    address: 'Calle Ayacucho N 113 esq. Av. Heroinas.',
  },
  {
    terms: ['santa cruz', 'scz'],
    label: 'Santa Cruz',
    address: 'Calle Cobija entre Sucre y Ballivian N 24.',
  },
  {
    terms: ['oruro'],
    label: 'Oruro',
    address: 'Calle Presidente Montes esq. Junin N 1456.',
  },
  {
    terms: ['potosi', 'villa imperial'],
    label: 'Potosi',
    address: 'Calle Hoyos esq. Topater, Villa Imperial de Potosi.',
  },
  {
    terms: ['tarija'],
    label: 'Tarija',
    address: 'Calle Mariscal Sucre esq. Virginio Lema N 397.',
  },
  {
    terms: ['sucre', 'chuquisaca'],
    label: 'Sucre (Chuquisaca)',
    address: 'Calle Junin esq. Ayacucho N 699.',
  },
  {
    terms: ['beni', 'trinidad'],
    label: 'Beni',
    address: 'Calle Cipriano Barace N 10 entre Manuel Limpias y Calle Sucre.',
  },
  {
    terms: ['pando', 'cobija'],
    label: 'Pando',
    address: 'Av. Bruno Racua N 59.',
  },
]

const normalizeSearchText = (value) => normalizeReference(value).toLowerCase()

const getBoliviaBranchLocation = (value) => {
  const normalized = normalizeSearchText(value)
  if (!normalized) {
    return null
  }

  for (const branch of BOLIVIA_BRANCH_LOCATIONS) {
    if (branch.terms.some((term) => normalized.includes(normalizeSearchText(term)))) {
      return branch
    }
  }

  return null
}

const getPackageDestinationBranch = (packageContext = null) =>
  getBoliviaBranchLocation(
    normalizeReference(packageContext?.currentDestinationDepartment) ||
      normalizeReference(packageContext?.currentDestinationLabel) ||
      normalizeReference(packageContext?.currentDestinationAddress) ||
      normalizeReference(packageContext?.summaryText),
  )

const getPackageOriginBranch = (packageContext = null) =>
  getBoliviaBranchLocation(
    normalizeReference(packageContext?.currentOriginDepartment) ||
      normalizeReference(packageContext?.currentOriginLabel) ||
      normalizeReference(packageContext?.currentOriginAddress) ||
      normalizeReference(packageContext?.summaryText),
  )

const formatPackageAgencyContext = (packageContext = null) => {
  const agencies = [
    packageContext?.currentOriginLabel
      ? `Origen: ${normalizeReference(packageContext.currentOriginLabel)}${
          normalizeReference(packageContext.currentOriginDepartment)
            ? ` (${normalizeReference(packageContext.currentOriginDepartment)})`
            : ''
        }`
      : '',
    packageContext?.currentDestinationLabel
      ? `Destino: ${normalizeReference(packageContext.currentDestinationLabel)}${
          normalizeReference(packageContext.currentDestinationDepartment)
            ? ` (${normalizeReference(packageContext.currentDestinationDepartment)})`
            : ''
        }`
      : '',
    packageContext?.currentDestinationAddress
      ? `Direccion destino: ${normalizeReference(packageContext.currentDestinationAddress)}`
      : '',
  ].filter(Boolean)

  return agencies.join('\n')
}

const buildFallbackAgentReplyLegacy = ({ contact, messageBody, currentStatus, packageContext = null }) => {
  const normalizedMessage = normalizeReference(messageBody).toLowerCase()
  const contactName = normalizeReference(contact?.name) || 'Hola'
  const packageCode = normalizeReference(packageContext?.currentPackageCode)
  const originDepartment = normalizeReference(packageContext?.currentOriginDepartment)
  const originLabel = normalizeReference(packageContext?.currentOriginLabel)
  const destinationDepartment = normalizeReference(packageContext?.currentDestinationDepartment)
  const destinationLabel = normalizeReference(packageContext?.currentDestinationLabel)
  const destinationAddress = normalizeReference(packageContext?.currentDestinationAddress)
  const originBranch = getPackageOriginBranch(packageContext)
  const destinationBranch = getPackageDestinationBranch(packageContext)
  const originDisplay = originDepartment || originBranch?.label || originLabel || 'origen'
  const destinationDisplay = destinationDepartment || destinationBranch?.label || destinationLabel || destinationAddress || 'destino'
  const originLocationText = originBranch?.address
    ? `${originDisplay} (${originBranch.address})`
    : originDisplay
  const destinationLocationText = destinationBranch?.address
    ? `${destinationDisplay} (${destinationBranch.address})`
    : destinationDisplay
  const isDeliveryQuestion =
    normalizedMessage.includes('llego') ||
    normalizedMessage.includes('lleg??') ||
    normalizedMessage.includes('entregado') ||
    normalizedMessage.includes('paquete') ||
    normalizedMessage.includes('envio') ||
    normalizedMessage.includes('env??o')

  if (packageContext?.matched && packageContext.stage === 'delivered') {
    return `Revisé la guía ${packageCode || 'indicada'} y figura como entregada${destinationLocationText ? ` en ${destinationLocationText}` : ''}. Si necesitas más detalle sobre la entrega, puedo ayudarte a revisarlo.`
  }

  if (packageContext?.matched && packageContext.stage === 'cancelled') {
    return `Revisé la guía ${packageCode || 'indicada'} y figura como cancelada${originLocationText ? ` en la Sucursal ${originLocationText}` : ''}. Para revisar el motivo, comunícate con esa sucursal o atención al cliente.`
  }

  if (packageContext?.matched && packageContext.stage === 'courier') {
    return `Revisé la guía ${packageCode || 'indicada'} y figura asignada a cartero${destinationLocationText ? ` en ${destinationLocationText}` : ''}. Está en proceso de reparto; no aparece como entregada todavía.`
  }

  if (packageContext?.matched && packageContext.stage === 'transit') {
    return [
      `¡Hola, ${contactName}! 👋 Muchas gracias por escribirnos.`,
      '',
      `🚚 Tu paquete ya está en tránsito con destino a **${destinationDisplay}** 📦. Seguimos monitoreando su avance 🔎 para avisarte en cuanto se confirme el siguiente movimiento 📲.`,
    ].join('\n')
  }

  if (packageContext?.matched && packageContext.stage === 'regional') {
    return [
      `¡Perfecto! Confirmamos la guia ${packageCode || 'sin codigo'}:`,
      '',
      `📍 ¿Dónde está tu paquete hoy? Recibido y procesado en la Sucursal ${originLocationText}.`,
      `🚛 Próximo paso: Saldrá en el próximo despacho con destino a ${destinationDisplay}.`,
      '',
      `Te notificaremos apenas entre en tránsito. Si prefieres hacer una gestión presencial antes de que salga, puedes pasar por la sucursal de ${originDisplay} con tu carnet de identidad original.`,
    ]
      .filter(Boolean)
      .join('\n')
  }

  if (packageContext?.matched && packageContext.stage === 'received') {
    return [
      `¡Perfecto! Confirmamos la guia ${packageCode || 'sin codigo'}:`,
      '',
      `📍 ¿Dónde está tu paquete hoy? Recibido y procesado en la Sucursal ${originLocationText}.`,
      `🚛 Próximo paso: Saldrá en el próximo despacho con destino a ${destinationDisplay}.`,
      '',
      `Te notificaremos apenas entre en tránsito. Si prefieres hacer una gestión presencial antes de que salga, puedes pasar por la sucursal de ${originDisplay} con tu carnet de identidad original.`,
    ]
      .filter(Boolean)
      .join('\n')
  }

  if (currentStatus === 'Recibido Destino') {
    return `Perfecto! Tu paquete ya llego y esta listo para que lo pases a recoger en ${destinationDisplay}.`
  }

  if (currentStatus === 'Nuevo') {
    return `Tu paquete fue recibido en nuestra sucursal de origen${originDisplay ? `, ${originDisplay}` : ''}${destinationDisplay ? `, con destino a ${destinationDisplay}` : ''}. En cuanto sea despachado, te compartimos la siguiente actualizacion.`
  }

  if (currentStatus === 'Activo' || currentStatus === 'Entregado') {
    return 'Tu caso figura como entregado. Si necesitas revisar algun detalle adicional, aqui te ayudo.'
  }

  if (currentStatus === 'En seguimiento') {
    return isDeliveryQuestion
      ? 'Tu paquete esta en seguimiento. Apenas tengamos una actualizacion, te la compartimos.'
      : 'Ya estamos revisando tu envio. En cuanto avance, te compartimos la actualizacion.'
  }

  return 'Estamos revisando tu caso. Apenas tengamos una actualizacion, te la compartimos.'
}
const buildFriendlyFallbackAgentReply = ({ contact, messageBody, currentStatus, packageContext = null }) => {
  const normalizedMessage = normalizeReference(messageBody).toLowerCase()
  const contactName = normalizeReference(contact?.name) || 'Hola'
  const packageCode = normalizeReference(packageContext?.currentPackageCode)
  const originDepartment = normalizeReference(packageContext?.currentOriginDepartment)
  const originLabel = normalizeReference(packageContext?.currentOriginLabel)
  const destinationDepartment = normalizeReference(packageContext?.currentDestinationDepartment)
  const destinationLabel = normalizeReference(packageContext?.currentDestinationLabel)
  const destinationAddress = normalizeReference(packageContext?.currentDestinationAddress)
  const originBranch = getPackageOriginBranch(packageContext)
  const destinationBranch = getPackageDestinationBranch(packageContext)
  const originDisplay = originDepartment || originBranch?.label || originLabel || 'origen'
  const destinationDisplay = destinationDepartment || destinationBranch?.label || destinationLabel || destinationAddress || 'destino'
  const originLocationText = originBranch?.address ? `${originDisplay} (${originBranch.address})` : originDisplay
  const destinationLocationText = destinationBranch?.address
    ? `${destinationDisplay} (${destinationBranch.address})`
    : destinationDisplay
  const isDeliveryQuestion =
    normalizedMessage.includes('llego') ||
    normalizedMessage.includes('llegó') ||
    normalizedMessage.includes('entregado') ||
    normalizedMessage.includes('paquete') ||
    normalizedMessage.includes('envio') ||
    normalizedMessage.includes('envío')

  if (packageContext?.matched && packageContext.stage === 'delivered') {
    return `Revisé la guía ${packageCode || 'indicada'} 📦 y figura como entregada ✅${destinationLocationText ? ` en ${destinationLocationText} 📍` : ''}. Si necesitas más detalle sobre la entrega, puedo ayudarte a revisarlo 😊.`
  }

  if (packageContext?.matched && packageContext.stage === 'cancelled') {
    return `Revisé la guía ${packageCode || 'indicada'} 📦 y figura como cancelada ❌${originLocationText ? ` en la Sucursal ${originLocationText} 📍` : ''}. Para revisar el motivo, comunícate con esa sucursal o atención al cliente 📞.`
  }

  if (packageContext?.matched && packageContext.stage === 'courier') {
    return `Revisé la guía ${packageCode || 'indicada'} 📦 y figura asignada a cartero 🛵${destinationLocationText ? ` en ${destinationLocationText} 📍` : ''}. Está en proceso de reparto 🚚; no aparece como entregada todavía ⏳.`
  }

  if (packageContext?.matched && packageContext.stage === 'transit') {
    return [
      `¡Hola, ${contactName}! 👋 Muchas gracias por escribirnos.`,
      '',
      `🚚 Tu paquete está en tránsito con destino a ${destinationDisplay} 📦. Seguimos monitoreando su avance 🔎 y te avisaremos cuando haya un nuevo movimiento 📲.`,
    ].join('\n')
  }

  if (packageContext?.matched && packageContext.stage === 'regional') {
    return [
      `¡Perfecto! 👌 Confirmamos la guía ${packageCode || 'sin código'} 📦:`,
      '',
      `📍 ¿Dónde está tu paquete hoy? Fue recibido y procesado en la Sucursal ${originLocationText}.`,
      `🚛 Próximo paso: pasará a reparto o estará disponible según el proceso de la regional de destino ${destinationDisplay}.`,
      '',
      'Te notificaremos 📲 apenas haya una nueva actualización. Si necesitas gestión presencial, lleva tu carnet de identidad original 🪪.',
    ].join('\n')
  }

  if (packageContext?.matched && packageContext.stage === 'received') {
    return [
      `¡Perfecto! 👌 Confirmamos la guía ${packageCode || 'sin código'} 📦:`,
      '',
      `📍 ¿Dónde está tu paquete hoy? Fue recibido y procesado en la Sucursal ${originLocationText}.`,
      `🚛 Próximo paso: saldrá en el próximo despacho con destino a ${destinationDisplay}.`,
      '',
      'Te notificaremos 📲 apenas entre en tránsito. Si necesitas gestión presencial, puedes pasar por la sucursal con tu carnet de identidad original 🪪.',
    ].join('\n')
  }

  if (currentStatus === 'Recibido Destino') {
    return `¡Perfecto! 🙌 Tu paquete ya llegó y está listo para que lo pases a recoger en ${destinationDisplay} 📍. Lleva tu carnet de identidad original 🪪.`
  }

  if (currentStatus === 'Nuevo') {
    return `Tu paquete fue recibido en nuestra sucursal de origen 📦${originDisplay ? `, ${originDisplay}` : ''}${destinationDisplay ? `, con destino a ${destinationDisplay}` : ''}. Te avisaremos cuando sea despachado 📲.`
  }

  if (currentStatus === 'Activo' || currentStatus === 'Entregado') {
    return 'Tu paquete figura como entregado ✅. Si necesitas revisar algún detalle adicional, aquí te ayudo 😊.'
  }

  if (currentStatus === 'En seguimiento') {
    return isDeliveryQuestion
      ? 'Tu paquete está en seguimiento 🔎. Apenas tengamos una actualización, te la compartimos 📲.'
      : 'Ya estamos revisando tu envío 🔎. En cuanto avance, te compartimos la actualización 📲.'
  }

  return 'Estamos revisando tu caso 🔎. Apenas tengamos una actualización, te la compartimos 📲.'
}

const buildFallbackAgentReply = buildFriendlyFallbackAgentReply

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
  /^(?:(?:hola|buenas?)\s+)?(?:buenos?\s+(?:dias|días)|buenas?\s+(?:tardes|noches|nohces)|hola|buenas)[!.,?\s]*$/i.test(
    normalizeReference(messageBody),
  )

const normalizeIntentText = (value) =>
  normalizeReference(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const getEditDistance = (firstValue, secondValue) => {
  const first = normalizeReference(firstValue)
  const second = normalizeReference(secondValue)

  if (first === second) return 0
  if (!first) return second.length
  if (!second) return first.length

  const previousRow = Array.from({ length: second.length + 1 }, (_, index) => index)

  for (let firstIndex = 0; firstIndex < first.length; firstIndex += 1) {
    const currentRow = [firstIndex + 1]

    for (let secondIndex = 0; secondIndex < second.length; secondIndex += 1) {
      const insertCost = currentRow[secondIndex] + 1
      const deleteCost = previousRow[secondIndex + 1] + 1
      const replaceCost = previousRow[secondIndex] + (first[firstIndex] === second[secondIndex] ? 0 : 1)
      currentRow.push(Math.min(insertCost, deleteCost, replaceCost))
    }

    previousRow.splice(0, previousRow.length, ...currentRow)
  }

  return previousRow[second.length]
}

const isSimilarWord = (word, expectedWords) => {
  const normalizedWord = normalizeIntentText(word)
  if (!normalizedWord) return false

  return expectedWords.some((expectedWord) => {
    const normalizedExpected = normalizeIntentText(expectedWord)
    const distance = getEditDistance(normalizedWord, normalizedExpected)
    const allowedDistance = normalizedExpected.length <= 5 ? 1 : 2
    return distance <= allowedDistance
  })
}

const hasSimilarToken = (words, expectedWords) =>
  words.some((word) => isSimilarWord(word, expectedWords))

const getEmptyPackageContext = () => ({
  matched: false,
  isTestModeNumber: false,
  stage: null,
  currentPackageCode: '',
  currentPackageUpdatedAt: 0,
  packageCodes: [],
  summaryText: '',
  agentFactsText: '',
  lifecycleInstruction: '',
})

const buildMultiPackageContextReply = (packageResults) => {
  const foundResults = packageResults.filter((result) => result.context?.matched)
  const missingCodes = packageResults
    .filter((result) => !result.context?.matched)
    .map((result) => result.code)

  const formatLocation = (context) =>
    normalizeReference(context.currentDestinationDepartment) ||
    normalizeReference(context.currentDestinationLabel) ||
    normalizeReference(context.currentDestinationAddress) ||
    normalizeReference(context.currentOriginDepartment) ||
    normalizeReference(context.currentOriginLabel) ||
    'sin ubicacion precisa'

  const formatResult = ({ code, context }) => {
    const packageCode = normalizeReference(context.currentPackageCode) || code
    const location =
      context.stage === 'courier'
        ? `va en reparto hacia ${formatLocation(context)}`
        : context.stage === 'regional'
          ? `ya llego a destino en ${formatLocation(context)}`
          : context.stage === 'delivered'
            ? `ya figura entregado en ${formatLocation(context)}`
            : context.stage === 'transit'
              ? `esta en camino hacia ${formatLocation(context)}`
              : context.stage === 'cancelled'
                ? `figura cancelado en ${formatLocation(context)}`
                : `esta en ${formatLocation(context)}`
    const latestEvent = Array.isArray(context.packageEvents)
      ? context.packageEvents
          .slice()
          .sort((firstEvent, secondEvent) => getPackageEventTimestampValue(secondEvent) - getPackageEventTimestampValue(firstEvent))[0]
      : null
    const latestEventText = latestEvent && context.stage !== 'courier' && context.stage !== 'regional'
      ? ` Ultimo evento: ${getPackageEventTitle(latestEvent)}${getPackageEventLocation(latestEvent) ? ` en ${getPackageEventLocation(latestEvent)}` : ''}.`
      : ''

    return `- ${packageCode}: ${location}.${latestEventText}`
  }

  const deliveryResults = foundResults.filter((result) => result.context?.stage === 'courier')
  const arrivedResults = foundResults.filter((result) => ['regional', 'delivered'].includes(result.context?.stage))
  const transitResults = foundResults.filter((result) => result.context?.stage === 'transit')
  const cancelledResults = foundResults.filter((result) => result.context?.stage === 'cancelled')
  const otherResults = foundResults.filter(
    (result) => !['courier', 'regional', 'delivered', 'transit', 'cancelled'].includes(result.context?.stage),
  )

  const lines = [
    ...deliveryResults.map((result) => formatResult(result)),
    ...arrivedResults.map((result) => formatResult(result)),
    ...transitResults.map((result) => formatResult(result)),
    ...cancelledResults.map((result) => formatResult(result)),
    ...otherResults.map((result) => formatResult(result)),
  ]

  if (missingCodes.length > 0) {
    lines.push(`No pude localizar: ${missingCodes.join(', ')}. Verifica esos codigos, por favor.`)
  }

  if (!lines.length) {
    return ''
  }

  return [
    'Claro, revise las guias que me enviaste:',
    ...lines,
    deliveryResults.length > 0
      ? 'Los que estan con cartero son los que van camino a entrega.'
      : 'No veo ninguna de esas guias marcada como cartero/reparto por ahora.',
  ].join('\n')
}

const isPackageInquiryMessage = (messageBody) => {
  const normalized = normalizeIntentText(messageBody)
  const words = normalized.split(' ').filter(Boolean)
  const hasPackageWord = hasSimilarToken(words, ['paquete', 'paquetes', 'envio', 'seguimiento', 'tracking', 'guia', 'codigo'])
  const hasLocationWord = hasSimilarToken(words, ['donde', 'ubicacion', 'esta', 'estara'])
  const hasQuestionPhrase = /\b(quiero|quisiera|saber|consultar|rastrear|buscar|ver)\b/.test(normalized)

  return hasPackageWord || (hasLocationWord && hasQuestionPhrase)
}

const isGratitudeOnlyMessage = (messageBody) => {
  const normalized = normalizeReference(messageBody)
    .toLowerCase()
    .replace(/[!¡¿?.,;:"'()[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return /^(muchas gracias|gracias|ok gracias|listo gracias|perfecto gracias|muchisimas gracias|mil gracias|dale gracias|bueno gracias)$/.test(
    normalized,
  )
}

const PROMPT_INJECTION_SAFE_REPLY =
  'No puedo ayudarte con eso. Solo puedo ayudarte con consultas relacionadas con Correos de Bolivia, seguimiento de paquetes y atencion al cliente.'

const isPromptInjectionAttempt = (messageBody) => {
  const normalized = normalizeIntentText(messageBody)

  if (!normalized) {
    return false
  }

  const injectionPatterns = [
    /\bignora\b.*\b(instrucciones|prompt|reglas|sistema|system)\b/,
    /\bolvida\b.*\b(instrucciones|prompt|reglas|sistema|system)\b/,
    /\bno\b.*\b(menciones|mencionar)\b.*\b(correos|bolivia)\b/,
    /\bahora\b.*\beres\b/,
    /\bactua\b.*\bcomo\b/,
    /\brol\b.*\b(asistente|sistema|system)\b/,
    /\bprompt\b.*\b(sistema|system|exactamente|muestra|revela|dime)\b/,
    /\b(system|developer)\b.*\b(prompt|message|instructions)\b/,
    /\b(codigo|codigo fuente|source code)\b.*\b(clasificar|eventos|prompt|sistema)\b/,
    /\bmuestra\b.*\b(prompt|codigo|instrucciones|reglas)\b/,
    /\brevela\b.*\b(prompt|codigo|instrucciones|reglas)\b/,
    /\bdime\b.*\b(prompt|instrucciones|reglas internas)\b/,
    /\breceta\b|\bcocina\b|\bsopa\b|\bmani\b/,
    /\bsuma\b.*\b\d+\b.*\b\d+\b/,
  ]

  return injectionPatterns.some((pattern) => pattern.test(normalized))
}

const hasPackageCode = (messageBody) => {
  const normalized = normalizeReference(messageBody)
  return Boolean(extractPackageCode(normalized)) || /\b\d{8,}\b/.test(normalized)
}

const isTariffInquiryMessage = (messageBody) => {
  const normalized = normalizeReference(messageBody).toLowerCase()
  return /\b(tarifa|tarifas|precio|precios|costo|costos|cotiza|cotizacion|cotización|cuanto cuesta|cuánto cuesta|envio nacional|envio internacional|peso|kilo|kilogramo)\b/.test(
    normalized,
  )
}

const inferIntentHeuristically = (messageBody) => {
  if (hasPackageCode(messageBody) || isPackageInquiryMessage(messageBody)) {
    return 'TRACKING'
  }

  if (isTariffInquiryMessage(messageBody)) {
    return 'TARIFAS'
  }

  return 'GENERAL'
}

const routeCustomerIntent = async ({ messageBody, recentConversation = '' }) => {
  const heuristicIntent = inferIntentHeuristically(messageBody)

  return {
    category: heuristicIntent,
    model: 'heuristic',
    source: 'heuristic',
  }
}

const buildGeneralAgentPrompt = ({
  contact,
  messageBody,
  recentConversation,
  packageContext,
  category = 'GENERAL',
  customInstruction = '',
  sender = '',
}) =>
  [
    'Responde como una persona real, con tono cercano y natural.',
    'Prioriza respuestas cortas y fluidas para WhatsApp: 1 o 2 frases, maximo 32 palabras.',
    'No inventes ubicaciones, fechas, tarifas ni promesas.',
    category === 'TARIFAS'
      ? 'El cliente consulta tarifas o cotizaciones. Si faltan peso, origen o destino, pide solo esos datos minimos.'
      : 'El cliente hace una consulta general. Responde solo lo que pregunta y evita desviarte.',
    'Responde solo en espanol, en 2 o 3 frases como maximo y con no mas de 40 palabras.',
    'Ve directo al punto: evita introducciones largas, listas y explicaciones innecesarias.',
    'Haz una sola pregunta final solo si necesitas aclarar algo.',
    '',
    contact
      ? `Contacto: ${contact.name || 'Sin nombre'}\nEmpresa: ${contact.company || 'No registrada'}\nSegmento: ${contact.segment || 'Sin segmento'}\nEstado: ${contact.status || 'Sin estado'}`
      : 'Contacto: Cliente de WhatsApp',
    packageContext?.matched
      ? `Contexto del paquete disponible para ${normalizeReference(sender)}:\n${packageContext.summaryText}`
      : 'Sin contexto de paquete en APIs.',
    packageContext?.matched && formatPackageAgencyContext(packageContext)
      ? `Agencias obtenidas desde las APIs:\n${formatPackageAgencyContext(packageContext)}`
      : 'Sin agencias confirmadas desde APIs.',
    packageContext?.packageEventsText
      ? `Historial cronologico de eventos del paquete:\n${packageContext.packageEventsText}\n\nRegla: si preguntan donde estaba el paquete, primero resume la secuencia de eventos y luego indica la ultima ubicacion conocida.`
      : '',
    packageContext?.agentFactsText
      ? `Hechos estructurados extraidos desde las APIs:\n${packageContext.agentFactsText}`
      : '',
    '',
    recentConversation ? `Conversacion reciente:\n${recentConversation}` : 'No hay historial previo.',
    '',
    customInstruction ? `Instruccion adicional: ${customInstruction}` : '',
    `Mensaje del cliente: ${normalizeReference(messageBody)}`,
    '',
    'Devuelve solo el texto final de la respuesta, sin comillas, sin explicaciones ni markdown.',
  ]
    .filter(Boolean)
    .join('\n')

const buildTrackingAgentPrompt = ({
  contact,
  messageBody,
  recentConversation,
  packageContext,
  sender = '',
  customInstruction = '',
}) =>
  [
    'Responde como asesor especialista en seguimiento de paquetes para WhatsApp.',
    'Usa un tono cercano como Jaimito de Correos de Bolivia: saludo cordial, pedido de guia si falta y actualizacion natural del estado.',
    'Usa solo el contexto real del paquete y el historial dado.',
    'Si el cliente saluda, responde con un saludo breve y presentacion amable.',
    'Si pide rastreo y no da guia, pide el numero de guia de forma breve.',
    'Si ya hay guia y contexto real, responde con una actualizacion clara, amable y facil de leer.',
    'Si el cliente pregunta donde esta o hacia donde va, menciona estado, destino y sucursal de origen o destino cuando exista.',
    'Si existe una agencia o sucursal en las APIs, usa ese dato exacto y no inventes direcciones ni nombres.',
    'No inventes fechas exactas ni eventos no confirmados.',
    'Responde en espanol, maximo 40 palabras, 1 o 2 frases.',
    '',
    contact
      ? `Contacto: ${contact.name || 'Sin nombre'}\nEstado CRM: ${contact.status || 'Sin estado'}`
      : 'Contacto: Cliente de WhatsApp',
    packageContext?.matched
      ? `Contexto del paquete para ${normalizeReference(sender)}:\n${packageContext.summaryText}\n\nRegla de etapa:\n${packageContext.lifecycleInstruction}`
      : 'Sin contexto de paquete confirmado.',
    packageContext?.matched && formatPackageAgencyContext(packageContext)
      ? `Agencias obtenidas desde las APIs:\n${formatPackageAgencyContext(packageContext)}`
      : 'Sin agencias confirmadas desde APIs.',
    packageContext?.packageEventsText
      ? `Historial cronologico de eventos del paquete:\n${packageContext.packageEventsText}\n\nRegla: si el cliente pregunta donde estaba el paquete, responde primero con los eventos y despues con la ubicacion final conocida.`
      : '',
    packageContext?.agentFactsText
      ? `Hechos estructurados extraidos desde las APIs:\n${packageContext.agentFactsText}`
      : '',
    '',
    recentConversation ? `Conversacion reciente:\n${recentConversation}` : 'No hay historial previo.',
    '',
    customInstruction ? `Instruccion adicional: ${customInstruction}` : '',
    `Mensaje del cliente: ${normalizeReference(messageBody)}`,
    '',
    'Devuelve solo el texto final de la respuesta, sin comillas, sin explicaciones ni markdown.',
  ]
    .filter(Boolean)
    .join('\n')

const wait = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

const AUTO_REPLY_SETTLE_DELAY_MS = Number.parseInt(process.env.WHATSAPP_AUTO_REPLY_SETTLE_DELAY_MS || '2500', 10)
const WHATSAPP_STAGE_WATCHER_ENABLED =
  process.env.WHATSAPP_STAGE_WATCHER_ENABLED == null
    ? true
    : process.env.WHATSAPP_STAGE_WATCHER_ENABLED === 'true'
const WHATSAPP_STAGE_WATCHER_INTERVAL_MS = Number.parseInt(
  process.env.WHATSAPP_STAGE_WATCHER_INTERVAL_MS || '30000',
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

const buildInitialPackageOutreachMessage = ({ contactName, packageContext }) => {
  const safeName = normalizeReference(contactName)
  const greeting = getBoliviaDayGreeting()
  const customerName = safeName ? `, ${safeName}` : ''
  const proactiveUpdate = buildProactivePackageUpdateMessage({
    contact: safeName ? { name: safeName } : null,
    packageContext,
  })

  if (proactiveUpdate) {
    return `¡Hola${customerName}! ${greeting}. Soy Jaimito, de Correos de Bolivia. ${proactiveUpdate}`
  }

  return `¡Hola${customerName}! ${greeting}. Soy Jaimito, de Correos de Bolivia.`
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

  const testModeNumbers = getConfiguredWhatsAppTestNumbers(config)
  const testModeNumber = testModeNumbers[0] || normalizeBoliviaTestNumber(whatsappDefaults.testModeNumber)

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

const maybeSendTestModeStageUpdate = async (request = null) => {
  await ensureDatabaseReady()

  const finishWithoutSending = async (reason, extraDetails = {}) => {
    await writeSystemLog({
      event: 'whatsapp_test_mode_stage_update_skipped',
      request,
      statusCode: 200,
      details: {
        reason,
        ...extraDetails,
      },
    }).catch(() => {})

    return { sent: false, reason, ...extraDetails }
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

  const testModeNumbers = getConfiguredWhatsAppTestNumbers(config)
  const testModeNumber = testModeNumbers[0] || normalizeBoliviaTestNumber(whatsappDefaults.testModeNumber)

  if (!testModeNumber) {
    return finishWithoutSending('missing-test-number')
  }

  const packageContext = await fetchMatchingPackageContext(testModeNumber)
  if (!packageContext.matched || !packageContext.currentPackageCode || !packageContext.stage) {
    return finishWithoutSending('package-context-not-available', {
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

  const stageNotificationResult = await pool.query(
    `
      select details, created_at
      from system_logs
      where event = 'whatsapp_test_mode_stage_update_sent'
        and details->>'recipient' = $1
        and details->>'packageCode' = $2
      order by created_at desc, id desc
      limit 1;
    `,
    [normalizedTarget, packageContext.currentPackageCode],
  )

  const lastStageNotification = stageNotificationResult.rows[0] ?? null
  const lastStage = normalizeReference(lastStageNotification?.details?.packageStage)
  const lastPackageUpdatedAt = Number(lastStageNotification?.details?.packageUpdatedAt || 0)
  const currentPackageUpdatedAt = Number(packageContext.currentPackageUpdatedAt || 0)

  if (lastStage === packageContext.stage && lastPackageUpdatedAt >= currentPackageUpdatedAt) {
    return finishWithoutSending('stage-already-notified', {
      contactId: contact.id,
      recipient: normalizedTarget,
      packageCode: packageContext.currentPackageCode,
      packageStage: packageContext.stage,
      packageUpdatedAt: currentPackageUpdatedAt,
    })
  }

  const outboundHistoryResult = await pool.query(
    `
      select id
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
    [contact.id, getWhatsAppNumberCandidates(normalizedTarget)],
  )

  if (!outboundHistoryResult.rows[0]) {
    return finishWithoutSending('conversation-not-started', {
      contactId: contact.id,
      recipient: normalizedTarget,
      packageCode: packageContext.currentPackageCode,
    })
  }

  const messageBody = buildProactivePackageUpdateMessage({
    contact,
    packageContext,
  })

  if (!messageBody) {
    return finishWithoutSending('empty-stage-message', {
      contactId: contact.id,
      recipient: normalizedTarget,
      packageCode: packageContext.currentPackageCode,
      packageStage: packageContext.stage,
    })
  }

  const providerResponse = await sendWhatsAppCloudMessage({
    accessToken: config.accessToken,
    apiVersion: config.apiVersion,
    phoneNumberId: config.phoneNumberId,
    to: normalizedTarget,
    body: messageBody,
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
    [contact.id, normalizedTarget, messageBody, providerMessageId],
  )

  await writeSystemLog({
    event: 'whatsapp_test_mode_stage_update_sent',
    request,
    statusCode: 200,
    details: {
      contactId: contact.id,
      recipient: normalizedTarget,
      packageCode: packageContext.currentPackageCode,
      packageStage: packageContext.stage,
      packageUpdatedAt: currentPackageUpdatedAt,
      providerMessageId,
    },
  }).catch(() => {})

  return {
    sent: true,
    contactId: contact.id,
    recipient: normalizedTarget,
    packageCode: packageContext.currentPackageCode,
    packageStage: packageContext.stage,
    providerMessageId,
  }
}

let whatsappStageWatcherRunning = false

const runWhatsAppStageWatcher = async () => {
  if (whatsappStageWatcherRunning) {
    return
  }

  whatsappStageWatcherRunning = true

  try {
    await maybeStartTestModeConversation().catch(async (error) => {
      await writeSystemLog({
        level: 'error',
        event: 'whatsapp_stage_watcher_auto_start_failed',
        statusCode: 500,
        details: {
          error: error instanceof Error ? error.message : 'Error desconocido.',
        },
      }).catch(() => {})
    })

    await maybeSendTestModeStageUpdate().catch(async (error) => {
      await writeSystemLog({
        level: 'error',
        event: 'whatsapp_stage_watcher_stage_update_failed',
        statusCode: 500,
        details: {
          error: error instanceof Error ? error.message : 'Error desconocido.',
        },
      }).catch(() => {})
    })
  } finally {
    whatsappStageWatcherRunning = false
  }
}

const startWhatsAppStageWatcher = () => {
  if (!WHATSAPP_STAGE_WATCHER_ENABLED) {
    console.log('Watcher de etapas WhatsApp deshabilitado por configuracion.')
    return
  }

  const intervalMs = Number.isFinite(WHATSAPP_STAGE_WATCHER_INTERVAL_MS)
    ? Math.max(WHATSAPP_STAGE_WATCHER_INTERVAL_MS, 10000)
    : 30000

  void runWhatsAppStageWatcher()
  setInterval(() => {
    void runWhatsAppStageWatcher()
  }, intervalMs)

  console.log(`Watcher de etapas WhatsApp activo cada ${intervalMs} ms.`)
}

const callOllamaGenerate = async ({ prompt, model = '', fallbackModels = [], system = '', timeoutMs = 12000, options = {} }) => {
  const config = getAiConfig()
  const endpoint = `${config.baseUrl.replace(/\/$/, '')}/api/generate`
  const aiReachable = await isAiServiceReachable(config.baseUrl, Math.min(timeoutMs, 1500))

  if (!aiReachable) {
    throw new Error('La IA local no esta disponible o no respondio a tiempo.')
  }

  const resolvedModel = await resolveAiModel(
    {
      baseUrl: config.baseUrl,
      model: normalizeReference(model) || config.generalModel,
    },
    fallbackModels,
  )

  if (!resolvedModel) {
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
        model: resolvedModel,
        prompt,
        system: normalizeReference(system) || config.systemPrompt,
        options,
        stream: false,
      }),
    },
    timeoutMs,
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
    model: payload?.model || resolvedModel,
    response: normalizeReference(payload?.response),
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

    const [contactResult, recentMessagesResult] = await Promise.all([
      Number.isInteger(contactId) && contactId > 0
        ? pool.query(
            `
              select id, name, company, segment, owner_name, status
              from contacts
              where id = $1
              limit 1;
            `,
            [contactId],
          )
        : Promise.resolve({ rows: [] }),
      pool.query(
        `
          select direction, message_text
          from message_logs
          where contact_id = $1
            and ($2::bigint is null or id <= $2::bigint)
          order by created_at desc, id desc
          limit 8;
        `,
        [contactId || -1, inboundMessageId ?? null],
      ),
    ])

    contact = contactResult.rows[0] ?? null

    await syncContactEmsStatus({
      contactId,
      currentContact: contact,
      recentMessages: recentMessagesResult.rows,
    })

    if (Number.isInteger(contactId) && contactId > 0 && normalizeReference(contact?.status) !== 'Recibido Destino') {
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

    const isInjectionAttempt = isPromptInjectionAttempt(messageBody)
    const isGreetingOnly = !isInjectionAttempt && isGreetingMessage(messageBody)
    const isGratitudeOnly = isGratitudeOnlyMessage(messageBody)
    const packageCodes = extractPackageCodeCandidates(messageBody)
    const packageCode = packageCodes[0] || ''
    const hasPackageInquiry = !isInjectionAttempt && (isPackageInquiryMessage(messageBody) || Boolean(packageCode))
    const isPackageInquiryWithoutCode = hasPackageInquiry && !hasPackageCode(messageBody)
    const packageContext =
      isGreetingOnly || isGratitudeOnly || !hasPackageInquiry
        ? getEmptyPackageContext()
        : await fetchMatchingPackageContext(sender, packageCode)
    const multiPackageResults =
      !isInjectionAttempt && packageCodes.length > 1
        ? await Promise.all(
            packageCodes.map(async (code) => ({
              code,
              context: code === packageCode ? packageContext : await fetchMatchingPackageContext(sender, code),
            })),
          )
        : []
    const packageCodeNotFound = Boolean(packageCode) && !packageContext.matched
    const routedIntent = await routeCustomerIntent({
      messageBody,
      recentConversation,
    })

    const prompt = [
      'Responde como una persona real, con tono cercano y natural.',
      'Prioriza respuestas cortas y fluidas para WhatsApp: 1 o 2 frases, maximo 32 palabras.',
      'Si el cliente saluda o inicia la conversacion, responde primero con un saludo cordial y cercano, por ejemplo: "¡Hola! Buenas tardes. Soy Jaimito, de Correos de Bolivia. ¿En qué te puedo ayudar hoy?".',
      'No menciones el paquete, su estado ni su ubicacion si el cliente solo esta saludando o no ha preguntado por el envio.',
      'Si pregunta por un paquete, envio, seguimiento o ubicacion y no proporciona un codigo de seguimiento, pide primero ese codigo. No consultes ni informes otro paquete por el numero de telefono.',
      'Si el cliente pregunta donde esta el paquete o hacia donde va, responde primero con el estado actual y luego con el destino o direccion disponible.',
      'Usa frases naturales como "tu paquete esta en transito", "va hacia..." o "tiene destino en...".',
      'Ejemplo bueno: "¡Buenas noticias! Tu paquete ya llegó y está listo para que lo pases a recoger en nuestra sucursal de Santa Cruz. ¡Te esperamos! ✨"',
      'Ejemplo malo: "Gracias por escribirnos. Seguimos monitoreando el avance para avisarte el siguiente movimiento confirmado."',
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
      recentConversation ? `Conversacion reciente:\n${recentConversation}` : 'No hay historial previo.',
      '',
      `Mensaje del cliente: ${normalizeReference(messageBody)}`,
      '',
      'Devuelve solo el texto final de la respuesta, sin comillas, sin explicaciones ni markdown.',
    ].join('\n')

    let finalReply = isGreetingOnly
      ? `¡Hola! 👋 ${getBoliviaDayGreeting()}. Te habla Jaimito de Correos de Bolivia ✉️. ¿Cómo te puedo colaborar hoy? 😊`
      : isPackageInquiryWithoutCode
        ? '¡Perfecto! 👍 Déjame tu número de guía y lo revisamos de inmediato 📦.'
        : packageCodeNotFound
          ? `No pude localizar el paquete ${packageCode} 🔎. Verifica el código e inténtalo nuevamente, por favor 📦.`
          : packageCode && packageContext.matched
            ? buildFallbackAgentReply({ contact, messageBody, currentStatus: contact?.status ?? 'Nuevo', packageContext })
        : ''

    if (multiPackageResults.length > 1) {
      finalReply = buildMultiPackageContextReply(multiPackageResults)
    }

    if (isInjectionAttempt) {
      finalReply = PROMPT_INJECTION_SAFE_REPLY
    }

    if (!isInjectionAttempt && isGratitudeOnly) {
      finalReply = '¡Con gusto! 😊 Seguimos atentos a cualquier nuevo movimiento de tu paquete y te avisaremos apenas haya una actualización 📲.'
    }

    const shouldCallAiForReply =
      !finalReply &&
      !packageContext.matched &&
      !isGreetingOnly &&
      !isGratitudeOnly &&
      !isPackageInquiryWithoutCode &&
      !packageCodeNotFound

    try {
      if (!finalReply && routedIntent.category === 'TRACKING' && packageContext.matched) {
        const aiReply = await callOllamaGenerate({
          prompt: buildTrackingAgentPrompt({
            contact,
            messageBody,
            recentConversation,
            packageContext,
            sender,
          }),
          model: getAiConfig().trackingModel,
          fallbackModels: ['qwen2.5:3b', getAiConfig().generalModel],
          system: getAiConfig().trackingSystemPrompt,
          timeoutMs: getAiConfig().trackingTimeoutMs,
        })
        finalReply = aiReply.response
      } else if (shouldCallAiForReply || (!finalReply && routedIntent.category !== 'TRACKING')) {
        const aiReply = await callOllamaGenerate({
          prompt: buildGeneralAgentPrompt({
            contact,
            messageBody,
            recentConversation,
            packageContext,
            category: routedIntent.category,
            sender,
          }),
          model: getAiConfig().generalModel,
          fallbackModels: ['llama3.1:8b'],
          system: getAiConfig().systemPrompt,
          timeoutMs: getAiConfig().generalTimeoutMs,
        })
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
          routedCategory: routedIntent.category,
          routedBy: routedIntent.source,
        },
      })
    }

    if (!finalReply) {
      finalReply = buildFallbackAgentReply({
        contact,
        messageBody,
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
      currentContact: contact,
      providedPackageContext: packageContext?.matched ? packageContext : null,
    })

    await writeSystemLog({
      event: 'whatsapp_auto_reply_sent',
      statusCode: 200,
      details: {
        contactId: contactId ?? null,
        sender: normalizePhoneNumber(sender),
        providerMessageId,
        routedCategory: routedIntent.category,
        routedBy: routedIntent.source,
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

        await writeSystemLog({
          event: 'whatsapp_inbound_message_saved',
          statusCode: 200,
          details: {
            contactId: matchedContact?.id ?? null,
            sender: normalizePhoneNumber(from),
            inboundMessageId: inboundLogResult.rows[0]?.id ?? null,
            providerMessageId,
            preview: normalizeReference(messageBody).slice(0, 80),
          },
        }).catch(() => {})

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
app.use('/api', (_request, response, next) => {
  response.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    Pragma: 'no-cache',
    Expires: '0',
  })
  next()
})
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
  const requestedPerPage = Number(request.query.per_page ?? requestedLimit)
  const hours = Number.isFinite(requestedHours) ? Math.min(Math.max(requestedHours, 1), 720) : 24
  const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 500) : 100
  const page = Number.isFinite(requestedPage) ? Math.max(1, requestedPage) : 1
  const perPage = Number.isFinite(requestedPerPage) ? Math.min(Math.max(requestedPerPage, 1), 100) : limit
  const offset = (page - 1) * perPage
  const level = String(request.query.level ?? '').trim().toLowerCase()
  const pathFilter = String(request.query.path ?? '').trim()
  const filters = ['created_at >= now() - ($1 * interval \'1 hour\')']
  const params = [hours]

  if (['info', 'warn', 'error'].includes(level)) {
    params.push(level)
    filters.push(`level = $${params.length}`)
  }

  if (pathFilter) {
    params.push(`%${pathFilter}%`)
    filters.push(`path ilike $${params.length}`)
  }

  try {
    await ensureDatabaseReady()

    const whereClause = filters.join(' and ')
    const [summaryResult, endpointResult, recentResult, totalRecentResult] = await Promise.all([
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
    ])
    const totalItems = Number(totalRecentResult.rows[0]?.total ?? 0)

    response.json({
      generatedAt: new Date().toISOString(),
      period: { hours, level: level || null, path: pathFilter || null, month: null },
      totals: summaryResult.rows.reduce(
        (totals, row) => ({ ...totals, total: totals.total + row.count, [row.level]: row.count }),
        { total: 0, info: 0, warn: 0, error: 0 },
      ),
      byEndpoint: endpointResult.rows,
      recent: recentResult.rows,
      months: [],
      pagination: {
        page,
        perPage,
        totalItems,
        totalPages: Math.max(1, Math.ceil(totalItems / perPage)),
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
      prontsConfig,
      pipelineConfig,
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
      integrations: defaultIntegrations,
      siteBlocks,
      prontsConfig,
      pipelineConfig,
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

app.get('/api/ems/pipeline', authMiddleware, async (request, response) => {
  const scope = normalizeReference(request.query.scope).toLowerCase()
  const query = normalizeReference(request.query.query).toLowerCase()
  const month = normalizeReference(request.query.month).toLowerCase() || 'all'
  const page = Math.max(1, Number.parseInt(String(request.query.page ?? '1'), 10) || 1)
  const perPage = Math.max(1, Number.parseInt(String(request.query.per_page ?? '20'), 10) || 20)

  try {
    const { cards, customColumns } = await buildEmsPipelineCards()
    const customColumn = customColumns.find((column) => column.id === scope)

    const filteredCards = cards.filter((card) => {
      const matchesMonth = month === 'all' || getEmsPipelineMonthKey(card.updatedAt) === month
      const matchesScope =
        !scope ||
        scope === 'all' ||
        (pipelineStageKeys.includes(scope) && card.stage === scope) ||
        (customColumn &&
          (normalizeReference(card.status).toLowerCase() === normalizeReference(customColumn.title).toLowerCase() ||
            (Array.isArray(customColumn.allowedStates) && customColumn.allowedStates.includes(card.stage)) ||
            (Array.isArray(customColumn.allowedStates) &&
              customColumn.allowedStates.includes(normalizeReference(card.status).toLowerCase()))))
      const matchesQuery =
        !query ||
        [
          card.code,
          card.title,
          card.summary,
          card.senderName,
          card.senderReference,
          card.recipientName,
          card.recipientReference,
          card.destination,
          card.status,
        ].some((value) => normalizeReference(value).toLowerCase().includes(query))

      return matchesMonth && matchesScope && matchesQuery
    })
    const totalItems = filteredCards.length
    const totalPages = Math.max(1, Math.ceil(totalItems / perPage))
    const currentPage = Math.min(page, totalPages)
    const fromIndex = (currentPage - 1) * perPage

    response.json({
      scope: scope || 'all',
      page: currentPage,
      per_page: perPage,
      total: totalItems,
      total_pages: totalPages,
      data: filteredCards.slice(fromIndex, fromIndex + perPage),
      pagination: {
        page: currentPage,
        per_page: perPage,
        total_items: totalItems,
        total_pages: totalPages,
        has_more: currentPage < totalPages,
      },
    })
  } catch (error) {
    response.status(502).json({
      message: 'No se pudo cargar la paginacion del pipeline EMS.',
      error: error instanceof Error ? error.message : 'Error desconocido.',
    })
  }
})

app.get('/api/ems/month-options', authMiddleware, async (_request, response) => {
  try {
    await Promise.all([
      getCachedTrackingPackagesCatalog() ? Promise.resolve() : fetchAllTrackingPackagesCatalog(),
      getCachedContactPackagesCatalog() ? Promise.resolve() : fetchAllContactPackagesCatalog(),
    ])

    const monthMap = new Map()
    const registerMonth = (value) => {
      const key = getEmsPipelineMonthKey(value)
      if (!key) return
      monthMap.set(key, (monthMap.get(key) ?? 0) + 1)
    }

    ;(getCachedTrackingPackagesCatalog()?.data ?? []).forEach((item) =>
      registerMonth(getTrackingLatestEvent(item)?.fecha || item?.fecha_registro),
    )
    ;(getCachedContactPackagesCatalog()?.data ?? []).forEach((item) => registerMonth(item?.fecha_registro))

    const data = [...monthMap.entries()]
      .sort((first, second) => second[0].localeCompare(first[0]))
      .map(([value, count]) => {
        const [yearPart, monthPart] = value.split('-')
        const date = new Date(Date.UTC(Number(yearPart), Number(monthPart) - 1, 1))
        return {
          value,
          label: new Intl.DateTimeFormat('es-BO', {
            month: 'long',
            year: 'numeric',
            timeZone: 'America/La_Paz',
          }).format(date),
          count,
        }
      })

    response.json({ data })
  } catch (error) {
    response.status(502).json({
      message: 'No se pudieron cargar los meses del pipeline EMS.',
      error: error instanceof Error ? error.message : 'Error desconocido.',
    })
  }
})

app.get('/api/ems/stage-overrides', authMiddleware, async (_request, response) => {
  try {
    await ensureDatabaseReady()
    response.json({ overrides: await getStoredEmsStageOverrides() })
  } catch (error) {
    response.status(500).json({
      message: 'No se pudieron cargar los estados guardados del tablero EMS.',
      error: error instanceof Error ? error.message : 'Error desconocido.',
    })
  }
})

app.put('/api/ems/stage-overrides', authMiddleware, async (request, response) => {
  const packageCode = normalizeReference(request.body?.packageCode).toUpperCase()
  const stage = normalizeEmsStageOverrideValue(request.body?.stage)

  if (!packageCode || !stage) {
    response.status(400).json({ message: 'Falta el codigo del paquete o el estado EMS no es valido.' })
    return
  }

  try {
    await ensureDatabaseReady()
    response.json({
      ok: true,
      packageCode,
      stage,
      overrides: await saveEmsStageOverride(packageCode, stage),
    })
  } catch (error) {
    response.status(500).json({
      message: 'No se pudo guardar el estado del paquete EMS.',
      error: error instanceof Error ? error.message : 'Error desconocido.',
    })
  }
})

app.post('/api/pipeline/sync-packages', authMiddleware, async (request, response) => {
  try {
    const result = await ensurePackagePipelineSync({ force: true })
    response.json({
      ok: true,
      ...result,
    })
  } catch (error) {
    response.status(502).json({
      ok: false,
      message: 'No se pudo sincronizar el pipeline con las APIs.',
      error: error instanceof Error ? error.message : 'Error desconocido.',
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

app.get('/api/pronts-config', authMiddleware, async (_request, response) => {
  try {
    const config = await getStoredProntsConfig()
    response.json({ ok: true, configs: config })
  } catch (error) {
    response.status(500).json({
      message: 'No se pudo cargar la configuracion de prompts.',
      error: error.message,
    })
  }
})

app.put('/api/pronts-config', authMiddleware, async (request, response) => {
  try {
    const config = await saveProntsConfig(request.body?.configs)
    response.json({ ok: true, configs: config })
  } catch (error) {
    response.status(500).json({
      message: 'No se pudo guardar la configuracion de prompts.',
      error: error.message,
    })
  }
})

app.get('/api/pipeline-config', authMiddleware, async (_request, response) => {
  try {
    await ensureDatabaseReady()
    const config = await getStoredPipelineConfig()
    response.json({ ok: true, config })
  } catch (error) {
    response.status(500).json({
      message: 'No se pudo cargar la configuracion del pipeline.',
      error: error.message,
    })
  }
})

app.put('/api/pipeline-config', authMiddleware, async (request, response) => {
  try {
    await ensureDatabaseReady()
    const config = await savePipelineConfig(request.body?.config)
    response.json({ ok: true, config })
  } catch (error) {
    response.status(500).json({
      message: 'No se pudo guardar la configuracion del pipeline.',
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

    await maybeSendTestModeStageUpdate(request).catch(async (error) => {
      await writeSystemLog({
        level: 'error',
        event: 'whatsapp_test_mode_stage_update_failed',
        request,
        statusCode: 500,
        details: {
          trigger: 'manual-whatsapp-send',
          error: error instanceof Error ? error.message : 'Error desconocido.',
        },
      }).catch(() => {})
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
        ? `Contexto real del paquete:\n${packageContext.summaryText}\n\nRegla de etapa:\n${packageContext.lifecycleInstruction}`
        : 'Sin contexto adicional de APIs para este numero.',
      '',
      'Solicitud del usuario para el modelo:',
      userPrompt,
      '',
      'Devuelve solo el mensaje final listo para enviar por WhatsApp. Sin encabezados ni explicaciones.',
    ].join('\n')

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

    if (!conversationContext && !packageContext.matched) {
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
      conversationContext || 'Sin historial reciente.',
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
  startWhatsAppStageWatcher()
})

