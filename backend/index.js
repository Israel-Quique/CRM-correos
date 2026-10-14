import crypto from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { appendFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import cors from 'cors'
import dotenv from 'dotenv'
import express from 'express'
import multer from 'multer'
import { parsePhoneNumberFromString } from 'libphonenumber-js'
import pg from 'pg'
import {
  calculateEmsTariff,
  buildEmsWeightSpecificationsPrompt,
  extractEmsPackageDimensions,
  extractEmsWeightKg as extractTariffWeightKg,
  getEmsCalculatorEndpoint,
  getEmsInternationalZone,
  inferEmsCalculatorCategory,
  inferEmsCategoryFromPendingPrompt,
  inferEmsCalculatorDestinationCode,
  inferEmsInternationalDestination,
  inferEmsQuoteCategory,
  getAcceptedEmsAlternativeDestination,
  getNearestConfiguredEmsDestination,
  isEmsAlternativeDestinationAcceptance,
  isFreshEmsRouteQuoteRequest,
  isEmsInternationalShipmentRequest,
  isUnsupportedEmsInternationalShipmentRequest,
  isEmsWeightReply,
  isEmsWeightReplyMissingUnit,
  shouldForceEmsForWeightLimit,
} from './services/ems-calculator.js'
import {
  isDeliveryExpressDimensionQuestion,
  resolveTariffServiceKey,
} from './services/whatsapp-tariff-routing.js'
import {
  buildCustomsTrackingReply,
  buildNationalDistributionTrackingReply,
  buildPackageDeclarationReply,
  isPackageDeclarationQuestion,
  isPackageTrackingRequest,
  selectLatestPackageEntry,
} from './services/whatsapp-intent.js'
import {
  buildInternationalArrivalMessage,
  buildPackageCancellationMessage,
  buildPackageEventSignature,
  buildPackageReturnToOriginMessage,
  getPackageAutomationNextDelayMs,
  getWhatsAppTrackingRetrySchedule,
  getNewPackageWelcomePhoneCandidates,
  getNationalPackageEventStage,
  getTrackingPackageRecipientPhoneCandidates,
  hasInternationalArrivalEvent,
  isInternationalArrivalEvent,
  isEligibleNewPackageWelcomeEntry,
  isPackageEventNotificationEligible,
  isPackageEventForNotificationType,
  isPackageReturnToOriginEvent,
  isPackagePageOutsideRecentWindow,
  migrateWelcomeIntervalSetting,
  parsePackageTimestamp,
  resolveAutomationBooleanSetting,
  resolveContactPackageStage,
  runAndReschedule,
  selectPackageNotificationRecipients,
  WHATSAPP_TRACKING_RETRY_INTERVAL_MS,
  WHATSAPP_TRACKING_RETRY_POLL_INTERVAL_MS,
} from './services/whatsapp-package-automation.js'

const { Pool } = pg
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
dotenv.config({ path: path.join(__dirname, '..', '.env'), quiet: true })
const app = express()
const port = Number(process.env.PORT || 3001)
const connectionString = process.env.DATABASE_URL
const mediaStorageDir = path.join(__dirname, 'media')
const logsStorageDir = path.join(__dirname, 'logs')
const knowledgeDir = path.join(__dirname, 'knowledge')
const ipsImportDir = path.join(__dirname, 'imports')
const clientDistDir = path.join(__dirname, '..', 'frontend', 'dist')
const clientIndexPath = path.join(clientDistDir, 'index.html')
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 16 * 1024 * 1024,
  },
})
const ipsImportUpload = multer({
  storage: multer.diskStorage({
    destination: (_request, _file, callback) => {
      mkdir(ipsImportDir, { recursive: true })
        .then(() => callback(null, ipsImportDir))
        .catch((error) => callback(error, ipsImportDir))
    },
    filename: (_request, file, callback) => {
      const extension = path.extname(file.originalname).toLowerCase()
      callback(null, `ips-${Date.now()}-${crypto.randomBytes(6).toString('hex')}${extension}`)
    },
  }),
  limits: { fileSize: 512 * 1024 * 1024 },
  fileFilter: (_request, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase()
    callback(extension === '.json' || extension === '.ndjson' ? null : new Error('Solo se admite JSON o NDJSON.'), true)
  },
})

let ipsImportStatus = {
  state: 'idle',
  filename: '',
  total: 0,
  message: '',
  startedAt: null,
  completedAt: null,
}

const readKnowledgeJson = (filename, fallback = {}) => {
  try {
    const filePath = path.join(knowledgeDir, filename)
    if (!existsSync(filePath)) return fallback
    return {
      ...fallback,
      ...JSON.parse(readFileSync(filePath, 'utf8')),
    }
  } catch (error) {
    console.warn(`No se pudo cargar knowledge/${filename}:`, error?.message ?? error)
    return fallback
  }
}

const botKnowledge = {
  deliveryExpress: readKnowledgeJson('delivery-express.json', {
    serviceKey: 'delivery_express',
    name: 'Delivery Express',
    limits: { maxWeightKg: 5 },
    coverage: { provinceKeywords: ['provincia', 'comunidad', 'municipio'] },
    modes: {
      puerta_a_puerta: { label: 'puerta a puerta' },
      puerta_a_ventanilla: { label: 'puerta a ventanilla' },
      ventanilla_a_ventanilla: { label: 'ventanilla a ventanilla' },
    },
  }),
  ems: readKnowledgeJson('ems.json', {
    serviceKey: 'ems',
    name: 'EMS Nacional e Internacional',
  }),
  tracking: readKnowledgeJson('tracking.json', {}),
  responses: readKnowledgeJson('agent-responses.json', {}),
}

const defaultCorsOrigins = ['http://localhost:5173', process.env.VITE_API_URL || 'http://localhost:3001']
const allowedCorsOrigins = (process.env.CORS_ORIGIN || defaultCorsOrigins.join(','))
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)
const allowedFrontendPorts = (process.env.CORS_FRONTEND_PORTS || '5173,5174')
  .split(',')
  .map((port) => port.trim())
  .filter(Boolean)
const isAllowedCorsOrigin = (origin) => {
  if (!origin || allowedCorsOrigins.includes(origin)) {
    return true
  }

  try {
    const { protocol, port } = new URL(origin)
    return ['http:', 'https:'].includes(protocol) && allowedFrontendPorts.includes(port)
  } catch {
    return false
  }
}

// These parsers must run before any route so JSON request bodies are available.
app.use(
  cors({
    origin(origin, callback) {
      if (isAllowedCorsOrigin(origin)) {
        callback(null, true)
        return
      }

      callback(new Error('Origen no permitido por CORS.'))
    },
  }),
)
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '1mb' }))

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
      'Eres un agente aduanero senior e IA oficial de logÃ­stica internacional EMS Conversa OS. Tu misiÃ³n es auditar declaraciones juradas CN22/CN23, verificar valores declarados, detectar posibles retenciones aduaneras por monto superior a $150 USD y validar que el destinatario tenga telÃ©fono completo.',
    userTemplate:
      'Audita el siguiente paquete ingresado:\n- Cliente: {cliente}\n- Tracking: {tracking}\n- Destino: {destino}\n- Peso: {peso}\n- Valor declarado: {valor}\n- Estado: {estado}\n- Grupo: {grupoNombre}',
    temperature: 0.2,
    action: 'Asignar Etiqueta IA y Notificar WhatsApp',
    sampleContactId: null,
    response:
      '// Presiona "Ejecutar SimulaciÃ³n de Prompt" para probar el comportamiento de esta columna en tiempo real.',
  },
  regional: {
    presetKey: 'regional',
    systemPrompt:
      'Eres un coordinador logÃ­stico EMS en regional. Confirmas que el paquete ya fue recibido en la regional, explicas el estado actual sin inventar tiempos y preparas al cliente para el siguiente movimiento operativo.',
    userTemplate:
      'Genera una actualizaciÃ³n para el paquete recibido en regional:\n- Cliente: {cliente}\n- Tracking: {tracking}\n- Destino: {destino}\n- Peso: {peso}\n- Valor declarado: {valor}\n- Estado: {estado}\n- Grupo: {grupoNombre}',
    temperature: 0.3,
    action: 'Asignar Etiqueta IA y Notificar WhatsApp',
    sampleContactId: null,
    response:
      '// Presiona "Ejecutar SimulaciÃ³n de Prompt" para probar el comportamiento de esta columna en tiempo real.',
  },
  transit: {
    presetKey: 'transit',
    systemPrompt:
      'Eres un asistente inteligente de seguimiento aÃ©reo internacional. Analizas rutas de despacho, congestiones en aeropuertos hub y notificas estimaciones de llegada ETA al cliente.',
    userTemplate:
      'Calcula la predicciÃ³n de trÃ¡nsito para el paquete en trÃ¡nsito:\n- GuÃ­a EMS: {tracking}\n- Destinatario: {cliente}\n- Destino Final: {destino}\n- Grupo: {grupoNombre}',
    temperature: 0.4,
    action: 'Asignar Etiqueta IA y Notificar WhatsApp',
    sampleContactId: null,
    response:
      '// Presiona "Ejecutar SimulaciÃ³n de Prompt" para probar el comportamiento de esta columna en tiempo real.',
  },
  courier: {
    presetKey: 'courier',
    systemPrompt:
      'Eres un coordinador de reparto EMS. Comunicas que el paquete fue asignado al cartero y acompaÃ±as al cliente hasta la entrega, sin prometer horarios exactos.',
    userTemplate:
      'Genera una actualizaciÃ³n para un paquete asignado a cartero:\n- Cliente: {cliente}\n- Tracking: {tracking}\n- Destino: {destino}\n- Estado: {estado}\n- Grupo: {grupoNombre}',
    temperature: 0.3,
    action: 'Notificar salida a reparto y preparar confirmaciÃ³n',
    sampleContactId: null,
    response:
      '// Presiona "Ejecutar SimulaciÃ³n de Prompt" para probar el comportamiento de esta columna en tiempo real.',
  },
  delivered: {
    presetKey: 'delivered',
    systemPrompt:
      'Eres el encargado de calidad y satisfacciÃ³n al cliente de Conversa OS. Verificas acuses de recibo digital, solicitas valoraciÃ³n de 1 a 5 estrellas y registras la entrega con Ã©xito.',
    userTemplate:
      'Procesa la confirmaciÃ³n de entrega para:\n- Cliente: {cliente}\n- GuÃ­a EMS: {tracking}\n- Destino: {destino}\n- Valor: {valor}\n- Estado: {estado}\n\nGenera un mensaje de cierre amable para WhatsApp.',
    temperature: 0.5,
    action: 'Mover AutomÃ¡ticamente a Siguiente Estado',
    sampleContactId: null,
    response:
      '// Presiona "Ejecutar SimulaciÃ³n de Prompt" para probar el comportamiento de esta columna en tiempo real.',
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
      helper: 'Ingresados o en recepciÃ³n inicial',
    },
    transit: {
      title: 'En Camino',
      helper: 'En trÃ¡nsito hacia el destino final',
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
  phoneNumberId: process.env.WHATSAPP_META_PHONE_NUMBER_ID?.trim() ?? '',
  businessAccountId: process.env.WHATSAPP_META_BUSINESS_ACCOUNT_ID?.trim() ?? '',
  apiVersion: process.env.WHATSAPP_META_API_VERSION?.trim() ?? 'v23.0',
  senderNumber: process.env.WHATSAPP_META_SENDER_NUMBER?.trim() ?? '',
  testModeEnabled:
    process.env.WHATSAPP_TEST_MODE == null ? false : process.env.WHATSAPP_TEST_MODE === 'true',
  testModeNumber: process.env.WHATSAPP_TEST_MODE_NUMBER?.trim() ?? '+59164229403',
  webhookVerifyToken:
    process.env.WHATSAPP_META_WEBHOOK_VERIFY_TOKEN?.trim() ?? '',
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
  generalTimeoutMs: Number.parseInt(process.env.AI_GENERAL_TIMEOUT_MS || '120000', 10),
  trackingTimeoutMs: Number.parseInt(process.env.AI_TRACKING_TIMEOUT_MS || '90000', 10),
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
  fallbackBaseUrl: process.env.TRACKING_API_FALLBACK_URL?.trim() ?? 'http://172.65.10.55:8103',
  token:
    process.env.TRACKING_SQLSERVER_TOKEN?.trim() ??
    process.env.TRACKING_API_TOKEN?.trim() ??
    '',
})

const getCdsApiDefaults = () => ({
  baseUrl: process.env.CDS_API_URL?.trim() ?? getTrackingApiDefaults().baseUrl,
  token: process.env.CDS_API_TOKEN?.trim() ?? '',
})

let cdsApiLastRequestAt = 0
let cdsApiRequestQueue = Promise.resolve()

const waitForCdsApiRateLimit = async () => {
  const previousRequest = cdsApiRequestQueue
  let unlockQueue = () => {}
  cdsApiRequestQueue = new Promise((resolve) => {
    unlockQueue = resolve
  })
  await previousRequest

  try {
    const waitMs = Math.max(0, 2200 - (Date.now() - cdsApiLastRequestAt))
    if (waitMs > 0) await sleep(waitMs)
    cdsApiLastRequestAt = Date.now()
  } finally {
    unlockQueue()
  }
}

const cloneJson = (value) => JSON.parse(JSON.stringify(value))

const markCdsDeclarationUnavailable = (item) => {
  if (!Object.prototype.hasOwnProperty.call(item ?? {}, 'declaracion_cds')) {
    item.declaracion_cds = {
      estado: 'consulta_incompleta',
      truncado: false,
      objetos: [],
      destinos_declarados: [],
    }
    item.destinos_declarados = []
  }
}

const enrichTrackingPackagesWithCds = async (items = []) => {
  if (!Array.isArray(items) || items.length === 0) return null

  const codeEntries = items
    .map((item) => ({
      item,
      code: normalizePackageCodeForLookup(getPackageCodeFromItem(item)),
    }))
    .filter((entry) => entry.code)
  if (codeEntries.length === 0) return null

  const cdsApiDefaults = getCdsApiDefaults()
  if (!cdsApiDefaults.token) {
    codeEntries.forEach(({ item }) => markCdsDeclarationUnavailable(item))
    return 'No se pudo consultar CDS: falta configurar el token independiente CDS_API_TOKEN.'
  }

  const codes = [...new Set(codeEntries.map((entry) => entry.code))]
  const cdsUrl = new URL('/api/tracking/cds/declaraciones', cdsApiDefaults.baseUrl)
  const recordsByCode = new Map()
  let warning = null

  for (let offset = 0; offset < codes.length; offset += 100) {
    const batch = codes.slice(offset, offset + 100)
    try {
      await waitForCdsApiRateLimit()
      const response = await fetchJsonWithTimeout(cdsUrl, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + cdsApiDefaults.token,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ codes: batch }),
      }, 30000)
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(`La API CDS respondió HTTP ${response.status}.`)
      }

      const records = Array.isArray(payload?.data) ? payload.data : []
      for (const record of records) {
        const code = normalizePackageCodeForLookup(record?.codigo)
        if (code) recordsByCode.set(code, record)
      }
      if (records.length !== batch.length) {
        warning = 'La API CDS no devolvió el resultado de todos los paquetes consultados.'
      }
    } catch (error) {
      warning = error instanceof Error ? error.message : 'No se pudo consultar la API CDS.'
      batch.forEach((code) => {
        const record = codeEntries.find((entry) => entry.code === code)
        if (record) markCdsDeclarationUnavailable(record.item)
      })
    }
  }

  for (const { item, code } of codeEntries) {
    const cdsRecord = recordsByCode.get(code)
    if (cdsRecord?.declaracion_cds) {
      item.declaracion_cds = cdsRecord.declaracion_cds
      item.destinos_declarados = Array.isArray(cdsRecord.destinos_declarados)
        ? cdsRecord.destinos_declarados
        : cdsRecord.declaracion_cds.destinos_declarados ?? []
    } else {
      markCdsDeclarationUnavailable(item)
      warning ??= 'La API CDS no devolvió declaración para uno o más paquetes.'
    }
  }

  return warning
}

const getContactPackagesApiDefaults = () => ({
  endpoint:
    process.env.PAQUETES_CONTACTOS_API_URL?.trim() ??
    'https://dev.correos.gob.bo:18100/api/paquetes-contactos',
  token:
    process.env.PAQUETES_CONTACTOS_API_TOKEN?.trim() ??
    process.env.TRACKING_SQLSERVER_TOKEN?.trim() ??
    process.env.TRACKING_API_TOKEN?.trim() ??
    '',
})

const getStoredContactPackageCode = (row) => {
  const profiles = Array.isArray(row?.social_profiles) ? row.social_profiles : []
  const emsProfile = profiles.find((profile) => normalizeReference(profile?.channel).toLowerCase() === 'ems')
  return normalizeReference(emsProfile?.reference)
}

const mapStoredContactToContactPackage = (row) => {
  const code = getStoredContactPackageCode(row)
  const destination = normalizeReference(row?.company).replace(/^Paquetes-Contactos API\s*Â·\s*/i, '')
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
  const destination = normalizeReference(row?.company).replace(/^Tracking API\s*Â·\s*/i, '')
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

  const [trackingItemsResult, trackingStatsResult] = await Promise.all([
    pool.query(
      `
        select payload
        from international_tracking_packages
        order by updated_at desc, package_code
        limit $1 offset $2;
      `,
      [safePerPage, offset],
    ),
    pool.query(`
      select count(*)::integer as total, max(updated_at) as cached_at
      from international_tracking_packages;
    `),
  ])
  const trackingTotal = Number(trackingStatsResult.rows[0]?.total ?? 0)
  if (trackingTotal > 0) {
    const totalPages = Math.max(1, Math.ceil(trackingTotal / safePerPage))
    return {
      data: trackingItemsResult.rows.map((row) => row.payload),
      paginacion: {
        total_registros: trackingTotal,
        pagina_actual: safePage,
        por_pagina: safePerPage,
        ultima_pagina: totalPages,
        desde: offset + 1,
        hasta: Math.min(offset + safePerPage, trackingTotal),
      },
      source: 'local-db',
      cachedAt: trackingStatsResult.rows[0]?.cached_at ?? null,
    }
  }

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
  const latestContactUpdate = itemsResult.rows.reduce((latest, row) => {
    const updatedAt = row?.updated_at ? new Date(row.updated_at).getTime() : 0
    return updatedAt > latest ? updatedAt : latest
  }, 0)

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
    cachedAt: latestContactUpdate ? new Date(latestContactUpdate).toISOString() : null,
  }
}

const fetchStoredTrackingPackagesCatalog = async () => {
  await ensureDatabaseReady()
  const result = await pool.query(
    `
      select payload, max(updated_at) over () as cached_at
      from international_tracking_packages
      order by updated_at desc, package_code;
    `,
  )
  if (result.rows.length > 0) {
    return {
      data: result.rows.map((row) => row.payload),
      total: result.rows.length,
      cachedAt: result.rows[0]?.cached_at ?? null,
      source: 'local-db',
    }
  }

  const fallback = await fetchStoredTrackingPackagesPage({ page: 1, perPage: 200 })
  return {
    data: fallback.data,
    total: fallback.paginacion.total_registros,
    cachedAt: fallback.cachedAt,
    source: fallback.source,
  }
}

const fetchStoredInternationalTrackingPackageByCode = async (packageCode) => {
  const normalizedCode = normalizeReference(packageCode).toUpperCase()
  if (!normalizedCode) return null

  await ensureDatabaseReady()
  const result = await pool.query(
    `
      select payload
      from international_tracking_packages
      where upper(package_code) = $1
      order by updated_at desc
      limit 1;
    `,
    [normalizedCode],
  )

  return result.rows[0]?.payload ?? null
}

const fetchExactTrackingPackageMatch = async ({ url, headers, code }) => {
  let successfulLookup = false
  let lastErrorStatus = null
  let successfulUrl = null
  const lookupUrls = [new URL(url.toString())]
  const fallbackUrl = new URL('/api/tracking/paquetes', getTrackingApiDefaults().fallbackBaseUrl)
  if (!lookupUrls.some((candidate) => candidate.origin === fallbackUrl.origin && candidate.pathname === fallbackUrl.pathname)) {
    lookupUrls.push(fallbackUrl)
  }

  for (const lookupUrl of lookupUrls) {
    for (const queryParam of ['query', 'q', 'codigo_s10']) {
      const result = await fetchExactPackageCodeMatches({
        url: lookupUrl,
        headers,
        queryParam,
        code,
        timeoutMs: 8000,
      })
      if (!result.ok) {
        lastErrorStatus = result.statusCode
        if ([401, 403, 404].includes(result.statusCode)) break
        continue
      }

      successfulLookup = true
      successfulUrl = lookupUrl.toString()
      const exactMatch = result.items.find((item) => getPackageCodeValuesForLookup(item).includes(code))
      if (exactMatch) {
        return {
          item: exactMatch,
          unavailable: false,
          statusCode: result.statusCode,
          url: successfulUrl,
        }
      }
    }
  }

  return {
    item: null,
    unavailable: !successfulLookup,
    statusCode: lastErrorStatus,
    url: successfulUrl ?? lookupUrls.at(-1)?.toString() ?? url.toString(),
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
    process.env.PAQUETES_CONTACTOS_API_TOKEN?.trim() ??
    process.env.TRACKING_SQLSERVER_TOKEN?.trim() ??
    process.env.TRACKING_API_TOKEN?.trim() ??
    '',
})

const hasDedicatedPackageEventsApiConfig = () =>
  Boolean(
    process.env.PAQUETES_EVENTOS_API_URL?.trim() &&
      process.env.PAQUETES_EVENTOS_API_TOKEN?.trim(),
  )

const reloadLocalEnv = () => {
  try {
    dotenv.config({
      path: path.join(__dirname, '..', '.env'),
      override: true,
      quiet: true,
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
let packageEventsRateLimitedUntil = 0
let lastNewPackageWelcomeCheckAt = 0
let lastRecentPackageEventCheckAt = 0
let lastPackageEventChangeSyncAt = 0
let lastPackageReconciliationCheckAt = Date.now()
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

const hashPassword = (password) => {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex')
  return `scrypt$${salt}$${hash}`
}

const hashLegacyPassword = (password) =>
  crypto.scryptSync(String(password), 'crm-integrador-salt', 64).toString('hex')

const verifyPassword = (password, storedHash) => {
  const hashValue = normalizeReference(storedHash)
  const [, salt, hash] = hashValue.split('$')

  if (hashValue.startsWith('scrypt$') && salt && hash) {
    const candidate = crypto.scryptSync(String(password), salt, 64)
    const expected = Buffer.from(hash, 'hex')
    return expected.length === candidate.length && crypto.timingSafeEqual(expected, candidate)
  }

  return hashValue === hashLegacyPassword(password)
}

const sessionSecret = process.env.SESSION_SECRET || process.env.DATABASE_URL || 'crm-integrador-session-secret'
const sessionMaxAgeMs = Number(process.env.SESSION_MAX_AGE_MS || 24 * 60 * 60 * 1000)

const encodeSessionPart = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')

const signSessionPayload = (payload) =>
  crypto
    .createHmac('sha256', sessionSecret)
    .update(payload)
    .digest('base64url')

const createSignedSessionToken = (session) => {
  const payload = encodeSessionPart({
    ...session,
    expiresAt: new Date(Date.now() + sessionMaxAgeMs).toISOString(),
  })
  return `${payload}.${signSessionPayload(payload)}`
}

const readSignedSessionToken = (token) => {
  const [payload, signature] = String(token ?? '').split('.')
  if (!payload || !signature) return null

  const expectedSignature = signSessionPayload(payload)
  const signatureBuffer = Buffer.from(signature)
  const expectedBuffer = Buffer.from(expectedSignature)

  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    return null
  }

  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    const expiresAt = new Date(session.expiresAt).getTime()

    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      return null
    }

    return session
  } catch {
    return null
  }
}

const createSession = (user) => {
  const session = {
    id: user.id,
    fullName: user.full_name,
    email: user.email,
    role: user.role_name,
    createdAt: new Date().toISOString(),
  }
  const token = createSignedSessionToken(session)
  sessions.set(token, session)
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
  const session = token ? sessions.get(token) ?? readSignedSessionToken(token) : null

  if (!token || !session) {
    response.status(401).json({ message: 'Sesion no valida. Inicia sesion nuevamente.' })
    return
  }

  sessions.set(token, session)
  request.session = session
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
        const fallbackPayload = await fetchStoredTrackingPackagesCatalog()
        payload = {
          data: fallbackPayload.data,
          total: fallbackPayload.total,
          cachedAt: fallbackPayload.cachedAt,
          source: fallbackPayload.source,
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

    const includeDeclaration = searchParams.get('include_declaration') !== '0'
    searchParams.delete('include_declaration')

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

    if (!upstreamResponse.ok) {
      const fallbackPayload = await fetchStoredTrackingPackagesPage({
        page: request.query.page,
        perPage: request.query.per_page,
      })

      response.json({
        ...fallbackPayload,
        warning:
          upstreamResponse.status === 429
            ? 'La API externa de tracking limito las consultas; se muestran datos locales sincronizados.'
            : 'No se pudo consultar la API externa de tracking; se muestran datos locales sincronizados.',
        upstreamStatus: upstreamResponse.status,
        upstreamError:
          payload?.message ||
          payload?.error ||
          `La API externa respondio con estado ${upstreamResponse.status}.`,
      })
      return
    }

    const payloadItems = getPaginatedPayloadItems(payload)
    const declarationWarning = includeDeclaration
      ? await enrichTrackingPackagesWithCds(payloadItems)
      : null
    const requestedPage = Math.max(1, Number.parseInt(String(request.query.page), 10) || 1)
    const requestedPerPage = Math.max(1, Number.parseInt(String(request.query.per_page), 10) || 100)
    const effectivePerPage = Math.max(
      1,
      Number.parseInt(String(payload?.meta?.per_page ?? payload?.per_page ?? requestedPerPage), 10) || requestedPerPage,
    )

    response.status(upstreamResponse.status).json({
      ...payload,
      ...(declarationWarning
        ? {
            warning: declarationWarning,
            declarationWarning,
          }
        : {}),
      pagination: {
        ...(payload?.pagination && typeof payload.pagination === 'object' ? payload.pagination : {}),
        page: Number(payload?.meta?.page ?? requestedPage),
        per_page: effectivePerPage,
        has_more: payloadItems.length >= effectivePerPage,
      },
      source: 'tracking-api',
    })
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

app.get('/api/tracking/paquetes/:packageCode/eventos', cors(), authMiddleware, async (request, response) => {
  const packageCode = normalizePackageCodeForLookup(request.params.packageCode)
  if (!packageCode) {
    response.status(400).json({ message: 'El codigo de seguimiento no es valido.' })
    return
  }

  try {
    const result = await fetchPackageEventsForCode(packageCode)
    const data = Array.isArray(result?.data) ? result.data : []
    const source = result?.source || (result?.statusCode >= 200 && result?.statusCode < 300 ? 'tracking-api' : '')

    if (data.length === 0 && result?.error) {
      response.status(502).json({
        message: 'No se pudieron cargar los movimientos del paquete.',
        warning: result.error,
      })
      return
    }

    response.json({
      data,
      total: data.length,
      code: packageCode,
      source: source || 'tracking-api',
      warning: result?.error || null,
    })
  } catch (error) {
    response.status(502).json({
      message: 'No se pudieron cargar los movimientos del paquete.',
      error: error instanceof Error ? error.message : 'Error desconocido.',
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

    const upstreamResponse = await fetchJsonWithTimeout(
      upstreamUrl,
      {
        headers: {
          Authorization: `Bearer ${contactPackagesApiDefaults.token}`,
          Accept: 'application/json',
        },
      },
      Number.parseInt(process.env.CONTACT_PACKAGES_PAGE_TIMEOUT_MS || '8000', 10),
    )

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
const getSafeDeclaredDepartment = (value) => {
  const department = normalizeReference(value)
  if (!department) return ''

  const containsPhoneLabel = /\b(?:tel(?:[ée]fono)?|cel(?:ular)?|m[oó]vil|whatsapp|phone)\b/i.test(department)
  const digitCount = department.replace(/\D/g, '').length
  return containsPhoneLabel || digitCount >= 7 ? '' : department
}
const getCdsDeclarationField = (fields, fieldName) => {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return ''
  const entry = Object.entries(fields).find(([key]) => key.trim().toLowerCase() === fieldName.toLowerCase())
  return normalizeReference(entry?.[1])
}
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
    maxPages: 2000,
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

const fetchRecentContactPackagesCatalog = async ({ lookbackMs } = {}) => {
  reloadLocalEnv()
  const contactPackagesApiDefaults = getContactPackagesApiDefaults()
  const timeoutMs = Number.parseInt(process.env.CONTACT_PACKAGES_PAGE_TIMEOUT_MS || '8000', 10)
  const maxPages = Math.max(
    1,
    Number.parseInt(process.env.PACKAGE_NEW_PACKAGE_WELCOME_MAX_PAGES || '5', 10) || 5,
  )
  const welcomeRecentWindowMs = Number.isFinite(WHATSAPP_NEW_PACKAGE_WELCOME_RECENT_MS)
    ? Math.max(WHATSAPP_NEW_PACKAGE_WELCOME_RECENT_MS, 60 * 1000)
    : 24 * 60 * 60 * 1000
  const effectiveLookbackMs = Number.isFinite(lookbackMs)
    ? Math.max(lookbackMs, welcomeRecentWindowMs)
    : Math.max(PACKAGE_NEW_PACKAGE_WELCOME_LOOKBACK_MS, welcomeRecentWindowMs)
  const cutoffMs = Date.now() - Math.max(effectiveLookbackMs, 60 * 1000)
  const upstreamUrl = new URL(contactPackagesApiDefaults.endpoint)
  upstreamUrl.searchParams.set('ordering', '-fecha_registro')

  const items = await fetchAllPaginatedItems({
    url: upstreamUrl,
    headers: {
      Authorization: `Bearer ${contactPackagesApiDefaults.token}`,
      Accept: 'application/json',
    },
    perPage: 100,
    maxPages,
    timeoutMs,
    throwOnFirstPageError: true,
    stopWhen: (pageItems) => isPackagePageOutsideRecentWindow(
      pageItems,
      cutoffMs,
      (item) => getPackageContextDateValue(item?.fecha_registro || item?.created_at || item?.fechaCreacion),
    ),
  })

  return items.filter((item) => {
    const itemTime = getPackageContextDateValue(item?.fecha_registro || item?.created_at || item?.fechaCreacion)
    return Number.isFinite(itemTime) && itemTime > 0 && itemTime >= cutoffMs
  })
}

const fetchRecentTrackingPackagesCatalog = async () => {
  reloadLocalEnv()
  const trackingApiDefaults = getTrackingApiDefaults()
  const timeoutMs = Number.parseInt(process.env.TRACKING_PACKAGES_PAGE_TIMEOUT_MS || '8000', 10)
  const maxPages = Math.max(
    1,
    Number.parseInt(process.env.PACKAGE_NEW_PACKAGE_WELCOME_MAX_PAGES || '5', 10) || 5,
  )
  const welcomeRecentWindowMs = Number.isFinite(WHATSAPP_NEW_PACKAGE_WELCOME_RECENT_MS)
    ? Math.max(WHATSAPP_NEW_PACKAGE_WELCOME_RECENT_MS, 60 * 1000)
    : 24 * 60 * 60 * 1000
  const cutoffMs = Date.now() - Math.max(
    PACKAGE_NEW_PACKAGE_WELCOME_LOOKBACK_MS,
    welcomeRecentWindowMs,
    60 * 1000,
  )
  const upstreamUrl = new URL('/api/tracking/paquetes', trackingApiDefaults.baseUrl)
  upstreamUrl.searchParams.set('ordering', '-fecha_registro')

  const items = await fetchAllPaginatedItems({
    url: upstreamUrl,
    headers: {
      Authorization: `Bearer ${trackingApiDefaults.token}`,
      Accept: 'application/json',
    },
    perPage: 100,
    maxPages,
    timeoutMs,
    throwOnFirstPageError: true,
    stopWhen: (pageItems) => isPackagePageOutsideRecentWindow(
      pageItems,
      cutoffMs,
      (item) => getPackageContextDateValue(item?.fecha_registro || item?.created_at || item?.fechaCreacion),
    ),
  })

  return items.filter((item) => {
    const itemTime = getPackageContextDateValue(item?.fecha_registro || item?.created_at || item?.fechaCreacion)
    return Number.isFinite(itemTime) && itemTime > 0 && itemTime >= cutoffMs
  })
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

const getTariffApiProfiles = () => [
  {
    serviceKey: 'delivery_express',
    serviceName: 'TARIFARIO DELIVERY EXPRESS',
    endpoint: process.env.DELIVERY_EXPRESS_TARIFF_API_URL?.trim() ?? '',
    token: process.env.DELIVERY_EXPRESS_TARIFF_API_TOKEN?.trim() ?? '',
  },
  {
    serviceKey: 'ems',
    serviceName: 'TARIFARIO EMS NACIONAL',
    endpoint: process.env.EMS_NATIONAL_TARIFF_API_URL?.trim() ?? '',
    token: process.env.EMS_NATIONAL_TARIFF_API_TOKEN?.trim() ?? '',
  },
]

const fetchStoredPackageEventsForCode = async (packageCode) => {
  const normalizedCode = normalizePackageCodeForLookup(packageCode)
  if (!normalizedCode) return []

  await ensureDatabaseReady()

  const result = await pool.query(
    `
      select details, created_at
      from system_logs
      where event in (
          'package_event_observed',
          'whatsapp_package_event_update_skipped',
          'whatsapp_package_event_update_sent',
          'whatsapp_new_package_welcome_sent'
        )
        and upper(coalesce(details->>'packageCode', '')) = $1
      order by
        coalesce(nullif(details->>'eventDate', '')::timestamptz, created_at) asc,
        id asc;
    `,
    [normalizedCode],
  )

  const seen = new Set()

  return result.rows
    .map((row) => {
      const details = row.details ?? {}
      const signatureParts = normalizeReference(details.eventSignature).split('|')
      const signatureLabel = signatureParts[2] || ''
      const signatureDate = signatureParts.find((part) => /^\d{4}-\d{2}-\d{2}T/.test(part)) || ''
      const signatureLocation = signatureParts[4] || ''
      const eventDate = normalizeReference(details.eventDate) || signatureDate || row.created_at
      const eventLabel = normalizeReference(details.eventLabel) || signatureLabel || 'Nuevo movimiento'
      const eventLocation = normalizeReference(details.eventLocation) || signatureLocation || ''
      const eventSignature =
        normalizeReference(details.eventSignature) ||
        `${eventLabel}|${eventLocation}|${eventDate}`

      return {
        codigo: normalizedCode,
        codigo_s10: normalizedCode,
        evento_api: eventLabel,
        evento_original: eventLabel,
        oficina: eventLocation,
        ubicacion: eventLocation,
        fecha: eventDate,
        source: 'system_logs',
        eventSignature,
      }
    })
    .filter((event) => {
      const key = normalizeReference(event.eventSignature)
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    })
}

const fetchPackageEventsForCode = async (
  packageCode,
  { allowPagination = true, timeoutMs: requestedTimeoutMs } = {},
) => {
  const normalizedCode = normalizePackageCodeForLookup(packageCode)
  const cacheKey = normalizedCode || 'all'
  const cachedEvents = getCachedValue(packageEventsCache, cacheKey)
  if (cachedEvents) {
    return cachedEvents
  }
  if (Date.now() < packageEventsRateLimitedUntil) {
    const storedEvents = await fetchStoredPackageEventsForCode(normalizedCode)
    return {
      data: storedEvents,
      total: storedEvents.length,
      cachedAt: new Date().toISOString(),
      statusCode: 429,
      error: 'La API de eventos esta temporalmente limitada; se reintentara en el siguiente ciclo.',
      code: normalizedCode,
      source: storedEvents.length > 0 ? 'system_logs' : 'remote-rate-limited',
    }
  }

  reloadLocalEnv()

  const packageEventsApiDefaults = getPackageEventsApiDefaults()
  const timeoutMs =
    Number.isFinite(requestedTimeoutMs) && requestedTimeoutMs > 0
      ? requestedTimeoutMs
      : Number.parseInt(process.env.PACKAGE_EVENTS_CATALOG_TIMEOUT_MS || '30000', 10)
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
      if (response?.status === 429) {
        packageEventsRateLimitedUntil = Date.now() + 5 * 60 * 1000
        break
      }
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

  if (!matchedItems.length && normalizedCode && allowPagination) {
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

  if (!matchedItems.length && normalizedCode) {
    matchedItems = await fetchStoredPackageEventsForCode(normalizedCode)
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

const fetchRecentPackageEventCodes = async () => {
  const result = await pool.query(`
    select details->>'packageCode' as package_code, max(created_at) as last_activity_at
    from system_logs
    where event in (
        'whatsapp_new_package_welcome_sent',
        'whatsapp_package_event_update_sent',
        'package_event_observed'
      )
      and created_at >= now() - interval '7 days'
      and nullif(details->>'packageCode', '') is not null
    group by details->>'packageCode'
    order by last_activity_at desc
    limit 200;
  `)

  return result.rows
    .map((row) => normalizePackageCodeForLookup(row.package_code))
    .filter(Boolean)
    .slice(0, Number.parseInt(process.env.PACKAGE_RECENT_EVENT_CODE_LIMIT || '200', 10) || 200)
}

const fetchRecentContactPackageEventsByCode = async () => {
  const codes = await fetchRecentPackageEventCodes()
  if (codes.length === 0) {
    return []
  }

  const contactPackagesApiDefaults = getContactPackagesApiDefaults()
  const contactUrl = new URL(contactPackagesApiDefaults.endpoint)
  const headers = {
    Authorization: 'Bearer ' + contactPackagesApiDefaults.token,
    Accept: 'application/json',
  }
  const timeoutMs = Number.parseInt(process.env.CONTACT_PACKAGES_PAGE_TIMEOUT_MS || '8000', 10)
  const concurrency = Math.max(
    1,
    Math.min(Number.parseInt(process.env.PACKAGE_EVENTS_LOOKUP_CONCURRENCY || '3', 10) || 1, 3),
  )
  const events = []
  let failedLookups = 0

  for (let index = 0; index < codes.length; index += concurrency) {
    const batch = codes.slice(index, index + concurrency)
    const results = await Promise.all(
      batch.map((code) =>
        fetchExactPackageCodeMatches({
          url: contactUrl,
          headers,
          queryParam: 'codigo',
          code,
          perPage: 20,
          timeoutMs,
        }).catch(() => ({ items: [] })),
      ),
    )

    for (const result of results) {
      if (!result?.ok) {
        failedLookups += 1
        continue
      }
      for (const item of result.items ?? []) {
        const itemCodes = getPackageCodeValuesForLookup(item)
        const itemEvents = Array.isArray(item?.eventos) ? item.eventos : []
        events.push(
          ...itemEvents.map((event) => ({
            ...event,
            codigo: event?.codigo ?? itemCodes[0],
            codigo_s10: event?.codigo_s10 ?? itemCodes[0],
          })),
        )
      }
    }
  }

  if (failedLookups > 0) {
    console.warn(
      `Watcher WhatsApp: ${failedLookups} consulta(s) de paquetes-contactos no respondieron; ` +
        'no se puede confirmar si existe un evento nuevo.',
    )
    await writeSystemLog({
      event: 'whatsapp_package_event_source_unavailable',
      statusCode: 502,
      details: {
        source: 'paquetes-contactos',
        failedLookups,
        requestedCodes: codes.length,
      },
    }).catch(() => {})
  }

  return events
}

const fetchRecentPackageEventsByCode = async () => {
  if (!hasDedicatedPackageEventsApiConfig()) {
    return { events: [], failures: [] }
  }

  const codes = await fetchRecentPackageEventCodes()
  const timeoutMs = Number.parseInt(process.env.PACKAGE_EVENTS_PAGE_TIMEOUT_MS || '8000', 10)
  const concurrency = Math.max(
    1,
    Math.min(Number.parseInt(process.env.PACKAGE_EVENTS_LOOKUP_CONCURRENCY || '3', 10) || 1, 3),
  )
  const events = []
  const failures = []

  for (let index = 0; index < codes.length; index += concurrency) {
    const batch = codes.slice(index, index + concurrency)
    const results = await Promise.all(
      batch.map((code) =>
        fetchPackageEventsForCode(code, { allowPagination: false, timeoutMs }).catch(() => ({
          data: [],
          code,
        })),
      ),
    )
    results.forEach((result) => {
    if (result?.statusCode >= 400) {
      failures.push({
        code: result.code,
        statusCode: result.statusCode,
        error: result.error,
      })
    }
    if (Array.isArray(result?.data)) {
      events.push(...result.data)
    }
    })
  }

  return { events, failures }
}

const fetchAllPackageEventsCatalog = async ({
  forceRefresh = false,
  cacheResult = true,
  retainResults = true,
  onPage = null,
} = {}) => {
  reloadLocalEnv()
  if (!hasDedicatedPackageEventsApiConfig()) {
    return {
      data: [],
      total: 0,
      cachedAt: new Date().toISOString(),
      skipped: true,
      reason: 'dedicated-package-events-api-not-configured',
    }
  }

  const cacheKey = 'all'
  const cachedEvents = getCachedValue(packageEventsCache, cacheKey)
  if (!forceRefresh && cacheResult && cachedEvents) {
    return cachedEvents
  }

  const inFlightCacheKey = `${cacheKey}-in-flight`
  const pendingEvents = getCachedValue(packageEventsCache, inFlightCacheKey)
  if (!forceRefresh && cacheResult && pendingEvents) {
    return pendingEvents
  }

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
    maxPages: 2000,
    timeoutMs,
    onPage,
    retainItems: retainResults,
  })
    .then((data) => {
      const catalog = {
        data,
        total: data.length,
        cachedAt: new Date().toISOString(),
      }
      return cacheResult
        ? setCachedValue(packageEventsCache, cacheKey, catalog, CONTACT_PACKAGES_CATALOG_TTL_MS)
        : catalog
    })
    .finally(() => {
      if (cacheResult) {
        packageEventsCache.delete(inFlightCacheKey)
      }
    })

  if (cacheResult) {
    setCachedValue(packageEventsCache, inFlightCacheKey, catalogPromise, CONTACT_PACKAGES_CATALOG_TTL_MS)
  }
  return catalogPromise
}

const fetchRecentPackageEventsCatalog = async ({ lookbackMs = PACKAGE_NEW_PACKAGE_WELCOME_LOOKBACK_MS } = {}) => {
  reloadLocalEnv()

  const contactItems = await fetchRecentContactPackageEventsByCode()
  if (!hasDedicatedPackageEventsApiConfig()) {
    return contactItems
  }

  const packageEventsApiDefaults = getPackageEventsApiDefaults()
  const timeoutMs = Number.parseInt(process.env.PACKAGE_EVENTS_PAGE_TIMEOUT_MS || '8000', 10)
  const maxPages = Math.max(
    1,
    Number.parseInt(process.env.PACKAGE_RECENT_EVENTS_MAX_PAGES || '10', 10) || 10,
  )
  const cutoffMs = Date.now() - (Number.isFinite(lookbackMs) ? Math.max(lookbackMs, 60 * 1000) : 60 * 60 * 1000)
  const baseUrl = new URL(packageEventsApiDefaults.endpoint)
  baseUrl.searchParams.set('ordering', '-fecha')

  const headers = {
    Authorization: `Bearer ${packageEventsApiDefaults.token}`,
    Accept: 'application/json',
  }

  const items = await fetchAllPaginatedItems({
    url: baseUrl,
    headers,
    perPage: 200,
    maxPages,
    timeoutMs,
    stopWhen: (pageItems) =>
      pageItems.some((item) => {
        const eventTime = getPackageEventTimestampValue(item)
        return Number.isFinite(eventTime) && eventTime > 0 && eventTime < cutoffMs
      }),
  }).catch(() => [])

  const recentItems = items.filter((item) => {
    const eventTime = getPackageEventTimestampValue(item)
    return Number.isFinite(eventTime) && eventTime > 0 && eventTime >= cutoffMs
  })

  // The catalog can lag or become congested. Direct lookups keep recent
  // notifications working for packages already known to the CRM.
  const directLookup = await fetchRecentPackageEventsByCode()
  const directItems = [...contactItems, ...directLookup.events]
  const mergedItems = new Map()
  for (const item of [...recentItems, ...directItems]) {
    const key = [
      ...getPackageEventCodeValuesForLookup(item),
      normalizeReference(item?.id),
      normalizeReference(item?.evento_id),
      String(getPackageEventTimestampValue(item)),
    ].join('|')
    if (key) mergedItems.set(key, item)
  }

  return [...mergedItems.values()].filter((item) => {
    const eventTime = getPackageEventTimestampValue(item)
    const isDirectLookup = directItems.includes(item)
    return (
      Number.isFinite(eventTime) &&
      eventTime > 0 &&
      (isDirectLookup || eventTime >= cutoffMs)
    )
  })
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

const normalizeAutomationIntervalMs = (value, fallbackMs, { minMs = 60 * 1000, maxMs = 24 * 60 * 60 * 1000 } = {}) => {
  const numericValue = Number(value)
  if (!Number.isFinite(numericValue)) {
    return fallbackMs
  }

  return Math.min(Math.max(Math.round(numericValue), minMs), maxMs)
}

const AUTOMATION_WELCOME_INTERVAL_SETTINGS_VERSION = 7
const DEFAULT_WELCOME_INTERVAL_MS = 5 * 60 * 1000
const DEFAULT_PACKAGE_RECONCILIATION_INTERVAL_MS = 30 * 60 * 1000

const getStoredAutomationConfig = async () => {
  let settings = await getStoredSettingsByKey('crm_automation_config')
  const migration = migrateWelcomeIntervalSetting({
    settings,
    currentVersion: AUTOMATION_WELCOME_INTERVAL_SETTINGS_VERSION,
    defaultIntervalMs: DEFAULT_WELCOME_INTERVAL_MS,
  })
  if (migration.changed) {
    settings = migration.settings
    await saveSettingsByKey('crm_automation_config', settings)
    const aiAgentSettings = await getStoredSettingsByKey('crm_ai_agent')
    await saveSettingsByKey('crm_ai_agent', {
      ...aiAgentSettings,
      enabled: true,
    })
  }

  return {
    automaticWelcome: resolveAutomationBooleanSetting({
      storedValue: settings.automaticWelcome,
      envValue: process.env.WHATSAPP_NEW_PACKAGE_WELCOME_ENABLED,
    }),
    automaticStatusUpdates: resolveAutomationBooleanSetting({
      storedValue: settings.automaticStatusUpdates,
      envValue: process.env.WHATSAPP_NEW_PACKAGE_WATCHER_ENABLED,
      defaultValue: true,
    }),
    automaticVentanillaNotifications: resolveAutomationBooleanSetting({
      storedValue: settings.automaticVentanillaNotifications,
      defaultValue: true,
    }),
    automaticInternationalArrivalTestNotifications: resolveAutomationBooleanSetting({
      storedValue: settings.automaticInternationalArrivalTestNotifications,
      defaultValue: true,
    }),
    automaticReconciliation: resolveAutomationBooleanSetting({
      storedValue: settings.automaticReconciliation,
      defaultValue: true,
    }),
    aiAutoReply:
      typeof settings.aiAutoReply === 'boolean'
        ? settings.aiAutoReply
        : process.env.AI_AUTO_REPLY !== 'false',
    welcomeResponseIntervalMs: normalizeAutomationIntervalMs(
      settings.welcomeResponseIntervalMs,
      DEFAULT_WELCOME_INTERVAL_MS,
      { minMs: 60 * 1000, maxMs: 6 * 60 * 60 * 1000 },
    ),
    eventChangeResponseIntervalMs: normalizeAutomationIntervalMs(
      settings.eventChangeResponseIntervalMs,
      Number.isFinite(PACKAGE_EVENT_CHANGE_SYNC_INTERVAL_MS)
        ? Math.max(PACKAGE_EVENT_CHANGE_SYNC_INTERVAL_MS, 60 * 1000)
        : 15 * 60 * 1000,
      { minMs: 60 * 1000, maxMs: 24 * 60 * 60 * 1000 },
    ),
    reconciliationIntervalMs: normalizeAutomationIntervalMs(
      settings.reconciliationIntervalMs,
      DEFAULT_PACKAGE_RECONCILIATION_INTERVAL_MS,
      { minMs: 15 * 60 * 1000, maxMs: 24 * 60 * 60 * 1000 },
    ),
  }
}

const getAutomationWatcherStatus = async () => {
  const [result, inboundResult, reconciliationResult] = await Promise.all([
    pool.query(`
    select event, level, created_at,
           details->>'checkedAt' as checked_at,
           details->>'totalPackages' as total_packages,
           details->>'newPackages' as new_packages,
           details->>'welcomeSent' as welcome_sent,
           details->>'welcomeSkipped' as welcome_skipped,
           details->>'eventSent' as event_sent,
           details->>'eventSkipped' as event_skipped,
           details->'eventSkippedByReason' as event_skipped_by_reason,
           details->>'eventReason' as event_reason,
           details->>'ventanillaSent' as ventanilla_sent,
           details->>'ventanillaSkipped' as ventanilla_skipped,
           details->'ventanillaSkippedByReason' as ventanilla_skipped_by_reason,
           details->>'ventanillaReason' as ventanilla_reason,
           details->'packageCountsBySource' as package_counts_by_source,
           details->'packageSourceFailures' as package_source_failures,
           details->'welcomeSkippedByReason' as welcome_skipped_by_reason
    from system_logs
    where event in (
      'whatsapp_new_package_fast_check_completed',
      'whatsapp_new_package_fast_check_failed'
    )
    order by created_at desc, id desc
    limit 1;
  `),
    pool.query(`
      select details->>'inboundMessageId' as inbound_message_id, created_at
      from system_logs
      where event = 'whatsapp_inbound_message_saved'
      order by created_at desc, id desc
      limit 1;
    `),
    pool.query(`
      select event, level, created_at,
             details->>'checkedAt' as checked_at,
             details->>'totalPackages' as total_packages,
             details->>'sentTotal' as sent_total,
             details->>'welcomeSent' as welcome_sent,
             details->>'welcomeSkipped' as welcome_skipped,
             details->'welcomeSkippedByReason' as welcome_skipped_by_reason,
             details->>'welcomeReason' as welcome_reason,
             details->>'eventSent' as event_sent,
             details->>'eventSkipped' as event_skipped,
             details->'eventSkippedByReason' as event_skipped_by_reason,
             details->>'eventReason' as event_reason,
             details->>'ventanillaSent' as ventanilla_sent,
             details->>'ventanillaSkipped' as ventanilla_skipped,
             details->'ventanillaSkippedByReason' as ventanilla_skipped_by_reason,
             details->>'ventanillaReason' as ventanilla_reason,
             details->'sourceFailures' as source_failures,
             details->'notificationFailures' as notification_failures
      from system_logs
      where event in (
        'whatsapp_package_reconciliation_started',
        'whatsapp_package_reconciliation_completed',
        'whatsapp_package_reconciliation_failed'
      )
      order by created_at desc, id desc
      limit 1;
    `),
  ])
  const row = result.rows[0]
  const latestInbound = inboundResult.rows[0] ?? null
  const latestInboundReplyResult = latestInbound?.inbound_message_id
    ? await pool.query(
        `
          select event, created_at, details->>'reason' as reason
          from system_logs
          where details->>'inboundMessageId' = $1
            and event in (
              'whatsapp_auto_reply_started',
              'whatsapp_auto_reply_sent',
              'whatsapp_auto_reply_skipped',
              'whatsapp_auto_reply_failed',
              'whatsapp_auto_reply_queue_failed'
            )
          order by created_at desc, id desc
          limit 1;
        `,
        [latestInbound.inbound_message_id],
      )
    : { rows: [] }
  const latestInboundReply = latestInboundReplyResult.rows[0] ?? null
  const latestReconciliation = reconciliationResult.rows[0] ?? null

  return {
    watcher: row
      ? {
          checkedAt: row.checked_at || row.created_at,
          status: row.event === 'whatsapp_new_package_fast_check_failed' ? 'failed' : 'completed',
          totalPackages: Number(row.total_packages) || 0,
          newPackages: Number(row.new_packages) || 0,
          welcomeSent: Number(row.welcome_sent) || 0,
          welcomeSkipped: Number(row.welcome_skipped) || 0,
          eventSent: Number(row.event_sent) || 0,
          eventSkipped: Number(row.event_skipped) || 0,
          eventSkippedByReason: row.event_skipped_by_reason ?? {},
          eventReason: row.event_reason ?? null,
          ventanillaSent: Number(row.ventanilla_sent) || 0,
          ventanillaSkipped: Number(row.ventanilla_skipped) || 0,
          ventanillaSkippedByReason: row.ventanilla_skipped_by_reason ?? {},
          ventanillaReason: row.ventanilla_reason ?? null,
          packageCountsBySource: row.package_counts_by_source ?? {},
          packageSourceFailures: row.package_source_failures ?? [],
          welcomeSkippedByReason: row.welcome_skipped_by_reason ?? {},
        }
      : null,
    reconciliation: latestReconciliation
        ? {
            checkedAt: latestReconciliation.checked_at || latestReconciliation.created_at,
            status: latestReconciliation.event === 'whatsapp_package_reconciliation_failed'
              ? 'failed'
              : latestReconciliation.event === 'whatsapp_package_reconciliation_started'
                ? 'running'
              : (
                (Array.isArray(latestReconciliation.source_failures) && latestReconciliation.source_failures.length > 0) ||
                (Array.isArray(latestReconciliation.notification_failures) && latestReconciliation.notification_failures.length > 0)
              )
                ? 'partial'
                : 'completed',
            totalPackages: Number(latestReconciliation.total_packages) || 0,
            sentTotal: Number(latestReconciliation.sent_total) || 0,
            welcomeSent: Number(latestReconciliation.welcome_sent) || 0,
            welcomeSkipped: Number(latestReconciliation.welcome_skipped) || 0,
            welcomeSkippedByReason: latestReconciliation.welcome_skipped_by_reason ?? {},
            welcomeReason: latestReconciliation.welcome_reason ?? null,
            eventSent: Number(latestReconciliation.event_sent) || 0,
            eventSkipped: Number(latestReconciliation.event_skipped) || 0,
            eventSkippedByReason: latestReconciliation.event_skipped_by_reason ?? {},
            eventReason: latestReconciliation.event_reason ?? null,
            ventanillaSent: Number(latestReconciliation.ventanilla_sent) || 0,
            ventanillaSkipped: Number(latestReconciliation.ventanilla_skipped) || 0,
            ventanillaSkippedByReason: latestReconciliation.ventanilla_skipped_by_reason ?? {},
            ventanillaReason: latestReconciliation.ventanilla_reason ?? null,
            sourceFailures: latestReconciliation.source_failures ?? [],
            notificationFailures: latestReconciliation.notification_failures ?? [],
          }
        : null,
    inboundReply: {
      receivedAt: latestInbound?.created_at ?? null,
      event: latestInboundReply?.event ?? null,
      attemptedAt: latestInboundReply?.created_at ?? null,
      reason: latestInboundReply?.reason ?? null,
    },
  }
}

const saveAutomationConfig = async (partialConfig) => {
  const currentConfig = await getStoredAutomationConfig()
  return saveSettingsByKey('crm_automation_config', {
    ...currentConfig,
    ...partialConfig,
    welcomeResponseIntervalVersion: AUTOMATION_WELCOME_INTERVAL_SETTINGS_VERSION,
  })
}

app.get('/api/settings/automation', authMiddleware, async (_request, response) => {
  try {
    await ensureDatabaseReady()
    const [config, automationStatus] = await Promise.all([
      getStoredAutomationConfig(),
      getAutomationWatcherStatus(),
    ])
    response.json({ config, ...automationStatus })
  } catch (error) {
    response.status(500).json({ message: 'No se pudo cargar las configuraciones.', error: error.message })
  }
})

app.put('/api/settings/automation', authMiddleware, async (request, response) => {
  try {
    await ensureDatabaseReady()
    const body = request.body ?? {}
    const config = await saveAutomationConfig({
      ...(typeof body.automaticWelcome === 'boolean' ? { automaticWelcome: body.automaticWelcome } : {}),
      ...(typeof body.automaticStatusUpdates === 'boolean'
        ? { automaticStatusUpdates: body.automaticStatusUpdates }
        : {}),
      ...(typeof body.automaticVentanillaNotifications === 'boolean'
        ? { automaticVentanillaNotifications: body.automaticVentanillaNotifications }
        : {}),
      ...(typeof body.automaticInternationalArrivalTestNotifications === 'boolean'
        ? { automaticInternationalArrivalTestNotifications: body.automaticInternationalArrivalTestNotifications }
        : {}),
      ...(typeof body.automaticReconciliation === 'boolean'
        ? { automaticReconciliation: body.automaticReconciliation }
        : {}),
      ...(typeof body.aiAutoReply === 'boolean' ? { aiAutoReply: body.aiAutoReply } : {}),
      ...(body.welcomeResponseIntervalMs != null
        ? {
            welcomeResponseIntervalMs: normalizeAutomationIntervalMs(
              body.welcomeResponseIntervalMs,
              DEFAULT_WELCOME_INTERVAL_MS,
              { minMs: 60 * 1000, maxMs: 6 * 60 * 60 * 1000 },
            ),
          }
        : {}),
      ...(body.eventChangeResponseIntervalMs != null
        ? {
            eventChangeResponseIntervalMs: normalizeAutomationIntervalMs(
              body.eventChangeResponseIntervalMs,
              PACKAGE_EVENT_CHANGE_SYNC_INTERVAL_MS,
              { minMs: 60 * 1000, maxMs: 24 * 60 * 60 * 1000 },
            ),
          }
        : {}),
      ...(body.reconciliationIntervalMs != null
        ? {
            reconciliationIntervalMs: normalizeAutomationIntervalMs(
              body.reconciliationIntervalMs,
              DEFAULT_PACKAGE_RECONCILIATION_INTERVAL_MS,
              { minMs: 15 * 60 * 1000, maxMs: 24 * 60 * 60 * 1000 },
            ),
          }
        : {}),
    })
    response.json({ ok: true, config })
  } catch (error) {
    response.status(500).json({ message: 'No se pudo guardar las configuraciones.', error: error.message })
  }
})

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

const collectNestedValuesByKey = (value, keys, result = []) => {
  if (!value || typeof value !== 'object') return result
  if (Array.isArray(value)) {
    value.forEach((item) => collectNestedValuesByKey(item, keys, result))
    return result
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    const normalizedKey = key
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/gi, '')
      .toLowerCase()
    if (keys.has(normalizedKey) && typeof nestedValue !== 'object') {
      result.push(nestedValue)
    }
    collectNestedValuesByKey(nestedValue, keys, result)
  }
  return result
}

const extractPackagePhoneCandidates = (item) =>
  collectNestedValuesByKey(item, new Set([
    'telefono',
    'phone',
    'numerotelefono',
    'numerocelular',
    'numero',
    'telefono1',
    'telefono2',
    'celular',
    'movil',
    'whatsapp',
    'telefonodestinatario',
    'telefonoremitente',
  ]))
    .map(normalizePhoneNumber)
    .filter(Boolean)
    .filter((phone, index, phones) => phones.indexOf(phone) === index)

const extractTrackingApiPhoneCandidates = (item) => extractPackagePhoneCandidates(item)

const extractContactPackagesPhoneCandidates = (item) => extractPackagePhoneCandidates(item)

const extractContactPackageRecipientPhoneCandidates = (item) => [
  item?.destinatario?.telefono,
].map(normalizePhoneNumber).filter(Boolean)

const getPackageSyncPhoneNames = (item, source = 'tracking') => {
  const people = source === 'contact'
    ? [
      [item?.destinatario, item?.destinatario?.telefono || item?.telefonos?.destinatario],
      [item?.remitente, item?.remitente?.telefono || item?.telefonos?.remitente],
      [item?.origen, item?.origen?.telefono || item?.telefonos?.origen],
      [item?.destino, item?.destino?.telefono || item?.telefonos?.destino],
      ]
    : [
        [item?.destinatario, item?.telefonos?.destinatario || item?.destinatario?.telefono],
        [item?.remitente, item?.telefonos?.remitente || item?.remitente?.telefono],
        [item?.origen, item?.origen?.telefono],
        [item?.destino, item?.destino?.telefono],
      ]

  return people.reduce((names, [person, phone]) => {
    const normalizedPhone = normalizeBoliviaTestNumber(phone)
    const name = normalizeReference(person?.nombre || person?.name)
    if (normalizedPhone && name) {
      names.set(normalizedPhone, name)
    }
    return names
  }, new Map())
}

const getTrackingLatestEvent = (item) => {
  const events = Array.isArray(item?.eventos) ? item.eventos.filter(Boolean) : []
  return [...events].sort(
    (firstEvent, secondEvent) =>
      getPackageEventTimestampValue(secondEvent) - getPackageEventTimestampValue(firstEvent),
  )[0] ?? null
}

const getInternationalIpsStageFromEvent = (event) => {
  if (!event) return null

  const eventId = Number(
    event?.evento_id ?? event?.codigo_evento ?? event?.event_code ?? event?.event_type_cd ?? event?.event_id,
  )
  const eventText = normalizeReference(
    [
      event?.nombre,
      event?.evento_api,
      event?.evento_original,
      event?.event_name,
      event?.movimiento_bolivia,
      event?.detalle,
    ]
      .filter(Boolean)
      .join(' '),
  ).toLowerCase()
  if (eventId === 37) return 'delivered'
  if (eventId === 76) return 'cancelled'
  if ([32, 36, 39, 73, 74, 75].includes(eventId)) return 'courier'
  if ([13, 14, 35, 71, 72].includes(eventId)) return 'regional'
  if (eventId === 38 && (eventText.includes('devol') || eventText.includes('return'))) return 'cancelled'
  if ([31, 34, 38].includes(eventId)) return 'transit'
  if ([1, 2, 3, 8, 12, 30].includes(eventId)) return 'received'

  return null
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

  addLatestPackageEventsToCodeMap(latestEventsByCode, events)
  return latestEventsByCode
}

const addLatestPackageEventsToCodeMap = (latestEventsByCode, events = []) => {
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
}

const getNationalPackageStageFromEvent = (event, hasPreviousTransit = false) =>
  getNationalPackageEventStage({ event, hasPreviousTransit })

const getPackageStageFromEvents = (item) => {
  const events = Array.isArray(item?.eventos) ? item.eventos.filter(Boolean) : []
  const latestEvent = getPackageLatestEvent(item)
  const hasPreviousTransit = events.some((event) => getNationalPackageStageFromEvent(event) === 'transit')

  return getNationalPackageStageFromEvent(latestEvent, hasPreviousTransit)
}

const hasContactPackageTransfer = (item) => {
  const transferValues = [
    item?.traspaso,
    item?.fecha_traspaso,
    item?.fechaTraspaso,
    item?.transferencia,
    item?.fecha_transferencia,
    item?.cod_especial,
    item?.codigo_especial,
    item?.codigoEspecial,
    item?.codigo_relacionado,
    item?.numero_despacho,
  ]

  return transferValues.some((value) => Boolean(normalizeReference(value)))
}

const getContactPackageTransferCode = (item) =>
  normalizeReference(item?.cod_especial) ||
  normalizeReference(item?.codigo_especial) ||
  normalizeReference(item?.codigoEspecial) ||
  normalizeReference(item?.codigo_relacionado) ||
  normalizeReference(item?.numero_despacho)

const getContactPackageTransferDate = (item) =>
  normalizeReference(item?.traspaso) ||
  normalizeReference(item?.fecha_traspaso) ||
  normalizeReference(item?.fechaTraspaso) ||
  normalizeReference(item?.transferencia) ||
  normalizeReference(item?.fecha_transferencia)

const getPackageStageRank = (stage) => {
  if (stage === 'received') return 0
  if (stage === 'transit') return 1
  if (stage === 'regional') return 2
  if (stage === 'courier') return 3
  if (stage === 'delivered') return 4
  if (stage === 'cancelled') return 5
  return -1
}

const getMostAdvancedPackageStage = (...stages) =>
  stages
    .filter(Boolean)
    .sort((stageA, stageB) => getPackageStageRank(stageB) - getPackageStageRank(stageA))[0] ?? null

const inferTrackingPackageStage = (item) => {
  const latestEvent = getTrackingLatestEvent(item)
  const statusStage = normalizeEmsStatus(item?.estado_postal)
  if (statusStage === 'cancelled') return statusStage

  const ipsStage = getInternationalIpsStageFromEvent(latestEvent)
  if (ipsStage) return ipsStage

  const eventStage = getPackageStageFromEvents(item)
  const transferStage = hasContactPackageTransfer(item) ? 'transit' : null
  const advancedStage = getMostAdvancedPackageStage(eventStage, transferStage)
  if (advancedStage) return advancedStage

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
      event?.event_name ||
      event?.movimiento_bolivia ||
      event?.detalle ||
      'Nuevo movimiento',
  )

const getPackageEventSignature = (event) => {
  if (!event) return ''

  return buildPackageEventSignature({
    eventId: event?.evento_id ?? event?.event_id ?? event?.event_type_cd,
    eventCode: event?.codigo_evento ?? event?.event_code,
    label: getPackageEventLabel(event),
    location: getPackageEventLocation(event),
    date: normalizeReference(
      event?.fecha_movimiento ||
        event?.fechaMovimiento ||
        event?.fecha_evento ||
        event?.fechaEvento ||
        event?.event_date ||
        event?.fecha_hora ||
        event?.fechaHora ||
        event?.fecha_registro ||
        event?.fecha ||
        event?.created_at ||
        event?.timestamp ||
        getPackageEventTimestampValue(event),
    ),
  })
}

const getInternationalArrivalEventFromEvents = (events = []) =>
  (Array.isArray(events) ? events : [])
    .filter((event) =>
      isInternationalArrivalEvent(
        [
          getPackageEventLabel(event),
          getPackageEventSignature(event),
          event?.movimiento_bolivia,
          event?.detalle,
        ]
          .filter(Boolean)
          .join(' '),
      ),
    )
    .sort((firstEvent, secondEvent) =>
      getPackageEventTimestampValue(secondEvent) - getPackageEventTimestampValue(firstEvent),
    )[0] ?? null

const getInternationalArrivalEventFromItem = (item, registeredLatestEvent = null) =>
  getInternationalArrivalEventFromEvents([
    registeredLatestEvent,
    ...(Array.isArray(item?.eventos) ? item.eventos : []),
  ].filter(Boolean))

const inferContactPackageStage = (item) => {
  const statusText = normalizeReference(item?.estado?.nombre)
  const resolvedStage = resolveContactPackageStage({
    statusText,
    latestEventStage: getPackageStageFromEvents(item),
    transferStage: hasContactPackageTransfer(item) ? 'transit' : null,
  })
  if (resolvedStage) return resolvedStage

  const normalizedStatus = statusText.toLowerCase()
  const latestEventStage = getPackageStageFromEvents(item)
  const transferStage = hasContactPackageTransfer(item) ? 'transit' : null
  const advancedMovementStage = getMostAdvancedPackageStage(latestEventStage, transferStage)

  if (advancedMovementStage && advancedMovementStage !== 'received') {
    return advancedMovementStage
  }

  if (
    normalizedStatus.includes('regional') ||
    normalizedStatus.includes('destino') ||
    normalizedStatus.includes('recibido destino') ||
    normalizedStatus.includes('recibido regional') ||
    normalizedStatus.includes('sucursal de destino') ||
    normalizedStatus.includes('pasar a recoger') ||
    normalizedStatus.includes('ventanilla')
  ) {
    return 'regional'
  }

  if (
    normalizedStatus.includes('cartero') ||
    normalizedStatus.includes('reparto') ||
    normalizedStatus.includes('distribucion') ||
    normalizedStatus.includes('distribuciÃƒÂ³n')
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
    normalizedStatus.includes('trÃƒÂ¡nsito') ||
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
    normalizedStatus.includes('almacen') ||
    normalizedStatus.includes('almacÃ©n') ||
    normalizedStatus.includes('admis') ||
    normalizedStatus.includes('recepcion') ||
    normalizedStatus.includes('origen')
  ) {
    return 'received'
  }

  if (advancedMovementStage) {
    return advancedMovementStage
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

const getPackageCodeFromItem = (item) => {
  const directCode = normalizePackageCodeForLookup(
    item?.codigo_s10 || item?.codigo || item?.codigoSeguimiento || item?.tracking,
  )
  if (isValidEmsPackageCode(directCode)) return directCode

  const nestedValues = collectNestedValuesByKey(item, new Set([
    'codigos10',
    'codigo',
    'codigoseguimiento',
    'tracking',
    'codigoems',
    'guia',
    'guiaseguimiento',
  ]))
  return nestedValues
    .map(normalizePackageCodeForLookup)
    .find(isValidEmsPackageCode) || ''
}

const isNationalPackageCode = (code) => /^[A-Z]{1,2}\d+[A-Z]{2}$/.test(normalizePackageCodeForLookup(code)) && normalizePackageCodeForLookup(code).endsWith('BO')

const getPackageSyncPhoneCandidates = (item, source = 'tracking') => {
  if (source === 'contact') {
    return extractContactPackageRecipientPhoneCandidates(item)
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
  return destination ? `${sourceLabel} Â· ${destination}` : sourceLabel
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
        where lower(coalesce(profile->>'channel', '')) like '%ems%'
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
  const allPhones = [
    entry.primaryPhone,
    ...phoneCandidates,
  ]
    .map(normalizeBoliviaTestNumber)
    .filter(Boolean)
    .filter((phone, index, phones) => phones.indexOf(phone) === index)
  const primaryPhone = allPhones[0] || ''
  const retainedProfiles = (Array.isArray(existingContact?.social_profiles) ? existingContact.social_profiles : []).filter((profile) => {
    const channel = normalizeReference(profile?.channel).toLowerCase()
    return channel !== 'whatsapp' && channel !== 'ems'
  })
  const nextSocialProfiles = mergeUniqueProfiles(retainedProfiles, [
    { channel: 'EMS', reference: entry.code },
    ...allPhones.map((phone) => ({ channel: 'WhatsApp', reference: `+${phone}` })),
  ])

  const nextRow = {
    name: getPackageSyncDisplayName(entry),
    company: getPackageSyncCompany(entry),
    channel: primaryPhone ? 'WhatsApp, EMS' : 'EMS',
    socialProfiles: JSON.stringify(nextSocialProfiles),
    segment: entry.source === 'contact' ? 'Paquetes-contactos API' : 'Tracking API',
    ownerName: 'IntegraciÃ³n EMS',
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

const persistInternationalTrackingCatalog = async (items = []) => {
  if (!Array.isArray(items) || items.length === 0) return 0
  await ensureDatabaseReady()

  const rows = items.map((item) => {
    const packageCode = getPackageCodeFromItem(item)
    if (!packageCode) return null
    const latestEvent = getTrackingLatestEvent(item)
    const latestEventCode = Number(latestEvent?.evento_id ?? latestEvent?.codigo_evento)
    return {
      package_code: packageCode,
      stage_key: inferTrackingPackageStage(item),
      latest_event_code: Number.isFinite(latestEventCode) ? latestEventCode : null,
      latest_event_name: getPackageEventLabel(latestEvent),
      latest_event_at: normalizeReference(latestEvent?.fecha) || normalizeReference(item?.fecha_registro) || null,
      search_text: JSON.stringify(item).toLowerCase(),
      payload: item,
    }
  }).filter(Boolean)
  const uniqueRowsByPackageCode = new Map()
  rows.forEach((row) => {
    const existingRow = uniqueRowsByPackageCode.get(row.package_code)
    const existingTimestamp = Date.parse(existingRow?.latest_event_at ?? '') || 0
    const candidateTimestamp = Date.parse(row.latest_event_at ?? '') || 0
    if (!existingRow || candidateTimestamp >= existingTimestamp) {
      uniqueRowsByPackageCode.set(row.package_code, row)
    }
  })
  const uniqueRows = [...uniqueRowsByPackageCode.values()]

  for (let offset = 0; offset < uniqueRows.length; offset += 1000) {
    await pool.query(
      `
        insert into international_tracking_packages (
          package_code, stage_key, latest_event_code, latest_event_name,
          latest_event_at, search_text, payload, imported_at, updated_at
        )
        select
          row.package_code, row.stage_key, row.latest_event_code, row.latest_event_name,
          row.latest_event_at, row.search_text, row.payload, now(), now()
        from jsonb_to_recordset($1::jsonb) as row(
          package_code text, stage_key text, latest_event_code integer,
          latest_event_name text, latest_event_at timestamptz,
          search_text text, payload jsonb
        )
        on conflict (package_code) do update set
          stage_key = excluded.stage_key,
          latest_event_code = excluded.latest_event_code,
          latest_event_name = excluded.latest_event_name,
          latest_event_at = excluded.latest_event_at,
          search_text = excluded.search_text,
          payload = excluded.payload,
          updated_at = now();
      `,
      [JSON.stringify(uniqueRows.slice(offset, offset + 1000))],
    )
  }

  return uniqueRows.length
}

const fetchAllTrackingPackagesCatalog = async ({ forceRefresh = false } = {}) => {
  const cacheKey = 'all'
  const cachedCatalog = getCachedValue(packagePipelineSyncCache, cacheKey)
  const cachedCatalogIncludesDeclarations =
    Array.isArray(cachedCatalog?.data) &&
    cachedCatalog.data.every((item) => Object.prototype.hasOwnProperty.call(item ?? {}, 'declaracion_cds'))
  if (
    !forceRefresh &&
    cachedCatalogIncludesDeclarations &&
    Array.isArray(cachedCatalog.data) &&
    cachedCatalog.data.length > 0
  ) {
    return cachedCatalog
  }
  if (cachedCatalog && !cachedCatalogIncludesDeclarations) {
    packagePipelineSyncCache.delete(cacheKey)
  }

  const inFlightCacheKey = `${cacheKey}-tracking-in-flight`
  const pendingCatalog = getCachedValue(packagePipelineSyncCache, inFlightCacheKey)
  if (pendingCatalog) {
    return pendingCatalog
  }

  reloadLocalEnv()

  const trackingApiDefaults = getTrackingApiDefaults()
  const trackingUrl = new URL('/api/tracking/paquetes', trackingApiDefaults.baseUrl)
  let declarationWarning = null

  const catalogPromise = fetchAllPaginatedItems({
    url: trackingUrl,
    headers: {
      Authorization: `Bearer ${trackingApiDefaults.token}`,
      Accept: 'application/json',
    },
    perPage: 200,
    maxPages: 5000,
    trustReportedTotal: false,
    throwOnFirstPageError: true,
    throwOnAnyPageError: true,
    minimumPageIntervalMs: 2500,
    maxRateLimitRetries: 6,
    onPage: async (pageItems) => {
      declarationWarning ??= await enrichTrackingPackagesWithCds(pageItems)
      await persistInternationalTrackingCatalog(pageItems)
    },
  })
    .then(async (items) => {
      if (items.length === 0) {
        throw new Error('La API SITRA respondio sin paquetes; se conserva el catalogo anterior.')
      }
      return setCachedValue(
        packagePipelineSyncCache,
        cacheKey,
        {
          data: items,
          total: items.length,
          cachedAt: new Date().toISOString(),
          ...(declarationWarning ? { warning: declarationWarning } : {}),
        },
        CONTACT_PACKAGES_CATALOG_TTL_MS,
      )
    })
    .finally(() => {
      packagePipelineSyncCache.delete(inFlightCacheKey)
    })

  packagePipelineSyncCache.set(inFlightCacheKey, {
    value: catalogPromise,
    expiresAt: Number.POSITIVE_INFINITY,
  })
  return catalogPromise
}

let internationalPipelineSeedPromise = null

const seedInternationalPipelineCatalog = async () => {
  if (internationalPipelineSeedPromise) return internationalPipelineSeedPromise

  reloadLocalEnv()
  const trackingApiDefaults = getTrackingApiDefaults()
  const trackingUrl = new URL('/api/tracking/paquetes', trackingApiDefaults.baseUrl)

  internationalPipelineSeedPromise = fetchAllPaginatedItems({
    url: trackingUrl,
    headers: {
      Authorization: `Bearer ${trackingApiDefaults.token}`,
      Accept: 'application/json',
    },
    perPage: 100,
    maxPages: 5000,
    trustReportedTotal: false,
    throwOnFirstPageError: true,
    onPage: async (pageItems) => {
      await enrichTrackingPackagesWithCds(pageItems)
      await persistInternationalTrackingCatalog(pageItems)
    },
  }).finally(() => {
    internationalPipelineSeedPromise = null
  })

  return internationalPipelineSeedPromise
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
  if (normalizedStatus.includes('destino') || normalizedStatus.includes('regional') || normalizedStatus.includes('ventanilla')) return 'regional'
  if (
    normalizedStatus.includes('camino') ||
    normalizedStatus.includes('transito') ||
    normalizedStatus.includes('trÃ¡nsito') ||
    normalizedStatus.includes('seguimiento')
  ) {
    return 'transit'
  }
  return 'received'
}

const getEmsPackageCodeFromContact = (contact) => {
  const profiles = Array.isArray(contact?.social_profiles) ? contact.social_profiles : []
  const emsProfileReferences = profiles
    .filter((profile) => normalizeReference(profile?.channel).toLowerCase().includes('ems'))
    .map((profile) => normalizePackageCodeForLookup(profile?.reference))
    .filter(isValidEmsPackageCode)
  if (emsProfileReferences[0]) return emsProfileReferences[0]

  return extractPackageCodeCandidates(
    [
      contact?.name,
      contact?.company,
      contact?.segment,
      JSON.stringify(contact?.social_profiles ?? []),
    ].join(' '),
  ).find(isValidEmsPackageCode) || ''
}

const isValidEmsPackageCode = (value) => {
  const code = normalizePackageCodeForLookup(value)
  return /^[A-Z]{1,8}\d{3,}[A-Z]{2,5}$/.test(code)
}

const getWhatsAppPhonesFromStoredContact = (contact, configuredNumbers = []) => {
  const configuredCandidates = configuredNumbers.flatMap((number) => getWhatsAppNumberCandidates(number))
  const phones = (Array.isArray(contact?.social_profiles) ? contact.social_profiles : [])
    .filter((profile) => normalizeReference(profile?.channel).toLowerCase().includes('whatsapp'))
    .map((profile) => normalizeBoliviaTestNumber(profile?.reference))
    .filter(Boolean)
  return [...new Set(phones.filter((phone) =>
    getWhatsAppNumberCandidates(phone).some((candidate) => configuredCandidates.includes(candidate)),
  ))]
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
    const stage = overrideMap[code] ?? inferContactPackageStage(item)
    const senderName =
      normalizeReference(item?.remitente?.nombre) || normalizeReference(item?.origen?.nombre) || 'Sin remitente'
    const recipientName =
      normalizeReference(item?.destinatario?.nombre) || normalizeReference(item?.destino?.nombre) || 'Sin destinatario'
    const currentLocation =
      getPackageEventLocation(registeredLatestEvent) ||
      normalizeReference(item?.ubicacion || item?.oficina || item?.regional || item?.departamento)

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
      currentLocation,
      department: getBolivianDepartmentKey(currentLocation),
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
    const currentLocation = eventLocation || normalizeReference(contact?.company) || ''
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
      currentLocation,
      department: getBolivianDepartmentKey(currentLocation),
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

const getTestModePackageCodes = async (config) => {
  const testModeEnabled = normalizeBoolean(config?.testModeEnabled, whatsappDefaults.testModeEnabled)
  if (!testModeEnabled) return []

  const result = await pool.query(
    `
      select id, name, company, social_profiles, segment
      from contacts
      where segment ilike '%Paquetes-contactos API%'
         or exists (
           select 1
           from jsonb_array_elements(coalesce(social_profiles, '[]'::jsonb)) as profile
           where lower(coalesce(profile->>'channel', '')) like '%ems%'
         );
    `,
  )

  const configuredNumbers = getConfiguredWhatsAppTestNumbers(config)
  const configuredCandidates = configuredNumbers.flatMap((number) => getWhatsAppNumberCandidates(number))

  return [...new Set(
    result.rows
      .filter((row) => {
        const profiles = Array.isArray(row?.social_profiles) ? row.social_profiles : []
        const profilePhones = profiles
          .filter((profile) => normalizeReference(profile?.channel).toLowerCase().includes('whatsapp'))
          .map((profile) => normalizeBoliviaTestNumber(profile?.reference))
          .filter(Boolean)
        return profilePhones.some((phone) =>
          getWhatsAppNumberCandidates(phone).some((candidate) => configuredCandidates.includes(candidate)),
        )
      })
      .map((row) => getEmsPackageCodeFromContact(row))
      .map(normalizePackageCodeForLookup)
      .filter(isValidEmsPackageCode),
  )]
}

const fetchTestModePackageItemsByPhone = async ({ url, headers, queryParam, phone, source }) => {
  const queryParams = [...new Set([
    queryParam,
    'telefono',
    'phone',
    'numero_telefono',
    'numeroTelefono',
    'numero',
    'celular',
    'whatsapp',
    'destinatario_telefono',
    'remitente_telefono',
  ])]
  const matchedItems = []

  for (const currentQueryParam of queryParams) {
    const lookupUrl = new URL(url.toString())
    lookupUrl.searchParams.set(currentQueryParam, phone)
    lookupUrl.searchParams.set('page', '1')
    lookupUrl.searchParams.set('per_page', '200')
    const response = await fetchJsonWithTimeout(lookupUrl, { headers }).catch(() => null)
    if (!response?.ok) continue

    const payload = await response.json().catch(() => null)
    for (const item of getPaginatedPayloadItems(payload)) {
      const itemPhones = source === 'tracking'
        ? extractTrackingApiPhoneCandidates(item)
        : extractContactPackagesPhoneCandidates(item)
      if (
        itemPhones.some((candidate) =>
          getWhatsAppNumberCandidates(candidate).includes(phone),
        ) &&
        !matchedItems.some((existingItem) => getPackageCodeFromItem(existingItem) === getPackageCodeFromItem(item))
      ) {
        matchedItems.push(item)
      }
    }
  }

  return matchedItems
}

const fetchLatestTestModePackageItems = async ({ url, headers, source, configuredNumbers }) => {
  const maxPages = Math.max(
    1,
    Math.min(Number.parseInt(process.env.WHATSAPP_TEST_MODE_LATEST_PACKAGE_PAGES || '3', 10) || 3, 20),
  )
  const queryAttempts = [
    { ordering: '-fecha_registro' },
    { sort: '-fecha_registro' },
    {},
  ]
  const matchedItems = []

  for (const query of queryAttempts) {
    for (let page = 1; page <= maxPages; page += 1) {
      const lookupUrl = new URL(url.toString())
      lookupUrl.searchParams.set('page', String(page))
      lookupUrl.searchParams.set('per_page', '200')
      Object.entries(query).forEach(([key, value]) => lookupUrl.searchParams.set(key, value))
      const response = await fetchJsonWithTimeout(lookupUrl, { headers }).catch(() => null)
      if (!response?.ok) break

      const payload = await response.json().catch(() => null)
      const pageItems = getPaginatedPayloadItems(payload)
      for (const item of pageItems) {
        const itemPhones = source === 'tracking'
          ? extractTrackingApiPhoneCandidates(item)
          : extractContactPackagesPhoneCandidates(item)
        const belongsToTestNumber = itemPhones.some((itemPhone) =>
          configuredNumbers.some(
            (number) => normalizeBoliviaTestNumber(itemPhone) === normalizeBoliviaTestNumber(number),
          ),
        )
        const code = getPackageCodeFromItem(item)
        if (
          code &&
          !matchedItems.some((existingItem) => getPackageCodeFromItem(existingItem) === code)
        ) {
          matchedItems.push({ ...item, __testModeDiscoveredBy: belongsToTestNumber ? 'phone' : 'recent' })
        }
      }

      if (pageItems.length === 0 || pageItems.length < 200) break
    }
  }

  return matchedItems.sort((first, second) => {
    const firstDate = getPackageContextDateValue(
      first?.fecha_registro || first?.created_at || first?.fechaCreacion,
    )
    const secondDate = getPackageContextDateValue(
      second?.fecha_registro || second?.created_at || second?.fechaCreacion,
    )
    return secondDate - firstDate
  })
}

const buildContactPackageSyncEntry = ({ item, latestEventsByCode = new Map() }) => {
  const code = getPackageCodeFromItem(item)
  if (!code) return null

  const registeredLatestEvent = latestEventsByCode.get(normalizePackageCodeForLookup(code))
  const itemEvents = Array.isArray(item?.eventos) ? item.eventos.filter(Boolean) : []
  const latestContactEvent = [registeredLatestEvent, ...itemEvents]
    .filter(Boolean)
    .sort((firstEvent, secondEvent) => getPackageEventTimestampValue(secondEvent) - getPackageEventTimestampValue(firstEvent))[0] ?? null
  const stage = inferContactPackageStage({
    ...item,
    eventos: [registeredLatestEvent, ...itemEvents]
      .filter(Boolean)
      .sort((firstEvent, secondEvent) => getPackageEventTimestampValue(firstEvent) - getPackageEventTimestampValue(secondEvent)),
  })
  const transferCode = getContactPackageTransferCode(item)
  const transferDate = getContactPackageTransferDate(item)
  const latestContactEventSignature = getPackageEventSignature(latestContactEvent)
  const latestContactEventDate =
    normalizeReference(latestContactEvent?.fecha_registro) ||
    normalizeReference(latestContactEvent?.fecha)
  const statusName = normalizeReference(item?.estado?.nombre)
  const isVentanillaStatus = isVentanillaText(statusName)

  return {
    code,
    source: 'contact',
    stage,
    updatedAt:
      getPackageContextDateValue(registeredLatestEvent?.fecha_registro) ||
      getPackageContextDateValue(registeredLatestEvent?.fecha) ||
      getPackageContextDateValue(latestContactEventDate) ||
      getPackageContextDateValue(item?.fecha_registro) ||
      0,
    latestEventTimestamp: getPackageEventTimestampValue(latestContactEvent),
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
    latestEventLabel: isVentanillaStatus
      ? 'Ventanilla - correspondencia pendiente de recojo'
      : stage === 'transit' && hasContactPackageTransfer(item) && !latestContactEventSignature
        ? 'Paquete en transito'
        : getPackageEventLabel(latestContactEvent) || statusName || 'Paquete registrado',
    latestEventLocation:
      getPackageEventLocation(latestContactEvent) ||
      (stage === 'regional'
        ? getPackageDepartmentLabel(item?.destino) || getPackageLocationLabel(item?.destino, '')
        : getPackageLocationLabel(item?.origen, '')),
    latestEventDate:
      latestContactEventDate ||
      transferDate ||
      normalizeReference(item?.fecha_registro),
    latestEventSignature: [
      stage,
      isVentanillaStatus ? 'VENTANILLA' : '',
      latestContactEventSignature || (stage === 'transit' ? 'TRASPASO' : ''),
      latestContactEventSignature ? '' : transferCode,
      latestContactEventSignature ? '' : transferDate,
      statusName || 'Paquete registrado',
      normalizeReference(item?.fecha_registro),
    ]
      .map((value) => normalizeReference(value).toUpperCase())
      .filter(Boolean)
      .join('|'),
    sources: ['Paquetes-Contactos'],
    phoneCandidates: getPackageSyncPhoneCandidates(item, 'contact'),
    phoneNames: getPackageSyncPhoneNames(item, 'contact'),
  }
}

const buildTrackingPackageSyncEntry = ({ item, latestEventsByCode = new Map() }) => {
  const code = getPackageCodeFromItem(item)
  if (!code) return null

  const registeredLatestEvent = latestEventsByCode.get(normalizePackageCodeForLookup(code))
  const latestEvent = registeredLatestEvent ?? getTrackingLatestEvent(item)
  const internationalArrivalEvent = getInternationalArrivalEventFromItem(item, registeredLatestEvent)
  const stage = inferTrackingPackageStage({
    ...item,
    eventos: registeredLatestEvent
      ? [registeredLatestEvent, ...(Array.isArray(item?.eventos) ? item.eventos : [])]
      : item?.eventos,
  })
  const allPhoneCandidates = getPackageSyncPhoneCandidates(item, 'tracking')
  const welcomePhoneCandidates = getTrackingPackageRecipientPhoneCandidates(item)

  return {
    code,
    source: 'tracking',
    stage,
    updatedAt:
      getPackageContextDateValue(item?.fecha_registro || item?.created_at || item?.fechaCreacion) ||
      getPackageContextDateValue(latestEvent?.fecha_registro) ||
      getPackageContextDateValue(latestEvent?.fecha) ||
      0,
    latestEventTimestamp: getPackageEventTimestampValue(latestEvent),
    originLabel: getPackageLocationLabel(item?.origen, 'Sin origen'),
    destinationLabel: getTrackingDestinationPlace(item),
    destinationAddress: getTrackingDestinationAddress(item),
    recipientName:
      normalizeReference(item?.destinatario?.nombre) ||
      normalizeReference(item?.remitente?.nombre) ||
      '',
    senderName: normalizeReference(item?.remitente?.nombre) || '',
    primaryPhone: welcomePhoneCandidates[0] || allPhoneCandidates[0] || '',
    welcomePhoneCandidates,
    latestEventLabel: getPackageEventLabel(latestEvent),
    latestEventLocation: getPackageEventLocation(latestEvent),
    latestEventDate: normalizeReference(latestEvent?.fecha),
    latestEventSignature: getPackageEventSignature(latestEvent),
    internationalArrivalEventLabel: getPackageEventLabel(internationalArrivalEvent),
    internationalArrivalEventLocation: getPackageEventLocation(internationalArrivalEvent),
    internationalArrivalEventDate: normalizeReference(internationalArrivalEvent?.fecha),
    internationalArrivalEventSignature: getPackageEventSignature(internationalArrivalEvent),
    sources: ['Tracking'],
    phoneCandidates: allPhoneCandidates,
    phoneNames: getPackageSyncPhoneNames(item, 'tracking'),
  }
}

const syncPackagePipelineFromApis = async ({ reconciliation = false } = {}) => {
  await ensureDatabaseReady()
  reloadLocalEnv()

  const whatsappConfig = await getStoredWhatsAppConfig()
  const configuredTestNumbers = getConfiguredWhatsAppTestNumbers(whatsappConfig)
  const testModeCodes = await getTestModePackageCodes(whatsappConfig)
  const testModeEnabled =
    normalizeBoolean(whatsappConfig.testModeEnabled, whatsappDefaults.testModeEnabled) &&
    WHATSAPP_PACKAGE_WATCHER_TEST_MODE_RESTRICTED

  let trackingItems = []
  let contactPackageCatalog = []
  let latestEventsByCode = new Map()
  const packageEventSourceFailures = []
  const testModePackagePhones = new Map()
  let trackingItemsCount = 0
  let contactPackageCatalogCount = 0
  const packageEntriesByCode = new Map()
  const registerEntry = (entry) => {
    if (!entry?.code) return

    const existing = packageEntriesByCode.get(entry.code)
    if (!existing) {
      packageEntriesByCode.set(entry.code, {
        ...entry,
        sources: new Set(entry.sources ?? []),
        phoneCandidates: new Set(entry.phoneCandidates ?? []),
        phoneNames: new Map(entry.phoneNames ?? []),
      })
      return
    }

    existing.sources = new Set([...(existing.sources ?? []), ...(entry.sources ?? [])])
    existing.phoneCandidates = new Set([...(existing.phoneCandidates ?? []), ...(entry.phoneCandidates ?? [])])
    existing.phoneNames = new Map([...(existing.phoneNames ?? []), ...(entry.phoneNames ?? [])])
    if (!normalizeReference(existing.internationalArrivalEventSignature) &&
      normalizeReference(entry.internationalArrivalEventSignature)) {
      existing.internationalArrivalEventLabel = entry.internationalArrivalEventLabel
      existing.internationalArrivalEventLocation = entry.internationalArrivalEventLocation
      existing.internationalArrivalEventDate = entry.internationalArrivalEventDate
      existing.internationalArrivalEventSignature = entry.internationalArrivalEventSignature
    }

    const entryEventTimestamp = Number(entry.latestEventTimestamp) || 0
    const existingEventTimestamp = Number(existing.latestEventTimestamp) || 0
    const hasComparableEventTimestamps = entryEventTimestamp > 0 || existingEventTimestamp > 0
    const shouldReplace = hasComparableEventTimestamps
      ? entryEventTimestamp > existingEventTimestamp ||
        (entryEventTimestamp === existingEventTimestamp &&
          getPackageSyncEntrySpecificity(entry) > getPackageSyncEntrySpecificity(existing))
      : entry.updatedAt > existing.updatedAt ||
        (entry.updatedAt === existing.updatedAt &&
          getPackageSyncEntrySpecificity(entry) > getPackageSyncEntrySpecificity(existing))

    if (shouldReplace) {
      packageEntriesByCode.set(entry.code, {
        ...existing,
        ...entry,
        internationalArrivalEventLabel:
          entry.internationalArrivalEventLabel ?? existing.internationalArrivalEventLabel,
        internationalArrivalEventLocation:
          entry.internationalArrivalEventLocation ?? existing.internationalArrivalEventLocation,
        internationalArrivalEventDate:
          entry.internationalArrivalEventDate ?? existing.internationalArrivalEventDate,
        internationalArrivalEventSignature:
          entry.internationalArrivalEventSignature ?? existing.internationalArrivalEventSignature,
        sources: existing.sources,
        phoneCandidates: existing.phoneCandidates,
        phoneNames: existing.phoneNames,
      })
    }
  }

  if (testModeEnabled) {
    const trackingApiDefaults = getTrackingApiDefaults()
    const trackingUrl = new URL('/api/tracking/paquetes', trackingApiDefaults.baseUrl)
    const contactPackagesApiDefaults = getContactPackagesApiDefaults()
    const contactUrl = new URL(contactPackagesApiDefaults.endpoint)
    const trackingHeaders = {
      Authorization: `Bearer ${trackingApiDefaults.token}`,
      Accept: 'application/json',
    }
    const contactHeaders = {
      Authorization: `Bearer ${contactPackagesApiDefaults.token}`,
      Accept: 'application/json',
    }

    const phonePackageResults = await Promise.all(configuredTestNumbers.flatMap((number) =>
      getWhatsAppNumberCandidates(number).map(async (phone) => ({
        phone,
        trackingItems: await fetchTestModePackageItemsByPhone({
          url: trackingUrl,
          headers: trackingHeaders,
          queryParam: 'telefono',
          phone,
          source: 'tracking',
        }),
        contactItems: await fetchTestModePackageItemsByPhone({
          url: contactUrl,
          headers: contactHeaders,
          queryParam: 'telefono',
          phone,
          source: 'contact',
        }),
      })),
    ))
    const latestPackageResults = await Promise.all([
      fetchLatestTestModePackageItems({
        url: trackingUrl,
        headers: trackingHeaders,
        source: 'tracking',
        configuredNumbers: configuredTestNumbers,
      }),
      fetchLatestTestModePackageItems({
        url: contactUrl,
        headers: contactHeaders,
        source: 'contact',
        configuredNumbers: configuredTestNumbers,
      }),
    ])
    const packageResultsBySource = latestPackageResults
    const latestDiscoveredCodes = [...new Set(packageResultsBySource
      .flatMap((items) => items.map(getPackageCodeFromItem))
      .filter(Boolean))]
    console.log(
      `Modo prueba: paquetes recientes asociados detectados: ${latestDiscoveredCodes.slice(0, 20).join(', ') || 'ninguno'}.`,
    )
    phonePackageResults.push({
      phone: '',
      trackingItems: packageResultsBySource[0],
      contactItems: packageResultsBySource[1],
    })
    const discoveredPackageCodes = phonePackageResults.flatMap((result) => [
      ...result.trackingItems,
      ...result.contactItems,
    ]).map(getPackageCodeFromItem).filter(Boolean)
    for (const result of phonePackageResults) {
      for (const item of [...result.trackingItems, ...result.contactItems]) {
        const code = getPackageCodeFromItem(item)
        if (!code || !result.phone) continue
        const phones = testModePackagePhones.get(code) ?? new Set()
        phones.add(result.phone)
        testModePackagePhones.set(code, phones)
      }
    }
    const allTestModeCodes = [...new Set([...testModeCodes, ...discoveredPackageCodes])]

    const packageResults = await Promise.all(allTestModeCodes.map(async (code) => {
      const [trackingResult, contactResult, eventsResult] = await Promise.all([
        fetchExactPackageCodeMatches({ url: trackingUrl, headers: trackingHeaders, queryParam: 'q', code }),
        fetchExactPackageCodeMatches({ url: contactUrl, headers: contactHeaders, queryParam: 'codigo', code }),
        fetchPackageEventsForCode(code).catch(() => null),
      ])
      return {
        code,
        trackingItems: trackingResult.items,
        contactItems: contactResult.items,
        events: Array.isArray(eventsResult?.data) ? eventsResult.data : [],
      }
    }))

    trackingItems = packageResults.flatMap((result) => result.trackingItems)
    contactPackageCatalog = packageResults.flatMap((result) => result.contactItems)
    for (const result of packageResults) {
      const associatedPhones = testModePackagePhones.get(result.code) ?? new Set()
      for (const item of [...result.trackingItems, ...result.contactItems]) {
        const itemPhones = [
          ...extractTrackingApiPhoneCandidates(item),
          ...extractContactPackagesPhoneCandidates(item),
        ]
        for (const itemPhone of itemPhones) {
          const itemCandidates = getWhatsAppNumberCandidates(itemPhone)
          const matchingConfiguredPhones = configuredTestNumbers.filter((number) =>
            getWhatsAppNumberCandidates(number).some((candidate) => itemCandidates.includes(candidate)),
          )
          matchingConfiguredPhones.forEach((number) => {
            const normalizedNumber = normalizeBoliviaTestNumber(number)
            if (normalizedNumber) associatedPhones.add(normalizedNumber)
          })
        }
      }
      if (associatedPhones.size > 0) {
        testModePackagePhones.set(result.code, associatedPhones)
      }
    }
    latestEventsByCode = buildLatestPackageEventsByCode(
      packageResults.flatMap((result) => result.events),
    )
    console.log(
      `Modo prueba: sincronizando ${allTestModeCodes.length} paquete(s) asociado(s) a los nÃºmeros de prueba.`,
    )
    for (const number of configuredTestNumbers) {
      const matchingCodes = [...new Set(phonePackageResults
        .flatMap((result) => [...result.trackingItems, ...result.contactItems])
        .filter((item) =>
          [...extractTrackingApiPhoneCandidates(item), ...extractContactPackagesPhoneCandidates(item)]
          .some((phone) => normalizeBoliviaTestNumber(phone) === normalizeBoliviaTestNumber(number)),
        )
        .map(getPackageCodeFromItem)
        .filter(Boolean))]
      console.log(
        `Modo prueba: ${number} tiene ${matchingCodes.length} paquete(s) descubierto(s) por telÃ©fono: ${matchingCodes.join(', ') || 'ninguno'}.`,
      )
    }
  } else {
    const events = await fetchAllPackageEventsCatalog({
      forceRefresh: true,
      cacheResult: false,
      retainResults: false,
      onPage: (pageItems) => addLatestPackageEventsToCodeMap(latestEventsByCode, pageItems),
    }).catch(() => {
      packageEventSourceFailures.push('eventos-api-no-disponible')
      return null
    })
    if (events?.skipped) packageEventSourceFailures.push('eventos-api-no-configurada')

    const trackingApiDefaults = getTrackingApiDefaults()
    const trackingUrl = new URL('/api/tracking/paquetes', trackingApiDefaults.baseUrl)
    const trackingHeaders = {
      Authorization: `Bearer ${trackingApiDefaults.token}`,
      Accept: 'application/json',
    }
    await fetchAllPaginatedItems({
      url: trackingUrl,
      headers: trackingHeaders,
      perPage: 200,
      maxPages: 5000,
      trustReportedTotal: false,
      throwOnFirstPageError: true,
      throwOnAnyPageError: true,
      minimumPageIntervalMs: 2500,
      maxRateLimitRetries: 6,
      retainItems: false,
      onPage: async (pageItems) => {
        trackingItemsCount += pageItems.length
        await persistInternationalTrackingCatalog(pageItems)
        for (const item of pageItems) {
          registerEntry(buildTrackingPackageSyncEntry({ item, latestEventsByCode }))
        }
      },
    })

    const contactPackagesApiDefaults = getContactPackagesApiDefaults()
    const contactPackagesUrl = new URL(contactPackagesApiDefaults.endpoint)
    const contactPackagesTimeoutMs = Number.parseInt(
      process.env.CONTACT_PACKAGES_CATALOG_TIMEOUT_MS || '30000',
      10,
    )
    await fetchAllPaginatedItems({
      url: contactPackagesUrl,
      headers: {
        Authorization: `Bearer ${contactPackagesApiDefaults.token}`,
        Accept: 'application/json',
      },
      perPage: 200,
      maxPages: 2000,
      timeoutMs: contactPackagesTimeoutMs,
      retainItems: false,
      onPage: (pageItems) => {
        contactPackageCatalogCount += pageItems.length
        for (const item of pageItems) {
          registerEntry(buildContactPackageSyncEntry({ item, latestEventsByCode }))
        }
      },
    })
  }

  if (testModeEnabled) {
    trackingItemsCount = trackingItems.length
    contactPackageCatalogCount = contactPackageCatalog.length
    trackingItems.forEach((item) => {
      registerEntry(buildTrackingPackageSyncEntry({ item, latestEventsByCode }))
    })
    contactPackageCatalog.forEach((item) => {
      registerEntry(buildContactPackageSyncEntry({ item, latestEventsByCode }))
    })
  }

  if (testModeEnabled) {
    for (const [code, entry] of packageEntriesByCode) {
      const associatedPhones = [...(testModePackagePhones.get(code) ?? [])]
      if (associatedPhones.length > 0) {
        entry.testModeTargetPhones = associatedPhones
      }
    }

    for (const code of testModeCodes) {
      if (packageEntriesByCode.has(code)) continue

      const contact = await findPackageContactByCode(code)
      if (!contact) {
        console.warn(`[${code}] No existe contacto CRM ni registro completo en las APIs.`)
        continue
      }

      const latestEvent = latestEventsByCode.get(code)
      const stage =
        getPackageStageFromEvents({ eventos: latestEvent ? [latestEvent] : [] }) ||
        getEmsStageFromContactStatus(contact.status)
      const eventLabel = getPackageEventLabel(latestEvent) || normalizeReference(contact.status) || 'Paquete registrado'
      const eventLocation = getPackageEventLocation(latestEvent) || cleanPackagePlaceLabel(contact.company)
      const eventDate =
        normalizeReference(latestEvent?.fecha_registro) ||
        normalizeReference(latestEvent?.fecha) ||
        (contact.updated_at ? new Date(contact.updated_at).toISOString() : '')
      const eventSignature =
        getPackageEventSignature(latestEvent) ||
        [stage, code, eventLabel, eventLocation, eventDate]
          .map((value) => normalizeReference(value).toUpperCase())
          .filter(Boolean)
          .join('|')
      const targetPhones = [
        ...(testModePackagePhones.get(code) ?? []),
        ...getWhatsAppPhonesFromStoredContact(contact, configuredTestNumbers),
      ].filter((phone, index, phones) => phones.indexOf(phone) === index)

      registerEntry({
        code,
        source: 'contact',
        stage,
        updatedAt: getPackageContextDateValue(eventDate),
        originLabel: 'origen',
        destinationLabel: cleanPackagePlaceLabel(contact.company, 'destino'),
        destinationAddress: '',
        recipientName: normalizeReference(contact.name),
        senderName: '',
        primaryPhone: targetPhones[0] || '',
        latestEventLabel: eventLabel,
        latestEventLocation: eventLocation,
        latestEventDate: eventDate,
        latestEventSignature: eventSignature,
        phoneCandidates: targetPhones,
        phoneNames: new Map(targetPhones.map((number) => [
          normalizeBoliviaTestNumber(number),
          normalizeReference(contact.name),
        ])),
        testModeTargetPhones: targetPhones,
        sources: ['CRM modo prueba'],
      })
      console.log(`[${code}] Se usarÃ¡ el contacto CRM como respaldo para notificar.`)
    }

    for (const [code, entry] of packageEntriesByCode) {
      if (!testModeCodes.includes(code)) continue
      entry.testModeTargetPhones = [...(testModePackagePhones.get(code) ?? [])]
    }
  }

  const client = await pool.connect()
  const syncedAt = new Date().toISOString()
  let createdCount = 0
  let updatedCount = 0
  const syncedEntries = []

  try {
    await client.query('begin')

    for (const entry of packageEntriesByCode.values()) {
      const nextResult = await upsertPackageContact(client, entry)
      if (nextResult?.action === 'created') {
        createdCount += 1
      } else if (nextResult?.action === 'updated') {
        updatedCount += 1
      }
      if (nextResult?.id) {
        entry.contactId = nextResult.id
        entry.action = nextResult.action
        syncedEntries.push(entry)
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
      total: packageEntriesByCode.size,
      packageCountsBySource: {
        tracking: trackingItemsCount,
        contact: contactPackageCatalogCount,
      },
      packageEventSourceFailures,
      createdCount,
      updatedCount,
      syncedAt,
    },
  }).catch(() => {})

  const welcomeIntervalMs = Number.isFinite(PACKAGE_NEW_PACKAGE_WELCOME_INTERVAL_MS)
    ? Math.max(PACKAGE_NEW_PACKAGE_WELCOME_INTERVAL_MS, 60000)
    : 600000
  const shouldCheckNewPackageWelcome =
    reconciliation ||
    lastNewPackageWelcomeCheckAt === 0 ||
    Date.now() - lastNewPackageWelcomeCheckAt >= welcomeIntervalMs ||
    syncedEntries.some((entry) => entry?.action === 'created' && entry?.source === 'contact')
  let newPackageWelcomeResult = {
    sent: 0,
    skipped: syncedEntries.length,
    reason: 'new-package-welcome-check-not-due',
  }

  if (shouldCheckNewPackageWelcome) {
    lastNewPackageWelcomeCheckAt = Date.now()
    newPackageWelcomeResult = await notifyNewPackageContacts(syncedEntries).catch(async (error) => {
      await writeSystemLog({
        level: 'error',
        event: 'whatsapp_new_package_welcome_failed',
        statusCode: 500,
        details: {
          error: error instanceof Error ? error.message : 'Error desconocido.',
        },
      }).catch(() => {})
      return {
        sent: 0,
        skipped: syncedEntries.length,
        error: error instanceof Error ? error.message : 'Error desconocido.',
      }
    })
  }

  const eventNotificationResult = await notifyPackageEventChanges(syncedEntries, {
    requireWelcome: false,
    eventType: 'general',
  }).catch(async (error) => {
    await writeSystemLog({
      level: 'error',
      event: 'package_event_change_notification_failed',
      statusCode: 500,
      details: {
        error: error instanceof Error ? error.message : 'Error desconocido.',
      },
    }).catch(() => {})
    return {
      sent: 0,
      skipped: syncedEntries.length,
      error: error instanceof Error ? error.message : 'Error desconocido.',
    }
  })

  const internationalArrivalNotificationResult = await notifyPackageEventChanges(syncedEntries, {
    requireWelcome: false,
    eventType: 'international-arrival-test',
  }).catch(async (error) => {
    await writeSystemLog({
      level: 'error',
      event: 'whatsapp_international_arrival_test_notification_failed',
      statusCode: 500,
      details: {
        error: error instanceof Error ? error.message : 'Error desconocido.',
      },
    }).catch(() => {})
    return {
      sent: 0,
      skipped: syncedEntries.length,
      error: error instanceof Error ? error.message : 'Error desconocido.',
    }
  })

  const ventanillaNotificationResult = await notifyPackageEventChanges(syncedEntries, {
    requireWelcome: false,
    eventType: 'ventanilla',
  }).catch(async (error) => {
    await writeSystemLog({
      level: 'error',
      event: 'package_ventanilla_notification_failed',
      statusCode: 500,
      details: {
        error: error instanceof Error ? error.message : 'Error desconocido.',
      },
    }).catch(() => {})
    return {
      sent: 0,
      skipped: syncedEntries.length,
      error: error instanceof Error ? error.message : 'Error desconocido.',
    }
  })

  console.log(
    `Notificaciones de eventos: ${eventNotificationResult.sent} enviado(s), ${eventNotificationResult.skipped} omitido(s).`,
  )
  console.log(
    `Avisos de llegada internacional al numero de prueba: ${internationalArrivalNotificationResult.sent} enviado(s), ${internationalArrivalNotificationResult.skipped} omitido(s).`,
  )
  console.log(
    `Notificaciones de ventanilla: ${ventanillaNotificationResult.sent} enviado(s), ${ventanillaNotificationResult.skipped} omitido(s).`,
  )

  return {
    syncedAt,
    createdCount,
    updatedCount,
    total: packageEntriesByCode.size,
    packageCountsBySource: {
      tracking: trackingItemsCount,
      contact: contactPackageCatalogCount,
    },
    packageSourceFailures: packageEventSourceFailures,
    newPackageWelcome: newPackageWelcomeResult,
    eventNotifications: eventNotificationResult,
    internationalArrivalNotifications: internationalArrivalNotificationResult,
    ventanillaNotifications: ventanillaNotificationResult,
  }
}

const syncRecentPackageAutomations = async ({
  sendWelcome = true,
  sendEvents = true,
  sendVentanillaEvents = true,
} = {}) => {
  await ensureDatabaseReady()

  const automationConfig = await getStoredAutomationConfig()
  const shouldSendWelcome = sendWelcome && automationConfig.automaticWelcome
  const shouldSendEvents = sendEvents && automationConfig.automaticStatusUpdates
  const shouldSendInternationalArrivalNotifications =
    sendEvents && automationConfig.automaticInternationalArrivalTestNotifications
  const shouldSendVentanillaEvents =
    sendVentanillaEvents && automationConfig.automaticVentanillaNotifications

  if (
    !shouldSendWelcome &&
    !shouldSendEvents &&
    !shouldSendInternationalArrivalNotifications &&
    !shouldSendVentanillaEvents
  ) {
    return {
      syncedAt: new Date().toISOString(),
      total: 0,
      createdCount: 0,
      newPackageWelcome: { sent: 0, skipped: 0, reason: 'new-package-welcome-disabled' },
      eventNotifications: { sent: 0, skipped: 0, reason: 'automatic-status-updates-disabled' },
      internationalArrivalNotifications: {
        sent: 0,
        skipped: 0,
        reason: 'international-arrival-test-notifications-disabled',
      },
      ventanillaNotifications: { sent: 0, skipped: 0, reason: 'automatic-ventanilla-notifications-disabled' },
    }
  }

  let recentContactItems = []
  let recentTrackingItems = []
  const packageSourceFailures = []
  if (shouldSendWelcome || shouldSendInternationalArrivalNotifications) {
    const contactResult = shouldSendWelcome
      ? fetchRecentContactPackagesCatalog()
      : Promise.resolve([])
    const [contactLookup, trackingLookup] = await Promise.allSettled([
      contactResult,
      fetchRecentTrackingPackagesCatalog(),
    ])
    if (contactLookup.status === 'fulfilled') {
      recentContactItems = contactLookup.value
    } else {
      packageSourceFailures.push('paquetes-contactos')
      console.warn(
        `Watcher WhatsApp: no se pudo consultar Paquetes-Contactos: ${contactLookup.reason instanceof Error ? contactLookup.reason.message : 'Error desconocido.'}`,
      )
    }
    if (trackingLookup.status === 'fulfilled') {
      recentTrackingItems = trackingLookup.value
    } else {
      packageSourceFailures.push('tracking')
      console.warn(
        `Watcher WhatsApp: no se pudo consultar Tracking: ${trackingLookup.reason instanceof Error ? trackingLookup.reason.message : 'Error desconocido.'}`,
      )
    }
    if (contactLookup.status === 'rejected' && trackingLookup.status === 'rejected') {
      throw new Error('No se pudieron consultar las fuentes de paquetes recientes.')
    }
  }
  const packageCountsBySource = {
    contact: recentContactItems.length,
    tracking: recentTrackingItems.length,
  }
  const recentEvents =
    shouldSendEvents || shouldSendInternationalArrivalNotifications || shouldSendVentanillaEvents
    ? await fetchRecentPackageEventsCatalog()
    : []
  const latestEventsByCode = buildLatestPackageEventsByCode(recentEvents)

  let eventPackageItems = []
  let arrivalTrackingItems = []
  if (latestEventsByCode.size > 0) {
    const contactPackagesApiDefaults = getContactPackagesApiDefaults()
    const contactUrl = new URL(contactPackagesApiDefaults.endpoint)
    const contactHeaders = {
      Authorization: `Bearer ${contactPackagesApiDefaults.token}`,
      Accept: 'application/json',
    }
    const eventCodes = [...latestEventsByCode.keys()]
    const eventPackageResults = await Promise.all(
      eventCodes.map((code) =>
        fetchExactPackageCodeMatches({
          url: contactUrl,
          headers: contactHeaders,
          queryParam: 'codigo',
          code,
          perPage: 20,
          timeoutMs: Number.parseInt(process.env.CONTACT_PACKAGES_PAGE_TIMEOUT_MS || '8000', 10),
        }).catch(() => ({ items: [] })),
      ),
    )
    eventPackageItems = eventPackageResults.flatMap((result) => result.items ?? [])

    if (shouldSendInternationalArrivalNotifications) {
      const arrivalCodes = [...latestEventsByCode.entries()]
        .filter(([, event]) =>
          isInternationalArrivalEvent(
            `${getPackageEventLabel(event)} ${getPackageEventSignature(event)}`,
          ),
        )
        .map(([code]) => code)
        .slice(0, Number.parseInt(process.env.PACKAGE_RECENT_EVENT_CODE_LIMIT || '200', 10) || 200)
      const trackingApiDefaults = getTrackingApiDefaults()
      const trackingUrl = new URL('/api/tracking/paquetes', trackingApiDefaults.baseUrl)
      const trackingHeaders = {
        Authorization: `Bearer ${trackingApiDefaults.token}`,
        Accept: 'application/json',
      }
      const arrivalTrackingResults = await Promise.all(
        arrivalCodes.map((code) =>
          fetchExactPackageCodeMatches({
            url: trackingUrl,
            headers: trackingHeaders,
            queryParam: 'q',
            code,
            perPage: 20,
            timeoutMs: 8000,
          }),
        ),
      )
      arrivalTrackingItems = arrivalTrackingResults.flatMap((result) => result.items ?? [])
    }
  }

  const recentEntriesByCode = new Map()
  for (const item of [...recentContactItems, ...eventPackageItems]) {
    const entry = buildContactPackageSyncEntry({ item, latestEventsByCode })
    if (!entry?.code) continue
    const lookupCode = normalizePackageCodeForLookup(entry.code)
    if (!lookupCode) continue
    recentEntriesByCode.set(lookupCode, entry)
  }
  for (const item of [...recentTrackingItems, ...arrivalTrackingItems]) {
    const entry = buildTrackingPackageSyncEntry({ item, latestEventsByCode })
    if (!entry?.code) continue
    const lookupCode = normalizePackageCodeForLookup(entry.code)
    if (!lookupCode) continue
    const existingEntry = recentEntriesByCode.get(lookupCode)
    if (existingEntry) {
      existingEntry.sources = [...new Set([
        ...(existingEntry.sources ?? []),
        ...(entry.sources ?? []),
      ])]
        if (!normalizeReference(existingEntry.internationalArrivalEventSignature) &&
          normalizeReference(entry.internationalArrivalEventSignature)) {
          existingEntry.internationalArrivalEventLabel = entry.internationalArrivalEventLabel
          existingEntry.internationalArrivalEventLocation = entry.internationalArrivalEventLocation
          existingEntry.internationalArrivalEventDate = entry.internationalArrivalEventDate
          existingEntry.internationalArrivalEventSignature = entry.internationalArrivalEventSignature
        }
      if (existingEntry.source === 'contact' && !existingEntry.primaryPhone) {
        existingEntry.primaryPhone = entry.welcomePhoneCandidates[0] || ''
        existingEntry.phoneNames = new Map([
          ...(existingEntry.phoneNames ?? []),
          ...(entry.phoneNames ?? []),
        ])
      }
      continue
    }
    recentEntriesByCode.set(lookupCode, entry)
  }
  const recentEntries = [...recentEntriesByCode.values()]

  if (recentEntries.length === 0) {
    return {
      syncedAt: new Date().toISOString(),
      total: 0,
      createdCount: 0,
      packageCountsBySource,
      packageSourceFailures,
      newPackageWelcome: { sent: 0, skipped: 0 },
      eventNotifications: { sent: 0, skipped: 0 },
      internationalArrivalNotifications: { sent: 0, skipped: 0 },
      ventanillaNotifications: { sent: 0, skipped: 0 },
    }
  }

  const client = await pool.connect()
  const syncedEntries = []
  let createdCount = 0

  try {
    await client.query('begin')

    for (const entry of recentEntries) {
      const nextResult = await upsertPackageContact(client, entry)
      if (nextResult?.action === 'created') {
        createdCount += 1
      }
      if (nextResult?.id) {
        syncedEntries.push({ ...entry, contactId: nextResult.id, action: nextResult.action })
      }
    }

    await client.query('commit')
  } catch (error) {
    await client.query('rollback').catch(() => {})
    throw error
  } finally {
    client.release()
  }

  const newPackageWelcome = shouldSendWelcome
    ? await notifyNewPackageContacts(syncedEntries)
    : { sent: 0, skipped: syncedEntries.length, reason: 'new-package-welcome-not-due' }
  const eventNotifications = shouldSendEvents
    ? await notifyPackageEventChanges(syncedEntries, { requireWelcome: false, eventType: 'general' })
    : { sent: 0, skipped: syncedEntries.length, reason: 'automatic-status-updates-disabled' }
  const internationalArrivalNotifications = shouldSendInternationalArrivalNotifications
    ? await notifyPackageEventChanges(syncedEntries, {
        requireWelcome: false,
        eventType: 'international-arrival-test',
      })
    : {
        sent: 0,
        skipped: syncedEntries.length,
        reason: 'international-arrival-test-notifications-disabled',
      }
  const ventanillaNotifications = shouldSendVentanillaEvents
    ? await notifyPackageEventChanges(syncedEntries, { requireWelcome: false, eventType: 'ventanilla' })
    : { sent: 0, skipped: syncedEntries.length, reason: 'automatic-ventanilla-notifications-disabled' }

  return {
    syncedAt: new Date().toISOString(),
    total: recentEntries.length,
    createdCount,
    packageCountsBySource,
    packageSourceFailures,
    newPackageWelcome,
    eventNotifications,
    internationalArrivalNotifications,
    ventanillaNotifications,
  }
}

const ensurePackagePipelineSync = async ({ force = false, reconciliation = false } = {}) => {
  const cached = getCachedValue(packagePipelineSyncCache, 'last-sync')
  if (!force && cached && cached.syncedAt) {
    const age = Date.now() - Date.parse(cached.syncedAt)
    if (Number.isFinite(age) && age >= 0 && age < PACKAGE_PIPELINE_SYNC_TTL_MS) {
      return cached
    }
  }

  const pending = getCachedValue(packagePipelineSyncCache, 'in-flight')
  if (pending) {
    if (!force || !reconciliation) return pending
    await pending.catch(() => {})
    return ensurePackagePipelineSync({ force: true, reconciliation: true })
  }

  const syncPromise = syncPackagePipelineFromApis({ reconciliation })
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

const cleanPackagePlaceLabel = (value, fallback = '') => {
  const cleaned = normalizeReference(value)
    .replace(/(?:Paquetes-Contactos API|Tracking API)\s*Â·\s*/gi, '')
    .replace(/\s+/g, ' ')
    .trim()

  return cleaned || fallback
}

const isInternationalDestinationLabel = (value) => {
  const destination = normalizeReference(value)
  if (!destination || destination.toLowerCase() === 'destino') return false
  if (getBoliviaBranchLocation(destination)) return false
  return !normalizeSearchText(destination).includes('bolivia')
}

const isBoliviaInternationalDispatchLocation = (value) => {
  const location = normalizeSearchText(value)
  return Boolean(location) &&
    (
      location.includes('bolpbb') ||
      location.includes('la paz ems') ||
      location.includes('bolivia') ||
      location.includes('la paz')
    )
}

const buildInternationalTransitMessage = ({ packageCode, destination, eventLocation }) => [
  `Tenemos una actualizacion de tu paquete *${packageCode}*.`,
  '',
  `Tu paquete estuvo en *La Paz, Bolivia* y ya partio hacia *${destination}*.`,
  eventLocation && !isBoliviaInternationalDispatchLocation(eventLocation)
    ? `Ultimo registro operativo: ${eventLocation}.`
    : 'Continua en transito internacional; te notificaremos cuando registre un nuevo movimiento.',
].join('\n')

const buildPackageEventChangeMessage = ({ contact, entry }) => {
  const contactName = normalizeReference(entry?.recipientName) || normalizeReference(contact?.name) || 'Hola'
  const packageCode = normalizeReference(entry?.code) || 'tu guia'
  const destination = cleanPackagePlaceLabel(entry?.destinationLabel, 'destino')
  const eventLabel = normalizeReference(entry?.latestEventLabel) || 'Nuevo movimiento registrado'
  const arrivalMessage = buildInternationalArrivalMessage({
    packageCode,
    eventLabel: `${eventLabel} ${normalizeReference(entry?.latestEventSignature)}`,
  })
  if (arrivalMessage) return arrivalMessage

  const eventLocation = cleanPackagePlaceLabel(entry?.latestEventLocation)
  const eventDate = normalizeReference(entry?.latestEventDate)
  const destinationBranchText = formatBranchText(getBoliviaBranchLocation(destination))
  const locationText = eventLocation ? ` en ${eventLocation}` : ''
  const dateText = eventDate ? ` (${eventDate})` : ''

  if (isPackageReturnToOriginEvent({ eventLabel, eventSignature: entry?.latestEventSignature })) {
    return buildPackageReturnToOriginMessage({
      contactName,
      packageCode,
      origin: cleanPackagePlaceLabel(entry?.originLabel, 'su departamento de origen'),
      noticeDates: entry?.deliveryNoticeDates,
    })
  }

  if (isVentanillaText(eventLabel) || isVentanillaText(entry?.latestEventSignature)) {
    return buildVentanillaPickupMessage({
      packageCode,
      branch: getBoliviaBranchLocation(destination) || getBoliviaBranchLocation(eventLocation),
    })
  }

  const nationalDistributionMessage = buildNationalDistributionTrackingReply({
    packageCode,
    latestEventLabel: eventLabel,
    latestEventSignature: entry?.latestEventSignature,
    statusLabel: entry?.statusLabel || entry?.stage,
  })
  if (nationalDistributionMessage) {
    return nationalDistributionMessage
  }

  if (['received', 'transit', 'regional', 'courier', 'delivered', 'cancelled'].includes(entry?.stage)) {
    const origin = cleanPackagePlaceLabel(entry?.originLabel, 'origen')
    const baseTitle = `Â¡Hola, ${contactName}! ðŸ‘‹ Tenemos una actualizaciÃ³n de tu paquete *${packageCode}*.`

    if (entry.stage === 'received') {
      return [
        baseTitle,
        '',
        `ðŸ“¥ Fue recibido en *${eventLocation || origin}* y tiene destino a *${destination}*.`,
        'ðŸšš Te avisaremos apenas sea despachado.',
      ].join('\n')
    }

    if (entry.stage === 'transit') {
      if (isInternationalDestinationLabel(destination) &&
        isBoliviaInternationalDispatchLocation(eventLocation)) {
        return buildInternationalTransitMessage({ packageCode, destination, eventLocation })
      }

      return [
        baseTitle,
        '',
        `ðŸšš Tu paquete ya estÃ¡ en camino hacia *${destination}*.`,
        eventLocation ? `ðŸ“ Ãšltima actualizaciÃ³n registrada en ${eventLocation}.` : 'ðŸ“ Ãšltima actualizaciÃ³n registrada.',
        'ðŸ“² Te notificaremos cuando registre un nuevo movimiento.',
      ].join('\n')
    }

    if (entry.stage === 'regional') {
      return [
        baseTitle,
        '',
        `ðŸ¤ Ya llegÃ³ a la sucursal de destino en *${destination}*.`,
        destinationBranchText ? `ðŸ“ UbicaciÃ³n: ${destinationBranchText}.` : `ðŸ“ UbicaciÃ³n actual: ${eventLocation || destination}.`,
        'ðŸš´â€â™‚ï¸ Siguiente paso: pasarÃ¡ a reparto o quedarÃ¡ disponible segÃºn el proceso de la regional.',
      ].join('\n')
    }

    if (entry.stage === 'courier') {
      return [
        baseTitle,
        '',
        `ðŸš´â€â™‚ï¸ Ya estÃ¡ con cartero para entrega en *${destination}*.`,
        eventLocation ? `ðŸ“ UbicaciÃ³n actual: ${eventLocation}.` : '',
        'âœ… Te avisaremos cuando se confirme la entrega.',
      ].filter(Boolean).join('\n')
    }

    if (entry.stage === 'delivered') {
      return [
        baseTitle,
        '',
        `âœ… Figura entregado con Ã©xito en *${destination}*.`,
        'Gracias por preferir Correos de Bolivia ðŸ˜Š.',
      ].join('\n')
    }

    return buildPackageCancellationMessage({
      contactName,
      packageCode,
      eventLocation,
    })
  }

  if (entry?.stage === 'regional') {
    return [
      `Â¡Hola, ${contactName}! ðŸ‘‹ Tenemos una actualizaciÃ³n de tu paquete *${packageCode}*.`,
      '',
      `ðŸ¤ Ya llegÃ³ a la sucursal de destino en *${destination}*.`,
      destinationBranchText ? `ðŸ“ UbicaciÃ³n: ${destinationBranchText}.` : `ðŸ“ UbicaciÃ³n actual: ${eventLocation || destination}.`,
      'ðŸš´â€â™‚ï¸ Siguiente paso: pasarÃ¡ a reparto o quedarÃ¡ disponible segÃºn el proceso de la regional.',
    ].join('\n')
  }

  if (entry?.stage === 'received') {
    return [
      `Â¡Hola, ${contactName}! ðŸ‘‹ Tenemos una actualizaciÃ³n de tu paquete *${packageCode}*.`,
      '',
      `ðŸ“¥ Fue recibido en *${eventLocation || 'origen'}* y tiene destino a *${destination}*.`,
      'ðŸšš Te avisaremos apenas sea despachado.',
    ].join('\n')
  }

  if (entry?.stage === 'transit') {
    const isInternalDispatch = normalizeSearchText(eventLabel).includes('saca interna')

    if (isInternationalDestinationLabel(destination) &&
      isBoliviaInternationalDispatchLocation(eventLocation)) {
      return buildInternationalTransitMessage({ packageCode, destination, eventLocation })
    }

    if (isInternalDispatch) {
      return [
        `Â¡Hola, ${contactName}! ðŸ‘‹ Tenemos una actualizaciÃ³n de tu paquete *${packageCode}*.`,
        '',
        `ðŸ“¦ Fue despachado desde *${eventLocation || entry?.originLabel || 'origen'}* con destino a *${destination}*.`,
        'ðŸšš EstÃ¡ en trÃ¡nsito; te avisaremos cuando registre llegada a la regional de destino.',
      ].join('\n')
    }

    return [
      `Â¡Hola, ${contactName}! ðŸ‘‹ Tenemos una actualizaciÃ³n de tu paquete *${packageCode}*.`,
      '',
      `ðŸšš EstÃ¡ en trÃ¡nsito hacia *${destination}*.`,
      eventLocation ? `ðŸ“ Ãšltimo registro: ${eventLabel} en ${eventLocation}${dateText}.` : `ðŸ“ Ãšltimo registro: ${eventLabel}${dateText}.`,
      'ðŸ“² Te notificaremos cuando registre un nuevo movimiento.',
    ].join('\n')
  }

  if (entry?.stage === 'courier') {
    return [
      `Â¡Hola, ${contactName}! ðŸ‘‹ Tenemos una actualizaciÃ³n de tu paquete *${packageCode}*.`,
      '',
      `ðŸš´â€â™‚ï¸ Ya estÃ¡ con cartero para entrega en *${destination}*.`,
      eventLocation ? `ðŸ“ UbicaciÃ³n actual: ${eventLocation}.` : '',
      'âœ… Te avisaremos cuando se confirme la entrega.',
    ].filter(Boolean).join('\n')
  }

  if (entry?.stage === 'delivered') {
    return [
      `Â¡Hola, ${contactName}! ðŸ‘‹ Tenemos una actualizaciÃ³n de tu paquete *${packageCode}*.`,
      '',
      `âœ… Figura entregado con Ã©xito en *${destination}*.`,
      'Gracias por preferir Correos de Bolivia ðŸ˜Š.',
    ].join('\n')
  }

  if (entry?.stage === 'cancelled') {
    return [
      `Â¡Hola, ${contactName}! ðŸ‘‹ Tenemos una actualizaciÃ³n de tu paquete *${packageCode}*.`,
      '',
      `âŒ Figura cancelado o devuelto${eventLocation ? ` en *${eventLocation}*` : ''}.`,
      'ðŸ’¡ Si necesitas revisar el motivo, escribe *RECLAMO*.',
    ].join('\n')
  }

  return [
    `Â¡Hola, ${contactName}! ðŸ‘‹ Tenemos una actualizaciÃ³n de tu paquete ${packageCode}.`,
    '',
    `ðŸ“ Nuevo evento: ${eventLabel}${locationText}${dateText}.`,
    `ðŸšš Destino: ${destination}. Te avisaremos cuando se confirme el siguiente movimiento.`,
  ].join('\n')
}

const repairMojibakeText = (value) => {
  const text = String(value ?? '')
  if (!/[ÃÂðŸâ]/.test(text)) {
    return text
  }

  const windows1252Extensions = {
    0x20ac: 0x80,
    0x201a: 0x82,
    0x0192: 0x83,
    0x201e: 0x84,
    0x2026: 0x85,
    0x2020: 0x86,
    0x2021: 0x87,
    0x02c6: 0x88,
    0x2030: 0x89,
    0x0160: 0x8a,
    0x2039: 0x8b,
    0x0152: 0x8c,
    0x017d: 0x8e,
    0x2018: 0x91,
    0x2019: 0x92,
    0x201c: 0x93,
    0x201d: 0x94,
    0x2022: 0x95,
    0x2013: 0x96,
    0x2014: 0x97,
    0x02dc: 0x98,
    0x2122: 0x99,
    0x0161: 0x9a,
    0x203a: 0x9b,
    0x0153: 0x9c,
    0x017e: 0x9e,
    0x0178: 0x9f,
  }
  const bytes = Uint8Array.from([...text].map((character) => {
    const characterCode = character.codePointAt(0) ?? 0x3f
    const code = windows1252Extensions[characterCode] ?? characterCode
    return code <= 0xff ? code : 0x3f
  }))

  return Buffer.from(bytes).toString('utf8')
}

const getRecentPackageInquiryPhones = async (packageCode) => {
  const normalizedCode = normalizePackageCodeForLookup(packageCode)
  if (!normalizedCode) return []

  const result = await pool.query(
    `
      select distinct regexp_replace(coalesce(recipient_reference, ''), '[^0-9]', '', 'g') as phone
      from message_logs
      where channel = 'WhatsApp'
        and direction = 'inbound'
        and created_at >= now() - interval '7 days'
        and upper(coalesce(message_text, '')) like $1
      order by phone asc;
    `,
    [`%${normalizedCode}%`],
  )

  return result.rows
    .map((row) => normalizeBoliviaTestNumber(row.phone))
    .filter(Boolean)
    .filter((phone, index, phones) => phones.indexOf(phone) === index)
}

const getPackageWelcomeRecipients = async (packageCode) => {
  const normalizedCode = normalizePackageCodeForLookup(packageCode)
  if (!normalizedCode) return []

  const result = await pool.query(
    `
      select distinct regexp_replace(coalesce(details->>'recipient', ''), '[^0-9]', '', 'g') as phone
      from system_logs
      where event = 'whatsapp_new_package_welcome_sent'
        and details->>'packageCode' = $1
        and created_at >= now() - interval '30 days'
      order by phone asc;
    `,
    [normalizedCode],
  )

  return result.rows
    .map((row) => normalizeBoliviaTestNumber(row.phone))
    .filter(Boolean)
    .filter((phone, index, phones) => phones.indexOf(phone) === index)
}

const getEntryPhoneCandidates = (entry) => [
  ...(Array.isArray(entry?.phoneCandidates)
    ? entry.phoneCandidates
    : entry?.phoneCandidates instanceof Set
      ? [...entry.phoneCandidates]
      : []),
  entry?.primaryPhone,
]

const getNormalizedWhatsAppRecipients = (phones = []) =>
  phones
    .map(normalizeBoliviaTestNumber)
    .filter(Boolean)
    .filter(isValidWhatsAppRecipientNumber)
    .filter((phone, index, normalizedPhones) => normalizedPhones.indexOf(phone) === index)

const getPackageNotificationRecipients = ({
  config,
  entry,
  phones = [],
  allowUnassociatedTestRecipients = false,
  testRecipientsOnly = false,
}) => {
  const testModeEnabled = normalizeBoolean(config?.testModeEnabled, whatsappDefaults.testModeEnabled)
  const packageRecipients = getNormalizedWhatsAppRecipients(phones)
  const testRecipients = getNormalizedWhatsAppRecipients(getConfiguredWhatsAppTestNumbers(config))
  const associatedPhones = getNormalizedWhatsAppRecipients([
    ...(entry?.phoneNames instanceof Map ? [...entry.phoneNames.keys()] : []),
    ...(Array.isArray(entry?.testModeTargetPhones) ? entry.testModeTargetPhones : []),
    ...phones,
  ])

  return selectPackageNotificationRecipients({
    testModeEnabled,
    packageRecipients,
    testRecipients,
    associatedPhones,
    allowUnassociatedTestRecipients,
    testRecipientsOnly: testModeEnabled && testRecipientsOnly,
  })
}

const insertOutboundWhatsAppLog = async ({ contactId, recipient, messageBody, providerMessageId }) =>
  pool.query(
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
    [contactId ?? null, recipient, messageBody, providerMessageId],
  )

const sendAndLogPackageWhatsAppMessage = async ({ config, contactId, recipient, messageBody }) => {
  const repairedMessageBody = repairMojibakeText(messageBody)
  const providerResponse = await sendWhatsAppCloudMessage({
    accessToken: config.accessToken,
    apiVersion: config.apiVersion,
    phoneNumberId: config.phoneNumberId,
    to: recipient,
    body: repairedMessageBody,
  })
  const providerMessageId = providerResponse?.messages?.[0]?.id ?? providerResponse?.message_id ?? null

  await insertOutboundWhatsAppLog({
    contactId,
    recipient,
    messageBody: repairedMessageBody,
    providerMessageId,
  })

  return providerMessageId
}

const notifyPackageEventChanges = async (
  entries = [],
  { requireWelcome = true, eventType = 'general' } = {},
) => {
  const automationConfig = await getStoredAutomationConfig()
  const notificationsEnabled =
    eventType === 'ventanilla'
      ? automationConfig.automaticVentanillaNotifications
      : eventType === 'international-arrival-test'
        ? automationConfig.automaticInternationalArrivalTestNotifications
      : automationConfig.automaticStatusUpdates
  if (!notificationsEnabled) {
    console.log(
      `Notificaciones de ${eventType} desactivadas; se leyeron ${entries.length} paquetes sin enviar mensajes.`,
    )
    return {
      sent: 0,
      skipped: entries.length,
      reason: eventType === 'ventanilla'
        ? 'automatic-ventanilla-notifications-disabled'
        : eventType === 'international-arrival-test'
          ? 'international-arrival-test-notifications-disabled'
        : 'automatic-status-updates-disabled',
    }
  }
  const config = await getStoredWhatsAppConfig()
  const configError = validateWhatsAppConfig(config)

  if (configError) {
    return { sent: 0, skipped: entries.length, reason: configError }
  }

  let sent = 0
  let skipped = 0
  const sentDetails = []
  const skippedByReason = {}
  const recordSkipped = async (entry, reason, extra = {}) => {
    skipped += 1
    skippedByReason[reason] = (skippedByReason[reason] || 0) + 1
    await writeSystemLog({
      event: 'whatsapp_package_event_update_skipped',
      statusCode: 200,
      details: {
        packageCode: normalizePackageCodeForLookup(entry?.code),
        contactId: entry?.contactId ?? null,
        notificationType: eventType,
        packageStage: entry?.stage ?? null,
        eventSignature: normalizeReference(entry?.latestEventSignature),
        reason,
        ...extra,
      },
    }).catch(() => {})
  }

  for (const entry of entries) {
    const packageCode = normalizePackageCodeForLookup(entry?.code)
    const useInternationalArrivalEvent =
      eventType === 'international-arrival-test' &&
      normalizeReference(entry?.internationalArrivalEventSignature)
    const notificationEventLabel = useInternationalArrivalEvent
      ? entry.internationalArrivalEventLabel
      : entry?.latestEventLabel
    const notificationEventSignature = useInternationalArrivalEvent
      ? entry.internationalArrivalEventSignature
      : entry?.latestEventSignature
    const eventSignature = normalizeReference(notificationEventSignature)
    const hasTrackingSource = entry?.sources instanceof Set
      ? entry.sources.has('Tracking')
      : Array.isArray(entry?.sources) && entry.sources.includes('Tracking')
    const isInternationalPackage = entry?.source === 'tracking' || hasTrackingSource

    if (!isPackageEventNotificationEligible({
      stage: entry?.stage,
      eventLabel: notificationEventLabel,
      eventSignature,
      isInternationalPackage,
    })) {
      await recordSkipped(entry, 'ineligible-stage')
      continue
    }

    const isCorrectNotificationType = isPackageEventForNotificationType({
      eventLabel: notificationEventLabel,
      eventSignature,
      eventType,
    })
    if (!isCorrectNotificationType) {
      await recordSkipped(
        entry,
        eventType === 'ventanilla' ? 'not-ventanilla-event' : 'handled-by-ventanilla-notification',
      )
      continue
    }

    const isInternationalArrival =
      isInternationalPackage &&
      isInternationalArrivalEvent(`${notificationEventLabel ?? ''} ${eventSignature}`)

    if (requireWelcome) {
      const welcomeResult = await pool.query(
        `
          select created_at, details
          from system_logs
          where event = 'whatsapp_new_package_welcome_sent'
            and details->>'packageCode' = $1
          order by created_at desc, id desc
          limit 1;
        `,
        [packageCode],
      )
      const lastWelcome = welcomeResult.rows[0] ?? null
      if (!lastWelcome) {
        await recordSkipped(entry, 'welcome-not-sent')
        continue
      }
    }

    const interestedPhones = await getRecentPackageInquiryPhones(packageCode)
    const packageWelcomeRecipients = await getPackageWelcomeRecipients(packageCode)
    const isDeliveredUpdate = entry?.stage === 'delivered'
    const targetPhones = getPackageNotificationRecipients({
      config,
      entry,
      allowUnassociatedTestRecipients:
        eventType === 'international-arrival-test' && isInternationalArrival,
      testRecipientsOnly: eventType === 'international-arrival-test',
      phones: (entry?.source === 'contact'
      ? (isDeliveredUpdate
          ? getEntryPhoneCandidates(entry)
          : [entry?.primaryPhone])
      : [
          ...getEntryPhoneCandidates(entry),
        ])
        .concat(interestedPhones)
        .concat(packageWelcomeRecipients)
        .concat(entry?.testModeTargetPhones ?? []),
    })

    if (!packageCode || !eventSignature || targetPhones.length === 0 || !entry?.contactId) {
      await recordSkipped(entry, !packageCode
        ? 'missing-package-code'
        : !eventSignature
          ? 'missing-event-signature'
          : targetPhones.length === 0
            ? 'missing-recipient'
            : 'missing-contact-id', {
        recipients: targetPhones,
      })
      continue
    }

    const lastObservedResult = await pool.query(
      `
        select event, details
        from system_logs
        where event in ('package_event_observed', 'whatsapp_package_event_update_sent')
          and details->>'packageCode' = $1
        order by created_at desc, id desc
        limit 1;
      `,
      [packageCode],
    )
    const lastSignature = normalizeReference(lastObservedResult.rows[0]?.details?.eventSignature)

    const baseDetails = {
      contactId: entry.contactId,
      packageCode,
      notificationType: eventType,
      eventSignature,
      packageStage: entry.stage,
      eventLabel: notificationEventLabel,
      eventLocation: useInternationalArrivalEvent
        ? entry.internationalArrivalEventLocation
        : entry.latestEventLocation,
      eventDate: useInternationalArrivalEvent
        ? entry.internationalArrivalEventDate
        : entry.latestEventDate,
    }

    if (!lastSignature) {
      await writeSystemLog({
        event: 'package_event_observed',
        statusCode: 200,
        details: baseDetails,
      }).catch(() => {})
    }

    const contact = await findPackageContactByCode(packageCode)
    const phoneNames = entry?.phoneNames instanceof Map ? entry.phoneNames : new Map()
    for (const targetPhone of targetPhones) {
      const alreadySentResult = await pool.query(
        `
          select id
          from system_logs
          where event = 'whatsapp_package_event_update_sent'
            and details->>'packageCode' = $1
            and (
              (
                details->>'eventSignature' = $2
                and details->>'packageStage' = $4
              )
              or ($4 = 'delivered' and details->>'packageStage' = 'delivered')
            )
            and regexp_replace(coalesce(details->>'recipient', ''), '[^0-9]', '', 'g') = $3
          limit 1;
        `,
        [packageCode, eventSignature, targetPhone, entry.stage],
      )

      if (alreadySentResult.rows[0]) {
        console.log(
          `[${packageCode}] Evento ya enviado a ${targetPhone}; no se duplicaron el mensaje.`,
        )
        await recordSkipped(entry, 'duplicate-event-recipient', {
          recipient: targetPhone,
        })
        continue
      }

      console.log(
        `[${packageCode}] Nuevo evento detectado: ${entry.latestEventLabel || 'sin descripciÃ³n'}; preparando mensaje para ${targetPhone}.`,
      )

      let deliveryNoticeDates = []
      if (isPackageReturnToOriginEvent({ eventLabel: entry.latestEventLabel, eventSignature })) {
        const deliveryNoticeDatesResult = await pool.query(
          `
            select to_char(
              created_at at time zone 'America/La_Paz',
              'DD/MM/YYYY'
            ) as sent_date,
            min(created_at) as first_sent_at
            from system_logs
            where event = 'whatsapp_package_event_update_sent'
              and details->>'packageCode' = $1
              and details->>'packageStage' = 'courier'
              and regexp_replace(coalesce(details->>'recipient', ''), '[^0-9]', '', 'g') = $2
            group by sent_date
            order by first_sent_at;
          `,
          [packageCode, targetPhone],
        )
        deliveryNoticeDates = deliveryNoticeDatesResult.rows.map((row) => row.sent_date)
      }

      const messageBody = buildPackageEventChangeMessage({
        contact,
        entry: {
          ...entry,
          ...(useInternationalArrivalEvent
            ? {
                latestEventLabel: entry.internationalArrivalEventLabel,
                latestEventLocation: entry.internationalArrivalEventLocation,
                latestEventDate: entry.internationalArrivalEventDate,
                latestEventSignature: entry.internationalArrivalEventSignature,
              }
            : {}),
          deliveryNoticeDates,
          recipientName:
            phoneNames.get(targetPhone) ||
            normalizeReference(entry?.recipientName) ||
            normalizeReference(contact?.name),
        },
      })
      const outboundMessageBody = repairMojibakeText(messageBody)

      console.log(
        `[${packageCode}] Mensaje pendiente de envio.\n` +
          `  Numero destinatario: ${targetPhone}\n` +
          `  Texto:\n${outboundMessageBody}`,
      )
      const providerMessageId = await sendAndLogPackageWhatsAppMessage({
        config,
        contactId: entry.contactId,
        recipient: targetPhone,
        messageBody: outboundMessageBody,
      })

      await writeSystemLog({
        event: 'whatsapp_package_event_update_sent',
        statusCode: 200,
        details: {
          ...baseDetails,
          recipient: targetPhone,
          providerMessageId,
        },
      }).catch(() => {})

      console.log(
        `[${packageCode}] Mensaje enviado correctamente a ${targetPhone} (${providerMessageId || 'sin id'}).`,
      )
      sentDetails.push({
        packageCode,
        recipient: targetPhone,
        message: outboundMessageBody,
        providerMessageId,
      })
      sent += 1
    }
  }

  return { sent, skipped, skippedByReason, sentDetails }
}

const notifyNewPackageContacts = async (entries = []) => {
  const automationConfig = await getStoredAutomationConfig()
  if (!automationConfig.automaticWelcome) {
    return { sent: 0, skipped: entries.length, reason: 'new-package-welcome-disabled' }
  }

  const recentWindowMs = Number.isFinite(WHATSAPP_NEW_PACKAGE_WELCOME_RECENT_MS)
    ? Math.max(WHATSAPP_NEW_PACKAGE_WELCOME_RECENT_MS, 60 * 1000)
    : 24 * 60 * 60 * 1000
  const eligibleEntries = entries.filter((entry) => isEligibleNewPackageWelcomeEntry({
    contactId: entry?.contactId,
    source: entry?.source,
    action: entry?.action,
    updatedAt: entry?.updatedAt,
    recentWindowMs,
  }))

  if (eligibleEntries.length === 0) {
    return {
      sent: 0,
      skipped: entries.length,
      skippedByReason: entries.length > 0 ? { 'ineligible-entry': entries.length } : {},
    }
  }

  const config = await getStoredWhatsAppConfig()
  const configError = validateWhatsAppConfig(config)

  if (configError) {
    return {
      sent: 0,
      skipped: eligibleEntries.length,
      skippedByReason: { 'invalid-whatsapp-config': eligibleEntries.length },
      reason: configError,
    }
  }

  let sent = 0
  let skipped = 0
  const skippedByReason = {}
  const recordSkipped = async (entry, reason, extra = {}) => {
    skipped += 1
    skippedByReason[reason] = (skippedByReason[reason] || 0) + 1
    const packageCode = normalizePackageCodeForLookup(entry?.code)
    console.warn(`[${packageCode || 'sin codigo'}] Bienvenida omitida (${reason}).`)
    await writeSystemLog({
      event: 'whatsapp_new_package_welcome_skipped',
      statusCode: 200,
      details: {
        contactId: entry?.contactId ?? null,
        packageCode,
        packageStage: entry?.stage,
        reason,
        ...extra,
      },
    }).catch(() => {})
  }

  for (const entry of eligibleEntries) {
    const packageCode = normalizePackageCodeForLookup(entry?.code)
    const originalPhones = getNewPackageWelcomePhoneCandidates(entry).filter(Boolean)
    const targetPhones = getPackageNotificationRecipients({
      config,
      entry,
      phones: originalPhones,
    })

    if (!packageCode || targetPhones.length === 0 || !entry?.contactId) {
      await recordSkipped(
        entry,
        !packageCode
          ? 'missing-package-code'
          : targetPhones.length === 0
            ? 'missing-package-recipient-phone'
            : 'missing-contact-id',
        { recipientCandidateCount: originalPhones.length },
      )
      continue
    }

    const contact = await findPackageContactByCode(packageCode)
    const isVentanillaWelcome = isVentanillaText(entry?.latestEventLabel) || isVentanillaText(entry?.latestEventSignature)
    const phoneNames = entry?.phoneNames instanceof Map ? entry.phoneNames : new Map()

    for (const targetPhone of targetPhones) {
      const alreadySentResult = await pool.query(
        `
          select id
          from system_logs
          where event = 'whatsapp_new_package_welcome_sent'
            and details->>'packageCode' = $1
            and regexp_replace(coalesce(details->>'recipient', ''), '[^0-9]', '', 'g') = $2
          limit 1;
        `,
        [packageCode, targetPhone],
      )

      if (alreadySentResult.rows[0]) {
        await recordSkipped(entry, 'duplicate-recipient')
        continue
      }

      const messageBody = buildNewPackageWelcomeMessage({
        contactName: phoneNames.get(targetPhone) || contact?.name,
        entry,
      })

      const providerMessageId = await sendAndLogPackageWhatsAppMessage({
        config,
        contactId: entry.contactId,
        recipient: targetPhone,
        messageBody,
      })

      await writeSystemLog({
        event: 'whatsapp_new_package_welcome_sent',
        statusCode: 200,
        details: {
          contactId: entry.contactId,
          recipient: targetPhone,
          packageCode,
          packageStage: entry.stage,
          providerMessageId,
        },
      }).catch(() => {})

      sent += 1
      console.log(`[${packageCode}] Bienvenida enviada correctamente (${providerMessageId || 'sin id'}).`)
    }
  }

  return { sent, skipped, skippedByReason }
}

const getPackageContextDateValue = (value) => {
  return parsePackageTimestamp(value)
}

const getPackageLocationLabel = (value, fallback = 'Sin dato') => {
  if (typeof value === 'string') {
    return cleanPackagePlaceLabel(value, fallback)
  }

  return cleanPackagePlaceLabel(value?.nombre) || cleanPackagePlaceLabel(value?.codigo) || fallback
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

  const nestedPackage = payload?.data && typeof payload.data === 'object' ? payload.data : payload
  if (getPackageCodeValuesForLookup(nestedPackage).length > 0) {
    return [nestedPackage]
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
  trustReportedTotal = true,
  throwOnFirstPageError = false,
  throwOnAnyPageError = false,
  minimumPageIntervalMs = 0,
  maxRateLimitRetries = 3,
  maxNetworkRetries = 2,
  onPage = null,
  retainItems = true,
}) => {
  const allItems = []
  const pageSignatures = new Set()
  let lastRequestAt = 0
  let totalItemsFetched = 0

  for (let page = 1; page <= maxPages; page += 1) {
    const paginatedUrl = new URL(url.toString())
    paginatedUrl.searchParams.set('page', String(page))
    paginatedUrl.searchParams.set('per_page', String(perPage))

    const pageWaitMs = minimumPageIntervalMs - (Date.now() - lastRequestAt)
    if (pageWaitMs > 0) await sleep(pageWaitMs)

    let response = null
    for (let attempt = 1; attempt <= maxRateLimitRetries + 1; attempt += 1) {
      for (let networkAttempt = 1; networkAttempt <= maxNetworkRetries + 1; networkAttempt += 1) {
        lastRequestAt = Date.now()
        try {
          response = await fetchJsonWithTimeout(paginatedUrl, { headers }, timeoutMs)
        } catch {
          if (networkAttempt > maxNetworkRetries) break
          await sleep(Math.min(1000 * (2 ** (networkAttempt - 1)), 8000))
        }
        if (response) break
      }
      if (response?.status !== 429) break

      if (attempt <= maxRateLimitRetries) {
        const retryAfter = normalizeReference(response.headers?.get?.('retry-after'))
        const retryAfterSeconds = Number(retryAfter)
        const retryAfterDate = Date.parse(retryAfter)
        const retryDelayMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
          ? Math.min(retryAfterSeconds * 1000, 120000)
          : Number.isFinite(retryAfterDate)
            ? Math.min(Math.max(retryAfterDate - Date.now(), 1000), 120000)
            : Math.min(5000 * (2 ** (attempt - 1)), 60000)
        await sleep(retryDelayMs)
      }
    }

    if (!response?.ok) {
      if (throwOnAnyPageError || (throwOnFirstPageError && page === 1)) {
        const error = new Error(
          response?.status === 429
            ? `La API externa limitó la consulta en la página ${page} (HTTP 429).`
            : response
              ? `La API externa respondió HTTP ${response.status} en la página ${page}.`
              : `No se pudo conectar con la API externa en la página ${page}.`,
        )
        if (response?.status === 429) error.code = 'UPSTREAM_RATE_LIMIT'
        throw error
      }
      break
    }

    const payload = await response.json().catch(() => null)
    if (!payload && throwOnAnyPageError) {
      throw new Error(`La API externa devolvió una respuesta no válida en la página ${page}.`)
    }
    const pageItems = getPaginatedPayloadItems(payload)
    if (!pageItems.length) {
      break
    }

    const pageSignature = pageItems
      .slice(0, 5)
      .map((item) => getPackageCodeFromItem(item) || JSON.stringify(item).slice(0, 120))
      .join('|')
    if (pageSignatures.has(pageSignature)) {
      if (throwOnAnyPageError) {
        throw new Error(`La API externa repitió los resultados en la página ${page}.`)
      }
      break
    }
    pageSignatures.add(pageSignature)

    if (retainItems) {
      allItems.push(...pageItems)
    }
    totalItemsFetched += pageItems.length

    if (typeof onPage === 'function') {
      await onPage(pageItems, page, payload)
    }

    if (typeof stopWhen === 'function' && stopWhen(pageItems, allItems, payload)) {
      break
    }

    const totalItems = getPaginatedPayloadTotal(payload)
    if (trustReportedTotal && Number.isFinite(totalItems) && totalItemsFetched >= totalItems) {
      break
    }
    const effectivePerPage = Number(
      payload?.meta?.per_page ||
      payload?.per_page ||
      payload?.por_pagina ||
      payload?.paginacion?.por_pagina ||
      payload?.pagination?.per_page ||
      perPage,
    )
    if (!trustReportedTotal && pageItems.length < effectivePerPage) {
      break
    }
  }

  if (totalItemsFetched > 0 && totalItemsFetched >= maxPages * perPage && throwOnAnyPageError) {
    throw new Error(`La API externa superó el límite de ${maxPages} páginas; el catálogo no está completo.`)
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

  const shortCodeMatches = normalized.matchAll(/\b(?:CODIGO|C[OÃ“]DIGO|GUIA|GU[IÃ]A|TRACKING|PAQUETE)\s*(?:N(?:RO|UMERO)?\.?|#|:)?\s*(\d{3,7})\b/g)

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
  return [...new Set([
    item?.codigo_s10,
    item?.codigo,
    item?.codigoSeguimiento,
    item?.tracking,
    getPackageCodeFromItem(item),
  ]
    .map(normalizePackageCodeForLookup)
    .filter(Boolean))]
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
    item?.paquete?.tracking,
    item?.evento?.codigo_s10,
    item?.evento?.codigo,
  ]
    .map(normalizePackageCodeForLookup)
    .filter(Boolean)
}

const getPackageEventTimestampValue = (item) => {
  const candidateValues = [
    item?.fecha_movimiento,
    item?.fechaMovimiento,
    item?.event_gmt_dt,
    item?.fecha_evento,
    item?.fechaEvento,
    item?.event_date,
    item?.fecha_hora,
    item?.fechaHora,
    item?.fecha_registro,
    item?.fecha,
    item?.created_at,
    item?.updated_at,
    item?.timestamp,
  ]

  for (const candidate of candidateValues) {
    const parsed = parsePackageTimestamp(candidate)
    if (parsed > 0) {
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
  normalizeReference(item?.office_name) ||
  normalizeReference(item?.off_name) ||
  normalizeReference(item?.ubicacion) ||
  normalizeReference(item?.lugar) ||
  normalizeReference(item?.regional) ||
  normalizeReference(item?.departamento) ||
  normalizeReference(item?.ciudad) ||
  normalizeReference(item?.detalle) ||
  ''

const getBolivianDepartmentKey = (value) => {
  const normalized = normalizeReference(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
  const departments = [
    ['la-paz', ['la paz', 'el alto', 'viacha', 'achocalla', 'lpz']],
    ['cochabamba', ['cochabamba', 'cbba', 'sacaba', 'quillacollo']],
    ['santa-cruz', ['santa cruz', 'scz', 'montero', 'warnes']],
    ['oruro', ['oruro']],
    ['potosi', ['potosi']],
    ['tarija', ['tarija']],
    ['chuquisaca', ['chuquisaca', 'sucre']],
    ['beni', ['beni', 'trinidad', 'riberalta']],
    ['pando', ['pando', 'cobija']],
  ]

  return departments.find(([, aliases]) => aliases.some((alias) => normalized.includes(alias)))?.[0] ?? ''
}

const getBoliviaDateKey = (value) => {
  const timestamp = typeof value === 'number' ? value : Date.parse(normalizeReference(value))
  if (!Number.isFinite(timestamp)) return ''
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/La_Paz',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(timestamp))
  return `${parts.find((part) => part.type === 'year')?.value}-${parts.find((part) => part.type === 'month')?.value}-${parts.find((part) => part.type === 'day')?.value}`
}

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
  startPage = 1,
  timeoutMs = 15000,
}) => {
  let pagesChecked = 0
  let totalItems = 0
  let statusCode = null
  let errorMessage = ''
  let complete = false

  for (let page = startPage; page < startPage + maxPages; page += 1) {
    const paginatedUrl = new URL(url.toString())
    paginatedUrl.searchParams.set('page', String(page))
    paginatedUrl.searchParams.set('per_page', String(perPage))

    const response = await fetchJsonWithTimeout(paginatedUrl, { headers }, timeoutMs).catch(() => null)
    pagesChecked += 1

    if (!response?.ok) {
      statusCode = response?.status ?? 502
      errorMessage = response ? `La API respondio con estado ${response.status}.` : 'No se obtuvo respuesta de la API.'
      break
    }

    statusCode = response.status
    let payload
    try {
      payload = await response.json()
    } catch {
      errorMessage = 'La API devolvio una respuesta que no es JSON.'
      break
    }
    const items = getPaginatedPayloadItems(payload)
    const reportedTotal = getPaginatedPayloadTotal(payload)
    totalItems = reportedTotal ?? totalItems + items.length

    const match = items.find((item) => getPackageCodeValuesForLookup(item).includes(code))
    if (match) {
      return {
        source,
        found: true,
        pagesChecked,
        pageFound: page,
        nextPage: page + 1,
        complete: true,
        totalItems,
        statusCode,
        code,
        matchedFields: getPackageCodeValuesForLookup(match),
        record: match,
      }
    }

    if (!items.length) {
      statusCode = response.status
      complete = true
      break
    }

    const responsePageSize = Number(
      payload?.meta?.per_page ||
        payload?.por_pagina ||
        payload?.paginacion?.por_pagina ||
        payload?.pagination?.per_page ||
        perPage,
    )
    if (reportedTotal > 0 && page * responsePageSize >= reportedTotal) {
      complete = true
      break
    }
  }

  return {
    source,
    found: false,
    pagesChecked,
    pageFound: null,
    nextPage: complete ? 1 : startPage + (errorMessage ? 0 : pagesChecked),
    complete,
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
      lookupUnavailable: false,
      trackingLookupUnavailable: false,
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
  let externalLookupUnavailable = false
  let trackingLookupUnavailable = false
  let trackingApiLookupUrl = trackingUrl.toString()

  if (normalizedPackageCode) {
    const exactContactResult = await fetchExactPackageCodeMatches({
      url: contactUrl,
      headers: contactHeaders,
      queryParam: 'codigo',
      code: normalizedPackageCode,
    })
    contactItems = exactContactResult.items

    if (!contactItems.some(matchesCode)) {
      const exactTrackingResult = await fetchExactTrackingPackageMatch({
        url: trackingUrl,
        headers: trackingHeaders,
        code: normalizedPackageCode,
      })
      trackingApiLookupUrl = exactTrackingResult.url
      trackingLookupUnavailable = exactTrackingResult.unavailable
      if (exactTrackingResult.item) trackingItems = [exactTrackingResult.item]
      externalLookupUnavailable = trackingLookupUnavailable || !exactContactResult.ok

      if (!trackingItems.some(matchesCode)) {
        const storedInternationalPackage = await fetchStoredInternationalTrackingPackageByCode(normalizedPackageCode)
        if (storedInternationalPackage && matchesCode(storedInternationalPackage)) {
          trackingItems.push(storedInternationalPackage)
        }
      }
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

  const cdsLookupItem = normalizedPackageCode
    ? matchingTrackingItems[0] ?? {
        codigo_s10: normalizedPackageCode,
        codigo: normalizedPackageCode,
      }
    : null
  const cdsDeclarationWarning = cdsLookupItem
    ? await enrichTrackingPackagesWithCds([cdsLookupItem])
    : null
  const cdsDeclaration = cdsLookupItem?.declaracion_cds ?? null
  const declaredDestinations = Array.isArray(cdsLookupItem?.destinos_declarados)
    ? cdsLookupItem.destinos_declarados
    : []
  const declarationDestinations = (cdsDeclaration?.objetos ?? []).flatMap((object) =>
    (object?.declaraciones ?? []).map((declaration) => ({
      departamento:
        getSafeDeclaredDepartment(declaration?.destino_declarado?.departamento) ||
        getSafeDeclaredDepartment(getCdsDeclarationField(declaration?.campos, 'RSta')),
      ciudad:
        normalizeReference(declaration?.destino_declarado?.ciudad) ||
        getCdsDeclarationField(declaration?.campos, 'RCty'),
      codigo_postal:
        normalizeReference(declaration?.destino_declarado?.codigo_postal) ||
        getCdsDeclarationField(declaration?.campos, 'RZip'),
      pais_codigo:
        normalizeReference(declaration?.destino_declarado?.pais_codigo) ||
        getCdsDeclarationField(declaration?.campos, 'RCtr'),
    })),
  )
  const declaredRecipients = (cdsDeclaration?.objetos ?? []).flatMap((object) =>
    (object?.declaraciones ?? [])
      .map((declaration) => declaration?.destinatario_declarado)
      .filter((recipient) => normalizeReference(recipient?.nombre)),
  )
  const declaredRecipient = declaredRecipients[0] ?? null
  const allDeclaredDestinations = [...declaredDestinations, ...declarationDestinations]
  const hasDeclaredDestinationInfo = allDeclaredDestinations.some((destination) =>
    getSafeDeclaredDepartment(destination?.departamento) ||
    normalizeReference(destination?.ciudad) ||
    normalizeReference(destination?.codigo_postal) ||
    normalizeReference(destination?.pais_codigo),
  )
  const cdsDeclarationSummary = cdsDeclaration
    ? [
        `Estado de declaración CDS: ${normalizeReference(cdsDeclaration.estado) || 'Sin estado'}`,
        ...allDeclaredDestinations.map((destination) => {
          const department = getSafeDeclaredDepartment(destination?.departamento)
          const city = normalizeReference(destination?.ciudad)
          const postalCode = normalizeReference(destination?.codigo_postal)
          const country = normalizeReference(destination?.pais_codigo)
          return [
            department ? `departamento declarado ${department}` : '',
            city ? `ciudad declarada ${city}` : '',
            postalCode ? `codigo postal declarado ${postalCode}` : '',
            country ? `pais declarado ${country}` : '',
          ]
            .filter(Boolean)
            .join(' | ')
        }).filter(Boolean),
        ...(!hasDeclaredDestinationInfo ? ['destino declarado no informado'] : []),
        'El destino declarado en CDS no confirma la ubicación operativa actual del paquete.',
      ]
        .filter(Boolean)
        .join('\n')
    : cdsDeclarationWarning
      ? 'La consulta de declaración CDS está incompleta; no se pudo confirmar el departamento declarado.'
      : ''

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
      statusLabel: statusText,
      latestEventLabel:
        normalizeReference(latestEvent?.evento_api) ||
        normalizeReference(latestEvent?.evento_original) ||
        '',
      latestEventLocation: latestLocation,
      latestEventAt: normalizeReference(latestEvent?.fecha),
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
    const transferCode = getContactPackageTransferCode(item)
    const transferDate = getContactPackageTransferDate(item)
    return {
      code: packageCode,
      source: 'contact',
      stage: inferContactPackageStage(item),
      updatedAt: getPackageContextDateValue(item?.fecha_registro),
      statusLabel: statusText,
      latestEventLabel: '',
      latestEventLocation: '',
      latestEventAt: '',
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
        transferCode ? `codigo especial ${transferCode}` : '',
        transferDate ? `traspaso ${transferDate}` : '',
        normalizeReference(item?.fecha_registro) ? `registro ${normalizeReference(item?.fecha_registro)}` : '',
      ]
        .filter(Boolean)
        .join(' | '),
    }
  })

  const trackingSummaries = trackingPackageEntries.slice(0, 3).map((entry) => entry.summary)
  const contactSummaries = contactPackageEntries.slice(0, 3).map((entry) => entry.summary)
  const packageEntries = [...trackingPackageEntries, ...contactPackageEntries]
  const latestPackageEntry = selectLatestPackageEntry(packageEntries, getPackageStageRank)
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
        if (secondEntry.updatedAt !== firstEntry.updatedAt) {
          return secondEntry.updatedAt - firstEntry.updatedAt
        }

        return (
          getPackageStageRank(secondEntry.stage) - getPackageStageRank(firstEntry.stage) ||
          getEntrySpecificityScore(secondEntry) - getEntrySpecificityScore(firstEntry)
        )
      })[0] ?? latestPackageEntry
  const stage = latestPackageEntry?.stage ?? mostAdvancedEntry?.stage ?? null

  const summarySections = []

  if (trackingSummaries.length > 0) {
    summarySections.push(`Tracking API:\n- ${trackingSummaries.join('\n- ')}`)
  }

  if (contactSummaries.length > 0) {
    summarySections.push(`Paquetes-Contactos API:\n- ${contactSummaries.join('\n- ')}`)
  }

  if (cdsDeclarationSummary) {
    summarySections.push(`Declaración aduanera CDS:\n${cdsDeclarationSummary}`)
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
  const internationalArrivalConfirmed = hasInternationalArrivalEvent([
    ...matchingTrackingItems.flatMap((item) => (Array.isArray(item?.eventos) ? item.eventos : [])),
    ...packageEvents,
    mostAdvancedEntry?.latestEventLabel,
  ])

  return setCachedValue(packageContextCache, cacheKey, {
    matched: matchingTrackingItems.length > 0 || matchingContactItems.length > 0,
    trackingApiLookupUrl,
    isTestModeNumber,
    stage,
    currentPackageCode: mostAdvancedEntry?.code ?? latestPackageEntry?.code ?? '',
    currentPackageUpdatedAt: mostAdvancedEntry?.updatedAt ?? latestPackageEntry?.updatedAt ?? 0,
    currentStatusLabel: mostAdvancedEntry?.statusLabel ?? latestPackageEntry?.statusLabel ?? '',
    currentLatestEventLabel: mostAdvancedEntry?.latestEventLabel ?? latestPackageEntry?.latestEventLabel ?? '',
    currentLatestEventLocation: mostAdvancedEntry?.latestEventLocation ?? latestPackageEntry?.latestEventLocation ?? '',
    currentLatestEventAt: mostAdvancedEntry?.latestEventAt ?? latestPackageEntry?.latestEventAt ?? '',
    currentLatestEventSignature: mostAdvancedEntry?.latestEventSignature ?? latestPackageEntry?.latestEventSignature ?? '',
    currentOriginLabel: mostSpecificEntry?.originLabel ?? mostAdvancedEntry?.originLabel ?? latestPackageEntry?.originLabel ?? '',
    currentOriginDepartment:
      mostSpecificEntry?.originDepartment ?? mostAdvancedEntry?.originDepartment ?? latestPackageEntry?.originDepartment ?? '',
    currentDestinationLabel:
      mostSpecificEntry?.destinationLabel ?? mostAdvancedEntry?.destinationLabel ?? latestPackageEntry?.destinationLabel ?? '',
    currentDestinationDepartment:
      mostSpecificEntry?.destinationDepartment ?? mostAdvancedEntry?.destinationDepartment ?? latestPackageEntry?.destinationDepartment ?? '',
    currentDestinationAddress:
      mostSpecificEntry?.destinationAddress ?? mostAdvancedEntry?.destinationAddress ?? latestPackageEntry?.destinationAddress ?? '',
    currentRecipientName:
      normalizeReference(declaredRecipient?.nombre) ||
      mostSpecificEntry?.recipientName ||
      mostAdvancedEntry?.recipientName ||
      latestPackageEntry?.recipientName ||
      '',
    cdsDeclaration,
    declaredRecipient,
    declaredDestinations,
    cdsDeclarationWarning,
    packageCodes: [...new Set(packageEntries.map((entry) => entry.code).filter(Boolean))],
    summaryText: summarySections.join('\n\n'),
    agentFactsText,
    packageEvents,
    packageEventsText,
    packageEventsCount: packageEvents.length,
    internationalArrivalConfirmed,
    lookupUnavailable: externalLookupUnavailable && !matchingTrackingItems.length && !matchingContactItems.length,
    trackingLookupUnavailable:
      trackingLookupUnavailable && !matchingTrackingItems.length,
    lifecycleInstruction: getPackageLifecycleInstruction(stage),
  }, PACKAGE_CONTEXT_TTL_MS)
}

const scheduleWhatsAppTrackingRetry = async ({ contactId, sender, packageCode, inboundMessageId }) => {
  const normalizedSender = normalizePhoneNumber(sender)
  const normalizedCode = normalizePackageCodeForLookup(packageCode)
  if (!normalizedSender || !normalizedCode) {
    throw new Error('No se puede programar el rastreo sin un WhatsApp y una guia validos.')
  }

  const { nextAttemptAt, expiresAt } = getWhatsAppTrackingRetrySchedule()
  const result = await pool.query(
    `
      insert into whatsapp_tracking_retry_queue (
        contact_id, sender, package_code, inbound_message_id,
        next_attempt_at, expires_at
      )
      values ($1, $2, $3, $4, $5, $6)
      on conflict (sender, package_code)
        where status in ('pending', 'processing')
      do nothing
      returning id;
    `,
    [
      Number.isInteger(contactId) && contactId > 0 ? contactId : null,
      normalizedSender,
      normalizedCode,
      inboundMessageId ?? null,
      nextAttemptAt,
      expiresAt,
    ],
  )

  if (result.rows[0]) return true

  const existingResult = await pool.query(
    `
      select id
      from whatsapp_tracking_retry_queue
      where sender = $1
        and package_code = $2
        and status in ('pending', 'processing')
      limit 1;
    `,
    [normalizedSender, normalizedCode],
  )

  return Boolean(existingResult.rows[0])
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

    const cdsRecord = tracking.record ?? {
      mailitm_pid: normalizedCode,
      codigo_s10: normalizedCode,
      codigo: normalizedCode,
    }
    const declarationWarning = await enrichTrackingPackagesWithCds([cdsRecord])
    const cdsFound = ['declarada', 'objeto_sin_declaracion'].includes(cdsRecord.declaracion_cds?.estado)
    if (tracking.record && declarationWarning) {
      tracking.declarationWarning = declarationWarning
    }

    response.json({
      query: rawQuery,
      extractedCode,
      normalizedCode,
      found: tracking.found || contact.found || cdsFound,
      tracking,
      contact,
      cds: {
        source: 'cds',
        found: cdsFound,
        record: cdsRecord,
        warning: declarationWarning,
      },
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
  const automationConfig = await getStoredAutomationConfig()
  const fallbackEnabled = automationConfig.aiAutoReply
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
  const repairedBody = repairMojibakeText(body)
  let messagePayload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: {
      body: repairedBody,
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
          ...(repairedBody ? { caption: repairedBody } : {}),
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
    normalized.includes('distribuciÃ³n')
  ) {
    return 'courier'
  }

  if (
    normalized.includes('cancel') ||
    normalized.includes('anul') ||
    normalized.includes('rechaz') ||
    normalized.includes('devuelt') ||
    normalized.includes('devolv') ||
    normalized.includes('retorn') ||
    normalized.includes('return')
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
    normalized.includes('almacÃ©n') ||
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
    normalized.includes('trÃ¡nsito') ||
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
    normalized.includes('almacÃ©n') ||
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

const formatBranchShortAddress = (branch) => {
  if (!branch?.address) return ''

  return branch.address
    .replace('Av. Mariscal Santa Cruz N 1260, esq. Calle Oruro (Edificio Telecomunicaciones).', 'Av. Mariscal Santa Cruz #1260')
    .replace('Calle Cobija entre Sucre y Ballivian N 24.', 'Calle Cobija #24')
    .replace('Calle Presidente Montes esq. Junin N 1456.', 'Calle Presidente Montes #1456')
    .replace('Calle Hoyos esq. Topater, Villa Imperial de Potosi.', 'Calle Hoyos esq. Topater')
    .replace('Calle Mariscal Sucre esq. Virginio Lema N 397.', 'Calle Mariscal Sucre #397')
    .replace('Calle Junin esq. Ayacucho N 699.', 'Calle Junin #699')
}

const formatBranchText = (branch) => {
  if (!branch?.label) return ''

  const address = formatBranchShortAddress(branch)
  const label = branch.label === 'La Paz' ? 'Sucursal Central' : `Sucursal ${branch.label}`
  return address ? `${label}: ${address}` : label
}

const isVentanillaText = (value) => {
  const normalized = normalizeReference(value).toLowerCase()
  return (
    normalized.includes('ventanilla') ||
    normalized.includes('pendiente de recojo') ||
    normalized.includes('pendiente de entrega') ||
    normalized.includes('solicitud de recojo') ||
    normalized.includes('listo para recoger') ||
    normalized.includes('listo para entregar') ||
    normalized.includes('listo para entrega') ||
    normalized.includes('oficina de entrega')
  )
}

const hasVentanillaPackageContext = (packageContext = null) =>
  isVentanillaText(packageContext?.summaryText) ||
  (Array.isArray(packageContext?.packageEvents) &&
    packageContext.packageEvents.some((event) =>
      isVentanillaText(
        [event?.nombre, event?.evento_api, event?.evento_original, event?.movimiento_bolivia, event?.detalle]
          .filter(Boolean)
          .join(' '),
      ),
    ))

const buildVentanillaPickupMessage = ({ packageCode = '', branch = null } = {}) => {
  const branchText = formatBranchText(branch)
  return [
    'ðŸ“¬ Estimado(a) usuario(a):',
    '',
    `La Agencia Boliviana de Correos (AGBC) tiene el agrado de informarle que cuenta con correspondencia pendiente de entrega a su nombre${packageCode ? `, guÃ­a *${packageCode}*` : ''}.`,
    `ðŸ¤ Le solicitamos apersonarse a la Ventanilla N.Âº 3${branchText ? ` (${branchText})` : ''} para su recojo, en horario de atenciÃ³n de 08:30 a 16:30 horas, portando su documento de identidad.`,
    '',
    'ðŸªª No olvide llevar su documento de identidad.',
    'ðŸ™ Agradecemos su atenciÃ³n y esperamos su visita.',
  ].join('\n')
}

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
  const contactName = normalizeReference(packageContext?.currentRecipientName) || normalizeReference(contact?.name) || 'Hola'
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

  if (packageContext?.matched && hasVentanillaPackageContext(packageContext)) {
    return buildVentanillaPickupMessage({
      packageCode,
      branch: destinationBranch || originBranch,
    })
  }

  if (packageContext?.matched && packageContext.stage === 'delivered') {
    return `Hola, ${contactName}! Revisé la guía ${packageCode || 'indicada'} y figura como entregada. Si necesitas más detalle sobre la entrega, puedo ayudarte a revisarlo.`
    return `RevisÃ© la guÃ­a ${packageCode || 'indicada'} y figura como entregada${destinationLocationText ? ` en ${destinationLocationText}` : ''}. Si necesitas mÃ¡s detalle sobre la entrega, puedo ayudarte a revisarlo.`
  }

  if (packageContext?.matched && packageContext.stage === 'cancelled') {
    return `RevisÃ© la guÃ­a ${packageCode || 'indicada'} y figura como cancelada${originLocationText ? ` en la Sucursal ${originLocationText}` : ''}. Para revisar el motivo, comunÃ­cate con esa sucursal o atenciÃ³n al cliente.`
  }

  if (packageContext?.matched && packageContext.stage === 'courier') {
    return `RevisÃ© la guÃ­a ${packageCode || 'indicada'} y figura asignada a cartero${destinationLocationText ? ` en ${destinationLocationText}` : ''}. EstÃ¡ en proceso de reparto; no aparece como entregada todavÃ­a.`
  }

  if (packageContext?.matched && packageContext.stage === 'transit') {
    return [
      `Â¡Hola, ${contactName}! ðŸ‘‹ Muchas gracias por escribirnos.`,
      '',
      `ðŸšš Tu paquete ya estÃ¡ en trÃ¡nsito con destino a **${destinationDisplay}** ðŸ“¦. Seguimos monitoreando su avance ðŸ”Ž para avisarte en cuanto se confirme el siguiente movimiento ðŸ“².`,
    ].join('\n')
  }

  if (packageContext?.matched && packageContext.stage === 'regional') {
    return [
      `Â¡Perfecto! Confirmamos la guia ${packageCode || 'sin codigo'}:`,
      '',
      `ðŸ“ Â¿DÃ³nde estÃ¡ tu paquete hoy? Recibido y procesado en la Sucursal ${originLocationText}.`,
      `ðŸš› PrÃ³ximo paso: SaldrÃ¡ en el prÃ³ximo despacho con destino a ${destinationDisplay}.`,
      '',
      `Te notificaremos apenas entre en trÃ¡nsito. Si prefieres hacer una gestiÃ³n presencial antes de que salga, puedes pasar por la sucursal de ${originDisplay} con tu carnet de identidad original.`,
    ]
      .filter(Boolean)
      .join('\n')
  }

  if (packageContext?.matched && packageContext.stage === 'received') {
    return [
      `Â¡Perfecto! Confirmamos la guia ${packageCode || 'sin codigo'}:`,
      '',
      `ðŸ“ Â¿DÃ³nde estÃ¡ tu paquete hoy? Recibido y procesado en la Sucursal ${originLocationText}.`,
      `ðŸš› PrÃ³ximo paso: SaldrÃ¡ en el prÃ³ximo despacho con destino a ${destinationDisplay}.`,
      '',
      `Te notificaremos apenas entre en trÃ¡nsito. Si prefieres hacer una gestiÃ³n presencial antes de que salga, puedes pasar por la sucursal de ${originDisplay} con tu carnet de identidad original.`,
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
  const contactName = normalizeReference(packageContext?.currentRecipientName) || normalizeReference(contact?.name) || 'Hola'
  if (packageContext?.matched && packageContext.stage === 'delivered') {
    const packageCode = normalizeReference(packageContext?.currentPackageCode) || 'indicada'
    return `Hola, ${contactName}! Revisé la guía ${packageCode} y figura como entregada. Si necesitas más detalle sobre la entrega, puedo ayudarte a revisarlo.`
  }
  const packageCode = normalizeReference(packageContext?.currentPackageCode)
  const originDepartment = normalizeReference(packageContext?.currentOriginDepartment)
  const originLabel = normalizeReference(packageContext?.currentOriginLabel)
  const destinationDepartment = normalizeReference(packageContext?.currentDestinationDepartment)
  const destinationLabel = normalizeReference(packageContext?.currentDestinationLabel)
  const destinationAddress = normalizeReference(packageContext?.currentDestinationAddress)
  const originBranch = getPackageOriginBranch(packageContext)
  const destinationBranch = getPackageDestinationBranch(packageContext)
  const originDisplay = originDepartment || originBranch?.label || originLabel || 'origen'
  const destinationCandidate = destinationDepartment || destinationBranch?.label || destinationLabel || destinationAddress
  const destinationDisplay =
    destinationCandidate && !/^(sin destino|sin dato|sin ubicacion|no disponible)$/i.test(destinationCandidate)
      ? destinationCandidate
      : ''
  const originLocationText = originBranch?.address ? `${originDisplay} (${originBranch.address})` : originDisplay
  const destinationLocationText = destinationBranch?.address
    ? `${destinationDisplay} (${destinationBranch.address})`
    : destinationDisplay
  const isDeliveryQuestion =
    normalizedMessage.includes('llego') ||
    normalizedMessage.includes('llegÃ³') ||
    normalizedMessage.includes('entregado') ||
    normalizedMessage.includes('paquete') ||
    normalizedMessage.includes('envio') ||
    normalizedMessage.includes('envÃ­o')
  const packageEventsText = normalizeReference(packageContext?.packageEventsText)
  const shouldShowPackageEvents =
    packageContext?.matched &&
    packageEventsText &&
    (isPackageHistoryQuestion(messageBody) ||
      normalizedMessage.includes('eventos') ||
      normalizedMessage.includes('historial') ||
      normalizedMessage.includes('por donde estuvo') ||
      normalizedMessage.includes('donde estuvo') ||
      normalizedMessage.includes('donde estaba') ||
      normalizedMessage.includes('donde ira') ||
      normalizedMessage.includes('a donde va'))

  if (shouldShowPackageEvents) {
    return formatPackageHistoryReply(packageContext)
  }

  const latestPackageEvent = Array.isArray(packageContext?.packageEvents)
    ? packageContext.packageEvents
        .slice()
        .sort((firstEvent, secondEvent) => getPackageEventTimestampValue(secondEvent) - getPackageEventTimestampValue(firstEvent))[0]
    : null
  const internationalArrivalMessage = packageContext?.matched
    ? buildInternationalArrivalMessage({
        packageCode,
        eventLabel:
          normalizeReference(packageContext.currentLatestEventLabel) ||
          (latestPackageEvent ? getPackageEventTitle(latestPackageEvent) : ''),
        arrivalConfirmed:
          packageContext.internationalArrivalConfirmed ||
          hasInternationalArrivalEvent(packageContext.packageEvents),
      })
    : ''
  const customsTrackingReply = packageContext?.matched
    ? buildCustomsTrackingReply({
        packageCode,
        latestEventLabel:
          normalizeReference(packageContext.currentLatestEventLabel) ||
          (latestPackageEvent ? getPackageEventTitle(latestPackageEvent) : ''),
        latestEventLocation: packageContext.currentLatestEventLocation,
        statusLabel: packageContext.currentStatusLabel,
      })
    : ''
  const nationalDistributionTrackingReply = packageContext?.matched
    ? buildNationalDistributionTrackingReply({
        packageCode,
        latestEventLabel:
          normalizeReference(packageContext.currentLatestEventLabel) ||
          (latestPackageEvent ? getPackageEventTitle(latestPackageEvent) : ''),
        latestEventSignature: packageContext.currentLatestEventSignature,
        statusLabel: packageContext.currentStatusLabel,
      })
    : ''

  if (packageContext?.matched && packageContext.stage === 'delivered') {
    return `RevisÃ© la guÃ­a ${packageCode || 'indicada'} ðŸ“¦ y figura como entregada âœ…${destinationLocationText ? ` en ${destinationLocationText} ðŸ“` : ''}. Si necesitas mÃ¡s detalle sobre la entrega, puedo ayudarte a revisarlo ðŸ˜Š.`
  }

  if (packageContext?.matched && packageContext.stage === 'cancelled') {
    return `RevisÃ© la guÃ­a ${packageCode || 'indicada'} ðŸ“¦ y figura como cancelada âŒ${originLocationText ? ` en la Sucursal ${originLocationText} ðŸ“` : ''}. Para revisar el motivo, comunÃ­cate con esa sucursal o atenciÃ³n al cliente ðŸ“ž.`
  }

  if (packageContext?.matched && packageContext.stage === 'courier') {
    return `RevisÃ© la guÃ­a ${packageCode || 'indicada'} ðŸ“¦ y figura asignada a cartero ðŸ›µ${destinationLocationText ? ` en ${destinationLocationText} ðŸ“` : ''}. EstÃ¡ en proceso de reparto ðŸšš; no aparece como entregada todavÃ­a â³.`
  }

  if (customsTrackingReply) {
    return customsTrackingReply
  }

  if (nationalDistributionTrackingReply) {
    return nationalDistributionTrackingReply
  }

  if (internationalArrivalMessage) {
    return internationalArrivalMessage
  }

  if (packageContext?.matched && packageContext.stage === 'transit') {
    return [
      `Â¡Hola, ${contactName}! ðŸ‘‹ Muchas gracias por escribirnos.`,
      '',
      `ðŸšš Tu paquete estÃ¡ en trÃ¡nsito${destinationDisplay ? ` con destino a ${destinationDisplay}` : ''} ðŸ“¦. Seguimos monitoreando su avance ðŸ”Ž y te avisaremos cuando haya un nuevo movimiento ðŸ“².`,
    ].join('\n')
  }

  if (packageContext?.matched && packageContext.stage === 'regional') {
    return [
      `Â¡Perfecto! ðŸ‘Œ Confirmamos la guÃ­a ${packageCode || 'sin cÃ³digo'} ðŸ“¦:`,
      '',
      `ðŸ“ Â¿DÃ³nde estÃ¡ tu paquete hoy? Fue recibido y procesado en la Sucursal ${originLocationText}.`,
      `ðŸš› PrÃ³ximo paso: pasarÃ¡ a reparto o estarÃ¡ disponible segÃºn el proceso de la regional de destino ${destinationDisplay}.`,
      '',
      'Te notificaremos ðŸ“² apenas haya una nueva actualizaciÃ³n. Si necesitas gestiÃ³n presencial, lleva tu carnet de identidad original ðŸªª.',
    ].join('\n')
  }

  if (packageContext?.matched && packageContext.stage === 'received') {
    return [
      `Â¡Perfecto! ðŸ‘Œ Confirmamos la guÃ­a ${packageCode || 'sin cÃ³digo'} ðŸ“¦:`,
      '',
      `ðŸ“ Â¿DÃ³nde estÃ¡ tu paquete hoy? Fue recibido y procesado en la Sucursal ${originLocationText}.`,
      `ðŸš› PrÃ³ximo paso: saldrÃ¡ en el prÃ³ximo despacho con destino a ${destinationDisplay}.`,
      '',
      'Te notificaremos ðŸ“² apenas entre en trÃ¡nsito. Si necesitas gestiÃ³n presencial, puedes pasar por la sucursal con tu carnet de identidad original ðŸªª.',
    ].join('\n')
  }

  if (currentStatus === 'Recibido Destino') {
    return `Â¡Perfecto! ðŸ™Œ Tu paquete ya llegÃ³ y estÃ¡ listo para que lo pases a recoger en ${destinationDisplay} ðŸ“. Lleva tu carnet de identidad original ðŸªª.`
  }

  if (currentStatus === 'Nuevo') {
    return `Tu paquete fue recibido en nuestra sucursal de origen ðŸ“¦${originDisplay ? `, ${originDisplay}` : ''}${destinationDisplay ? `, con destino a ${destinationDisplay}` : ''}. Te avisaremos cuando sea despachado ðŸ“².`
  }

  if (currentStatus === 'Activo' || currentStatus === 'Entregado') {
    return 'Tu paquete figura como entregado âœ…. Si necesitas revisar algÃºn detalle adicional, aquÃ­ te ayudo ðŸ˜Š.'
  }

  if (currentStatus === 'En seguimiento') {
    return isDeliveryQuestion
      ? 'Tu paquete estÃ¡ en seguimiento ðŸ”Ž. Apenas tengamos una actualizaciÃ³n, te la compartimos ðŸ“².'
      : 'Ya estamos revisando tu envÃ­o ðŸ”Ž. En cuanto avance, te compartimos la actualizaciÃ³n ðŸ“².'
  }

  return 'Estamos revisando tu caso ðŸ”Ž. Apenas tengamos una actualizaciÃ³n, te la compartimos ðŸ“².'
}

const buildFallbackAgentReply = buildFriendlyFallbackAgentReply

const isPackageHistoryQuestion = (messageBody) => {
  const normalized = normalizeIntentText(messageBody)

  return (
    /\b(todo|historial|eventos?|movimientos?|recorrido|paso|pas[oó]|pasado|trazabilidad|seguimiento completo)\b/.test(normalized) ||
    /\b(donde|dónde)\s+(estaba|estuvo|ira|ir[aá]|ir|va|esta|est[aá])\b/.test(normalized) ||
    /\b(que|qué)\s+(paso|pas[oó])\b/.test(normalized)
  )
}

const isPackageDisputeMessage = (messageBody) => {
  const normalized = normalizeIntentText(messageBody)
  return (
    /\b(reclamo|error|equivocado|incorrecto|inconsistencia|no corresponde|no es correcto)\b/.test(normalized) ||
    /\b(por que|porque)\b.*\b(dice|figura|aparece|marca)\b/.test(normalized) ||
    /\b(aun no|todavia no|no lo|no he|no lo he|no lo lleve|no lo entregue)\b.*\b(lleve|llevado|entregue|entregado|llevare|entregare)\b/.test(normalized) ||
    /\b(lo entregare|lo llevare|voy a llevar|voy a entregar)\b.*\b(manana|luego|despues|mas tarde)\b/.test(normalized)
  )
}

const getFriendlyPackageEventTitle = (event) => {
  const rawTitle = normalizeReference(getPackageEventTitle(event))
  const normalized = normalizeIntentText(rawTitle)

  if (isInternationalArrivalEvent(rawTitle)) {
    return 'Llegó a Bolivia; recibido en oficina de cambio 📥'
  }

  if (normalized.includes('recibido') && normalized.includes('cliente')) {
    return 'Paquete recibido en origen 📥'
  }

  if (normalized.includes('almacen') || normalized.includes('centro') || normalized.includes('procesamiento')) {
    return 'Recibido en centro de procesamiento 🏢'
  }

  if (
    normalized.includes('saca') ||
    normalized.includes('despach') ||
    normalized.includes('transito') ||
    normalized.includes('camino')
  ) {
    return '¡En camino a su destino! 🚚💨'
  }

  if (
    normalized.includes('destino') ||
    normalized.includes('regional') ||
    normalized.includes('oficina') ||
    normalized.includes('ventanilla')
  ) {
    return '¡Llegó a la ciudad de destino! 🏙️'
  }

  if (
    normalized.includes('listo') ||
    normalized.includes('entrega fisica') ||
    normalized.includes('entrega fisica') ||
    normalized.includes('cartero') ||
    normalized.includes('reparto')
  ) {
    return '¡Listo para entregar! 🎉'
  }

  if (normalized.includes('fallido')) {
    return 'Intento de entrega no concretado ⚠️'
  }

  if (normalized.includes('devuel')) {
    return 'Paquete devuelto ↩️'
  }

  if (normalized.includes('entregado')) {
    return '¡Entregado con éxito! ✅'
  }

  return normalized === 'nuevo movimiento' ? '' : rawTitle || ''
}

const getFriendlyPackageCurrentStatus = (packageContext, latestEvent) => {
  const stage = normalizeReference(packageContext?.stage)
  const latestTitle = normalizeIntentText(getPackageEventTitle(latestEvent))

  if (isInternationalArrivalEvent(latestTitle)) {
    return 'Llegó a Bolivia y continúa su procesamiento.'
  }

  if (stage === 'delivered' || latestTitle.includes('entregado')) {
    return 'Entregado.'
  }

  if (stage === 'cancelled' || latestTitle.includes('devuel') || latestTitle.includes('cancel')) {
    return 'Devuelto o cancelado.'
  }

  if (stage === 'courier' || latestTitle.includes('cartero') || latestTitle.includes('reparto')) {
    return 'En reparto para entrega.'
  }

  if (
    stage === 'regional' ||
    latestTitle.includes('destino') ||
    latestTitle.includes('oficina') ||
    latestTitle.includes('ventanilla')
  ) {
    return 'Disponible para entrega en oficina.'
  }

  if (stage === 'transit' || latestTitle.includes('transito') || latestTitle.includes('despach')) {
    return 'En camino a destino.'
  }

  return 'Recibido en origen.'
}

const formatPackageHistoryReply = (packageContext) => {
  const packageCode = normalizeReference(packageContext?.currentPackageCode) || 'la guia indicada'
  const events = Array.isArray(packageContext?.packageEvents) ? packageContext.packageEvents : []
  const orderedEvents = events
    .slice()
    .sort((firstEvent, secondEvent) => getPackageEventTimestampValue(firstEvent) - getPackageEventTimestampValue(secondEvent))
  const packageEventsText = normalizeReference(packageContext?.packageEventsText)

  if (!orderedEvents.length && !packageEventsText) {
    return ''
  }

  if (!orderedEvents.length) {
    const destination =
      normalizeReference(packageContext?.currentDestinationDepartment) ||
      normalizeReference(packageContext?.currentDestinationLabel) ||
      normalizeReference(packageContext?.currentDestinationAddress)

    return [
      `¡Hola! 👋 ${getBoliviaDayGreeting()}. Soy Jaimito de Correos de Bolivia ✉️.`,
      `📦 Te detallo el recorrido de tu paquete *${packageCode}*:`,
      '',
      packageEventsText,
      '',
      destination ? `🎯 Destino registrado: ${destination}.` : '',
      '💬 Puedes escribirnos a este número si tienes alguna duda. ¡Gracias por preferirnos! 😊',
    ]
      .filter(Boolean)
      .join('\n')
  }

  const seenEvents = new Set()
  const lines = orderedEvents.map((event) => {
    const timestamp = getPackageEventTimestampValue(event)
    const formattedDate = timestamp
      ? new Intl.DateTimeFormat('es-BO', {
          dateStyle: 'short',
          timeStyle: 'short',
          timeZone: 'America/La_Paz',
        }).format(new Date(timestamp))
      : 'sin fecha'
    const title = getFriendlyPackageEventTitle(event)
    if (!title) return ''

    const dedupeKey = `${timestamp || formattedDate}|${normalizeIntentText(title)}`
    if (seenEvents.has(dedupeKey)) return ''
    seenEvents.add(dedupeKey)

    return `*${formattedDate}*: ${title}`
  }).filter(Boolean)

  const latestEvent = orderedEvents[orderedEvents.length - 1]
  const currentStatus = getFriendlyPackageCurrentStatus(packageContext, latestEvent)
  const destination =
    normalizeReference(packageContext?.currentDestinationDepartment) ||
    normalizeReference(packageContext?.currentDestinationLabel) ||
    normalizeReference(packageContext?.currentDestinationAddress)

  return [
    `¡Hola! 👋 ${getBoliviaDayGreeting()}. Soy Jaimito de Correos de Bolivia ✉️.`,
    `📦 Te detallo el recorrido de tu paquete *${packageCode}*:`,
    '',
    ...lines,
    '',
    `📍 *Estado actual:* ${currentStatus}`,
    destination ? `🎯 *Destino:* ${destination}` : '',
    '💬 Puedes pasar a recogerlo o escribirnos a este número si tienes alguna duda. ¡Gracias por preferirnos! 😊',
  ]
    .filter(Boolean)
    .join('\n')
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
  /^(?:(?:hola|buenas?)\s+)?(?:buenos?\s+(?:dias|dÃ­as)|buenas?\s+(?:tardes|noches|nohces)|hola|buenas)[!.,?\s]*$/i.test(
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

const isOpenAssistanceMessage = (messageBody) => {
  const normalized = normalizeIntentText(messageBody)

  return /^(hola|buenas|buenos dias|buenas tardes|buenas noches)?\s*(una consulta|tengo una consulta|consulta|puedo consultar|me ayudas|ayuda|necesito ayuda)\s*$/.test(
    normalized,
  )
}

const isLowSignalMessage = (messageBody) => {
  const normalized = normalizeIntentText(messageBody)
  if (!normalized) return true

  const compact = normalized.replace(/\s+/g, '')
  const words = normalized.split(' ').filter(Boolean)
  const uniqueWords = new Set(words)
  const hasVowel = /[aeiou]/.test(compact)
  const hasLongConsonantChunk = /[bcdfghjklmnpqrstvwxyz]{6,}/.test(compact)
  const repeatedShortGreeting = words.length > 1 && uniqueWords.size === 1 && ['hola', 'hols', 'buenas'].includes(words[0])

  return compact.length < 2 || !hasVowel || hasLongConsonantChunk || repeatedShortGreeting
}

const isCorreosRelatedMessage = (messageBody) => {
  const normalized = normalizeIntentText(messageBody)

  return /\b(correo|correos|bolivia|paquete|paquetes|envio|envios|guia|guias|tracking|rastreo|rastrear|seguimiento|entrega|entregado|cartero|reparto|oficina|sucursal|ventanilla|puerta|casa|domicilio|direccion|destino|reclamo|cancelado|devuelto|tarifa|precio|costo|cotizacion|delivery|express|ems)\b/.test(
    normalized,
  )
}

const isNonActionableCustomerMessage = (messageBody) =>
  !isGreetingMessage(messageBody) &&
  !isTariffInquiryMessage(messageBody) &&
  (isLowSignalMessage(messageBody) || (!isCorreosRelatedMessage(messageBody) && !hasPackageCode(messageBody)))

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
  lookupUnavailable: false,
  lifecycleInstruction: '',
})

const buildMultiPackageContextReply = (packageResults) => {
  const foundResults = packageResults.filter((result) => result.context?.matched)
  const missingCodes = packageResults
    .filter((result) => !result.context?.matched)
    .map((result) => result.code)

  const formatDisplayLocation = (value) => {
    const normalized = normalizeReference(value)
    if (!normalized) return ''

    return normalized
      .toLowerCase()
      .split(' ')
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
  }

  const formatLocation = (context) =>
    formatDisplayLocation(context.currentDestinationDepartment) ||
    formatDisplayLocation(context.currentDestinationLabel) ||
    formatDisplayLocation(context.currentDestinationAddress) ||
    formatDisplayLocation(context.currentOriginDepartment) ||
    formatDisplayLocation(context.currentOriginLabel) ||
    'sin ubicaciÃ³n precisa'

  const formatDestination = (context) =>
    formatDisplayLocation(context.currentDestinationDepartment) ||
    formatDisplayLocation(context.currentDestinationLabel) ||
    formatDisplayLocation(context.currentDestinationAddress) ||
    ''

  const formatDestinationLine = (context) => {
    const destination = formatDestination(context)
    return destination ? `ðŸŽ¯ **Destino:** Va dirigido a ${destination}.` : ''
  }

  const formatBranchShortAddress = (branch) => {
    if (!branch?.address) return ''

    return branch.address
      .replace('Av. Mariscal Santa Cruz N 1260, esq. Calle Oruro (Edificio Telecomunicaciones).', 'Av. Mariscal Santa Cruz #1260')
      .replace('Calle Cobija entre Sucre y Ballivian N 24.', 'Calle Cobija #24')
      .replace('Calle Presidente Montes esq. Junin N 1456.', 'Calle Presidente Montes #1456')
      .replace('Calle Hoyos esq. Topater, Villa Imperial de Potosi.', 'Calle Hoyos esq. Topater')
      .replace('Calle Mariscal Sucre esq. Virginio Lema N 397.', 'Calle Mariscal Sucre #397')
      .replace('Calle Junin esq. Ayacucho N 699.', 'Calle Junin #699')
  }

  const formatBranchInline = (context, fallbackLocation = '') => {
    const destinationBranch = getPackageDestinationBranch(context)
    const originBranch = getPackageOriginBranch(context)
    const branch = destinationBranch || originBranch || findBranchForLocation(fallbackLocation || formatLocation(context))
    const address = formatBranchShortAddress(branch)

    return address ? ` ðŸ“ *(${branch.label === 'La Paz' ? 'Sucursal Central' : branch.label}: ${address})*` : ''
  }

  const formatCodeList = (codes) => {
    if (codes.length <= 1) return codes[0] || ''
    if (codes.length === 2) return `${codes[0]} y ${codes[1]}`
    return `${codes.slice(0, -1).join(', ')} y ${codes[codes.length - 1]}`
  }

  const findBranchForLocation = (location) => {
    const normalizedLocation = normalizeReference(location).toLowerCase()
    if (!normalizedLocation) return null

    return BOLIVIA_BRANCH_LOCATIONS.find((branch) =>
      branch.terms.some((term) => normalizedLocation.includes(normalizeReference(term).toLowerCase())),
    )
  }

  const formatPickupPoint = (context) => {
    const location = formatLocation(context)
    const branch = findBranchForLocation(location)

    if (!branch) return ''

    return `\nðŸ¢ **Punto de recojo final:** ${branch.label} (${branch.address})`
  }

  const formatBranchLine = (label, context) => {
    const destinationBranch = getPackageDestinationBranch(context)
    const originBranch = getPackageOriginBranch(context)
    const branch = destinationBranch || originBranch || findBranchForLocation(formatLocation(context))

    if (!branch?.address) return ''

    return `ðŸ¤ **${label}:** ${branch.label} (${branch.address})`
  }

  const formatResult = ({ code, context }, index) => {
    const packageCode = normalizeReference(context.currentPackageCode) || code
    const location = formatLocation(context)
    const latestEvent = Array.isArray(context.packageEvents)
      ? context.packageEvents
          .slice()
          .sort((firstEvent, secondEvent) => getPackageEventTimestampValue(secondEvent) - getPackageEventTimestampValue(firstEvent))[0]
      : null
    const latestEventTitle = latestEvent ? normalizeReference(getPackageEventTitle(latestEvent)) : ''
    const latestEventLocation = latestEvent ? formatDisplayLocation(getPackageEventLocation(latestEvent)) : ''
    const latestEventText = latestEventTitle
      ? `\nðŸ§¾ **Ãšltimo registro:** ${latestEventTitle}${latestEventLocation ? ` en ${latestEventLocation}` : ''}.`
      : ''

    if (context.stage === 'courier') {
      return [
        `ðŸ“¦ **${index}. GuÃ­a: ${packageCode}**`,
        `ðŸšš **Estado:** ðŸŸ¡ Con cartero repartiendo en ${location}.`,
        formatDestinationLine(context),
        `ðŸ“ **UbicaciÃ³n actual:** ${location}`,
        formatBranchLine('Sucursal de reparto', context),
      ].join('\n')
    }

    if (context.stage === 'regional') {
      return [
        `ðŸ“¦ **${index}. GuÃ­a: ${packageCode}**`,
        `ðŸ¢ **Estado:** ðŸŸ¡ Ya llegÃ³ a destino en ${location}.`,
        formatDestinationLine(context),
        `ðŸ“ **UbicaciÃ³n actual:** Oficina de destino / lista para gestiÃ³n.`,
        formatBranchLine('Sucursal actual', context),
        formatPickupPoint(context),
      ].filter(Boolean).join('\n')
    }

    if (context.stage === 'delivered') {
      return [
        `ðŸ“¦ **${index}. GuÃ­a: ${packageCode}**`,
        `âœ… **Estado:** Â¡Entregado con Ã©xito!`,
        formatDestinationLine(context),
        `ðŸ“ **Lugar de entrega:** ${location}`,
        formatBranchLine('Sucursal de entrega', context),
      ].join('\n')
    }

    if (context.stage === 'transit') {
      return [
        `ðŸ“¦ **${index}. GuÃ­a: ${packageCode}**`,
        `ðŸšš **Estado:** ðŸŸ¡ En trÃ¡nsito / En camino a ${location}.`,
        formatDestinationLine(context),
        `ðŸ“ **UbicaciÃ³n actual:** ${latestEventLocation || 'Centro de clasificaciÃ³n / En ruta'}`,
        formatPickupPoint(context),
        latestEventText,
      ].filter(Boolean).join('\n')
    }

    if (context.stage === 'received') {
      return [
        `ðŸ“¦ **${index}. GuÃ­a: ${packageCode}**`,
        `ðŸ“¥ **Estado:** Recibido en origen / pendiente de despacho.`,
        formatDestinationLine(context),
        `ðŸ“ **UbicaciÃ³n actual:** ${location}`,
        formatBranchLine('Sucursal de origen', context),
      ].filter(Boolean).join('\n')
    }

    if (context.stage === 'cancelled') {
      return [
        `âŒ **${index}. GuÃ­a: ${packageCode}**`,
        `ðŸ”´ **Estado:** Cancelado / Devuelto`,
        formatDestinationLine(context),
        `ðŸ“ **Registro:** ${location}`,
        formatBranchLine('Sucursal de registro', context),
        `ðŸ’¡ *Si necesitas ayuda para consultar el motivo de cancelaciÃ³n, escribe la palabra* **RECLAMO**.`,
      ].join('\n')
    }

    return [
      `ðŸ“¦ **${index}. GuÃ­a: ${packageCode}**`,
      `â„¹ï¸ **Estado:** En revisiÃ³n`,
      formatDestinationLine(context),
      `ðŸ“ **UbicaciÃ³n actual:** ${location}`,
      formatBranchLine('Sucursal relacionada', context),
      latestEventText,
    ].filter(Boolean).join('\n')
  }

  const deliveryResults = foundResults.filter((result) => result.context?.stage === 'courier')
  const regionalResults = foundResults.filter((result) => result.context?.stage === 'regional')
  const deliveredResults = foundResults.filter((result) => result.context?.stage === 'delivered')
  const transitResults = foundResults.filter((result) => result.context?.stage === 'transit')
  const receivedResults = foundResults.filter((result) => result.context?.stage === 'received')
  const cancelledResults = foundResults.filter((result) => result.context?.stage === 'cancelled')
  const otherResults = foundResults.filter(
    (result) => !['courier', 'regional', 'delivered', 'transit', 'received', 'cancelled'].includes(result.context?.stage),
  )

  const lines = []

  if (deliveryResults.length > 0) {
    lines.push('ðŸš´â€â™‚ï¸ **En reparto hoy:**')
    lines.push(
      ...deliveryResults.map(({ code, context }) => {
        const packageCode = normalizeReference(context.currentPackageCode) || code
        const location = formatLocation(context)
        return `â€¢ **${packageCode}:** El cartero ya lo tiene en calle para entrega en **${location}**${formatBranchInline(context, location)}.`
      }),
    )
    lines.push('')
  }

  if (deliveredResults.length > 0) {
    lines.push('âœ… **Entregado:**')
    lines.push(
      ...deliveredResults.map(({ code, context }) => {
        const packageCode = normalizeReference(context.currentPackageCode) || code
        const location = formatLocation(context)
        return `â€¢ **${packageCode}:** Finalizado con Ã©xito en **${location}**${formatBranchInline(context, location)}.`
      }),
    )
    lines.push('')
  }

  if (regionalResults.length > 0) {
    lines.push('ðŸ¢ **Listos en destino:**')
    lines.push(
      ...regionalResults.map(({ code, context }) => {
        const packageCode = normalizeReference(context.currentPackageCode) || code
        const location = formatLocation(context)
        return `â€¢ **${packageCode}:** Ya llegÃ³ a la agencia de destino en **${location}**${formatBranchInline(context, location)}.`
      }),
    )
    lines.push('')
  }

  if (transitResults.length > 0) {
    lines.push('ðŸšš **En trÃ¡nsito:**')
    lines.push(
      ...transitResults.map(({ code, context }) => {
        const packageCode = normalizeReference(context.currentPackageCode) || code
        const destination = formatDestination(context) || formatLocation(context)
        return `â€¢ **${packageCode}:** En camino a **${destination}**${formatBranchInline(context, destination)}.`
      }),
    )
    lines.push('')
  }

  if (receivedResults.length > 0) {
    lines.push('ðŸ“¥ **Pendientes de despacho (En origen):**')
    const groupedByLocation = new Map()
    for (const result of receivedResults) {
      const location = formatLocation(result.context)
      const key = `${location}|${formatBranchInline(result.context, location)}`
      const group = groupedByLocation.get(key) ?? {
        location,
        branchText: formatBranchInline(result.context, location),
        codes: [],
      }
      group.codes.push(normalizeReference(result.context.currentPackageCode) || result.code)
      groupedByLocation.set(key, group)
    }
    lines.push(
      ...Array.from(groupedByLocation.values()).map(
        (group) =>
          `â€¢ **${formatCodeList(group.codes)}:** ${group.codes.length > 1 ? 'Recibidos' : 'Recibido'} en agencia **${group.location}**${group.branchText}.`,
      ),
    )
    lines.push('')
  }

  if (cancelledResults.length > 0) {
    lines.push('âŒ **Cancelados / Devueltos:**')
    lines.push(
      ...cancelledResults.map(({ code, context }) => {
        const packageCode = normalizeReference(context.currentPackageCode) || code
        const location = formatLocation(context)
        return `â€¢ **${packageCode}:** Registro cancelado en **${location}**${formatBranchInline(context, location)}.`
      }),
    )
    lines.push('ðŸ’¡ *Si necesitas ayuda para consultar el motivo de cancelaciÃ³n, escribe la palabra* **RECLAMO**.')
    lines.push('')
  }

  if (otherResults.length > 0) {
    lines.push(...otherResults.map((result, index) => formatResult(result, index + 1)))
    lines.push('')
  }

  if (missingCodes.length > 0) {
    lines.push(`No pude localizar: ${missingCodes.join(', ')}. Verifica esos codigos, por favor.`)
  }

  if (!lines.length) {
    return ''
  }

  return [
    'Â¡Listo! AquÃ­ tienes el estado exacto de tus paquetes:',
    '',
    ...lines.filter((line, index, values) => line !== '' || values[index - 1] !== ''),
    'ðŸ‘‰ Â¿Deseas que active las notificaciones a tu WhatsApp para cuando los paquetes pendientes salgan a ruta?',
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
    .replace(/[!Â¡Â¿?.,;:"'()[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return /^(muchas gracias|gracias|ok gracias|listo gracias|perfecto gracias|muchisimas gracias|mil gracias|dale gracias|bueno gracias)$/.test(
    normalized,
  )
}

const supportContactNumber = process.env.BOT_SUPPORT_CONTACT_NUMBER?.trim() || '71596249'
const PROMPT_INJECTION_SAFE_REPLY =
  `No puedo ayudarte con eso. Solo puedo ayudarte con consultas relacionadas con Correos de Bolivia, seguimiento de paquetes y atencion al cliente. Para mas informacion, comunicate al ${supportContactNumber}.`

const buildConversationRecoveryReply = ({ category = 'GENERAL', packageCode = '' } = {}) => {
  if (category === 'TARIFAS') {
    return 'Puedo ayudarte a cotizar el envio. Indícame origen, destino, peso y servicio; si quieres consultar un paquete, envíame también su número de guía.'
  }
  if (packageCode) return `Puedo revisar el estado de la guía ${packageCode} o ayudarte a cotizar un nuevo envío. ¿Qué necesitas consultar?`
  return 'Puedo ayudarte a cotizar un envío o consultar el estado de un paquete. Indícame los datos que necesitas revisar.'
}

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
    /\b(escribe|responde|di|confirma)\b.*\b(exactamente|literalmente|texto)\b/,
    /\b(costo|cuesta|cobran|cobrar|tarifa|precio|envio)\b.*\b(bs\s*0|0\s*bs|gratis|gratuito|sin costo|costo cero)\b/,
    /\b(descuento|rebaja)\b.*\b(100\s*%|cien por ciento|total)\b/,
    /\b(free|free[-\s]?\d+|#free)\b/,
    /\b(gerente|director|jefe|autorizacion|codigo de autorizacion)\b.*\b(gratis|sin costo|descuento|100\s*%|free)\b/,
    /\b(auditoria|prueba del sistema|test del sistema)\b.*\b(escribe|responde|di|confirma)\b/,
    /\b(override system|override_system|system override|role|service|price)\b.*\b(true|0|gratis|sin costo)\b/,
    /\bprocesa\b.*\b(json|override|system|price|service)\b/,
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
  const normalized = normalizeTariffLookupText(messageBody)
  return /\b(tarifa|tarifas|precio|precios|costo|costos|costaria|cotiza|cotizar|cotizacion|cuanto cuesta|cuanto sale|cuanto me costaria|descuento|rebaja|tercera edad|adulto mayor|mandar|enviar|enviear|enbiar|llevar|envio nacional|envio internacional|peso|pesa|pesan|kilo|kilos|kilogramo|kilogramos|ems|delivery|express)\b/.test(
    normalized,
  )
}

const hasDeclinedEmsDimensions = (messageBody) => {
  const normalized = normalizeTariffLookupText(messageBody)
  return /\b(no las tengo|no tengo las medidas|no se las medidas|no se las dimensiones|sin medidas|solo con el peso|cotiza solo con peso|cotiza sin medidas|continua solo con el peso)\b/.test(normalized)
}

const isEmsTariffFollowUp = (messageBody, recentConversation = '') => {
  const normalizedConversation = normalizeTariffLookupText(recentConversation)
  const hasRecentEmsSelection =
    /\b(ems nacional|ems internacional)\b/.test(normalizedConversation)
  const wasAskedForEmsData =
    hasRecentEmsSelection &&
    /\b(peso|dimensiones|alto|ancho|largo|pais de destino|departamento de destino|quieres cotizar ems)\b/.test(normalizedConversation)
  const normalizedMessage = normalizeTariffLookupText(messageBody)
  const isSimpleDestinationReply =
    wasAskedForEmsData &&
    /\b(pais de destino|departamento de bolivia)\b/.test(normalizedConversation) &&
    /^[a-z\s-]{2,40}$/.test(normalizedMessage) &&
    !/\b(ok|listo|gracias|perfecto|dale|bueno|no|si)\b/.test(normalizedMessage)

  return wasAskedForEmsData &&
    (
      Boolean(inferEmsCalculatorCategory(messageBody)) ||
      Boolean(inferEmsInternationalDestination(messageBody).destinationCode) ||
      getTariffPlaceMatchCount(messageBody) > 0 ||
      Boolean(extractTariffWeightKg(messageBody)) ||
      isEmsWeightReply(messageBody, recentConversation) ||
      isEmsWeightReplyMissingUnit(messageBody, recentConversation) ||
      Boolean(extractEmsPackageDimensions(messageBody)) ||
      hasDeclinedEmsDimensions(messageBody) ||
      isSimpleDestinationReply
    )
}

const isSeniorDiscountQuestion = (messageBody) => {
  const normalized = normalizeTariffLookupText(messageBody)
  return /\b(descuento|rebaja|beneficio|promocion)\b/.test(normalized) &&
    /\b(tercera edad|adulto mayor|mayor de edad|85 anos|85)\b/.test(normalized)
}

const isUnsupportedTariffServiceRequest = (messageBody) => {
  const normalized = normalizeTariffLookupText(messageBody)
  return /\b(nacional express|express nacional|nacional rapido|modalidad nacional express)\b/.test(normalized)
}

const isMultipleTariffQuoteRequest = (messageBody) => {
  const normalized = normalizeTariffLookupText(messageBody)
  const numberedItems = (normalized.match(/\b\d+\s*(?:\)|\.|-)/g) || []).length
  const packageMentions = (normalized.match(/\bpaquete\b/g) || []).length
  return (
    /\b(\d+)\s*(envios|paquetes|cotizaciones)\b/.test(normalized) ||
    /\b(desglose|total final|en un solo mensaje|al mismo tiempo)\b/.test(normalized) ||
    numberedItems >= 2 ||
    packageMentions >= 2
  )
}

const splitMultipleTariffItems = (messageBody) => {
  const normalized = normalizeReference(messageBody)
  const matches = [...normalized.matchAll(/(?:^|\s)(\d+)\s*[\).:-]\s*/g)]
  if (matches.length < 2) return []

  return matches.map((match, index) => {
    const start = match.index + match[0].length
    const end = matches[index + 1]?.index ?? normalized.length
    return normalized.slice(start, end).trim()
  }).filter(Boolean)
}

const summarizeTariffItemForDraft = (itemText, index) => {
  const weightKg = extractTariffWeightKg(itemText)
  const deliveryMode = inferDeliveryExpressMode(itemText)
  const serviceKey = inferTariffServiceKey(itemText) || (deliveryMode ? 'delivery_express' : '')
  const originKey = inferTariffOriginKey(itemText)
  const destinationKey = inferTariffDestinationKey(itemText, serviceKey)
  const missing = []
  const deliveryExpressMaxWeightKg = Number(botKnowledge.deliveryExpress?.limits?.maxWeightKg || 5)
  const invalidReason = serviceKey === 'delivery_express' && Number(weightKg) > deliveryExpressMaxWeightKg
    ? 'delivery_express_weight_exceeded'
    : serviceKey === 'delivery_express' && hasUnsupportedDeliveryExpressMode(itemText)
      ? 'unsupported_delivery_express_mode'
      : ''

  if (!originKey) missing.push('origen')
  if (!destinationKey) missing.push('destino')
  if (!weightKg) missing.push('peso')
  if (!invalidReason) {
    if (!serviceKey) missing.push('servicio: EMS Nacional e Internacional o Delivery Express')
    if (serviceKey === 'ems') missing.push('confirmar si se cotizara por EMS Nacional e Internacional o Delivery Express')
    if (serviceKey === 'delivery_express' && !deliveryMode) missing.push('modalidad Delivery Express')
  }

  const serviceLabel =
    serviceKey === 'ems'
      ? 'EMS Nacional e Internacional'
      : serviceKey === 'delivery_express'
        ? `Delivery Express${deliveryMode ? ` ${getDeliveryModeLabel(deliveryMode)}` : ''}`
        : 'servicio pendiente'

  return {
    index,
    originKey,
    destinationKey,
    weightKg,
    serviceKey,
    serviceLabel,
    missing,
    invalidReason,
    itemText,
  }
}

const formatMultipleTariffRoute = (summary) =>
  summary.originKey && summary.destinationKey
    ? `${summary.originKey.replaceAll('-', ' ')} a ${summary.destinationKey.replaceAll('-', ' ')}`
    : 'ruta incompleta'

const formatMultipleTariffWeight = (summary) =>
  summary.weightKg
    ? `${Number(summary.weightKg).toLocaleString('es-BO', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 3,
      })} kg`
    : 'peso pendiente'

const buildMultipleTariffQuotedLine = (summary, quote) => {
  const route = formatMultipleTariffRoute(summary)
  const weight = formatMultipleTariffWeight(summary)

  if (quote?.matched && quote.rate) {
    const price = formatTariffMoney(quote.rate.price, quote.rate.currency)
    const serviceName = normalizeTariffDisplayValue(quote.rate.service_name) || summary.serviceLabel
    const notes = normalizeReference(quote.rate.notes)
    return {
      line: `${summary.index}) ${route}, ${weight}, ${serviceName}: ${price}.${notes ? ` ${notes}` : ''}`,
      price: Number(quote.rate.price),
    }
  }

  return {
    line: `${summary.index}) ${route}, ${weight}, ${summary.serviceLabel}. Por el momento estoy consultando la tarifa para esa ruta; si la API no responde, debe confirmarse con un asesor.`,
    price: null,
  }
}

const buildMultipleTariffMissingQuestion = (summary) => {
  const route = formatMultipleTariffRoute(summary)
  const weight = formatMultipleTariffWeight(summary)

  if (summary.invalidReason === 'delivery_express_weight_exceeded') {
    const maxWeightKg = botKnowledge.deliveryExpress?.limits?.maxWeightKg || 5
    return `${summary.index}) ${route}, ${weight}, Delivery Express. Delivery Express solo aplica para paquetes de hasta ${maxWeightKg} kg; para ese peso corresponde cotizarlo por EMS Nacional e Internacional.`
  }

  if (summary.invalidReason === 'unsupported_delivery_express_mode') {
    return `${summary.index}) Sobre el paquete ${route} de ${weight} por Delivery Express, la modalidad indicada no existe. Las modalidades validas son: puerta a puerta, puerta a ventanilla o ventanilla a ventanilla. Confirmame cual corresponde para cotizarlo.`
  }

  if (summary.serviceKey === 'delivery_express' && summary.missing.includes('modalidad Delivery Express')) {
    return `${summary.index}) Sobre el paquete ${route} de ${weight} por Delivery Express, necesito que me especifiques la modalidad: puerta a puerta, puerta a ventanilla o ventanilla a ventanilla.`
  }

  if (summary.serviceKey === 'ems') {
    return `${summary.index}) Sobre el paquete ${route} de ${weight}, confirmame si se cotizara por EMS Nacional e Internacional o por Delivery Express.`
  }

  return `${summary.index}) ${route}, ${weight}, ${summary.serviceLabel}. Falta: ${summary.missing.join(', ')}.`
}

const buildMultipleTariffDraftReply = async (messageBody) => {
  const items = splitMultipleTariffItems(messageBody)
  if (!items.length) {
    return getResponseTemplate(
      'multipleTariffQuoteRequest',
      'Puedo ayudarte a cotizar varios envios, pero necesito tener origen, destino, peso y servicio de cada uno. Enviamelos numerados y los revisamos uno por uno.',
    )
  }

  const summaries = items.map((item, index) => summarizeTariffItemForDraft(item, index + 1))
  const quotedLines = []
  let quotedTotal = 0
  let quotedCount = 0

  for (const summary of summaries) {
    if (summary.invalidReason || summary.missing.length) {
      quotedLines.push(buildMultipleTariffMissingQuestion(summary))
      continue
    }

    const quote = await getTariffQuote({
      messageBody: summary.itemText,
      recentConversation: '',
      skipMultipleCheck: true,
    })
    const quoted = buildMultipleTariffQuotedLine(summary, quote)
    quotedLines.push(quoted.line)

    if (Number.isFinite(quoted.price)) {
      quotedTotal += quoted.price
      quotedCount += 1
    }
  }

  const hasPendingItems = summaries.some((summary) => summary.invalidReason || summary.missing.length)
  const totalLine = quotedCount
    ? hasPendingItems
      ? `Total parcial cotizado: ${formatTariffMoney(quotedTotal)}. No incluye los items pendientes.`
      : `Total final cotizado: ${formatTariffMoney(quotedTotal)}.`
    : ''

  return [
    'Puedo preparar la cotizacion de varios envios. Revise cada item asi:',
    ...quotedLines,
    totalLine,
    hasPendingItems ? 'Confirmame los datos faltantes y completo la cotizacion.' : '',
  ].join('\n')
}

const isRecentTariffConversation = (recentConversation = '') => {
  const normalized = normalizeTariffLookupText(recentConversation)
  return /\b(tarifa exacta|te cotizo|cotizo|ems nacional|delivery express|dime cual necesitas|servicio que buscas)\b/.test(
    normalized,
  )
}

const isTariffFollowUpMessage = (messageBody) => {
  const normalized = normalizeTariffLookupText(messageBody)
  return /\b(ems|delivery|express|expres|internacional|nacional|por ems|por delivery|por express|puerta|ventanilla(?:s)?|sucursal(?:es)?|oficina(?:s)?|dejo|dejar|recogen|recoger|retiran|retirar|tiempo|llegaria|llega|llegar|demora|tarda|tardaria|cuanto tarda|cuanto tiempo|\d+(?:\.\d+)?\s*(kg|kilo|kilos|gramo|gramos|g|gr))\b/.test(
    normalized,
  )
}

const isExplicitTrackingRequest = (messageBody) => {
  const normalized = normalizeIntentText(messageBody)
  return /\b(donde esta|ubicacion|ubicar|rastreo|rastrear|seguimiento|estado|numero de guia|nro guia|mi guia|codigo de seguimiento|trackear|tracking)\b/.test(
    normalized,
  )
}

const isTariffConversationContinuation = (messageBody, recentConversation = '') => {
  if (hasPackageCode(messageBody) || isExplicitTrackingRequest(messageBody)) {
    return false
  }

  if (!isRecentTariffConversation(recentConversation)) {
    return false
  }

  const normalized = normalizeTariffLookupText(messageBody)
  if (!normalized || /^(hola|buenas|buenos dias|buenas tardes|buenas noches|gracias|ok|listo)$/.test(normalized)) {
    return false
  }

  return true
}

const inferIntentHeuristically = (messageBody, recentConversation = '') => {
  const normalizedTariffText = normalizeTariffLookupText(messageBody)
  const looksLikeShipmentQuote =
    getTariffPlaceMatchCount(messageBody) >= 2 &&
    /\b(quiero|quisiera|necesito|mandar|enviar|enviear|enbiar|llevar)\b/.test(normalizedTariffText) &&
    /\b(paquete|paquetes|encomienda|envio)\b/.test(normalizedTariffText)

  if (looksLikeShipmentQuote && !hasPackageCode(messageBody)) {
    return 'TARIFAS'
  }

  if (
    isTariffConversationContinuation(messageBody, recentConversation) &&
    (isTariffFollowUpMessage(messageBody) || isPackageInquiryMessage(messageBody) || isTariffInquiryMessage(messageBody))
  ) {
    return 'TARIFAS'
  }

  if (isTariffConversationContinuation(messageBody, recentConversation)) {
    return 'TARIFAS'
  }

  if (isTariffInquiryMessage(messageBody) && !hasPackageCode(messageBody)) {
    return 'TARIFAS'
  }

  if (hasPackageCode(messageBody) || isPackageInquiryMessage(messageBody)) {
    return 'TRACKING'
  }

  if (isTariffInquiryMessage(messageBody)) {
    return 'TARIFAS'
  }

  return 'GENERAL'
}

const routeCustomerIntent = async ({ messageBody, recentConversation = '' }) => {
  const heuristicIntent = inferIntentHeuristically(messageBody, recentConversation)

  return {
    category: heuristicIntent,
    model: 'heuristic',
    source: 'heuristic',
  }
}

const normalizeTariffLookupText = (value) =>
  normalizeReference(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const inferTariffServiceKey = (messageBody) => {
  const normalized = normalizeTariffLookupText(messageBody)
  if (/\b(ems|prioritario)\b/.test(normalized)) return 'ems'
  if (/\b(delivery|express|expres|expreso|rapido|urgente)\b/.test(normalized)) return 'delivery_express'
  return ''
}

const isDeliveryExpressProvinceDestination = (messageBody) => {
  const normalized = normalizeTariffLookupText(messageBody)
  const keywords = Array.isArray(botKnowledge.deliveryExpress?.coverage?.provinceKeywords)
    ? botKnowledge.deliveryExpress.coverage.provinceKeywords
    : ['provincia', 'provincial', 'comunidad', 'municipio']
  return keywords.some((keyword) => {
    const normalizedKeyword = normalizeTariffLookupText(keyword)
    return normalizedKeyword && new RegExp(`\\b${normalizedKeyword}\\b`).test(normalized)
  })
}

const hasUnsupportedDeliveryExpressMode = (messageBody) => {
  const normalized = normalizeTariffLookupText(messageBody)
  return (
    /ventanil{1,2}a\s+a\s+puerta/.test(normalized) ||
    /ventanil{1,2}a\s+puerta/.test(normalized) ||
    /\b(sucursal(?:es)?|ventanil{1,2}a(?:s)?|oficina(?:s)?)\b.*\b(casa|domicilio|direccion|puerta)\b/.test(normalized)
  )
}

const inferDeliveryExpressMode = (messageBody) => {
  const normalized = normalizeTariffLookupText(messageBody)
  if (hasUnsupportedDeliveryExpressMode(messageBody)) {
    return ''
  }
  if (
    /puerta\s+a\s+puerta|puerta\s+puerta/.test(normalized) ||
    /\b(casa|domicilio|direccion)\b.*\b(casa|domicilio|direccion)\b/.test(normalized) ||
    /\brecog(?:er|ida|emos)?\b.*\b(casa|domicilio|direccion)\b.*\b(entreg(?:ar|a|uen)|llevar|llevamos)\b.*\b(casa|domicilio|direccion)\b/.test(normalized)
  ) {
    return 'puerta_a_puerta'
  }
  if (
    /ventanilla\s+a\s+ventanilla|ventanilla\s+ventanilla/.test(normalized) ||
    /\b(sucursal(?:es)?|ventanilla(?:s)?|oficina(?:s)?)\b.*\b(sucursal(?:es)?|ventanilla(?:s)?|oficina(?:s)?)\b/.test(normalized) ||
    /\b(dejo|dejar|dejaria|entrego|entregar)\b.*\b(sucursal(?:es)?|ventanilla(?:s)?|oficina(?:s)?)\b.*\b(recog(?:er|e|en|eria|erian|ieran|en)|recogen|retir(?:ar|a|an|en))\b.*\b(sucursal(?:es)?|ventanilla(?:s)?|oficina(?:s)?)\b/.test(normalized) ||
    /\b(recog(?:er|e|en|eria|erian|ieran|en)|recogen|retir(?:ar|a|an|en))\b.*\b(sucursal(?:es)?|ventanilla(?:s)?|oficina(?:s)?)\b/.test(normalized) && /\b(dejo|dejar|dejaria|entrego|entregar)\b.*\b(sucursal(?:es)?|ventanilla(?:s)?|oficina(?:s)?)\b/.test(normalized)
  ) {
    return 'ventanilla_a_ventanilla'
  }
  if (
    /puerta\s+a\s+ventanilla|puerta\s+ventanilla/.test(normalized) ||
    /\b(casa|domicilio|direccion)\b.*\b(sucursal(?:es)?|ventanilla(?:s)?|oficina(?:s)?)\b/.test(normalized) ||
    /\brecog(?:er|ida|emos)?\b.*\b(casa|domicilio|direccion)\b.*\b(sucursal(?:es)?|ventanilla(?:s)?|oficina(?:s)?)\b/.test(normalized) ||
    /\b(recog\w*|retir\w*)\b.*\b(entreg\w*|llevar\w*)\b.*\b(sucursal(?:es)?|ventanilla(?:s)?|oficina(?:s)?)\b/.test(normalized)
  ) {
    return 'puerta_a_ventanilla'
  }
  return ''
}

const inferRecentCustomerTariffServiceKey = (recentConversation = '') => {
  const customerMessages = normalizeReference(recentConversation)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^Cliente:/i.test(line))
    .map((line) => line.replace(/^Cliente:\s*/i, ''))
    .reverse()

  for (const message of customerMessages) {
    const serviceKey = inferTariffServiceKey(message)
    if (serviceKey) return serviceKey
  }

  return ''
}

const getRecentCustomerConversationText = (recentConversation = '') =>
  normalizeReference(recentConversation)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^Cliente:/i.test(line))
    .map((line) => line.replace(/^Cliente:\s*/i, ''))
    .join('\n')

const getRecentCustomerTariffRouteText = (recentConversation = '') => {
  const customerMessages = normalizeReference(recentConversation)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^Cliente:/i.test(line))
    .map((line) => line.replace(/^Cliente:\s*/i, ''))
    .reverse()

  return (
    customerMessages.find((message) => {
      const normalized = normalizeTariffLookupText(message)
      const matchedCities = tariffDestinationAliases.filter((place) =>
        place.terms.some((term) => normalized.includes(term)),
      )
      return isTariffInquiryMessage(message) && matchedCities.length >= 2
    }) ?? ''
  )
}

const inferRecentQuotedDeliveryMode = (recentConversation = '') => {
  const outboundMessages = normalizeReference(recentConversation)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^Equipo:/i.test(line))
    .map((line) => line.replace(/^Equipo:\s*/i, ''))
    .reverse()

  for (const message of outboundMessages) {
    const normalized = normalizeTariffLookupText(message)
    if (normalized.includes('puerta a puerta')) return 'puerta_a_puerta'
    if (normalized.includes('puerta a ventanilla')) return 'puerta_a_ventanilla'
    if (normalized.includes('ventanilla a ventanilla')) return 'ventanilla_a_ventanilla'
  }

  return ''
}

const inferRecentQuotedTariffContext = (recentConversation = '') => {
  const outboundMessages = normalizeReference(recentConversation)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^Equipo:/i.test(line))
    .map((line) => line.replace(/^Equipo:\s*/i, ''))
    .reverse()

  const quotedMessage = outboundMessages.find((message) => {
    const normalized = normalizeTariffLookupText(message)
    return normalized.startsWith('la tarifa ') || normalized.startsWith('para servicio ')
  })

  if (!quotedMessage) {
    return {
      originKey: '',
      destinationKey: '',
      deliveryMode: '',
      text: '',
    }
  }

  return {
    originKey: inferTariffOriginKey(quotedMessage),
    destinationKey: inferTariffDestinationKey(quotedMessage, 'delivery_express'),
    deliveryMode: inferDeliveryExpressMode(quotedMessage),
    text: quotedMessage,
  }
}

const isTariffDeliveryTimeQuestion = (messageBody) => {
  const normalized = normalizeTariffLookupText(messageBody)
  if (/\bal mismo tiempo\b|\bmismo tiempo\b/.test(normalized)) return false
  return /\b(tiempo|llegaria|llega|llegar|demora|tarda|tardaria|cuanto tarda|cuanto tiempo)\b/.test(normalized)
}

const tariffDestinationAliases = [
  { key: 'la-paz', terms: ['la paz', 'lapaz', 'el alto', 'lp'] },
  { key: 'cochabamba', terms: ['cochabamba', 'cbba', 'cocha'] },
  { key: 'santa-cruz', terms: ['santa cruz', 'santacruz', 'santa cruz de la sierra', 'scz'] },
  { key: 'oruro', terms: ['oruro'] },
  { key: 'potosi', terms: ['potosi'] },
  { key: 'tarija', terms: ['tarija'] },
  { key: 'sucre', terms: ['sucre', 'chuquisaca'] },
  { key: 'beni', terms: ['beni', 'trinidad'] },
  { key: 'pando', terms: ['pando', 'cobija'] },
  { key: 'internacional', terms: ['internacional', 'exterior', 'afuera', 'otro pais'] },
]

const getTariffPlaceMatchCount = (messageBody) => {
  const normalized = normalizeTariffLookupText(messageBody)
  return tariffDestinationAliases.filter((place) =>
    place.terms.some((term) => normalized.includes(term)),
  ).length
}

const isTariffRouteChangeQuestion = (messageBody) => {
  const normalized = normalizeTariffLookupText(messageBody)
  if (inferDeliveryExpressMode(messageBody)) return false
  const matchedCities = tariffDestinationAliases.filter((place) =>
    place.terms.some((term) => normalized.includes(term)),
  )
  return matchedCities.length >= 2 && /\b(y si|si quiero|quiero mandar|quiero enviar|mandar|enviar|llevar)\b/.test(normalized)
}

const isNewPackageTariffQuestion = (messageBody) => {
  const normalized = normalizeTariffLookupText(messageBody)
  const matchedCities = getTariffPlaceMatchCount(messageBody)
  return matchedCities >= 2 && /\b(otro paquete|otra cotizacion|otra tarifa|ahora tambien|tambien tengo|nuevo paquete)\b/.test(normalized)
}

const inferTariffDestinationKey = (messageBody, serviceKey = '') => {
  const normalized = normalizeTariffLookupText(messageBody)
  const matchedDestination = tariffDestinationAliases
    .map((destination) => ({
      destination,
      position: Math.max(...destination.terms.map((term) => normalized.lastIndexOf(term))),
    }))
    .filter((match) => match.position >= 0)
    .sort((first, second) => second.position - first.position)[0]?.destination

  if (matchedDestination) return matchedDestination.key
  if (serviceKey === 'internacional') return 'internacional'
  if (serviceKey === 'ems' || serviceKey === 'delivery_express') return 'nacional'
  return ''
}

const inferTariffOriginKey = (messageBody) => {
  const normalized = normalizeTariffLookupText(messageBody)
  const matchedOrigin = tariffDestinationAliases
    .map((origin) => ({
      origin,
      position: Math.min(...origin.terms.map((term) => normalized.indexOf(term)).filter((position) => position >= 0)),
    }))
    .filter((match) => Number.isFinite(match.position))
    .sort((first, second) => first.position - second.position)[0]?.origin

  return matchedOrigin?.key ?? ''
}

const tariffPlaceMatchesKey = (value, key = '') => {
  const normalized = normalizeTariffLookupText(value)
  const normalizedKey = normalizeTariffLookupText(key)
  const place = tariffDestinationAliases.find((candidate) => candidate.key === key)

  if (!normalizedKey || !normalized) return true
  if (normalized.includes(normalizedKey)) return true

  return Boolean(place?.terms.some((term) => normalized.includes(normalizeTariffLookupText(term))))
}

const extractExternalTariffRates = (payload) => {
  if (Array.isArray(payload)) return payload

  const candidates = [
    payload?.data,
    payload?.items,
    payload?.tarifas,
    payload?.rates,
    payload?.results,
    payload?.data?.data,
    payload?.data?.items,
    payload?.data?.tarifas,
  ]

  return candidates.find((candidate) => Array.isArray(candidate)) ?? []
}

const getExternalDeliveryExpressPrice = (rate) =>
  rate.price ??
  rate.precio ??
  rate.amount ??
  rate.monto ??
  rate.tarifa ??
  rate.peso1

const getExternalTariffServiceName = (rate, serviceKey, deliveryMode, fallback = '') => {
  if (serviceKey === 'delivery_express') {
    const modeLabel = getDeliveryModeLabel(deliveryMode)
    return modeLabel ? `Delivery Express ${modeLabel}` : 'Delivery Express'
  }

  return (
    rate.service_name ??
    rate.servicio_extra?.nombre ??
    rate.servicio_extra?.descripcion ??
    rate.servicio ??
    fallback
  )
}

const deliveryExpressModeMatchesApiRate = (rateService, deliveryMode) => {
  const normalizedService = normalizeTariffLookupText(rateService)
  const modeTerms = {
    puerta_a_puerta: ['puerta a puerta', 'servicio puerta a puerta', 'de puerta a puerta'],
    puerta_a_ventanilla: ['puerta a ventanilla', 'servicio de puerta a ventanilla'],
    ventanilla_a_ventanilla: ['ventanilla a ventanilla', 'servicio de ventanilla a ventanilla'],
  }

  if (!deliveryMode) return true
  return (modeTerms[deliveryMode] || [deliveryMode.replaceAll('_', ' ')]).some((term) =>
    normalizedService.includes(normalizeTariffLookupText(term)),
  )
}

const deliveryExpressApiRateMatches = ({ rate, originKey, destinationKey, deliveryMode }) => {
  const rateOrigin = normalizeTariffLookupText(
    rate.origen?.nombre_origen ??
      rate.origin_name ??
      rate.origin_key ??
      rate.origen ??
      '',
  )
  const rateDestination = normalizeTariffLookupText(
    rate.destino?.nombre_destino ??
      rate.destination_name ??
      rate.destination_key ??
      rate.destino ??
      '',
  )
  const rateService = normalizeTariffLookupText(
    rate.servicio_extra?.nombre ??
      rate.servicio_extra?.descripcion ??
      rate.service_name ??
      rate.service_key ??
      rate.servicio ??
      '',
  )
  const price = Number(getExternalDeliveryExpressPrice(rate))

  return (
    Number.isFinite(price) &&
    tariffPlaceMatchesKey(rateOrigin, originKey) &&
    tariffPlaceMatchesKey(rateDestination, destinationKey) &&
    deliveryExpressModeMatchesApiRate(rateService, deliveryMode)
  )
}

const emsNationalApiRateMatches = ({ rate, weightKg }) => {
  const minWeight = Number(
    rate.min_weight_kg ??
      rate.peso_minimo ??
      rate.pesoMinimo ??
      rate.peso?.peso_inicial ??
      0,
  )
  const maxWeight = Number(
    rate.max_weight_kg ??
      rate.peso_maximo ??
      rate.pesoMaximo ??
      rate.peso?.peso_final ??
      Number.MAX_SAFE_INTEGER,
  )

  return Number(weightKg) >= minWeight && Number(weightKg) <= maxWeight
}

const getExternalEmsNationalServiceName = (rate, fallback = '') =>
  normalizeTariffDisplayValue(
    rate.service_name ??
      rate.servicio?.descripcion ??
      rate.servicio?.nombre_servicio ??
      rate.servicio ??
      fallback,
  )

const getTariffQuote = async ({ messageBody, recentConversation = '', skipMultipleCheck = false }) => {
  const nearestDestinationAlternative =
    getNearestConfiguredEmsDestination(messageBody) ||
    getNearestConfiguredEmsDestination(getRecentCustomerConversationText(recentConversation))
  const acceptedDestinationAlternative = nearestDestinationAlternative &&
    isEmsAlternativeDestinationAcceptance({
      text: messageBody,
      conversation: recentConversation,
      destinationName: nearestDestinationAlternative.name,
    })
  const selectedDestinationAlternative = acceptedDestinationAlternative
    ? nearestDestinationAlternative
    : getAcceptedEmsAlternativeDestination(recentConversation)

  if (!skipMultipleCheck && isMultipleTariffQuoteRequest(messageBody)) {
    return {
      matched: false,
      missingFields: [],
      invalidReason: 'multiple_tariff_quote_request',
      weightKg: null,
      serviceKey: '',
      originKey: '',
      destinationKey: '',
      deliveryMode: '',
      effectiveDeliveryMode: '',
      requestedDeliveryTime: false,
      isNewPackageQuestion: false,
    }
  }

  if (isUnsupportedEmsInternationalShipmentRequest(messageBody) && !acceptedDestinationAlternative) {
    return {
      matched: false,
      missingFields: [],
      invalidReason: 'unsupported_international_destination',
      alternativeDestination: nearestDestinationAlternative,
      weightKg: null,
      serviceKey: 'ems',
      originKey: inferTariffOriginKey(messageBody),
      destinationKey: 'china',
      emsCategory: 'EMS INT',
      deliveryMode: '',
      effectiveDeliveryMode: '',
      requestedDeliveryTime: false,
      isNewPackageQuestion: false,
    }
  }

  if (isUnsupportedTariffServiceRequest(messageBody)) {
    return {
      matched: false,
      missingFields: [],
      invalidReason: 'unsupported_tariff_service',
      weightKg: null,
      serviceKey: '',
      originKey: inferTariffOriginKey(messageBody),
      destinationKey: inferTariffDestinationKey(messageBody),
      deliveryMode: '',
      effectiveDeliveryMode: '',
      requestedDeliveryTime: false,
      isNewPackageQuestion: false,
    }
  }

  if (isSeniorDiscountQuestion(messageBody)) {
    return {
      matched: false,
      missingFields: [],
      invalidReason: 'senior_discount_unavailable',
      weightKg: null,
      serviceKey: '',
      originKey: inferTariffOriginKey(messageBody),
      destinationKey: inferTariffDestinationKey(messageBody),
      deliveryMode: '',
      effectiveDeliveryMode: '',
      requestedDeliveryTime: false,
      isNewPackageQuestion: false,
    }
  }

  const lookupText = [recentConversation, messageBody].filter(Boolean).join('\n')
  const customerLookupText = [getRecentCustomerConversationText(recentConversation), messageBody]
    .filter(Boolean)
    .join('\n')
  const recentCustomerRouteText = getRecentCustomerTariffRouteText(recentConversation)
  const routeLookupText = recentCustomerRouteText || messageBody
  const currentWeightKg = extractTariffWeightKg(messageBody)
  const recentWeightKg = extractTariffWeightKg(customerLookupText)
  const currentDeliveryMode = inferDeliveryExpressMode(messageBody)
  const currentServiceKey = inferTariffServiceKey(messageBody)
  const recentCustomerServiceKey = inferRecentCustomerTariffServiceKey(recentConversation)
  const isFreshInternationalShipmentRequest =
    isEmsInternationalShipmentRequest(messageBody) || Boolean(acceptedDestinationAlternative)
  const recentEmsFollowUpCategory = isEmsTariffFollowUp(messageBody, recentConversation)
    ? inferEmsCategoryFromPendingPrompt(recentConversation)
    : ''
  const needsEmsWeightUnitClarification = isEmsWeightReplyMissingUnit(messageBody, recentConversation)
  const calculatorText = selectedDestinationAlternative
    ? `Quiero enviar un paquete por EMS Internacional a ${selectedDestinationAlternative.name}`
    : isFreshInternationalShipmentRequest
      ? messageBody
      : [customerLookupText, messageBody].filter(Boolean).join('\n')
  const emsCalculatorEndpoint = getEmsCalculatorEndpoint()
  const recentQuotedTariffContext = inferRecentQuotedTariffContext(recentConversation)
  const recentQuotedDeliveryMode = recentQuotedTariffContext.deliveryMode || inferRecentQuotedDeliveryMode(recentConversation)
  const requestedDeliveryTime = isTariffDeliveryTimeQuestion(messageBody)
  const isRouteChangeQuestion = isTariffRouteChangeQuestion(messageBody)
  const isNewPackageQuestion = isNewPackageTariffQuestion(messageBody)
  const currentRoutePlaceCount = getTariffPlaceMatchCount(messageBody)
  const isFreshShipmentRequestWithoutService = isFreshEmsRouteQuoteRequest({
    text: messageBody,
    routePlaceCount: currentRoutePlaceCount,
    hasService: Boolean(currentServiceKey || currentDeliveryMode),
  })
  const shouldTreatAsFreshRoute =
    isFreshInternationalShipmentRequest ||
    (currentRoutePlaceCount >= 2 && (currentServiceKey || currentDeliveryMode || isTariffInquiryMessage(messageBody)))
  const weightKg = needsEmsWeightUnitClarification
    ? null
    : currentWeightKg || (shouldTreatAsFreshRoute && !isRouteChangeQuestion ? null : recentWeightKg)
  const deliveryExpressMaxWeightKg = Number(botKnowledge.deliveryExpress?.limits?.maxWeightKg || 5)
  const hasSelectedEmsCategory =
    currentServiceKey === 'ems' ||
    recentCustomerServiceKey === 'ems' ||
    Boolean(recentEmsFollowUpCategory)
  const shouldRouteOversizedPackageToEms = shouldForceEmsForWeightLimit({
    weightKg,
    maxWeightKg: deliveryExpressMaxWeightKg,
    emsAlreadySelected: hasSelectedEmsCategory,
  })
  const shouldAskServiceForCurrentRoute =
    isTariffInquiryMessage(messageBody) &&
    currentRoutePlaceCount >= 2 &&
    !currentServiceKey &&
    !currentDeliveryMode &&
    (!recentCustomerServiceKey || isFreshShipmentRequestWithoutService) &&
    !requestedDeliveryTime
  const currentModeNeedsRoute = Boolean(currentDeliveryMode) && !requestedDeliveryTime && currentRoutePlaceCount < 2 && !recentCustomerRouteText
  const isNewTariffQuestionWithoutService =
    isTariffInquiryMessage(messageBody) && !currentServiceKey && !currentDeliveryMode
  const serviceKey = resolveTariffServiceKey({
    currentServiceKey,
    isFreshInternationalShipmentRequest,
    recentEmsFollowUpCategory,
    shouldRouteOversizedPackageToEms,
    currentDeliveryMode,
    isFreshShipmentRequestWithoutService,
    shouldAskServiceForCurrentRoute,
    isNewPackageQuestion,
    isRouteChangeQuestion,
    recentCustomerServiceKey,
    isNewTariffQuestionWithoutService,
    inferredServiceKey: inferTariffServiceKey(lookupText),
  })
  const emsCategory = serviceKey === 'ems'
    ? inferEmsQuoteCategory({
        messageBody,
        recentNationalRoute: recentCustomerRouteText,
        pendingCategory: recentEmsFollowUpCategory,
        calculatorText,
        oversizedPackage: shouldRouteOversizedPackageToEms,
      })
    : ''
  const emsInternationalDestination = emsCategory === 'EMS INT'
    ? inferEmsInternationalDestination(calculatorText)
    : { destinationCode: '', countryName: '', specificPlace: '' }
  const emsDimensionsText = isNewPackageQuestion ? messageBody : calculatorText
  const emsDimensions = extractEmsPackageDimensions(emsDimensionsText)
  const deliveryMode =
    serviceKey === 'delivery_express'
      ? currentDeliveryMode || (currentServiceKey ? '' : inferDeliveryExpressMode(messageBody) || inferDeliveryExpressMode(customerLookupText))
      : ''
  const effectiveDeliveryMode =
    serviceKey === 'delivery_express' && requestedDeliveryTime
      ? recentQuotedDeliveryMode || deliveryMode
      : serviceKey === 'delivery_express' && isRouteChangeQuestion
        ? deliveryMode || recentQuotedDeliveryMode
      : deliveryMode
  const effectiveRouteLookupText = requestedDeliveryTime
    ? recentQuotedTariffContext.text || routeLookupText
    : isFreshInternationalShipmentRequest || shouldAskServiceForCurrentRoute || isNewPackageQuestion || isRouteChangeQuestion || currentModeNeedsRoute
      ? messageBody
      : recentCustomerRouteText || routeLookupText
  const originKey = requestedDeliveryTime && recentQuotedTariffContext.originKey
    ? recentQuotedTariffContext.originKey
    : inferTariffOriginKey(effectiveRouteLookupText)
  const detectedDestinationKey = requestedDeliveryTime && recentQuotedTariffContext.destinationKey
    ? recentQuotedTariffContext.destinationKey
    : inferTariffDestinationKey(effectiveRouteLookupText, serviceKey)
  const destinationKey = serviceKey === 'ems' && emsCategory === 'EMS INT'
    ? emsInternationalDestination.countryName
    : detectedDestinationKey
  const emsCalculatorDestinationCode = serviceKey === 'ems'
    ? inferEmsCalculatorDestinationCode({
        category: emsCategory,
        text: calculatorText,
        destinationKey,
      })
    : ''
  const quotedWeightKg = serviceKey === 'delivery_express' ? (weightKg || 1) : weightKg
  const missingFields = []

  if (serviceKey && !quotedWeightKg) missingFields.push('peso')
  if (serviceKey !== 'ems' && !originKey) missingFields.push('origen')
  if (
    serviceKey !== 'ems' &&
    !destinationKey
  ) missingFields.push('destino')
  if (!serviceKey) missingFields.push('servicio')
  if (serviceKey === 'ems' && !emsCategory) {
    missingFields.push('EMS Nacional o EMS Internacional')
  }
  if (serviceKey === 'ems' && !emsCalculatorDestinationCode) {
    missingFields.push(emsCategory === 'EMS INT' ? 'pais de destino' : 'departamento de destino')
  }
  if (serviceKey === 'delivery_express' && !effectiveDeliveryMode) missingFields.push('tipo de servicio Delivery Express (puerta a puerta, puerta a ventanilla o ventanilla a ventanilla)')

  if (serviceKey === 'delivery_express' && isDeliveryExpressProvinceDestination(messageBody)) {
    return {
      matched: false,
      missingFields: [],
      invalidReason: 'delivery_express_province_destination',
      weightKg,
      serviceKey,
      originKey,
      destinationKey,
      deliveryMode,
      effectiveDeliveryMode,
      requestedDeliveryTime,
      isNewPackageQuestion: false,
    }
  }

  if (serviceKey === 'delivery_express' && Number(weightKg) > deliveryExpressMaxWeightKg) {
    return {
      matched: false,
      missingFields: [],
      invalidReason: 'delivery_express_weight_exceeded',
      weightKg,
      serviceKey,
      originKey,
      destinationKey,
      deliveryMode,
      effectiveDeliveryMode,
      requestedDeliveryTime,
      isNewPackageQuestion: false,
    }
  }

  if (serviceKey === 'delivery_express' && hasUnsupportedDeliveryExpressMode(messageBody)) {
    return {
      matched: false,
      missingFields: [],
      invalidReason: 'unsupported_delivery_express_mode',
      weightKg,
      serviceKey,
      originKey,
      destinationKey,
      deliveryMode,
      effectiveDeliveryMode,
      requestedDeliveryTime,
      isNewPackageQuestion: false,
    }
  }

  if (serviceKey === 'delivery_express' && isDeliveryExpressDimensionQuestion(messageBody)) {
    return {
      matched: false,
      missingFields: [],
      invalidReason: 'delivery_express_dimensions_policy',
      weightKg,
      serviceKey,
      originKey,
      destinationKey,
      deliveryMode,
      effectiveDeliveryMode,
      requestedDeliveryTime,
      isNewPackageQuestion: false,
    }
  }

  if (missingFields.length > 0) {
    return {
      matched: false,
      missingFields,
      weightKg,
      serviceKey,
      originKey,
      destinationKey,
      deliveryMode,
      effectiveDeliveryMode,
      requestedDeliveryTime,
      isRouteChangeQuestion,
      needsEmsWeightUnitClarification,
      emsCategory,
      emsCalculatorDestinationCode,
      isNewPackageQuestion: isNewPackageQuestion || shouldAskServiceForCurrentRoute,
    }
  }

  if (serviceKey === 'ems') {
    try {
      const calculation = await calculateEmsTariff({
        category: emsCategory,
        destination: emsCalculatorDestinationCode,
        weight: quotedWeightKg,
        dimensions: emsDimensions ?? undefined,
        endpoint: emsCalculatorEndpoint,
      })
      const emsInternationalZone = emsCategory === 'EMS INT'
        ? getEmsInternationalZone(emsCalculatorDestinationCode)
        : ''
      const notes = [
        emsInternationalZone ? `Destino clasificado en la zona ${emsInternationalZone}.` : '',
        'Tarifa referencial; en sucursal verificaran el peso y las medidas reales del paquete.',
        emsInternationalDestination.specificPlace
          ? `Para cobertura y entrega en ${emsInternationalDestination.specificPlace}, confirma con el operador postal del pais de destino (${emsInternationalDestination.countryName}).`
          : '',
      ].filter(Boolean).join(' ')
      return {
        matched: true,
        missingFields: [],
        weightKg,
        serviceKey,
        deliveryExpressWeightExceeded: shouldRouteOversizedPackageToEms,
        emsCategory,
        emsDimensions,
        emsSpecificPlace: emsInternationalDestination.specificPlace,
        emsCountryName: emsInternationalDestination.countryName,
        originKey: originKey || 'Bolivia',
        destinationKey,
        deliveryMode: '',
        requestedDeliveryTime,
        rate: {
          service_name: emsCategory === 'EMS INT' ? 'EMS Internacional' : 'EMS Nacional',
          origin_name: originKey ? originKey.replaceAll('-', ' ') : 'Bolivia',
          destination_name: destinationKey
            ? destinationKey.replaceAll('-', ' ')
            : emsCalculatorDestinationCode.replace(/^dest_a_/, '').replaceAll('_', ' '),
          price: calculation.tariff,
          currency: 'BOB',
          notes,
        },
      }
    } catch (error) {
      console.warn('No se pudo calcular la tarifa EMS:', error?.code ?? 'unknown_error')
      return {
        matched: false,
        missingFields: [],
        weightKg,
        serviceKey,
        deliveryExpressWeightExceeded: shouldRouteOversizedPackageToEms,
        emsCategory,
        originKey: originKey || 'Bolivia',
        destinationKey,
        deliveryMode: '',
        requestedDeliveryTime,
        invalidReason: 'ems_calculator_error',
        calculatorErrorCode: error?.code ?? 'unknown_error',
      }
    }
  }

  const externalProfile = getTariffApiProfiles().find((profile) => profile.serviceKey === serviceKey)
  if (externalProfile?.endpoint && externalProfile.token) {
    try {
      const response = await fetch(externalProfile.endpoint, {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${externalProfile.token}`,
        },
        signal: AbortSignal.timeout(10000),
      })
      if (response.ok) {
        const payload = await response.json()
        const externalRates = extractExternalTariffRates(payload)
        const externalRate = externalRates.find((rate) => {
          if (serviceKey === 'delivery_express') {
            return deliveryExpressApiRateMatches({
              rate,
              originKey,
              destinationKey,
              deliveryMode: effectiveDeliveryMode,
            })
          }
          if (serviceKey === 'ems') {
            return emsNationalApiRateMatches({ rate, weightKg: quotedWeightKg })
          }

          const minWeight = Number(rate.min_weight_kg ?? rate.peso_minimo ?? rate.pesoMinimo ?? 0)
          const maxWeight = Number(rate.max_weight_kg ?? rate.peso_maximo ?? rate.pesoMaximo ?? Number.MAX_SAFE_INTEGER)
          const rateDestination = normalizeTariffLookupText(
            rate.destination_key ??
              rate.destino?.nombre_destino ??
              rate.destino ??
              rate.destination?.nombre ??
              rate.destination ??
              '',
          )
          const rateOrigin = normalizeTariffLookupText(
            rate.origin_key ??
              rate.origen?.nombre_origen ??
              rate.origen ??
              rate.origin?.nombre ??
              rate.origin ??
              '',
          )
          const rateService = normalizeTariffLookupText(
            rate.service_key ??
              rate.service ??
              rate.service_name ??
              rate.tipo_servicio ??
              rate.servicio_extra?.nombre ??
              rate.servicio_extra?.descripcion ??
              '',
          )
          const modeMatches = !effectiveDeliveryMode || !rateService || rateService.includes(effectiveDeliveryMode.replaceAll('_', ' ')) || rateService.includes(effectiveDeliveryMode.replaceAll('_', '-'))
          const originMatches = !originKey || tariffPlaceMatchesKey(rateOrigin, originKey)
          const destinationMatches = !destinationKey || tariffPlaceMatchesKey(rateDestination, destinationKey)
          return quotedWeightKg >= minWeight && quotedWeightKg <= maxWeight && modeMatches && originMatches && destinationMatches
        })
        if (externalRate) {
          return {
            matched: true,
            missingFields: [],
            weightKg,
            serviceKey,
            originKey,
            destinationKey,
            deliveryMode: effectiveDeliveryMode,
            requestedDeliveryTime,
            rate: {
              ...externalRate,
              service_name:
                serviceKey === 'ems'
                  ? getExternalEmsNationalServiceName(externalRate, externalProfile.serviceName)
                  : getExternalTariffServiceName(
                      externalRate,
                      serviceKey,
                      effectiveDeliveryMode,
                      externalProfile.serviceName,
                    ),
              origin_name:
                externalRate.origin_name ??
                externalRate.origen?.nombre_origen ??
                externalRate.origen ??
                originKey,
              destination_name:
                externalRate.destination_name ??
                externalRate.destino?.nombre_destino ??
                externalRate.destino ??
                destinationKey,
              price:
                serviceKey === 'delivery_express'
                  ? getExternalDeliveryExpressPrice(externalRate)
                  : externalRate.price ??
                    externalRate.precio ??
                    externalRate.amount ??
                    externalRate.monto ??
                    externalRate.peso1,
              currency: externalRate.currency ?? externalRate.moneda ?? 'BOB',
              notes: externalRate.notes ?? externalRate.observaciones ?? '',
              delivery_time_hours:
                externalRate.delivery_time_hours ??
                externalRate.tiempo_entrega ??
                externalRate.tiempoEntrega ??
                externalRate.delivery_time ??
                externalRate.tiempo,
            },
          }
        }
      }
    } catch (error) {
      console.warn(`No se pudo consultar ${externalProfile.serviceName}:`, error?.message ?? error)
    }
  }

  const tariffResult = await pool.query(
    `
      select id, service_key, service_name, destination_key, destination_name,
             min_weight_kg, max_weight_kg, price, currency, notes
      from tariff_rates
      where is_active = true
        and service_key = $1
        and (
          destination_key = $2
          or destination_key = 'nacional'
          or exists (
            select 1
            from jsonb_array_elements_text(destination_aliases) as alias(value)
            where lower(alias.value) = $2
          )
        )
        and $3::numeric >= min_weight_kg
        and $3::numeric <= max_weight_kg
        and (
          $4::text = ''
          or service_key <> 'delivery_express'
          or lower(service_name) like '%' || replace($4::text, '_', ' ') || '%'
          or lower(service_name) like '%' || replace($4::text, '_', '-') || '%'
        )
      order by
        case when destination_key = $2 then 0 else 1 end,
        max_weight_kg asc
      limit 1;
    `,
    [serviceKey, destinationKey, quotedWeightKg, effectiveDeliveryMode || ''],
  )

  return {
    matched: Boolean(tariffResult.rows[0]),
    missingFields: [],
    weightKg,
    serviceKey,
    originKey,
    destinationKey,
    deliveryMode: effectiveDeliveryMode,
    requestedDeliveryTime,
    rate: tariffResult.rows[0] ?? null,
  }
}

const formatTariffMoney = (value, currency = 'BOB') => {
  const amount = Number(value)
  if (!Number.isFinite(amount)) return ''

  return new Intl.NumberFormat('es-BO', {
    style: 'currency',
    currency: normalizeReference(currency) || 'BOB',
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

const normalizeTariffDisplayValue = (value) => {
  if (value && typeof value === 'object') {
    return normalizeReference(
      value.nombre ||
        value.name ||
        value.descripcion ||
        value.description ||
        value.label ||
        value.value ||
        '',
    )
  }
  return normalizeReference(value)
}

const getDeliveryModeLabel = (deliveryMode = '') => {
  return normalizeReference(botKnowledge.deliveryExpress?.modes?.[deliveryMode]?.label) || 'Delivery Express'
}

const getResponseTemplate = (key, fallback = '') => normalizeReference(botKnowledge.responses?.tariffs?.[key]) || fallback
const getResponseLinesTemplate = (key, fallback = []) => {
  const lines = botKnowledge.responses?.tariffs?.[key]
  return (Array.isArray(lines) ? lines : fallback).join('\n')
}

const tariffReplyTemplates = {
  exactQuote: getResponseTemplate('exactQuote', '{intro} {quote}'),
  genericMissingFields: getResponseLinesTemplate('genericMissingFields', [
    'Para darte la tarifa exacta de tu envio, ayudame con el peso del paquete y el servicio que buscas:',
    '• EMS Nacional e Internacional: Envios dentro y fuera del pais por peso.',
    '• Delivery Express: Entrega rapida de paquetes a nivel nacional; no aplica para provincia ni para paquetes que excedan los 5 kg. Si supera ese peso, debe enviarse por EMS Nacional.',
    '¡Dime cual necesitas y te doy el precio de inmediato!',
  ]),
  deliveryModeOptions: getResponseLinesTemplate('deliveryModeOptions', [
    'Perfecto, Delivery Express. Para darte el precio exacto, indicame la modalidad:',
    '• Puerta a puerta: recogemos el paquete en tu casa y lo llevamos a la casa destino en cualquier departamento.',
    '• Puerta a ventanilla: recogemos el paquete en tu casa y lo llevamos a ventanilla de cualquier sucursal.',
    '• Ventanilla a ventanilla: dejas el paquete en una sucursal y lo recogen en ventanilla de cualquier sucursal.',
  ]),
}

const renderTextTemplate = (template, values = {}) =>
  normalizeReference(template).replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, key) =>
    normalizeReference(values[key]),
  ).replace(/\s+\./g, '.').replace(/\s+/g, ' ').trim()

const hasHomePickupNeed = (messageBody) => {
  const normalized = normalizeTariffLookupText(messageBody)
  return (
    /\b(no puedo|no podria|no puedo cargar|pesad[oa]|mayor de edad|adulto mayor|persona mayor)\b/.test(normalized) ||
    /\brecog\w*\b.*\b(casa|domicilio|direccion)\b/.test(normalized)
  )
}

const buildPersonalizedTariffIntro = ({ tariffQuote, messageBody = '' }) => {
  if (tariffQuote?.serviceKey !== 'delivery_express') return ''

  if (tariffQuote.deliveryMode === 'puerta_a_puerta' && hasHomePickupNeed(messageBody)) {
    return normalizeReference(botKnowledge.responses?.personalizedIntros?.deliveryHomePickupNeed) ||
      'Claro, para ese caso te conviene Delivery Express puerta a puerta: recogemos el paquete en tu casa y lo entregamos en el domicilio destino.'
  }

  if (tariffQuote.deliveryMode === 'puerta_a_ventanilla') {
    return normalizeReference(botKnowledge.responses?.personalizedIntros?.deliveryDoorToCounter) ||
      'Perfecto, con Delivery Express puerta a ventanilla recogemos el paquete en tu casa y lo dejamos disponible en una sucursal destino.'
  }

  if (tariffQuote.deliveryMode === 'ventanilla_a_ventanilla') {
    return normalizeReference(botKnowledge.responses?.personalizedIntros?.deliveryCounterToCounter) ||
      'Perfecto, con Delivery Express ventanilla a ventanilla dejas el paquete en una sucursal y lo recogen en una sucursal destino.'
  }

  return ''
}

const buildTariffReply = async (tariffQuote, { messageBody = '' } = {}) => {
  if (!tariffQuote) return ''

  if (tariffQuote.missingFields?.length > 0) {
    if (tariffQuote.serviceKey === 'ems') {
      if (tariffQuote.missingFields.includes('EMS Nacional o EMS Internacional')) {
        return 'Claro, ¿quieres cotizar EMS Nacional dentro de Bolivia o EMS Internacional?'
      }
      if (tariffQuote.missingFields.includes('pais de destino')) {
        return 'Para EMS Internacional indícame solo el país de destino y el peso del paquete. Si necesitas entrega en una ciudad o zona específica, la cobertura local se confirma con el operador postal de ese país.'
      }
      if (tariffQuote.missingFields.includes('departamento de destino')) {
        return 'Para EMS Nacional, indícame el departamento de Bolivia y el peso del paquete.'
      }
      if (tariffQuote.missingFields.includes('dimensiones aproximadas')) {
        return 'Para afinar el estimado, ¿me indicas alto, ancho y largo aproximados en cm? En sucursal verificarán el peso y las medidas reales; si no las tienes, dime “cotiza solo con el peso”.'
      }
      if (tariffQuote.missingFields.includes('peso')) {
        if (tariffQuote.needsEmsWeightUnitClarification) {
          return '¿Ese valor está en kg o gramos? Confírmame la unidad para cotizar el envío correctamente.'
        }
        return `Para cotizar ${tariffQuote.emsCategory === 'EMS INT' ? 'EMS Internacional' : 'EMS Nacional'}, indícame el peso del paquete en kg.`
      }
      return `Para cotizar ${tariffQuote.emsCategory === 'EMS INT' ? 'EMS Internacional' : 'EMS Nacional'}, indícame el destino y el peso del paquete.`
    }

    if (
      tariffQuote.serviceKey === 'delivery_express' &&
      tariffQuote.deliveryMode &&
      (tariffQuote.missingFields.includes('origen') || tariffQuote.missingFields.includes('destino'))
    ) {
      const modeLabels = {
        puerta_a_puerta: 'puerta a puerta',
        puerta_a_ventanilla: 'puerta a ventanilla',
        ventanilla_a_ventanilla: 'ventanilla a ventanilla',
      }
      const modeLabel = modeLabels[tariffQuote.deliveryMode] || 'Delivery Express'
      return `Perfecto, Delivery Express ${modeLabel}. Para cotizar necesito la ruta completa: ¿desde que ciudad/departamento se envia y a que ciudad/departamento va?`
    }

    if (
      tariffQuote.missingFields.includes('servicio') &&
      tariffQuote.originKey &&
      tariffQuote.destinationKey
    ) {
      if (tariffQuote.isRouteChangeQuestion && tariffQuote.weightKg) {
        const weight = Number(tariffQuote.weightKg).toLocaleString('es-BO', {
          minimumFractionDigits: 0,
          maximumFractionDigits: 3,
        })
        const origin = tariffQuote.originKey.replaceAll('-', ' ')
        const destination = tariffQuote.destinationKey.replaceAll('-', ' ')
        return `Para la ruta ${origin} a ${destination}, ¿prefieres EMS Nacional o Delivery Express? Puedo cotizar con el peso anterior de ${weight} kg; si eliges Delivery Express, indícame también la modalidad.`
      }
      if (tariffQuote.isRouteChangeQuestion) {
        const origin = tariffQuote.originKey.replaceAll('-', ' ')
        const destination = tariffQuote.destinationKey.replaceAll('-', ' ')
        return `Para la ruta ${origin} a ${destination}, ¿prefieres EMS Nacional o Delivery Express? Si eliges Delivery Express, indícame también la modalidad.`
      }
      const origin = tariffQuote.originKey.replaceAll('-', ' ')
      const destination = tariffQuote.destinationKey.replaceAll('-', ' ')
      return `Para cotizar de ${origin} a ${destination}, ¿prefieres EMS Nacional o Delivery Express?`
    }

    if (
      tariffQuote.serviceKey === 'delivery_express' &&
      tariffQuote.missingFields.length === 1 &&
      tariffQuote.missingFields.includes('tipo de servicio Delivery Express (puerta a puerta, puerta a ventanilla o ventanilla a ventanilla)')
    ) {
      return tariffReplyTemplates.deliveryModeOptions
    }

    return tariffReplyTemplates.genericMissingFields
  }

  if (tariffQuote.invalidReason === 'delivery_express_province_destination') {
    return getResponseTemplate(
      'deliveryProvinceNotAllowed',
      'Delivery Express no aplica para envios a provincia o comunidades. Para ese destino corresponde EMS Nacional; te puedo ayudar a cotizarlo por EMS si me confirmas el peso del paquete.',
    )
  }

  if (tariffQuote.invalidReason === 'multiple_tariff_quote_request') {
    return await buildMultipleTariffDraftReply(messageBody)
  }

  if (tariffQuote.invalidReason === 'unsupported_tariff_service') {
    return renderTextTemplate(
      getResponseTemplate(
        'unsupportedTariffService',
        'No tengo registrado el servicio "{serviceName}". Los servicios disponibles para cotizar son EMS Nacional e Internacional y Delivery Express. Indicame cual de esos dos deseas usar para continuar.',
      ),
      { serviceName: 'Nacional Express' },
    )
  }

  if (tariffQuote.invalidReason === 'unsupported_international_destination') {
    const alternativeName = tariffQuote.alternativeDestination?.name
    return alternativeName
      ? `China no figura en el tarifario EMS disponible. Rusia es una alternativa distinta que puedo revisar; cotizar hasta Rusia no incluye reenvío a China. ¿Quieres que cotice EMS hasta ${alternativeName}?`
      : 'China no figura en el tarifario EMS disponible. No puedo confirmar cobertura ni precio para ese destino; consulta con un asesor de Correos.'
  }

  if (tariffQuote.invalidReason === 'senior_discount_unavailable') {
    const route = tariffQuote.originKey && tariffQuote.destinationKey
      ? `${tariffQuote.originKey.replaceAll('-', ' ')} a ${tariffQuote.destinationKey.replaceAll('-', ' ')}`
      : 'esa ruta'
    return renderTextTemplate(
      getResponseTemplate(
        'seniorDiscountUnavailable',
        'Por ahora no tengo registrado un descuento automatico por tercera edad para envios. Para cotizarte {route} con la tarifa vigente, confirmame el peso del paquete y el servicio que deseas usar.',
      ),
      { route },
    )
  }

  if (tariffQuote.invalidReason === 'ems_calculator_error') {
    if (tariffQuote.calculatorErrorCode === 'rate_not_found') {
      return 'No encontré una tarifa EMS vigente para ese peso y destino. Confirma los datos o te derivo con un asesor.'
    }
    if (tariffQuote.calculatorErrorCode === 'invalid_destination') {
      return 'No pude validar ese destino en el tarifario EMS. Confirma la ciudad o país para revisar la cotización.'
    }
    if (tariffQuote.calculatorErrorCode === 'ambiguous_rate') {
      return 'El tarifario EMS devolvió más de una tarifa para esos datos. Para evitar un precio incorrecto, te derivo con un asesor.'
    }
    return 'No pude confirmar la tarifa EMS en este momento. No quiero darte un precio incorrecto; puedo derivarte con un asesor.'
  }

  if (tariffQuote.invalidReason === 'delivery_express_weight_exceeded') {
    const weight = Number(tariffQuote.weightKg).toLocaleString('es-BO', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 3,
    })
    return renderTextTemplate(
      getResponseTemplate(
        'deliveryWeightExceeded',
        'Delivery Express solo aplica para paquetes de hasta {maxWeightKg} kg. Para un paquete de {weightKg} kg corresponde cotizarlo por EMS Nacional e Internacional; te puedo ayudar con esa tarifa si confirmas que seguimos por EMS.',
      ),
      {
        maxWeightKg: botKnowledge.deliveryExpress?.limits?.maxWeightKg || 5,
        weightKg: weight,
      },
    )
  }

  if (tariffQuote.invalidReason === 'unsupported_delivery_express_mode') {
    return getResponseTemplate(
      'unsupportedDeliveryMode',
      'Esa modalidad de Delivery Express no esta registrada. Las modalidades validas son: puerta a puerta, puerta a ventanilla o ventanilla a ventanilla. Confirmame cual corresponde y te cotizo.',
    )
  }

  if (tariffQuote.invalidReason === 'delivery_express_dimensions_policy') {
    const weight = Number(tariffQuote.weightKg || 0).toLocaleString('es-BO', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 3,
    })
    return renderTextTemplate(
      getResponseTemplate(
        'deliveryDimensionsPolicy',
        'Para Delivery Express la validacion principal de esta cotizacion es el peso: aplica hasta {maxWeightKg} kg. Las medidas alto/ancho/largo no cambian el precio en esta tarifa; si el paquete no supera ese peso, puede continuar por Delivery Express segun cobertura.',
      ),
      {
        maxWeightKg: botKnowledge.deliveryExpress?.limits?.maxWeightKg || 5,
        weightKg: weight,
      },
    )
  }

  if (!tariffQuote.matched || !tariffQuote.rate) {
    if (tariffQuote.serviceKey === 'delivery_express' && tariffQuote.deliveryMode) {
      const modeLabels = {
        puerta_a_puerta: 'puerta a puerta',
        puerta_a_ventanilla: 'puerta a ventanilla',
        ventanilla_a_ventanilla: 'ventanilla a ventanilla',
      }
      const modeLabel = modeLabels[tariffQuote.deliveryMode] || 'Delivery Express'
      return renderTextTemplate(
        getResponseTemplate(
          'noActiveDeliveryRate',
          'Entendido: Delivery Express {modeLabel}. No tengo una tarifa activa para esa ruta en este momento; te derivamos con un asesor para confirmarte el precio exacto.',
        ),
        { modeLabel },
      )
    }

    return getResponseTemplate(
      'noActiveGenericRate',
      'No encontre una tarifa activa para esa combinacion de peso, destino y servicio. Te puedo ayudar si me confirmas esos datos nuevamente.',
    )
  }

  const rate = tariffQuote.rate
  const weight = tariffQuote.serviceKey === 'delivery_express' && !tariffQuote.weightKg
    ? ''
    : Number(tariffQuote.weightKg).toLocaleString('es-BO', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 3,
      })
  const price = formatTariffMoney(rate.price, rate.currency)
  const serviceName = normalizeTariffDisplayValue(rate.service_name) || getDeliveryModeLabel(tariffQuote.deliveryMode) || 'el servicio'
  const notes = normalizeReference(rate.notes)
  const originName = normalizeTariffDisplayValue(rate.origin_name)
  const destinationName = normalizeTariffDisplayValue(rate.destination_name)
  const deliveryTime = normalizeReference(
    rate.delivery_time_hours ??
      rate.tiempo_entrega ??
      rate.tiempoEntrega ??
      rate.delivery_time ??
      rate.tiempo,
  )

  const routeDescription = originName && destinationName ? `de ${originName} a ${destinationName}` : `a ${destinationName || rate.destination_name}`
  const packageDescription = weight ? `para ${weight} kg ${routeDescription}` : routeDescription
  if (tariffQuote.requestedDeliveryTime) {
    return deliveryTime
      ? `Para ${serviceName} ${packageDescription}, el tiempo estimado de entrega es de ${deliveryTime} h.`
      : `Para ${serviceName} ${packageDescription}, no tengo un tiempo de entrega registrado en la tarifa activa.`
  }

  const personalizedIntro = buildPersonalizedTariffIntro({ tariffQuote, messageBody })
  const quoteText = `Con los datos que me diste, la tarifa ${packageDescription} por ${serviceName} es ${price}.${notes ? ` ${notes}` : ''}`
  if (personalizedIntro) {
    return renderTextTemplate(tariffReplyTemplates.exactQuote, {
      intro: personalizedIntro,
      quote: quoteText,
    })
  }

  const serviceExplanation = tariffQuote.deliveryExpressWeightExceeded
    ? `Por ${weight} kg, tu paquete supera el límite de ${botKnowledge.deliveryExpress?.limits?.maxWeightKg || 5} kg de Delivery Express, así que corresponde ${tariffQuote.emsCategory === 'EMS INT' ? 'EMS Internacional' : 'EMS Nacional'}. `
    : ''
  return `${serviceExplanation}La tarifa ${packageDescription} por ${serviceName} es ${price}.${notes ? ` ${notes}` : ''}`
}

const buildGeneralAgentPrompt = ({
  contact,
  messageBody,
  recentConversation,
  packageContext,
  category = 'GENERAL',
  customInstruction = '',
  tariffQuote = null,
  sender = '',
}) =>
  [
    'Responde como una persona real, con tono cercano y natural.',
    'Prioriza respuestas cortas y fluidas para WhatsApp: 1 o 2 frases, maximo 32 palabras.',
    'No inventes ubicaciones, fechas, tarifas ni promesas.',
    category === 'TARIFAS'
      ? 'El cliente consulta tarifas o cotizaciones para enviar paquetes. Mantente en cotizacion: no pidas numero de guia ni hables de tracking salvo que el cliente lo pida explicitamente. Si faltan servicio, modalidad, origen o destino, pide solo esos datos.'
      : 'El cliente hace una consulta general. Responde solo lo que pregunta y evita desviarte.',
    'Si no puedes resolver exactamente la solicitud, no inventes una respuesta: ofrece continuar la cotización solicitando solo los datos faltantes o consultar el estado de una guía. Si hay una guía en el contexto, usa su estado real de la API.',
    category === 'TARIFAS'
      ? `Base de conocimiento EMS:\n${(botKnowledge.ems?.rules || []).join('\n')}\n\nBase de conocimiento Delivery Express:\n${(botKnowledge.deliveryExpress?.rules || []).join('\n')}`
      : '',
    category === 'TARIFAS' && tariffQuote
      ? `Resultado estructurado del tarifario (úsalo como única fuente de precio y datos):\n${JSON.stringify(tariffQuote)}\nRedacta una respuesta natural. Si faltan datos, pide solo esos datos; si hay una tarifa, informa el precio y sus condiciones. No inventes ni cambies valores.`
      : '',
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
    'Si pregunta por la declaracion aduanera o el departamento declarado, usa el dato CDS y aclara que no confirma la ubicacion operativa actual.',
    'Si el ultimo evento o estado indica aduana, responde que el paquete se encuentra en aduana, en revision u observacion aduanera.',
    'Si el cliente pregunta donde esta o hacia donde va, menciona estado, destino y sucursal de origen o destino cuando exista.',
    'Si existe una agencia o sucursal en las APIs, usa ese dato exacto y no inventes direcciones ni nombres.',
    (botKnowledge.tracking?.rules || []).length
      ? `Base de conocimiento de rastreo:\n${botKnowledge.tracking.rules.join('\n')}`
      : '',
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
const WHATSAPP_AUTO_REPLY_MAX_MESSAGE_AGE_MS = Number.parseInt(
  process.env.WHATSAPP_AUTO_REPLY_MAX_MESSAGE_AGE_MS || String(15 * 60 * 1000),
  10,
)
const WHATSAPP_OFF_TOPIC_WINDOW_MS = Number.parseInt(
  process.env.WHATSAPP_OFF_TOPIC_WINDOW_MS || String(20 * 60 * 1000),
  10,
)
const WHATSAPP_OFF_TOPIC_COOLDOWN_MS = Number.parseInt(
  process.env.WHATSAPP_OFF_TOPIC_COOLDOWN_MS || String(4 * 60 * 60 * 1000),
  10,
)
const WHATSAPP_OFF_TOPIC_LIMIT = Number.parseInt(process.env.WHATSAPP_OFF_TOPIC_LIMIT || '2', 10)
const WHATSAPP_STAGE_WATCHER_ENABLED =
  process.env.WHATSAPP_STAGE_WATCHER_ENABLED == null
    ? true
    : process.env.WHATSAPP_STAGE_WATCHER_ENABLED === 'true'
const PACKAGE_PIPELINE_SYNC_INTERVAL_MS = Number.parseInt(
  process.env.PACKAGE_PIPELINE_SYNC_INTERVAL_MS || '300000',
  10,
)
const PACKAGE_NEW_PACKAGE_WELCOME_INTERVAL_MS = Number.parseInt(
  process.env.PACKAGE_NEW_PACKAGE_WELCOME_INTERVAL_MS || '300000',
  10,
)
const PACKAGE_NEW_PACKAGE_WELCOME_LOOKBACK_MS = Number.parseInt(
  process.env.PACKAGE_NEW_PACKAGE_WELCOME_LOOKBACK_MS || String(60 * 60 * 1000),
  10,
)
const PACKAGE_EVENT_CHANGE_SYNC_INTERVAL_MS = Number.parseInt(
  process.env.PACKAGE_EVENT_CHANGE_SYNC_INTERVAL_MS || String(15 * 60 * 1000),
  10,
)
const PACKAGE_FULL_EVENT_CHANGE_SYNC_INTERVAL_MS = Number.parseInt(
  process.env.PACKAGE_FULL_EVENT_CHANGE_SYNC_INTERVAL_MS || String(60 * 60 * 1000),
  10,
)
const WHATSAPP_NEW_PACKAGE_WATCHER_ENABLED =
  process.env.WHATSAPP_NEW_PACKAGE_WATCHER_ENABLED == null
    ? true
    : process.env.WHATSAPP_NEW_PACKAGE_WATCHER_ENABLED === 'true'
const WHATSAPP_NEW_PACKAGE_WELCOME_ENABLED =
  process.env.WHATSAPP_NEW_PACKAGE_WELCOME_ENABLED === 'true'
const WHATSAPP_NEW_PACKAGE_WELCOME_RECENT_MS = Number.parseInt(
  process.env.WHATSAPP_NEW_PACKAGE_WELCOME_RECENT_MS || String(24 * 60 * 60 * 1000),
  10,
)
const WHATSAPP_TEST_MODE_STAGE_UPDATES_ENABLED =
  process.env.WHATSAPP_TEST_MODE_STAGE_UPDATES_ENABLED === 'true'
const WHATSAPP_PACKAGE_WATCHER_TEST_MODE_RESTRICTED =
  process.env.WHATSAPP_PACKAGE_WATCHER_TEST_MODE_RESTRICTED === 'true'

const getWhatsAppMessageReceivedAt = (message) => {
  const timestampSeconds = Number.parseInt(normalizeReference(message?.timestamp), 10)

  if (!Number.isFinite(timestampSeconds) || timestampSeconds <= 0) {
    return new Date()
  }

  return new Date(timestampSeconds * 1000)
}

const isWhatsAppMessageTooOldForAutoReply = (receivedAt) => {
  const maxAgeMs = Number.isFinite(WHATSAPP_AUTO_REPLY_MAX_MESSAGE_AGE_MS)
    ? Math.max(WHATSAPP_AUTO_REPLY_MAX_MESSAGE_AGE_MS, 0)
    : 15 * 60 * 1000

  return maxAgeMs > 0 && Date.now() - receivedAt.getTime() > maxAgeMs
}

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

const getActiveOffTopicAutoReplyPause = async ({ contactId, sender }) => {
  const pauseResult = await pool.query(
    `
      select details
      from system_logs
      where event in ('whatsapp_auto_reply_off_topic_pause', 'whatsapp_auto_reply_off_topic_unpause')
        and (
          (details->>'contactId')::int = $1
          or regexp_replace(coalesce(details->>'sender', ''), '[^0-9]', '', 'g') = any($2::text[])
        )
      order by created_at desc, id desc
      limit 1;
    `,
    [contactId ?? -1, getWhatsAppNumberCandidates(sender)],
  )

  const latestPauseEvent = pauseResult.rows[0]?.details ?? null
  if (!latestPauseEvent?.pausedUntil) return null

  const pausedUntil = new Date(latestPauseEvent.pausedUntil).getTime()
  return Number.isFinite(pausedUntil) && pausedUntil > Date.now() ? latestPauseEvent : null
}

const countRecentNonActionableInboundMessages = async ({ contactId, sender, inboundMessageId, currentMessageBody }) => {
  const windowMs = Number.isFinite(WHATSAPP_OFF_TOPIC_WINDOW_MS) ? Math.max(WHATSAPP_OFF_TOPIC_WINDOW_MS, 60 * 1000) : 20 * 60 * 1000
  const recentInboundResult = await pool.query(
    `
      select id, message_text
      from message_logs
      where channel = 'WhatsApp'
        and direction = 'inbound'
        and created_at >= now() - ($1::text)::interval
        and ($2::bigint is null or id <= $2::bigint)
        and (
          contact_id = $3
          or regexp_replace(coalesce(recipient_reference, ''), '[^0-9]', '', 'g') = any($4::text[])
        )
      order by created_at desc, id desc
      limit 6;
    `,
    [`${windowMs} milliseconds`, inboundMessageId ?? null, contactId ?? -1, getWhatsAppNumberCandidates(sender)],
  )

  const recentMessages = recentInboundResult.rows.map((row) => normalizeReference(row.message_text))
  const currentMessage = normalizeReference(currentMessageBody)
  if (currentMessage && !recentMessages.includes(currentMessage)) {
    recentMessages.unshift(currentMessage)
  }

  let count = 0
  for (const messageText of recentMessages) {
    if (!isNonActionableCustomerMessage(messageText)) break
    count += 1
  }

  return count
}

const registerOffTopicAutoReplyPause = async ({ contactId, sender, messageBody, count }) => {
  const cooldownMs = Number.isFinite(WHATSAPP_OFF_TOPIC_COOLDOWN_MS)
    ? Math.max(WHATSAPP_OFF_TOPIC_COOLDOWN_MS, 60 * 60 * 1000)
    : 4 * 60 * 60 * 1000
  const pausedUntil = new Date(Date.now() + cooldownMs).toISOString()

  await writeSystemLog({
    event: 'whatsapp_auto_reply_off_topic_pause',
    statusCode: 200,
    details: {
      contactId: contactId ?? null,
      sender: normalizePhoneNumber(sender),
      reason: '2 mensajes seguidos fuera de tema o sin sentido; agente pausado para evitar gasto innecesario.',
      observation: 'Pausa automatica de 4 horas. El equipo puede responder manualmente desde el CRM.',
      lastMessage: normalizeReference(messageBody),
      count,
      pausedUntil,
      cooldownMs,
    },
  })

  return pausedUntil
}

const buildProactivePackageUpdateMessage = ({ contact, packageContext }) => {
  if (!packageContext?.matched) return ''

  const contactName = normalizeReference(contact?.name)
  const customerName = contactName ? `, ${contactName}` : ''
  const packageCode = normalizeReference(packageContext.currentPackageCode)
  const destination =
    normalizeReference(packageContext.currentDestinationDepartment) ||
    normalizeReference(packageContext.currentDestinationLabel) ||
    normalizeReference(packageContext.currentDestinationAddress) ||
    'destino'
  const origin =
    normalizeReference(packageContext.currentOriginDepartment) ||
    normalizeReference(packageContext.currentOriginLabel) ||
    'origen'

  if (hasVentanillaPackageContext(packageContext)) {
    return buildVentanillaPickupMessage({
      packageCode,
      branch: getPackageDestinationBranch(packageContext) || getPackageOriginBranch(packageContext),
    })
  }

  if (packageContext.stage === 'received') {
    return `ðŸ“¦ Tu paquete *${packageCode}* fue recibido en *${origin}* y va con destino a *${destination}*.\nðŸšš Te avisaremos apenas salga a ruta. Gracias por preferir Correos de Bolivia ðŸ˜Š.`
  }

  if (packageContext.stage === 'transit') {
    return `ðŸšš Tu paquete *${packageCode}* ya estÃ¡ en trÃ¡nsito hacia *${destination}*.\nðŸ“ Seguiremos monitoreando el recorrido y te notificaremos cuando registre un nuevo movimiento ðŸ“².`
  }

  if (packageContext.stage === 'regional') {
    const branchText = formatBranchText(getPackageDestinationBranch(packageContext))
    return `ðŸ¤ Â¡Buenas noticias! Tu paquete *${packageCode}* ya llegÃ³ a la sucursal de destino en *${destination}*${branchText ? ` ðŸ“ (${branchText})` : ''}.\nðŸš´â€â™‚ï¸ El siguiente paso es reparto o disponibilidad para recojo segÃºn el proceso de la regional.`
  }

  if (packageContext.stage === 'courier') {
    return `ðŸš´â€â™‚ï¸ Tu paquete *${packageCode}* ya estÃ¡ con cartero y saliÃ³ a reparto en *${destination}*.\nâœ… Te avisaremos cuando se confirme la entrega.`
  }

  if (packageContext.stage === 'delivered') {
    return `âœ… Tu paquete *${packageCode}* figura como entregado con Ã©xito en *${destination}*.\nGracias por preferir Correos de Bolivia ðŸ˜Š.`
  }

  if (packageContext.stage === 'cancelled') {
    return `âŒ Tu paquete *${packageCode}* figura como cancelado o devuelto en *${origin}*.\nðŸ’¡ Si necesitas revisar el motivo, escribe *RECLAMO*.`
  }

  if (packageContext.stage === 'regional') {
    const branchText = formatBranchText(getPackageDestinationBranch(packageContext))
    return `Tu paquete ${packageCode} ya llego a la sucursal de destino en ${destination}${branchText ? ` (${branchText})` : ''}. El siguiente paso es reparto o disponibilidad segun el proceso de la regional.`
  }

  if (packageContext.stage === 'courier') {
    return `Tu paquete ${packageCode} ya estÃ¡ con cartero y saliÃ³ a reparto en ${destination}. Te avisaremos cuando se confirme la entrega.`
  }

  if (packageContext.stage === 'delivered') {
    return `Tu paquete ${packageCode} figura como entregado en ${destination}. Gracias por preferir Correos de Bolivia.`
  }

  if (packageContext.stage === 'regional') {
    return `Tu paquete ${packageCode} ya llegÃ³ a destino en ${destination}. Puedes estar atento a la siguiente actualizaciÃ³n.`
  }

  if (packageContext.stage === 'transit') {
    return `Tu paquete ${packageCode} estÃ¡ en trÃ¡nsito hacia ${destination}. Te notificaremos cuando registre un nuevo movimiento.`
  }

  if (packageContext.stage === 'cancelled') {
    return `Tu paquete ${packageCode} figura como cancelado o devuelto en ${origin}. Si necesitas ayuda, escribe RECLAMO.`
  }

  return `Tu paquete ${packageCode} fue recibido en ${origin} con destino a ${destination}. Te avisaremos cuando sea despachado.`
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
    return `Â¡Hola${customerName}! ${greeting}. Soy Jaimito, de Correos de Bolivia. ${proactiveUpdate}`
  }

  return `Â¡Hola${customerName}! ${greeting}. Soy Jaimito, de Correos de Bolivia.`
}

const buildNewPackageWelcomeMessage = ({ contactName, entry = null }) => {
  const safeName = normalizeReference(contactName)
  const customerName = safeName && !/^paquete\s+ems$/i.test(safeName) ? `, ${safeName}` : ''
  const greeting = getBoliviaDayGreeting()
  const packageCode = normalizeReference(entry?.code)
  const destination = normalizeReference(entry?.destinationLabel) || 'su destino'

  if (packageCode && isVentanillaText(entry?.latestEventLabel)) {
    return buildVentanillaPickupMessage({
      packageCode,
      branch: getBoliviaBranchLocation(destination),
    })
  }

  if (['received', 'transit', 'regional', 'courier', 'delivered'].includes(entry?.stage) && packageCode) {
    const origin = normalizeReference(entry?.originLabel) || 'origen'
    const baseGreeting = `Â¡Hola${customerName}! ðŸ‘‹ ${greeting}. Soy Jaimito de Correos de Bolivia âœ‰ï¸.`

    if (entry.stage === 'received') {
      return `${baseGreeting}\n\nðŸ“¦ Tu paquete *${packageCode}* fue recibido en *${origin}* y va con destino a *${destination}*.\nðŸšš Te avisaremos apenas salga a ruta.\nðŸ’¬ Gracias por preferirnos. Puedes escribirnos a este mismo nÃºmero para consultar por tu paquete ðŸ˜Š.`
    }

    if (entry.stage === 'transit') {
      return `${baseGreeting}\n\nðŸšš Tu paquete *${packageCode}* ya estÃ¡ en trÃ¡nsito hacia *${destination}*.\nðŸ“² Te notificaremos cuando registre un nuevo movimiento.\nðŸ’¬ Gracias por preferirnos. Puedes escribirnos a este mismo nÃºmero para consultar por tu paquete ðŸ˜Š.`
    }

    if (entry.stage === 'regional') {
      const branchText = formatBranchText(getBoliviaBranchLocation(destination))
      return `${baseGreeting}\n\nðŸ¤ Tu paquete *${packageCode}* ya llegÃ³ a la sucursal de destino en *${destination}*${branchText ? ` ðŸ“ (${branchText})` : ''}.\nðŸš´â€â™‚ï¸ El siguiente paso es reparto o disponibilidad para recojo.\nðŸ’¬ Gracias por preferirnos. Puedes escribirnos a este mismo nÃºmero para consultar por tu paquete ðŸ˜Š.`
    }

    if (entry.stage === 'courier') {
      return `${baseGreeting}\n\nðŸš´â€â™‚ï¸ Tu paquete *${packageCode}* ya estÃ¡ con cartero para entrega en *${destination}*.\nâœ… Te avisaremos cuando se confirme la entrega.\nðŸ’¬ Gracias por preferirnos. Puedes escribirnos a este mismo nÃºmero para consultar por tu paquete ðŸ˜Š.`
    }

    return `${baseGreeting}\n\nâœ… Tu paquete *${packageCode}* figura entregado con Ã©xito en *${destination}*.\nGracias por preferirnos ðŸ˜Š.`
  }

  if (entry?.stage === 'received' && packageCode) {
    const origin = normalizeReference(entry?.originLabel) || 'origen'
    return `Â¡Hola${customerName}! ðŸ‘‹ ${greeting}. Soy Jaimito de Correos de Bolivia âœ‰ï¸.\n\nðŸ“¦ Tu paquete *${packageCode}* fue recibido en *${origin}* y va con destino a *${destination}*.\nðŸšš Te avisaremos apenas salga a ruta.\nðŸ’¬ Gracias por preferirnos. Puedes escribirnos a este mismo nÃºmero para consultar por tu paquete ðŸ˜Š.`
  }

  if (entry?.stage === 'transit' && packageCode) {
    return `Â¡Hola${customerName}! ðŸ‘‹ ${greeting}. Soy Jaimito de Correos de Bolivia âœ‰ï¸.\n\nðŸšš Tu paquete *${packageCode}* ya estÃ¡ en trÃ¡nsito hacia *${destination}*.\nðŸ“² Te notificaremos cuando registre un nuevo movimiento.\nðŸ’¬ Gracias por preferirnos. Puedes escribirnos a este mismo nÃºmero para consultar por tu paquete ðŸ˜Š.`
  }

  if (entry?.stage === 'regional' && packageCode) {
    const branchText = formatBranchText(getBoliviaBranchLocation(destination))
    return `Â¡Hola${customerName}! ðŸ‘‹ ${greeting}. Soy Jaimito de Correos de Bolivia âœ‰ï¸.\n\nðŸ¤ Tu paquete *${packageCode}* ya llegÃ³ a la sucursal de destino en *${destination}*${branchText ? ` ðŸ“ (${branchText})` : ''}.\nðŸš´â€â™‚ï¸ El siguiente paso es reparto o disponibilidad para recojo.\nðŸ’¬ Gracias por preferirnos. Puedes escribirnos a este mismo nÃºmero para consultar por tu paquete ðŸ˜Š.`
  }

  if (entry?.stage === 'courier' && packageCode) {
    return `Â¡Hola${customerName}! ðŸ‘‹ ${greeting}. Soy Jaimito de Correos de Bolivia âœ‰ï¸.\n\nðŸš´â€â™‚ï¸ Tu paquete *${packageCode}* ya estÃ¡ con cartero para entrega en *${destination}*.\nâœ… Te avisaremos cuando se confirme la entrega.\nðŸ’¬ Gracias por preferirnos. Puedes escribirnos a este mismo nÃºmero para consultar por tu paquete ðŸ˜Š.`
  }

  if (entry?.stage === 'delivered' && packageCode) {
    return `Â¡Hola${customerName}! ðŸ‘‹ ${greeting}. Soy Jaimito de Correos de Bolivia âœ‰ï¸.\n\nâœ… Tu paquete *${packageCode}* figura entregado con Ã©xito en *${destination}*.\nGracias por preferirnos ðŸ˜Š.`
  }

  if (entry?.stage === 'transit' && packageCode) {
    return `Â¡Hola${customerName}! ${greeting}, mucho gusto. Soy Jaimito de Correos de Bolivia. Tu paquete ${packageCode} estÃ¡ en trÃ¡nsito hacia ${destination}. Gracias por preferirnos; cualquier consulta estamos para ayudarte.`
  }

  if (packageCode && isVentanillaText(entry?.latestEventLabel)) {
    return buildVentanillaPickupMessage({
      packageCode,
      branch: getBoliviaBranchLocation(destination),
    })
  }

  if (entry?.stage === 'regional' && packageCode) {
    const branchText = formatBranchText(getBoliviaBranchLocation(destination))
    return `Hola${customerName}. ${greeting}, mucho gusto. Soy Jaimito de Correos de Bolivia. Tu paquete ${packageCode} ya llego a la sucursal de destino en ${destination}${branchText ? ` (${branchText})` : ''}. Gracias por preferirnos; cualquier consulta estamos para ayudarte.`
  }

  if (entry?.stage === 'courier' && packageCode) {
    return `Â¡Hola${customerName}! ${greeting}, mucho gusto. Soy Jaimito de Correos de Bolivia. Tu paquete ${packageCode} estÃ¡ con cartero para entrega en ${destination}. Gracias por preferirnos; cualquier consulta estamos para ayudarte.`
  }

  if (entry?.stage === 'delivered' && packageCode) {
    return `Â¡Hola${customerName}! ${greeting}, mucho gusto. Soy Jaimito de Correos de Bolivia. Tu paquete ${packageCode} figura entregado en ${destination}. Gracias por preferirnos; cualquier consulta estamos para ayudarte.`
  }

  return `Â¡Hola${customerName}! ${greeting}, mucho gusto. Soy Jaimito de Correos de Bolivia. Gracias por preferirnos; cualquier consulta estamos para ayudarte.`
}

const isAllowedNewPackageOutreachRecipient = (config, targetPhone) => {
  const normalizedTarget = normalizePhoneNumber(targetPhone)
  if (!normalizedTarget) return false

  const testModeEnabled = normalizeBoolean(config.testModeEnabled, whatsappDefaults.testModeEnabled)
  if (!testModeEnabled) return true

  const testNumbers = getConfiguredWhatsAppTestNumbers(config)
    .map(normalizePhoneNumber)
    .filter(Boolean)

  return testNumbers.includes(normalizedTarget)
}

const isWhatsAppRecipientAllowedByTestMode = (config, targetPhone) => {
  const normalizedTarget = normalizeBoliviaTestNumber(targetPhone)
  if (!normalizedTarget) return false

  const testModeEnabled = normalizeBoolean(config.testModeEnabled, whatsappDefaults.testModeEnabled)
  if (!testModeEnabled) return true

  const targetCandidates = new Set(getBoliviaTestNumberCandidates(normalizedTarget))
  return getConfiguredWhatsAppTestNumbers(config).some((number) =>
    getBoliviaTestNumberCandidates(number).some((candidate) => targetCandidates.has(candidate)),
  )
}

const isValidWhatsAppRecipientNumber = (targetPhone) => {
  const normalizedTarget = normalizeBoliviaTestNumber(targetPhone)
  if (!normalizedTarget) return false

  if (normalizedTarget.startsWith('591')) {
    return /^591[67]\d{7}$/.test(normalizedTarget)
  }

  return /^\d{10,15}$/.test(normalizedTarget)
}

const getAllowedTestModeFallbackRecipients = (config) => {
  const testModeEnabled = normalizeBoolean(config?.testModeEnabled, whatsappDefaults.testModeEnabled)
  if (!testModeEnabled) return []

  return getConfiguredWhatsAppTestNumbers(config)
    .map(normalizeBoliviaTestNumber)
    .filter(Boolean)
    .filter(isValidWhatsAppRecipientNumber)
    .filter((phone, index, phones) => phones.indexOf(phone) === index)
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
const WHATSAPP_WATCHER_ADVISORY_LOCK_ID = 9403001

const runWhatsAppStageWatcher = async () => {
  if (whatsappStageWatcherRunning) {
    console.log('Watcher WhatsApp: ciclo omitido porque el anterior sigue en ejecucion.')
    return
  }

  whatsappStageWatcherRunning = true
  let watcherLockClient = null
  let watcherLockAcquired = false
  console.log(`Watcher WhatsApp: revisando paquetes nuevos y eventos (${new Date().toISOString()}).`)

  try {
    watcherLockClient = await pool.connect()
    const lockResult = await watcherLockClient.query('select pg_try_advisory_lock($1) as locked', [
      WHATSAPP_WATCHER_ADVISORY_LOCK_ID,
    ])
    watcherLockAcquired = Boolean(lockResult.rows[0]?.locked)

    if (!watcherLockAcquired) {
      console.log('Watcher WhatsApp: otro proceso ya esta revisando paquetes.')
      return
    }

    await writeSystemLog({
      event: 'whatsapp_new_package_check_started',
      statusCode: 200,
      details: {
        startedAt: new Date().toISOString(),
        newPackageWatcherEnabled: WHATSAPP_NEW_PACKAGE_WATCHER_ENABLED,
        stageWatcherEnabled: WHATSAPP_STAGE_WATCHER_ENABLED,
      },
    }).catch(() => {})

    if (WHATSAPP_TEST_MODE_STAGE_UPDATES_ENABLED) {
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
    }

    const automationConfig = await getStoredAutomationConfig()
    const welcomeIntervalMs = normalizeAutomationIntervalMs(
      automationConfig.welcomeResponseIntervalMs,
      PACKAGE_NEW_PACKAGE_WELCOME_INTERVAL_MS,
      { minMs: 60 * 1000, maxMs: 6 * 60 * 60 * 1000 },
    )
    const recentEventIntervalMs = normalizeAutomationIntervalMs(
      automationConfig.eventChangeResponseIntervalMs,
      PACKAGE_EVENT_CHANGE_SYNC_INTERVAL_MS,
      { minMs: 60 * 1000, maxMs: 24 * 60 * 60 * 1000 },
    )
    const reconciliationIntervalMs = normalizeAutomationIntervalMs(
      automationConfig.reconciliationIntervalMs,
      DEFAULT_PACKAGE_RECONCILIATION_INTERVAL_MS,
      { minMs: 15 * 60 * 1000, maxMs: 24 * 60 * 60 * 1000 },
    )
    const shouldRunReconciliation =
      automationConfig.automaticReconciliation &&
      (lastPackageReconciliationCheckAt === 0 ||
        Date.now() - lastPackageReconciliationCheckAt >= reconciliationIntervalMs)
    const shouldRunWelcomeSync =
      automationConfig.automaticWelcome &&
      (lastNewPackageWelcomeCheckAt === 0 || Date.now() - lastNewPackageWelcomeCheckAt >= welcomeIntervalMs)
    const shouldRunRecentEventSync =
      WHATSAPP_STAGE_WATCHER_ENABLED &&
      (
        automationConfig.automaticStatusUpdates ||
        automationConfig.automaticInternationalArrivalTestNotifications ||
        automationConfig.automaticVentanillaNotifications
      ) &&
      (lastRecentPackageEventCheckAt === 0 || Date.now() - lastRecentPackageEventCheckAt >= recentEventIntervalMs)
    console.log(
      `Watcher WhatsApp: bienvenidas automaticas ${automationConfig.automaticWelcome ? 'activas' : 'desactivadas'}; ` +
        `intervalo configurado ${Math.ceil(welcomeIntervalMs / 60000)} min.`,
    )

    if (shouldRunWelcomeSync || shouldRunRecentEventSync) {
      if (shouldRunWelcomeSync) {
        lastNewPackageWelcomeCheckAt = Date.now()
      }
      if (shouldRunRecentEventSync) {
        lastRecentPackageEventCheckAt = Date.now()
      }

      await syncRecentPackageAutomations({
        sendWelcome: shouldRunWelcomeSync,
        sendEvents: shouldRunRecentEventSync,
        sendVentanillaEvents: shouldRunRecentEventSync,
      })
        .then(async (result) => {
          console.log(
            `Watcher WhatsApp rapido: API consultadas: Paquetes-Contactos ${result?.packageCountsBySource?.contact ?? 0}, Tracking ${result?.packageCountsBySource?.tracking ?? 0}; ` +
              `${result?.total ?? 0} paquete(s) reciente(s) revisado(s), ${result?.createdCount ?? 0} registro(s) nuevo(s) en CRM, ` +
              `bienvenida ${result?.newPackageWelcome?.sent ?? 0} enviada(s), ${result?.newPackageWelcome?.skipped ?? 0} omitida(s) ` +
              `(${JSON.stringify(result?.newPackageWelcome?.skippedByReason ?? {})})` +
              `${result?.newPackageWelcome?.reason ? ` (${result.newPackageWelcome.reason})` : ''}; ` +
              `eventos ${result?.eventNotifications?.sent ?? 0} enviado(s), omitidos ${result?.eventNotifications?.skipped ?? 0} ` +
              `(${JSON.stringify(result?.eventNotifications?.skippedByReason ?? {})}); ` +
              `llegadas internacionales ${result?.internationalArrivalNotifications?.sent ?? 0} enviada(s), omitidas ${result?.internationalArrivalNotifications?.skipped ?? 0} ` +
              `(${JSON.stringify(result?.internationalArrivalNotifications?.skippedByReason ?? {})}); ` +
              `ventanilla ${result?.ventanillaNotifications?.sent ?? 0} enviado(s), omitidos ${result?.ventanillaNotifications?.skipped ?? 0} ` +
              `(${JSON.stringify(result?.ventanillaNotifications?.skippedByReason ?? {})}).`,
          )
          for (const detail of [
            ...(result?.eventNotifications?.sentDetails ?? []),
            ...(result?.internationalArrivalNotifications?.sentDetails ?? []),
            ...(result?.ventanillaNotifications?.sentDetails ?? []),
          ]) {
            console.log(
              `[${detail.packageCode}] Confirmacion de envio.\n` +
                `  Numero: ${detail.recipient}\n` +
                `  Texto enviado:\n${detail.message}`,
            )
          }
          await writeSystemLog({
            event: 'whatsapp_new_package_fast_check_completed',
            statusCode: 200,
            details: {
              totalPackages: result?.total ?? 0,
              newPackages: result?.createdCount ?? 0,
              packageCountsBySource: result?.packageCountsBySource ?? {},
              packageSourceFailures: result?.packageSourceFailures ?? [],
              welcomeSent: result?.newPackageWelcome?.sent ?? 0,
              welcomeSkipped: result?.newPackageWelcome?.skipped ?? 0,
              welcomeSkippedByReason: result?.newPackageWelcome?.skippedByReason ?? {},
              eventSent: result?.eventNotifications?.sent ?? 0,
              eventSkipped: result?.eventNotifications?.skipped ?? 0,
              eventSkippedByReason: result?.eventNotifications?.skippedByReason ?? {},
              eventReason: result?.eventNotifications?.reason ?? result?.eventNotifications?.error ?? null,
              internationalArrivalSent: result?.internationalArrivalNotifications?.sent ?? 0,
              internationalArrivalSkipped: result?.internationalArrivalNotifications?.skipped ?? 0,
              internationalArrivalSkippedByReason:
                result?.internationalArrivalNotifications?.skippedByReason ?? {},
              internationalArrivalReason:
                result?.internationalArrivalNotifications?.reason ??
                result?.internationalArrivalNotifications?.error ??
                null,
              ventanillaSent: result?.ventanillaNotifications?.sent ?? 0,
              ventanillaSkipped: result?.ventanillaNotifications?.skipped ?? 0,
              ventanillaSkippedByReason: result?.ventanillaNotifications?.skippedByReason ?? {},
              ventanillaReason:
                result?.ventanillaNotifications?.reason ?? result?.ventanillaNotifications?.error ?? null,
              checkedAt: result?.syncedAt ?? new Date().toISOString(),
              lookbackMs: PACKAGE_NEW_PACKAGE_WELCOME_LOOKBACK_MS,
              welcomeIntervalMs,
              eventIntervalMs: recentEventIntervalMs,
            },
          }).catch(() => {})
        })
        .catch(async (error) => {
          console.error(
            `Watcher WhatsApp rapido: fallo al revisar paquetes recientes: ${error instanceof Error ? error.message : 'Error desconocido.'}`,
          )
          await writeSystemLog({
            level: 'error',
            event: 'whatsapp_new_package_fast_check_failed',
            statusCode: 500,
            details: {
              error: error instanceof Error ? error.message : 'Error desconocido.',
            },
          }).catch(() => {})
        })
    } else if (
      !shouldRunReconciliation &&
      (
        automationConfig.automaticWelcome ||
        (WHATSAPP_STAGE_WATCHER_ENABLED &&
        (automationConfig.automaticStatusUpdates || automationConfig.automaticVentanillaNotifications)) ||
        automationConfig.automaticReconciliation
      )
    ) {
      const nextWelcomeMinutes = lastNewPackageWelcomeCheckAt > 0
        ? Math.max(0, Math.ceil((welcomeIntervalMs - (Date.now() - lastNewPackageWelcomeCheckAt)) / 60000))
        : 0
      const nextEventMinutes = lastRecentPackageEventCheckAt > 0
        ? Math.max(0, Math.ceil((recentEventIntervalMs - (Date.now() - lastRecentPackageEventCheckAt)) / 60000))
        : 0
      const whatsappConfig = await getStoredWhatsAppConfig()
      console.log(
        `Watcher WhatsApp rapido: omitido; bienvenida ~${nextWelcomeMinutes} min, ` +
          `eventos recientes ~${nextEventMinutes} min; ` +
          `numeros configurados: ${(whatsappConfig.testModeNumbers ?? []).join(', ') || 'ninguno'}.`,
      )
    }

    const fullEventSyncIntervalMs = normalizeAutomationIntervalMs(
      PACKAGE_FULL_EVENT_CHANGE_SYNC_INTERVAL_MS,
      60 * 60 * 1000,
      { minMs: 15 * 60 * 1000, maxMs: 24 * 60 * 60 * 1000 },
    )
    const shouldRunFullEventSync =
      !shouldRunReconciliation &&
      WHATSAPP_STAGE_WATCHER_ENABLED &&
      (
        automationConfig.automaticStatusUpdates ||
        automationConfig.automaticInternationalArrivalTestNotifications
      ) &&
      (lastPackageEventChangeSyncAt === 0 || Date.now() - lastPackageEventChangeSyncAt >= fullEventSyncIntervalMs)

    if (shouldRunFullEventSync) {
      lastPackageEventChangeSyncAt = Date.now()
      await ensurePackagePipelineSync({ force: true })
        .then(async (result) => {
          console.log(
            `Watcher WhatsApp pesado: ${result?.createdCount ?? 0} nuevo(s), ${result?.updatedCount ?? 0} actualizado(s), ${result?.total ?? 0} total.`,
          )
          await writeSystemLog({
            event: 'whatsapp_new_package_check_completed',
            statusCode: 200,
            details: {
              totalPackages: result?.total ?? 0,
              newPackages: result?.createdCount ?? 0,
              updatedPackages: result?.updatedCount ?? 0,
              checkedAt: result?.syncedAt ?? new Date().toISOString(),
              intervalMs: fullEventSyncIntervalMs,
            },
          }).catch(() => {})
        })
        .catch(async (error) => {
          console.error(
            `Watcher WhatsApp pesado: fallo al sincronizar paquetes: ${error instanceof Error ? error.message : 'Error desconocido.'}`,
          )
          await writeSystemLog({
            level: 'error',
            event: 'whatsapp_new_package_watcher_sync_failed',
            statusCode: 500,
            details: {
              error: error instanceof Error ? error.message : 'Error desconocido.',
            },
          }).catch(() => {})
        })
    } else if (
      !shouldRunReconciliation &&
      WHATSAPP_STAGE_WATCHER_ENABLED &&
      (
        automationConfig.automaticStatusUpdates ||
        automationConfig.automaticInternationalArrivalTestNotifications
      )
    ) {
      const nextFullMinutes = lastPackageEventChangeSyncAt > 0
        ? Math.max(0, Math.ceil((fullEventSyncIntervalMs - (Date.now() - lastPackageEventChangeSyncAt)) / 60000))
        : 0
      console.log(`Watcher WhatsApp pesado: omitido; proximo ciclo en ~${nextFullMinutes} min.`)
    }

    if (shouldRunReconciliation) {
      const reconciliationStartedAt = new Date().toISOString()
      lastPackageReconciliationCheckAt = Date.now()
      console.log(
        `Comprobador WhatsApp: iniciando carga completa y conciliacion de paquetes (${reconciliationStartedAt}).`,
      )
      await writeSystemLog({
        event: 'whatsapp_package_reconciliation_started',
        statusCode: 102,
        details: {
          startedAt: reconciliationStartedAt,
          intervalMs: reconciliationIntervalMs,
        },
      }).catch(() => {})
      try {
        const result = await ensurePackagePipelineSync({ force: true, reconciliation: true })
        const welcomeResult = result?.newPackageWelcome ?? {}
        const eventResult = result?.eventNotifications ?? {}
        const internationalArrivalResult = result?.internationalArrivalNotifications ?? {}
        const ventanillaResult = result?.ventanillaNotifications ?? {}
        const checkedAt = new Date().toISOString()
        const sentTotal =
          (Number(welcomeResult.sent) || 0) +
          (Number(eventResult.sent) || 0) +
          (Number(internationalArrivalResult.sent) || 0) +
          (Number(ventanillaResult.sent) || 0)
        const sourceFailures = Array.isArray(result?.packageSourceFailures)
          ? result.packageSourceFailures
          : []
        const notificationFailures = [
          welcomeResult.error ? 'welcome-send-failed' : null,
          eventResult.error ? 'event-send-failed' : null,
          internationalArrivalResult.error ? 'international-arrival-send-failed' : null,
          ventanillaResult.error ? 'ventanilla-send-failed' : null,
        ].filter(Boolean)
        const details = {
          startedAt: reconciliationStartedAt,
          checkedAt,
          catalogSyncedAt: result?.syncedAt ?? null,
          intervalMs: reconciliationIntervalMs,
          totalPackages: Number(result?.total) || 0,
          packageCountsBySource: result?.packageCountsBySource ?? {},
          createdPackages: Number(result?.createdCount) || 0,
          updatedPackages: Number(result?.updatedCount) || 0,
          sentTotal,
          welcomeSent: Number(welcomeResult.sent) || 0,
          welcomeSkipped: Number(welcomeResult.skipped) || 0,
          welcomeSkippedByReason: welcomeResult.skippedByReason ?? {},
          welcomeReason: welcomeResult.reason ?? welcomeResult.error ?? null,
          eventSent: Number(eventResult.sent) || 0,
          eventSkipped: Number(eventResult.skipped) || 0,
          eventSkippedByReason: eventResult.skippedByReason ?? {},
          eventReason: eventResult.reason ?? eventResult.error ?? null,
          internationalArrivalSent: Number(internationalArrivalResult.sent) || 0,
          internationalArrivalSkipped: Number(internationalArrivalResult.skipped) || 0,
          internationalArrivalSkippedByReason: internationalArrivalResult.skippedByReason ?? {},
          internationalArrivalReason:
            internationalArrivalResult.reason ?? internationalArrivalResult.error ?? null,
          ventanillaSent: Number(ventanillaResult.sent) || 0,
          ventanillaSkipped: Number(ventanillaResult.skipped) || 0,
          ventanillaSkippedByReason: ventanillaResult.skippedByReason ?? {},
          ventanillaReason: ventanillaResult.reason ?? ventanillaResult.error ?? null,
          sourceFailures,
          notificationFailures,
          automaticWelcome: automationConfig.automaticWelcome,
          automaticStatusUpdates: automationConfig.automaticStatusUpdates,
          automaticInternationalArrivalTestNotifications:
            automationConfig.automaticInternationalArrivalTestNotifications,
          automaticVentanillaNotifications: automationConfig.automaticVentanillaNotifications,
        }
        await writeSystemLog({
          event: 'whatsapp_package_reconciliation_completed',
          statusCode: sourceFailures.length > 0 || notificationFailures.length > 0 ? 206 : 200,
          details,
        })
        lastPackageReconciliationCheckAt = Date.now()
        lastNewPackageWelcomeCheckAt = Date.now()
        lastRecentPackageEventCheckAt = Date.now()
        lastPackageEventChangeSyncAt = Date.now()
        console.log(
          `Comprobador WhatsApp: ${details.totalPackages} paquete(s), ${sentTotal} mensaje(s) enviado(s), ` +
            `${details.welcomeSkipped + details.eventSkipped + details.internationalArrivalSkipped + details.ventanillaSkipped} omitido(s).`,
        )
      } catch (error) {
        lastPackageReconciliationCheckAt =
          Date.now() - reconciliationIntervalMs + 2 * 60 * 1000
        console.error(
          `Comprobador WhatsApp: fallo la carga/conciliacion: ${error instanceof Error ? error.message : 'Error desconocido.'}`,
        )
        await writeSystemLog({
          level: 'error',
          event: 'whatsapp_package_reconciliation_failed',
          statusCode: 500,
          details: {
            startedAt: reconciliationStartedAt,
            checkedAt: new Date().toISOString(),
            intervalMs: reconciliationIntervalMs,
            error: error instanceof Error ? error.message : 'Error desconocido.',
          },
        }).catch(() => {})
      }
    }
  } finally {
    if (watcherLockClient) {
      if (watcherLockAcquired) {
        await watcherLockClient.query('select pg_advisory_unlock($1)', [
          WHATSAPP_WATCHER_ADVISORY_LOCK_ID,
        ]).catch(() => {})
      }
      watcherLockClient.release()
    }
    whatsappStageWatcherRunning = false
  }
}

const startWhatsAppStageWatcher = () => {
  const defaultIntervalMs = Number.isFinite(PACKAGE_PIPELINE_SYNC_INTERVAL_MS)
    ? Math.max(PACKAGE_PIPELINE_SYNC_INTERVAL_MS, 2 * 60 * 1000)
    : 300000

  const getWatcherIntervalMs = async () => {
    const automationConfig = await getStoredAutomationConfig()
    const fullEventSyncIntervalMs = normalizeAutomationIntervalMs(
      PACKAGE_FULL_EVENT_CHANGE_SYNC_INTERVAL_MS,
      60 * 60 * 1000,
      { minMs: 15 * 60 * 1000, maxMs: 24 * 60 * 60 * 1000 },
    )
    const reconciliationIntervalMs = normalizeAutomationIntervalMs(
      automationConfig.reconciliationIntervalMs,
      DEFAULT_PACKAGE_RECONCILIATION_INTERVAL_MS,
      { minMs: 15 * 60 * 1000, maxMs: 24 * 60 * 60 * 1000 },
    )
    return getPackageAutomationNextDelayMs({
      defaultIntervalMs,
      now: Date.now(),
      welcomeEnabled: automationConfig.automaticWelcome,
      welcomeIntervalMs: automationConfig.welcomeResponseIntervalMs,
      lastWelcomeCheckAt: lastNewPackageWelcomeCheckAt,
      eventUpdatesEnabled:
        WHATSAPP_STAGE_WATCHER_ENABLED &&
        (
          automationConfig.automaticStatusUpdates ||
          automationConfig.automaticInternationalArrivalTestNotifications ||
          automationConfig.automaticVentanillaNotifications
        ),
      eventChangeIntervalMs: automationConfig.eventChangeResponseIntervalMs,
      lastEventCheckAt: lastRecentPackageEventCheckAt,
      fullEventSyncEnabled:
        WHATSAPP_STAGE_WATCHER_ENABLED &&
        (
          automationConfig.automaticStatusUpdates ||
          automationConfig.automaticInternationalArrivalTestNotifications
        ),
      fullEventSyncIntervalMs,
      lastFullEventSyncAt: lastPackageEventChangeSyncAt,
      reconciliationEnabled: automationConfig.automaticReconciliation,
      reconciliationIntervalMs,
      lastReconciliationCheckAt: lastPackageReconciliationCheckAt,
    })
  }

  const scheduleNextRun = () => {
    void (async () => {
      let intervalMs = defaultIntervalMs
      try {
        intervalMs = await getWatcherIntervalMs()
      } catch (error) {
        console.warn(
          `Watcher WhatsApp: no se pudo leer el intervalo de automatizacion; se usara el intervalo base: ${error instanceof Error ? error.message : 'Error desconocido.'}`,
        )
      }

      console.log(
        `Watcher WhatsApp: proxima comprobacion automatica en ~${Math.ceil(intervalMs / 60000)} min.`,
      )
      setTimeout(
        () => void runAndReschedule({
          run: runWhatsAppStageWatcher,
          schedule: scheduleNextRun,
          onError: async (error) => {
            console.error(
              `Watcher WhatsApp: fallo el ciclo; se volvera a intentar en el siguiente intervalo: ${error instanceof Error ? error.message : 'Error desconocido.'}`,
            )
            await writeSystemLog({
              level: 'error',
              event: 'whatsapp_stage_watcher_cycle_failed',
              statusCode: 500,
              details: {
                error: error instanceof Error ? error.message : 'Error desconocido.',
              },
            }).catch(() => {})
          },
        }),
        intervalMs,
      )
    })()
  }

  void runAndReschedule({
    run: runWhatsAppStageWatcher,
    schedule: scheduleNextRun,
    onError: async (error) => {
      console.error(
        `Watcher WhatsApp: fallo la primera revision; se volvera a intentar en el siguiente intervalo: ${error instanceof Error ? error.message : 'Error desconocido.'}`,
      )
      await writeSystemLog({
        level: 'error',
        event: 'whatsapp_stage_watcher_initial_cycle_failed',
        statusCode: 500,
        details: {
          error: error instanceof Error ? error.message : 'Error desconocido.',
        },
      }).catch(() => {})
    },
  })

  console.log(
    `Watcher WhatsApp automatico activo; intervalo base ${Math.ceil(defaultIntervalMs / 60000)} min.`,
  )
}

const WHATSAPP_TRACKING_RETRY_ADVISORY_LOCK_ID = 9403017
const WHATSAPP_TRACKING_RETRY_BATCH_SIZE = 5
const WHATSAPP_TRACKING_RETRY_STALE_PROCESSING_MS = 30 * 60 * 1000

const buildWhatsAppTrackingRetryReply = (packageCode, packageContext) => {
  const events = Array.isArray(packageContext.packageEvents) ? packageContext.packageEvents : []
  const latestEvent = events
    .slice()
    .sort((firstEvent, secondEvent) => getPackageEventTimestampValue(secondEvent) - getPackageEventTimestampValue(firstEvent))[0]
  const status =
    normalizeReference(packageContext.currentStatusLabel) ||
    ({
      delivered: 'Entregado',
      cancelled: 'Cancelado o devuelto',
      courier: 'En reparto',
      regional: 'Recibido en destino',
      transit: 'En tránsito',
      received: 'Recibido en origen',
    }[packageContext.stage] ?? '')
  const latestEventLabel =
    normalizeReference(packageContext.currentLatestEventLabel) ||
    getPackageEventTitle(latestEvent)
  const latestEventLocation =
    normalizeReference(packageContext.currentLatestEventLocation) ||
    getPackageEventLocation(latestEvent)
  const destination =
    normalizeReference(packageContext.currentDestinationDepartment) ||
    normalizeReference(packageContext.currentDestinationLabel) ||
    normalizeReference(packageContext.currentDestinationAddress)

  return [
    `Ya pude consultar la guía ${packageCode}.`,
    status ? `Estado actual: ${status}.` : '',
    latestEventLabel
      ? `Último movimiento: ${latestEventLabel}${latestEventLocation ? `, en ${latestEventLocation}` : ''}.`
      : '',
    destination ? `Destino registrado: ${destination}.` : '',
  ]
    .filter(Boolean)
    .join(' ')
}

const processWhatsAppTrackingRetry = async (job) => {
  const packageCode = normalizePackageCodeForLookup(job.package_code)
  const cacheKey = `${normalizePhoneNumber(job.sender)}::${packageCode}`
  packageContextCache.delete(cacheKey)

  let packageContext = await fetchMatchingPackageContext(job.sender, packageCode)
  let trackingScanUnavailable = false
  if (
    !packageContext.matched &&
    !packageContext.trackingLookupUnavailable &&
    packageContext.trackingApiLookupUrl
  ) {
    const trackingDefaults = getTrackingApiDefaults()
    const scan = await findPackageCodeInPaginatedApi({
      url: new URL(packageContext.trackingApiLookupUrl),
      headers: {
        Authorization: `Bearer ${trackingDefaults.token}`,
        Accept: 'application/json',
      },
      source: 'tracking',
      code: packageCode,
      perPage: 200,
      maxPages: 100,
      startPage: Math.max(1, Number.parseInt(String(job.tracking_scan_page || 1), 10) || 1),
      timeoutMs: 8000,
    })

    trackingScanUnavailable = Boolean(scan.error)
    if (scan.found && scan.record) {
      await persistInternationalTrackingCatalog([scan.record])
      packageContextCache.delete(cacheKey)
      packageContext = await fetchMatchingPackageContext(job.sender, packageCode)
    } else {
      await pool.query(
        `
          update whatsapp_tracking_retry_queue
          set tracking_scan_page = $2,
              updated_at = now()
          where id = $1;
        `,
        [job.id, scan.complete ? 1 : scan.nextPage],
      )
    }
  }

  if (!packageContext.matched) {
    const expired = Date.parse(job.expires_at) <= Date.now() + WHATSAPP_TRACKING_RETRY_INTERVAL_MS
    const sourceUnavailable = packageContext.lookupUnavailable || trackingScanUnavailable
    const retryReason = sourceUnavailable ? 'tracking-source-unavailable' : 'package-not-found'
    await pool.query(
      `
        update whatsapp_tracking_retry_queue
        set status = $2,
            next_attempt_at = case
              when $2 = 'pending' then now() + interval '15 minutes'
              else next_attempt_at
            end,
            processing_started_at = null,
            last_error = $3,
            updated_at = now()
        where id = $1;
      `,
      [
        job.id,
        expired ? 'expired' : 'pending',
        retryReason,
      ],
    )
    await writeSystemLog({
      level: sourceUnavailable ? 'warn' : 'info',
      event: 'whatsapp_tracking_retry_checked',
      statusCode: sourceUnavailable ? 502 : 404,
      details: {
        retryId: job.id,
        packageCode,
        attemptCount: job.attempt_count,
        result: expired ? 'expired' : 'pending',
        reason: retryReason,
      },
    })
    return false
  }

  const whatsappConfig = await getStoredWhatsAppConfig()
  if (!normalizeReference(whatsappConfig.accessToken) || !normalizeReference(whatsappConfig.phoneNumberId)) {
    throw new Error('WhatsApp Meta no tiene credenciales de envio configuradas.')
  }

  const body = buildWhatsAppTrackingRetryReply(packageCode, packageContext)
  const response = await sendWhatsAppCloudMessage({
    accessToken: whatsappConfig.accessToken,
    apiVersion: whatsappConfig.apiVersion,
    phoneNumberId: whatsappConfig.phoneNumberId,
    to: normalizePhoneNumber(job.sender),
    body,
  })
  const providerMessageId = response?.messages?.[0]?.id ?? response?.message_id ?? null

  await pool.query(
    `
      update whatsapp_tracking_retry_queue
      set status = 'sent',
          provider_message_id = $2,
          processing_started_at = null,
          sent_at = now(),
          updated_at = now(),
          last_error = null
      where id = $1;
    `,
    [job.id, providerMessageId],
  )
  await pool.query(
    `
      insert into message_logs (
        contact_id, channel, direction, recipient_reference, message_text,
        provider_name, provider_message_id, status
      )
      values ($1, 'WhatsApp', 'outbound', $2, $3, 'Meta Cloud API', $4, 'sent');
    `,
    [job.contact_id, normalizePhoneNumber(job.sender), body, providerMessageId],
  )
  await writeSystemLog({
    event: 'whatsapp_tracking_retry_sent',
    statusCode: 200,
    details: {
      contactId: job.contact_id ?? null,
      packageCode,
      retryId: job.id,
      attemptCount: job.attempt_count,
      providerMessageId,
    },
  })
  return true
}

const runWhatsAppTrackingRetryQueue = async () => {
  await ensureDatabaseReady()
  const lockClient = await pool.connect()
  let lockAcquired = false

  try {
    const lockResult = await lockClient.query('select pg_try_advisory_lock($1) as locked', [
      WHATSAPP_TRACKING_RETRY_ADVISORY_LOCK_ID,
    ])
    lockAcquired = Boolean(lockResult.rows[0]?.locked)
    if (!lockAcquired) return

    await pool.query(
      `
        update whatsapp_tracking_retry_queue
        set status = 'expired', processing_started_at = null, updated_at = now()
        where status in ('pending', 'processing')
          and expires_at <= now();
      `,
    )

    const claimedJobs = await pool.query(
      `
        with due_jobs as (
          select id
          from whatsapp_tracking_retry_queue
          where expires_at > now()
            and (
              (status = 'pending' and next_attempt_at <= now())
              or (
                status = 'processing'
                and processing_started_at <= now() - ($2 * interval '1 millisecond')
              )
            )
          order by next_attempt_at, id
          limit $1
          for update skip locked
        )
        update whatsapp_tracking_retry_queue queue
        set status = 'processing',
            attempt_count = queue.attempt_count + 1,
            processing_started_at = now(),
            updated_at = now()
        from due_jobs
        where queue.id = due_jobs.id
        returning queue.*;
      `,
      [WHATSAPP_TRACKING_RETRY_BATCH_SIZE, WHATSAPP_TRACKING_RETRY_STALE_PROCESSING_MS],
    )

    for (const job of claimedJobs.rows) {
      try {
        await processWhatsAppTrackingRetry(job)
      } catch (error) {
        const expired = Date.parse(job.expires_at) <= Date.now() + WHATSAPP_TRACKING_RETRY_INTERVAL_MS
        await pool.query(
          `
            update whatsapp_tracking_retry_queue
            set status = $2,
                next_attempt_at = case
                  when $2 = 'pending' then now() + interval '15 minutes'
                  else next_attempt_at
                end,
                processing_started_at = null,
                last_error = $3,
                updated_at = now()
            where id = $1;
          `,
          [
            job.id,
            expired ? 'expired' : 'pending',
            error instanceof Error ? error.name : 'UnknownError',
          ],
        )
        await writeSystemLog({
          level: 'warn',
          event: 'whatsapp_tracking_retry_failed',
          statusCode: 502,
          details: {
            retryId: job.id,
            packageCode: job.package_code,
            attemptCount: job.attempt_count,
            errorName: error instanceof Error ? error.name : 'UnknownError',
          },
        })
      }
    }
  } finally {
    if (lockAcquired) {
      await lockClient.query('select pg_advisory_unlock($1)', [
        WHATSAPP_TRACKING_RETRY_ADVISORY_LOCK_ID,
      ]).catch(() => {})
    }
    lockClient.release()
  }
}

const startWhatsAppTrackingRetryWatcher = () => {
  const scheduleNextRun = () => {
    setTimeout(() => {
      void runAndReschedule({
        run: runWhatsAppTrackingRetryQueue,
        schedule: scheduleNextRun,
        onError: async (error) => {
          console.error(
            `Reintento de tracking WhatsApp fallido: ${error instanceof Error ? error.name : 'Error desconocido.'}`,
          )
          await writeSystemLog({
            level: 'error',
            event: 'whatsapp_tracking_retry_cycle_failed',
            statusCode: 500,
            details: {
              errorName: error instanceof Error ? error.name : 'UnknownError',
            },
          }).catch(() => {})
        },
      })
    }, WHATSAPP_TRACKING_RETRY_POLL_INTERVAL_MS)
  }

  void runAndReschedule({
    run: runWhatsAppTrackingRetryQueue,
    schedule: scheduleNextRun,
    onError: async (error) => {
      console.error(
        `No se pudo iniciar el reintento de tracking WhatsApp: ${error instanceof Error ? error.name : 'Error desconocido.'}`,
      )
      await writeSystemLog({
        level: 'error',
        event: 'whatsapp_tracking_retry_initial_cycle_failed',
        statusCode: 500,
        details: {
          errorName: error instanceof Error ? error.name : 'UnknownError',
        },
      }).catch(() => {})
    },
  })
  console.log('Reintento de tracking WhatsApp activo; cola revisada cada minuto y cada guia consultada cada 15 minutos.')
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

  const maxAttempts = Math.max(1, Number.parseInt(process.env.AI_GENERATE_RETRY_ATTEMPTS || '2', 10))
  let lastError = null

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
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
    } catch (error) {
      lastError = error
      aiHealthCache.delete(`${normalizeReference(config.baseUrl)}::${Math.min(timeoutMs, 1500)}`)

      if (attempt < maxAttempts) {
        await sleep(Math.min(1000, 250 * attempt))
      }
    }
  }

  throw lastError || new Error('La IA local no respondio correctamente.')
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
        inboundMessageId: inboundMessageId ?? null,
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

    let isPendingEmsWeightReply = false
    let isPendingEmsWeightReplyMissingUnit = false
    let pendingEmsConversation = ''
    if (
      (/^\d+(?:[.,]\d+)?$/.test(normalizeReference(messageBody)) || extractTariffWeightKg(messageBody)) &&
      Number.isInteger(inboundMessageId)
    ) {
      const pendingConversationResult = await pool.query(
        `
          select direction, message_text
          from message_logs
          where channel = 'WhatsApp'
            and id < $1
            and created_at >= now() - interval '30 minutes'
            and (
              contact_id = $2
              or regexp_replace(coalesce(recipient_reference, ''), '[^0-9]', '', 'g') = any($3::text[])
            )
          order by id desc
          limit 16;
        `,
        [inboundMessageId, contactId ?? -1, getWhatsAppNumberCandidates(sender)],
      )
      pendingEmsConversation = pendingConversationResult.rows
        .slice()
        .reverse()
        .map((row) => `${row.direction === 'inbound' ? 'Cliente' : 'Equipo'}: ${normalizeReference(row.message_text)}`)
        .filter(Boolean)
        .join('\n')
      isPendingEmsWeightReplyMissingUnit =
        isEmsWeightReplyMissingUnit(messageBody, pendingEmsConversation)
      isPendingEmsWeightReply =
        isEmsWeightReply(messageBody, pendingEmsConversation) ||
        isPendingEmsWeightReplyMissingUnit
    }

    const activeOffTopicPause = await getActiveOffTopicAutoReplyPause({ contactId, sender })
    if (activeOffTopicPause && isNonActionableCustomerMessage(messageBody) && !isPendingEmsWeightReply) {
      await writeSystemLog({
        event: 'whatsapp_auto_reply_skipped',
        statusCode: 200,
        details: {
          reason: 'off-topic-pause-active',
          contactId: contactId ?? null,
          sender: normalizePhoneNumber(sender),
          inboundMessageId: inboundMessageId ?? null,
          pausedUntil: activeOffTopicPause.pausedUntil ?? null,
          observation: 'El agente no respondio porque el contacto esta en pausa automatica por mensajes fuera de tema.',
        },
      })
      return null
    }

    if (activeOffTopicPause) {
      await writeSystemLog({
        event: 'whatsapp_auto_reply_resumed',
        statusCode: 200,
        details: {
          reason: 'actionable-message-during-off-topic-pause',
          contactId: contactId ?? null,
          sender: normalizePhoneNumber(sender),
          inboundMessageId: inboundMessageId ?? null,
          pausedUntil: activeOffTopicPause.pausedUntil ?? null,
        },
      }).catch(() => {})
    }

    if (isNonActionableCustomerMessage(messageBody) && !isPendingEmsWeightReply) {
      const nonActionableCount = await countRecentNonActionableInboundMessages({
        contactId,
        sender,
        inboundMessageId,
        currentMessageBody: messageBody,
      })

      if (nonActionableCount >= WHATSAPP_OFF_TOPIC_LIMIT) {
        const pausedUntil = await registerOffTopicAutoReplyPause({
          contactId,
          sender,
          messageBody,
          count: nonActionableCount,
        })

        await writeSystemLog({
          event: 'whatsapp_auto_reply_skipped',
          statusCode: 200,
          details: {
            reason: 'off-topic-pause-created',
            contactId: contactId ?? null,
            sender: normalizePhoneNumber(sender),
            inboundMessageId: inboundMessageId ?? null,
            pausedUntil,
            observation: 'Pausa automatica registrada; responder manualmente desde CRM si corresponde.',
          },
        })
        return null
      }
    }

    await writeSystemLog({
      event: 'whatsapp_auto_reply_started',
      statusCode: 200,
      details: {
        contactId: contactId ?? null,
        sender: normalizePhoneNumber(sender),
        inboundMessageId: inboundMessageId ?? null,
      },
    })

    const config = await getStoredWhatsAppConfig()
    const accessToken = normalizeReference(config.accessToken)
    const phoneNumberId = normalizeReference(config.phoneNumberId)

    if (!accessToken || !phoneNumberId) {
      await writeSystemLog({
        event: 'whatsapp_auto_reply_skipped',
        statusCode: 503,
        details: {
          reason: 'whatsapp-config-incomplete',
          contactId: contactId ?? null,
          inboundMessageId: inboundMessageId ?? null,
        },
      }).catch(() => {})
      return null
    }

    if (!isWhatsAppRecipientAllowedByTestMode(config, sender)) {
      await writeSystemLog({
        event: 'whatsapp_auto_reply_skipped',
        statusCode: 200,
        details: {
          reason: 'test-mode-recipient-not-allowed',
          contactId: contactId ?? null,
          sender: normalizePhoneNumber(sender),
          inboundMessageId: inboundMessageId ?? null,
        },
      }).catch(() => {})
      console.log(
        `[IA] Respuesta omitida para ${normalizePhoneNumber(sender)} porque no estÃ¡ autorizado por WHATSAPP_TEST_MODE.`,
      )
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
          limit 16;
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
    const tariffQuoteConversation = isPendingEmsWeightReply
      ? pendingEmsConversation
      : recentConversation

    const isInjectionAttempt = isPromptInjectionAttempt(messageBody)
    const needsEmsWeightUnitClarification =
      !isInjectionAttempt &&
      (isPendingEmsWeightReplyMissingUnit || isEmsWeightReplyMissingUnit(messageBody, recentConversation))
    const pendingEmsCategory = needsEmsWeightUnitClarification
      ? inferEmsCategoryFromPendingPrompt(tariffQuoteConversation)
      : ''
    const isGreetingOnly = !isInjectionAttempt && isGreetingMessage(messageBody)
    const isOpenAssistanceOnly = !isInjectionAttempt && isOpenAssistanceMessage(messageBody)
    const isGratitudeOnly = isGratitudeOnlyMessage(messageBody)
    const packageCodes = extractPackageCodeCandidates(messageBody)
    const packageCode = packageCodes[0] || ''
    const isExplicitPackageTrackingRequest = isPackageTrackingRequest({
      messageBody,
      packageCode,
    })
    const inferredIntent = await routeCustomerIntent({
      messageBody,
      recentConversation,
    })
    const routedIntent = isExplicitPackageTrackingRequest
      ? { ...inferredIntent, category: 'TRACKING', source: 'explicit-package-tracking' }
      : inferredIntent
    const hasPackageInquiry = !isInjectionAttempt && routedIntent.category !== 'TARIFAS' && (isPackageInquiryMessage(messageBody) || Boolean(packageCode))
    const isPackageInquiryWithoutCode = hasPackageInquiry && !hasPackageCode(messageBody)
    const isPackageDispute = !isInjectionAttempt && Boolean(packageCode) && isPackageDisputeMessage(messageBody)
    const packageContext =
      isGreetingOnly || isGratitudeOnly || !hasPackageInquiry
        ? getEmptyPackageContext()
        : await fetchMatchingPackageContext(sender, packageCode)
    const packageDeclarationReply =
      packageCode && isPackageDeclarationQuestion(messageBody)
        ? buildPackageDeclarationReply({
            packageCode,
            declaration: packageContext.cdsDeclaration,
            destinations: packageContext.declaredDestinations,
          })
        : ''
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
    const packageLookupUnavailable = Boolean(packageCode) && packageContext.lookupUnavailable
    let packageRetryScheduled = false
    if (isExplicitPackageTrackingRequest && packageCodeNotFound) {
      try {
        packageRetryScheduled = await scheduleWhatsAppTrackingRetry({
          contactId,
          sender,
          packageCode,
          inboundMessageId,
        })
        if (packageRetryScheduled) {
          await writeSystemLog({
            event: 'whatsapp_tracking_retry_scheduled',
            statusCode: 202,
            details: {
              contactId: contactId ?? null,
              inboundMessageId: inboundMessageId ?? null,
              packageCode: normalizePackageCodeForLookup(packageCode),
            },
          })
        }
      } catch (error) {
        console.error(
          `No se pudo programar el reintento de tracking: ${error instanceof Error ? error.name : 'Error desconocido.'}`,
        )
        await writeSystemLog({
          level: 'error',
          event: 'whatsapp_tracking_retry_schedule_failed',
          statusCode: 500,
          details: {
            contactId: contactId ?? null,
            inboundMessageId: inboundMessageId ?? null,
            packageCode: normalizePackageCodeForLookup(packageCode),
            errorName: error instanceof Error ? error.name : 'UnknownError',
          },
        }).catch(() => {})
      }
    }
    const conversationDestinationAlternative = getNearestConfiguredEmsDestination(
      getRecentCustomerConversationText(recentConversation),
    )
    const isConfirmingDestinationAlternative =
      conversationDestinationAlternative &&
      isEmsAlternativeDestinationAcceptance({
        text: messageBody,
        conversation: recentConversation,
        destinationName: conversationDestinationAlternative.name,
      })
    const acceptedConversationDestinationAlternative =
      getAcceptedEmsAlternativeDestination(recentConversation)
    const emsTariffFollowUp =
      !isInjectionAttempt &&
      (
        isEmsTariffFollowUp(messageBody, recentConversation) ||
        isPendingEmsWeightReply ||
        Boolean(isConfirmingDestinationAlternative || acceptedConversationDestinationAlternative)
      )
    const tariffQuote =
      !isInjectionAttempt &&
      !isExplicitPackageTrackingRequest &&
      (routedIntent.category === 'TARIFAS' || emsTariffFollowUp)
        ? await getTariffQuote({ messageBody, recentConversation: tariffQuoteConversation })
        : null

    const prompt = [
      'Responde como una persona real, con tono cercano y natural.',
      'Prioriza respuestas cortas y fluidas para WhatsApp: 1 o 2 frases, maximo 32 palabras.',
      'Si el cliente saluda o inicia la conversacion, responde primero con un saludo cordial y cercano, por ejemplo: "Â¡Hola! Buenas tardes. Soy Jaimito, de Correos de Bolivia. Â¿En quÃ© te puedo ayudar hoy?".',
      'No menciones el paquete, su estado ni su ubicacion si el cliente solo esta saludando o no ha preguntado por el envio.',
      'Si pregunta por un paquete, envio, seguimiento o ubicacion y no proporciona un codigo de seguimiento, pide primero ese codigo. No consultes ni informes otro paquete por el numero de telefono.',
      'Si el cliente pregunta donde esta el paquete o hacia donde va, responde primero con el estado actual y luego con el destino o direccion disponible.',
      'Usa frases naturales como "tu paquete esta en transito", "va hacia..." o "tiene destino en...".',
      'Ejemplo bueno: "Â¡Buenas noticias! Tu paquete ya llegÃ³ y estÃ¡ listo para que lo pases a recoger en nuestra sucursal de Santa Cruz. Â¡Te esperamos! âœ¨"',
      'Ejemplo malo: "Gracias por escribirnos. Seguimos monitoreando el avance para avisarte el siguiente movimiento confirmado."',
      'Eres un agente de soporte y ventas para CRM Omnicanal.',
      'Primero ya se clasificÃ³ el contacto en EMS; ahora debes responder el mensaje con naturalidad.',
      'Tu tarea es responder mensajes de WhatsApp de forma breve, natural y profesional.',
      'Responde solo en espaÃ±ol, en 2 o 3 frases como mÃ¡ximo y con no mÃ¡s de 40 palabras.',
      'Ve directo al punto: evita introducciones largas, listas y explicaciones innecesarias, pero conserva un saludo formal cuando corresponda.',
      'Responde Ãºnicamente lo que pregunta el cliente. Haz una sola pregunta final solo si necesitas aclarar algo.',
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

    let finalReply = packageDeclarationReply || (isGreetingOnly
      ? `Â¡Hola! ${getBoliviaDayGreeting()}, soy Jaimito de Correos de Bolivia. Puedo ayudarte a encontrar tu paquete y cotizar el costo de envÃ­o. Â¿QuÃ© necesitas?`
      : isExplicitPackageTrackingRequest
        ? packageRetryScheduled
          ? 'No pude confirmar ahora el estado de esa guía. Dejé programada una revisión automática cada 15 minutos durante 24 horas; te escribiré por aquí cuando encuentre información.'
          : packageLookupUnavailable
          ? 'No pude consultar el sistema de rastreo en este momento, así que no puedo confirmar el estado de esa guía. Inténtalo nuevamente en unos minutos, por favor.'
          : packageCodeNotFound
          ? renderTextTemplate(
              normalizeReference(botKnowledge.responses?.tracking?.notFound) ||
                'No pude localizar el paquete {packageCode}. Verifica el codigo e intentalo nuevamente, por favor.',
              { packageCode },
            )
          : packageContext.matched
            ? isPackageHistoryQuestion(messageBody)
              ? formatPackageHistoryReply(packageContext) ||
                buildFallbackAgentReply({ contact, messageBody, currentStatus: contact?.status ?? 'Nuevo', packageContext })
              : buildFallbackAgentReply({ contact, messageBody, currentStatus: contact?.status ?? 'Nuevo', packageContext })
            : normalizeReference(botKnowledge.responses?.tracking?.notFound) ||
              `No pude localizar el paquete ${packageCode}. Verifica el codigo e intentalo nuevamente, por favor.`
      : needsEmsWeightUnitClarification
        ? buildEmsWeightSpecificationsPrompt(messageBody, pendingEmsCategory)
      : tariffQuote
        ? ''
      : isPackageInquiryWithoutCode
        ? normalizeReference(botKnowledge.responses?.tracking?.missingCode) || '¡Perfecto! Dejame tu numero de guia y lo revisamos de inmediato.'
        : packageLookupUnavailable
          ? 'No pude consultar el sistema de rastreo en este momento, así que no puedo confirmar el estado de esa guía. Inténtalo nuevamente en unos minutos, por favor.'
          : packageCodeNotFound
          ? renderTextTemplate(
              normalizeReference(botKnowledge.responses?.tracking?.notFound) ||
                'No pude localizar el paquete {packageCode}. Verifica el codigo e intentalo nuevamente, por favor.',
              { packageCode },
            )
          : isPackageDispute
            ? `Entiendo la inconsistencia con la guia ${packageCode}. Para revisar ese caso con detalle y validar el registro, comunicate al ${supportContactNumber}; ahi pueden confirmar la informacion del sistema y corregir si corresponde.`
          : packageCode && packageContext.matched && isPackageHistoryQuestion(messageBody)
            ? formatPackageHistoryReply(packageContext) ||
              buildFallbackAgentReply({ contact, messageBody, currentStatus: contact?.status ?? 'Nuevo', packageContext })
            : packageCode && packageContext.matched
              ? buildFallbackAgentReply({ contact, messageBody, currentStatus: contact?.status ?? 'Nuevo', packageContext })
        : '')

    if (multiPackageResults.length > 1 && !packageDeclarationReply) {
      finalReply = buildMultiPackageContextReply(multiPackageResults)
    }

    if (!finalReply && isOpenAssistanceOnly) {
      finalReply = `Â¡Claro! ${getBoliviaDayGreeting()}. CuÃ©ntame tu consulta y con gusto te ayudo.`
    }

    if (isInjectionAttempt) {
      finalReply = PROMPT_INJECTION_SAFE_REPLY
    }

    if (!isInjectionAttempt && isGratitudeOnly) {
      finalReply = 'Â¡Con gusto! ðŸ˜Š Seguimos atentos a cualquier nuevo movimiento de tu paquete y te avisaremos apenas haya una actualizaciÃ³n ðŸ“².'
    }

    const shouldCallAiForReply =
      !finalReply &&
      !packageContext.matched &&
      !isGreetingOnly &&
      !isOpenAssistanceOnly &&
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
            tariffQuote,
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
          inboundMessageId: inboundMessageId ?? null,
          reason: error.message,
          routedCategory: routedIntent.category,
          routedBy: routedIntent.source,
        },
      })
    }

    if (!finalReply) {
      finalReply = buildConversationRecoveryReply({
        category: routedIntent.category,
        packageCode,
      }) || buildFallbackAgentReply({
        contact,
        messageBody,
        currentStatus: contact?.status ?? 'Nuevo',
        packageContext,
      })
    }

    if (!finalReply) {
      return null
    }

    finalReply = repairMojibakeText(finalReply)

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
          inboundMessageId: inboundMessageId ?? null,
          providerMessageId,
          routedCategory: routedIntent.category,
          routedBy: routedIntent.source,
          tariffRateId: tariffQuote?.rate?.id ?? null,
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
        inboundMessageId: inboundMessageId ?? null,
        error: error.message,
      },
    })
    return null
  }
}

let autoReplyQueue = Promise.resolve()

const enqueueAutoReply = (job) => {
  const queuedJob = autoReplyQueue.then(() => autoReplyInboundWhatsAppMessage(job))

  autoReplyQueue = queuedJob.catch(async (error) => {
    console.error(
      `Fallo un trabajo de la cola de respuestas IA: ${error instanceof Error ? error.name : 'Error desconocido.'}`,
    )
    await writeSystemLog({
      level: 'error',
      event: 'whatsapp_auto_reply_queue_failed',
      statusCode: 500,
      details: {
        contactId: job.contactId ?? null,
        inboundMessageId: job.inboundMessageId ?? null,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      },
    }).catch(() => {})
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
        const receivedAt = getWhatsAppMessageReceivedAt(message)

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
            media_filename,
            created_at
          )
          values ($1, 'WhatsApp', 'inbound', $2, $3, 'Meta Cloud API', $4, 'received', $5, $6, $7, $8, $9)
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
            receivedAt,
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
            receivedAt: receivedAt.toISOString(),
            preview: normalizeReference(messageBody).slice(0, 80),
          },
        }).catch(() => {})

        if (isWhatsAppMessageTooOldForAutoReply(receivedAt)) {
          await writeSystemLog({
            event: 'whatsapp_auto_reply_skipped',
            statusCode: 200,
            details: {
              reason: 'stale-inbound-message',
              contactId: matchedContact?.id ?? null,
              sender: normalizePhoneNumber(from),
              inboundMessageId: inboundLogResult.rows[0]?.id ?? null,
              providerMessageId,
              receivedAt: receivedAt.toISOString(),
            },
          }).catch(() => {})
        } else {
          void enqueueAutoReply({
            contactId: matchedContact?.id ?? null,
            sender: from,
            messageBody,
            inboundMessageId: inboundLogResult.rows[0]?.id ?? null,
          })
        }

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
  const seedAdminEmail = normalizeReference(process.env.SEED_ADMIN_EMAIL).toLowerCase()
  const seedAdminName = normalizeReference(process.env.SEED_ADMIN_NAME) || 'Administrador'
  const seedAdminPassword = normalizeReference(process.env.SEED_ADMIN_PASSWORD)

  try {
    if (seedAdminEmail && seedAdminPassword) {
      await client.query(
        `
          insert into users (full_name, email, password_hash, role_name)
          values ($1, $2, $3, 'Administradores')
          on conflict (email) do nothing;
        `,
        [seedAdminName, seedAdminEmail, hashPassword(seedAdminPassword)],
      )
    }

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

    if (!user || !verifyPassword(password, user.password_hash)) {
      response.status(401).json({ message: 'Credenciales invalidas.' })
      return
    }

    if (!String(user.password_hash).startsWith('scrypt$')) {
      await pool
        .query('update users set password_hash = $1 where id = $2;', [hashPassword(password), user.id])
        .catch(() => {})
    }

    const token = createSession(user)
    response.json({ token, user: sanitizeUser(user) })
  } catch (error) {
    response.status(500).json({ message: 'No se pudo iniciar sesion.', error: error.message })
  }
})

app.post('/api/auth/demo', async (_request, response) => {
  if (process.env.ENABLE_DEMO_LOGIN !== 'true') {
    response.status(404).json({ message: 'Inicio de sesion demo no disponible.' })
    return
  }

  const demoEmail = normalizeReference(process.env.DEMO_USER_EMAIL || process.env.SEED_ADMIN_EMAIL).toLowerCase()

  if (!demoEmail) {
    response.status(400).json({ message: 'Configura DEMO_USER_EMAIL para habilitar el demo.' })
    return
  }

  try {
    await ensureDatabaseReady()

    const result = await pool.query(
      `
        select id, full_name, email, role_name
        from users
        where lower(email) = lower($1)
        limit 1;
      `,
      [demoEmail],
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
    const [
      contactsResult,
      dealsResult,
      campaignsResult,
      agentsResult,
      whatsappConfig,
      contactGroups,
      prontsConfig,
      pipelineConfig,
      autoReplyPausesResult,
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
          latest_message.created_at as last_message_at,
          latest_inbound_message.created_at as last_inbound_at,
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
          select candidate.created_at, candidate.id, candidate.message_text, candidate.direction
          from (
            (
              select ml.created_at, ml.id, ml.message_text, ml.direction
              from message_logs ml
              where ml.contact_id = c.id
              order by ml.created_at desc, ml.id desc
              limit 1
            )
            union all
            (
              select ml.created_at, ml.id, ml.message_text, ml.direction
              from message_logs ml
              where whatsapp_profile.whatsapp_reference <> ''
                and regexp_replace(coalesce(ml.recipient_reference, ''), '[^0-9]', '', 'g') = whatsapp_profile.whatsapp_reference
              order by ml.created_at desc, ml.id desc
              limit 1
            )
          ) candidate
          order by candidate.created_at desc, candidate.id desc
          limit 1
        ) latest_message on true
        left join lateral (
          select candidate.created_at, candidate.id
          from (
            (
              select ml.created_at, ml.id
              from message_logs ml
              where ml.contact_id = c.id
                and ml.direction = 'inbound'
              order by ml.created_at desc, ml.id desc
              limit 1
            )
            union all
            (
              select ml.created_at, ml.id
              from message_logs ml
              where whatsapp_profile.whatsapp_reference <> ''
                and ml.direction = 'inbound'
                and regexp_replace(coalesce(ml.recipient_reference, ''), '[^0-9]', '', 'g') = whatsapp_profile.whatsapp_reference
              order by ml.created_at desc, ml.id desc
              limit 1
            )
          ) candidate
          order by candidate.created_at desc, candidate.id desc
          limit 1
        ) latest_inbound_message on true
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
      pool.query(`
        with latest_pause_events as (
          select distinct on (details->>'contactId')
            event,
            nullif(details->>'contactId', '')::int as contact_id,
            details->>'sender' as sender,
            details->>'pausedUntil' as paused_until,
            details->>'reason' as reason
          from system_logs
          where event in ('whatsapp_auto_reply_off_topic_pause', 'whatsapp_auto_reply_off_topic_unpause')
            and created_at >= now() - interval '8 hours'
            and nullif(details->>'contactId', '') is not null
          order by details->>'contactId', created_at desc, id desc
        )
        select contact_id, sender, paused_until, reason
        from latest_pause_events
        where event = 'whatsapp_auto_reply_off_topic_pause'
          and paused_until is not null
          and paused_until::timestamptz > now();
      `),
    ])

    const autoReplyPauseByContactId = new Map(
      autoReplyPausesResult.rows
        .filter((row) => Number.isInteger(Number(row.contact_id)))
        .map((row) => [
          Number(row.contact_id),
          {
            isPaused: true,
            pausedUntil: row.paused_until,
            reason: row.reason,
          },
        ]),
    )

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
      autoReplyPause: autoReplyPauseByContactId.get(Number(row.id)) ?? {
        isPaused: false,
        pausedUntil: null,
        reason: null,
      },
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
  const department = normalizeReference(request.query.department).toLowerCase() || 'all'
  const validDepartments = new Set(['all', 'la-paz', 'cochabamba', 'santa-cruz', 'oruro', 'potosi', 'tarija', 'chuquisaca', 'beni', 'pando'])
  const todayKey = getBoliviaDateKey(new Date().toISOString())
  const defaultEndDate = new Date(`${todayKey}T00:00:00Z`)
  const defaultStartDate = new Date(defaultEndDate)
  defaultStartDate.setUTCDate(defaultStartDate.getUTCDate() - 29)
  const defaultStartKey = defaultStartDate.toISOString().slice(0, 10)
  const dateStart = normalizeReference(request.query.date_start) || defaultStartKey
  const dateEnd = normalizeReference(request.query.date_end) || todayKey
  const isValidDateKey = (value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
    const parsed = Date.parse(`${value}T00:00:00Z`)
    return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value
  }
  const dateRangeDays = (Date.parse(`${dateEnd}T00:00:00Z`) - Date.parse(`${dateStart}T00:00:00Z`)) / 86400000
  const page = Math.max(1, Number.parseInt(String(request.query.page ?? '1'), 10) || 1)
  const perPage = Math.max(1, Number.parseInt(String(request.query.per_page ?? '20'), 10) || 20)

  if (
    !isValidDateKey(dateStart) ||
    !isValidDateKey(dateEnd) ||
    dateStart > todayKey ||
    dateEnd > todayKey ||
    dateRangeDays < 0 ||
    dateRangeDays > 29
  ) {
    response.status(400).json({ message: 'Selecciona fechas pasadas o actuales en un rango maximo de 30 dias.' })
    return
  }
  if (!validDepartments.has(department)) {
    response.status(400).json({ message: 'El departamento seleccionado no es valido.' })
    return
  }

  try {
    const { cards, customColumns } = await buildEmsPipelineCards()
    const customColumn = customColumns.find((column) => column.id === scope)

    const filteredCards = cards.filter((card) => {
      const dateKey = getBoliviaDateKey(card.updatedAt)
      const matchesDate = Boolean(dateKey) && dateKey >= dateStart && dateKey <= dateEnd
      const matchesDepartment = department === 'all' || card.department === department
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

      return matchesDate && matchesDepartment && matchesScope && matchesQuery
    })
    const totalItems = filteredCards.length
    const totalPages = Math.max(1, Math.ceil(totalItems / perPage))
    const currentPage = Math.min(page, totalPages)
    const fromIndex = (currentPage - 1) * perPage

    response.json({
      scope: scope || 'all',
      date_start: dateStart,
      date_end: dateEnd,
      department,
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

app.get('/api/internacionales/import-status', authMiddleware, async (_request, response) => {
  await ensureDatabaseReady()
  const countResult = await pool.query('select count(*)::integer as total from international_tracking_packages;')
  response.json({ ...ipsImportStatus, total: Number(countResult.rows[0]?.total ?? 0) })
})

app.post('/api/internacionales/sync', authMiddleware, async (request, response) => {
  try {
    const forceRefresh = String(request.query.force ?? '') === '1'
    const catalog = await fetchAllTrackingPackagesCatalog({ forceRefresh })
    const countResult = await pool.query('select count(*)::integer as total from international_tracking_packages;')
    response.json({
      ok: true,
      fetched: Number(catalog?.total ?? 0),
      total: Number(countResult.rows[0]?.total ?? 0),
      source: 'tracking-api',
      syncedAt: new Date().toISOString(),
      ...(catalog?.warning ? { warning: catalog.warning } : {}),
    })
  } catch (error) {
    response.status(502).json({
      ok: false,
      message: 'No se pudo sincronizar el catalogo completo desde SITRA.',
      error: error instanceof Error ? error.message : 'Error desconocido.',
    })
  }
})

app.post(
  '/api/internacionales/import',
  authMiddleware,
  ipsImportUpload.single('file'),
  async (request, response) => {
    if (!request.file) {
      response.status(400).json({ message: 'Selecciona un archivo JSON o NDJSON.' })
      return
    }
    if (ipsImportStatus.state === 'running') {
      await rm(request.file.path, { force: true }).catch(() => {})
      response.status(409).json({ message: 'Ya existe una importacion IPS en proceso.' })
      return
    }

    ipsImportStatus = {
      state: 'running',
      filename: request.file.originalname,
      total: ipsImportStatus.total,
      message: 'Importando y clasificando paquetes IPS...',
      startedAt: new Date().toISOString(),
      completedAt: null,
    }
    const importer = spawn(process.execPath, [path.join(__dirname, 'scripts', 'import-ips-packages.mjs'), request.file.path], {
      cwd: __dirname,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    let errorOutput = ''
    importer.stdout.on('data', (chunk) => { output = `${output}${chunk}`.slice(-2000) })
    importer.stderr.on('data', (chunk) => { errorOutput = `${errorOutput}${chunk}`.slice(-2000) })
    importer.on('close', async (exitCode) => {
      await rm(request.file.path, { force: true }).catch(() => {})
      const countResult = await pool.query('select count(*)::integer as total from international_tracking_packages;').catch(() => null)
      const total = Number(countResult?.rows?.[0]?.total ?? 0)
      ipsImportStatus = {
        state: exitCode === 0 ? 'complete' : 'error',
        filename: request.file.originalname,
        total,
        message: exitCode === 0
          ? `Importacion completa: ${total} paquetes disponibles.`
          : errorOutput.trim() || output.trim() || 'La importacion IPS fallo.',
        startedAt: ipsImportStatus.startedAt,
        completedAt: new Date().toISOString(),
      }
    })

    response.status(202).json({ ok: true, ...ipsImportStatus })
  },
)

const internationalPipelinePeriodCache = new Map()

app.get('/api/internacionales/pipeline', authMiddleware, async (request, response) => {
  const scope = normalizeReference(request.query.scope).toLowerCase()
  const query = normalizeReference(request.query.query).toLowerCase()
  const sortOrder = normalizeReference(request.query.sort).toLowerCase() === 'oldest' ? 'asc' : 'desc'
  const department = normalizeReference(request.query.department).toLowerCase() || 'all'
  const validDepartments = new Set(['all', 'la-paz', 'cochabamba', 'santa-cruz', 'oruro', 'potosi', 'tarija', 'chuquisaca', 'beni', 'pando'])
  const todayKey = getBoliviaDateKey(new Date().toISOString())
  const defaultEndDate = new Date(`${todayKey}T00:00:00Z`)
  const defaultStartDate = new Date(defaultEndDate)
  defaultStartDate.setUTCDate(defaultStartDate.getUTCDate() - 29)
  const dateStart = normalizeReference(request.query.date_start) || defaultStartDate.toISOString().slice(0, 10)
  const dateEnd = normalizeReference(request.query.date_end) || todayKey
  const isValidDateKey = (value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
    const parsed = Date.parse(`${value}T00:00:00Z`)
    return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value
  }
  const dateRangeDays = (Date.parse(`${dateEnd}T00:00:00Z`) - Date.parse(`${dateStart}T00:00:00Z`)) / 86400000
  const page = Math.max(1, Number.parseInt(String(request.query.page ?? '1'), 10) || 1)
  const perPage = Math.min(100, Math.max(1, Number.parseInt(String(request.query.per_page ?? '6'), 10) || 6))

  if (!pipelineStageKeys.includes(scope)) {
    response.status(400).json({ message: 'La etapa del pipeline internacional no es valida.' })
    return
  }
  if (
    !isValidDateKey(dateStart) ||
    !isValidDateKey(dateEnd) ||
    dateStart > todayKey ||
    dateEnd > todayKey ||
    dateRangeDays < 0 ||
    dateRangeDays > 30
  ) {
    response.status(400).json({ message: 'Selecciona fechas pasadas o actuales en un rango maximo de 31 dias.' })
    return
  }
  if (!validDepartments.has(department)) {
    response.status(400).json({ message: 'El departamento seleccionado no es valido.' })
    return
  }

  try {
    await ensureDatabaseReady()
    const cacheKey = `${dateStart}:${dateEnd}:${scope}`
    let rangeCache = internationalPipelinePeriodCache.get(cacheKey)
    if (!rangeCache || rangeCache.expiresAt <= Date.now()) {
      const nextRangeCache = { expiresAt: Number.POSITIVE_INFINITY, promise: null }
      const rangePromise = pool.query(
        `
          select package_code, stage_key, latest_event_code, latest_event_name,
            latest_event_at, search_text, payload
          from international_tracking_packages
          where stage_key = $1
            and latest_event_at >= (($2::date)::timestamp at time zone 'America/La_Paz')
            and latest_event_at < ((($3::date + 1)::timestamp) at time zone 'America/La_Paz')
          order by latest_event_at desc nulls last, package_code;
        `,
        [scope, dateStart, dateEnd],
      )
        .then((stageResult) => {
          const data = stageResult.rows.map((row) => {
            const latestEvent = getTrackingLatestEvent(row.payload) ?? {}
            const eventTimestamp = new Date(row.latest_event_at).toISOString()
            const normalizedEvent = {
              ...latestEvent,
              fecha: latestEvent?.event_gmt_dt ||
                latestEvent?.event_date ||
                latestEvent?.fecha_evento ||
                latestEvent?.fecha ||
                eventTimestamp,
              evento_id: latestEvent?.evento_id ??
                latestEvent?.event_code ??
                latestEvent?.event_type_cd ??
                latestEvent?.event_id ??
                row.latest_event_code,
              codigo_evento: latestEvent?.codigo_evento ??
                latestEvent?.event_code ??
                latestEvent?.event_type_cd ??
                latestEvent?.event_id ??
                row.latest_event_code,
              nombre: latestEvent?.nombre ||
                latestEvent?.evento_api ||
                latestEvent?.evento_original ||
                latestEvent?.event_name ||
                row.latest_event_name,
              oficina: latestEvent?.oficina || latestEvent?.office_name || latestEvent?.off_name || '',
            }

            return {
              ...row.payload,
              codigo_s10: row.package_code,
              codigo: row.package_code,
              fecha_registro: eventTimestamp,
              eventos: [normalizedEvent],
            }
          })
          const eventCatalog = {
            data,
            total: data.length,
            source: 'local-db',
          }
          const packageResult = {
            rows: stageResult.rows.map(({ payload }) => ({ payload })),
          }

          return [eventCatalog, packageResult]
        })
        .then(([eventCatalog, packageResult]) => {
          const storedPackages = packageResult.rows.map(({ payload }) => payload)
          const packageDetailsByCode = new Map()
          storedPackages.forEach((payload) => {
            const code = getPackageCodeFromItem(payload)
            if (code) packageDetailsByCode.set(code, payload)
          })

          const latestEventsByCode = new Map()
          eventCatalog.data.forEach((entry) => {
            const eventRows = Array.isArray(entry?.eventos)
              ? entry.eventos.filter(Boolean)
              : [
                  eventCatalog.source === 'ips-events-api' && entry?.evento && typeof entry.evento === 'object'
                    ? { ...entry, ...entry.evento }
                    : eventCatalog.source === 'ips-events-api' && entry?.event && typeof entry.event === 'object'
                      ? { ...entry, ...entry.event }
                      : eventCatalog.source === 'ips-events-api'
                        ? entry
                        : null,
                ]
              .filter(Boolean)
            const packageCode = getPackageCodeFromItem(entry) ||
              normalizePackageCodeForLookup(
                entry?.mailitm_fid ??
                entry?.paquete?.mailitm_fid ??
                entry?.evento?.mailitm_fid ??
                entry?.event?.mailitm_fid ??
                entry?.package_code ??
                entry?.tracking_code,
              )
            if (!packageCode) return

            eventRows.forEach((event) => {
              const timestamp = getPackageEventTimestampValue(event)
              if (!timestamp) return
              const dateKey = getBoliviaDateKey(timestamp)
              if (dateKey < dateStart || dateKey > dateEnd) return

              const current = latestEventsByCode.get(packageCode)
              if (current && current.timestamp >= timestamp) return
              const normalizedEvent = {
                ...event,
                fecha: event?.event_gmt_dt || event?.event_date || event?.fecha_evento || event?.fecha || '',
                evento_id: event?.evento_id ?? event?.event_code ?? event?.event_type_cd ?? event?.event_id,
                codigo_evento: event?.codigo_evento ?? event?.event_code ?? event?.event_type_cd ?? event?.event_id,
                nombre: event?.nombre || event?.evento_api || event?.evento_original || event?.event_name || '',
                oficina: event?.oficina || event?.office_name || event?.off_name || '',
              }
              latestEventsByCode.set(packageCode, { event: normalizedEvent, timestamp, entry })
            })
          })

          const items = [...latestEventsByCode.entries()].map(([packageCode, latest]) => {
            const packageDetails = packageDetailsByCode.get(packageCode) ?? {}
            const item = {
              ...latest.entry,
              ...packageDetails,
              codigo_s10: packageCode,
              codigo: packageCode,
              fecha_registro: normalizeReference(
                latest.event?.event_gmt_dt ||
                latest.event?.event_date ||
                latest.event?.fecha ||
                latest.event?.fecha_evento,
              ),
              eventos: [latest.event],
            }
            const eventLocation = getPackageEventLocation(latest.event) ||
              normalizeReference(item?.ubicacion || item?.oficina || item?.regional || item?.departamento)

            return {
              item,
              stage: getInternationalIpsStageFromEvent(latest.event) ?? inferTrackingPackageStage(item),
              eventTimestamp: latest.timestamp,
              eventLocation,
              searchText: JSON.stringify({ ...latest.entry, ...latest.event, ...packageDetails }).toLowerCase(),
            }
          })

          if (eventCatalog.source === 'tracking-api' && items.length === 0) {
            throw new Error('La API de Tracking no devolvió historiales de movimientos para los paquetes.')
          }

          return {
            items,
            total: items.length,
            source: eventCatalog.source,
            warning: eventCatalog.warning ?? null,
          }
        })
        .then((catalog) => {
          nextRangeCache.expiresAt = Date.now() + 15000
          return catalog
        })
        .catch((error) => {
          internationalPipelinePeriodCache.delete(cacheKey)
          throw error
        })
      nextRangeCache.promise = rangePromise
      rangeCache = nextRangeCache
      internationalPipelinePeriodCache.set(cacheKey, rangeCache)
      while (internationalPipelinePeriodCache.size > 18) {
        internationalPipelinePeriodCache.delete(internationalPipelinePeriodCache.keys().next().value)
      }
    }

    const rangeCatalog = await rangeCache.promise
    const filteredItems = rangeCatalog.items
      .filter((candidate) => {
        if (candidate.stage !== scope) return false
        if (department !== 'all' && getBolivianDepartmentKey(candidate.eventLocation) !== department) return false
        return !query ||
          String(getPackageCodeFromItem(candidate.item)).toLowerCase().includes(query) ||
          candidate.searchText.includes(query)
      })
      .sort((first, second) => {
        const timeDifference = first.eventTimestamp - second.eventTimestamp
        if (timeDifference) return sortOrder === 'asc' ? timeDifference : -timeDifference
        return String(getPackageCodeFromItem(first.item)).localeCompare(String(getPackageCodeFromItem(second.item)))
      })
    const totalItems = filteredItems.length
    const totalPages = Math.max(1, Math.ceil(totalItems / perPage))
    const currentPage = Math.min(page, totalPages)
    const fromIndex = (currentPage - 1) * perPage

    response.json({
      scope,
      date_start: dateStart,
      date_end: dateEnd,
      department,
      page: currentPage,
      per_page: perPage,
      total: totalItems,
      total_pages: totalPages,
      catalog_total: rangeCatalog.total,
      source: rangeCatalog.source,
      warning: rangeCatalog.warning,
      data: filteredItems.slice(fromIndex, fromIndex + perPage).map((candidate) => candidate.item),
      pagination: {
        page: currentPage,
        per_page: perPage,
        total_items: totalItems,
        total_pages: totalPages,
        has_more: currentPage < totalPages,
      },
    })

  } catch (error) {
    console.error('No se pudo consultar el pipeline internacional.', error)
    const rateLimited = error?.code === 'UPSTREAM_RATE_LIMIT'
    response.status(rateLimited ? 429 : 502).json({
      message: rateLimited
        ? 'SITRA está limitando las consultas. La carga esperará y reintentará para completar el catálogo; no se muestran resultados parciales.'
        : error instanceof Error && error.message.includes('no devolvió historiales')
          ? 'La API de Tracking respondió, pero no incluyó los movimientos necesarios para llenar el pipeline.'
          : error instanceof Error && error.message.startsWith('La API externa respondió HTTP')
            ? 'La API de Tracking rechazó la carga del catálogo. Revisa la autorización y vuelve a intentar.'
            : 'No se pudieron consultar los movimientos de paquetes del periodo seleccionado.',
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
  const entries = Array.isArray(request.body?.entry) ? request.body.entry : []
  const webhookSummary = entries.reduce(
    (summary, entry) => {
      for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
        summary.inboundMessages += Array.isArray(change?.value?.messages) ? change.value.messages.length : 0
        summary.statusUpdates += Array.isArray(change?.value?.statuses) ? change.value.statuses.length : 0
      }
      return summary
    },
    { entries: entries.length, inboundMessages: 0, statusUpdates: 0 },
  )
  console.log(
    `Webhook WhatsApp recibido: ${webhookSummary.entries} entrada(s), ` +
      `${webhookSummary.inboundMessages} mensaje(s) entrante(s), ${webhookSummary.statusUpdates} estado(s).`,
  )
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
  const action = normalizeReference(request.body?.action) || 'SimulaciÃ³n'
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

app.post('/api/contacts/:id/auto-reply-unpause', authMiddleware, async (request, response) => {
  const contactId = Number(request.params.id)

  if (!Number.isInteger(contactId) || contactId <= 0) {
    response.status(400).json({ message: 'El identificador del contacto no es valido.' })
    return
  }

  try {
    await ensureDatabaseReady()

    const contactResult = await pool.query(
      `
        select id, social_profiles
        from contacts
        where id = $1
        limit 1;
      `,
      [contactId],
    )
    const contact = contactResult.rows[0] ?? null

    if (!contact) {
      response.status(404).json({ message: 'No se encontro el contacto solicitado.' })
      return
    }

    const sender = resolveWhatsAppReference(contact)

    await writeSystemLog({
      event: 'whatsapp_auto_reply_off_topic_unpause',
      request,
      statusCode: 200,
      details: {
        contactId,
        sender: normalizePhoneNumber(sender),
        reason: 'Pausa automatica levantada manualmente desde CRM.',
      },
    })

    response.json({
      ok: true,
      contactId,
      message: 'Baneo de IA desactivado. El agente puede responder nuevamente.',
    })
  } catch (error) {
    response.status(500).json({
      message: 'No se pudo desactivar el baneo de IA.',
      error: error instanceof Error ? error.message : 'Error desconocido.',
    })
  }
})

app.post('/api/contacts/:id/auto-reply-retry', authMiddleware, async (request, response) => {
  const contactId = Number(request.params.id)

  if (!Number.isInteger(contactId) || contactId <= 0) {
    response.status(400).json({ message: 'El identificador del contacto no es valido.' })
    return
  }

  try {
    await ensureDatabaseReady()

    const inboundResult = await pool.query(
      `
        select id, recipient_reference, message_text
        from message_logs
        where contact_id = $1
          and channel = 'WhatsApp'
          and direction = 'inbound'
        order by created_at desc, id desc
        limit 1;
      `,
      [contactId],
    )

    const inboundMessage = inboundResult.rows[0] ?? null

    if (!inboundMessage) {
      response.status(404).json({ message: 'No hay mensajes entrantes para reintentar.' })
      return
    }

    const retryResult = await autoReplyInboundWhatsAppMessage({
      contactId,
      sender: inboundMessage.recipient_reference,
      messageBody: inboundMessage.message_text,
      inboundMessageId: inboundMessage.id,
    })

    if (!retryResult) {
      response.status(202).json({
        ok: false,
        contactId,
        inboundMessageId: inboundMessage.id,
        message: 'El reintento no genero respuesta. Revisa logs de auto-respuesta.',
      })
      return
    }

    response.json({
      ok: true,
      contactId,
      inboundMessageId: inboundMessage.id,
      reply: retryResult.response,
      providerMessageId: retryResult.providerMessageId,
    })
  } catch (error) {
    response.status(500).json({
      message: 'No se pudo reintentar la respuesta automatica.',
      error: error instanceof Error ? error.message : 'Error desconocido.',
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
        : 'Instruccion adicional: redacta una respuesta de 2 o 3 frases, mÃ¡ximo 40 palabras, cordial y lista para enviar por WhatsApp.',
      '',
      'Devuelve solo el texto sugerido, sin comillas ni explicaciones. Usa mÃ¡ximo 40 palabras y 3 frases.',
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
  startWhatsAppTrackingRetryWatcher()
})
