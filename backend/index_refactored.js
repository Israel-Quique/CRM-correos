import registerTrackingRoutes from './routes/trackingRoutes.js';
import registerInternacionalesRoutes from './routes/internacionalesRoutes.js';
import registerEmsRoutes from './routes/emsRoutes.js';
import registerPackage-code-lookupRoutes from './routes/package-code-lookupRoutes.js';
import registerHealthRoutes from './routes/healthRoutes.js';
import registerLogsRoutes from './routes/logsRoutes.js';
import registerAuthRoutes from './routes/authRoutes.js';
import registerUsersRoutes from './routes/usersRoutes.js';
import registerDashboardRoutes from './routes/dashboardRoutes.js';
import registerPipelineRoutes from './routes/pipelineRoutes.js';
import registerContact-groupsRoutes from './routes/contact-groupsRoutes.js';
import registerPronts-configRoutes from './routes/pronts-configRoutes.js';
import registerPipeline-configRoutes from './routes/pipeline-configRoutes.js';
import registerIntegrationsRoutes from './routes/integrationsRoutes.js';
import registerMessagesRoutes from './routes/messagesRoutes.js';
import registerAiRoutes from './routes/aiRoutes.js';
import registerContactsRoutes from './routes/contactsRoutes.js';
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
      'Eres un agente de seguimiento EMS que confirma la cancelacion del envio, explica el motivo operativo cuando exista y orienta al cliente sobre el siguiente paso sin inventar datos.',
    userTemplate:
      'Genera una respuesta para un paquete cancelado:\n- Cliente: {cliente}\n- Tracking: {tracking}\n- Destino: {destino}\n- Estado: {estado}\n- Grupo: {grupoNombre}',
    temperature: 0.2,
    action: 'Registrar cancelacion y notificar al cliente',
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
      helper: 'Envios anulados, cancelados o rechazados',
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
  baseUrl: process.env.TRACKING_API_URL?.trim() ?? 'https://dev.correos.gob.bo:18100',
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

const getPackageEventsApiDefaults = () => ({
  endpoint:
    process.env.PAQUETES_EVENTOS_API_URL?.trim() ??
    'https://dev.correos.gob.bo:18100/api/paquetes-eventos',
  token:
    process.env.PAQUETES_EVENTOS_API_TOKEN?.trim() ??
    process.env.PAQUETES_CONTACTOS_API_TOKEN?.trim() ??
    process.env.TRACKING_SQLSERVER_TOKEN?.trim() ??
    process.env.TRACKING_API_TOKEN?.trim() ??
    'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJodHRwOlwvXC8xMjcuMC4wLjE6ODAwMCIsImF1ZCI6ImJvbGlwb3N0LWRpcmVjY2lvbmVzLWRlc3Rpbm8iLCJzdWIiOiIxMCIsImp0aSI6IjU0NDE1OTNkYjM2MmExMjRlOThkYTQyZjNkMjgwNWE3NjZmZmZlZTk3ZTY2NzE1OWU3M2U1Y2FmNDYwN2Q4ZmUiLCJuYW1lIjoiRVZFTlRPUyBTSU9QIiwiaWF0IjoxNzg3NzU2ODQ5fQ.EKabodylKElq04t3EhXRwN7pxtAiWp5RuRvldZcFKq4',
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
const CONTACT_PACKAGES_CATALOG_TTL_MS = 300_000
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

const getNormalizedTimeoutMs = (value, fallbackMs) => {
  if (!Number.isFinite(value) || value <= 0) {
    return fallbackMs
  }

  return value
}





const normalizeReference = (value) => String(value ?? '').trim()
const normalizeSearchText = (value) =>
  normalizeReference(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
const normalizePhoneNumber = (value) => normalizeReference(value).replace(/[^\d]/g, '')
const parsePossiblePhoneNumber = (value) => {
  const digits = normalizePhoneNumber(value)

  if (!digits) {
    return null
  }

  const phoneNumber =
    parsePhoneNumberFromString(digits, 'BO') ??
    parsePhoneNumberFromString(`+${digits}`)

  if (!phoneNumber?.isPossible()) {
    return null
  }

  return phoneNumber
}

const isCellPhoneNumber = (value) => {
  const phoneNumber = parsePossiblePhoneNumber(value)

  if (!phoneNumber) {
    return false
  }

  const phoneType = phoneNumber.getType?.()
  return phoneType === 'MOBILE' || phoneType === 'FIXED_LINE_OR_MOBILE'
}

const BOLIVIA_BRANCH_LOCATIONS = [
  {
    terms: ['la paz', 'oficina central', 'lapaz', 'sede central'],
    label: 'Oficina Central (La Paz)',
    address: 'Av. Mariscal Santa Cruz esq. C. Oruro, Edif. Telecomunicaciones.',
  },
  {
    terms: ['cochabamba', 'cbba'],
    label: 'Cochabamba',
    address: 'C. Ayacucho esq. Av. Heroínas N° 113.',
  },
  {
    terms: ['santa cruz', 'scz'],
    label: 'Santa Cruz',
    address: 'C. Cobija entre Sucre y Ballivián N° 24.',
  },
  {
    terms: ['oruro'],
    label: 'Oruro',
    address: 'C. Presidente Montes esq. Junín N° 1456.',
  },
  {
    terms: ['potosi', 'potosí', 'villa imperial'],
    label: 'Potosí',
    address: 'C. Hoyos esq. Topáter, Villa Imperial de Potosí.',
  },
  {
    terms: ['tarija'],
    label: 'Tarija',
    address: 'C. Mariscal Sucre esq. Virginio Lema N° 397.',
  },
  {
    terms: ['sucre', 'chuquisaca'],
    label: 'Sucre (Chuquisaca)',
    address: 'C. Junín esq. Ayacucho N° 699.',
  },
  {
    terms: ['beni', 'trinidad'],
    label: 'Beni',
    address: 'C. Cipriano Barace N° 10 entre Manuel Limpias y C. Sucre.',
  },
  {
    terms: ['pando', 'cobija'],
    label: 'Pando',
    address: 'Av. Bruno Racua N° 59.',
  },
]

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

const fetchLocalContactPackagesCatalog = async () => {
  const result = await pool.query(
    `
      select id, name, company, channel, social_profiles, segment, owner_name, status, updated_at
      from contacts
      where exists (
        select 1
        from jsonb_array_elements(coalesce(social_profiles, '[]'::jsonb)) as profile
        where lower(coalesce(profile->>'channel', '')) = 'ems'
      )
      order by updated_at desc, id desc;
    `,
  )

  return result.rows.map((row) => {
    const profiles = Array.isArray(row.social_profiles) ? row.social_profiles : []
    const emsProfile = profiles.find(
      (profile) => String(profile?.channel ?? '').trim().toLowerCase() === 'ems',
    )
    const whatsappProfile = profiles.find(
      (profile) => String(profile?.channel ?? '').trim().toLowerCase() === 'whatsapp',
    )
    const code = String(emsProfile?.reference ?? '').trim() || null
    const whatsappReference = String(whatsappProfile?.reference ?? '').trim() || null
    const senderName = String(row.name ?? '').trim() || 'Sin remitente'
    const recipientName = String(row.company ?? '').trim() || senderName
    const statusName = String(row.status ?? '').trim() || 'Sin estado'
    const destinationLabel = String(row.company ?? '').trim() || 'Sin destino'

    return {
      id: row.id,
      codigo: code,
      tipo: String(row.segment ?? '').trim() || 'Paquetes-Contactos API',
      estado: { nombre: statusName },
      remitente: {
        nombre: senderName,
        telefono: whatsappReference,
      },
      destinatario: {
        nombre: recipientName,
        telefono: whatsappReference,
        direccion: destinationLabel,
      },
      origen: {
        nombre: String(row.owner_name ?? '').trim() || 'Integración EMS',
        telefono: null,
      },
      destino: {
        nombre: destinationLabel,
        telefono: null,
        direccion: destinationLabel,
      },
      fecha_registro: row.updated_at ?? null,
    }
  })
}

const fetchAllContactPackagesCatalog = async () => {
  const cacheKey = 'all'
  const cachedCatalog = getCachedValue(contactPackagesCatalogCache, cacheKey)
  if (cachedCatalog) {
    return cachedCatalog
  }

  reloadLocalEnv()
  const contactPackagesApiDefaults = getContactPackagesApiDefaults()
  const timeoutMs = Number.parseInt(process.env.CONTACT_PACKAGES_CATALOG_TIMEOUT_MS || '30000', 10)
  const upstreamUrl = new URL(contactPackagesApiDefaults.endpoint)

  try {
    const items = await fetchAllPaginatedItems({
      url: upstreamUrl,
      headers: {
        Authorization: `Bearer ${contactPackagesApiDefaults.token}`,
        Accept: 'application/json',
      },
      perPage: 200,
      maxPages: 500,
      timeoutMs,
    })

    if (items.length > 0) {
      return setCachedValue(
        contactPackagesCatalogCache,
        cacheKey,
        {
          data: items,
          total: items.length,
          cachedAt: new Date().toISOString(),
          source: 'remote',
        },
        CONTACT_PACKAGES_CATALOG_TTL_MS,
      )
    }
  } catch (error) {
    await writeSystemLog({
      level: 'warn',
      event: 'contact_packages_catalog_remote_failed',
      statusCode: 502,
      details: {
        error: error instanceof Error ? error.message : 'Error desconocido.',
        endpoint: contactPackagesApiDefaults.endpoint,
      },
    }).catch(() => {})
  }

  const fallbackItems = await fetchLocalContactPackagesCatalog()

  return setCachedValue(
    contactPackagesCatalogCache,
    cacheKey,
    {
      data: fallbackItems,
      total: fallbackItems.length,
      cachedAt: new Date().toISOString(),
      source: 'local-cache',
    },
    CONTACT_PACKAGES_CATALOG_TTL_MS,
  )
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
  if (!Number.isFinite(parsed)) {
    return ''
  }

  const date = new Date(parsed)
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

const createEmsPipelineCard = ({
  id,
  code,
  stage,
  title,
  summary,
  senderName,
  senderReference,
  recipientName,
  recipientReference,
  destination,
  status,
  updatedAt,
  sourceKind,
}) => ({
  id,
  stage,
  code,
  title,
  summary,
  senderName,
  senderReference,
  recipientName,
  recipientReference,
  destination,
  status,
  updatedAt,
  sourceKind,
})

const buildEmsPipelineCards = async () => {
  if (!getPackagePipelineSyncSnapshot()) {
    await ensurePackagePipelineSync()
  }

  const trackingCatalog = getCachedTrackingPackagesCatalog()?.data ?? []
  const contactCatalog = getCachedContactPackagesCatalog()?.data ?? []
  const [pipelineConfig, overrides] = await Promise.all([
    getStoredPipelineConfig(),
    getStoredEmsStageOverrides(),
  ])
  const customColumns = Array.isArray(pipelineConfig?.customColumns) ? pipelineConfig.customColumns : []
  const overrideMap = normalizeEmsStageOverrideMap(overrides)

  const cards = []

  trackingCatalog.forEach((item, index) => {
    const code = getPackageCodeFromItem(item)
    if (!code) return

    const latestEvent = getTrackingLatestEvent(item)
    const stage = overrideMap[code] ?? inferTrackingPackageStage(item)
    const senderName = normalizeReference(item?.remitente?.nombre) || getPackageLocationLabel(item?.origen, 'Sin remitente')
    const recipientName = normalizeReference(item?.destinatario?.nombre) || getPackageLocationLabel(item?.destino, 'Sin destinatario')
    const senderReference =
      normalizeReference(item?.remitente?.telefono) ||
      normalizeReference(item?.telefonos?.remitente) ||
      'Sin referencia'
    const recipientReference =
      normalizeReference(item?.destinatario?.telefono) ||
      normalizeReference(item?.telefonos?.destinatario) ||
      'Sin referencia'
    const destination = getTrackingDestinationPlace(item)
    const status = normalizeReference(item?.estado?.nombre) || normalizeReference(item?.estado_postal) || getEmsStatusLabel(stage)

    cards.push(
      createEmsPipelineCard({
        id: `tracking-${item?.mailitm_pid ?? code ?? index + 1}`,
        code,
        stage,
        title: `Tracking ${code}`,
        summary: normalizeReference(item?.contenido) || `${senderName} -> ${recipientName}`,
        senderName,
        senderReference,
        recipientName,
        recipientReference,
        destination,
        status,
        updatedAt:
          getPackageContextDateValue(latestEvent?.fecha) ||
          getPackageContextDateValue(item?.fecha_registro) ||
          new Date().toISOString(),
        sourceKind: 'tracking',
      }),
    )
  })

  contactCatalog.forEach((item, index) => {
    const code = normalizeReference(item?.codigo) || `CP-${index + 1}`
    const stage = overrideMap[code] ?? inferContactPackageStage(item)
    const senderName =
      normalizeReference(item?.remitente?.nombre) ||
      normalizeReference(item?.origen?.nombre) ||
      'Sin remitente'
    const senderReference =
      normalizeReference(item?.remitente?.telefono) ||
      normalizeReference(item?.origen?.telefono) ||
      'Sin referencia'
    const recipientName =
      normalizeReference(item?.destinatario?.nombre) ||
      normalizeReference(item?.destino?.nombre) ||
      'Sin destinatario'
    const recipientReference =
      normalizeReference(item?.destinatario?.telefono) ||
      normalizeReference(item?.destino?.telefono) ||
      'Sin referencia'
    const destination =
      normalizeReference(item?.destino?.direccion) ||
      normalizeReference(item?.destino?.nombre) ||
      normalizeReference(item?.destinatario?.direccion) ||
      'Sin destino'
    const status = normalizeReference(item?.estado?.nombre) || getEmsStatusLabel(stage)

    cards.push(
      createEmsPipelineCard({
        id: `contact-${item?.id ?? code}`,
        code,
        stage,
        title: code,
        summary: `${senderName} -> ${recipientName}`,
        senderName,
        senderReference,
        recipientName,
        recipientReference,
        destination,
        status,
        updatedAt: getPackageContextDateValue(item?.fecha_registro) || new Date().toISOString(),
        sourceKind: 'contact',
      }),
    )
  })

  cards.sort((firstCard, secondCard) => {
    const firstTime = Date.parse(firstCard.updatedAt)
    const secondTime = Date.parse(secondCard.updatedAt)

    if (Number.isFinite(firstTime) && Number.isFinite(secondTime) && firstTime !== secondTime) {
      return secondTime - firstTime
    }

    return String(firstCard.code).localeCompare(String(secondCard.code), 'es')
  })

  return {
    cards,
    customColumns,
  }
}





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
  const source = config ?? {}
  const sampleContactId = Number(source.sampleContactId)
  const temperature = Number(source.temperature)

  return {
    presetKey: pipelineStageKeys.includes(source.presetKey) ? source.presetKey : fallback.presetKey,
    systemPrompt: normalizeReference(source.systemPrompt) || fallback.systemPrompt,
    userTemplate: normalizeReference(source.userTemplate) || fallback.userTemplate,
    temperature:
      Number.isFinite(temperature) && temperature >= 0 && temperature <= 1
        ? Number(temperature.toFixed(1))
        : fallback.temperature,
    action: normalizeReference(source.action) || fallback.action,
    sampleContactId: Number.isInteger(sampleContactId) && sampleContactId > 0 ? sampleContactId : null,
    response: normalizeReference(source.response) || fallback.response,
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
  const fallback = defaultPipelineConfig.columns[columnKey] ?? {
    title: columnKey || 'Estado',
    helper: 'Columna del flujo EMS',
  }

  return {
    title: normalizeReference(config.title) || fallback?.title || columnKey || 'Estado',
    helper: normalizeReference(config.helper) || fallback?.helper || 'Columna del flujo EMS',
    allowedStates: Array.isArray(config.allowedStates)
      ? [...new Set(config.allowedStates.map((value) => normalizeReference(value).replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase()).filter(Boolean))]
      : [],
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
  const allowedStates = Array.isArray(config.allowedStates)
    ? [...new Set(config.allowedStates.map((value) => normalizeReference(value).replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase()).filter(Boolean))]
    : []

  return { id, title, helper, allowedStates }
}

const buildPipelineConfigFromRows = (rows = []) => {
  const nextConfig = { columns: {}, customColumns: [] }
  const normalizedRows = rows.map((row) => ({
    stateKey: normalizeReference(row.state_key).toLowerCase(),
    title: normalizeReference(row.title),
    helper: normalizeReference(row.helper),
    allowedStates: Array.isArray(row.allowed_states)
      ? row.allowed_states
      : typeof row.allowed_states === 'string'
        ? (() => {
            try {
              const parsed = JSON.parse(row.allowed_states)
              return Array.isArray(parsed) ? parsed : []
            } catch {
              return []
            }
          })()
        : [],
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
          allowedStates: row.allowedStates,
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
      select state_key, title, helper, allowed_states, stage_order
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
        allowedStates: nextConfig.columns[columnKey].allowedStates ?? [],
        stageOrder: index + 1,
        isSystem: true,
      })),
      ...nextConfig.customColumns.map((column, index) => ({
        stateKey: column.id,
        title: column.title,
        helper: column.helper,
        allowedStates: column.allowedStates ?? [],
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
            allowed_states,
            stage_order,
            is_system,
            updated_at
          )
          values ($1, $2, $3, $4, $5::jsonb, $6, $7, now())
          on conflict (pipeline_key, state_key) do update
          set title = excluded.title,
              helper = excluded.helper,
              allowed_states = excluded.allowed_states,
              stage_order = excluded.stage_order,
              is_system = excluded.is_system,
              updated_at = now();
        `,
        ['ems', row.stateKey, row.title, row.helper, JSON.stringify(row.allowedStates ?? []), row.stageOrder, row.isSystem],
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
  const events = Array.isArray(item?.eventos) ? item.eventos : []

  return events
    .slice()
    .sort((firstEvent, secondEvent) => {
      const firstTime = Date.parse(normalizeReference(firstEvent?.fecha))
      const secondTime = Date.parse(normalizeReference(secondEvent?.fecha))
      return (Number.isNaN(secondTime) ? 0 : secondTime) - (Number.isNaN(firstTime) ? 0 : firstTime)
    })[0] ?? null
}

const getPackageLatestEvent = (item) => {
  const events = Array.isArray(item?.eventos) ? item.eventos.filter(Boolean) : []
  if (events.length === 0) return null

  return events.reduce((latest, current) => {
    const latestTimestamp = Date.parse(normalizeReference(latest?.fecha))
    const currentTimestamp = Date.parse(normalizeReference(current?.fecha))

    if (!Number.isNaN(currentTimestamp) && !Number.isNaN(latestTimestamp)) {
      return currentTimestamp >= latestTimestamp ? current : latest
    }

    if (!Number.isNaN(currentTimestamp)) return current
    if (!Number.isNaN(latestTimestamp)) return latest
    return current
  }, events[events.length - 1])
}

const getNationalPackageStageFromEvent = (event) => {
  if (!event) return null

  const eventId = Number(event?.evento_id ?? event?.codigo_evento)
  if (eventId === 4402) return 'cancelled'
  if (eventId === 4405) return 'regional'
  if (eventId === 4404) return 'received'
  if (eventId === 316) return 'delivered'
  if (eventId === 312) return 'regional'
  if (eventId === 240) return 'transit'
  if (eventId === 295 || eventId === 297) return 'received'

  const eventText = normalizeReference(
    [event?.nombre, event?.evento_api, event?.evento_original, event?.movimiento_bolivia, event?.detalle]
      .filter(Boolean)
      .join(' '),
  ).toLowerCase()

  if (eventText.includes('cancel') || eventText.includes('anul') || eventText.includes('rechaz')) return 'cancelled'
  if (eventText.includes('devuelto')) return 'cancelled'
  if (eventText.includes('entreg')) return 'delivered'
  if (eventText.includes('listo para entregar') || eventText.includes('oficina de entrega')) return 'regional'
  if (eventText.includes('cartero') || eventText.includes('reparto')) return 'courier'
  if (eventText.includes('saca interna') || eventText.includes('salida') || eventText.includes('transito')) return 'transit'
  if (eventText.includes('recibido') || eventText.includes('origen')) return 'received'

  return null
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

const getPackageStageFromEvents = (item) => {
  const events = Array.isArray(item?.eventos) ? item.eventos.filter(Boolean) : []
  return events.reduce((bestStage, event) => {
    const eventStage = getNationalPackageStageFromEvent(event)
    return getPackageStageRank(eventStage) > getPackageStageRank(bestStage) ? eventStage : bestStage
  }, null)
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

const inferContactPackageStage = (item) => {
  const statusText = normalizeReference(item?.estado?.nombre)
  const normalizedStatus = statusText.toLowerCase()
  const eventStage = getPackageStageFromEvents(item)

  if (eventStage) {
    return eventStage
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

  if (stage === 'cancelled') {
    return 'El paquete fue cancelado, anulado o rechazado. Debes informar que ya no continuara el flujo operativo y evitar prometer nuevos movimientos.'
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
  if (stage === 'cancelled') return 95
  if (stage === 'courier') return 85
  if (stage === 'regional') return 70
  if (stage === 'transit') return 55
  return 40
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

const fetchAllTrackingPackagesCatalog = async (options = {}) => {
  reloadLocalEnv()

  const trackingApiDefaults = getTrackingApiDefaults()
  const trackingUrl = new URL('/api/tracking/paquetes', trackingApiDefaults.baseUrl)
  const cacheKey = 'all'
  const items = []
  const seenKeys = new Set()
  const pageSize = 12
  const maxPages = 500

  try {
    for (let page = 1; page <= maxPages; page += 1) {
      const paginatedUrl = new URL(trackingUrl.toString())
      paginatedUrl.searchParams.set('page', String(page))
      paginatedUrl.searchParams.set('per_page', String(pageSize))

      const response = await fetchJsonWithTimeout(paginatedUrl, {
        headers: {
          Authorization: `Bearer ${trackingApiDefaults.token}`,
          Accept: 'application/json',
        },
      })

      if (!response?.ok) {
        break
      }

      const payload = await response.json().catch(() => null)
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
        items.push(item)
      }
    }
  } catch (error) {
    await writeSystemLog({
      level: 'warn',
      event: 'tracking_catalog_remote_failed',
      statusCode: 200,
      details: {
        error: error instanceof Error ? error.message : 'Error desconocido.',
        source: 'sync',
      },
    }).catch(() => {})
  }

  items.sort((firstItem, secondItem) => {
    const firstDate = Date.parse(
      normalizeReference(firstItem?.fecha_registro) ||
        normalizeReference(firstItem?.eventos?.[0]?.fecha) ||
        '',
    )
    const secondDate = Date.parse(
      normalizeReference(secondItem?.fecha_registro) ||
        normalizeReference(secondItem?.eventos?.[0]?.fecha) ||
        '',
    )

    if (Number.isFinite(firstDate) && Number.isFinite(secondDate) && firstDate !== secondDate) {
      return firstDate - secondDate
    }

    return String(firstItem?.codigo_s10 ?? firstItem?.codigo ?? '').localeCompare(
      String(secondItem?.codigo_s10 ?? secondItem?.codigo ?? ''),
      'es',
    )
  })

  return setCachedValue(
    packagePipelineSyncCache,
    cacheKey,
    {
      data: items,
      total: items.length,
      cachedAt: new Date().toISOString(),
    },
    CONTACT_PACKAGES_CATALOG_TTL_MS,
  )
}

const getCachedTrackingPackagesCatalog = () => {
  const cachedCatalog = getCachedValue(packagePipelineSyncCache, 'all')
  if (!cachedCatalog || !Array.isArray(cachedCatalog.data)) {
    return null
  }

  return cachedCatalog
}

const buildTrackingCatalogFallbackPayload = (source = 'local-cache') => {
  const cachedCatalog = getCachedTrackingPackagesCatalog()
  if (cachedCatalog) {
    return {
      ...cachedCatalog,
      source,
      fallback: true,
    }
  }

  return {
    data: [],
    total: 0,
    cachedAt: new Date().toISOString(),
    source,
    fallback: true,
  }
}

const syncPackagePipelineFromApis = async () => {
  await ensureDatabaseReady()
  reloadLocalEnv()

  const [trackingResult, contactResult] = await Promise.allSettled([
    fetchAllTrackingPackagesCatalog(),
    fetchAllContactPackagesCatalog(),
  ])

  const trackingItems =
    trackingResult.status === 'fulfilled' && Array.isArray(trackingResult.value?.data)
      ? trackingResult.value.data
      : []
  const contactPackageCatalog =
    contactResult.status === 'fulfilled' && Array.isArray(contactResult.value?.data)
      ? contactResult.value.data
      : []

  if (trackingResult.status === 'rejected') {
    await writeSystemLog({
      level: 'warn',
      event: 'tracking_catalog_remote_failed',
      statusCode: 200,
      details: {
        error: trackingResult.reason instanceof Error ? trackingResult.reason.message : String(trackingResult.reason ?? 'Error desconocido.'),
        source: 'sync-settled',
      },
    }).catch(() => {})
  }

  if (contactResult.status === 'rejected') {
    await writeSystemLog({
      level: 'warn',
      event: 'contact_packages_catalog_remote_failed',
      statusCode: 200,
      details: {
        error: contactResult.reason instanceof Error ? contactResult.reason.message : String(contactResult.reason ?? 'Error desconocido.'),
        source: 'sync-settled',
      },
    }).catch(() => {})
  }

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
      getPackageStageRank(entry.stage) > getPackageStageRank(existing.stage) ||
      (getPackageStageRank(entry.stage) === getPackageStageRank(existing.stage) &&
        (entry.updatedAt > existing.updatedAt ||
          (entry.updatedAt === existing.updatedAt &&
            getPackageSyncEntrySpecificity(entry) > getPackageSyncEntrySpecificity(existing))))

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

    const latestEvent = getTrackingLatestEvent(item)
    const stage = inferTrackingPackageStage(item)
    registerEntry({
      code,
      source: 'tracking',
      stage,
      updatedAt:
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
      sources: ['Tracking'],
      phoneCandidates: getPackageSyncPhoneCandidates(item, 'tracking'),
    })
  })

  contactPackageCatalog.forEach((item) => {
    const code = getPackageCodeFromItem(item)
    if (!code) return

    const stage = inferContactPackageStage(item)
    registerEntry({
      code,
      source: 'contact',
      stage,
      updatedAt: getPackageContextDateValue(item?.fecha_registro) || 0,
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
      sources: ['Paquetes-Contactos'],
      phoneCandidates: getPackageSyncPhoneCandidates(item, 'contact'),
    })
  })

  const packageEntries = [...packageEntriesByCode.values()]
  const client = await pool.connect()
  const syncedAt = new Date().toISOString()
  let createdCount = 0
  let updatedCount = 0

  try {
    await client.query('begin')

    for (const entry of packageEntries) {
      const nextResult = await upsertPackageContact(client, entry)
      if (nextResult?.action === 'created') {
        createdCount += 1
      } else if (nextResult?.action === 'updated') {
        updatedCount += 1
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

const buildPackagePipelineSyncFallback = (error = null) => {
  const cached = getCachedValue(packagePipelineSyncCache, 'last-sync')
  if (cached && typeof cached === 'object') {
    return {
      ok: true,
      ...cached,
      fallback: true,
      syncWarning: error instanceof Error ? error.message : String(error ?? 'Sin detalle de error.'),
    }
  }

  return {
    ok: true,
    syncedAt: new Date().toISOString(),
    createdCount: 0,
    updatedCount: 0,
    total: 0,
    fallback: true,
    syncWarning: error instanceof Error ? error.message : String(error ?? 'Sin detalle de error.'),
  }
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
  return Array.isArray(payload?.data) ? payload.data : []
}

const getPaginatedPayloadTotal = (payload, fallbackItemsLength = 0) => {
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

  return fallbackItemsLength
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

    const response = await fetchJsonWithTimeout(paginatedUrl, { headers }, timeoutMs).catch(() => null)
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

    const totalItems = getPaginatedPayloadTotal(payload, allItems.length)
    if (allItems.length >= totalItems) {
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
    totalItems = getPaginatedPayloadTotal(payload, totalItems || items.length)

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
    totalItems: getPaginatedPayloadTotal(payload, items.length),
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
  const stageOverrides = await getStoredEmsStageOverrides()
  const mostAdvancedCode = normalizeReference(mostAdvancedEntry?.code).toUpperCase()
  const latestPackageCode = normalizeReference(latestPackageEntry?.code).toUpperCase()
  const overrideStage = stageOverrides[mostAdvancedCode] ?? stageOverrides[latestPackageCode] ?? null
  const stage = overrideStage ?? mostAdvancedEntry?.stage ?? latestPackageEntry?.stage ?? null

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

  const sendOnce = async () => {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 20000)

    try {
      return await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(messagePayload),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeoutId)
    }
  }

  let response = null
  let lastError = null

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      response = await sendOnce()
      break
    } catch (error) {
      lastError = error
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 1200))
      }
    }
  }

  if (!response) {
    throw lastError || new Error('No se pudo conectar con Meta para enviar el mensaje.')
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

  if (
    normalized.includes('recibido destino') ||
    normalized.includes('recibido regional') ||
    normalized.includes('regional') ||
    normalized.includes('destino') ||
    normalized.includes('sucursal de destino') ||
    normalized.includes('pasar a recoger')
  ) {
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
    normalized.includes('vuelo') ||
    normalized.includes('activo') ||
    normalized.includes('proceso') ||
    normalized.includes('proces') ||
    normalized.includes('en curso') ||
    normalized.includes('ruta') ||
    normalized.includes('clasific')
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
    normalized.includes('cancel') ||
    normalized.includes('anul') ||
    normalized.includes('rechaz') ||
    normalized.includes('devuelto') ||
    normalized.includes('retornado')
  ) {
    return 'cancelled'
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
  const prompt = [
    'Clasifica el estado EMS del contacto en una sola palabra exacta:',
    '- received',
    '- transit',
    '- regional',
    '- courier',
    '- delivered',
    '',
    `Contacto: ${contact.name || 'Sin nombre'}`,
    `Empresa: ${contact.company || 'No registrada'}`,
    `Estado actual: ${contact.status || 'Sin estado'}`,
    '',
    conversationContext ? `Ultimas interacciones (hasta 4 chats recientes):\n${conversationContext}` : 'Sin historial reciente.',
    '',
      'Responde solo con una de estas palabras: received, transit, regional, courier, delivered, cancelled.',
  ].join('\n')

  let inferredStatus =
    packageContext?.matched && packageContext.stage
      ? packageContext.stage
      : inferEmsStatusFromText(conversationContext || contact.status) || 'received'

  const shouldCallAiForStatus =
    !packageContext?.matched &&
    normalizeReference(conversationContext || contact.status).length > 0

  if (shouldCallAiForStatus) {
    try {
      const aiResult = await callOllamaGenerate({ prompt })
      const aiStatus = normalizeEmsStatus(aiResult.response)
      if (aiStatus) {
        inferredStatus = aiStatus
      }
    } catch (error) {
      console.warn('No se pudo clasificar el estado EMS con IA:', error.message)
    }
  }

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

const buildFallbackAgentReplyLegacy = ({ contact, messageBody, currentStatus, packageContext = null }) => {
  const normalizedMessage = normalizeReference(messageBody).toLowerCase()
  const contactName = normalizeReference(contact?.name) || 'Hola'
  const originDepartmentMatch = /departamento origen ([^|\n]+)/i.exec(packageContext?.summaryText || '')
  const destinationDepartmentMatch = /departamento destino ([^|\n]+)/i.exec(packageContext?.summaryText || '')
  const originMatch = /origen ([^|\n]+)/i.exec(packageContext?.summaryText || '')
  const destinationPlaceMatch = /destino ([^|\n]+)/i.exec(packageContext?.summaryText || '')
  const destinationMatch =
    /direccion destino ([^|\n]+)/i.exec(packageContext?.summaryText || '') ||
    destinationPlaceMatch
  const originText = normalizeReference(originDepartmentMatch?.[1]) || normalizeReference(originMatch?.[1])
  const destinationText = normalizeReference(destinationDepartmentMatch?.[1]) || normalizeReference(destinationMatch?.[1])
  const isDeliveryQuestion =
    normalizedMessage.includes('llego') ||
    normalizedMessage.includes('llegó') ||
    normalizedMessage.includes('entregado') ||
    normalizedMessage.includes('paquete') ||
    normalizedMessage.includes('envio') ||
    normalizedMessage.includes('envío')

  if (packageContext?.matched && packageContext.stage === 'delivered') {
    return `Perfecto, ${contactName}. Veo el paquete como entregado. Gracias por confirmarlo; si necesitas algo adicional, quedo atento para ayudarte.`
  }

  if (packageContext?.matched && packageContext.stage === 'transit') {
    const destinationMatch = /direccion destino ([^|\n]+)/i.exec(packageContext.summaryText) || /destino ([^|\n]+)/i.exec(packageContext.summaryText)
    const destinationText = normalizeReference(destinationMatch?.[1])

    if (destinationText) {
      return `Gracias por escribirnos, ${contactName}. Tu paquete esta en transito y va con destino a ${destinationText}. Seguimos monitoreando el avance para avisarte el siguiente movimiento confirmado.`
    }

    return `Gracias por escribirnos, ${contactName}. Tu paquete esta en transito y con seguimiento activo. Seguimos monitoreando el avance para avisarte el siguiente movimiento confirmado.`
  }

  if (packageContext?.matched && packageContext.stage === 'regional') {
    return `Su paquete ${packageContext.currentPackageCode || ''} ya se encuentra en nuestra sucursal de destino${destinationText ? `, ${destinationText}` : ''}. Le informaremos cuando pase a reparto.`
      .replace('  ', ' ')
  }

  if (packageContext?.matched && packageContext.stage === 'courier') {
    return `Su paquete ${packageContext.currentPackageCode || ''} está con el cartero y se dirige a su destino. Le informaremos cuando se confirme la entrega.`.replace('  ', ' ')
  }

  if (packageContext?.matched && packageContext.stage === 'transit') {
    return isDeliveryQuestion
      ? `Gracias, ${contactName}. Veo tu paquete en transito y con seguimiento activo. Te compartire la siguiente novedad apenas tengamos un nuevo movimiento confirmado.`
      : `Gracias por escribirnos, ${contactName}. Tu paquete sigue en transito y ya estamos monitoreando el avance para avisarte la siguiente actualizacion.`
  }

  if (packageContext?.matched && packageContext.stage === 'received') {
    return `Gracias por escribirnos, ${contactName}. Ya identificamos tu paquete y figura como recibido en nuestra sucursal de origen${originText ? `, ${originText}` : ''}${destinationText ? `, con destino a ${destinationText}` : ''}. Te iremos guiando con la siguiente actualizacion disponible.`
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

const buildProactivePackageUpdateMessage = ({ packageContext = null, contact = null }) => {
  const contactName = normalizeReference(contact?.name)
  const packageCode = normalizeReference(packageContext?.currentPackageCode)
  const originText =
    normalizeReference(packageContext?.currentOriginDepartment) ||
    normalizeReference(packageContext?.currentOriginLabel)
  const originBranch = getPackageOriginBranch(packageContext)
  const originLocationText = originBranch
    ? `${originBranch.label}: ${originBranch.address}`
    : originText
  const destinationText =
    normalizeReference(packageContext?.currentDestinationDepartment) ||
    normalizeReference(packageContext?.currentDestinationLabel) ||
    normalizeReference(packageContext?.currentDestinationAddress)
  const destinationBranch = getPackageDestinationBranch(packageContext)
  const destinationLocationText = destinationBranch
    ? `${destinationBranch.label}: ${destinationBranch.address}`
    : destinationText

  if (!packageContext?.matched || !packageContext?.stage) {
    return ''
  }

  if (packageContext.stage === 'transit') {
    return `Tu paquete ${packageCode || ''} ya fue despachado${originText ? ` desde ${originText}` : ''}${destinationText ? ` con destino a ${destinationText}` : ''}. Te avisaremos cuando registre el siguiente movimiento.`
      .replace(/\s+/g, ' ')
      .trim()
  }

  if (packageContext.stage === 'regional') {
    return `Tu paquete ${packageCode || ''} ya llego a nuestra sucursal de ${destinationLocationText || 'destino'} y esta listo para recoger. Te esperamos.`
      .replace(/\s+/g, ' ')
      .trim()
  }

  if (packageContext.stage === 'courier') {
    return `Tu paquete ${packageCode || ''} ya salio a reparto${destinationText ? ` hacia ${destinationText}` : ''}. Te avisaremos cuando se confirme la entrega.`
      .replace(/\s+/g, ' ')
      .trim()
  }

  if (packageContext.stage === 'delivered') {
    return `Tu paquete ${packageCode || ''} ya fue entregado${destinationLocationText ? ` en ${destinationLocationText}` : ''}. ${contactName ? `Gracias, ${contactName}. ` : ''}Si necesitas ayuda adicional, aqui estoy.`
      .replace(/\s+/g, ' ')
      .trim()
  }

  return `Tu paquete ${packageCode || ''} fue recibido${originText ? ` en ${originText}` : ''}${destinationLocationText ? ` con destino a ${destinationLocationText}` : ''}. Te avisaremos cuando sea despachado.`
    .replace(/\s+/g, ' ')
    .trim()
}

const buildFallbackAgentReply = ({ contact, messageBody, currentStatus, packageContext = null }) => {
  const normalizedMessage = normalizeReference(messageBody).toLowerCase()
  const contactName = normalizeReference(contact?.name) || 'Hola'
  const originText =
    normalizeReference(packageContext?.currentOriginDepartment) ||
    normalizeReference(packageContext?.currentOriginLabel)
  const originBranch = getPackageOriginBranch(packageContext)
  const originLocationText = originBranch
    ? `${originBranch.label}: ${originBranch.address}`
    : originText
  const destinationText =
    normalizeReference(packageContext?.currentDestinationDepartment) ||
    normalizeReference(packageContext?.currentDestinationLabel) ||
    normalizeReference(packageContext?.currentDestinationAddress)
  const destinationBranch = getPackageDestinationBranch(packageContext)
  const destinationLocationText = destinationBranch
    ? `${destinationBranch.label}: ${destinationBranch.address}`
    : destinationText
  const statusMatch = /estado ([^|\n]+)/i.exec(packageContext?.summaryText || '')
  const packageStatusText = normalizeReference(statusMatch?.[1]) || 'transito'
  const isLocationQuestion =
    normalizedMessage.includes('donde esta') ||
    normalizedMessage.includes('donde estan') ||
    normalizedMessage.includes('a donde va') ||
    normalizedMessage.includes('por donde va') ||
    normalizedMessage.includes('ubicacion')
  const isDeliveryQuestion =
    normalizedMessage.includes('llego') ||
    normalizedMessage.includes('entregado') ||
    normalizedMessage.includes('paquete') ||
    normalizedMessage.includes('envio')
  const isPickupConfirmation =
    normalizedMessage.includes('pasare a recoger') ||
    normalizedMessage.includes('pasaré a recoger') ||
    normalizedMessage.includes('voy a recoger') ||
    normalizedMessage.includes('ire a recoger') ||
    normalizedMessage.includes('iré a recoger') ||
    normalizedMessage.includes('pasare manana') ||
    normalizedMessage.includes('pasaré mañana') ||
    normalizedMessage.includes('mañana paso') ||
    normalizedMessage.includes('manana paso')
  const isDeliveryConfirmation =
    normalizedMessage.includes('ya lo recibi') ||
    normalizedMessage.includes('ya lo recibí') ||
    normalizedMessage.includes('ya recibi') ||
    normalizedMessage.includes('ya recibí') ||
    normalizedMessage.includes('me entregaron') ||
    normalizedMessage.includes('ya me llego') ||
    normalizedMessage.includes('ya me llegó')
  const isGreetingOnly = isGreetingMessage(messageBody)
  const isPackageInquiry = isPackageInquiryMessage(messageBody)
  const packageEventsText = normalizeReference(packageContext?.packageEventsText)
  const shouldShowPackageEvents =
    packageContext?.matched &&
    packageEventsText &&
    (isLocationQuestion ||
      normalizedMessage.includes('eventos') ||
      normalizedMessage.includes('historial') ||
      normalizedMessage.includes('por donde estuvo') ||
      normalizedMessage.includes('donde estuvo'))

  if (isGreetingOnly) {
    return `¡Hola! ${getBoliviaDayGreeting()}. Soy Jaimito, de Correos de Bolivia. ¿En qué te puedo ayudar hoy?`
  }

  if (isPackageInquiry && !hasPackageCode(messageBody)) {
    return '¡Con gusto te ayudo a rastrearlo! 📦 ¿Me compartes tu número de seguimiento, por favor?'
  }

  if (packageContext?.matched && packageContext.stage === 'delivered') {
    return isDeliveryConfirmation
      ? 'Perfecto. Gracias por confirmarnos la entrega. Si necesitas algo mas, aqui estoy para ayudarte.'
      : 'Tu paquete ya fue entregado. Si necesitas revisar algun detalle adicional, aqui te ayudo.'
  }

  if (shouldShowPackageEvents) {
    const packageCode = normalizeReference(packageContext?.currentPackageCode) || 'el paquete'
    const finalLocation =
      normalizeReference(packageContext?.currentDestinationAddress) ||
      normalizeReference(packageContext?.currentDestinationLabel) ||
      normalizeReference(packageContext?.currentDestinationDepartment) ||
      normalizeReference(packageContext?.currentOriginLabel) ||
      'sin ubicacion precisa'

    return [
      `Claro, ${contactName}. Te comparto el historial de ${packageCode}:`,
      packageEventsText,
      '',
      `En resumen, la ultima ubicacion conocida es ${finalLocation}.`,
    ]
      .filter(Boolean)
      .join('\n')
  }

  if (packageContext?.matched && packageContext.stage === 'transit') {
    if (isLocationQuestion && destinationText) {
      return `Tu paquete esta en transito y va hacia ${destinationText}. Apenas registre un nuevo movimiento, te avisamos.`
    }

    if (destinationText) {
      return `Tu paquete esta en ${packageStatusText} y va hacia ${destinationText}. Te avisamos apenas registre un nuevo movimiento.`
    }

    return isDeliveryQuestion
      ? `Tu paquete sigue en ${packageStatusText}. En cuanto haya una novedad, te la compartimos.`
      : `Tu paquete sigue en ${packageStatusText}. Te avisamos apenas registre un nuevo movimiento.`
  }

  if (packageContext?.matched && packageContext.stage === 'regional') {
    return isPickupConfirmation
      ? `Perfecto. Tu paquete quedara disponible para recoger en nuestra sucursal de ${destinationText || 'destino'}. Te esperamos manana.`
      : `¡Buenas noticias! Tu paquete ya llegó y está listo para que lo pases a recoger en nuestra sucursal de ${destinationText || 'destino'}. ¡Te esperamos! ✨`
  }

  if (packageContext?.matched && packageContext.stage === 'received') {
    return `Tu paquete fue recibido en nuestra sucursal de origen${originLocationText ? `, ${originLocationText}` : ''}${destinationLocationText ? `, con destino a ${destinationLocationText}` : ''}. En cuanto sea despachado, te compartimos la siguiente actualizacion.`
  }

  if (currentStatus === 'Recibido Destino') {
    return `¡Buenas noticias! Tu paquete ya llegó y está listo para que lo pases a recoger en nuestra sucursal de ${destinationText || 'destino'}. ¡Te esperamos! ✨`
  }

  if (currentStatus === 'Nuevo') {
    return `Tu paquete fue recibido en nuestra sucursal de origen${originLocationText ? `, ${originLocationText}` : ''}${destinationLocationText ? `, con destino a ${destinationLocationText}` : ''}. En cuanto sea despachado, te compartimos la siguiente actualizacion.`
  }

  if (currentStatus === 'Activo' || currentStatus === 'Entregado') {
    return 'Tu caso figura como entregado. Si necesitas revisar algun detalle adicional, aqui te ayudo.'
  }

  if (currentStatus === 'En seguimiento') {
    return isDeliveryQuestion
      ? 'Tu paquete esta en seguimiento. Apenas tengamos una actualizacion, te la compartimos.'
      : `Ya estamos revisando tu envio. En cuanto avance, te compartimos la actualizacion.`
  }

  return `Estamos revisando tu caso. Apenas tengamos una actualizacion, te la compartimos.`
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
  const config = getAiConfig()

  if (heuristicIntent !== 'GENERAL') {
    return {
      category: heuristicIntent,
      model: 'heuristic',
      source: 'heuristic',
    }
  }

  const prompt = [
    'Clasifica el mensaje del cliente en una sola palabra exacta.',
    'Categorias validas: TRACKING, TARIFAS, GENERAL.',
    recentConversation ? `Contexto reciente:\n${recentConversation}` : 'Sin contexto reciente.',
    `Mensaje del cliente: ${normalizeReference(messageBody)}`,
    'Respuesta final: una sola palabra.',
  ].join('\n')

  try {
    const aiReachable = await isAiServiceReachable(config.baseUrl)

    if (!aiReachable) {
      return {
        category: heuristicIntent,
        model: 'heuristic',
        source: 'heuristic',
      }
    }

    const aiResult = await callOllamaGenerate({
      prompt,
      model: config.routerModel,
      fallbackModels: ['phi3:mini', config.generalModel],
      system: config.routerSystemPrompt,
      timeoutMs: config.routerTimeoutMs,
    })
    const routedCategory = normalizeReference(aiResult.response).toUpperCase().split(/\s+/)[0]
    if (AI_ROUTER_CATEGORIES.has(routedCategory)) {
      return {
        category: routedCategory,
        model: aiResult.model,
        source: 'ai-router',
      }
    }
  } catch (error) {
    console.warn('No se pudo clasificar la intencion con el router IA:', error.message)
  }

  return {
    category: heuristicIntent,
    model: 'heuristic',
    source: 'heuristic',
  }
}

const WHATSAPP_AGENT_STYLE_RULES = [
  'Responde como una persona real, con tono cercano, natural y profesional.',
  'Prioriza respuestas cortas y fluidas para WhatsApp: 1 o 2 frases, maximo 32 palabras.',
  'No inventes ubicaciones, fechas, tarifas ni promesas.',
  'Responde solo en espanol y ve directo al punto: evita introducciones largas, listas y explicaciones innecesarias.',
  'Haz una sola pregunta final solo si necesitas aclarar algo.',
]

const buildCommonAgentPromptSections = ({
  contact,
  messageBody,
  recentConversation,
  packageContext,
  sender = '',
  customInstruction = '',
}) => [
  '',
  contact
    ? `Contacto: ${contact.name || 'Sin nombre'}\nEmpresa: ${contact.company || 'No registrada'}\nSegmento: ${contact.segment || 'Sin segmento'}\nEstado: ${contact.status || 'Sin estado'}`
    : 'Contacto: Cliente de WhatsApp',
  packageContext?.matched
    ? `Contexto del paquete disponible para ${normalizeReference(sender)}:\n${packageContext.summaryText}`
    : 'Sin contexto de paquete en APIs.',
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
    ...WHATSAPP_AGENT_STYLE_RULES,
    'Si el paquete ya llego a destino o figura como Recibido Destino, menciona la sucursal exacta y su direccion cuando exista.',
    category === 'TARIFAS'
      ? 'El cliente consulta tarifas o cotizaciones. Si faltan peso, origen o destino, pide solo esos datos minimos.'
      : 'El cliente hace una consulta general. Responde solo lo que pregunta y evita desviarte.',
    ...buildCommonAgentPromptSections({
      contact,
      messageBody,
      recentConversation,
      packageContext,
      sender,
      customInstruction,
    }),
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
    ...WHATSAPP_AGENT_STYLE_RULES,
    'Responde como asesor especialista en seguimiento de paquetes para WhatsApp.',
    'Usa solo el contexto real del paquete y el historial dado.',
    'Si el cliente pregunta donde esta o hacia donde va, menciona estado, destino y sucursal de llegada cuando exista.',
    'No inventes fechas exactas ni eventos no confirmados.',
    ...buildCommonAgentPromptSections({
      contact,
      messageBody,
      recentConversation,
      packageContext: packageContext?.matched
        ? {
            ...packageContext,
            summaryText: `${packageContext.summaryText}\n\nRegla de etapa:\n${packageContext.lifecycleInstruction}`,
          }
        : packageContext,
      sender,
      customInstruction,
    }),
  ]
    .filter(Boolean)
    .join('\n')

const wait = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

const AUTO_REPLY_SETTLE_DELAY_MS = Number.parseInt(process.env.WHATSAPP_AUTO_REPLY_SETTLE_DELAY_MS || '2500', 10)
const WHATSAPP_REMINDER_INTERVAL_MS = Number.parseInt(
  process.env.WHATSAPP_REMINDER_INTERVAL_MS || String(2 * 60 * 60 * 1000),
  10,
)
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

  return isClosingWhatsAppMessage(lastOutbound.message_text)
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
  const lastStageNotificationAt = lastStageNotification?.created_at
    ? new Date(lastStageNotification.created_at).getTime()
    : 0

  if (Number.isFinite(lastStageNotificationAt) && Date.now() - lastStageNotificationAt < WHATSAPP_REMINDER_INTERVAL_MS) {
    return finishWithoutSending('stage-reminder-cooldown-active', {
      contactId: contact.id,
      recipient: normalizedTarget,
      packageCode: packageContext.currentPackageCode,
      packageStage: packageContext.stage,
      packageUpdatedAt: currentPackageUpdatedAt,
      cooldownMs: WHATSAPP_REMINDER_INTERVAL_MS,
    })
  }

  const lastInboundResult = await pool.query(
    `
      select message_text, created_at
      from message_logs
      where contact_id = $1
        and direction = 'inbound'
        and ($2::timestamptz is null or created_at > $2::timestamptz)
      order by created_at desc, id desc
      limit 1;
    `,
    [contact.id, lastStageNotification?.created_at ?? null],
  )

  const lastInboundMessage = lastInboundResult.rows[0] ?? null

  if (lastInboundMessage && isClosingWhatsAppMessage(lastInboundMessage.message_text)) {
    return finishWithoutSending('conversation-closed', {
      contactId: contact.id,
      recipient: normalizedTarget,
      packageCode: packageContext.currentPackageCode,
      packageStage: packageContext.stage,
      packageUpdatedAt: currentPackageUpdatedAt,
    })
  }

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
      options: {
        temperature: 0,
      },
    })

    return normalizeReference(aiResult.response) || normalized
  } catch (error) {
    console.warn('No se pudo traducir el texto al español para la IA:', error.message)
    return normalized
  }
}

const autoReplyInboundWhatsAppMessage = async ({
  contactId,
  sender,
  messageBody,
  inboundMessageId,
  mediaDescriptor = null,
}) => {
  const normalizedSender = normalizePhoneNumber(sender)
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

  if (!contact?.id) {
    contact = (await findContactByWhatsAppReference(normalizedSender)) ?? (await ensureInboundWhatsAppContact(normalizedSender))
    contactId = contact?.id ?? contactId
  }

  if (Number.isInteger(contactId) && contactId > 0 && Number.isInteger(inboundMessageId) && inboundMessageId > 0) {
    await pool.query(
      `
        update message_logs
        set contact_id = coalesce(contact_id, $1)
        where id = $2;
      `,
      [contactId, inboundMessageId],
    )
  }

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
        sender: normalizedSender,
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
          sender: normalizedSender,
          inboundMessageId: inboundMessageId ?? null,
        },
      })
      return null
    }

    const isConversationClosing = isClosingWhatsAppMessage(messageBody)

    if (await shouldSkipAutoReplyBecauseCooldownIsActive({ contactId, sender })) {
      await writeSystemLog({
        event: 'whatsapp_auto_reply_skipped',
        statusCode: 200,
        details: {
          reason: 'cooldown-active',
          contactId: contactId ?? null,
          sender: normalizedSender,
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
        sender: normalizedSender,
      },
    })

    const config = await getStoredWhatsAppConfig()
    const accessToken = normalizeReference(config.accessToken)
    const phoneNumberId = normalizeReference(config.phoneNumberId)

    if (!accessToken || !phoneNumberId) {
      return null
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

    const packageCode = extractPackageCode(messageBody)
    const packageContext = await fetchMatchingPackageContext(sender, packageCode)

    if (mediaDescriptor?.mediaId) {
      try {
        const downloadedMedia = await downloadWhatsAppMedia({
          accessToken,
          apiVersion: config.apiVersion,
          phoneNumberId,
          mediaId: mediaDescriptor.mediaId,
        })

        const mediaDetails = await saveMediaBufferToDisk({
          buffer: downloadedMedia.buffer,
          mimeType: downloadedMedia.mimeType || mediaDescriptor.mimeType || 'application/octet-stream',
          originalName: downloadedMedia.filename || mediaDescriptor.kind,
          prefix: `inbound-${inboundMessageId ?? Date.now()}`,
        })

        if (Number.isInteger(inboundMessageId) && inboundMessageId > 0) {
          await pool.query(
            `
              update message_logs
              set media_path = $1,
                  media_kind = $2,
                  media_mime_type = $3,
                  media_filename = $4
              where id = $5;
            `,
            [
              mediaDetails?.mediaUrl ?? null,
              mediaDescriptor?.kind ?? null,
              mediaDescriptor?.mimeType || mediaDetails?.mimeType || null,
              mediaDetails?.filename ?? null,
              inboundMessageId,
            ],
          )
        }
      } catch (error) {
        console.error('No se pudo descargar el media entrante:', error.message)
      }
    }

    await syncContactEmsStatus({
      contactId,
      currentContact: contact,
      recentMessages: recentMessagesResult.rows,
      providedPackageContext: packageContext,
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

    const translatedMessageBody = await translateTextToSpanishForAi(messageBody)
    const translatedRecentConversation = await translateTextToSpanishForAi(recentConversation)

    const isGreetingOnly = isGreetingMessage(translatedMessageBody)
    const isPackageInquiryWithoutCode = isPackageInquiryMessage(translatedMessageBody) && !hasPackageCode(messageBody)
    const packageCodeNotFound = Boolean(packageCode) && !packageContext.matched
    const routedIntent = await routeCustomerIntent({
      messageBody: translatedMessageBody,
      recentConversation: translatedRecentConversation,
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
        ? `Contexto del paquete para ${normalizedSender}:\n${packageContext.summaryText}\n\nRegla de etapa:\n${packageContext.lifecycleInstruction}`
        : '',
      '',
      translatedRecentConversation ? `Conversacion reciente:\n${translatedRecentConversation}` : 'No hay historial previo.',
      '',
      `Mensaje del cliente: ${translatedMessageBody}`,
      '',
      'Devuelve solo el texto final de la respuesta, sin comillas, sin explicaciones ni markdown.',
    ].join('\n')

    const closingReply = 'Con gusto. Quedo atento por si necesitas algo mas.'

    let finalReply = isConversationClosing
      ? closingReply
      : isGreetingOnly
      ? `¡Hola! ${getBoliviaDayGreeting()}. Soy Jaimito, de Correos de Bolivia. ¿En qué te puedo ayudar hoy?`
      : isPackageInquiryWithoutCode
        ? '¡Con gusto te ayudo a rastrearlo! 📦 ¿Me compartes tu número de seguimiento, por favor?'
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

    if (
      packageCode &&
      packageContext.matched &&
      !isGreetingOnly &&
      !isPackageInquiryWithoutCode &&
      !packageCodeNotFound &&
      !isConversationClosing
    ) {
      finalReply = ''
    }

    const shouldCallAiForReply =
      !finalReply &&
      !packageContext.matched &&
      !isGreetingOnly &&
      !isPackageInquiryWithoutCode &&
      !packageCodeNotFound

    try {
      if (!finalReply && routedIntent.category === 'TRACKING' && packageContext.matched) {
        const aiReply = await callOllamaGenerate({
          prompt: buildTrackingAgentPrompt({
            contact,
            messageBody: translatedMessageBody,
            recentConversation: translatedRecentConversation,
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
            messageBody: translatedMessageBody,
            recentConversation: translatedRecentConversation,
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
          sender: normalizedSender,
          reason: error.message,
          routedCategory: routedIntent.category,
          routedBy: routedIntent.source,
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
      to: normalizedSender,
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
      [contactId ?? null, normalizedSender, finalReply, providerMessageId],
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
        sender: normalizedSender,
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
        sender: normalizedSender,
        error: error.message,
      },
    })
    throw error
  }
}

const AUTO_REPLY_QUEUE_LOCK_KEY = 684051927413
let autoReplyQueueDrainPromise = null
let autoReplyQueueDrainStartedAt = 0

const AUTO_REPLY_QUEUE_STALE_PROMISE_MS = Number.parseInt(
  process.env.WHATSAPP_AUTO_REPLY_QUEUE_STALE_PROMISE_MS || '30000',
  10,
)

const kickAutoReplyQueueDrain = () => {
  autoReplyQueueDrainPromise = null
  autoReplyQueueDrainStartedAt = 0
  void drainAutoReplyQueue()
}

const enqueueAutoReply = async (job) => {
  await ensureDatabaseReady()

  const payload = {
    contactId: Number.isInteger(job?.contactId) ? job.contactId : null,
    sender: normalizePhoneNumber(job?.sender),
    messageBody: normalizeReference(job?.messageBody),
    inboundMessageId: Number.isInteger(job?.inboundMessageId) ? job.inboundMessageId : null,
    providerMessageId: normalizeReference(job?.providerMessageId) || null,
    mediaDescriptor:
      job?.mediaDescriptor && typeof job.mediaDescriptor === 'object'
        ? {
            mediaId: normalizeReference(job.mediaDescriptor.mediaId),
            kind: normalizeReference(job.mediaDescriptor.kind),
            mimeType: normalizeReference(job.mediaDescriptor.mimeType),
            caption: normalizeReference(job.mediaDescriptor.caption),
          }
        : null,
  }

  const queueInsertResult = await pool.query(
    `
      insert into whatsapp_auto_reply_queue (
        contact_id,
        sender,
        message_body,
        inbound_message_id,
        provider_message_id,
        media_descriptor,
        status
      )
      values ($1, $2, $3, $4, $5, $6::jsonb, 'pending')
      returning id;
    `,
    [
      payload.contactId,
      payload.sender,
      payload.messageBody,
      payload.inboundMessageId,
      payload.providerMessageId,
      JSON.stringify(payload.mediaDescriptor ?? {}),
    ],
  )
  const queueId = Number(queueInsertResult?.rows?.[0]?.id ?? null)

  kickAutoReplyQueueDrain()

  return payload
}

const drainAutoReplyQueue = async () => {
  if (autoReplyQueueDrainPromise) {
    if (Date.now() - autoReplyQueueDrainStartedAt <= AUTO_REPLY_QUEUE_STALE_PROMISE_MS) {
      return autoReplyQueueDrainPromise
    }

    autoReplyQueueDrainPromise = null
    autoReplyQueueDrainStartedAt = 0
  }

  autoReplyQueueDrainStartedAt = Date.now()
  autoReplyQueueDrainPromise = (async () => {
    await ensureDatabaseReady()
    const client = await pool.connect()

    try {
      const lockResult = await client.query('select pg_try_advisory_lock($1::bigint) as locked;', [AUTO_REPLY_QUEUE_LOCK_KEY])
      if (!lockResult.rows[0]?.locked) {
        return
      }

      try {
        while (true) {
          const claimResult = await client.query(
            `
              with next_job as (
                select id, contact_id, sender, message_body, inbound_message_id, provider_message_id, media_descriptor
                from whatsapp_auto_reply_queue
                where status = 'pending'
                order by id asc
                for update skip locked
                limit 1
              )
              update whatsapp_auto_reply_queue queue
              set status = 'processing',
                  started_at = now(),
                  attempt_count = attempt_count + 1,
                  error_message = null
              from next_job
              where queue.id = next_job.id
              returning
                queue.id,
                queue.contact_id,
                queue.sender,
                queue.message_body,
                queue.inbound_message_id,
                queue.provider_message_id,
                queue.media_descriptor;
            `,
          )

          const queuedJob = claimResult.rows[0]
          if (!queuedJob) {
            break
          }

          try {
            const result = await autoReplyInboundWhatsAppMessage({
              contactId: queuedJob.contact_id,
              sender: queuedJob.sender,
              messageBody: queuedJob.message_body,
              inboundMessageId: queuedJob.inbound_message_id,
              mediaDescriptor: queuedJob.media_descriptor ?? null,
            })

            await client.query(
              `
                update whatsapp_auto_reply_queue
                set status = $1,
                    finished_at = now(),
                    error_message = null
                where id = $2;
              `,
              [result ? 'completed' : 'skipped', queuedJob.id],
            )
          } catch (error) {
            await client.query(
              `
                update whatsapp_auto_reply_queue
                set status = case when attempt_count < 3 then 'pending' else 'failed' end,
                    finished_at = now(),
                    error_message = $1
                where id = $2;
              `,
              [error.message, queuedJob.id],
            )
          }
        }
      } finally {
        await client.query('select pg_advisory_unlock($1::bigint);', [AUTO_REPLY_QUEUE_LOCK_KEY]).catch(() => {})
      }
    } finally {
      client.release()
    }
  })().catch((error) => {
    console.error('Fallo la cola persistente de respuestas IA:', error.message)
  }).finally(() => {
    autoReplyQueueDrainPromise = null
    autoReplyQueueDrainStartedAt = 0
  })

  return autoReplyQueueDrainPromise
}

const persistInboundWhatsAppWebhook = async (payload) => {
  const entries = Array.isArray(payload?.entry) ? payload.entry : []

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

        let inboundContact = null
        try {
          inboundContact =
            (await findContactByWhatsAppReference(from)) ?? (await ensureInboundWhatsAppContact(from))
        } catch (error) {
          console.error('No se pudo resolver el contacto entrante de WhatsApp:', error.message)
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
            inboundContact?.id ?? null,
            normalizePhoneNumber(from),
            messageBody,
            providerMessageId,
            null,
            null,
            null,
            null,
          ],
        )

        void enqueueAutoReply({
          contactId: inboundContact?.id ?? null,
          sender: from,
          messageBody,
          inboundMessageId: inboundLogResult.rows[0]?.id ?? null,
          providerMessageId,
          mediaDescriptor,
        }).catch((error) => {
          console.error('No se pudo encolar la respuesta automatica:', error.message)
        })

        await writeSystemLog({
          event: 'whatsapp_inbound_message_saved',
          statusCode: 200,
          details: {
            contactId: null,
            sender: normalizePhoneNumber(from),
            inboundMessageId: inboundLogResult.rows[0]?.id ?? null,
            providerMessageId,
            preview: normalizeReference(messageBody).slice(0, 80),
          },
        }).catch(() => {})
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


const dependencies = {
  pool,
  sessions,
  authMiddleware,
  writeSystemLog,
  hashPassword,
  createSession,
  sanitizeUser,
  sanitizeManagedUser,
  fetchJsonWithTimeout,
  getCachedValue,
  setCachedValue,
  getNormalizedTimeoutMs,
  ensureDatabaseReady,
  reloadLocalEnv,
  getTrackingApiDefaults,
  fetchAllTrackingPackagesCatalog,
  buildTrackingCatalogFallbackPayload,
  getCachedTrackingPackagesCatalog,
  getContactPackagesApiDefaults,
  fetchAllContactPackagesCatalog,
  getCachedContactPackagesCatalog,
  normalizeReference,
  buildEmsPipelineCards,
  pipelineStageKeys,
  getEmsPipelineMonthKey,
  getPackagePipelineSyncSnapshot,
  ensurePackagePipelineSync,
  extractPackageCode,
  normalizePackageCodeForLookup,
  fetchExactPackageCodeMatches,
  getPackageCodeValuesForLookup,
  findPackageCodeInPaginatedApi,
  normalizeEmsStageOverrideValue,
  getStoredEmsStageOverrides,
  saveEmsStageOverride,
  maybeStartTestModeConversation,
  getStoredWhatsAppConfig,
  getContactGroups,
  getStoredProntsConfig,
  getStoredPipelineConfig,
  defaultProntsConfig,
  defaultPipelineConfig,
  formatRelativeDate,
  formatCurrency,
  sanitizeWhatsAppConfig,
  buildPackagePipelineSyncFallback,
  normalizeGroupColor,
  defaultIntegrations,
  siteBlocks
};

registerTrackingRoutes(app, dependencies);
registerInternacionalesRoutes(app, dependencies);
registerEmsRoutes(app, dependencies);
registerPackage-code-lookupRoutes(app, dependencies);
registerHealthRoutes(app, dependencies);
registerLogsRoutes(app, dependencies);
registerAuthRoutes(app, dependencies);
registerUsersRoutes(app, dependencies);
registerDashboardRoutes(app, dependencies);
registerPipelineRoutes(app, dependencies);
registerContact-groupsRoutes(app, dependencies);
registerPronts-configRoutes(app, dependencies);
registerPipeline-configRoutes(app, dependencies);
registerIntegrationsRoutes(app, dependencies);
registerMessagesRoutes(app, dependencies);
registerAiRoutes(app, dependencies);
registerContactsRoutes(app, dependencies);

app.listen(port, () => {
  const frontendMessage = existsSync(clientIndexPath)
    ? ` y frontend en http://localhost:${port}`
    : ''
  console.log(`CRM API disponible en http://localhost:${port}${frontendMessage}`)
  startWhatsAppStageWatcher()
  kickAutoReplyQueueDrain()
  setInterval(() => {
    kickAutoReplyQueueDrain()
  }, 15000).unref?.()
})
