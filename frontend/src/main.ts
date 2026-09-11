import './style.css'
import 'flag-icons/css/flag-icons.min.css'
import { parsePhoneNumberFromString } from 'libphonenumber-js'
import type { CountryCode } from 'libphonenumber-js'
import * as XLSX from 'xlsx'
import { renderAuthenticatedApp, renderLoginScreen } from './layout'

type ViewKey =
  | 'ems'
  | 'internacionales'
  | 'internacionales-pipeline'
  | 'internacionales-paquetes'
  | 'pronts-nacional'
  | 'pronts-internacional'
  | 'chat'
  | 'contactos'
  | 'agrupaciones'
  | 'usuarios'
  | 'logs'

type MenuGroupKey = 'ems' | 'internacionales' | 'clientes' | 'usuarios' | 'sistema' | 'marketing'

type EmsStatusFilter = 'all' | 'received' | 'transit' | 'regional' | 'courier' | 'delivered' | 'cancelled'

type BaseEmsColumnKey = Exclude<EmsStatusFilter, 'all'>

type EmsColumnKey = BaseEmsColumnKey

type ProntsPresetKey = BaseEmsColumnKey
type ProntsColumnKey = string

type ProntsColumnConfig = {
  presetKey: ProntsPresetKey
  systemPrompt: string
  userTemplate: string
  temperature: number
  action: string
  sampleContactId: number | null
  response: string
}

type PipelineColumnConfig = {
  title: string
  helper: string
  allowedStates?: string[]
}

type CustomPipelineColumnConfig = PipelineColumnConfig & {
  id: string
}

type PipelineConfig = {
  columns: Record<EmsColumnKey, PipelineColumnConfig>
  customColumns: CustomPipelineColumnConfig[]
}

type ApiPipelineStateOption = {
  stateKey: string
  title: string
  helper: string
  count: number
  sources: string[]
  stages: EmsColumnKey[]
  isRegistered: boolean
}

type PackageCodeLookupResult = Record<string, unknown> | null

type Metrics = {
  monthlySales: string
  activeConversations: number
  activeLeads: number
  totalContacts: number
  hotLeads: number
}

type Contact = {
  id: number
  name: string
  company: string
  channel: string
  socialProfiles?: Array<{ channel: string; reference: string }>
  whatsappConnection?: {
    isConnected: boolean
    lastActivityAt: string | null
    lastInboundAt: string | null
  }
  segment: string
  owner: string
  status: string
  score: number
  updatedAt: string
  lastMessageText?: string | null
  lastMessageDirection?: string | null
  lastMessageAt?: string | null
}

type ChatListPagination = {
  items: Contact[]
  currentPage: number
  totalPages: number
  totalItems: number
  pageSize: number
}

type InternationalPackage = {
  id: number
  origin: string
  code: string
  name: string
  phone: string
  address: string
}

type TrackingApiPackage = {
  mailitm_pid: number
  codigo: string
  codigo_s10: string
  fecha_registro: string
  numero_despacho: string | null
  tipo_servicio: string
  peso: number | null
  clase_correo: string
  contenido: string | null
  estado_postal: string
  telefono?: string | null
  phone?: string | null
  numero_telefono?: string | null
  numeroTelefono?: string | null
  telefonos?: {
    remitente: string | null
    destinatario: string | null
  }
  estado?: {
    id?: number | null
    nombre?: string | null
  } | null
  remitente?: {
    nombre?: string | null
    telefono?: string | null
  } | null
  destinatario?: {
    nombre?: string | null
    telefono?: string | null
    direccion?: string | null
  } | null
  eventos?: Array<{
    fecha?: string | null
    codigo_evento?: number | null
    evento_id?: number | null
    nombre?: string | null
    evento_original?: string | null
    evento_api?: string | null
    oficina?: string | null
    detalle?: string | null
    movimiento_bolivia?: string | null
  }>
  origen:
  | {
    codigo: string | null
    nombre: string | null
    telefono?: string | null
  }
  | string
  destino:
  | {
    codigo: string | null
    nombre: string | null
    telefono?: string | null
  }
  | string
}

type TrackingApiEvent = NonNullable<TrackingApiPackage['eventos']>[number]

type TrackingApiStateOption = {
  value: string
  label: string
  count: number
  sampleCode: string
}

type ContactPackagesApiItem = {
  tipo: string | null
  id: number | string | null
  codigo: string | null
  estado?: {
    id?: number | null
    nombre?: string | null
  } | null
  remitente: {
    nombre: string | null
    telefono: string | null
  } | null
  destinatario: {
    nombre: string | null
    telefono: string | null
    direccion?: string | null
  } | null
  origen?:
  | {
    nombre?: string | null
    telefono?: string | null
  }
  | string
  | null
  destino?:
  | {
    nombre?: string | null
    telefono?: string | null
    direccion?: string | null
  }
  | string
  | null
  fecha_registro: string | null
  eventos?: TrackingApiPackage['eventos']
}

type EmsPackageCard = {
  id: string
  stage: EmsColumnKey
  code: string
  title: string
  summary: string
  senderName: string
  senderReference: string
  recipientName: string
  recipientReference: string
  destination: string
  status: string
  updatedAt: string
  sourceKind: 'tracking' | 'contact'
  sourceRecord: TrackingApiPackage | ContactPackagesApiItem
}

type EmsPipelineColumnPage = {
  items: EmsPackageCard[]
  currentPage: number
  totalPages: number
  totalItems: number
  pageSize: number
  state: 'idle' | 'loading' | 'error'
  error: string | null
  syncedAt: string | null
  requestSignature: string | null
}

type EmsStageOverrideMap = Record<string, EmsColumnKey>

type ContactGroup = {
  id: number
  name: string
  description: string
  color: string
  memberCount: number
  members: Array<{
    id: number
    name: string
    company: string
  }>
}

type WhatsAppChannelConfig = {
  phoneNumberId: string
  businessAccountId: string
  apiVersion: string
  senderNumber: string
  testModeEnabled: boolean
  testModeNumber: string
  testModeNumbers: string[]
  webhookVerifyToken: string
  hasAccessToken: boolean
  accessTokenMask: string
}

type DashboardData = {
  metrics: Metrics
  contacts: Contact[]
  contactGroups: ContactGroup[]
  prontsConfig?: Record<string, ProntsColumnConfig>
  pipelineConfig?: PipelineConfig
  emsStageOverrides?: Record<string, string>
  channelConfig?: {
    whatsapp: WhatsAppChannelConfig
  }
}

type CreateContactForm = {
  name: string
  company: string
  whatsappLocalNumber: string
  whatsappCountrySearch: string
  channels: string[]
  channelReferences: Record<string, string>
  segment: string
  owner: string
  status: string
  score: string
}

type CreateContactStep = 'personal' | 'channels' | 'details'

type LoginForm = {
  email: string
  password: string
  remember: boolean
}

type SessionUser = {
  id: number
  fullName: string
  email: string
  role: string
}

type ManagedUser = {
  id: number
  fullName: string
  email: string
  role: string
  createdAt: string
}

type WhatsAppConfigForm = {
  accessToken: string
  phoneNumberId: string
  businessAccountId: string
  apiVersion: string
  senderNumber: string
  webhookVerifyToken: string
}

type WhatsAppMessageForm = {
  contactId: number | null
  contactName: string
  targetReference: string
  message: string
  attachment: File | null
  attachmentName: string
  attachmentType: string
}

type WhatsAppTestForm = {
  targetReference: string
  message: string
}

type WhatsAppTestResult = {
  recipient: string
  provider: string
  messageId: string
}

type MessageNotification = {
  id: string
  contactId: number
  contactName: string
  preview: string
  timestamp: string
  createdAt: string
}

type WhatsAppTestModeApiPayload = {
  ok: boolean
  enabled: boolean
  number: string
  numbers?: string[]
}

type ContactConversationMessage = {
  id: number
  channel: string
  direction: string
  recipientReference: string
  message: string
  provider: string
  providerMessageId: string | null
  status: string
  errorMessage: string | null
  mediaUrl: string | null
  mediaKind: string | null
  mediaMimeType: string | null
  mediaFilename: string | null
  createdAt: string
}

type ContactConversationData = {
  contact: {
    id: number
    name: string
    company: string
    status?: string
  }
  messages: ContactConversationMessage[]
}

type GroupCreateForm = {
  name: string
  description: string
  color: string
}

type GroupSendForm = {
  groupId: number | null
  groupName: string
  message: string
}

type GroupContactPickerForm = {
  query: string
  contactId: string
}

type CreatePipelineColumnForm = {
  title: string
  helper: string
  presetKey: ProntsPresetKey
}

type GroupModalMode = 'create' | 'add-members'
type ContactModalMode = 'create' | 'edit'
type UserModalMode = 'create' | 'edit'

type UserForm = {
  fullName: string
  email: string
  password: string
  role: string
}

type LogsReport = {
  generatedAt: string
  period: { hours: number; level: string | null; path: string | null; month: string | null }
  totals: { total: number; info: number; warn: number; error: number }
  months: Array<{ value: string; label: string; count: number }>
  byEndpoint: Array<{ path: string; count: number; average_duration_ms: number | null; errors: number }>
  recent: Array<{
    id: number
    created_at: string
    level: string
    event: string
    method: string | null
    path: string | null
    status_code: number | null
    duration_ms: number | null
    user_id: number | null
    details: Record<string, unknown>
  }>
  pagination: {
    page: number
    perPage: number
    totalItems: number
    totalPages: number
  }
}

const app = document.querySelector<HTMLDivElement>('#app')

if (!app) {
  throw new Error('No se encontro el contenedor principal.')
}

const normalizeApiBase = (value: string | undefined) => value?.trim().replace(/\/$/, '') ?? ''

const getRuntimeApiBase = () => {
  const configuredBase = normalizeApiBase(import.meta.env.VITE_API_URL)

  if (configuredBase) {
    return configuredBase
  }

  if (typeof window === 'undefined') {
    return ''
  }

  if (window.location.protocol === 'file:') {
    return 'http://localhost:3001'
  }

  if (window.location.origin.startsWith('http')) {
    return window.location.origin.replace(/\/$/, '')
  }

  return ''
}

type AiAgentApiPayload = {
  ok: boolean
  enabled: boolean
  assistedContactIds?: number[]
}

const API_BASE = getRuntimeApiBase()

const STORAGE_KEYS = {
  sidebarCollapsed: 'crm-sidebar-collapsed',
  activeView: 'crm-active-view',
  prontsActiveColumn: 'crm-pronts-active-column',
  globalAiAgentEnabled: 'crm-global-ai-agent-enabled',
  emsMonthFilter: 'crm-ems-month-filter',
  emsStageOverrides: 'crm-ems-stage-overrides',
  trackingApiServiceFilter: 'crm-tracking-api-service-filter',
  trackingApiOriginFilter: 'crm-tracking-api-origin-filter',
  trackingApiDestinationFilter: 'crm-tracking-api-destination-filter',
  authToken: 'crm-auth-token',
  authExpiry: 'crm-auth-expiry',
  rememberSession: 'crm-remember-session',
  internationalPackages: 'crm-international-packages',
} as const

const DEFAULT_PRONTS_RESPONSE =
  '// Presiona "Ejecutar Simulación de Prompt" para probar el comportamiento de esta columna en tiempo real.'

const createProntsConfigFromPreset = (
  presetKey: ProntsPresetKey,
  overrides: Partial<ProntsColumnConfig> = {},
): ProntsColumnConfig => {
  const baseConfigs: Record<ProntsPresetKey, ProntsColumnConfig> = {
    received: {
      presetKey: 'received',
      systemPrompt:
        'Eres un agente aduanero senior e IA oficial de logística internacional EMS Conversa OS. Tu misión es auditar declaraciones juradas CN22/CN23, verificar valores declarados, detectar posibles retenciones aduaneras por monto superior a $150 USD y validar que el destinatario tenga teléfono completo.',
      userTemplate:
        'Audita el siguiente paquete ingresado:\n- Cliente: {cliente}\n- Tracking: {tracking}\n- Destino: {destino}\n- Peso: {peso}\n- Valor declarado: {valor}\n- Estado: {estado}\n- Grupo: {grupoNombre}',
      temperature: 0.2,
      action: 'Asignar Etiqueta IA y Notificar WhatsApp',
      sampleContactId: null,
      response: DEFAULT_PRONTS_RESPONSE,
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
      response: DEFAULT_PRONTS_RESPONSE,
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
      response: DEFAULT_PRONTS_RESPONSE,
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
      response: DEFAULT_PRONTS_RESPONSE,
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
      response: DEFAULT_PRONTS_RESPONSE,
    },
    cancelled: {
      presetKey: 'cancelled',
      systemPrompt:
        'Eres un coordinador de excepciones EMS. Informas cancelaciones, anulaciones y rechazos con tono claro y directo, sin dejar dudas sobre el estado final.',
      userTemplate:
        'Genera una actualización para un envio cancelado:\n- Cliente: {cliente}\n- Tracking: {tracking}\n- Destino: {destino}\n- Estado: {estado}\n- Grupo: {grupoNombre}',
      temperature: 0.2,
      action: 'Registrar cancelación y notificar WhatsApp',
      sampleContactId: null,
      response: DEFAULT_PRONTS_RESPONSE,
    },
  }

  const safePresetKey = baseConfigs[presetKey] ? presetKey : 'received'

  return {
    ...baseConfigs[safePresetKey],
    ...overrides,
    presetKey: safePresetKey,
  }
}

const isProntsPresetKey = (value: unknown): value is ProntsPresetKey =>
  typeof value === 'string' && value in prontsPresetMeta

const createDefaultProntsConfigs = (): Record<string, ProntsColumnConfig> => ({
  received: createProntsConfigFromPreset('received'),
  transit: createProntsConfigFromPreset('transit'),
  regional: createProntsConfigFromPreset('regional'),
  courier: createProntsConfigFromPreset('courier'),
  delivered: createProntsConfigFromPreset('delivered'),
  cancelled: createProntsConfigFromPreset('cancelled'),
})

const createDefaultPipelineConfig = (): PipelineConfig => ({
  columns: {
    received: {
      title: 'Recibido Origen',
      helper: 'Ingresados o en recepción inicial',
      allowedStates: ['recibido-origen'],
    },
    transit: {
      title: 'En Camino',
      helper: 'En tránsito hacia el destino final',
      allowedStates: ['en-camino'],
    },
    regional: {
      title: 'Recibido Destino',
      helper: 'Paquetes ya recibidos en la regional',
      allowedStates: ['recibido-destino'],
    },
    courier: {
      title: 'Cartero',
      helper: 'Paquetes asignados a reparto',
      allowedStates: ['cartero'],
    },
    delivered: {
      title: 'Entregado',
      helper: 'Entregas confirmadas o cerradas',
      allowedStates: ['entregado'],
    },
    cancelled: {
      title: 'Cancelado',
      helper: 'Envios anulados, cancelados o rechazados',
      allowedStates: ['cancelado', 'cancelada', 'anulado', 'anulada', 'cancelled', 'cancelada por cliente'],
    },
  },
  customColumns: [],
})

const menuGroups: Array<{
  key: MenuGroupKey
  label: string
  shortLabel: string
  items: Array<{ view: ViewKey; label: string }>
}> = [
    {
      key: 'ems',
      label: 'Nacional',
      shortLabel: 'NA',
      items: [
        { view: 'internacionales-paquetes', label: 'Nacionales' },
        { view: 'ems', label: 'Pipeline Nacional' },
        { view: 'pronts-nacional', label: 'Pronts Nacional' },

      ],
    },
    {
      key: 'internacionales',
      label: 'Internacionales',
      shortLabel: 'IN',
      items: [
        { view: 'internacionales', label: 'Internacionales' },
        { view: 'internacionales-pipeline', label: 'Pipeline Internacionales' },
        { view: 'pronts-internacional', label: 'Pronts Internacional' },
      ],
    },
    {
      key: 'clientes',
      label: 'Clientes',
      shortLabel: 'CL',
      items: [
        { view: 'chat', label: 'Chat' },
        { view: 'contactos', label: 'Contactos' },
        { view: 'agrupaciones', label: 'Agrupaciones' },
      ],
    },
    {
      key: 'usuarios',
      label: 'Usuarios',
      shortLabel: 'US',
      items: [{ view: 'usuarios', label: 'Usuarios' }],
    },
    {
      key: 'sistema',
      label: 'Sistema',
      shortLabel: 'SI',
      items: [{ view: 'logs', label: 'Reporte de logs' }],
    },
  ]

const isValidView = (value: unknown): value is ViewKey =>
  typeof value === 'string' && menuGroups.some((group) => group.items.some((item) => item.view === value))

type PhoneCountry = {
  iso2: CountryCode
  name: string
  dialCode: string
}

const phoneCountryOptions: PhoneCountry[] = [
  { iso2: 'AR', name: 'Argentina', dialCode: '54' },
  { iso2: 'BO', name: 'Bolivia', dialCode: '591' },
  { iso2: 'BR', name: 'Brasil', dialCode: '55' },
  { iso2: 'CL', name: 'Chile', dialCode: '56' },
  { iso2: 'CO', name: 'Colombia', dialCode: '57' },
  { iso2: 'CR', name: 'Costa Rica', dialCode: '506' },
  { iso2: 'DO', name: 'Republica Dominicana', dialCode: '1' },
  { iso2: 'EC', name: 'Ecuador', dialCode: '593' },
  { iso2: 'ES', name: 'Espana', dialCode: '34' },
  { iso2: 'GT', name: 'Guatemala', dialCode: '502' },
  { iso2: 'HN', name: 'Honduras', dialCode: '504' },
  { iso2: 'MX', name: 'Mexico', dialCode: '52' },
  { iso2: 'NI', name: 'Nicaragua', dialCode: '505' },
  { iso2: 'PA', name: 'Panama', dialCode: '507' },
  { iso2: 'PE', name: 'Peru', dialCode: '51' },
  { iso2: 'PY', name: 'Paraguay', dialCode: '595' },
  { iso2: 'RU', name: 'Rusia', dialCode: '7' },
  { iso2: 'SV', name: 'El Salvador', dialCode: '503' },
  { iso2: 'UY', name: 'Uruguay', dialCode: '598' },
  { iso2: 'US', name: 'Estados Unidos', dialCode: '1' },
  { iso2: 'VE', name: 'Venezuela', dialCode: '58' },
]

const defaultWhatsAppCountry = phoneCountryOptions.find((country) => country.iso2 === 'BO')!

const contactChannelOptions = ['WhatsApp', 'Email', 'Instagram', 'Facebook', 'Telegram'] as const

const getBrandIcon = () => `
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M4 8.5h16v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5v-9Z" stroke="currentColor" stroke-width="1.8"/>
    <path d="M4 9l8 5 8-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M8 6.5V5A1 1 0 0 1 9 4h6a1 1 0 0 1 1 1v1.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
  </svg>
`

const getRobotIcon = () => `
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect x="6" y="7" width="12" height="10" rx="3" stroke="currentColor" stroke-width="1.8"/>
    <path d="M12 4v3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    <path d="M8.5 11h0.01M15.5 11h0.01" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>
    <path d="M9 15c.8.8 1.8 1.2 3 1.2s2.2-.4 3-1.2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    <circle cx="12" cy="4" r="1" fill="currentColor"/>
  </svg>
`

const getMenuGroupIcon = (groupKey: MenuGroupKey) => {
  if (groupKey === 'ems') {
    return `
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M5 7.5h14M5 12h14M5 16.5h9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      </svg>
    `
  }

  if (groupKey === 'internacionales') {
    return `
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="1.8"/>
        <path d="M4 12h16M12 4c2.2 2 3.5 4.8 3.5 8S14.2 18 12 20c-2.2-2-3.5-4.8-3.5-8S9.8 6 12 4Z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    `
  }

  if (groupKey === 'clientes') {
    return `
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M7.5 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" stroke="currentColor" stroke-width="1.8"/>
        <path d="M16.5 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" stroke="currentColor" stroke-width="1.8"/>
        <path d="M3.5 18.5a4.5 4.5 0 0 1 8 0" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
        <path d="M13.5 18.5a3.8 3.8 0 0 1 7 0" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      </svg>
    `
  }

  if (groupKey === 'usuarios') {
    return `
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M12 12a3.5 3.5 0 1 0-3.5-3.5A3.5 3.5 0 0 0 12 12Z" stroke="currentColor" stroke-width="1.8"/>
        <path d="M5 19a7 7 0 0 1 14 0" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
        <path d="M16.5 8.5h3m-1.5-1.5v3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      </svg>
    `
  }

  if (groupKey === 'marketing') {
    return `
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M5 17.5V8.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
        <path d="M5 9c4-1.5 6.5-5 14-5v10c-7.5 0-10 3.5-14 5V9Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
        <path d="M8.5 15.5 10 19" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      </svg>
    `
  }

  return `
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4.5" y="4.5" width="6" height="6" rx="1.5" stroke="currentColor" stroke-width="1.8"/>
      <rect x="13.5" y="4.5" width="6" height="6" rx="1.5" stroke="currentColor" stroke-width="1.8"/>
      <rect x="9" y="13.5" width="6" height="6" rx="1.5" stroke="currentColor" stroke-width="1.8"/>
      <path d="M10.5 7.5h3M12 10.5v3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    </svg>
  `
}

const getStoredBoolean = (key: string, fallback: boolean) => {
  try {
    const value = localStorage.getItem(key)
    return value === null ? fallback : value === 'true'
  } catch {
    return fallback
  }
}

const getStoredString = (key: string, fallback: string) => {
  try {
    const value = localStorage.getItem(key)
    return value == null || value === '' ? fallback : value
  } catch {
    return fallback
  }
}

const getStoredJson = <T,>(key: string, fallback: T): T => {
  try {
    const value = localStorage.getItem(key)
    if (!value) {
      return fallback
    }

    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

const getStoredView = (): ViewKey | null => {
  try {
    const rawValue = localStorage.getItem(STORAGE_KEYS.activeView)
    const value = rawValue === 'pronts' ? 'pronts-nacional' : (rawValue as ViewKey | null)
    const validViews = menuGroups.flatMap((group) => group.items.map((item) => item.view))
    return value && validViews.includes(value) ? value : null
    return isValidView(value) ? value : null
  } catch {
    return null
  }
}

const getViewFromLocation = (): ViewKey | null => {
  try {
    const rawPath = window.location.pathname.replace(/\/+$/, '')
    const normalizedPath = rawPath === '' ? '/' : rawPath

    if (normalizedPath === '/login') {
      return null
    }

    const pathSegment = normalizedPath.startsWith('/') ? normalizedPath.slice(1) : normalizedPath
    const normalizedView = pathSegment === 'pronts' ? 'pronts-nacional' : pathSegment
    return isValidView(normalizedView) ? normalizedView : null
  } catch {
    return null
  }
}

const getInitialView = (): ViewKey => getViewFromLocation() ?? getStoredView() ?? 'ems'

const getViewHref = (view: ViewKey) => `/${view}`

const syncViewToLocation = (view: ViewKey, options: { replace?: boolean } = {}) => {
  try {
    const nextPath = getViewHref(view)
    if (window.location.pathname !== nextPath) {
      if (options.replace) {
        window.history.replaceState(null, '', nextPath)
      } else {
        window.history.pushState(null, '', nextPath)
      }
    }
  } catch {
    // ignore history issues
  }
}

const syncLoginToLocation = (options: { replace?: boolean } = {}) => {
  try {
    if (window.location.pathname !== '/login') {
      if (options.replace) {
        window.history.replaceState(null, '', '/login')
      } else {
        window.history.pushState(null, '', '/login')
      }
    }
  } catch {
    // ignore history issues
  }
}

const getStoredAuthSession = () => {
  try {
    const token = localStorage.getItem(STORAGE_KEYS.authToken)
    const expiresAt = localStorage.getItem(STORAGE_KEYS.authExpiry)

    if (expiresAt) {
      const expiryTime = new Date(expiresAt).getTime()
      if (Number.isNaN(expiryTime) || expiryTime <= Date.now()) {
        localStorage.removeItem(STORAGE_KEYS.authToken)
        localStorage.removeItem(STORAGE_KEYS.authExpiry)
        localStorage.removeItem(STORAGE_KEYS.rememberSession)
        return { token: null, expiresAt: null }
      }
    }

    return { token, expiresAt }
  } catch {
    return { token: null, expiresAt: null }
  }
}

const getEndOfTodayIso = () => {
  const expiresAt = new Date()
  expiresAt.setHours(24, 0, 0, 0)
  return expiresAt.toISOString()
}

const storedAuthSession = getStoredAuthSession()

let sessionExpiryTimer: ReturnType<typeof setTimeout> | null = null
let chatRefreshTimer: ReturnType<typeof setInterval> | null = null
let dashboardRefreshTimer: ReturnType<typeof setInterval> | null = null
let dashboardRefreshInFlight = false
const CHAT_REFRESH_INTERVAL_MS = 5000
const DASHBOARD_REFRESH_INTERVAL_MS = 15000
const CHAT_LIST_PAGE_SIZE = 20
const CONTACT_LIST_PAGE_SIZE = 7
const MESSAGE_NOTIFICATION_DURATION_MS = 5500
let topbarProfileGlobalListenersInstalled = false
let messageNotificationToneUnlocked = false
let messageNotificationAudioContext: AudioContext | null = null
let messageNotificationInteractionListenersInstalled = false
let locationSyncListenerInstalled = false
const seenMessageNotificationKeys = new Set<string>()
const messageNotificationCleanupTimers = new Map<string, ReturnType<typeof setTimeout>>()

const defaultContactForm = (): CreateContactForm => ({
  name: '',
  company: '',
  whatsappLocalNumber: '',
  whatsappCountrySearch: defaultWhatsAppCountry.iso2,
  channels: ['WhatsApp'],
  channelReferences: {
    WhatsApp: '',
  },
  segment: '',
  owner: 'Camila',
  status: 'Nuevo',
  score: '80',
})

const defaultLoginForm = (): LoginForm => ({
  email: 'gonzalo.fabris@correos.gob.bo',
  password: '123456',
  remember: true,
})

const defaultWhatsAppConfigForm = (): WhatsAppConfigForm => ({
  accessToken: '',
  phoneNumberId: '',
  businessAccountId: '',
  apiVersion: 'v23.0',
  senderNumber: '+59169670289',
  webhookVerifyToken: '',
})

const defaultWhatsAppMessageForm = (): WhatsAppMessageForm => ({
  contactId: null,
  contactName: '',
  targetReference: '',
  message: '',
  attachment: null,
  attachmentName: '',
  attachmentType: '',
})

const defaultWhatsAppTestForm = (): WhatsAppTestForm => ({
  targetReference: '',
  message: 'Hola, este es un mensaje de prueba enviado desde el CRM.',
})

const defaultContactConversation = (): ContactConversationData => ({
  contact: {
    id: 0,
    name: '',
    company: '',
  },
  messages: [],
})

const defaultGroupCreateForm = (): GroupCreateForm => ({
  name: '',
  description: '',
  color: '#0f6b60',
})

const defaultGroupSendForm = (): GroupSendForm => ({
  groupId: null,
  groupName: '',
  message:
    'Hola {{name}}, te escribimos desde {{company}} para compartirte una indicacion importante. Por favor respondeme cuando lo revises.',
})

const defaultGroupContactPickerForm = (): GroupContactPickerForm => ({
  query: '',
  contactId: '',
})

const defaultCreatePipelineColumnForm = (): CreatePipelineColumnForm => ({
  title: '',
  helper: '',
  presetKey: 'received',
})

const defaultUserForm = (): UserForm => ({
  fullName: '',
  email: '',
  password: '',
  role: 'Administradores',
})

const DEFAULT_WHATSAPP_TEST_NUMBER = '+59164229403'

const getSegmentOptions = () => {
  const groupNames = [...new Set((state.data?.contactGroups ?? []).map((group) => group.name.trim()).filter(Boolean))]
  return groupNames
}

const state: {
  isSidebarCollapsed: boolean
  expandedGroups: Set<MenuGroupKey>
  collapsedFlyoutGroup: MenuGroupKey | null
  activeView: ViewKey
  internationalPackages: InternationalPackage[]
  trackingApiPackages: TrackingApiPackage[]
  trackingApiState: 'idle' | 'loading' | 'error'
  trackingApiError: string | null
  trackingApiSyncedAt: string | null
  trackingApiTotalItems: number
  trackingApiPage: number
  trackingApiPageSize: number
  trackingApiHasMore: boolean
  trackingApiStateFilter: string
  trackingApiServiceFilter: string
  trackingApiOriginFilter: string
  trackingApiDestinationFilter: string
  trackingApiCatalogPackages: TrackingApiPackage[]
  trackingApiCatalogState: 'idle' | 'loading' | 'error'
  trackingApiCatalogError: string | null
  trackingApiCatalogSyncedAt: string | null
  emsPipelineSyncState: 'idle' | 'loading' | 'error'
  emsPipelineSyncError: string | null
  emsPipelineSyncSummary: {
    total: number
    createdCount: number
    updatedCount: number
    syncedAt: string | null
  } | null
  emsMonthFilter: string
  emsMonthOptions: Array<{ value: string; label: string; count: number }>
  emsStageOverrides: EmsStageOverrideMap
  packageCodeLookupQuery: string
  packageCodeLookupState: 'idle' | 'loading' | 'error'
  packageCodeLookupError: string | null
  packageCodeLookupResult: PackageCodeLookupResult
  isPackageCodeLookupModalOpen: boolean
  selectedTrackingApiPackage: TrackingApiPackage | null
  selectedEmsPackageDetailId: string | null
  isEmsPackageDetailModalOpen: boolean
  isEmsStatePackagesModalOpen: boolean
  emsStatePackagesModalScope: EmsColumnKey | null
  emsStatePackagesModalPage: number
  emsPipelineColumns: Record<string, EmsPipelineColumnPage>
  contactPackages: ContactPackagesApiItem[]
  contactPackagesState: 'idle' | 'loading' | 'error'
  contactPackagesError: string | null
  contactPackagesSyncedAt: string | null
  contactPackagesTotalItems: number
  contactPackagesCatalog: ContactPackagesApiItem[]
  contactPackagesCatalogLoaded: boolean
  contactPackagesPage: number
  contactPackagesPageSize: number
  contactPackagesHasMore: boolean
  contactPackagesTypeFilter: string
  contactPackagesStatusFilter: string
  emsStatusFilter: EmsStatusFilter
  emsReceivedSearchQuery: string
  emsRegionalSearchQuery: string
  emsTransitSearchQuery: string
  emsDeliveredSearchQuery: string
  emsCourierSearchQuery: string
  chatListPage: number
  contactListPage: number
  globalAiAgentEnabled: boolean
  prontsActiveColumn: ProntsColumnKey
  prontsConfigs: Record<string, ProntsColumnConfig>
  prontsConfigState: 'idle' | 'submitting'
  prontsConfigError: string | null
  prontsSimulationState: 'idle' | 'running'
  pipelineConfig: PipelineConfig
  pipelineConfigState: 'idle' | 'submitting'
  pipelineConfigError: string | null
  customEmsColumnDraftName: string
  customEmsColumnDraftHelper: string
  isCustomEmsStateModalOpen: boolean
  customEmsStateModalScope: EmsColumnKey | null
  isCreatePipelineColumnModalOpen: boolean
  createPipelineColumnForm: CreatePipelineColumnForm
  searchQuery: string
  segmentFilter: string
  statusFilter: string
  data: DashboardData | null
  loading: boolean
  error: string | null
  isCreateContactModalOpen: boolean
  createContactStep: CreateContactStep
  contactModalMode: ContactModalMode
  activeContactId: number | null
  createContactForm: CreateContactForm
  submitState: 'idle' | 'submitting'
  submitError: string | null
  notice: string | null
  selectedContactIds: Set<number>
  groupCreateForm: GroupCreateForm
  groupContactPickerForm: GroupContactPickerForm
  groupModalMode: GroupModalMode
  groupActiveId: number | null
  groupActiveName: string
  groupCreateState: 'idle' | 'submitting'
  groupCreateError: string | null
  isGroupCreateModalOpen: boolean
  isGroupSendModalOpen: boolean
  groupSendForm: GroupSendForm
  groupSendState: 'idle' | 'submitting'
  groupSendError: string | null
  whatsappConfigForm: WhatsAppConfigForm
  whatsappConfigState: 'idle' | 'submitting'
  whatsappConfigError: string | null
  whatsappTestForm: WhatsAppTestForm
  whatsappTestState: 'idle' | 'submitting'
  whatsappTestError: string | null
  whatsappTestResult: WhatsAppTestResult | null
  whatsappTestModeEnabled: boolean
  whatsappTestModeNumber: string
  whatsappTestModeNumbers: string[]
  whatsappTestModeState: 'idle' | 'submitting'
  whatsappTestNumbersState: 'idle' | 'submitting'
  whatsappTestNumbersError: string | null
  whatsappTestNumberDraft: string
  whatsappTestNumberCountry: string
  whatsappEditingTestNumber: string | null
  isSendMessageModalOpen: boolean
  sendMessageForm: WhatsAppMessageForm
  sendMessageState: 'idle' | 'submitting'
  sendMessageError: string | null
  isConversationModalOpen: boolean
  isContactProfileModalOpen: boolean
  conversationState: 'idle' | 'loading'
  conversationError: string | null
  conversationData: ContactConversationData
  expandedConversationMessageIds: Set<number>
  aiAssistedContactIds: Set<number>
  authToken: string | null
  authExpiresAt: string | null
  sessionUser: SessionUser | null
  authLoading: boolean
  loginForm: LoginForm
  showPassword: boolean
  loginError: string | null
  loginState: 'idle' | 'submitting'
  topbarProfileOpen: boolean
  users: ManagedUser[]
  usersState: 'idle' | 'loading' | 'error'
  usersError: string | null
  usersSyncedAt: string | null
  isUserModalOpen: boolean
  userModalMode: UserModalMode
  activeUserId: number | null
  userForm: UserForm
  userSubmitState: 'idle' | 'submitting'
  userSubmitError: string | null
  logsReport: LogsReport | null
  logsState: 'idle' | 'loading' | 'error'
  logsError: string | null
  logsHours: number
  logsLevel: string
  logsMonthFilter: string
  logsPage: number
  logsPageSize: number
  messageNotifications: MessageNotification[]
} = {
  isSidebarCollapsed: getStoredBoolean(STORAGE_KEYS.sidebarCollapsed, false),
  expandedGroups: new Set(['ems', 'internacionales', 'clientes', 'usuarios', 'sistema']),
  collapsedFlyoutGroup: null,
  activeView: getInitialView(),
  internationalPackages: getStoredJson<InternationalPackage[]>(STORAGE_KEYS.internationalPackages, []),
  trackingApiPackages: [],
  trackingApiState: 'idle',
  trackingApiError: null,
  trackingApiSyncedAt: null,
  trackingApiTotalItems: 0,
  trackingApiPage: 1,
  trackingApiPageSize: 12,
  trackingApiHasMore: false,
  trackingApiStateFilter: 'all',
  trackingApiServiceFilter: getStoredString(STORAGE_KEYS.trackingApiServiceFilter, 'all'),
  trackingApiOriginFilter: getStoredString(STORAGE_KEYS.trackingApiOriginFilter, 'all'),
  trackingApiDestinationFilter: getStoredString(STORAGE_KEYS.trackingApiDestinationFilter, 'all'),
  trackingApiCatalogPackages: [],
  trackingApiCatalogState: 'idle',
  trackingApiCatalogError: null,
  trackingApiCatalogSyncedAt: null,
  emsPipelineSyncState: 'idle',
  emsPipelineSyncError: null,
  emsPipelineSyncSummary: null,
  emsMonthFilter: 'all',
  emsMonthOptions: [],
  emsStageOverrides: getStoredJson<EmsStageOverrideMap>(STORAGE_KEYS.emsStageOverrides, {}),
  packageCodeLookupQuery: '',
  packageCodeLookupState: 'idle',
  packageCodeLookupError: null,
  packageCodeLookupResult: null,
  isPackageCodeLookupModalOpen: false,
  selectedTrackingApiPackage: null,
  selectedEmsPackageDetailId: null,
  isEmsPackageDetailModalOpen: false,
  isEmsStatePackagesModalOpen: false,
  emsStatePackagesModalScope: null,
  emsStatePackagesModalPage: 1,
  emsPipelineColumns: {},
  contactPackages: [],
  contactPackagesState: 'idle',
  contactPackagesError: null,
  contactPackagesSyncedAt: null,
  contactPackagesTotalItems: 0,
  contactPackagesCatalog: [],
  contactPackagesCatalogLoaded: false,
  contactPackagesPage: 1,
  contactPackagesPageSize: 10,
  contactPackagesHasMore: false,
  contactPackagesTypeFilter: 'all',
  contactPackagesStatusFilter: 'all',
  emsStatusFilter: 'all',
  emsReceivedSearchQuery: '',
  emsRegionalSearchQuery: '',
  emsTransitSearchQuery: '',
  emsDeliveredSearchQuery: '',
  emsCourierSearchQuery: '',
  chatListPage: 1,
  contactListPage: 1,
  globalAiAgentEnabled: getStoredBoolean(STORAGE_KEYS.globalAiAgentEnabled, false),
  prontsActiveColumn: 'received',
  prontsConfigs: createDefaultProntsConfigs(),
  prontsConfigState: 'idle',
  prontsConfigError: null,
  prontsSimulationState: 'idle',
  pipelineConfig: createDefaultPipelineConfig(),
  pipelineConfigState: 'idle',
  pipelineConfigError: null,
  customEmsColumnDraftName: '',
  customEmsColumnDraftHelper: '',
  isCustomEmsStateModalOpen: false,
  customEmsStateModalScope: null,
  isCreatePipelineColumnModalOpen: false,
  createPipelineColumnForm: defaultCreatePipelineColumnForm(),
  searchQuery: '',
  segmentFilter: 'Todos',
  statusFilter: 'Todos',
  data: null,
  loading: false,
  error: null,
  isCreateContactModalOpen: false,
  createContactStep: 'personal',
  contactModalMode: 'create',
  activeContactId: null,
  createContactForm: defaultContactForm(),
  submitState: 'idle',
  submitError: null,
  notice: null,
  selectedContactIds: new Set(),
  groupCreateForm: defaultGroupCreateForm(),
  groupContactPickerForm: defaultGroupContactPickerForm(),
  groupModalMode: 'create',
  groupActiveId: null,
  groupActiveName: '',
  groupCreateState: 'idle',
  groupCreateError: null,
  isGroupCreateModalOpen: false,
  isGroupSendModalOpen: false,
  groupSendForm: defaultGroupSendForm(),
  groupSendState: 'idle',
  groupSendError: null,
  whatsappConfigForm: defaultWhatsAppConfigForm(),
  whatsappConfigState: 'idle',
  whatsappConfigError: null,
  whatsappTestForm: defaultWhatsAppTestForm(),
  whatsappTestState: 'idle',
  whatsappTestError: null,
  whatsappTestResult: null,
  whatsappTestModeEnabled: true,
  whatsappTestModeNumber: '59164229403',
  whatsappTestModeNumbers: ['59164229403'],
  whatsappTestModeState: 'idle',
  whatsappTestNumbersState: 'idle',
  whatsappTestNumbersError: null,
  whatsappTestNumberDraft: '',
  whatsappTestNumberCountry: defaultWhatsAppCountry.iso2,
  whatsappEditingTestNumber: null,
  isSendMessageModalOpen: false,
  sendMessageForm: defaultWhatsAppMessageForm(),
  sendMessageState: 'idle',
  sendMessageError: null,
  isConversationModalOpen: false,
  isContactProfileModalOpen: false,
  conversationState: 'idle',
  conversationError: null,
  conversationData: defaultContactConversation(),
  expandedConversationMessageIds: new Set(),
  aiAssistedContactIds: new Set(),
  authToken: storedAuthSession.token,
  authExpiresAt: storedAuthSession.expiresAt,
  sessionUser: null,
  authLoading: true,
  loginForm: defaultLoginForm(),
  showPassword: false,
  loginError: null,
  loginState: 'idle',
  topbarProfileOpen: false,
  users: [],
  usersState: 'idle',
  usersError: null,
  usersSyncedAt: null,
  isUserModalOpen: false,
  userModalMode: 'create',
  activeUserId: null,
  userForm: defaultUserForm(),
  userSubmitState: 'idle',
  userSubmitError: null,
  logsReport: null,
  logsState: 'idle',
  logsError: null,
  logsHours: 24,
  logsLevel: '',
  logsMonthFilter: 'all',
  logsPage: 1,
  logsPageSize: 10,
  messageNotifications: [],
}

const hydrateProntsState = () => {
  const storedActiveColumn = getStoredJson<ProntsColumnKey>(STORAGE_KEYS.prontsActiveColumn, state.prontsActiveColumn)
  if (typeof storedActiveColumn === 'string' && storedActiveColumn.trim().length > 0) {
    state.prontsActiveColumn = storedActiveColumn
  }
}

const saveStoredJson = <T,>(key: string, value: T) => {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // ignore storage issues
  }
}

hydrateProntsState()

const toggleGlobalAiAgent = async () => {
  const nextEnabled = !state.globalAiAgentEnabled

  try {
    const response = await authFetch('/api/ai/agent', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ enabled: nextEnabled }),
    })

    const payload = await parseApiPayload(response)

    if (response.status === 401) {
      clearSession()
      state.loginError = 'Tu sesion expiro. Inicia sesion nuevamente.'
      renderApp()
      return
    }

    if (!response.ok) {
      throw new Error(
        (payload?.error as string) ||
        (payload?.message as string) ||
        'No se pudo actualizar el agente IA.',
      )
    }

    state.globalAiAgentEnabled = Boolean(payload?.enabled)
    persistUiState()
    state.notice = state.globalAiAgentEnabled
      ? 'Agente IA activado para todas las conversaciones.'
      : 'Agente IA desactivado.'
    renderApp()
  } catch (error) {
    state.notice = error instanceof Error ? error.message : 'No se pudo actualizar el agente IA.'
    renderApp()
  }
}

const toggleWhatsAppTestMode = async () => {
  const nextEnabled = !state.whatsappTestModeEnabled

  if (!nextEnabled) {
    const shouldDisable = window.confirm(
      'Si desactivas el modo prueba, el CRM podra enviar comunicaciones a todos los contactos con seguimiento de paquetes. ¿Deseas continuar?',
    )

    if (!shouldDisable) {
      state.notice = 'Modo prueba cancelado. No se desactivó.'
      renderApp()
      return
    }
  }

  state.whatsappTestModeState = 'submitting'
  state.notice = null
  renderApp()

  try {
    const response = await authFetch('/api/integrations/whatsapp-test-mode', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ enabled: nextEnabled }),
    })

    const payload = (await parseApiPayload(response)) as Partial<WhatsAppTestModeApiPayload>

    if (response.status === 401) {
      clearSession()
      state.loginError = 'Tu sesion expiro. Inicia sesion nuevamente.'
      renderApp()
      return
    }

    if (!response.ok) {
      throw new Error(
        (payload as { error?: string; message?: string } | null)?.error ||
        (payload as { error?: string; message?: string } | null)?.message ||
        'No se pudo actualizar el modo de prueba.',
      )
    }

    state.whatsappTestModeEnabled = Boolean(payload?.enabled)
    applyWhatsAppTestNumbersPayload(payload)
    state.notice = state.whatsappTestModeEnabled
      ? `Modo prueba activado para el numero ${formatBoliviaTestPhone(state.whatsappTestModeNumber)}.`
      : 'Modo prueba desactivado.'
    await loadDashboard()
  } catch (error) {
    state.whatsappTestModeState = 'idle'
    state.notice = error instanceof Error ? error.message : 'No se pudo actualizar el modo de prueba.'
    renderApp()
  }
}

const syncGlobalAiAgentSetting = async () => {
  try {
    const response = await authFetch('/api/ai/agent')
    const payload = (await parseApiPayload(response)) as Partial<AiAgentApiPayload>

    if (!response.ok) {
      return
    }

    state.globalAiAgentEnabled = Boolean(payload?.enabled)
    state.aiAssistedContactIds = new Set(
      Array.isArray(payload?.assistedContactIds)
        ? payload.assistedContactIds.filter((value) => Number.isInteger(Number(value)) && Number(value) > 0).map(Number)
        : [],
    )
    persistUiState()
  } catch {
    // ignore sync errors
  }
}

const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')

const normalizeImportHeader = (value: unknown) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')

const getImportedValue = (row: Record<string, unknown>, aliases: string[]) => {
  const entry = Object.entries(row).find(([key]) => aliases.includes(normalizeImportHeader(key)))
  return String(entry?.[1] ?? '').trim()
}

const normalizePhoneDigits = (value: unknown) => String(value ?? '').replace(/[^\d]/g, '')
const parsePossiblePhoneNumber = (value: unknown, defaultCountry: CountryCode = 'BO') => {
  const digits = normalizePhoneDigits(value)

  if (!digits) {
    return null
  }

  const phoneNumber =
    parsePhoneNumberFromString(digits, defaultCountry) ??
    parsePhoneNumberFromString(`+${digits}`)

  if (!phoneNumber?.isPossible()) {
    return null
  }

  return phoneNumber
}

const isCellPhoneNumber = (value: unknown) => {
  const phoneNumber = parsePossiblePhoneNumber(value, 'BO')

  if (!phoneNumber) {
    return false
  }

  const phoneType = phoneNumber.getType?.()
  return phoneType === 'MOBILE' || phoneType === 'FIXED_LINE_OR_MOBILE'
}

const normalizeBoliviaTestPhoneDigits = (value: unknown) => {
  const digits = normalizePhoneDigits(value)

  if (digits.length === 8) {
    return `591${digits}`
  }

  if (digits.length === 11 && digits.startsWith('591')) {
    return digits
  }

  return digits
}

const formatBoliviaTestPhone = (value: unknown) => {
  const digits = normalizeBoliviaTestPhoneDigits(value)
  return digits ? `+${digits}` : DEFAULT_WHATSAPP_TEST_NUMBER
}

const getBoliviaTestPhoneCandidates = (value: unknown) => {
  const canonical = normalizeBoliviaTestPhoneDigits(value)

  if (!canonical) return []

  const candidates = new Set([canonical])

  if (canonical.startsWith('591') && canonical.length === 11) {
    candidates.add(canonical.slice(3))
  }

  return [...candidates]
}

const saveInternationalPackages = () => {
  localStorage.setItem(STORAGE_KEYS.internationalPackages, JSON.stringify(state.internationalPackages))
}

let trackingApiCatalogLoadRequestId = 0

const loadTrackingApiPackages = async () => {
  state.trackingApiState = 'loading'
  state.trackingApiError = null
  renderApp()
  const requestedPage = state.trackingApiPage

  try {
    const response = await authFetch(
      `/api/tracking/paquetes?page=${state.trackingApiPage}&per_page=${state.trackingApiPageSize}`,
    )
    const payload = await parseApiPayload(response)

    if (response.status === 401) {
      clearSession()
      state.loginError = 'Tu sesion expiro. Vuelve a iniciar sesion.'
      state.trackingApiState = 'idle'
      renderApp()
      return
    }

    if (!response.ok) {
      throw new Error(
        (payload?.error as string) ||
        (payload?.message as string) ||
        'No se pudo cargar la informacion de tracking.',
      )
    }

    const remoteData = Array.isArray(payload?.data) ? (payload.data as TrackingApiPackage[]) : []
    const totalItems = Number(
      (payload?.paginacion as { total_registros?: number } | undefined)?.total_registros ??
      (payload?.meta as { total?: number } | undefined)?.total ??
      payload?.count ??
      remoteData.length ??
      0,
    )

    if (remoteData.length === 0 && requestedPage > 1) {
      state.trackingApiPage = requestedPage - 1
      state.trackingApiHasMore = false
      state.trackingApiState = 'idle'
      state.trackingApiError = null
      renderApp()
      return
    }

    state.trackingApiPackages = remoteData
    state.trackingApiTotalItems = Number.isFinite(totalItems) ? totalItems : remoteData.length
    state.trackingApiHasMore = remoteData.length >= state.trackingApiPageSize
    state.trackingApiSyncedAt = new Date().toISOString()
  } catch (error) {
    state.trackingApiState = 'error'
    state.trackingApiError =
      error instanceof Error ? error.message : 'No se pudo consultar la API de tracking.'
    renderApp()
    return
  }

  state.trackingApiState = 'idle'
  renderApp()
}

const loadTrackingApiCatalogPackages = async () => {
  if (state.trackingApiCatalogState === 'loading') {
    return
  }

  const requestId = trackingApiCatalogLoadRequestId + 1
  trackingApiCatalogLoadRequestId = requestId

  state.trackingApiCatalogState = 'loading'
  state.trackingApiCatalogError = null
  renderApp()

  try {
    const response = await authFetch('/api/tracking/paquetes?all=1&fresh=1')
    const payload = await parseApiPayload(response)
    const payloadAny = payload as any

    if (requestId !== trackingApiCatalogLoadRequestId) {
      return
    }

    if (response.status === 401) {
      clearSession()
      state.loginError = 'Tu sesion expiro. Vuelve a iniciar sesion.'
      state.trackingApiCatalogState = 'idle'
      renderApp()
      return
    }

    if (!response.ok) {
      throw new Error(
        (payloadAny?.error as string) ||
        (payloadAny?.message as string) ||
        'No se pudo cargar el catalogo de estados de tracking.',
      )
    }

    state.trackingApiCatalogPackages = Array.isArray(payloadAny?.data) ? (payloadAny.data as TrackingApiPackage[]) : []
    state.trackingApiCatalogSyncedAt = new Date().toISOString()
    state.trackingApiCatalogState = 'idle'
    renderApp()
  } catch (error) {
    if (requestId !== trackingApiCatalogLoadRequestId) {
      return
    }

    state.trackingApiCatalogState = 'error'
    state.trackingApiCatalogError =
      error instanceof Error ? error.message : 'No se pudo cargar el catalogo de estados de tracking.'
    renderApp()
  }
}

const buildTrackingApiExportQuery = (page: number, perPage: number) => {
  const query = new URLSearchParams({
    page: String(page),
    per_page: String(perPage),
  })

  return query
}

const fetchTrackingApiExportPage = async (page: number, perPage: number) => {
  const query = buildTrackingApiExportQuery(page, perPage)
  const response = await authFetch(`/api/tracking/paquetes?${query.toString()}`)
  const payload = await parseApiPayload(response)

  if (response.status === 401) {
    clearSession()
    state.loginError = 'Tu sesion expiro. Vuelve a iniciar sesion.'
    renderApp()
    return null
  }

  if (!response.ok) {
    throw new Error(
      (payload?.error as string) ||
      (payload?.message as string) ||
      'No se pudo extraer la informacion de tracking.',
    )
  }

  const remoteData = Array.isArray(payload?.data) ? (payload.data as TrackingApiPackage[]) : []
  const totalItems = Number(
    (payload?.paginacion as { total_registros?: number } | undefined)?.total_registros ??
    (payload?.meta as { total?: number } | undefined)?.total ??
    payload?.count ??
    remoteData.length ??
    0,
  )

  return {
    payload,
    remoteData,
    totalItems,
  }
}

const exportTrackingApiToExcel = async () => {
  const exportButton = document.querySelector<HTMLButtonElement>('#export-tracking-api-excel')
  if (exportButton) {
    exportButton.disabled = true
  }

  state.notice = 'Preparando el Excel con todos los paquetes de tracking...'
  renderApp()

  try {
    const pageSize = 40
    const maxPages = 1
    const exportedPackages: TrackingApiPackage[] = []
    let page = 1
    let lastPage = 1
    const seenPageKeys = new Set<string>()

    while (page <= lastPage && page <= maxPages) {
      state.notice = `Extrayendo tracking: página ${page}${lastPage > 1 ? ` de ${lastPage}` : ''}...`
      renderApp()

      const result = await fetchTrackingApiExportPage(page, pageSize)
      if (!result) {
        return
      }

      const currentPageData = result.remoteData
      const firstCode = normalizeText(currentPageData[0]?.codigo_s10 ?? currentPageData[0]?.codigo ?? '')
      const lastCode = normalizeText(
        currentPageData[currentPageData.length - 1]?.codigo_s10 ?? currentPageData[currentPageData.length - 1]?.codigo ?? '',
      )
      const pageKey = `${page}:${currentPageData.length}:${firstCode}:${lastCode}`

      if (seenPageKeys.has(pageKey)) {
        break
      }

      seenPageKeys.add(pageKey)
      exportedPackages.push(...currentPageData)

      const paginationData = (result.payload?.paginacion ?? result.payload?.pagination ?? result.payload?.meta ?? null) as
        | {
          ultima_pagina?: number
          last_page?: number
          total_registros?: number
          total?: number
          por_pagina?: number
          per_page?: number
        }
        | null
      const payloadAny = result.payload as any
      const paginationLastPage = Number(
        paginationData?.ultima_pagina ??
        paginationData?.last_page ??
        payloadAny?.ultima_pagina ??
        payloadAny?.last_page ??
        payloadAny?.pagination?.last_page ??
        payloadAny?.meta?.last_page,
      )
      const paginationTotalItems = Number(
        paginationData?.total_registros ??
        paginationData?.total ??
        payloadAny?.total_registros ??
        payloadAny?.total ??
        payloadAny?.pagination?.total_registros ??
        payloadAny?.pagination?.total ??
        payloadAny?.meta?.total_registros ??
        payloadAny?.meta?.total,
      )
      const paginationPerPage = Number(
        paginationData?.por_pagina ??
        paginationData?.per_page ??
        payloadAny?.por_pagina ??
        payloadAny?.per_page ??
        payloadAny?.pagination?.per_page ??
        payloadAny?.meta?.per_page,
      )

      lastPage =
        Number.isFinite(paginationLastPage) && paginationLastPage > 0
          ? paginationLastPage
          : Number.isFinite(paginationTotalItems) && Number.isFinite(paginationPerPage) && paginationPerPage > 0
            ? Math.max(1, Math.ceil(paginationTotalItems / paginationPerPage))
            : currentPageData.length > 0
              ? page + 1
              : page

      if (Number.isFinite(lastPage)) {
        lastPage = Math.min(Math.max(1, Math.floor(lastPage)), maxPages)
      } else {
        lastPage = maxPages
      }

      if (currentPageData.length < pageSize) {
        break
      }

      page += 1
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
    }

    const packageRows = exportedPackages.map((item) => ({
      Código: item.codigo_s10 || item.codigo || '',
      'Código S10': item.codigo_s10 || '',
      Estado: getTrackingVisibleStateValue(item),
      'Estado postal': getTrackingStatusValue(item),
      Origen: getTrackingLocationName(item.origen),
      Destino: getTrackingLocationName(item.destino),
      'Lugar destino': getTrackingDestinationPlaceValue(item),
      Servicio: item.tipo_servicio || item.clase_correo || '',
      Peso: item.peso ?? '',
      'Teléfono origen': getTrackingOriginPhoneValue(item),
      'Teléfono destino': getTrackingDestinationPhoneValue(item),
      'Fecha registro': item.fecha_registro ?? '',
      'Número despacho': item.numero_despacho ?? '',
      Contenido: item.contenido ?? '',
      ID: item.mailitm_pid ?? '',
    }))

    const eventRows = exportedPackages.flatMap((item) => {
      const packageCode = item.codigo_s10 || item.codigo || 'Sin código'
      const events = Array.isArray(item.eventos) ? item.eventos.filter(Boolean) : []

      if (events.length === 0) {
        return [
          {
            Código: packageCode,
            'Código S10': item.codigo_s10 || '',
            Fecha: '',
            'Código evento': '',
            Evento: getTrackingVisibleStateValue(item),
            'Evento API': '',
            'Movimiento Bolivia': '',
            Oficina: '',
            Detalle: '',
          },
        ]
      }

      return events.map((event) => ({
        Código: packageCode,
        'Código S10': item.codigo_s10 || '',
        Fecha: event.fecha ?? '',
        'Código evento': event.evento_id ?? event.codigo_evento ?? '',
        Evento: getTrackingApiEventStateLabel(event) || getTrackingVisibleStateValue(item),
        'Evento API': event.evento_api ?? '',
        'Movimiento Bolivia': event.movimiento_bolivia ?? '',
        Oficina: event.oficina ?? '',
        Detalle: event.detalle ?? '',
      }))
    })

    const summaryRows = [
      {
        'Total de paquetes': exportedPackages.length,
        'Total de eventos': eventRows.length,
        'Generado en': new Date().toISOString(),
      },
    ]

    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(summaryRows), 'Resumen')
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(packageRows), 'Paquetes')
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(eventRows), 'Eventos')

    const workbookData = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' })
    const downloadUrl = URL.createObjectURL(
      new Blob([workbookData], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    )
    const downloadLink = document.createElement('a')
    downloadLink.href = downloadUrl
    downloadLink.download = `tracking-paquetes-${new Date().toISOString().slice(0, 10)}.xlsx`
    downloadLink.style.display = 'none'
    document.body.appendChild(downloadLink)
    downloadLink.click()
    window.setTimeout(() => {
      downloadLink.remove()
      URL.revokeObjectURL(downloadUrl)
    }, 1500)

    state.notice = `Excel generado correctamente con ${exportedPackages.length} paquetes y ${eventRows.length} eventos.`
  } catch (error) {
    console.error('No se pudo generar el Excel de tracking:', error)
    state.notice = error instanceof Error ? error.message : 'No se pudo exportar la informacion de tracking.'
  } finally {
    if (exportButton) {
      exportButton.disabled = false
    }
    renderApp()
  }
}

const loadContactPackages = async () => {
  state.contactPackagesState = 'loading'
  state.contactPackagesError = null
  renderApp()
  const requestedPage = state.contactPackagesPage

  try {
    const response = await authFetch(
      `/api/internacionales/paquetes-contactos?page=${state.contactPackagesPage}&per_page=${state.contactPackagesPageSize}`,
    )
    const payload = await parseApiPayload(response)

    if (response.status === 401) {
      state.contactPackagesState = 'error'
      state.contactPackagesError =
        (payload?.message as string) ||
        'La API de paquetes de contactos rechazo la consulta. Tu sesion sigue activa.'
      renderApp()
      return
    }

    if (!response.ok) {
      throw new Error(
        (payload?.error as string) ||
        (payload?.message as string) ||
        'No se pudo cargar la informacion de paquetes de contactos.',
      )
    }

    const remoteData = Array.isArray(payload?.data) ? (payload.data as ContactPackagesApiItem[]) : []
    const paginationData = (payload?.paginacion as {
      total_registros?: number
      ultima_pagina?: number
      pagina_actual?: number
      por_pagina?: number
      desde?: number
      hasta?: number
    } | undefined) ?? null
    const totalItems = Number(
      paginationData?.total_registros ??
      (payload?.meta as { total?: number } | undefined)?.total ??
      payload?.count ??
      remoteData.length ??
      0,
    )

    if (remoteData.length === 0 && requestedPage > 1) {
      state.contactPackagesPage = requestedPage - 1
      state.contactPackagesHasMore = false
      state.contactPackagesState = 'idle'
      state.contactPackagesError = null
      renderApp()
      return
    }

    state.contactPackages = remoteData
    state.contactPackagesTotalItems = Number.isFinite(totalItems) ? totalItems : remoteData.length
    state.contactPackagesHasMore =
      typeof paginationData?.ultima_pagina === 'number'
        ? state.contactPackagesPage < paginationData.ultima_pagina
        : remoteData.length >= state.contactPackagesPageSize
    state.contactPackagesSyncedAt = new Date().toISOString()
  } catch (error) {
    state.contactPackagesState = 'error'
    state.contactPackagesError =
      error instanceof Error ? error.message : 'No se pudo consultar la API de paquetes de contactos.'
    renderApp()
    return
  }

  state.contactPackagesState = 'idle'
  renderApp()
}

const refreshEmsPipelineFromApis = async () => {
  if (state.emsPipelineSyncState === 'loading') {
    return
  }

  state.emsPipelineSyncState = 'loading'
  state.emsPipelineSyncError = null
  state.emsPipelineSyncSummary = null
  renderApp()

  try {
    await Promise.all([
      loadTrackingApiPackages(),
      loadContactPackages(),
      loadTrackingApiCatalogPackages(),
      ensureAllContactPackagesForFilters(),
    ])
    const syncResponse = await authFetch('/api/pipeline/sync-packages', {
      method: 'POST',
      timeoutMs: 120000,
    })
    const syncPayload = await parseApiPayload(syncResponse)

    if (syncResponse.status === 401) {
      clearSession()
      state.loginError = 'Tu sesion expiro. Vuelve a iniciar sesion.'
      state.emsPipelineSyncState = 'idle'
      renderApp()
      return
    }

    if (!syncResponse.ok) {
      throw new Error(
        (syncPayload?.message as string) ||
        (syncPayload?.error as string) ||
        'No se pudo sincronizar el pipeline EMS.',
      )
    }

    await loadEmsMonthOptions()
    const scopeKeys = [
      'received',
      'transit',
      'regional',
      'courier',
      'delivered',
      'cancelled',
      ...state.pipelineConfig.customColumns.map((column) => column.id),
    ]

    await Promise.all(
      scopeKeys.map((scope) => loadEmsPipelineScopePage(scope, 1, { silent: true, timeoutMs: 60000 })),
    )

    state.emsPipelineSyncSummary = {
      total: Number(syncPayload?.total ?? 0),
      createdCount: Number(syncPayload?.createdCount ?? 0),
      updatedCount: Number(syncPayload?.updatedCount ?? 0),
      syncedAt: String(syncPayload?.syncedAt ?? new Date().toISOString()),
    }
  } catch (error) {
    state.emsPipelineSyncState = 'error'
    state.emsPipelineSyncError =
      error instanceof Error ? error.message : 'No se pudo sincronizar el pipeline EMS.'
    await ensureApiPipelineStateSourcesLoaded()
    await loadEmsMonthOptions()
    await reloadEmsPipelinePages()
    state.emsPipelineSyncSummary = null
    state.emsPipelineSyncState = 'idle'
    state.notice = 'La sincronizacion remota fallo, pero se cargo el tablero con los datos locales disponibles.'
    renderApp()
    return
  }

  state.emsPipelineSyncState = 'idle'
  renderApp()
}

const reloadEmsPipelinePages = async () => {
  const scopeKeys = [
    'received',
    'transit',
    'regional',
    'courier',
    'delivered',
    'cancelled',
    ...state.pipelineConfig.customColumns.map((column) => column.id),
  ]

  await Promise.all(
    scopeKeys.map((scope) => loadEmsPipelineScopePage(scope, 1, { silent: true, timeoutMs: 60000 })),
  )
}

const bootstrapEmsPipelineView = () => {
  void loadEmsMonthOptions()
  void ensureApiPipelineStateSourcesLoaded()
  void reloadEmsPipelinePages()
}

const lookupPackageCode = async () => {
  const query = state.packageCodeLookupQuery.trim()
  if (!query) {
    state.packageCodeLookupState = 'error'
    state.packageCodeLookupError = 'Escribe un codigo para consultar.'
    state.packageCodeLookupResult = null
    renderApp()
    return
  }

  state.packageCodeLookupState = 'loading'
  state.packageCodeLookupError = null
  renderApp()

  try {
    const response = await authFetch(`/api/package-code-lookup?code=${encodeURIComponent(query)}`)
    const payload = await parseApiPayload(response)

    if (response.status === 401) {
      clearSession()
      state.loginError = 'Tu sesion expiro. Vuelve a iniciar sesion.'
      state.packageCodeLookupState = 'idle'
      renderApp()
      return
    }

    if (!response.ok) {
      throw new Error(
        (payload?.error as string) ||
        (payload?.message as string) ||
        'No se pudo consultar el codigo en las APIs.',
      )
    }

    state.packageCodeLookupResult = payload
    state.packageCodeLookupState = 'idle'
  } catch (error) {
    state.packageCodeLookupState = 'error'
    state.packageCodeLookupError =
      error instanceof Error ? error.message : 'No se pudo consultar el codigo en las APIs.'
  }

  renderApp()
}

const openPackageCodeLookupModal = () => {
  state.isPackageCodeLookupModalOpen = true
  state.packageCodeLookupError = null
  renderApp()
}

const closePackageCodeLookupModal = () => {
  state.isPackageCodeLookupModalOpen = false
  renderApp()
}

const openEmsPackageDetailModal = (packageId: string) => {
  state.selectedEmsPackageDetailId = packageId
  state.isEmsPackageDetailModalOpen = true
  renderApp()
}

const closeEmsPackageDetailModal = () => {
  state.selectedEmsPackageDetailId = null
  state.isEmsPackageDetailModalOpen = false
  renderApp()
}

const openEmsStatePackagesModal = (scope: EmsColumnKey | null = null) => {
  state.isEmsStatePackagesModalOpen = true
  state.emsStatePackagesModalScope = scope
  state.emsStatePackagesModalPage = 1
  if (scope) {
    void loadEmsPipelineScopePage(scope, 1, { silent: true })
  }
  renderApp()
}

const closeEmsStatePackagesModal = () => {
  state.isEmsStatePackagesModalOpen = false
  state.emsStatePackagesModalScope = null
  state.emsStatePackagesModalPage = 1
  renderApp()
}

const goToPrevEmsStatePackagesPage = () => {
  state.emsStatePackagesModalPage = Math.max(1, state.emsStatePackagesModalPage - 1)
  renderApp()
  const scope = state.emsStatePackagesModalScope
  if (!scope) return
  const currentPage = getEmsPipelineScopePageState(scope).currentPage
  state.emsStatePackagesModalPage = Math.max(1, currentPage - 1)
  void loadEmsPipelineScopePage(scope, state.emsStatePackagesModalPage, { silent: true })
}

const goToNextEmsStatePackagesPage = () => {
  const pagination = getEmsStatePackagesModalPagination()
  state.emsStatePackagesModalPage = Math.min(pagination.totalPages, state.emsStatePackagesModalPage + 1)
  renderApp()
  const scope = state.emsStatePackagesModalScope
  if (!scope) return
  const pageState = getEmsPipelineScopePageState(scope)
  state.emsStatePackagesModalPage = Math.min(pageState.totalPages, pageState.currentPage + 1)
  void loadEmsPipelineScopePage(scope, state.emsStatePackagesModalPage, { silent: true })
}

const clearPackageCodeLookupFilter = () => {
  state.packageCodeLookupQuery = ''
  state.packageCodeLookupError = null
  state.packageCodeLookupResult = null
  renderApp()
}

const getTrackingApiPagination = () => {
  const lookupPackage = getTrackingApiLookupPackage()

  if (lookupPackage) {
    return {
      totalItems: 1,
      currentPage: 1,
      pageSize: 1,
      totalPages: 1,
      items: [lookupPackage],
      lookupPackage,
      hasMorePages: false,
      mode: 'lookup' as const,
    }
  }

  const filteredPackages = getFilteredTrackingApiPackages()
  const isListFiltered =
    state.trackingApiStateFilter !== 'all' ||
    state.trackingApiServiceFilter !== 'all' ||
    state.trackingApiOriginFilter !== 'all' ||
    state.trackingApiDestinationFilter !== 'all'

  if (!isListFiltered) {
    const totalItems = state.trackingApiTotalItems || state.trackingApiPackages.length
    const totalPages = Math.max(1, Math.ceil(totalItems / state.trackingApiPageSize))
    const currentPage = Math.min(Math.max(state.trackingApiPage, 1), totalPages)

    return {
      totalItems,
      currentPage,
      pageSize: state.trackingApiPageSize,
      totalPages,
      items: state.trackingApiPackages,
      lookupPackage,
      hasMorePages: state.trackingApiHasMore && state.trackingApiState !== 'loading',
      mode: 'remote' as const,
    }
  }

  const totalItems = filteredPackages.length
  const pageSize = state.trackingApiPageSize
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))
  const currentPage = Math.min(Math.max(state.trackingApiPage, 1), totalPages)
  const startIndex = (currentPage - 1) * pageSize

  return {
    totalItems,
    currentPage,
    pageSize,
    totalPages,
    items: filteredPackages.slice(startIndex, startIndex + pageSize),
    lookupPackage,
    hasMorePages: currentPage < totalPages,
    mode: 'filtered' as const,
  }
}

const getTrackingApiTableHead = () => {
  return `
    <thead>
      <tr>
        <th>Código</th>
        <th>Origen</th>
        <th>Destino</th>
        <th>Estado</th>
        <th>Lugar destino</th>
        <th>Servicio</th>
        <th>Peso</th>
        <th>Teléfono origen</th>
        <th>Teléfono destino</th>
        <th>Acciones</th>
      </tr>
    </thead>
  `
}

const getContactPackagesPagination = () => {
  const filteredItems = getFilteredContactPackages()
  const hasActiveFilters =
    state.contactPackagesTypeFilter !== 'all' || state.contactPackagesStatusFilter !== 'all'
  const lookupResult = state.packageCodeLookupResult as Record<string, any> | null
  const isLookupContactResult = Boolean(lookupResult?.found && lookupResult?.contact?.record)

  return {
    totalItems:
      isLookupContactResult || hasActiveFilters
        ? filteredItems.length
        : state.contactPackagesTotalItems || state.contactPackages.length,
    currentPage: hasActiveFilters ? 1 : Math.max(state.contactPackagesPage, 1),
    pageSize: state.contactPackagesPageSize,
    items: hasActiveFilters ? filteredItems : state.contactPackages,
  }
}

const getContactPackageTypeOptions = () =>
  [...new Set(getEffectiveContactPackages().map((item) => String(item.tipo ?? '').trim()).filter(Boolean))].sort((first, second) =>
    first.localeCompare(second, 'es'),
  )

const getContactPackageStatusOptions = () =>
  [...new Set(getEffectiveContactPackages().map((item) => getContactPackageEstado(item)).filter(Boolean))].sort((first, second) =>
    first.localeCompare(second, 'es'),
  )

const getFilteredContactPackages = () => {
  const sourceItems =
    state.contactPackagesCatalogLoaded && (state.contactPackagesTypeFilter !== 'all' || state.contactPackagesStatusFilter !== 'all')
      ? state.contactPackagesCatalog
      : state.contactPackages

  return sourceItems.filter((item) => {
    const matchesType =
      state.contactPackagesTypeFilter === 'all' || String(item.tipo ?? '').trim() === state.contactPackagesTypeFilter
    const matchesStatus =
      state.contactPackagesStatusFilter === 'all' || getContactPackageEstado(item) === state.contactPackagesStatusFilter

    return matchesType && matchesStatus
  })
}

const loadAllContactPackages = async () => {
  if (state.contactPackagesCatalogLoaded) {
    return
  }

  if (contactPackagesCatalogLoadPromise) {
    return contactPackagesCatalogLoadPromise
  }

  contactPackagesCatalogLoadPromise = (async () => {
    const response = await authFetch('/api/internacionales/paquetes-contactos/catalog')
    const payload = await parseApiPayload(response)
    const payloadAny = payload as any

    if (response.status === 401) {
      clearSession()
      throw new Error('Tu sesion expiro. Vuelve a iniciar sesion.')
    }

    if (!response.ok) {
      throw new Error(
        (payloadAny?.message as string) ||
        (payloadAny?.error as string) ||
        'No se pudo cargar todos los paquetes para aplicar el filtro.',
      )
    }

    state.contactPackagesCatalog = Array.isArray(payloadAny?.data) ? (payloadAny.data as ContactPackagesApiItem[]) : []
    state.contactPackagesCatalogLoaded = true
  })().finally(() => {
    contactPackagesCatalogLoadPromise = null
  })

  return contactPackagesCatalogLoadPromise
}

const ensureAllContactPackagesForFilters = async () => {
  if (state.contactPackagesCatalogLoaded) {
    return
  }

  state.contactPackagesState = 'loading'
  state.contactPackagesError = null
  renderApp()

  try {
    await loadAllContactPackages()
  } catch (error) {
    state.contactPackagesState = 'error'
    state.contactPackagesError =
      error instanceof Error ? error.message : 'No se pudo cargar todos los paquetes para aplicar el filtro.'
    renderApp()
    return
  }

  state.contactPackagesState = 'idle'
  renderApp()
}

const exportContactPackagesToExcel = async () => {
  const apiPageSize = 200
  const exportButton = document.querySelector<HTMLButtonElement>('#export-contact-packages')
  if (exportButton) exportButton.disabled = true
  state.notice = 'Preparando el archivo Excel con todos los paquetes...'
  renderApp()

  try {
    const exportedItems: ContactPackagesApiItem[] = []
    let page = 1
    let lastPage = 1

    do {
      const response = await authFetch(`/api/internacionales/paquetes-contactos?page=${page}&per_page=${apiPageSize}`)
      const payload = await parseApiPayload(response)
      if (!response.ok) {
        const payloadAny = payload as any
        throw new Error((payloadAny?.message as string) || (payloadAny?.error as string) || 'No se pudo exportar la información.')
      }

      const payloadAny = payload as any
      const pageItems = Array.isArray(payloadAny?.data) ? (payloadAny.data as ContactPackagesApiItem[]) : []
      exportedItems.push(...pageItems)
      const paginationData = (payloadAny?.paginacion ?? payloadAny?.pagination ?? payloadAny?.meta ?? null) as
        | {
          ultima_pagina?: number
          last_page?: number
          total_registros?: number
          total?: number
          por_pagina?: number
          per_page?: number
        }
        | null
      const paginationLastPage = Number(
        paginationData?.ultima_pagina ??
        paginationData?.last_page ??
        payloadAny?.ultima_pagina ??
        payloadAny?.last_page ??
        payloadAny?.pagination?.last_page ??
        payloadAny?.meta?.last_page,
      )
      const paginationTotalItems = Number(
        paginationData?.total_registros ??
        paginationData?.total ??
        payloadAny?.total_registros ??
        payloadAny?.total ??
        payloadAny?.pagination?.total_registros ??
        payloadAny?.pagination?.total ??
        payloadAny?.meta?.total_registros ??
        payloadAny?.meta?.total,
      )
      const paginationPerPage = Number(
        paginationData?.por_pagina ??
        paginationData?.per_page ??
        payloadAny?.por_pagina ??
        payloadAny?.per_page ??
        payloadAny?.pagination?.per_page ??
        payloadAny?.meta?.per_page,
      )

      lastPage =
        Number.isFinite(paginationLastPage) && paginationLastPage > 0
          ? paginationLastPage
          : Number.isFinite(paginationTotalItems) && Number.isFinite(paginationPerPage) && paginationPerPage > 0
            ? Math.max(1, Math.ceil(paginationTotalItems / paginationPerPage))
            : pageItems.length > 0
              ? page + 1
              : page
      page += 1
      if (pageItems.length === 0) break
    } while (page <= lastPage)

    const rows = exportedItems.map((item) => ({
      Código: item.codigo ?? '',
      Tipo: 'SIOP',
      Remitente: getContactPackageRemitenteName(item),
      'Teléfono remitente': getContactPackageRemitentePhone(item),
      Destinatario: getContactPackageDestinatarioName(item),
      'Teléfono destinatario': getContactPackageDestinatarioPhone(item),
      'Lugar destino': getContactPackageDestinationPlace(item),
      'Fecha registro': item.fecha_registro ?? '',
      ID: item.id ?? '',
    }))
    const worksheet = XLSX.utils.json_to_sheet(rows)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Paquetes')
    const workbookData = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' })
    const downloadUrl = URL.createObjectURL(
      new Blob([workbookData], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    )
    const downloadLink = document.createElement('a')
    downloadLink.href = downloadUrl
    downloadLink.download = `paquetes-contactos-${new Date().toISOString().slice(0, 10)}.xlsx`
    document.body.appendChild(downloadLink)
    downloadLink.click()
    downloadLink.remove()
    URL.revokeObjectURL(downloadUrl)
    state.notice = `Excel generado correctamente con ${exportedItems.length} paquetes.`
  } catch (error) {
    console.error('No se pudo generar el Excel de paquetes:', error)
    state.notice = error instanceof Error ? error.message : 'No se pudo exportar la información.'
  } finally {
    renderApp()
  }
}

const renderTrackingApiRows = () => {
  const pagination = getTrackingApiPagination()
  const items = pagination.items
  const isLoadingTrackingStates =
    state.trackingApiCatalogState === 'loading' &&
    state.trackingApiCatalogPackages.length === 0 &&
    state.trackingApiPackages.length === 0

  if (items.length === 0) {
    return `
      <tr>
        <td class="international-empty" colspan="9">
          ${state.trackingApiState === 'loading' || isLoadingTrackingStates
        ? 'Cargando paquetes desde la API de tracking...'
        : state.packageCodeLookupQuery.trim()
          ? `No se encontraron paquetes para el codigo ${normalizeText(state.packageCodeLookupQuery)}.`
          : state.trackingApiStateFilter === 'all'
            ? 'Aún no se cargaron paquetes desde la API.'
            : 'No hay paquetes para ese estado.'
      }
        </td>
      </tr>
    `
  }

  return items
    .map(
      (item) => `
        <tr>
          <td><strong>${escapeHtml(item.codigo_s10 || item.codigo || 'Sin código')}</strong></td>
          <td>${escapeHtml(getTrackingLocationName(item.origen))}</td>
          <td>${escapeHtml(getTrackingLocationName(item.destino))}</td>
          <td>${escapeHtml(getTrackingVisibleStateValue(item))}</td>
          <td>${escapeHtml(getTrackingDestinationPlaceValue(item))}</td>
          <td>${escapeHtml(item.tipo_servicio || item.clase_correo || 'Sin servicio')}</td>
          <td>${escapeHtml(item.peso == null ? '—' : `${item.peso} Kg`)}</td>
          <td>${escapeHtml(getTrackingOriginPhoneValue(item))}</td>
          <td>${escapeHtml(getTrackingDestinationPhoneValue(item))}</td>
          <td class="international-row-actions">
            <button class="table-action-btn" data-tracking-info="${item.mailitm_pid}" type="button">Información</button>
          </td>
        </tr>
      `,
    )
    .join('')
}

const renderContactPackagesRows = () => {
  const lookupResult = state.packageCodeLookupResult as Record<string, any> | null
  const contactLookupRecord =
    lookupResult?.found && lookupResult?.contact?.record ? [lookupResult.contact.record] : null
  const items = contactLookupRecord ?? getFilteredContactPackages()

  if (items.length === 0) {
    return `
      <tr>
        <td class="international-empty" colspan="10">
          ${state.contactPackagesState === 'loading'
        ? 'Cargando paquetes de contactos desde la API...'
        : 'Aún no se cargaron paquetes de contactos desde la API.'
      }
        </td>
      </tr>
    `
  }

  return items
    .map(
      (item) => `
        <tr>
          <td><strong>${escapeHtml(item.codigo || 'Sin código')}</strong></td>
          <td>
            <div class="international-country-copy">
              <span class="international-country-name">${escapeHtml(getContactPackageRemitenteName(item))}</span>
              <span class="international-country-code">${escapeHtml(getContactPackageRemitentePhone(item))}</span>
            </div>
          </td>
          <td>
            <div class="international-country-copy">
              <span class="international-country-name">${escapeHtml(getContactPackageDestinatarioName(item))}</span>
              <span class="international-country-code">${escapeHtml(getContactPackageDestinatarioPhone(item))}</span>
            </div>
          </td>
          <td>${escapeHtml(getContactPackageDestinationPlace(item))}</td>
          <td>${escapeHtml('SIOP')}</td>
          <td>${escapeHtml(item.fecha_registro ? formatConversationTimestamp(item.fecha_registro) : '—')}</td>
          <td>${escapeHtml(getContactPackageRemitentePhone(item))}</td>
          <td>${escapeHtml(getContactPackageDestinatarioPhone(item))}</td>
          <td class="international-row-actions">
            <button class="table-action-btn" data-contact-package-info="${item.id ?? item.codigo ?? ''}" type="button">Información</button>
          </td>
        </tr>
      `,
    )
    .join('')
}

const renderTrackingApiPagination = () => {
  const pagination = getTrackingApiPagination()
  void renderTrackingApiRows()
  const hasMorePages = pagination.hasMorePages ?? (pagination.currentPage * pagination.pageSize < pagination.totalItems)
  const isLookupTrackingResult = Boolean(pagination.lookupPackage)
  const hasSelectedState = state.trackingApiStateFilter !== 'all'
  const selectedStateOption = getTrackingApiSelectedStateOption()
  const rangeStart = pagination.totalItems === 0 ? 0 : (pagination.currentPage - 1) * pagination.pageSize + 1
  const rangeEnd = Math.min(pagination.currentPage * pagination.pageSize, pagination.totalItems)

  return `
    <div class="international-pagination">
      <div class="international-pagination-info">
        <span>${isLookupTrackingResult
      ? 'Mostrando 1 resultado encontrado por el buscador'
      : pagination.totalItems > 0
        ? hasSelectedState
          ? `Mostrando ${rangeStart}-${rangeEnd} de ${pagination.totalItems} registros con estado ${selectedStateOption?.label ?? state.trackingApiStateFilter}`
          : `Mostrando ${rangeStart}-${rangeEnd} de ${pagination.totalItems} registros`
        : hasSelectedState
          ? 'Sin registros para mostrar con ese estado'
          : state.packageCodeLookupQuery.trim()
            ? `No se encontraron paquetes para el codigo ${normalizeText(state.packageCodeLookupQuery)}.`
            : 'Sin registros para mostrar'
    }</span>
        <strong>${isLookupTrackingResult
      ? 'Resultado filtrado por código'
      : hasSelectedState
        ? `Página ${pagination.currentPage} de ${pagination.totalPages}${hasMorePages ? ' · más resultados' : ''}`
        : `Página ${state.trackingApiPage}${hasMorePages ? ' · más resultados' : ''}`
    }</strong>
      </div>
      <div class="international-pagination-actions">
        <button
          class="secondary-btn pagination-btn"
          type="button"
          id="tracking-page-prev"
          ${isLookupTrackingResult || state.trackingApiPage <= 1 || state.trackingApiState === 'loading' ? 'disabled' : ''}
        >
          Anterior
        </button>
        <button
          class="secondary-btn pagination-btn"
          type="button"
          id="tracking-page-next"
          ${isLookupTrackingResult || !hasMorePages || state.trackingApiState === 'loading' ? 'disabled' : ''}
        >
          Siguiente
        </button>
      </div>
    </div>
  `
}

const renderContactPackagesPagination = () => {
  const lookupResult = state.packageCodeLookupResult as Record<string, any> | null
  const pagination = getContactPackagesPagination()
  void renderContactPackagesRows()
  const hasMorePages = state.contactPackagesHasMore && state.contactPackagesState !== 'loading'
  const isLookupContactResult = Boolean(lookupResult?.found && lookupResult?.contact?.record)
  const hasActiveFilters =
    state.contactPackagesTypeFilter !== 'all' || state.contactPackagesStatusFilter !== 'all'

  return `
    <div class="international-pagination">
      <div class="international-pagination-info">
        <span>${isLookupContactResult
      ? 'Mostrando 1 resultado encontrado por el buscador'
      : hasActiveFilters
        ? `Mostrando ${pagination.totalItems} resultado${pagination.totalItems === 1 ? '' : 's'} filtrado${pagination.totalItems === 1 ? '' : 's'}`
        : pagination.totalItems > 0
          ? `Mostrando ${pagination.totalItems} registros en esta página`
          : 'Sin registros para mostrar'
    }</span>
        <strong>${isLookupContactResult
      ? 'Resultado filtrado por código'
      : hasActiveFilters
        ? 'Filtro aplicado sobre todos los paquetes'
        : `Página ${pagination.currentPage}${hasMorePages ? '  · más resultados' : ''}`
    }</strong>
      </div>
      <div class="international-pagination-actions">
        <button
          class="secondary-btn pagination-btn"
          type="button"
          id="contact-packages-page-prev"
          ${isLookupContactResult || hasActiveFilters || pagination.currentPage <= 1 || state.contactPackagesState === 'loading' ? 'disabled' : ''}
        >
          Anterior
        </button>
        <button
          class="secondary-btn pagination-btn"
          type="button"
          id="contact-packages-page-next"
          ${isLookupContactResult || hasActiveFilters || !hasMorePages ? 'disabled' : ''}
        >
          Siguiente
        </button>
      </div>
    </div>
  `
}

const addInternationalPackage = () => {
  state.internationalPackages = [
    ...state.internationalPackages,
    {
      id: Date.now(),
      origin: '',
      code: '',
      name: '',
      phone: '',
      address: '',
    },
  ]
  saveInternationalPackages()
  renderApp()
}

const updateInternationalPackage = (
  id: number,
  field: Exclude<keyof InternationalPackage, 'id'>,
  value: string,
) => {
  state.internationalPackages = state.internationalPackages.map((item) =>
    item.id === id ? { ...item, [field]: value } : item,
  )
  saveInternationalPackages()
}

const removeInternationalPackage = (id: number) => {
  state.internationalPackages = state.internationalPackages.filter((item) => item.id !== id)
  saveInternationalPackages()
  renderApp()
}

const importInternationalPackages = async (file: File) => {
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' })
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]]
  if (!firstSheet) throw new Error('El archivo no contiene hojas de cÃ¡lculo.')

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, { defval: '' })
  const imported = rows.map((row, index) => ({
    id: Date.now() + index,
    origin: getImportedValue(row, ['origen', 'procedencia', 'pais', 'paisorigen']),
    code: getImportedValue(row, ['codigo', 'tracking', 'guia', 'codigopaquete']),
    name: getImportedValue(row, ['nombre', 'destinatario', 'cliente']),
    phone: getImportedValue(row, ['telefono', 'celular', 'movil', 'numerotelefono']),
    address: getImportedValue(row, ['direccion', 'domicilio', 'direcciondestino']),
  }))

  state.internationalPackages = [...state.internationalPackages, ...imported]
  saveInternationalPackages()
  state.notice = `${imported.length} registro${imported.length === 1 ? '' : 's'} importado${imported.length === 1 ? '' : 's'} correctamente.`
  renderApp()
}

const truncateText = (value: string, maxLength: number) => {
  const normalized = value.trim().replace(/\s+/g, ' ')
  if (normalized.length <= maxLength) {
    return normalized
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 8)).trimEnd()}........`
}

const getPhoneCountryLabel = (country: (typeof phoneCountryOptions)[number]) =>
  `${country.iso2} - ${country.name} (+${country.dialCode})`

const normalizeText = (value: string | null | undefined) => String(value ?? '').trim()

const normalizeReference = (value: unknown) =>
  String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')

let contactPackagesCatalogLoadPromise: Promise<void> | null = null

const getFlagIconClass = (iso2: string) => `fi fi-${iso2.toLowerCase()}`

const normalizeCountryKey = (value: string | null | undefined) =>
  normalizeText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()

const countryFlagMap: Record<string, string> = {
  bolivia: 'bo',
  'bolivia (plurinational state of)': 'bo',
  'bolivia, plurinational state of': 'bo',
  argentina: 'ar',
  austria: 'at',
  belarus: 'by',
  belgium: 'be',
  belgica: 'be',
  brazil: 'br',
  brasil: 'br',
  canada: 'ca',
  china: 'cn',
  chad: 'td',
  chile: 'cl',
  colombia: 'co',
  'costa rica': 'cr',
  denmark: 'dk',
  ecuador: 'ec',
  egypt: 'eg',
  'el salvador': 'sv',
  finland: 'fi',
  france: 'fr',
  germany: 'de',
  greece: 'gr',
  grecia: 'gr',
  guatemala: 'gt',
  hungary: 'hu',
  india: 'in',
  ireland: 'ie',
  italy: 'it',
  italia: 'it',
  japan: 'jp',
  mauritius: 'mu',
  netherlands: 'nl',
  'netherlands (the)': 'nl',
  holanda: 'nl',
  nicaragua: 'ni',
  norway: 'no',
  noruega: 'no',
  panama: 'pa',
  paraguay: 'py',
  peru: 'pe',
  poland: 'pl',
  portugal: 'pt',
  romania: 'ro',
  russia: 'ru',
  rusia: 'ru',
  spain: 'es',
  espana: 'es',
  'espaÃ±a': 'es',
  sweden: 'se',
  suecia: 'se',
  switzerland: 'ch',
  thailand: 'th',
  ukraine: 'ua',
  'united kingdom': 'gb',
  'united states of america': 'us',
  'united states of america (the)': 'us',
  eeuu: 'us',
  usa: 'us',
  uruguay: 'uy',
  venezuela: 've',
  'south africa': 'za',
}

const getCountryIso2FromLabel = (value: string | null | undefined) =>
  countryFlagMap[normalizeCountryKey(value)] ?? null

const getCountryLabel = (value: string | null | undefined) => normalizeText(value) || 'Sin país'

const getCountryIso2 = (value: string | null | undefined) => {
  const label = getCountryLabel(value)
  return getCountryIso2FromLabel(value) ?? (/^[a-z]{2}$/i.test(label) ? label.toLowerCase() : null)
}

const renderCountryWithFlag = (value: string | null | undefined, code?: string | null) => {
  const label = getCountryLabel(value)
  const iso2 = getCountryIso2(value) ?? getCountryIso2(code)
  const countryCode = normalizeText(code)

  return `
    <span class="international-country-cell" title="${escapeHtml([label, countryCode ? `(${countryCode})` : ''].filter(Boolean).join(' '))}">
      ${iso2
      ? `<span class="international-country-flag fi ${getFlagIconClass(iso2)}" aria-hidden="true"></span>`
      : ''
    }
      <span class="international-country-copy">
        <span class="international-country-name">${escapeHtml(label)}</span>
        ${countryCode ? `<span class="international-country-code">${escapeHtml(countryCode)}</span>` : ''}
      </span>
    </span>
  `
}

const getTrackingLocationName = (
  value:
    | string
    | {
      codigo?: string | null
      nombre?: string | null
    }
    | null
    | undefined,
) => {
  if (typeof value === 'string') {
    return normalizeText(value) || 'Sin dato'
  }

  return normalizeText(value?.nombre) || normalizeText(value?.codigo) || 'Sin dato'
}

const getTrackingStatusValue = (item: TrackingApiPackage) =>
  normalizeText(item.estado?.nombre) || normalizeText(item.estado_postal) || 'Sin estado'

const getTrackingVisibleStateValue = (item: TrackingApiPackage) => {
  const latestEvent = getTrackingLatestEvent(item)

  return (
    normalizeText(latestEvent?.nombre ?? null) ||
    normalizeText(latestEvent?.evento_api) ||
    normalizeText(latestEvent?.evento_original) ||
    normalizeText(latestEvent?.movimiento_bolivia) ||
    normalizeText(latestEvent?.detalle) ||
    getTrackingStatusValue(item)
  )
}

const getTrackingDestinationPlaceValue = (item: TrackingApiPackage) =>
  normalizeText(item.destinatario?.direccion) || getTrackingLocationName(item.destino)

const getTrackingOriginPhoneValue = (item: TrackingApiPackage) =>
  normalizeText(item.telefonos?.remitente ?? null) ||
  normalizeText(item.remitente?.telefono ?? null) ||
  (typeof item.origen === 'string' ? '' : normalizeText(item.origen?.telefono ?? null)) ||
  '—'

const getTrackingDestinationPhoneValue = (item: TrackingApiPackage) =>
  normalizeText(item.telefonos?.destinatario ?? null) ||
  normalizeText(item.destinatario?.telefono ?? null) ||
  (typeof item.destino === 'string' ? '' : normalizeText(item.destino?.telefono ?? null)) ||
  '—'

const getTrackingLatestEvent = (item: TrackingApiPackage) => {
  const events = Array.isArray(item.eventos) ? item.eventos.filter(Boolean) : []
  return events[0] ?? null
}

const getPackageEventStage = (event?: TrackingApiEvent | null): EmsColumnKey | null => {
  if (!event) return null

  const eventId = Number(event.evento_id ?? event.codigo_evento)
  if ([318, 295, 2239, 2240, 240, 2241, 297, 2242].includes(eventId)) return 'received'
  if ([168, 296].includes(eventId)) return 'transit'
  if ([310, 312, 183, 4410, 2103, 4405, 4404, 3345, 4400].includes(eventId)) return 'regional'
  if ([4409, 315].includes(eventId)) return 'courier'
  if (eventId === 316) return 'delivered'
  if (eventId === 4402) return 'cancelled'

  const eventText = normalizeCountryKey(
    [event.nombre, event.evento_api, event.evento_original, event.movimiento_bolivia, event.detalle]
      .filter(Boolean)
      .join(' '),
  )

  if (eventText.includes('cancel') || eventText.includes('anul') || eventText.includes('rechaz')) return 'cancelled'
  if (eventText.includes('devuelto')) return 'cancelled'
  if (eventText.includes('entreg')) return 'delivered'
  if (eventText.includes('cartero') || eventText.includes('reparto')) return 'courier'
  if (
    eventText.includes('regional') ||
    eventText.includes('destino') ||
    eventText.includes('listo para entregar') ||
    eventText.includes('oficina de entrega')
  ) {
    return 'regional'
  }
  if (eventText.includes('saca interna') || eventText.includes('salida') || eventText.includes('transito')) return 'transit'
  if (eventText.includes('recibido') || eventText.includes('origen') || eventText.includes('admis')) return 'received'

  return null
}

const getPackageStageFromEvents = (item: { eventos?: TrackingApiPackage['eventos'] | null }) => {
  const events = Array.isArray(item.eventos) ? item.eventos.filter(Boolean) : []
  return getPackageEventStage(events[0])
}

const getTrackingApiLookupPackage = () => {
  const lookupResult = state.packageCodeLookupResult as Record<string, any> | null
  return lookupResult?.found && lookupResult?.tracking?.record ? (lookupResult.tracking.record as TrackingApiPackage) : null
}

const getTrackingApiSourcePackages = () =>
  state.trackingApiCatalogPackages.length > 0 ? state.trackingApiCatalogPackages : state.trackingApiPackages

const getTrackingApiServiceValue = (item: TrackingApiPackage) =>
  normalizeText(item.tipo_servicio ?? null) || normalizeText(item.clase_correo ?? null) || 'Sin servicio'

const getTrackingApiCountryValue = (
  value:
    | string
    | {
      codigo?: string | null
      nombre?: string | null
    }
    | null
    | undefined,
) => normalizeText(getTrackingLocationName(value)) || 'Sin dato'

const getTrackingApiEventStateLabel = (event?: TrackingApiEvent | null) =>
  normalizeText(event?.nombre ?? null) ||
  normalizeText(event?.evento_api ?? null) ||
  normalizeText(event?.evento_original ?? null) ||
  normalizeText(event?.movimiento_bolivia ?? null) ||
  normalizeText(event?.detalle ?? null) ||
  'Sin evento'

const getTrackingApiPackageStateLabels = (item: TrackingApiPackage) => {
  const events = Array.isArray(item.eventos) ? item.eventos.filter(Boolean) : []
  const eventLabels = events.map((event) => getTrackingApiEventStateLabel(event)).filter(Boolean)
  const fallbackLabels = eventLabels.length > 0 ? eventLabels : [getTrackingApiStateLabel(item)]
  return [...new Set(fallbackLabels.map((label) => normalizeText(label)).filter(Boolean))]
}

const getPackageApiStateLabels = (item: { eventos?: TrackingApiPackage['eventos']; estado?: { nombre?: string | null } | null }) => {
  const events = Array.isArray(item.eventos) ? item.eventos.filter(Boolean) : []
  const eventLabels = events.map((event) => getTrackingApiEventStateLabel(event)).filter(Boolean)
  const fallbackLabels = eventLabels.length > 0 ? eventLabels : [normalizeText(item.estado?.nombre ?? null)]
  return [...new Set(fallbackLabels.map((label) => normalizeText(label)).filter(Boolean))]
}

const getTrackingApiAvailableStates = (): TrackingApiStateOption[] => {
  const sourcePackages = getTrackingApiSourcePackages()
  const stateMap = new Map<
    string,
    {
      value: string
      label: string
      count: number
      sampleCode: string
    }
  >()

  sourcePackages.forEach((item) => {
    const labels = getTrackingApiPackageStateLabels(item)

    labels.forEach((label) => {
      const normalizedLabel = normalizeText(label)
      if (!normalizedLabel || normalizedLabel.toLowerCase() === 'sin estado') {
        return
      }

      const value = normalizedLabel
      const existing = stateMap.get(value)
      if (existing) {
        existing.count += 1
        return
      }

      stateMap.set(value, {
        value,
        label: normalizedLabel,
        count: 1,
        sampleCode: normalizeText(item.codigo_s10 || item.codigo || 'Sin código'),
      })
    })
  })

  return [...stateMap.values()].sort((first, second) => {
    if (first.count !== second.count) {
      return second.count - first.count
    }

    return first.label.localeCompare(second.label, 'es')
  })
}

const getTrackingApiAvailableServices = () => {
  const serviceMap = new Map<string, { value: string; label: string; count: number }>()

  getTrackingApiSourcePackages().forEach((item) => {
    const label = getTrackingApiServiceValue(item)
    const existing = serviceMap.get(label)
    if (existing) {
      existing.count += 1
      return
    }

    serviceMap.set(label, { value: label, label, count: 1 })
  })

  return [...serviceMap.values()].sort((first, second) => {
    if (first.count !== second.count) {
      return second.count - first.count
    }

    return first.label.localeCompare(second.label, 'es')
  })
}

const getTrackingApiAvailableCountries = (field: 'origen' | 'destino') => {
  const countryMap = new Map<string, { value: string; label: string; count: number }>()

  getTrackingApiSourcePackages().forEach((item) => {
    const label = getTrackingApiCountryValue(field === 'origen' ? item.origen : item.destino)
    const existing = countryMap.get(label)
    if (existing) {
      existing.count += 1
      return
    }

    countryMap.set(label, { value: label, label, count: 1 })
  })

  return [...countryMap.values()].sort((first, second) => {
    if (first.count !== second.count) {
      return second.count - first.count
    }

    return first.label.localeCompare(second.label, 'es')
  })
}

const getTrackingApiSelectedStateOption = () =>
  getTrackingApiAvailableStates().find((option) => option.value === state.trackingApiStateFilter) ?? null

const getFilteredTrackingApiPackages = () => {
  const sourcePackages = getTrackingApiSourcePackages()
  const lookupPackage = getTrackingApiLookupPackage()

  if (lookupPackage) {
    return [lookupPackage]
  }

  return sourcePackages.filter((item) => {
    const matchesState =
      state.trackingApiStateFilter === 'all' ||
      getTrackingApiPackageStateLabels(item).includes(state.trackingApiStateFilter)
    return matchesState
    const matchesService =
      state.trackingApiServiceFilter === 'all' ||
      getTrackingApiServiceValue(item) === state.trackingApiServiceFilter
    const matchesOrigin =
      state.trackingApiOriginFilter === 'all' ||
      getTrackingApiCountryValue(item.origen) === state.trackingApiOriginFilter
    const matchesDestination =
      state.trackingApiDestinationFilter === 'all' ||
      getTrackingApiCountryValue(item.destino) === state.trackingApiDestinationFilter

    return matchesState && matchesService && matchesOrigin && matchesDestination
  })
}

const getContactPackageRemitente = (item: ContactPackagesApiItem) => {
  const anyItem = item as ContactPackagesApiItem & {
    origen?: { nombre?: string | null; telefono?: string | null }
    remitente?: { nombre?: string | null; telefono?: string | null }
  }

  return anyItem.remitente ?? anyItem.origen ?? null
}

const getContactPackageDestinatario = (item: ContactPackagesApiItem) => {
  const anyItem = item as ContactPackagesApiItem & {
    destino?: { nombre?: string | null; telefono?: string | null }
    destinatario?: { nombre?: string | null; telefono?: string | null }
  }

  return anyItem.destinatario ?? anyItem.destino ?? null
}

const getContactPackageRemitenteName = (item: ContactPackagesApiItem) =>
  normalizeText(getContactPackageRemitente(item)?.nombre ?? null) || 'Sin remitente'

const getContactPackageDestinatarioName = (item: ContactPackagesApiItem) =>
  normalizeText(getContactPackageDestinatario(item)?.nombre ?? null) || 'Sin destinatario'

const getContactPackageRemitentePhone = (item: ContactPackagesApiItem) =>
  normalizeText(getContactPackageRemitente(item)?.telefono ?? null) || '—'

const getContactPackageDestinatarioPhone = (item: ContactPackagesApiItem) =>
  normalizeText(getContactPackageDestinatario(item)?.telefono ?? null) || '—'

const getContactPackageEstado = (item: ContactPackagesApiItem) =>
  normalizeText(item.estado?.nombre ?? null) || 'Sin estado'

const normalizeEmsPackageCode = (value: unknown) => normalizeText(String(value ?? '')).toUpperCase().replace(/\s+/g, '')

const getTrackingPackageCode = (item: TrackingApiPackage) => {
  const flexibleItem = item as TrackingApiPackage & Record<string, unknown>
  return normalizeEmsPackageCode(
    flexibleItem.codigo_s10 || flexibleItem.codigo || flexibleItem.codigoSeguimiento || flexibleItem.tracking,
  )
}

const getContactPackageCode = (item: ContactPackagesApiItem) => {
  const flexibleItem = item as ContactPackagesApiItem & Record<string, unknown>
  return normalizeEmsPackageCode(
    flexibleItem.codigo || flexibleItem.codigo_s10 || flexibleItem.codigoSeguimiento || flexibleItem.tracking,
  )
}

const isNationalPackageCode = (code: unknown) => /^[A-Z]{1,2}\d+[A-Z]{2}$/.test(normalizeEmsPackageCode(code)) && normalizeEmsPackageCode(code).endsWith('BO')

const isNationalTrackingPackage = (item: TrackingApiPackage) => isNationalPackageCode(getTrackingPackageCode(item))

const isNationalContactPackage = (item: ContactPackagesApiItem) => isNationalPackageCode(getContactPackageCode(item))

const getContactPackagePipelineStage = (item: ContactPackagesApiItem): EmsColumnKey => {
  const status = normalizeCountryKey(getContactPackageEstado(item))
  const eventStage = getPackageStageFromEvents(item)
  const configuredStage = findConfiguredPipelineStageForState(getContactPackageEstado(item))

  if (configuredStage) {
    return configuredStage
  }

  if (eventStage) {
    return eventStage
  }

  if (
    status.includes('entreg') ||
    status.includes('confirm')
  ) {
    return 'delivered'
  }

  if (
    status.includes('cancel') ||
    status.includes('anul') ||
    status.includes('rechaz')
  ) {
    return 'cancelled'
  }

  if (
    status.includes('regional') ||
    status.includes('destino') ||
    status.includes('recibido destino') ||
    status.includes('recibido regional') ||
    status.includes('sucursal de destino') ||
    status.includes('pasar a recoger')
  ) {
    return 'regional'
  }

  if (
    status.includes('cartero') ||
    status.includes('reparto') ||
    status.includes('distribucion')
  ) {
    return 'courier'
  }

  if (
    status.includes('transit') ||
    status.includes('camino') ||
    status.includes('despacho') ||
    status.includes('aduana') ||
    status.includes('seguimiento') ||
    status.includes('activo') ||
    status.includes('proceso') ||
    status.includes('proces') ||
    status.includes('en curso') ||
    status.includes('ruta') ||
    status.includes('clasific')
  ) {
    return 'transit'
  }

  if (
    status.includes('recibido') ||
    status.includes('origen') ||
    status.includes('nuevo') ||
    status.includes('ingreso') ||
    status.includes('admis')
  ) {
    return 'received'
  }

  return 'received'
}

const getContactPackageDestinationPlace = (item: ContactPackagesApiItem) => {
  const destino = item.destino

  if (typeof destino === 'string') {
    return normalizeText(destino) || normalizeText(item.destinatario?.direccion ?? null) || 'Sin destino'
  }

  return (
    normalizeText(item.destinatario?.direccion ?? null) ||
    normalizeText(destino?.direccion ?? null) ||
    normalizeText(destino?.nombre ?? null) ||
    'Sin destino'
  )
}

const getContactReferenceCandidates = (contact: Contact) =>
  (contact.socialProfiles ?? [])
    .map((profile) => normalizeText(profile.reference))
    .filter((reference) => reference.length > 0)

const findContactByReferenceValue = (reference: string) => {
  const normalizedReference = normalizeText(reference).toLowerCase()
  const normalizedDigits = normalizePhoneDigits(reference)
  if (!normalizedReference && !normalizedDigits) return null

  return (
    state.data?.contacts.find((contact) => {
      const candidates = getContactReferenceCandidates(contact)
      if (candidates.some((candidate) => candidate.toLowerCase() === normalizedReference)) {
        return true
      }

      const candidateDigits = candidates.map((candidate) => normalizePhoneDigits(candidate))
      return normalizedDigits.length > 0 && candidateDigits.some((candidate) => candidate === normalizedDigits)
    }) ?? null
  )
}

const findContactByWhatsAppReferenceValue = (reference: string) => {
  const normalizedDigits = normalizePhoneDigits(reference)
  if (!normalizedDigits) return null
  const referenceCandidates = new Set(getWhatsAppNumberCandidates(normalizedDigits))

  return (
    state.data?.contacts.find((contact) => {
      if (!hasWhatsAppChannel(contact) && !isContactConnected(contact) && normalizeText(contact.channel).toLowerCase() !== 'whatsapp') {
        return false
      }

      const whatsappReference = getWhatsAppReference(contact)
      return getWhatsAppNumberCandidates(whatsappReference).some((candidate) => referenceCandidates.has(candidate))
    }) ?? null
  )
}

const getEmsReferenceChannelState = (reference: string, contact: Contact | null) => {
  if (contact?.id) {
    return {
      label: 'WhatsApp disponible',
      toneClass: 'is-whatsapp',
      isWhatsApp: true,
      isCellPhone: false,
    }
  }

  if (isCellPhoneNumber(reference)) {
    return {
      label: 'Celular disponible',
      toneClass: 'is-cellphone',
      isWhatsApp: false,
      isCellPhone: true,
    }
  }

  return {
    label: 'Solo telefono',
    toneClass: 'is-phone',
    isWhatsApp: false,
    isCellPhone: false,
  }
}

const openContactConversationOrProfile = async (contactId: number) => {
  const contact = state.data?.contacts.find((item) => item.id === contactId)
  if (!contact) return

  if (hasWhatsAppChannel(contact)) {
    await openConversationModal(contactId)
    return
  }

  openContactProfileModal(contactId)
}

const buildEmsPackageCardFromTracking = (
  item: TrackingApiPackage,
  index: number,
  stage: EmsColumnKey,
): EmsPackageCard => {
  const code = normalizeReference(item?.codigo_s10) || normalizeReference(item?.codigo) || `TR-${index + 1}`
  const id = `tracking-${item.mailitm_pid ?? code}`
  const resolvedStage = state.emsStageOverrides[code.trim().toUpperCase()] ?? stage
  const senderReference =
    normalizeText(item.telefono ?? null) ||
    normalizeText(item.phone ?? null) ||
    normalizeText(item.numero_telefono ?? null) ||
    normalizeText(item.numeroTelefono ?? null) ||
    normalizeText(item.telefonos?.remitente ?? null) ||
    normalizeText(item.remitente?.telefono ?? null) ||
    'Sin referencia'
  const recipientReference =
    normalizeText(item.telefonos?.destinatario ?? null) ||
    normalizeText(item.destinatario?.telefono ?? null) ||
    (typeof item.destino === 'string' ? '' : normalizeText(item.destino?.telefono ?? null)) ||
    'Sin referencia'
  const senderName = normalizeText(item.remitente?.nombre ?? null) || getTrackingLocationName(item.origen)
  const recipientName = normalizeText(item.destinatario?.nombre ?? null) || getTrackingLocationName(item.destino)
  const destination = getTrackingDestinationPlaceValue(item)
  const latestEvent = getTrackingLatestEvent(item)
  const status =
    (latestEvent ? getTrackingApiEventStateLabel(latestEvent) : '') ||
    normalizeReference(item?.estado?.nombre) ||
    normalizeReference(item?.estado_postal) ||
    getEmsStatusLabel(stage)

  return {
    id,
    stage: resolvedStage,
    code,
    title: `Tracking ${code}`,
    summary: normalizeText(item.contenido ?? null) || `${senderName} → ${recipientName}`,
    senderName,
    senderReference,
    recipientName,
    recipientReference,
    destination,
    status,
    updatedAt: getEmsApiContactTimestamp(latestEvent?.fecha || item?.fecha_registro),
    sourceKind: 'tracking',
    sourceRecord: item,
  }
}

const buildEmsPackageCardFromContact = (
  item: ContactPackagesApiItem,
  index: number,
  stage: EmsColumnKey,
): EmsPackageCard => {
  const code = normalizeReference(item?.codigo) || `CP-${index + 1}`
  const id = `contact-${item.id ?? code}`
  const resolvedStage = state.emsStageOverrides[code.trim().toUpperCase()] ?? stage
  const senderName = getContactPackageRemitenteName(item)
  const senderReference = getContactPackageRemitentePhone(item)
  const recipientName = getContactPackageDestinatarioName(item)
  const recipientReference = getContactPackageDestinatarioPhone(item)
  const destination = getContactPackageDestinationPlace(item)
  const latestEvent = getTrackingLatestEvent(item as unknown as TrackingApiPackage)
  const status = (latestEvent ? getTrackingApiEventStateLabel(latestEvent) : '') || getContactPackageEstado(item)

  return {
    id,
    stage: resolvedStage,
    code,
    title: code,
    summary: `${senderName} → ${recipientName}`,
    senderName,
    senderReference,
    recipientName,
    recipientReference,
    destination,
    status,
    updatedAt: getEmsApiContactTimestamp(latestEvent?.fecha || item?.fecha_registro),
    sourceKind: 'contact',
    sourceRecord: item,
  }
}

const getEmsApiStatusPackages = (): {
  all: EmsPackageCard[]
  received: EmsPackageCard[]
  transit: EmsPackageCard[]
  regional: EmsPackageCard[]
  courier: EmsPackageCard[]
  delivered: EmsPackageCard[]
  cancelled: EmsPackageCard[]
} => {
  const trackingItems = getTrackingApiSourcePackages().filter(isNationalTrackingPackage)
  const contactItems = getEffectiveContactPackages().filter(isNationalContactPackage)
  const selectedMonth = state.emsMonthFilter.trim() || 'all'
  const matchesSelectedMonth = (value: unknown) => {
    if (selectedMonth === 'all') {
      return true
    }

    return getEmsMonthKeyFromValue(value) === selectedMonth
  }

  const filteredTrackingItems = trackingItems.filter((item) =>
    matchesSelectedMonth(item?.fecha_registro || item?.eventos?.[0]?.fecha),
  )
  const filteredContactItems = contactItems.filter((item) => matchesSelectedMonth(item?.fecha_registro))
  const allCards = [
    ...filteredTrackingItems.map((item, index) => buildEmsPackageCardFromTracking(item, index, getTrackingPipelineStage(item))),
    ...filteredContactItems.map((item, index) => buildEmsPackageCardFromContact(item, index, getContactPackagePipelineStage(item))),
  ]
  const buckets = createEmsStageBuckets(allCards)

  return {
    all: buckets.all,
    received: buckets.received,
    transit: buckets.transit,
    regional: buckets.regional,
    courier: buckets.courier,
    delivered: buckets.delivered,
    cancelled: buckets.cancelled,
  }
}

const getEmsApiCustomColumnPackages = (columnId: string) => {
  const customColumn = state.pipelineConfig.customColumns.find((column) => column.id === columnId)
  if (!customColumn) return []

  const normalizedTitle = customColumn.title.trim().toLowerCase()
  return getEmsApiStatusPackages().all.filter(
    (card) => String(card.status ?? '').trim().toLowerCase() === normalizedTitle,
  )
}

const getEmsStatePackagesForScope = (scope: EmsColumnKey | null) => {
  const packages = getEmsApiStatusPackages()

  if (!scope) {
    return packages.all
  }

  return packages[scope] ?? []
}

const getEmsStatePackagesModalPagination = () => {
  const pageSize = 8
  const scope = state.emsStatePackagesModalScope
  const allItems = getEmsStatePackagesForScope(scope)
  const totalItems = allItems.length
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))
  const currentPage = Math.min(Math.max(state.emsStatePackagesModalPage, 1), totalPages)
  const startIndex = (currentPage - 1) * pageSize

  return {
    scope,
    totalItems,
    totalPages,
    currentPage,
    pageSize,
    items: allItems.slice(startIndex, startIndex + pageSize),
  }
}

const isTrackingTestNumberPresent = (targetNumber: string) => {
  const targetCandidates = new Set(getBoliviaTestPhoneCandidates(targetNumber))
  if (targetCandidates.size === 0) return false

  return state.trackingApiPackages.some((item) => {
    const candidates = [
      item.telefono,
      item.phone,
      item.numero_telefono,
      item.numeroTelefono,
      item.telefonos?.remitente,
      item.telefonos?.destinatario,
    ]

    return candidates.some((candidate) =>
      getBoliviaTestPhoneCandidates(candidate).some((normalizedCandidate) => targetCandidates.has(normalizedCandidate)),
    )
  })
}

const isContactPackagesTestNumberPresent = (targetNumber: string) => {
  const targetCandidates = new Set(getBoliviaTestPhoneCandidates(targetNumber))
  if (targetCandidates.size === 0) return false

  return state.contactPackages.some((item) => {
    const candidates = [
      getContactPackageRemitente(item)?.telefono,
      getContactPackageDestinatario(item)?.telefono,
    ]

    return candidates.some((candidate) =>
      getBoliviaTestPhoneCandidates(candidate).some((normalizedCandidate) => targetCandidates.has(normalizedCandidate)),
    )
  })
}

const isWhatsAppTestNumberAvailableInLoadedApis = (targetNumber: string) => {
  return isTrackingTestNumberPresent(targetNumber) || isContactPackagesTestNumberPresent(targetNumber)
}

const resetWhatsAppTestNumbersState = () => {
  state.whatsappTestNumbersState = 'idle'
  state.whatsappTestNumbersError = null
  state.whatsappTestNumberDraft = ''
  state.whatsappTestNumberCountry = defaultWhatsAppCountry.iso2
  state.whatsappEditingTestNumber = null
}

const updateWhatsAppTestNumberDraft = (value: string) => {
  state.whatsappTestNumberDraft = value
}

const getPhoneCountryByNumber = (value: unknown) => {
  const digits = normalizePhoneDigits(value)
  return [...phoneCountryOptions]
    .sort((first, second) => second.dialCode.length - first.dialCode.length)
    .find((country) => digits.startsWith(country.dialCode)) ?? defaultWhatsAppCountry
}

const startEditingWhatsAppTestNumber = (number: string) => {
  state.whatsappEditingTestNumber = number
  const country = getPhoneCountryByNumber(number)
  const digits = normalizePhoneDigits(number)
  state.whatsappTestNumberCountry = country.iso2
  state.whatsappTestNumberDraft = digits.startsWith(country.dialCode) ? digits.slice(country.dialCode.length) : digits
  state.whatsappTestNumbersError = null
  renderApp()
}

const cancelEditingWhatsAppTestNumber = () => {
  resetWhatsAppTestNumbersState()
  renderApp()
}

const applyWhatsAppTestNumbersPayload = (payload: any) => {
  const numbers = Array.isArray(payload?.config?.testModeNumbers)
    ? payload.config.testModeNumbers
    : Array.isArray(payload?.numbers)
      ? payload.numbers
      : Array.isArray(payload?.items)
        ? payload.items.map((item: any) => item?.number)
        : []

  state.whatsappTestModeNumbers = numbers
    .map((value: unknown) => normalizeBoliviaTestPhoneDigits(value))
    .filter(Boolean)
  state.whatsappTestModeNumber =
    state.whatsappTestModeNumbers[0] || normalizeBoliviaTestPhoneDigits(DEFAULT_WHATSAPP_TEST_NUMBER)
}

const submitWhatsAppTestNumber = async () => {
  state.whatsappTestNumbersState = 'submitting'
  state.whatsappTestNumbersError = null
  renderApp()

  try {
    const selectedCountry = phoneCountryOptions.find((country) => country.iso2 === state.whatsappTestNumberCountry) ?? defaultWhatsAppCountry
    const localDigits = normalizePhoneDigits(state.whatsappTestNumberDraft)
    const normalizedNumber = `${selectedCountry.dialCode}${localDigits}`
    if (!normalizedNumber) {
      throw new Error('Ingresa un numero de prueba valido.')
    }

    const isEditing = Boolean(state.whatsappEditingTestNumber)
    const endpoint = isEditing
      ? `/api/integrations/whatsapp-test-numbers/${encodeURIComponent(state.whatsappEditingTestNumber || '')}`
      : '/api/integrations/whatsapp-test-numbers'
    const method = isEditing ? 'PUT' : 'POST'

    const response = await authFetch(endpoint, {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ number: normalizedNumber }),
    })

    const payload = await parseApiPayload(response)

    if (response.status === 401) {
      clearSession()
      state.loginError = 'Tu sesion expiro. Inicia sesion nuevamente.'
      renderApp()
      return
    }

    if (!response.ok) {
      throw new Error(
        (payload?.error as string) ||
        (payload?.message as string) ||
        'No se pudo guardar el numero de prueba.',
      )
    }

    applyWhatsAppTestNumbersPayload(payload)
    resetWhatsAppTestNumbersState()
    state.logsError = null
    state.logsState = state.logsState === 'error' ? 'idle' : state.logsState
    state.notice = isEditing
      ? 'Numero de prueba actualizado correctamente.'
      : 'Numero de prueba agregado correctamente.'
    renderApp()
  } catch (error) {
    state.whatsappTestNumbersState = 'idle'
    state.whatsappTestNumbersError =
      error instanceof Error ? error.message : 'No se pudo guardar el numero de prueba.'
    renderApp()
  }
}

const deleteWhatsAppTestNumber = async (number: string) => {
  state.whatsappTestNumbersState = 'submitting'
  state.whatsappTestNumbersError = null
  renderApp()

  try {
    const response = await authFetch(`/api/integrations/whatsapp-test-numbers/${encodeURIComponent(number)}`, {
      method: 'DELETE',
    })
    const payload = await parseApiPayload(response)

    if (response.status === 401) {
      clearSession()
      state.loginError = 'Tu sesion expiro. Inicia sesion nuevamente.'
      renderApp()
      return
    }

    if (!response.ok) {
      throw new Error(
        (payload?.error as string) ||
        (payload?.message as string) ||
        'No se pudo eliminar el numero de prueba.',
      )
    }

    applyWhatsAppTestNumbersPayload(payload)
    resetWhatsAppTestNumbersState()
    state.logsError = null
    state.logsState = state.logsState === 'error' ? 'idle' : state.logsState
    state.notice = 'Numero de prueba eliminado correctamente.'
    renderApp()
  } catch (error) {
    state.whatsappTestNumbersState = 'idle'
    state.whatsappTestNumbersError =
      error instanceof Error ? error.message : 'No se pudo eliminar el numero de prueba.'
    renderApp()
  }
}

const ensureWhatsAppTestModeSourcesLoaded = async () => {
  if (state.trackingApiPackages.length === 0 && state.trackingApiState !== 'loading') {
    await loadTrackingApiPackages()
  }

  if (state.contactPackages.length === 0 && state.contactPackagesState !== 'loading') {
    await loadContactPackages()
  }
}

const getTrackingPipelineStage = (item: TrackingApiPackage): EmsColumnKey => {
  const postalState = normalizeCountryKey(item.estado_postal)
  const latestEvent = getTrackingLatestEvent(item)
  const eventStage = getPackageStageFromEvents(item)
  const latestEventText = normalizeCountryKey(
    [latestEvent?.nombre, latestEvent?.evento_api, latestEvent?.evento_original, latestEvent?.movimiento_bolivia, latestEvent?.detalle]
      .filter(Boolean)
      .join(' '),
  )
  const latestEventLabel = [
    latestEvent?.nombre,
    latestEvent?.evento_api,
    latestEvent?.evento_original,
    latestEvent?.movimiento_bolivia,
    latestEvent?.detalle,
  ]
    .filter(Boolean)
    .join(' ')
  const configuredStage =
    findConfiguredPipelineStageForState(latestEventLabel) ??
    findConfiguredPipelineStageForState(getTrackingApiStateLabel(item)) ??
    findConfiguredPipelineStageForState(item.estado_postal)

  if (configuredStage) {
    return configuredStage
  }

  if (eventStage) {
    return eventStage
  }

  if (
    postalState.includes('cancel') ||
    postalState.includes('anul') ||
    latestEventText.includes('cancel') ||
    latestEventText.includes('anul') ||
    latestEventText.includes('rechaz')
  ) {
    return 'cancelled'
  }

  if (
    postalState.includes('entreg') ||
    latestEventText.includes('entreg') ||
    latestEventText.includes('recogid') ||
    latestEventText.includes('confirmacion')
  ) {
    return 'delivered'
  }

  if (
    postalState.includes('camino') ||
    postalState.includes('transit') ||
    postalState.includes('trÃ¡nsit') ||
    latestEventText.includes('salida') ||
    latestEventText.includes('transit') ||
    latestEventText.includes('camino') ||
    latestEventText.includes('activo') ||
    latestEventText.includes('proceso') ||
    latestEventText.includes('proces') ||
    latestEventText.includes('en curso') ||
    latestEventText.includes('ruta') ||
    latestEventText.includes('clasific')
  ) {
    return 'transit'
  }

  if (
    postalState.includes('cartero') ||
    postalState.includes('reparto') ||
    latestEventText.includes('cartero') ||
    latestEventText.includes('reparto')
  ) {
    return 'courier'
  }

  if (
    postalState.includes('regional') ||
    postalState.includes('destino') ||
    latestEventText.includes('regional') ||
    latestEventText.includes('destino') ||
    latestEventText.includes('sucursal de destino') ||
    latestEventText.includes('recibido destino') ||
    latestEventText.includes('recibido regional') ||
    latestEventText.includes('pasar a recoger')
  ) {
    return 'regional'
  }

  if (
    postalState.includes('ventanilla') ||
    postalState.includes('almacen') ||
    postalState.includes('almacen origen') ||
    postalState.includes('origen') ||
    latestEventText.includes('ventanilla') ||
    latestEventText.includes('almacen') ||
    latestEventText.includes('almacen origen') ||
    latestEventText.includes('origen') ||
    latestEventText.includes('admis') ||
    latestEventText.includes('recepcion') ||
    latestEventText.includes('recibido')
  ) {
    return 'received'
  }

  return 'received'
}

const getTrackingPipelineColumns = (scope: 'all' | 'national' | 'international' = 'all') => {
  const packages = getTrackingApiSourcePackages().filter((item) => {
    if (scope === 'national') return isNationalTrackingPackage(item)
    if (scope === 'international') return !isNationalTrackingPackage(item)
    return true
  })
  const buckets = createEmsStageBuckets(
    packages.map((item) => ({
      ...item,
      stage: getTrackingPipelineStage(item),
    })),
  )

  return {
    received: buckets.received,
    regional: buckets.regional,
    transit: buckets.transit,
    courier: buckets.courier,
    delivered: buckets.delivered,
    cancelled: buckets.cancelled,
  }
}

const normalizeApiPipelineStateKey = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

const normalizeAllowedStates = (value: unknown, fallback: string[] = []) => {
  const source = Array.isArray(value) ? value : []
  const nextValues = source
    .map((entry) => normalizeApiPipelineStateKey(normalizeText(entry)))
    .filter(Boolean)

  if (nextValues.length === 0 && fallback.length > 0) {
    return [...new Set(fallback.map((entry) => normalizeApiPipelineStateKey(normalizeText(entry))).filter(Boolean))]
  }

  return [...new Set(nextValues)]
}

const getPipelineColumnAllowedStateKeys = (column: EmsColumnKey | null) => {
  if (!column) return []

  return normalizeAllowedStates(state.pipelineConfig.columns[column]?.allowedStates ?? [], [
    state.pipelineConfig.columns[column]?.title ?? '',
  ])
}

const findConfiguredPipelineStageForState = (stateValue: string): EmsColumnKey | null => {
  const normalizedState = normalizeApiPipelineStateKey(normalizeText(stateValue))
  if (!normalizedState) {
    return null
  }

  for (const key of ['received', 'transit', 'regional', 'courier', 'delivered', 'cancelled'] as EmsColumnKey[]) {
    const allowedStates = getPipelineColumnAllowedStateKeys(key)
    if (allowedStates.includes(normalizedState)) {
      return key
    }
  }

  return null
}

const getTrackingApiStateLabel = (item: TrackingApiPackage) => {
  const latestEvent = getTrackingLatestEvent(item)

  return (
    normalizeText(item.estado?.nombre) ||
    normalizeText(item.estado_postal) ||
    normalizeText(latestEvent?.evento_api) ||
    normalizeText(latestEvent?.evento_original) ||
    normalizeText(latestEvent?.detalle) ||
    normalizeText(latestEvent?.movimiento_bolivia) ||
    'Sin estado'
  )
}

const getApiPipelineStateOptions = (scope: EmsColumnKey | null = null): ApiPipelineStateOption[] => {
  const trackingPackages = getTrackingApiSourcePackages().filter(isNationalTrackingPackage)
  const contactPackages = getEffectiveContactPackages().filter(isNationalContactPackage)
  const selectedMonth = state.emsMonthFilter.trim() || 'all'
  const matchesSelectedMonth = (value: unknown) => {
    if (selectedMonth === 'all') {
      return true
    }

    return getEmsMonthKeyFromValue(value) === selectedMonth
  }
  const filteredTrackingPackages = trackingPackages.filter((item) =>
    matchesSelectedMonth(item?.fecha_registro || getTrackingLatestEvent(item)?.fecha),
  )
  const filteredContactPackages = contactPackages.filter((item) => matchesSelectedMonth(item?.fecha_registro))
  const stateMap = new Map<
    string,
    {
      stateKey: string
      title: string
      helper: string
      count: number
      sources: Set<string>
      stages: Set<EmsColumnKey>
    }
  >()
  const scopeAllowedStates = getPipelineColumnAllowedStateKeys(scope)

  const registerState = (title: string, source: string, stage: EmsColumnKey) => {
    const normalizedTitle = normalizeText(title)
    if (!normalizedTitle || normalizedTitle.toLowerCase() === 'sin estado') {
      return
    }

    const stateKey = normalizeApiPipelineStateKey(normalizedTitle)
    if (!stateKey) {
      return
    }

    const existing = stateMap.get(stateKey)
    if (existing) {
      existing.count += 1
      existing.sources.add(source)
      existing.stages.add(stage)
      return
    }

    stateMap.set(stateKey, {
      stateKey,
      title: normalizedTitle,
      helper: `Estado detectado desde la API de ${source.toLowerCase()}.`,
      count: 1,
      sources: new Set([source]),
      stages: new Set([stage]),
    })
  }

  filteredTrackingPackages.forEach((item) => {
    const stage = getTrackingPipelineStage(item)
    getPackageApiStateLabels(item).forEach((label) => registerState(label, 'Tracking', stage))
  })

  filteredContactPackages.forEach((item) => {
    const stage = getContactPackagePipelineStage(item)
    getPackageApiStateLabels(item).forEach((label) => registerState(label || getContactPackageEstado(item), 'Paquetes', stage))
  })

  const stageCounts: Record<EmsColumnKey, number> = {
    received: 0,
    transit: 0,
    regional: 0,
    courier: 0,
    delivered: 0,
    cancelled: 0,
  }

  filteredTrackingPackages.forEach((item) => {
    stageCounts[getTrackingPipelineStage(item)] += 1
  })

  filteredContactPackages.forEach((item) => {
    stageCounts[getContactPackagePipelineStage(item)] += 1
  })

    ; (['received', 'transit', 'regional', 'courier', 'delivered', 'cancelled'] as EmsColumnKey[]).forEach((stageKey) => {
      const pipelineColumn = getPipelineColumnConfig(stageKey)
      const normalizedStateKey = normalizeApiPipelineStateKey(pipelineColumn.title)

      if (!stateMap.has(normalizedStateKey)) {
        stateMap.set(normalizedStateKey, {
          stateKey: normalizedStateKey,
          title: pipelineColumn.title,
          helper: pipelineColumn.helper,
          count: stageCounts[stageKey],
          sources: new Set(['Pipeline']),
          stages: new Set([stageKey]),
        })
        return
      }

      const existing = stateMap.get(normalizedStateKey)
      if (!existing) return
      existing.count = Math.max(existing.count, stageCounts[stageKey])
      existing.sources.add('Pipeline')
      existing.stages.add(stageKey)
    })

  return [...stateMap.values()]
    .filter((item) => !scope || item.stages.has(scope))
    .map((item) => ({
      stateKey: item.stateKey,
      title: item.title,
      helper: item.helper,
      count: item.count,
      sources: [...item.sources].sort((first, second) => first.localeCompare(second, 'es')),
      stages: [...item.stages],
      isRegistered: scopeAllowedStates.includes(item.stateKey),
    }))
    .sort((first, second) => {
      if (second.count !== first.count) {
        return second.count - first.count
      }

      return first.title.localeCompare(second.title, 'es')
    })
}

const ensureApiPipelineStateSourcesLoaded = async () => {
  const pendingLoads: Promise<unknown>[] = []

  if (state.trackingApiCatalogPackages.length === 0 && state.trackingApiCatalogState !== 'loading') {
    pendingLoads.push(loadTrackingApiCatalogPackages())
  }

  if (!state.contactPackagesCatalogLoaded) {
    pendingLoads.push(loadAllContactPackages())
  }

  if (state.contactPackages.length === 0 && state.contactPackagesState !== 'loading') {
    pendingLoads.push(loadContactPackages())
  }

  if (pendingLoads.length > 0) {
    await Promise.allSettled(pendingLoads)
  }
}

const isAiAssistedConversation = (contactId: number) =>
  state.globalAiAgentEnabled || state.aiAssistedContactIds.has(contactId)

const toggleAiAssistanceForConversation = async (contactId: number, enabled: boolean) => {
  try {
    const response = await authFetch(`/api/ai/agent/contacts/${contactId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ enabled }),
    })
    const payload = (await parseApiPayload(response)) as Partial<AiAgentApiPayload>

    if (response.status === 401) {
      clearSession()
      state.loginError = 'Tu sesion expiro. Inicia sesion nuevamente.'
      renderApp()
      return
    }

    if (!response.ok) {
      throw new Error(
        (payload as { error?: string; message?: string } | null)?.error ||
        (payload as { error?: string; message?: string } | null)?.message ||
        'No se pudo actualizar la IA de la conversacion.',
      )
    }

    state.aiAssistedContactIds = new Set(
      Array.isArray(payload?.assistedContactIds)
        ? payload.assistedContactIds.filter((value) => Number.isInteger(Number(value)) && Number(value) > 0).map(Number)
        : [],
    )
    state.notice = enabled
      ? 'La IA respondera automaticamente en esta conversacion.'
      : 'La conversacion vuelve a modo manual.'
    persistUiState()
    renderApp()
  } catch (error) {
    state.notice =
      error instanceof Error ? error.message : 'No se pudo actualizar la IA de la conversacion.'
    renderApp()
  }
}

const generateAiSuggestedReply = async (contactId: number, instruction = '') => {
  const response = await authFetch('/api/ai/suggest-reply', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contactId,
      instruction,
      messages: state.conversationData.messages.map((message) => ({
        direction: message.direction,
        message: message.message,
      })),
    }),
  })

  const payload = await parseApiPayload(response)

  if (response.status === 401) {
    clearSession()
    state.loginError = 'Tu sesion expiro. Inicia sesion nuevamente.'
    renderApp()
    return null
  }

  if (!response.ok) {
    const aiMessage =
      (payload?.error as string) ||
      (payload?.message as string) ||
      'No se pudo generar la respuesta con la IA local.'

    if (response.status === 503) {
      state.notice = aiMessage
      renderApp()
      window.alert(aiMessage)
      return null
    }

    throw new Error(aiMessage)
  }

  const suggestion = normalizeText(String(payload?.suggestion ?? ''))
  if (!suggestion) {
    throw new Error('La IA no devolvio una respuesta valida.')
  }

  return suggestion
}

const findPhoneCountryByIso2 = (iso2: string | undefined) =>
  phoneCountryOptions.find((country) => country.iso2 === iso2)

const detectPhoneCountryFromNumber = (value: string) => {
  const digits = value.replace(/[^\d]/g, '')

  if (!digits) {
    return null
  }

  const phoneNumber =
    parsePhoneNumberFromString(digits, defaultWhatsAppCountry.iso2) ??
    parsePhoneNumberFromString(`+${digits}`)
  const detectedCountry = findPhoneCountryByIso2(phoneNumber?.country)

  if (!detectedCountry || !phoneNumber?.isPossible()) {
    return null
  }

  return {
    country: detectedCountry,
    localNumber: phoneNumber.nationalNumber,
  }
}

const findPhoneCountry = (query: string) => {
  const normalizedQuery = query.trim().toLowerCase()

  if (!normalizedQuery) {
    return defaultWhatsAppCountry
  }

  return (
    phoneCountryOptions.find((country) => {
      const normalizedDialCode = `+${country.dialCode}`
      return (
        country.iso2.toLowerCase() === normalizedQuery ||
        country.name.toLowerCase() === normalizedQuery ||
        getPhoneCountryLabel(country).toLowerCase() === normalizedQuery ||
        normalizedDialCode === normalizedQuery
      )
    }) ??
    phoneCountryOptions.find((country) => {
      const normalizedDialCode = `+${country.dialCode}`
      return (
        country.iso2.toLowerCase().includes(normalizedQuery) ||
        country.name.toLowerCase().includes(normalizedQuery) ||
        normalizedDialCode.includes(normalizedQuery)
      )
    }) ??
    null
  )
}

const buildWhatsAppReference = () => {
  const rawNumber = state.createContactForm.whatsappLocalNumber.trim()

  if (!rawNumber) {
    throw new Error('Escribe el numero de WhatsApp del contacto.')
  }

  const detectedPhone = detectPhoneCountryFromNumber(rawNumber)

  if (detectedPhone) {
    const parsedPhone = parsePossiblePhoneNumber(
      `+${detectedPhone.country.dialCode}${detectedPhone.localNumber}`,
    )

    if (!parsedPhone) {
      throw new Error('El numero de WhatsApp debe ser un celular valido.')
    }

    const phoneType = parsedPhone.getType?.()
    if (phoneType !== 'MOBILE' && phoneType !== 'FIXED_LINE_OR_MOBILE') {
      throw new Error('El numero de WhatsApp debe ser un celular valido.')
    }

    return `+${detectedPhone.country.dialCode}${detectedPhone.localNumber}`
  }

  const localDigits = rawNumber.replace(/[^\d]/g, '')

  if (!localDigits) {
    throw new Error('Escribe el numero de WhatsApp del contacto.')
  }

  const defaultPhone = parsePossiblePhoneNumber(`+${defaultWhatsAppCountry.dialCode}${localDigits}`)

  if (!defaultPhone) {
    throw new Error('El numero de WhatsApp debe ser un celular valido.')
  }

  const defaultPhoneType = defaultPhone.getType?.()
  if (defaultPhoneType !== 'MOBILE' && defaultPhoneType !== 'FIXED_LINE_OR_MOBILE') {
    throw new Error('El numero de WhatsApp debe ser un celular valido.')
  }

  return `+${defaultWhatsAppCountry.dialCode}${localDigits}`
}

const parseWhatsAppReference = (reference: string) => {
  const normalizedDigits = String(reference ?? '').replace(/[^\d]/g, '')
  const detectedPhone = detectPhoneCountryFromNumber(normalizedDigits)

  if (detectedPhone) {
    return detectedPhone
  }

  const matchedCountry = [...phoneCountryOptions]
    .sort((firstCountry, secondCountry) => secondCountry.dialCode.length - firstCountry.dialCode.length)
    .find((country) => normalizedDigits.startsWith(country.dialCode))

  if (!matchedCountry) {
    return {
      country: defaultWhatsAppCountry,
      localNumber: normalizedDigits,
    }
  }

  return {
    country: matchedCountry,
    localNumber: normalizedDigits.slice(matchedCountry.dialCode.length),
  }
}

const buildContactFormFromContact = (contact: Contact): CreateContactForm => {
  const socialProfiles = Array.isArray(contact.socialProfiles) ? contact.socialProfiles : []
  const channels = socialProfiles
    .map((profile) => String(profile?.channel ?? '').trim())
    .filter((channel): channel is string => Boolean(channel))
  const uniqueChannels = [...new Set(channels.length > 0 ? channels : contact.channel.split(',').map((item) => item.trim()).filter(Boolean))]
  const whatsappProfile = socialProfiles.find(
    (profile) => String(profile?.channel ?? '').trim().toLowerCase() === 'whatsapp',
  )
  const parsedWhatsApp = parseWhatsAppReference(String(whatsappProfile?.reference ?? ''))
  const form = defaultContactForm()

  form.name = contact.name
  form.company = contact.company
  form.channels = uniqueChannels.length > 0 ? uniqueChannels : ['WhatsApp']
  form.segment = contact.segment
  form.owner = contact.owner
  form.status = contact.status
  form.score = String(contact.score)
  form.whatsappCountrySearch = parsedWhatsApp.country.iso2
  form.whatsappLocalNumber = parsedWhatsApp.localNumber

  for (const channel of contactChannelOptions) {
    const matchingProfile = socialProfiles.find(
      (profile) => String(profile?.channel ?? '').trim().toLowerCase() === channel.toLowerCase(),
    )
    form.channelReferences[channel] = String(matchingProfile?.reference ?? '')
  }

  return form
}

const buildContactFormFromConversation = (contact: Contact | null | undefined): CreateContactForm => {
  const conversation = state.conversationData
  const form = contact ? buildContactFormFromContact(contact) : defaultContactForm()
  const referenceSource = contact ? getWhatsAppReference(contact) : ''
  const parsedReference = referenceSource ? parseWhatsAppReference(referenceSource) : null
  const firstSegment = getSegmentOptions()[0] ?? ''

  form.name = String(contact?.name ?? conversation.contact.name ?? '').trim()
  form.company = String(contact?.company ?? conversation.contact.company ?? '').trim()
  form.channels = contact?.channel
    ? [...new Set(contact.channel.split(',').map((item) => item.trim()).filter(Boolean))]
    : ['WhatsApp']
  form.channelReferences = {
    ...(contact ? buildContactFormFromContact(contact).channelReferences : {}),
  }
  form.segment = String(contact?.segment ?? firstSegment ?? '').trim()
  form.owner = String(contact?.owner ?? 'Camila').trim() || 'Camila'
  form.status = String(contact?.status ?? 'Nuevo').trim() || 'Nuevo'
  form.score = String(contact?.score ?? 80)
  form.whatsappCountrySearch = parsedReference?.country.iso2 ?? defaultWhatsAppCountry.iso2
  form.whatsappLocalNumber = parsedReference?.localNumber ?? referenceSource.replace(/[^\d]/g, '')

  if (form.channels.length === 0) {
    form.channels = ['WhatsApp']
  }

  if (!form.channelReferences.WhatsApp) {
    form.channelReferences.WhatsApp = referenceSource || ''
  }

  return form
}

const persistUiState = () => {
  try {
    localStorage.setItem(STORAGE_KEYS.sidebarCollapsed, String(state.isSidebarCollapsed))
    localStorage.setItem(STORAGE_KEYS.globalAiAgentEnabled, String(state.globalAiAgentEnabled))
    localStorage.setItem(STORAGE_KEYS.emsMonthFilter, state.emsMonthFilter)
    saveStoredJson(STORAGE_KEYS.emsStageOverrides, state.emsStageOverrides)
    localStorage.setItem(STORAGE_KEYS.trackingApiServiceFilter, state.trackingApiServiceFilter)
    localStorage.setItem(STORAGE_KEYS.trackingApiOriginFilter, state.trackingApiOriginFilter)
    localStorage.setItem(STORAGE_KEYS.trackingApiDestinationFilter, state.trackingApiDestinationFilter)
    if (state.activeView) {
      localStorage.setItem(STORAGE_KEYS.activeView, state.activeView)
    } else {
      localStorage.removeItem(STORAGE_KEYS.activeView)
    }
    localStorage.setItem(STORAGE_KEYS.prontsActiveColumn, state.prontsActiveColumn)
  } catch {
    // ignore storage issues
  }
}

const persistAuthState = () => {
  try {
    if (state.authToken && state.loginForm.remember) {
      localStorage.setItem(STORAGE_KEYS.authToken, state.authToken)
      if (state.authExpiresAt) {
        localStorage.setItem(STORAGE_KEYS.authExpiry, state.authExpiresAt)
      }
      localStorage.setItem(STORAGE_KEYS.rememberSession, 'true')
    } else {
      localStorage.removeItem(STORAGE_KEYS.authToken)
      localStorage.removeItem(STORAGE_KEYS.authExpiry)
      localStorage.removeItem(STORAGE_KEYS.rememberSession)
    }
  } catch {
    // ignore storage issues
  }
}

const clearSessionExpiryTimer = () => {
  if (sessionExpiryTimer) {
    clearTimeout(sessionExpiryTimer)
    sessionExpiryTimer = null
  }
}

const scheduleSessionExpiry = () => {
  clearSessionExpiryTimer()

  if (!state.authToken || !state.loginForm.remember || !state.authExpiresAt) {
    return
  }

  const remainingMs = new Date(state.authExpiresAt).getTime() - Date.now()

  if (remainingMs <= 0) {
    clearSession()
    state.loginError = 'La sesion recordada vencio a las 00:00. Inicia sesion nuevamente.'
    renderApp()
    return
  }

  sessionExpiryTimer = setTimeout(() => {
    void logout(true)
  }, remainingMs)
}

const authFetch = async (
  input: RequestInfo | URL,
  init: RequestInit & { timeoutMs?: number } = {},
) => {
  const headers = new Headers(init.headers ?? {})
  const timeoutMs = Number.isFinite(init.timeoutMs) ? Math.max(1000, Number(init.timeoutMs)) : 15000
  const abortController = new AbortController()
  const timeoutId = setTimeout(() => abortController.abort(), timeoutMs)

  if (state.authToken) {
    headers.set('Authorization', `Bearer ${state.authToken}`)
  }

  const requestTarget =
    typeof input === 'string' && input.startsWith('/')
      ? `${API_BASE}${input}`
      : input instanceof URL && input.pathname.startsWith('/')
        ? new URL(`${API_BASE}${input.pathname}${input.search}`)
        : input

  try {
    return await fetch(requestTarget, {
      ...init,
      cache: 'no-store',
      headers,
      signal: abortController.signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('La consulta tardo demasiado. Intenta nuevamente en unos segundos.')
    }

    throw error
  } finally {
    clearTimeout(timeoutId)
  }
}

const getApiUrl = (path: string) => `${API_BASE}${path}`

const parseApiPayload = async (response: Response) => {
  const contentType = response.headers.get('content-type') ?? ''
  const raw = await response.text()

  if (!raw) {
    return null
  }

  if (!contentType.includes('application/json')) {
    if (raw.startsWith('<!DOCTYPE') || raw.startsWith('<html')) {
      throw new Error(
        'La API no respondio correctamente. Inicia tambien el backend, revisa `VITE_API_URL` o sirve el build desde `server/index.js`.',
      )
    }

    throw new Error('La respuesta del servidor no tiene formato JSON valido.')
  }

  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    throw new Error('La respuesta del servidor no pudo interpretarse.')
  }
}

const getStatusClass = (status: string) => {
  if (status === 'Activo' || status === 'Entregado') return 'badge badge-success'
  if (status === 'Propuesta') return 'badge badge-warning'
  if (status === 'En seguimiento') return 'badge badge-info'
  return 'badge'
}

const getEmsStatusKey = (contact: Contact): Exclude<EmsStatusFilter, 'all'> => {
  const latestMessage = String(contact.lastMessageText ?? '').trim().toLowerCase()
  const normalizedContactStatus = String(contact.status ?? '').trim().toLowerCase()

  if (normalizedContactStatus === 'cartero' || normalizedContactStatus.includes('reparto')) {
    return 'courier'
  }

  if (normalizedContactStatus === 'recibido destino' || normalizedContactStatus === 'recibido regional') {
    return 'regional'
  }

  if (
    latestMessage.includes('cartero') ||
    latestMessage.includes('en reparto') ||
    latestMessage.includes('reparto') ||
    latestMessage.includes('distribucion') ||
    latestMessage.includes('distribución')
  ) {
    return 'courier'
  }

  if (
    latestMessage.includes('sucursal de destino') ||
    latestMessage.includes('pasar a recoger') ||
    latestMessage.includes('recoger su paquete') ||
    latestMessage.includes('recibido en nuestra sucursal de destino')
  ) {
    return 'regional'
  }

  if (
    latestMessage.includes('sucursal de origen') ||
    latestMessage.includes('recibido en nuestra sucursal de origen') ||
    latestMessage.includes('fue recibido en nuestra sucursal de origen')
  ) {
    return 'received'
  }

  if (
    latestMessage.includes('fue recibido') &&
    !latestMessage.includes('entregado') &&
    !latestMessage.includes('confirmada la entrega')
  ) {
    return 'received'
  }

  if (
    latestMessage.includes('cancel') ||
    latestMessage.includes('anul') ||
    latestMessage.includes('rechaz') ||
    normalizedContactStatus.includes('cancel') ||
    normalizedContactStatus.includes('anul')
  ) {
    return 'cancelled'
  }

  if (
    normalizedContactStatus === 'activo' ||
    normalizedContactStatus === 'entregado' ||
    normalizedContactStatus.includes('entregado')
  ) {
    return 'delivered'
  }

  if (
    contact.status === 'Nuevo' &&
    (latestMessage.includes('regional') || latestMessage.includes('recibido en la regional'))
  ) {
    return 'regional'
  }

  if (contact.status === 'Nuevo') return 'received'
  if (contact.status === 'En seguimiento') return 'transit'
  if (contact.status === 'Propuesta') return 'transit'
  if (contact.status === 'Cancelado') return 'cancelled'
  if (contact.status === 'Activo' || contact.status === 'Entregado') return 'delivered'
  return isContactConnected(contact) ? 'transit' : 'received'
}

const getEmsStatusLabel = (status: Exclude<EmsStatusFilter, 'all'>) => {
  if (status === 'received') return 'Recibido Origen'
  if (status === 'transit') return 'En Camino'
  if (status === 'regional') return 'Recibido Destino'
  if (status === 'courier') return 'Cartero'
  if (status === 'cancelled') return 'Cancelado'
  return 'Entregado'
}

const isNewChatContact = (contact: Contact) => String(contact.status ?? '').trim().toLowerCase() === 'nuevo'

const getChatStatusLabel = (contact: Contact) => {
  if (isNewChatContact(contact)) {
    return 'Nuevo'
  }

  return getEmsStatusLabel(getEmsStatusKey(contact))
}

const getChatPhaseLabel = (contact: Contact) => {
  if (isNewChatContact(contact)) {
    return 'Nuevo'
  }

  return getEmsPhaseLabel(contact)
}

const getChatPhaseDescription = (contact: Contact) => {
  if (isNewChatContact(contact)) {
    return 'Contacto sin paquete registrado todavía.'
  }

  return getEmsPhaseDescription(contact)
}

const getEmsStatusToneClass = (status: Exclude<EmsStatusFilter, 'all'>) => {
  if (status === 'received') return 'is-received'
  if (status === 'regional') return 'is-regional'
  if (status === 'transit') return 'is-transit'
  if (status === 'cancelled') return 'is-cancelled'
  return 'is-delivered'
}

const getEmsPhaseLabel = (contact: Contact) => {
  const statusKey = getEmsStatusKey(contact)
  if (statusKey === 'received') return 'Fase 1 (Recibido Origen)'
  if (statusKey === 'transit') return 'Fase 2 (En Camino)'
  if (statusKey === 'regional') return 'Fase 3 (Recibido Destino)'
  if (statusKey === 'courier') return 'Fase 4 (Cartero)'
  if (statusKey === 'delivered') return 'Fase 5 (Entregado)'
  if (statusKey === 'cancelled') return 'Fase 6 (Cancelado)'
  return 'Fase 5 (Entregado)'
}

const getEmsPhaseDescription = (contact: Contact) => {
  const statusKey = getEmsStatusKey(contact)
  if (statusKey === 'received') {
    return 'Validando factura comercial y declaraciÃ³n CN22 para despacho.'
  }
  if (statusKey === 'regional') {
    return 'Paquete recibido en la regional y en espera del siguiente movimiento operativo.'
  }
  if (statusKey === 'courier') {
    return 'Paquete asignado a distribución y en proceso de entrega al destinatario.'
  }
  if (statusKey === 'cancelled') {
    return 'Envio cancelado o anulado. No continuara su flujo operativo.'
  }
  if (statusKey === 'transit') {
    return 'Monitoreando trÃ¡nsito, guÃ­a y seguimiento operativo del paquete.'
  }
  return 'Confirmando entrega, cierre de caso y satisfacciÃ³n del cliente.'
}

const getWhatsAppReference = (contact: Contact) =>
  contact.socialProfiles?.find((profile) => profile.channel === 'WhatsApp')?.reference ?? ''

const hasWhatsAppChannel = (contact: Contact) =>
  contact.socialProfiles?.some((profile) => profile.channel === 'WhatsApp') ?? false

const getWhatsAppNumberCandidates = (value: unknown) => {
  const digits = normalizePhoneDigits(value)
  if (!digits) return []

  const candidates = new Set([digits])

  if (digits.length === 8) {
    candidates.add(`591${digits}`)
  }

  if (digits.length === 11 && digits.startsWith('591')) {
    candidates.add(digits.slice(3))
  }

  return [...candidates]
}

const isContactConnected = (contact: Contact) =>
  Boolean(contact.whatsappConnection?.isConnected)

const getContactConnectionLabel = (contact: Contact) =>
  isContactConnected(contact) ? 'Conectado' : 'Sin conectar'

const getContactConnectionClass = (contact: Contact) =>
  isContactConnected(contact) ? 'is-connected' : 'is-disconnected'

const getAttachmentKindLabel = (mimeType: string) => {
  if (mimeType.startsWith('image/')) {
    return 'Imagen'
  }

  if (mimeType.startsWith('audio/')) {
    return 'Audio'
  }

  return 'Archivo'
}

const getConversationMediaUrl = (mediaUrl: string | null) => {
  if (!mediaUrl) {
    return ''
  }

  return mediaUrl.startsWith('http') ? mediaUrl : getApiUrl(mediaUrl)
}

const EXPANDABLE_MESSAGE_PREVIEW_LENGTH = 180

const renderExpandableConversationText = (
  messageId: number,
  messageBody: string,
  className = 'conversation-message-body',
) => {
  if (!messageBody) {
    return ''
  }

  const isExpanded = state.expandedConversationMessageIds.has(messageId)
  const shouldCollapse = messageBody.length > EXPANDABLE_MESSAGE_PREVIEW_LENGTH
  const visibleText = shouldCollapse && !isExpanded
    ? `${messageBody.slice(0, EXPANDABLE_MESSAGE_PREVIEW_LENGTH).trimEnd()}...`
    : messageBody

  return `
    <div class="conversation-message-copy">
      <p class="${className}">${escapeHtml(visibleText)}</p>
      ${shouldCollapse
      ? `
            <button
              class="conversation-message-toggle"
              data-toggle-message-expand="${messageId}"
              type="button"
            >
              ${isExpanded ? 'Ver menos' : 'Ver mas'}
            </button>
          `
      : ''
    }
    </div>
  `
}

const renderConversationMessageMedia = (message: ContactConversationMessage) => {
  const mediaUrl = getConversationMediaUrl(message.mediaUrl)
  const mediaKind = message.mediaKind || ''
  const messageBody = message.message.trim()
  const isMarkerOnly = ['[image]', '[audio]', '[media]'].includes(messageBody.toLowerCase())
  const messageCopy = renderExpandableConversationText(message.id, messageBody)

  if (!mediaUrl) {
    return messageCopy
  }

  if (mediaKind === 'image') {
    return `
      <div class="conversation-media conversation-media-image">
        <a href="${escapeHtml(mediaUrl)}" target="_blank" rel="noreferrer">
          <img src="${escapeHtml(mediaUrl)}" alt="${escapeHtml(message.mediaFilename || 'Imagen adjunta')}" loading="lazy" />
        </a>
      </div>
      ${!isMarkerOnly ? messageCopy : ''}
    `
  }

  if (mediaKind === 'audio') {
    return `
      <div class="conversation-media conversation-media-audio">
        <audio controls preload="none" src="${escapeHtml(mediaUrl)}"></audio>
      </div>
    `
  }

  return `
    <div class="conversation-media conversation-media-file">
      <a href="${escapeHtml(mediaUrl)}" target="_blank" rel="noreferrer">Abrir adjunto</a>
    </div>
    ${messageCopy}
  `
}

const toggleConversationMessageExpansion = (messageId: number) => {
  const scrollSnapshot = captureConversationThreadScrollState()

  if (state.expandedConversationMessageIds.has(messageId)) {
    state.expandedConversationMessageIds.delete(messageId)
  } else {
    state.expandedConversationMessageIds.add(messageId)
  }

  renderApp()
  restoreConversationThreadScrollState(scrollSnapshot)
}

const syncWhatsAppConfigFromDashboard = (data: DashboardData | null) => {
  const config = data?.channelConfig?.whatsapp

  if (!config) {
    state.whatsappConfigForm = defaultWhatsAppConfigForm()
    state.whatsappTestModeEnabled = true
    state.whatsappTestModeNumber = normalizeBoliviaTestPhoneDigits(DEFAULT_WHATSAPP_TEST_NUMBER)
    state.whatsappTestModeNumbers = [normalizeBoliviaTestPhoneDigits(DEFAULT_WHATSAPP_TEST_NUMBER)]
    state.whatsappTestModeState = 'idle'
    state.whatsappTestNumbersState = 'idle'
    state.whatsappTestNumbersError = null
    return
  }

  state.whatsappConfigForm = {
    accessToken: '',
    phoneNumberId: config.phoneNumberId || '',
    businessAccountId: config.businessAccountId || '',
    apiVersion: config.apiVersion || 'v23.0',
    senderNumber: config.senderNumber || '+59169670289',
    webhookVerifyToken: config.webhookVerifyToken || '',
  }
  state.whatsappTestModeEnabled = Boolean(config.testModeEnabled)
  state.whatsappTestModeNumbers =
    (Array.isArray(config.testModeNumbers) ? config.testModeNumbers : [config.testModeNumber])
      .map((value) => normalizeBoliviaTestPhoneDigits(value))
      .filter(Boolean)
  state.whatsappTestModeNumber =
    state.whatsappTestModeNumbers[0] || normalizeBoliviaTestPhoneDigits(DEFAULT_WHATSAPP_TEST_NUMBER)
  state.whatsappTestModeState = 'idle'
  state.whatsappTestNumbersState = 'idle'
  state.whatsappTestNumbersError = null
}

const syncProntsConfigFromDashboard = (data: DashboardData | null) => {
  const defaults = createDefaultProntsConfigs()
  const nextConfig = data?.prontsConfig
  const customColumns = data?.pipelineConfig?.customColumns ?? state.pipelineConfig.customColumns
  const customConfigs = Object.fromEntries(
    customColumns.map((column) => {
      const savedConfig = nextConfig?.[column.id]
      const presetKey = savedConfig?.presetKey ?? 'received'

      return [
        column.id,
        {
          ...createProntsConfigFromPreset(presetKey, {
            sampleContactId: null,
          }),
          ...(savedConfig ?? {}),
          presetKey,
        },
      ]
    }),
  )

  state.prontsConfigs = {
    ...defaults,
    ...(nextConfig ?? {}),
    ...customConfigs,
  }
  state.prontsConfigState = 'idle'
  state.prontsConfigError = null

  if (!state.prontsConfigs[state.prontsActiveColumn]) {
    state.prontsActiveColumn = 'received'
  }
}

const syncPipelineConfigFromDashboard = (data: DashboardData | null) => {
  const defaults = createDefaultPipelineConfig()
  const nextConfig = data?.pipelineConfig

  state.pipelineConfig = {
    columns: {
      received: {
        ...defaults.columns.received,
        ...(nextConfig?.columns?.received ?? {}),
        allowedStates: normalizeAllowedStates(
          nextConfig?.columns?.received?.allowedStates ?? defaults.columns.received.allowedStates,
          defaults.columns.received.allowedStates,
        ),
      },
      transit: {
        ...defaults.columns.transit,
        ...(nextConfig?.columns?.transit ?? {}),
        allowedStates: normalizeAllowedStates(
          nextConfig?.columns?.transit?.allowedStates ?? defaults.columns.transit.allowedStates,
          defaults.columns.transit.allowedStates,
        ),
      },
      regional: {
        ...defaults.columns.regional,
        ...(nextConfig?.columns?.regional ?? {}),
        allowedStates: normalizeAllowedStates(
          nextConfig?.columns?.regional?.allowedStates ?? defaults.columns.regional.allowedStates,
          defaults.columns.regional.allowedStates,
        ),
      },
      courier: {
        ...defaults.columns.courier,
        ...(nextConfig?.columns?.courier ?? {}),
        allowedStates: normalizeAllowedStates(
          nextConfig?.columns?.courier?.allowedStates ?? defaults.columns.courier.allowedStates,
          defaults.columns.courier.allowedStates,
        ),
      },
      delivered: {
        ...defaults.columns.delivered,
        ...(nextConfig?.columns?.delivered ?? {}),
        allowedStates: normalizeAllowedStates(
          nextConfig?.columns?.delivered?.allowedStates ?? defaults.columns.delivered.allowedStates,
          defaults.columns.delivered.allowedStates,
        ),
      },
      cancelled: {
        ...defaults.columns.cancelled,
        ...(nextConfig?.columns?.cancelled ?? {}),
        allowedStates: normalizeAllowedStates(
          nextConfig?.columns?.cancelled?.allowedStates ?? defaults.columns.cancelled.allowedStates,
          defaults.columns.cancelled.allowedStates,
        ),
      },
    },
    customColumns: Array.isArray(nextConfig?.customColumns)
      ? nextConfig.customColumns
        .map((column) => ({
          id: String(column?.id || '').trim(),
          title: String(column?.title || '').trim(),
          helper: String(column?.helper || '').trim(),
          allowedStates: normalizeAllowedStates(column?.allowedStates ?? [], []),
        }))
        .filter((column) => column.id && column.title)
      : [],
  }
  state.pipelineConfigState = 'idle'
  state.pipelineConfigError = null
  state.customEmsColumnDraftName = ''
  state.customEmsColumnDraftHelper = ''
}

const syncEmsStageOverridesFromDashboard = (data: DashboardData | null) => {
  const overrides = data?.emsStageOverrides ?? {}
  state.emsStageOverrides = Object.fromEntries(
    Object.entries(overrides)
      .map(([packageCode, stage]) => [String(packageCode).trim().toUpperCase(), String(stage).trim().toLowerCase()])
      .filter(([packageCode, stage]) => Boolean(packageCode) && ['received', 'transit', 'regional', 'courier', 'delivered', 'cancelled'].includes(stage)),
  ) as EmsStageOverrideMap
  saveStoredJson(STORAGE_KEYS.emsStageOverrides, state.emsStageOverrides)
}

const setPipelineColumnConfig = (column: EmsColumnKey, nextConfig: Partial<PipelineColumnConfig>) => {
  state.pipelineConfig = {
    ...state.pipelineConfig,
    columns: {
      ...state.pipelineConfig.columns,
      [column]: {
        ...state.pipelineConfig.columns[column],
        ...nextConfig,
      },
    },
  }
}

const addCustomPipelineColumn = (title: string, helper: string) => {
  const normalizedTitle = title.trim()
  const normalizedHelper = helper.trim()

  if (!normalizedTitle) {
    state.pipelineConfigError = 'Escribe un nombre para el nuevo estado.'
    return false
  }

  const baseIds = ['received', 'transit', 'regional', 'courier', 'delivered', 'cancelled']
  const nextIdBase = normalizedTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const nextId = nextIdBase || `custom-${state.pipelineConfig.customColumns.length + 1}`
  const alreadyExists =
    baseIds.includes(nextId) ||
    state.pipelineConfig.customColumns.some(
      (column) =>
        column.id === nextId || column.title.toLowerCase() === normalizedTitle.toLowerCase(),
    )

  if (alreadyExists) {
    state.pipelineConfigError = 'Ya existe una columna con ese nombre.'
    return false
  }

  state.pipelineConfig = {
    ...state.pipelineConfig,
    customColumns: [
      ...state.pipelineConfig.customColumns,
      {
        id: nextId,
        title: normalizedTitle,
        helper: normalizedHelper || 'Columna personalizada del flujo EMS',
      },
    ],
  }
  state.pipelineConfigError = null
  state.customEmsColumnDraftName = ''
  state.customEmsColumnDraftHelper = ''
  return nextId
}

const removeCustomPipelineColumn = (columnId: string) => {
  state.pipelineConfig = {
    ...state.pipelineConfig,
    customColumns: state.pipelineConfig.customColumns.filter((column) => column.id !== columnId),
  }
  const { [columnId]: _removedPage, ...remainingPages } = state.emsPipelineColumns
  state.emsPipelineColumns = remainingPages
  const { [columnId]: _removedConfig, ...restConfigs } = state.prontsConfigs
  state.prontsConfigs = restConfigs
  if (state.prontsActiveColumn === columnId) {
    state.prontsActiveColumn = 'received'
  }
  state.pipelineConfigError = null
}

const getFilteredContacts = () => {
  const contacts = state.data?.contacts ?? []

  return contacts.filter((contact) => {
    const query = state.searchQuery.trim().toLowerCase()
    const matchesQuery =
      query.length === 0 ||
      contact.name.toLowerCase().includes(query) ||
      contact.company.toLowerCase().includes(query) ||
      contact.channel.toLowerCase().includes(query) ||
      contact.owner.toLowerCase().includes(query)

    const matchesSegment =
      state.segmentFilter === 'Todos' || contact.segment === state.segmentFilter
    const matchesStatus = state.statusFilter === 'Todos' || contact.status === state.statusFilter

    return matchesQuery && matchesSegment && matchesStatus
  })
}

const getContactsPagination = () => {
  const items = getFilteredContacts()
  const totalItems = items.length
  const totalPages = Math.max(1, Math.ceil(totalItems / CONTACT_LIST_PAGE_SIZE))
  const currentPage = Math.min(Math.max(state.contactListPage, 1), totalPages)
  const startIndex = (currentPage - 1) * CONTACT_LIST_PAGE_SIZE

  return {
    items: items.slice(startIndex, startIndex + CONTACT_LIST_PAGE_SIZE),
    currentPage,
    totalPages,
    totalItems,
    pageSize: CONTACT_LIST_PAGE_SIZE,
  }
}

const getContactPreviewLine = (contact: Contact) => {
  const pieces = [contact.company, getWhatsAppReference(contact)].filter((value) => value && value.trim().length > 0)
  return pieces.length > 0 ? pieces.join(' · ') : 'Sin referencia disponible'
}

const getContactLastMessagePreview = (contact: Contact) => {
  const lastMessage = String(contact.lastMessageText ?? '').trim()

  if (lastMessage) {
    const direction = String(contact.lastMessageDirection ?? '').trim().toLowerCase()
    const prefix = direction === 'outbound' ? 'Tú: ' : direction === 'inbound' ? 'Cliente: ' : ''
    return truncateText(`${prefix}${lastMessage}`, 88)
  }

  const statusKey = getEmsStatusKey(contact)
  if (statusKey === 'received') return 'Sin mensajes recientes'
  if (statusKey === 'transit') return 'Sin mensajes recientes'
  return 'Sin mensajes recientes'
}

const getContactReminderState = (contact: Contact) => {
  const lastMessage = String(contact.lastMessageText ?? '').trim()
  const lastDirection = String(contact.lastMessageDirection ?? '').trim().toLowerCase()
  const pending = lastDirection === 'outbound' && lastMessage.length > 0
  const lastMessageAt = String(contact.lastMessageAt ?? '').trim()

  if (!pending) {
    return {
      active: false,
      label: 'Sin recordatorio',
      note: 'Esperando un nuevo mensaje para activar seguimiento.',
      timestamp: '',
      preview: '',
    }
  }

  return {
    active: true,
    label: 'Recordatorio pendiente',
    note: truncateText(lastMessage, 96),
    timestamp: lastMessageAt ? formatConversationTimestamp(lastMessageAt) : 'Sin hora',
    preview: lastMessage,
  }
}

const buildMessageNotificationKey = (contactId: number, timestamp: string, preview: string) =>
  `${contactId}|${timestamp}|${preview}`

const ensureMessageNotificationAudioContext = () => {
  if (typeof window === 'undefined') {
    return null
  }

  if (messageNotificationAudioContext) {
    return messageNotificationAudioContext
  }

  const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext

  if (!AudioContextCtor) {
    return null
  }

  try {
    messageNotificationAudioContext = new AudioContextCtor()
    return messageNotificationAudioContext
  } catch {
    return null
  }
}

const playMessageNotificationTone = () => {
  if (!messageNotificationToneUnlocked) {
    return
  }

  const audioContext = ensureMessageNotificationAudioContext()
  if (!audioContext) {
    return
  }

  try {
    const now = audioContext.currentTime
    const oscillator = audioContext.createOscillator()
    const gainNode = audioContext.createGain()

    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(880, now)
    oscillator.frequency.exponentialRampToValueAtTime(740, now + 0.16)

    gainNode.gain.setValueAtTime(0.0001, now)
    gainNode.gain.exponentialRampToValueAtTime(0.16, now + 0.02)
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.2)

    oscillator.connect(gainNode)
    gainNode.connect(audioContext.destination)
    oscillator.start(now)
    oscillator.stop(now + 0.22)
    oscillator.onended = () => {
      gainNode.disconnect()
      oscillator.disconnect()
    }
  } catch {
    // If the browser blocks audio, the visual toast still appears.
  }
}

const showBrowserMessageNotification = (notification: MessageNotification) => {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') {
    return
  }

  if (Notification.permission !== 'granted') {
    return
  }

  try {
    const browserNotification = new Notification(notification.contactName, {
      body: notification.preview,
      icon: notification.contactAvatar || '/default-avatar.png', // Muestra la foto de Quique o una por defecto
      tag: `crm-message-${notification.contactId}`,
      renotify: true, // Reemplaza la notificación previa del mismo contacto sin acumular estáticas
      silent: true,
      data: {
        url: `/chat/${notification.contactId}` // Guarda la ruta para redirigir al hacer clic
      }
    });

    browserNotification.onclick = () => {
      window.focus()
      openConversationModal(notification.contactId)
      browserNotification.close()
    }

    window.setTimeout(() => {
      browserNotification.close()
    }, MESSAGE_NOTIFICATION_DURATION_MS)
  } catch {
    // Si el navegador no permite notificaciones nativas, el toast interno sigue visible.
  }
}

const dismissMessageNotification = (notificationId: string) => {
  const existingTimer = messageNotificationCleanupTimers.get(notificationId)
  if (existingTimer) {
    clearTimeout(existingTimer)
    messageNotificationCleanupTimers.delete(notificationId)
  }

  const nextNotifications = state.messageNotifications.filter((item) => item.id !== notificationId)
  if (nextNotifications.length === state.messageNotifications.length) {
    return
  }

  state.messageNotifications = nextNotifications
  renderApp()
}

const enqueueMessageNotification = (payload: {
  contactId: number
  contactName: string
  preview: string
  timestamp: string
}) => {
  const preview = truncateText(String(payload.preview ?? '').replace(/\s+/g, ' ').trim(), 96)
  const normalizedTimestamp = String(payload.timestamp ?? '').trim()
  const displayTimestamp = normalizedTimestamp ? formatConversationTimestamp(normalizedTimestamp) : ''
  const notificationKey = buildMessageNotificationKey(payload.contactId, normalizedTimestamp, preview)

  if (!preview || seenMessageNotificationKeys.has(notificationKey)) {
    return
  }

  seenMessageNotificationKeys.add(notificationKey)
  if (seenMessageNotificationKeys.size > 200) {
    seenMessageNotificationKeys.clear()
  }

  const notification: MessageNotification = {
    id: `message-notification-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    contactId: payload.contactId,
    contactName: payload.contactName,
    preview,
    timestamp: displayTimestamp,
    createdAt: new Date().toISOString(),
  }

  state.messageNotifications = [notification, ...state.messageNotifications].slice(0, 3)
  renderApp()
  playMessageNotificationTone()
  showBrowserMessageNotification(notification)

  const cleanupTimer = setTimeout(() => {
    dismissMessageNotification(notification.id)
  }, MESSAGE_NOTIFICATION_DURATION_MS)

  messageNotificationCleanupTimers.set(notification.id, cleanupTimer)
}

const maybeNotifyIncomingMessage = (
  previousSnapshot: { lastMessageAt?: string | null; lastMessageText?: string | null } | null,
  nextContact: Contact,
  nextLatestMessage: { direction: string; message: string; createdAt: string } | null,
) => {
  if (!nextLatestMessage) {
    return
  }

  const nextDirection = String(nextLatestMessage.direction ?? '').trim().toLowerCase()
  const nextMessage = String(nextLatestMessage.message ?? '').trim()
  const nextTimestamp = String(nextLatestMessage.createdAt ?? '').trim()

  if (nextDirection !== 'inbound' || !nextMessage || !nextTimestamp) {
    return
  }

  const previousTimestamp = String(previousSnapshot?.lastMessageAt ?? '').trim()
  const previousMessage = String(previousSnapshot?.lastMessageText ?? '').trim()

  if (previousTimestamp === nextTimestamp && previousMessage === nextMessage) {
    return
  }

  enqueueMessageNotification({
    contactId: nextContact.id,
    contactName: nextContact.name || 'Contacto',
    preview: nextMessage,
    timestamp: nextTimestamp,
  })
}

const getEmsStatusContacts = () => {
  const contacts = getChatContacts()
  const buckets = createEmsStageBuckets(
    contacts.map((contact) => ({
      ...contact,
      stage: getEmsStatusKey(contact),
    })),
  )
  return {
    all: contacts,
    received: buckets.received,
    regional: buckets.regional,
    transit: buckets.transit,
    delivered: buckets.delivered,
    courier: buckets.courier,
    cancelled: buckets.cancelled,
  }
}

const getEmsApiContactTimestamp = (value: unknown) => {
  const normalized = normalizeReference(value)
  const parsed = Date.parse(normalized)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString()
}

const getEffectiveTrackingApiPackages = () =>
  state.trackingApiCatalogPackages.length > 0 ? state.trackingApiCatalogPackages : state.trackingApiPackages

const getEffectiveContactPackages = () =>
  state.contactPackagesCatalog.length > 0 ? state.contactPackagesCatalog : state.contactPackages

const getEmsMonthKeyFromValue = (value: unknown) => {
  const normalized = normalizeReference(value)
  if (!normalized) return ''

  const parsed = Date.parse(normalized)
  if (!Number.isFinite(parsed)) return ''

  const date = new Date(parsed)
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

const formatEmsMonthLabel = (monthKey: string) => {
  if (!monthKey || monthKey === 'all') {
    return 'Todos los meses'
  }

  const [yearPart, monthPart] = monthKey.split('-')
  const year = Number(yearPart)
  const month = Number(monthPart)

  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return monthKey
  }

  const date = new Date(Date.UTC(year, month - 1, 1))
  return new Intl.DateTimeFormat('es-BO', {
    month: 'long',
    year: 'numeric',
    timeZone: 'America/La_Paz',
  }).format(date)
}

const getEmsMonthOptions = () => {
  if (state.emsMonthOptions.length > 0) {
    return state.emsMonthOptions
  }

  const trackingItems = getEffectiveTrackingApiPackages().filter(isNationalTrackingPackage)
  const contactItems = getEffectiveContactPackages().filter(isNationalContactPackage)
  const monthMap = new Map<string, number>()

  const registerMonth = (value: unknown) => {
    const key = getEmsMonthKeyFromValue(value)
    if (!key) return
    monthMap.set(key, (monthMap.get(key) ?? 0) + 1)
  }

  trackingItems.forEach((item) => registerMonth(item?.fecha_registro || item?.eventos?.[0]?.fecha))
  contactItems.forEach((item) => registerMonth(item?.fecha_registro))

  return [...monthMap.entries()]
    .sort((first, second) => second[0].localeCompare(first[0]))
    .map(([value, count]) => ({
      value,
      label: `${formatEmsMonthLabel(value)} (${count})`,
    }))
}

const buildEmsApiContact = (
  id: number,
  name: string,
  company: string,
  status: string,
  updatedAt: string,
  lastMessageText: string,
  reference: string,
): Contact =>
  ({
    id,
    name,
    company,
    channel: 'API',
    socialProfiles: reference ? [{ channel: 'EMS', reference }] : [],
    segment: 'EMS API',
    owner: 'Integración',
    status,
    score: 80,
    updatedAt,
    lastMessageText,
    lastMessageDirection: 'outbound',
    whatsappConnection: {
      isConnected: false,
      lastActivityAt: updatedAt,
      lastInboundAt: null,
    },
  }) as Contact

const createEmsStageBuckets = <T extends { stage: EmsColumnKey }>(items: T[]) => {
  const buckets: Record<
    'all' | 'received' | 'transit' | 'regional' | 'courier' | 'delivered' | 'cancelled',
    T[]
  > = {
    all: [],
    received: [],
    transit: [],
    regional: [],
    courier: [],
    delivered: [],
    cancelled: [],
  }

  for (const item of items) {
    buckets.all.push(item)
    buckets[item.stage]?.push(item)
  }

  return buckets
}

const getEmsApiStatusContacts = () => {
  const trackingItems = getTrackingApiSourcePackages().filter(isNationalTrackingPackage)
  const contactItems = getEffectiveContactPackages().filter(isNationalContactPackage)

  const received = trackingItems
    .filter((item) => getTrackingPipelineStage(item) === 'received')
    .map((item, index) => {
      const code = normalizeReference(item?.codigo_s10) || normalizeReference(item?.codigo) || `TR-${index + 1}`
      const status = normalizeReference(item?.estado?.nombre) || normalizeReference(item?.estado_postal) || 'Recibido Origen'
      const reference = code
      return buildEmsApiContact(
        1000000 + index,
        `Tracking ${code}`,
        getTrackingDestinationPhoneValue(item) || getTrackingOriginPhoneValue(item) || 'Sin referencia',
        'Nuevo',
        getEmsApiContactTimestamp(item?.fecha_registro || item?.eventos?.[0]?.fecha),
        status,
        reference,
      )
    })
    .concat(
      contactItems
        .filter((item) => getContactPackagePipelineStage(item) === 'received')
        .map((item, index) => {
          const code = normalizeReference(item?.codigo) || `CP-R-${index + 1}`
          const status = normalizeReference(getContactPackageEstado(item)) || 'Recibido Origen'
          const name = getContactPackageDestinatarioName(item) || `Paquete ${code}`
          const company = getContactPackageRemitenteName(item) || getContactPackageRemitentePhone(item) || 'Paquetes-Contactos'
          return buildEmsApiContact(
            2000000 + index,
            name,
            company,
            'Nuevo',
            getEmsApiContactTimestamp(item?.fecha_registro),
            status,
            code,
          )
        }),
    )

  const transit = trackingItems
    .filter((item) => getTrackingPipelineStage(item) === 'transit')
    .map((item, index) => {
      const code = normalizeReference(item?.codigo_s10) || normalizeReference(item?.codigo) || `TR-T-${index + 1}`
      const status = normalizeReference(item?.estado?.nombre) || normalizeReference(item?.estado_postal) || 'En Camino'
      return buildEmsApiContact(
        1100000 + index,
        `Tracking ${code}`,
        getTrackingDestinationPhoneValue(item) || getTrackingOriginPhoneValue(item) || 'Sin referencia',
        'En seguimiento',
        getEmsApiContactTimestamp(item?.fecha_registro || item?.eventos?.[0]?.fecha),
        status,
        code,
      )
    })
    .concat(
      contactItems
        .filter((item) => getContactPackagePipelineStage(item) === 'transit')
        .map((item, index) => {
          const code = normalizeReference(item?.codigo) || `CP-T-${index + 1}`
          return buildEmsApiContact(
            2100000 + index,
            getContactPackageDestinatarioName(item) || `Paquete ${code}`,
            getContactPackageRemitenteName(item) || getContactPackageRemitentePhone(item) || 'Paquetes-Contactos',
            'En seguimiento',
            getEmsApiContactTimestamp(item?.fecha_registro),
            normalizeReference(getContactPackageEstado(item)) || 'En Camino',
            code,
          )
        }),
    )

  const regional = trackingItems
    .filter((item) => getTrackingPipelineStage(item) === 'regional')
    .map((item, index) => {
      const code = normalizeReference(item?.codigo_s10) || normalizeReference(item?.codigo) || `TR-R-${index + 1}`
      return buildEmsApiContact(
        1200000 + index,
        `Tracking ${code}`,
        getTrackingDestinationPhoneValue(item) || getTrackingOriginPhoneValue(item) || 'Sin referencia',
        'Recibido Destino',
        getEmsApiContactTimestamp(item?.fecha_registro || item?.eventos?.[0]?.fecha),
        normalizeReference(item?.estado?.nombre) || normalizeReference(item?.estado_postal) || 'Recibido Destino',
        code,
      )
    })
    .concat(
      contactItems
        .filter((item) => getContactPackagePipelineStage(item) === 'regional')
        .map((item, index) => {
          const code = normalizeReference(item?.codigo) || `CP-RG-${index + 1}`
          return buildEmsApiContact(
            2200000 + index,
            getContactPackageDestinatarioName(item) || `Paquete ${code}`,
            getContactPackageRemitenteName(item) || getContactPackageRemitentePhone(item) || 'Paquetes-Contactos',
            'Recibido Destino',
            getEmsApiContactTimestamp(item?.fecha_registro),
            normalizeReference(getContactPackageEstado(item)) || 'Recibido Destino',
            code,
          )
        }),
    )

  const courier = trackingItems
    .filter((item) => getTrackingPipelineStage(item) === 'courier')
    .map((item, index) => {
      const code = normalizeReference(item?.codigo_s10) || normalizeReference(item?.codigo) || `TR-C-${index + 1}`
      return buildEmsApiContact(
        1300000 + index,
        `Tracking ${code}`,
        getTrackingDestinationPhoneValue(item) || getTrackingOriginPhoneValue(item) || 'Sin referencia',
        'Cartero',
        getEmsApiContactTimestamp(item?.fecha_registro || item?.eventos?.[0]?.fecha),
        normalizeReference(item?.estado?.nombre) || normalizeReference(item?.estado_postal) || 'Cartero',
        code,
      )
    })
    .concat(
      contactItems
        .filter((item) => getContactPackagePipelineStage(item) === 'courier')
        .map((item, index) => {
          const code = normalizeReference(item?.codigo) || `CP-C-${index + 1}`
          return buildEmsApiContact(
            2300000 + index,
            getContactPackageDestinatarioName(item) || `Paquete ${code}`,
            getContactPackageRemitenteName(item) || getContactPackageRemitentePhone(item) || 'Paquetes-Contactos',
            'Cartero',
            getEmsApiContactTimestamp(item?.fecha_registro),
            normalizeReference(getContactPackageEstado(item)) || 'Cartero',
            code,
          )
        }),
    )

  const delivered = trackingItems
    .filter((item) => getTrackingPipelineStage(item) === 'delivered')
    .map((item, index) => {
      const code = normalizeReference(item?.codigo_s10) || normalizeReference(item?.codigo) || `TR-D-${index + 1}`
      return buildEmsApiContact(
        1400000 + index,
        `Tracking ${code}`,
        getTrackingDestinationPhoneValue(item) || getTrackingOriginPhoneValue(item) || 'Sin referencia',
        'Entregado',
        getEmsApiContactTimestamp(item?.fecha_registro || item?.eventos?.[0]?.fecha),
        normalizeReference(item?.estado?.nombre) || normalizeReference(item?.estado_postal) || 'Entregado',
        code,
      )
    })
    .concat(
      contactItems
        .filter((item) => getContactPackagePipelineStage(item) === 'delivered')
        .map((item, index) => {
          const code = normalizeReference(item?.codigo) || `CP-D-${index + 1}`
          return buildEmsApiContact(
            2400000 + index,
            getContactPackageDestinatarioName(item) || `Paquete ${code}`,
            getContactPackageRemitenteName(item) || getContactPackageRemitentePhone(item) || 'Paquetes-Contactos',
            'Entregado',
            getEmsApiContactTimestamp(item?.fecha_registro),
            normalizeReference(getContactPackageEstado(item)) || 'Entregado',
            code,
          )
        }),
    )

  const cancelled = trackingItems
    .filter((item) => getTrackingPipelineStage(item) === 'cancelled')
    .map((item, index) => {
      const code = normalizeReference(item?.codigo_s10) || normalizeReference(item?.codigo) || `TR-X-${index + 1}`
      return buildEmsApiContact(
        1500000 + index,
        `Tracking ${code}`,
        getTrackingDestinationPhoneValue(item) || getTrackingOriginPhoneValue(item) || 'Sin referencia',
        'Cancelado',
        getEmsApiContactTimestamp(item?.fecha_registro || item?.eventos?.[0]?.fecha),
        normalizeReference(item?.estado?.nombre) || normalizeReference(item?.estado_postal) || 'Cancelado',
        code,
      )
    })
    .concat(
      contactItems
        .filter((item) => getContactPackagePipelineStage(item) === 'cancelled')
        .map((item, index) => {
          const code = normalizeReference(item?.codigo) || `CP-X-${index + 1}`
          return buildEmsApiContact(
            2500000 + index,
            getContactPackageDestinatarioName(item) || `Paquete ${code}`,
            getContactPackageRemitenteName(item) || getContactPackageRemitentePhone(item) || 'Paquetes-Contactos',
            'Cancelado',
            getEmsApiContactTimestamp(item?.fecha_registro),
            normalizeReference(getContactPackageEstado(item)) || 'Cancelado',
            code,
          )
        }),
    )

  return {
    all: [...received, ...transit, ...regional, ...courier, ...delivered, ...cancelled],
    received,
    transit,
    regional,
    courier,
    delivered,
    cancelled,
  }
}

const getEmsApiCustomColumnContacts = (columnId: string) => {
  const customColumn = state.pipelineConfig.customColumns.find((column) => column.id === columnId)
  if (!customColumn) return []

  const normalizedTitle = customColumn.title.trim().toLowerCase()
  const apiContacts = getEmsApiStatusContacts().all

  return apiContacts.filter((contact) => String(contact.status ?? '').trim().toLowerCase() === normalizedTitle)
}

const getCustomEmsColumnContacts = (columnId: string) => {
  const customColumn = state.pipelineConfig.customColumns.find((column) => column.id === columnId)
  if (!customColumn) return []

  const normalizedTitle = customColumn.title.trim().toLowerCase()
  const query = state.searchQuery.trim().toLowerCase()

  return getChatContacts().filter((contact) => {
    const matchesStatus = contact.status.trim().toLowerCase() === normalizedTitle
    if (!matchesStatus) return false

    if (!query) return true

    return (
      contact.name.toLowerCase().includes(query) ||
      contact.company.toLowerCase().includes(query) ||
      getWhatsAppReference(contact).toLowerCase().includes(query) ||
      getContactLastMessagePreview(contact).toLowerCase().includes(query)
    )
  })
}

const getEmsSearchQueryForColumn = (column: EmsColumnKey) => {
  if (column === 'received') return state.emsReceivedSearchQuery
  if (column === 'regional') return state.emsRegionalSearchQuery
  if (column === 'transit') return state.emsTransitSearchQuery
  if (column === 'courier') return state.emsCourierSearchQuery
  return state.emsDeliveredSearchQuery
}

const setEmsSearchQueryForColumn = (column: EmsColumnKey, value: string) => {
  if (column === 'received') {
    state.emsReceivedSearchQuery = value
    return
  }

  if (column === 'regional') {
    state.emsRegionalSearchQuery = value
    return
  }

  if (column === 'transit') {
    state.emsTransitSearchQuery = value
    return
  }

  if (column === 'courier') {
    state.emsCourierSearchQuery = value
    return
  }

  state.emsDeliveredSearchQuery = value
}

const EMS_PIPELINE_PAGE_SIZE = 8

const emsPipelineScopeLoadTokens = new Map<string, number>()

const getEmsPipelineScopeSearchQuery = (scope: string) =>
  scope === 'received' ||
    scope === 'regional' ||
    scope === 'transit' ||
    scope === 'courier' ||
    scope === 'delivered' ||
    scope === 'cancelled'
    ? getEmsSearchQueryForColumn(scope as EmsColumnKey)
    : ''

const getEmsPipelineScopePageState = (scope: string): EmsPipelineColumnPage => {
  return (
    state.emsPipelineColumns[scope] ?? {
      items: [],
      currentPage: 1,
      totalPages: 1,
      totalItems: 0,
      pageSize: EMS_PIPELINE_PAGE_SIZE,
      state: 'idle',
      error: null,
      syncedAt: null,
      requestSignature: null,
    }
  )
}

const getLocalEmsPipelineScopeCards = (scope: string): EmsPackageCard[] => {
  const stagedPackages = getEmsApiStatusPackages()
  const normalizedScope = scope.trim().toLowerCase()

  if (!normalizedScope || normalizedScope === 'all') {
    return stagedPackages.all ?? []
  }

  if (
    normalizedScope === 'received' ||
    normalizedScope === 'transit' ||
    normalizedScope === 'regional' ||
    normalizedScope === 'courier' ||
    normalizedScope === 'delivered' ||
    normalizedScope === 'cancelled'
  ) {
    return stagedPackages[normalizedScope] ?? []
  }

  const customColumn = state.pipelineConfig.customColumns.find(
    (column) => column.id === normalizedScope || normalizeText(column.title).trim().toLowerCase() === normalizedScope,
  )

  if (!customColumn) {
    return []
  }

  const normalizedTitle = normalizeText(customColumn.title).trim().toLowerCase()
  const allowedStates = new Set(
    normalizeAllowedStates(customColumn.allowedStates ?? [], [customColumn.title]).map((value) => value.toLowerCase()),
  )

  return (stagedPackages.all ?? []).filter((card) => {
    const normalizedStatus = normalizeText(card.status).trim().toLowerCase()
    return (
      normalizedStatus === normalizedTitle ||
      allowedStates.has(card.stage) ||
      allowedStates.has(normalizedStatus)
    )
  })
}

const getLocalEmsPipelineScopePage = async (
  scope: string,
  page: number,
  pageSize: number,
  query: string,
) => {
  await ensureApiPipelineStateSourcesLoaded()

  const normalizedQuery = query.trim().toLowerCase()
  const selectedMonth = state.emsMonthFilter.trim() || 'all'
  const sourceCards = getLocalEmsPipelineScopeCards(scope)

  const filteredCards = sourceCards.filter((card) => {
    if (selectedMonth !== 'all' && getEmsMonthKeyFromValue(card.updatedAt) !== selectedMonth) {
      return false
    }

    if (!normalizedQuery) {
      return true
    }

    return [
      card.code,
      card.title,
      card.summary,
      card.senderName,
      card.senderReference,
      card.recipientName,
      card.recipientReference,
      card.destination,
      card.status,
    ].some((value) => normalizeText(value).trim().toLowerCase().includes(normalizedQuery))
  })

  filteredCards.sort((firstCard, secondCard) => {
    const firstTime = Date.parse(firstCard.updatedAt || '')
    const secondTime = Date.parse(secondCard.updatedAt || '')

    if (Number.isFinite(firstTime) && Number.isFinite(secondTime) && firstTime !== secondTime) {
      return secondTime - firstTime
    }

    if (Number.isFinite(firstTime) && !Number.isFinite(secondTime)) {
      return -1
    }

    if (!Number.isFinite(firstTime) && Number.isFinite(secondTime)) {
      return 1
    }

    return String(firstCard.code).localeCompare(String(secondCard.code), 'es')
  })

  const totalItems = filteredCards.length
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))
  const currentPage = Math.min(Math.max(page, 1), totalPages)
  const fromIndex = (currentPage - 1) * pageSize

  return {
    items: filteredCards.slice(fromIndex, fromIndex + pageSize),
    currentPage,
    totalItems,
    totalPages,
  }
}

const getEmsPipelineScopeSignature = (scope: string, page: number, pageSize: number, query: string) =>
  [scope, state.emsMonthFilter || 'all', page, pageSize, query.trim().toLowerCase()].join('|')

void getLocalEmsPipelineScopePage

const saveEmsPipelineScopePageState = (scope: string, nextState: EmsPipelineColumnPage) => {
  state.emsPipelineColumns = {
    ...state.emsPipelineColumns,
    [scope]: nextState,
  }
}

const loadEmsPipelineScopePage = async (
  scope: string,
  page = 1,
  options: { pageSize?: number; silent?: boolean; timeoutMs?: number } = {},
) => {
  const pageSize = Math.max(1, options.pageSize ?? EMS_PIPELINE_PAGE_SIZE)
  const timeoutMs = Math.max(1000, options.timeoutMs ?? 45000)
  const query = getEmsPipelineScopeSearchQuery(scope)
  const signature = getEmsPipelineScopeSignature(scope, page, pageSize, query)
  const currentState = getEmsPipelineScopePageState(scope)
  const isSameRequest =
    currentState.requestSignature === signature &&
    currentState.state === 'idle' &&
    currentState.currentPage === page &&
    currentState.pageSize === pageSize

  if (isSameRequest) {
    return
  }

  const requestToken = (emsPipelineScopeLoadTokens.get(scope) ?? 0) + 1
  emsPipelineScopeLoadTokens.set(scope, requestToken)

  if (!options.silent) {
    saveEmsPipelineScopePageState(scope, {
      ...currentState,
      state: 'loading',
      error: null,
      requestSignature: signature,
      pageSize,
      currentPage: page,
    })
    renderApp()
  } else {
    saveEmsPipelineScopePageState(scope, {
      ...currentState,
      state: currentState.state === 'error' ? 'loading' : currentState.state,
      error: null,
      requestSignature: signature,
      pageSize,
      currentPage: page,
    })
  }

  try {
    const response = await authFetch(
      `/api/ems/pipeline?scope=${encodeURIComponent(scope)}&page=${page}&per_page=${pageSize}&month=${encodeURIComponent(
        state.emsMonthFilter || 'all',
      )}&query=${encodeURIComponent(query)}`,
      {
        timeoutMs,
      },
    )
    const payload = await parseApiPayload(response)
    const payloadAny = payload as any

    if (emsPipelineScopeLoadTokens.get(scope) !== requestToken) {
      return
    }

    if (response.status === 401) {
      clearSession()
      state.loginError = 'Tu sesion expiro. Vuelve a iniciar sesion.'
      saveEmsPipelineScopePageState(scope, {
        ...currentState,
        state: 'idle',
        error: null,
        requestSignature: signature,
        pageSize,
        currentPage: page,
      })
      renderApp()
      return
    }

    if (!response.ok) {
      throw new Error(
        (payloadAny?.message as string) ||
        (payloadAny?.error as string) ||
        'No se pudo cargar la pagina del pipeline EMS.',
      )
    }

    const pageItems = Array.isArray(payloadAny?.data) ? (payloadAny.data as EmsPackageCard[]) : []
    const paginationData = (payloadAny?.pagination ?? payloadAny?.meta ?? null) as
      | {
        page?: number
        total_pages?: number
        total_items?: number
        total?: number
        per_page?: number
      }
      | null
    const totalItems = Number(
      paginationData?.total_items ??
      paginationData?.total ??
      payloadAny?.total ??
      payloadAny?.count ??
      pageItems.length,
    )
    const totalPages = Number(
      paginationData?.total_pages ??
      payloadAny?.total_pages ??
      Math.max(1, Math.ceil((Number.isFinite(totalItems) ? totalItems : pageItems.length) / pageSize)),
    )
    const currentPage = Number(paginationData?.page ?? payloadAny?.page ?? page)

    saveEmsPipelineScopePageState(scope, {
      items: pageItems,
      currentPage: Number.isFinite(currentPage) && currentPage > 0 ? currentPage : page,
      totalPages: Number.isFinite(totalPages) && totalPages > 0 ? totalPages : 1,
      totalItems: Number.isFinite(totalItems) ? totalItems : pageItems.length,
      pageSize,
      state: 'idle',
      error: null,
      syncedAt: new Date().toISOString(),
      requestSignature: signature,
    })
  } catch (error) {
    if (emsPipelineScopeLoadTokens.get(scope) !== requestToken) {
      return
    }

    saveEmsPipelineScopePageState(scope, {
      ...currentState,
      state: 'error',
      error: error instanceof Error ? error.message : 'No se pudo cargar la pagina del pipeline EMS.',
      requestSignature: signature,
      pageSize,
      currentPage: page,
    })
  } finally {
    if (emsPipelineScopeLoadTokens.get(scope) === requestToken) {
      renderApp()
    }
  }
}

const loadEmsMonthOptions = async () => {
  try {
    const response = await authFetch('/api/ems/month-options', { timeoutMs: 45000 })
    const payload = await parseApiPayload(response)

    if (response.status === 401) {
      clearSession()
      state.loginError = 'Tu sesion expiro. Vuelve a iniciar sesion.'
      renderApp()
      return
    }

    if (!response.ok) {
      throw new Error((payload?.message as string) || (payload?.error as string) || 'No se pudieron cargar los meses del pipeline EMS.')
    }

    state.emsMonthOptions = Array.isArray(payload?.data) ? (payload.data as Array<{ value: string; label: string; count: number }>) : []
  } catch {
    state.emsMonthOptions = []
  }
}

const goToEmsPipelineScopePage = (scope: string, nextPage: number) => {
  const pagination = getEmsPipelineScopePageState(scope)
  const targetPage = Math.min(Math.max(nextPage, 1), pagination.totalPages || 1)
  void loadEmsPipelineScopePage(scope, targetPage)
}

const getEmsColumnContacts = (column: EmsColumnKey) => {
  const query = getEmsSearchQueryForColumn(column).trim().toLowerCase()

  return getChatContacts().filter((contact) => {
    if (getEmsStatusKey(contact) !== column) {
      return false
    }

    if (!query) {
      return true
    }

    return (
      contact.name.toLowerCase().includes(query) ||
      contact.company.toLowerCase().includes(query) ||
      getWhatsAppReference(contact).toLowerCase().includes(query) ||
      getContactLastMessagePreview(contact).toLowerCase().includes(query)
    )
  })
}

const getEmsStageOverride = (packageCode: string) => state.emsStageOverrides[packageCode.trim().toUpperCase()] ?? null

const setEmsStageOverride = (packageCode: string, nextStage: EmsColumnKey) => {
  state.emsStageOverrides = {
    ...state.emsStageOverrides,
    [packageCode.trim().toUpperCase()]: nextStage,
  }
  persistUiState()
}

const moveEmsPackageToStage = async (packageCode: string, nextStage: EmsColumnKey) => {
  const normalizedPackageCode = packageCode.trim().toUpperCase()
  const currentStage = getEmsStageOverride(normalizedPackageCode)
  if (currentStage === nextStage) {
    return false
  }

  try {
    const response = await authFetch('/api/ems/stage-overrides', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        packageCode: normalizedPackageCode,
        stage: nextStage,
      }),
    })

    const payload = await parseApiPayload(response)

    if (response.status === 401) {
      clearSession()
      state.loginError = 'Tu sesion expiro. Inicia sesion nuevamente.'
      renderApp()
      return false
    }

    if (!response.ok) {
      throw new Error((payload?.message as string) || (payload?.error as string) || 'No se pudo guardar el estado del paquete.')
    }

    setEmsStageOverride(normalizedPackageCode, nextStage)
    state.notice = `El paquete se movio a ${getEmsStatusLabel(nextStage)}.`
    renderApp()
    return true
  } catch (error) {
    state.notice = error instanceof Error ? error.message : 'No se pudo guardar el estado del paquete.'
    renderApp()
    return false
  }
}

const prontsPresetMeta: Record<
  ProntsPresetKey,
  {
    badge: string
    title: string
    subtitle: string
    systemLabel: string
    systemPrompt: string
    userTemplate: string
    temperature: number
    action: string
    accentClass: string
    icon: string
  }
> = {
  received: {
    badge: '1',
    title: 'Columna 1: Recibido inicial',
    subtitle: 'Validación Aduanera y CN22/CN23',
    systemLabel: 'Prompt Columna 1: Validación y Clasificación de Entrada',
    systemPrompt:
      'Eres un agente aduanero senior e IA oficial de logística internacional EMS Conversa OS. Tu misión es auditar declaraciones juradas CN22/CN23 de paquetes recibidos, verificar valores declarados, detectar posibles retenciones aduaneras por monto superior a $150 USD y validar que el destinatario tenga teléfono completo.',
    userTemplate:
      'Audita el siguiente paquete ingresado:\n- Cliente: {cliente}\n- Tracking: {tracking}\n- Destino: {destino}\n- Peso: {peso}\n- Valor declarado: {valor}\n- Estado: {estado}\n- Grupo: {grupoNombre}',
    temperature: 0.2,
    action: 'Asignar Etiqueta IA y Notificar WhatsApp',
    accentClass: 'is-received',
    icon: '??',
  },
  regional: {
    badge: '3',
    title: 'Columna 3: Recibido regional',
    subtitle: 'Recepción en Regional y Preparación Operativa',
    systemLabel: 'Prompt Columna 3: Confirmación de Recepción en Regional',
    systemPrompt:
      'Eres un coordinador logístico EMS en regional. Confirmas que el paquete ya fue recibido en la regional, explicas el estado actual con claridad y anticipas el siguiente paso operativo sin prometer fechas exactas.',
    userTemplate:
      'Genera un mensaje para un paquete recibido en regional:\n- Cliente: {cliente}\n- Tracking: {tracking}\n- Destino: {destino}\n- Peso: {peso}\n- Valor: {valor}\n- Estado: {estado}\n- Grupo: {grupoNombre}',
    temperature: 0.3,
    action: 'Asignar Etiqueta IA y Notificar WhatsApp',
    accentClass: 'is-regional',
    icon: '??',
  },
  transit: {
    badge: '2',
    title: 'Columna 2: En Camino',
    subtitle: 'ETA, Tiempos de Vuelo y Avisos',
    systemLabel: 'Prompt Columna 2: Predicción de Tránsito y ETA Vuelo',
    systemPrompt:
      'Eres un asistente inteligente de seguimiento aéreo internacional. Analizas rutas de despacho, congestiones en aeropuertos hub y notificas estimaciones de llegada ETA al cliente.',
    userTemplate:
      'Calcula la predicción de tránsito para el paquete en tránsito:\n- Guía EMS: {tracking}\n- Destinatario: {cliente}\n- Destino Final: {destino}\n- Grupo: {grupoNombre}',
    temperature: 0.4,
    action: 'Asignar Etiqueta IA y Notificar WhatsApp',
    accentClass: 'is-transit',
    icon: '??',
  },
  courier: {
    badge: '4',
    title: 'Columna 4: Cartero',
    subtitle: 'Asignación a reparto y entrega final',
    systemLabel: 'Prompt Columna 4: Aviso de Reparto',
    systemPrompt:
      'Eres un coordinador de reparto EMS. Comunicas que el paquete fue asignado al cartero y acompañas al cliente hasta la entrega, sin prometer horarios exactos.',
    userTemplate:
      'Genera una actualización para un paquete asignado a cartero:\n- Cliente: {cliente}\n- Tracking: {tracking}\n- Destino: {destino}\n- Estado: {estado}\n- Grupo: {grupoNombre}',
    temperature: 0.3,
    action: 'Notificar salida a reparto y preparar confirmación',
    accentClass: 'is-courier',
    icon: '??',
  },
  delivered: {
    badge: '4',
    title: 'Columna 4: Entregado',
    subtitle: 'CSAT, Confirmación y Acuse WA',
    systemLabel: 'Prompt Columna 3: Confirmación de Entrega y CSAT',
    systemPrompt:
      'Eres el encargado de calidad y satisfacción al cliente de Conversa OS. Verificas acuses de recibo digital, solicitas valoración de 1 a 5 estrellas y registras la entrega con éxito.',
    userTemplate:
      'Procesa la confirmación de entrega para:\n- Cliente: {cliente}\n- Guía EMS: {tracking}\n- Destino: {destino}\n- Valor: {valor}\n- Estado: {estado}\n\nGenera un mensaje de cierre amable para WhatsApp.',
    temperature: 0.5,
    action: 'Mover Automáticamente a Siguiente Estado',
    accentClass: 'is-delivered',
    icon: '?',
  },
  cancelled: {
    badge: '6',
    title: 'Columna 6: Cancelado',
    subtitle: 'Anulaciones y cierres',
    systemLabel: 'Prompt Columna 6: Cancelación y Cierre',
    systemPrompt:
      'Eres un coordinador de excepciones EMS. Informas cancelaciones, anulaciones y rechazos con tono claro y directo, sin dejar dudas sobre el estado final.',
    userTemplate:
      'Genera una actualización para un envio cancelado:\n- Cliente: {cliente}\n- Tracking: {tracking}\n- Destino: {destino}\n- Estado: {estado}\n- Grupo: {grupoNombre}',
    temperature: 0.2,
    action: 'Registrar cancelación y notificar WhatsApp',
    accentClass: 'is-cancelled',
    icon: 'X',
  },
}

const getPipelineColumnConfig = (column: ProntsColumnKey): PipelineColumnConfig => {
  const baseColumns = state.pipelineConfig?.columns ?? createDefaultPipelineConfig().columns

  if (column in baseColumns) {
    return baseColumns[column as EmsColumnKey] ?? createDefaultPipelineConfig().columns.received
  }

  const customColumn = (state.pipelineConfig?.customColumns ?? []).find((item) => item.id === column)
  return (
    customColumn ?? {
      title: 'Columna personalizada',
      helper: 'Configura una nueva etapa del pipeline',
      allowedStates: [],
    }
  )
}

const getProntsColumnKeys = (): ProntsColumnKey[] => [
  'received',
  'transit',
  'regional',
  'courier',
  'delivered',
  'cancelled',
  ...state.pipelineConfig.customColumns.map((column) => column.id),
]

const getProntsMetaForColumn = (column: ProntsColumnKey) => {
  const pipelineColumn = getPipelineColumnConfig(column)
  const storedPreset = state.prontsConfigs[column]?.presetKey
  const defaultPreset = isProntsPresetKey(storedPreset) ? storedPreset : 'received'

  if (column in prontsPresetMeta) {
    return prontsPresetMeta[column as ProntsPresetKey]
  }

  return {
    ...prontsPresetMeta[defaultPreset],
    badge: 'C',
    title: `Columna personalizada: ${pipelineColumn.title}`,
    subtitle: pipelineColumn.helper,
    systemLabel: `Prompt personalizado: ${pipelineColumn.title}`,
    accentClass: 'is-received',
    icon: 'C',
  }
}

const getProntsColumnConfig = (column: ProntsColumnKey) =>
  state.prontsConfigs[column] && isProntsPresetKey(state.prontsConfigs[column].presetKey)
    ? state.prontsConfigs[column]
    : createProntsConfigFromPreset('received')

const setProntsColumnConfig = (column: ProntsColumnKey, nextConfig: Partial<ProntsColumnConfig>) => {
  state.prontsConfigs = {
    ...state.prontsConfigs,
    [column]: {
      ...getProntsColumnConfig(column),
      ...nextConfig,
    },
  }
}

const applyProntsPreset = (column: ProntsColumnKey, presetKey: ProntsPresetKey) => {
  const meta = prontsPresetMeta[presetKey]
  const contact = getProntsColumnContacts(column)[0] ?? getChatContacts()[0] ?? null

  setProntsColumnConfig(column, {
    presetKey,
    systemPrompt: meta.systemPrompt,
    userTemplate: meta.userTemplate,
    temperature: meta.temperature,
    action: meta.action,
    sampleContactId: contact?.id ?? null,
    response:
      '// Presiona "Ejecutar Simulación de Prompt" para probar el comportamiento de esta columna en tiempo real.',
  })
}

const resetProntsDefaults = () => {
  state.prontsActiveColumn = 'received'
  state.prontsConfigs = createDefaultProntsConfigs()
  state.prontsConfigError = null
}

const resetPipelineDefaults = () => {
  state.pipelineConfig = createDefaultPipelineConfig()
  state.pipelineConfigError = null
  state.customEmsColumnDraftName = ''
  state.customEmsColumnDraftHelper = ''
}

const saveProntsConfigToServer = async () => {
  state.prontsConfigState = 'submitting'
  state.prontsConfigError = null
  state.notice = null
  renderApp()

  try {
    const response = await authFetch('/api/pronts-config', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ configs: state.prontsConfigs }),
    })
    const payload = await parseApiPayload(response)

    if (response.status === 401) {
      clearSession()
      state.loginError = 'Tu sesion expiro. Vuelve a iniciar sesion.'
      renderApp()
      return
    }

    if (!response.ok) {
      throw new Error(
        (payload?.error as string) ||
        (payload?.message as string) ||
        'No se pudo guardar la configuracion de prompts.',
      )
    }

    syncProntsConfigFromDashboard({
      metrics: state.data?.metrics ?? {
        monthlySales: '',
        activeConversations: 0,
        activeLeads: 0,
        totalContacts: 0,
        hotLeads: 0,
      },
      contacts: state.data?.contacts ?? [],
      contactGroups: state.data?.contactGroups ?? [],
      channelConfig: state.data?.channelConfig,
      prontsConfig: payload?.configs as Record<ProntsPresetKey, ProntsColumnConfig>,
      pipelineConfig: state.pipelineConfig,
    })
    state.notice = 'Configuración de prompts guardada en el sistema.'
  } catch (error) {
    state.prontsConfigError =
      error instanceof Error ? error.message : 'No se pudo guardar la configuracion de prompts.'
  } finally {
    state.prontsConfigState = 'idle'
    renderApp()
  }
}

const savePipelineConfigToServer = async () => {
  state.pipelineConfigState = 'submitting'
  state.pipelineConfigError = null
  state.notice = null
  renderApp()

  try {
    const response = await authFetch('/api/pipeline-config', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ config: state.pipelineConfig }),
    })
    const payload = await parseApiPayload(response)

    if (response.status === 401) {
      clearSession()
      state.loginError = 'Tu sesion expiro. Vuelve a iniciar sesion.'
      renderApp()
      return false
    }

    if (!response.ok) {
      throw new Error(
        (payload?.error as string) ||
        (payload?.message as string) ||
        'No se pudo guardar la configuracion del pipeline.',
      )
    }

    syncPipelineConfigFromDashboard({
      metrics: state.data?.metrics ?? {
        monthlySales: '',
        activeConversations: 0,
        activeLeads: 0,
        totalContacts: 0,
        hotLeads: 0,
      },
      contacts: state.data?.contacts ?? [],
      contactGroups: state.data?.contactGroups ?? [],
      channelConfig: state.data?.channelConfig,
      prontsConfig: state.prontsConfigs,
      pipelineConfig: payload?.config as PipelineConfig,
    })
    if (state.activeView === 'ems') {
      void reloadEmsPipelinePages()
    }
    state.notice = 'Pipeline guardado en el sistema.'
    return true
  } catch (error) {
    state.pipelineConfigError =
      error instanceof Error ? error.message : 'No se pudo guardar la configuracion del pipeline.'
    return false
  } finally {
    state.pipelineConfigState = 'idle'
    renderApp()
  }
}

const runProntsSimulation = () => {
  void runProntsSimulationLive()
}

const runProntsSimulationLive = async () => {
  const column = state.prontsActiveColumn
  const config = getProntsColumnConfig(column)
  const contact = getProntsSelectedContact(column)
  const simulatedTemplate = replaceProntsTokens(config.userTemplate, contact)
  const meta = getProntsMetaForColumn(column)
  const targetReference = contact ? getWhatsAppReference(contact) : ''

  if (!contact || !targetReference) {
    const response = [
      `# ${meta.systemLabel}`,
      '',
      'No se pudo ejecutar la simulacion.',
      'Selecciona un contacto con numero de WhatsApp valido.',
    ].join('\n')

    setProntsColumnConfig(column, {
      sampleContactId: contact?.id ?? null,
      response,
    })
    renderApp()
    return
  }

  state.prontsSimulationState = 'running'
  state.prontsConfigError = null
  state.notice = 'La IA esta generando y enviando la simulacion por WhatsApp...'
  setProntsColumnConfig(column, {
    sampleContactId: contact.id,
    response: [
      `# ${meta.systemLabel}`,
      `Contacto: ${contact.name}`,
      `Referencia: ${targetReference}`,
      `Acción: ${config.action}`,
      `Temperatura: ${config.temperature.toFixed(1)}`,
      '',
      '=== Prompt procesado ===',
      simulatedTemplate,
      '',
      'Generando respuesta real con IA y preparando envio por WhatsApp...',
    ].join('\n'),
  })
  renderApp()

  try {
    const response = await authFetch('/api/ai/pronts-simulate-send', {
      method: 'POST',
      timeoutMs: 90000,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        column,
        columnLabel: getPipelineColumnConfig(column).title,
        action: config.action,
        temperature: config.temperature,
        systemPrompt: config.systemPrompt,
        userPrompt: simulatedTemplate,
        contact: {
          id: contact.id > 0 ? contact.id : null,
          name: contact.name,
          company: contact.company,
          segment: contact.segment,
          owner: contact.owner,
          status: contact.status,
          score: contact.score,
          reference: targetReference,
        },
      }),
    })

    const payload = await parseApiPayload(response)

    if (response.status === 401) {
      clearSession()
      state.loginError = 'Tu sesion expiro. Inicia sesion nuevamente.'
      renderApp()
      return
    }

    if (!response.ok) {
      throw new Error(
        (payload?.error as string) ||
        (payload?.message as string) ||
        'No se pudo ejecutar la simulacion real del prompt.',
      )
    }

    const generatedMessage = normalizeText(String(payload?.generatedMessage ?? ''))
    const provider = String(payload?.provider ?? 'ollama')
    const recipient = String(payload?.recipient ?? targetReference)
    const model = String(payload?.model ?? 'modelo no informado')

    setProntsColumnConfig(column, {
      sampleContactId: contact.id,
      response: [
        `# ${meta.systemLabel}`,
        `Contacto: ${contact.name}`,
        `Referencia: ${targetReference}`,
        `Acción: ${config.action}`,
        `Temperatura: ${config.temperature.toFixed(1)}`,
        `Modelo: ${model}`,
        '',
        '=== Prompt procesado ===',
        simulatedTemplate,
        '',
        '=== Respuesta generada por IA ===',
        generatedMessage || buildProntsSimulationResponse(column, contact),
        '',
        '=== Envío WhatsApp ===',
        `Estado: enviado`,
        `Proveedor: ${provider}`,
        `Destino: ${recipient}`,
      ].join('\n'),
    })
    state.notice = `Simulacion ejecutada y enviada a ${recipient}.`
  } catch (error) {
    const errorMessage =
      error instanceof DOMException && error.name === 'AbortError'
        ? 'La simulacion tardo demasiado y fue cancelada. Verifica que Ollama este activo y vuelve a intentar.'
        : error instanceof Error
          ? error.message
          : 'No se pudo ejecutar la simulacion real del prompt.'
    setProntsColumnConfig(column, {
      sampleContactId: contact.id,
      response: [
        `# ${meta.systemLabel}`,
        `Contacto: ${contact.name}`,
        `Referencia: ${targetReference}`,
        '',
        '=== Prompt procesado ===',
        simulatedTemplate,
        '',
        '=== Error ===',
        errorMessage,
      ].join('\n'),
    })
    state.prontsConfigError = errorMessage
    state.notice = errorMessage
  } finally {
    state.prontsSimulationState = 'idle'
    renderApp()
  }
}

const getProntsColumnContacts = (column: ProntsColumnKey) => {
  const contacts =
    column in state.pipelineConfig.columns
      ? getEmsStatusContacts()[column as BaseEmsColumnKey]
      : getCustomEmsColumnContacts(column)
  const baseContacts = contacts.length > 0 ? contacts : getChatContacts()
  const existingReferences = new Set(
    baseContacts.map((contact) => normalizeBoliviaTestPhoneDigits(getWhatsAppReference(contact))),
  )

  const testContacts = state.whatsappTestModeNumbers
    .map((value) => normalizeBoliviaTestPhoneDigits(value))
    .filter((value) => value && !existingReferences.has(value))
    .map(
      (value, index) =>
        ({
          id: -1000 - index,
          name: `Prueba ${formatBoliviaTestPhone(value)}`,
          company: 'Numero de prueba',
          channel: 'WhatsApp',
          socialProfiles: [{ channel: 'WhatsApp', reference: formatBoliviaTestPhone(value) }],
          whatsappConnection: {
            isConnected: false,
            lastActivityAt: null,
            lastInboundAt: null,
          },
          segment: 'Prueba',
          owner: 'Sandbox',
          status: 'Prueba',
          score: 80,
          updatedAt: new Date().toISOString(),
          lastMessageText: 'Contacto de prueba para el sandbox de prompts.',
          lastMessageDirection: 'outbound',
        }) satisfies Contact,
    )

  return [...testContacts, ...baseContacts]
}

const getProntsSelectedContact = (column: ProntsColumnKey) => {
  const config = getProntsColumnConfig(column)
  const contacts = getProntsColumnContacts(column)
  return (
    contacts.find((contact) => contact.id === config.sampleContactId) ??
    contacts[0] ??
    getChatContacts()[0] ??
    null
  )
}

const getProntsTokenChips = () => ['{cliente}', '{tracking}', '{destino}', '{peso}', '{valor}', '{estado}', '{grupoNombre}']

const replaceProntsTokens = (template: string, contact: Contact | null) => {
  if (!contact) {
    return template
  }

  const contactReference = getWhatsAppReference(contact)
  const value = `${contact.score}`
  const weight = `${Math.max(0.4, contact.score / 32).toFixed(1)} Kg`

  return template
    .replaceAll('{cliente}', contact.name)
    .replaceAll('{tracking}', contactReference || `EMS-${contact.id}`)
    .replaceAll('{destino}', contact.company || contact.segment || 'Destino no definido')
    .replaceAll('{peso}', weight)
    .replaceAll('{valor}', `$${value}`)
    .replaceAll('{estado}', contact.status || 'Sin estado')
    .replaceAll('{grupoNombre}', contact.owner || 'Sin grupo')
}

const buildProntsSimulationResponse = (column: ProntsColumnKey, contact: Contact | null) => {
  const meta = getProntsMetaForColumn(column)
  const message = contact ? getContactLastMessagePreview(contact) : 'Sin contacto seleccionado'
  const reference = contact ? getWhatsAppReference(contact) : 'Sin referencia'
  const company = contact?.company || 'Sin empresa'

  return [
    `// ${meta.systemLabel}`,
    `Cliente: ${contact?.name ?? 'Sin contacto'}`,
    `Referencia: ${reference}`,
    `Empresa: ${company}`,
    `Estado: ${contact?.status ?? 'Sin estado'}`,
    `Temperatura: ${getProntsColumnConfig(column).temperature.toFixed(1)}`,
    `Acción recomendada: ${getProntsColumnConfig(column).action}`,
    '',
    `Respuesta simulada: ${message}`,
  ].join('\n')
}

const getFilteredEmsContacts = () => {
  const contacts = getChatContacts().filter((contact) => {
    const matchesFilter =
      state.emsStatusFilter === 'all' || getEmsStatusKey(contact) === state.emsStatusFilter
    const query = state.searchQuery.trim().toLowerCase()
    const matchesQuery =
      query.length === 0 ||
      contact.name.toLowerCase().includes(query) ||
      contact.company.toLowerCase().includes(query) ||
      getWhatsAppReference(contact).toLowerCase().includes(query)

    return matchesFilter && matchesQuery
  })

  return contacts
}

const getChatListPagination = () => {
  const items = getFilteredEmsContacts()
  const totalItems = items.length
  const totalPages = Math.max(1, Math.ceil(totalItems / CHAT_LIST_PAGE_SIZE))
  const currentPage = Math.min(Math.max(state.chatListPage, 1), totalPages)
  const startIndex = (currentPage - 1) * CHAT_LIST_PAGE_SIZE

  return {
    items: items.slice(startIndex, startIndex + CHAT_LIST_PAGE_SIZE),
    currentPage,
    totalPages,
    totalItems,
    pageSize: CHAT_LIST_PAGE_SIZE,
  } satisfies ChatListPagination
}

const setChatListPage = (nextPage: number) => {
  const pagination = getChatListPagination()
  state.chatListPage = Math.min(Math.max(nextPage, 1), pagination.totalPages)
  renderApp()
}

const setContactsListPage = (nextPage: number) => {
  const pagination = getContactsPagination()
  state.contactListPage = Math.min(Math.max(nextPage, 1), pagination.totalPages)
  renderApp()
}

const setChatListPageForContact = (contactId: number) => {
  const contacts = getFilteredEmsContacts()
  const contactIndex = contacts.findIndex((contact) => contact.id === contactId)
  if (contactIndex < 0) {
    return
  }

  state.chatListPage = Math.floor(contactIndex / CHAT_LIST_PAGE_SIZE) + 1
}

const getContactLastActivityTime = (contact: Contact) => {
  const lastActivityAt = contact.whatsappConnection?.lastActivityAt
  const lastInboundAt = contact.whatsappConnection?.lastInboundAt
  const candidate = lastActivityAt || lastInboundAt
  return candidate ? new Date(candidate).getTime() || 0 : 0
}

const getContactUpdatedTime = (contact: Contact) =>
  contact.updatedAt ? new Date(contact.updatedAt).getTime() || 0 : 0

const getChatContacts = () =>
  (state.data?.contacts ?? [])
    .filter((contact) => hasWhatsAppChannel(contact))
    .sort((leftContact, rightContact) => {
      const rightActivity = getContactLastActivityTime(rightContact) || getContactUpdatedTime(rightContact)
      const leftActivity = getContactLastActivityTime(leftContact) || getContactUpdatedTime(leftContact)
      return rightActivity - leftActivity
    })

const isAutoCreatedChatContact = (contact: Contact | null | undefined) => {
  if (!contact) return false

  const normalizedName = contact.name.trim()
  return (
    normalizedName.startsWith('WhatsApp ') &&
    !contact.company.trim() &&
    contact.channel.includes('WhatsApp') &&
    contact.segment === 'Sin segmento' &&
    contact.status === 'Nuevo'
  )
}

const getConversationMessagesChronological = (messages: ContactConversationMessage[]) =>
  [...messages].sort((left, right) => {
    const leftTime = new Date(left.createdAt).getTime()
    const rightTime = new Date(right.createdAt).getTime()

    if (leftTime === rightTime) {
      return left.id - right.id
    }

    return leftTime - rightTime
  })

const isConversationThreadNearBottom = (thread: HTMLElement) => {
  const distanceFromBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight
  return distanceFromBottom < 24
}

const getActiveConversationThread = () =>
  document.querySelector<HTMLElement>('.ems-thread.conversation-thread, .conversation-thread')

const captureConversationThreadScrollState = () => {
  const thread = getActiveConversationThread()
  if (!thread) return null

  return {
    scrollTop: thread.scrollTop,
    nearBottom: isConversationThreadNearBottom(thread),
  }
}

const restoreConversationThreadScrollState = (
  snapshot: ReturnType<typeof captureConversationThreadScrollState>,
) => {
  const thread = getActiveConversationThread()
  if (!thread) return

  if (!snapshot) {
    thread.scrollTop = thread.scrollHeight
    return
  }

  thread.scrollTop = snapshot.nearBottom ? thread.scrollHeight : snapshot.scrollTop
}

const areAllFilteredContactsSelected = () => {
  const filtered = getFilteredContacts()
  return filtered.length > 0 && filtered.every((contact) => state.selectedContactIds.has(contact.id))
}

const toggleContactSelection = (contactId: number, checked: boolean) => {
  if (checked) {
    state.selectedContactIds.add(contactId)
  } else {
    state.selectedContactIds.delete(contactId)
  }

  renderApp()
}

const toggleAllFilteredContacts = (checked: boolean) => {
  const filtered = getFilteredContacts()

  for (const contact of filtered) {
    if (checked) {
      state.selectedContactIds.add(contact.id)
    } else {
      state.selectedContactIds.delete(contact.id)
    }
  }

  renderApp()
}

const updateGroupCreateField = (field: keyof GroupCreateForm, value: string) => {
  state.groupCreateForm[field] = value
}

const updateGroupContactPickerField = (field: keyof GroupContactPickerForm, value: string) => {
  state.groupContactPickerForm[field] = value
}

const getGroupContactPickerOptions = () => {
  const currentGroupMemberIds =
    state.groupModalMode === 'add-members' && state.groupActiveId
      ? new Set(
        (
          state.data?.contactGroups.find((group) => group.id === state.groupActiveId)?.members ?? []
        ).map((member) => member.id),
      )
      : null
  const availableContacts = (state.data?.contacts ?? []).filter(
    (contact) =>
      hasWhatsAppChannel(contact) &&
      (!currentGroupMemberIds || !currentGroupMemberIds.has(contact.id)) &&
      !state.selectedContactIds.has(contact.id),
  )
  const query = state.groupContactPickerForm.query.trim().toLowerCase()

  if (!query) {
    return availableContacts.slice(0, 8)
  }

  return availableContacts
    .filter((contact) => {
      const whatsapp = getWhatsAppReference(contact).toLowerCase()
      const whatsappDigits = whatsapp.replace(/[^\d]/g, '')
      const queryDigits = query.replace(/[^\d]/g, '')
      return (
        contact.name.toLowerCase().includes(query) ||
        contact.company.toLowerCase().includes(query) ||
        whatsapp.includes(query) ||
        (queryDigits.length > 0 && whatsappDigits.includes(queryDigits))
      )
    })
    .slice(0, 8)
}

const getGroupPickerResultsMarkup = () => {
  const pickerOptions = getGroupContactPickerOptions()

  if (pickerOptions.length > 0) {
    return `
      <div class="group-combobox-list group-dropzone" data-group-dropzone="available">
        ${pickerOptions
        .map(
          (contact) => `
              <button
                class="group-combobox-option group-drag-card"
                data-group-contact-option="${contact.id}"
                data-group-drag-contact="${contact.id}"
                data-group-drag-source="available"
                draggable="true"
                type="button"
              >
                <strong>${escapeHtml(contact.name)}</strong>
                <small>${escapeHtml(`${contact.company} · ${getWhatsAppReference(contact)}`)}</small>
              </button>
            `,
        )
        .join('')}
      </div>
    `
  }

  if (state.groupContactPickerForm.query.trim()) {
    return `<div class="group-combobox-empty group-dropzone" data-group-dropzone="available">No hay coincidencias con ese criterio.</div>`
  }

  return ''
}

const bindGroupPickerInteractions = (scope: ParentNode = document) => {
  scope.querySelectorAll<HTMLButtonElement>('[data-group-contact-option]').forEach((button) => {
    button.addEventListener('click', () => {
      const contactId = Number(button.dataset.groupContactOption)
      if (!Number.isFinite(contactId)) return
      addContactToGroupSelectionById(contactId)
    })
  })

  scope.querySelectorAll<HTMLElement>('[data-group-drag-contact]').forEach((item) => {
    item.addEventListener('dragstart', (event) => {
      const target = event.currentTarget as HTMLElement
      const contactId = target.dataset.groupDragContact
      const source = target.dataset.groupDragSource
      if (!contactId || !source) return
      event.dataTransfer?.setData('text/plain', JSON.stringify({ contactId, source }))
      event.dataTransfer!.effectAllowed = 'move'
    })
  })

  scope.querySelectorAll<HTMLElement>('[data-group-dropzone]').forEach((zone) => {
    zone.addEventListener('dragover', (event) => {
      event.preventDefault()
      event.dataTransfer!.dropEffect = 'move'
      zone.classList.add('is-drag-over')
    })

    zone.addEventListener('dragleave', () => {
      zone.classList.remove('is-drag-over')
    })

    zone.addEventListener('drop', (event) => {
      event.preventDefault()
      zone.classList.remove('is-drag-over')
      const raw = event.dataTransfer?.getData('text/plain')
      if (!raw) return

      try {
        const payload = JSON.parse(raw) as { contactId?: string; source?: string }
        const contactId = Number(payload.contactId)
        const source = payload.source
        const targetZone = zone.dataset.groupDropzone

        if (!Number.isFinite(contactId) || !source || !targetZone || source === targetZone) {
          return
        }

        if (targetZone === 'selected') {
          addContactToGroupSelectionById(contactId)
          return
        }

        removeContactFromGroupSelection(contactId)
      } catch {
        // ignore malformed drag payloads
      }
    })
  })
}

const refreshGroupPickerResults = () => {
  const combobox = document.querySelector<HTMLElement>('.group-combobox')
  if (!combobox) return

  combobox.innerHTML = getGroupPickerResultsMarkup()
  bindGroupPickerInteractions(combobox)
}

const openGroupCreateModal = () => {
  state.isGroupCreateModalOpen = true
  state.groupModalMode = 'create'
  state.groupActiveId = null
  state.groupActiveName = ''
  state.groupCreateError = null
  renderApp()
}

const openAddMembersToGroupModal = (groupId: number) => {
  const group = state.data?.contactGroups.find((item) => item.id === groupId)
  if (!group) return

  state.isGroupCreateModalOpen = true
  state.groupModalMode = 'add-members'
  state.groupActiveId = group.id
  state.groupActiveName = group.name
  state.groupCreateError = null
  state.groupCreateForm = defaultGroupCreateForm()
  state.groupContactPickerForm = defaultGroupContactPickerForm()
  state.selectedContactIds.clear()
  renderApp()
}

const openCustomEmsStateModal = async (scope: EmsColumnKey | null = null) => {
  state.isCustomEmsStateModalOpen = true
  state.customEmsStateModalScope = scope
  state.pipelineConfigError = null
  renderApp()
  await ensureApiPipelineStateSourcesLoaded()
}

const openCreatePipelineColumnModal = () => {
  state.isCreatePipelineColumnModalOpen = true
  state.pipelineConfigError = null
  state.createPipelineColumnForm = defaultCreatePipelineColumnForm()
  renderApp()
}

const closeCreatePipelineColumnModal = () => {
  state.isCreatePipelineColumnModalOpen = false
  state.pipelineConfigState = 'idle'
  state.pipelineConfigError = null
  state.createPipelineColumnForm = defaultCreatePipelineColumnForm()
  renderApp()
}

const upsertRelatedProntsColumn = (columnId: string, presetKey: ProntsPresetKey) => {
  const existingConfig = state.prontsConfigs[columnId] ?? null
  const nextConfig = createProntsConfigFromPreset(presetKey, existingConfig ?? {})

  state.prontsConfigs = {
    ...state.prontsConfigs,
    [columnId]: nextConfig,
  }
}

const savePipelineAndProntsConfig = async () => {
  await savePipelineConfigToServer()
  await saveProntsConfigToServer()
}

const closeCustomEmsStateModal = () => {
  state.isCustomEmsStateModalOpen = false
  state.customEmsStateModalScope = null
  state.pipelineConfigState = 'idle'
  state.pipelineConfigError = null
  state.customEmsColumnDraftName = ''
  state.customEmsColumnDraftHelper = ''
  renderApp()
}

const includeApiPipelineStateInColumn = async (scope: EmsColumnKey | null, stateKey: string) => {
  const selectedState = getApiPipelineStateOptions().find((item) => item.stateKey === stateKey)

  if (!selectedState) {
    state.pipelineConfigError = 'No se encontro el estado seleccionado en la API.'
    renderApp()
    return
  }

  if (!scope) {
    state.pipelineConfigError = 'Selecciona una columna del pipeline para incluir estados.'
    renderApp()
    return
  }

  const column = state.pipelineConfig.columns[scope]
  if (!column) {
    state.pipelineConfigError = 'No se encontro la columna del pipeline seleccionada.'
    renderApp()
    return
  }

  const currentAllowedStates = normalizeAllowedStates(column.allowedStates ?? [], [column.title])
  if (currentAllowedStates.includes(selectedState.stateKey)) {
    state.notice = `El estado ${selectedState.title} ya esta incluido en ${column.title}.`
    renderApp()
    return
  }

  state.pipelineConfig = {
    ...state.pipelineConfig,
    columns: {
      ...state.pipelineConfig.columns,
      [scope]: {
        ...column,
        allowedStates: [...currentAllowedStates, selectedState.stateKey],
      },
    },
  }
  state.notice = `Estado ${selectedState.title} incluido en ${column.title}.`
  await savePipelineAndProntsConfig()
}

const submitCreatePipelineColumn = async () => {
  const { title, helper, presetKey } = state.createPipelineColumnForm
  const created = addCustomPipelineColumn(title, helper)

  if (!created) {
    renderApp()
    return
  }

  upsertRelatedProntsColumn(created, presetKey)
  state.prontsActiveColumn = created
  state.notice = `Columna ${title.trim()} y su prompt relacionado fueron creados.`
  closeCreatePipelineColumnModal()
  await savePipelineAndProntsConfig()
}

const closeGroupCreateModal = () => {
  const shouldClearSelectedContacts = state.groupModalMode === 'add-members'

  state.isGroupCreateModalOpen = false
  state.groupModalMode = 'create'
  state.groupActiveId = null
  state.groupActiveName = ''
  state.groupCreateState = 'idle'
  state.groupCreateError = null
  state.groupCreateForm = defaultGroupCreateForm()
  state.groupContactPickerForm = defaultGroupContactPickerForm()
  if (shouldClearSelectedContacts) {
    state.selectedContactIds.clear()
  }
  renderApp()
}

const addContactToGroupSelectionById = (contactId: number) => {
  const contact =
    state.data?.contacts.find((item) => item.id === contactId && hasWhatsAppChannel(item)) ?? null

  if (!contact || state.selectedContactIds.has(contact.id)) {
    return
  }

  state.selectedContactIds.add(contact.id)
  state.groupCreateError = null
  state.groupContactPickerForm = defaultGroupContactPickerForm()
  renderApp()
}

const removeContactFromGroupSelection = (contactId: number) => {
  state.selectedContactIds.delete(contactId)
  state.groupCreateError = null
  renderApp()
}

const openGroupSendModal = (groupId: number) => {
  const group = state.data?.contactGroups.find((item) => item.id === groupId)
  if (!group) return

  state.isGroupSendModalOpen = true
  state.groupSendState = 'idle'
  state.groupSendError = null
  state.groupSendForm = {
    ...defaultGroupSendForm(),
    groupId: group.id,
    groupName: group.name,
  }
  renderApp()
}

const closeGroupSendModal = () => {
  state.isGroupSendModalOpen = false
  state.groupSendState = 'idle'
  state.groupSendError = null
  state.groupSendForm = defaultGroupSendForm()
  renderApp()
}

const submitCreateContactGroup = async () => {
  if (state.groupModalMode === 'add-members' && state.groupActiveId) {
    await addSelectedContactsToGroup(state.groupActiveId)
    return
  }

  const selectedIds = [...state.selectedContactIds]

  if (selectedIds.length === 0) {
    state.groupCreateError = 'Selecciona al menos un contacto para crear el grupo.'
    renderApp()
    return
  }

  state.groupCreateState = 'submitting'
  state.groupCreateError = null
  renderApp()

  try {
    const response = await authFetch('/api/contact-groups', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...state.groupCreateForm,
        contactIds: selectedIds,
      }),
    })

    const payload = await parseApiPayload(response)

    if (response.status === 401) {
      clearSession()
      state.loginError = 'Tu sesion expiro. Inicia sesion nuevamente.'
      renderApp()
      return
    }

    if (!response.ok) {
      throw new Error(
        (payload?.error as string) ||
        (payload?.message as string) ||
        'No se pudo crear el grupo de contactos.',
      )
    }

    state.groupCreateState = 'idle'
    state.groupCreateForm = defaultGroupCreateForm()
    state.isGroupCreateModalOpen = false
    state.selectedContactIds.clear()
    const groupName =
      payload && typeof payload.group === 'object' && payload.group !== null && 'name' in payload.group
        ? String(payload.group.name ?? '')
        : ''
    state.notice = `Grupo ${groupName} creado correctamente.`
    await loadDashboard()
  } catch (error) {
    state.groupCreateState = 'idle'
    state.groupCreateError =
      error instanceof Error ? error.message : 'No se pudo crear el grupo de contactos.'
    renderApp()
  }
}

const addSelectedContactsToGroup = async (groupId: number) => {
  const selectedIds = [...state.selectedContactIds]

  if (selectedIds.length === 0) {
    if (state.groupModalMode === 'add-members') {
      state.groupCreateError = 'Selecciona al menos un contacto para agregarlo al grupo.'
    } else {
      state.notice = 'Selecciona al menos un contacto para agregarlo a un grupo.'
    }
    renderApp()
    return
  }

  if (state.groupModalMode === 'add-members') {
    state.groupCreateState = 'submitting'
    state.groupCreateError = null
    renderApp()
  }

  try {
    const response = await authFetch(`/api/contact-groups/${groupId}/members`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contactIds: selectedIds,
      }),
    })

    const payload = await parseApiPayload(response)

    if (response.status === 401) {
      clearSession()
      state.loginError = 'Tu sesion expiro. Inicia sesion nuevamente.'
      renderApp()
      return
    }

    if (!response.ok) {
      throw new Error(
        (payload?.error as string) ||
        (payload?.message as string) ||
        'No se pudo actualizar el grupo.',
      )
    }

    state.selectedContactIds.clear()
    const groupName =
      payload && typeof payload.group === 'object' && payload.group !== null && 'name' in payload.group
        ? String(payload.group.name ?? '')
        : ''
    state.notice = `Se agregaron contactos al grupo ${groupName}.`
    if (state.groupModalMode === 'add-members') {
      await loadDashboard()
      closeGroupCreateModal()
      return
    }
    await loadDashboard()
  } catch (error) {
    if (state.groupModalMode === 'add-members') {
      state.groupCreateState = 'idle'
      state.groupCreateError = error instanceof Error ? error.message : 'No se pudo actualizar el grupo.'
    } else {
      state.notice = error instanceof Error ? error.message : 'No se pudo actualizar el grupo.'
    }
    renderApp()
  }
}

const removeMemberFromGroup = async (groupId: number, contactId: number) => {
  try {
    const response = await authFetch(`/api/contact-groups/${groupId}/members/${contactId}`, {
      method: 'DELETE',
    })

    const payload = await parseApiPayload(response)

    if (response.status === 401) {
      clearSession()
      state.loginError = 'Tu sesion expiro. Inicia sesion nuevamente.'
      renderApp()
      return
    }

    if (!response.ok) {
      throw new Error(
        (payload?.error as string) ||
        (payload?.message as string) ||
        'No se pudo quitar el contacto del grupo.',
      )
    }

    const groupName =
      payload && typeof payload.group === 'object' && payload.group !== null && 'name' in payload.group
        ? String(payload.group.name ?? '')
        : ''
    state.notice = `Se quito el contacto del grupo ${groupName}.`
    await loadDashboard()
  } catch (error) {
    state.notice = error instanceof Error ? error.message : 'No se pudo quitar el contacto del grupo.'
    renderApp()
  }
}

const submitGroupSendMessage = async () => {
  if (!state.groupSendForm.groupId) {
    return
  }

  state.groupSendState = 'submitting'
  state.groupSendError = null
  renderApp()

  try {
    const response = await authFetch(`/api/contact-groups/${state.groupSendForm.groupId}/messages/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: state.groupSendForm.message,
      }),
    })

    const payload = await parseApiPayload(response)

    if (response.status === 401) {
      clearSession()
      state.loginError = 'Tu sesion expiro. Inicia sesion nuevamente.'
      renderApp()
      return
    }

    if (!response.ok) {
      throw new Error(
        (payload?.error as string) ||
        (payload?.message as string) ||
        'No se pudo enviar el mensaje al grupo.',
      )
    }

    state.groupSendState = 'idle'
    state.isGroupSendModalOpen = false
    state.groupSendForm = defaultGroupSendForm()
    state.notice = `Envio grupal completado: ${String(payload?.sentCount ?? 0)} enviados, ${String(payload?.failedCount ?? 0)} fallidos, ${String(payload?.skippedCount ?? 0)} omitidos.`
    renderApp()
  } catch (error) {
    state.groupSendState = 'idle'
    state.groupSendError =
      error instanceof Error ? error.message : 'No se pudo enviar el mensaje al grupo.'
    renderApp()
  }
}

const setActiveView = (view: ViewKey) => {
  if (!isValidView(view)) {
    return
  }

  state.activeView = view
  syncViewToLocation(view)
  state.collapsedFlyoutGroup = null
  syncSidebarGroupWithActiveView()
  if (state.activeView === 'chat' && !state.conversationData.contact.id) {
    const firstChatContact = getChatContacts()[0]
    if (firstChatContact) {
      void openConversationModal(firstChatContact.id)
      return
    }
  }
  if (
    (view === 'internacionales' || view === 'internacionales-pipeline') &&
    state.trackingApiPackages.length === 0 &&
    state.trackingApiState !== 'loading'
  ) {
    void loadTrackingApiPackages()
  }
  if (
    (view === 'internacionales' || view === 'internacionales-pipeline') &&
    state.trackingApiCatalogPackages.length === 0 &&
    state.trackingApiCatalogState !== 'loading'
  ) {
    void loadTrackingApiCatalogPackages()
  }
  if (view === 'internacionales-paquetes' && state.contactPackages.length === 0 && state.contactPackagesState !== 'loading') {
    void loadContactPackages()
  }
  if (view === 'usuarios' && state.users.length === 0 && state.usersState !== 'loading') {
    void loadUsers()
  }
  if (view === 'logs' && state.logsState !== 'loading') {
    void loadLogsReport()
  }
  if (view === 'ems' && state.emsPipelineSyncState !== 'loading') {
    void refreshEmsPipelineFromApis()
    bootstrapEmsPipelineView()
  }
  persistUiState()
  renderApp()
}

const toggleSidebar = () => {
  state.isSidebarCollapsed = !state.isSidebarCollapsed
  if (!state.isSidebarCollapsed) {
    state.collapsedFlyoutGroup = null
  }
  persistUiState()
  renderApp()
}

const toggleGroup = (groupKey: MenuGroupKey) => {
  if (state.isSidebarCollapsed) {
    state.collapsedFlyoutGroup = state.collapsedFlyoutGroup === groupKey ? null : groupKey
    renderApp()
    return
  }

  if (state.expandedGroups.has(groupKey)) {
    state.expandedGroups.delete(groupKey)
  } else {
    state.expandedGroups.add(groupKey)
  }

  renderApp()
}

const syncSidebarGroupWithActiveView = () => {
  if (state.activeView === 'chat' || state.activeView === 'contactos' || state.activeView === 'agrupaciones') {
    state.expandedGroups.add('clientes')
  }
}

const openCreateContactModal = () => {
  const nextForm = defaultContactForm()
  const [firstSegment] = getSegmentOptions()
  if (firstSegment) {
    nextForm.segment = firstSegment
  }

  state.isCreateContactModalOpen = true
  state.createContactStep = 'personal'
  state.contactModalMode = 'create'
  state.activeContactId = null
  state.submitError = null
  state.notice = null
  state.createContactForm = nextForm
  renderApp()
}

const openCreateUserModal = () => {
  state.isUserModalOpen = true
  state.userModalMode = 'create'
  state.activeUserId = null
  state.userSubmitState = 'idle'
  state.userSubmitError = null
  state.notice = null
  state.userForm = defaultUserForm()
  renderApp()
}

const openEditUserModal = (userId: number) => {
  const user = state.users.find((item) => item.id === userId)
  if (!user) return

  state.isUserModalOpen = true
  state.userModalMode = 'edit'
  state.activeUserId = user.id
  state.userSubmitState = 'idle'
  state.userSubmitError = null
  state.notice = null
  state.userForm = {
    fullName: user.fullName,
    email: user.email,
    password: '',
    role: user.role,
  }
  renderApp()
}

const openCreateContactFromConversationModal = (contactId: number) => {
  const contact = state.data?.contacts.find((item) => item.id === contactId) ?? null
  const nextForm = buildContactFormFromConversation(contact)
  const [firstSegment] = getSegmentOptions()

  if (!nextForm.segment && firstSegment) {
    nextForm.segment = firstSegment
  }

  state.isCreateContactModalOpen = true
  state.createContactStep = 'personal'
  state.contactModalMode = 'create'
  state.activeContactId = null
  state.submitState = 'idle'
  state.submitError = null
  state.notice = null
  state.createContactForm = nextForm
  renderApp()
}

const openEditContactModal = (contactId: number) => {
  const contact = state.data?.contacts.find((item) => item.id === contactId)
  if (!contact) return

  state.isCreateContactModalOpen = true
  state.createContactStep = 'personal'
  state.contactModalMode = 'edit'
  state.activeContactId = contact.id
  state.submitState = 'idle'
  state.submitError = null
  state.notice = null
  state.createContactForm = buildContactFormFromContact(contact)
  renderApp()
}

const openChatContactModal = (contactId: number) => {
  const contact = state.data?.contacts.find((item) => item.id === contactId)

  if (!contact) {
    openCreateContactFromConversationModal(contactId)
    return
  }

  if (isAutoCreatedChatContact(contact)) {
    openCreateContactFromConversationModal(contact.id)
    return
  }

  openEditContactModal(contact.id)
}

const closeCreateContactModal = () => {
  state.isCreateContactModalOpen = false
  state.createContactStep = 'personal'
  state.contactModalMode = 'create'
  state.activeContactId = null
  state.submitState = 'idle'
  state.submitError = null
  renderApp()
}

const closeUserModal = () => {
  state.isUserModalOpen = false
  state.userModalMode = 'create'
  state.activeUserId = null
  state.userSubmitState = 'idle'
  state.userSubmitError = null
  state.userForm = defaultUserForm()
  renderApp()
}

const loadUsers = async () => {
  state.usersState = 'loading'
  state.usersError = null
  renderApp()

  try {
    const response = await authFetch('/api/users')
    const payload = await parseApiPayload(response)

    if (response.status === 401) {
      clearSession()
      state.loginError = 'Tu sesion expiro. Vuelve a iniciar sesion.'
      state.usersState = 'idle'
      renderApp()
      return
    }

    if (!response.ok) {
      throw new Error(
        (payload?.message as string) ||
        (payload?.error as string) ||
        'No se pudo cargar la lista de usuarios.',
      )
    }

    state.users = Array.isArray(payload?.data) ? (payload.data as ManagedUser[]) : []
    state.usersError = null
    state.usersSyncedAt = new Date().toISOString()
    state.usersState = 'idle'
  } catch (error) {
    state.usersState = 'error'
    state.usersError = error instanceof Error ? error.message : 'No se pudo cargar la lista de usuarios.'
  }

  renderApp()
}

const loadLogsReport = async () => {
  state.logsState = 'loading'
  state.logsError = null
  renderApp()

  try {
    const result = await fetchLogsReportPage(state.logsPage, state.logsPageSize)
    if (!result) {
      return
    }

    const { payload } = result
    state.logsReport = payload
    state.logsPage = state.logsReport.pagination?.page ?? state.logsPage
    state.logsState = 'idle'
  } catch (error) {
    if (shouldUseEmptyLogsFallback(error)) {
      state.logsReport = state.logsReport ?? createEmptyLogsReport()
      state.logsState = 'idle'
      state.logsError = 'El reporte de logs tardo en responder. Puedes seguir usando esta pantalla y reintentar.'
    } else {
      state.logsState = 'error'
      state.logsError = error instanceof Error ? error.message : 'No se pudo cargar el reporte de logs.'
    }
  }

  renderApp()
}

const buildLogsReportQuery = (page: number, perPage: number) => {
  const query = new URLSearchParams({
    hours: String(state.logsHours),
    limit: '100',
    page: String(page),
    per_page: String(perPage),
  })

  if (state.logsLevel) query.set('level', state.logsLevel)
  if (state.logsMonthFilter && state.logsMonthFilter !== 'all') query.set('month', state.logsMonthFilter)

  return query
}

const fetchLogsReportPage = async (page: number, perPage: number) => {
  const query = buildLogsReportQuery(page, perPage)
  const response = await authFetch(`/api/logs/report?${query.toString()}`, { timeoutMs: 60000 })
  const payload = await parseApiPayload(response)

  if (response.status === 401) {
    clearSession()
    state.loginError = 'Tu sesion expiro. Vuelve a iniciar sesion.'
    state.logsState = 'idle'
    renderApp()
    return null
  }

  if (!response.ok) {
    throw new Error((payload?.message as string) || 'No se pudo cargar el reporte de logs.')
  }

  return { response, payload: payload as unknown as LogsReport }
}

const createEmptyLogsReport = (): LogsReport => ({
  generatedAt: new Date().toISOString(),
  period: { hours: state.logsHours, level: state.logsLevel || null, path: null, month: state.logsMonthFilter },
  totals: { total: 0, info: 0, warn: 0, error: 0 },
  months: [],
  byEndpoint: [],
  recent: [],
  pagination: {
    page: Math.max(state.logsPage, 1),
    perPage: state.logsPageSize,
    totalItems: 0,
    totalPages: 1,
  },
})

const shouldUseEmptyLogsFallback = (error: unknown) =>
  error instanceof Error &&
  (error.message.includes('tardo demasiado') ||
    error.message.toLowerCase().includes('aborted') ||
    error.message.toLowerCase().includes('abort'))

const exportLogsReportToExcel = async () => {
  const exportButton = document.querySelector<HTMLButtonElement>('#export-logs-report')
  if (exportButton) {
    exportButton.disabled = true
  }

  state.notice = 'Preparando el archivo Excel del reporte de logs...'
  renderApp()

  try {
    const apiPageSize = 50
    const firstResult = await fetchLogsReportPage(1, apiPageSize)

    if (!firstResult) {
      return
    }

    const firstReport = firstResult.payload
    const allRecentLogs = [...firstReport.recent]
    const totalPages = firstReport.pagination?.totalPages ?? 1

    for (let page = 2; page <= totalPages; page += 1) {
      const result = await fetchLogsReportPage(page, apiPageSize)
      if (!result) {
        return
      }

      allRecentLogs.push(...result.payload.recent)
    }

    const summaryRows = [
      {
        'Periodo (horas)': firstReport.period.hours,
        Nivel: firstReport.period.level ?? 'Todos',
        Mes: firstReport.period.month ?? 'Todos',
        Ruta: firstReport.period.path ?? 'Todas',
        'Total de eventos': firstReport.totals.total,
        Informacion: firstReport.totals.info,
        Advertencias: firstReport.totals.warn,
        Errores: firstReport.totals.error,
        'Generado en': firstReport.generatedAt,
      },
    ]

    const endpointRows = firstReport.byEndpoint.map((item) => ({
      Ruta: item.path,
      Eventos: item.count,
      'Promedio ms': item.average_duration_ms ?? 0,
      Errores: item.errors,
    }))

    const monthRows = firstReport.months.map((item) => ({
      Mes: item.label,
      Valor: item.value,
      Registros: item.count,
    }))

    const eventRows = allRecentLogs.map((item) => ({
      ID: item.id,
      Hora: item.created_at,
      Nivel: item.level,
      Evento: item.event,
      Metodo: item.method ?? '',
      Ruta: item.path ?? '',
      Resultado: item.status_code ?? '',
      'Duracion ms': item.duration_ms ?? 0,
      'Usuario ID': item.user_id ?? '',
      Detalles: JSON.stringify(item.details ?? {}),
    }))

    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(summaryRows), 'Resumen')
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(endpointRows), 'Endpoints')
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(monthRows), 'Meses')
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(eventRows), 'Eventos')

    const workbookData = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' })
    const downloadUrl = URL.createObjectURL(
      new Blob([workbookData], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    )
    const downloadLink = document.createElement('a')
    downloadLink.href = downloadUrl
    downloadLink.download = `reporte-logs-${new Date().toISOString().slice(0, 10)}.xlsx`
    document.body.appendChild(downloadLink)
    downloadLink.click()
    downloadLink.remove()
    URL.revokeObjectURL(downloadUrl)

    state.notice = `Excel generado correctamente con ${allRecentLogs.length} eventos.`
  } catch (error) {
    console.error('No se pudo generar el Excel del reporte de logs:', error)
    state.notice = error instanceof Error ? error.message : 'No se pudo exportar el reporte de logs.'
  } finally {
    if (exportButton) {
      exportButton.disabled = false
    }
    renderApp()
  }
}

const updateLogsFilter = (field: 'hours' | 'level', value: string) => {
  if (field === 'hours') state.logsHours = Number(value) || 24
  if (field === 'level') state.logsLevel = value
  state.logsPage = 1
}

const updateLogsMonthFilter = (value: string) => {
  state.logsMonthFilter = value
  state.logsPage = 1
}

const setLogsPage = (nextPage: number) => {
  if (!state.logsReport) {
    state.logsPage = Math.max(1, nextPage)
    renderApp()
    return
  }

  const totalPages = state.logsReport.pagination?.totalPages ?? 1
  state.logsPage = Math.min(Math.max(nextPage, 1), totalPages)
  void loadLogsReport()
}

const submitUserForm = async () => {
  const isEdit = state.userModalMode === 'edit' && Number.isFinite(state.activeUserId)
  const userId = state.activeUserId

  state.userSubmitState = 'submitting'
  state.userSubmitError = null
  renderApp()

  try {
    const response = await authFetch(isEdit ? `/api/users/${userId}` : '/api/users', {
      method: isEdit ? 'PUT' : 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fullName: state.userForm.fullName,
        email: state.userForm.email,
        password: state.userForm.password,
        roleName: state.userForm.role,
      }),
    })

    const payload = await parseApiPayload(response)

    if (response.status === 401) {
      clearSession()
      state.loginError = 'Tu sesion expiro. Vuelve a iniciar sesion.'
      renderApp()
      return
    }

    if (!response.ok) {
      throw new Error(
        (payload?.message as string) ||
        (payload?.error as string) ||
        'No se pudo guardar el usuario.',
      )
    }

    state.userSubmitState = 'idle'
    state.notice = isEdit ? 'Usuario actualizado correctamente.' : 'Usuario creado correctamente.'
    closeUserModal()
    await loadUsers()
  } catch (error) {
    state.userSubmitState = 'idle'
    state.userSubmitError = error instanceof Error ? error.message : 'No se pudo guardar el usuario.'
    renderApp()
  }
}

const deleteUser = async (userId: number) => {
  if (!window.confirm('¿Seguro que quieres eliminar este usuario?')) return

  try {
    const response = await authFetch(`/api/users/${userId}`, {
      method: 'DELETE',
    })
    const payload = await parseApiPayload(response)

    if (response.status === 401) {
      clearSession()
      state.loginError = 'Tu sesion expiro. Vuelve a iniciar sesion.'
      renderApp()
      return
    }

    if (!response.ok) {
      throw new Error((payload?.message as string) || (payload?.error as string) || 'No se pudo eliminar el usuario.')
    }

    state.notice = 'Usuario eliminado correctamente.'
    await loadUsers()
  } catch (error) {
    state.userSubmitError = error instanceof Error ? error.message : 'No se pudo eliminar el usuario.'
    renderApp()
  }
}

const validateCreateContactStep = (step: CreateContactStep) => {
  if (step === 'personal') {
    if (!state.createContactForm.name.trim()) {
      return 'Escribe el nombre del cliente para continuar.'
    }
  }

  if (step === 'channels' && state.createContactForm.channels.length === 0) {
    return 'Selecciona al menos una red o canal de contacto.'
  }

  return null
}

const goToCreateContactStep = (step: CreateContactStep) => {
  state.submitError = null
  state.createContactStep = step
  renderApp()
}

const continueCreateContactStep = () => {
  const currentStep = state.createContactStep
  const validationError = validateCreateContactStep(currentStep)

  if (validationError) {
    state.submitError = validationError
    renderApp()
    return
  }

  if (currentStep === 'personal') {
    goToCreateContactStep('channels')
    return
  }

  if (currentStep === 'channels') {
    goToCreateContactStep('details')
  }
}

const openSendMessageModal = (contactId: number) => {
  const contact = state.data?.contacts.find((item) => item.id === contactId)
  if (!contact) return

  const whatsappReference = getWhatsAppReference(contact)
  if (!whatsappReference) {
    state.notice = `El contacto ${contact.name} no tiene WhatsApp registrado.`
    renderApp()
    return
  }

  state.isSendMessageModalOpen = true
  state.sendMessageState = 'idle'
  state.sendMessageError = null
  state.notice = null
  state.sendMessageForm = {
    contactId: contact.id,
    contactName: contact.name,
    targetReference: whatsappReference,
    message: `Hola ${contact.name}, te escribimos desde Correos de Bolivia.`,
    attachment: null,
    attachmentName: '',
    attachmentType: '',
  }
  renderApp()
}

const closeSendMessageModal = () => {
  state.isSendMessageModalOpen = false
  state.sendMessageState = 'idle'
  state.sendMessageError = null
  state.sendMessageForm = defaultWhatsAppMessageForm()
  renderApp()
}

const syncSendMessageFormWithContact = (contact: Contact) => {
  const whatsappReference = getWhatsAppReference(contact)
  state.sendMessageError = null
  state.sendMessageForm = {
    contactId: contact.id,
    contactName: contact.name,
    targetReference: whatsappReference,
    message:
      state.sendMessageForm.contactId === contact.id ? state.sendMessageForm.message : '',
    attachment: null,
    attachmentName: '',
    attachmentType: '',
  }
}

const openConversationModal = async (contactId: number) => {
  const contact = state.data?.contacts.find((item) => item.id === contactId)
  if (!contact) return

  if (!hasWhatsAppChannel(contact)) {
    state.notice = `El contacto ${contact.name} no tiene WhatsApp registrado.`
    renderApp()
    return
  }

  state.isConversationModalOpen = false
  state.activeView = 'chat'
  setChatListPageForContact(contact.id)
  persistUiState()
  syncSendMessageFormWithContact(contact)
  state.conversationState = 'loading'
  state.conversationError = null
  state.conversationData = {
    contact: {
      id: contact.id,
      name: contact.name,
      company: contact.company,
    },
    messages: [],
  }

  await loadConversation(contactId)
}

const hasConversationChanged = (
  currentConversation: ContactConversationData,
  nextConversation: ContactConversationData,
) => {
  const currentStatus = String(currentConversation.contact.status ?? '')
  const nextStatus = String(nextConversation.contact.status ?? '')

  if (currentStatus !== nextStatus) {
    return true
  }

  if (currentConversation.messages.length !== nextConversation.messages.length) {
    return true
  }

  for (let index = 0; index < currentConversation.messages.length; index += 1) {
    const currentMessage = currentConversation.messages[index]
    const nextMessage = nextConversation.messages[index]

    if (
      currentMessage.id !== nextMessage.id ||
      currentMessage.status !== nextMessage.status ||
      currentMessage.message !== nextMessage.message ||
      currentMessage.createdAt !== nextMessage.createdAt
    ) {
      return true
    }
  }

  return false
}

const loadConversation = async (contactId: number, options: { silent?: boolean } = {}) => {
  try {
    const previousLatestMessage = getConversationMessagesChronological(state.conversationData.messages).at(-1) ?? null
    const response = await authFetch(`/api/contacts/${contactId}/messages`)
    const payload = await parseApiPayload(response)

    if (response.status === 401) {
      clearSession()
      state.loginError = 'Tu sesion expiro. Inicia sesion nuevamente.'
      renderApp()
      return
    }

    if (!response.ok) {
      throw new Error(
        (payload?.error as string) ||
        (payload?.message as string) ||
        'No se pudo cargar la conversacion del contacto.',
      )
    }

    state.conversationState = 'idle'
    const nextConversation = payload as unknown as ContactConversationData
    const shouldRenderConversation =
      !options.silent || hasConversationChanged(state.conversationData, nextConversation)
    state.conversationData = nextConversation

    const latestMessage = getConversationMessagesChronological(state.conversationData.messages).at(-1) ?? null
    const latestContactStatus = String((payload as { contact?: { status?: string } }).contact?.status ?? '')
    state.conversationData.contact = {
      ...state.conversationData.contact,
      status: latestContactStatus || state.conversationData.contact.status,
    }
    if (state.data) {
      state.data = {
        ...state.data,
        contacts: state.data.contacts.map((contact) =>
          contact.id === contactId
            ? {
              ...contact,
              status: latestContactStatus || contact.status,
              lastMessageText: latestMessage?.message ?? null,
              lastMessageDirection: latestMessage?.direction ?? null,
              lastMessageAt: latestMessage?.createdAt ?? contact.lastMessageAt ?? null,
            }
            : contact,
        ),
      }
    }

    if (options.silent) {
      const nextLatestMessage = getConversationMessagesChronological(nextConversation.messages).at(-1) ?? null
      maybeNotifyIncomingMessage(
        previousLatestMessage
          ? {
            lastMessageAt: previousLatestMessage.createdAt,
            lastMessageText: previousLatestMessage.message,
          }
          : null,
        nextConversation.contact as Contact,
        nextLatestMessage
          ? {
            direction: nextLatestMessage.direction,
            message: nextLatestMessage.message,
            createdAt: nextLatestMessage.createdAt,
          }
          : null,
      )
    }

    if (shouldRenderConversation) {
      renderApp()
    }
  } catch (error) {
    state.conversationState = 'idle'
    state.conversationError =
      error instanceof Error ? error.message : 'No se pudo cargar la conversacion del contacto.'
    renderApp()
  }
}

const suggestConversationReply = async () => {
  const contactId = state.conversationData.contact.id
  if (!contactId) {
    return
  }

  const activeContact =
    state.data?.contacts.find((contact) => contact.id === contactId) ??
    getChatContacts().find((contact) => contact.id === contactId) ??
    null

  try {
    state.notice = 'La IA esta redactando una sugerencia...'
    renderApp()

    const suggestion = await generateAiSuggestedReply(
      contactId,
      activeContact ? `Responde como soporte del mÃ³dulo EMS para ${activeContact.name}.` : '',
    )

    if (!suggestion) {
      return
    }

    state.sendMessageForm = {
      contactId,
      contactName: activeContact?.name ?? state.conversationData.contact.name,
      targetReference: activeContact ? getWhatsAppReference(activeContact) : state.sendMessageForm.targetReference,
      message: suggestion,
      attachment: null,
      attachmentName: '',
      attachmentType: '',
    }
    state.notice = 'Sugerencia lista. Ya puedes editarla antes de enviar.'
    renderApp()

    requestAnimationFrame(() => {
      document.querySelector<HTMLTextAreaElement>('#chat-composer-input')?.focus()
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'No se pudo generar la sugerencia de IA.'
    state.notice = errorMessage
    state.conversationError = errorMessage
    renderApp()
  }
}

const deleteConversation = async () => {
  const contactId = state.conversationData.contact.id

  if (!contactId) return

  const confirmed = window.confirm(
    `Se borrara todo el chat de ${state.conversationData.contact.name}. Esta accion no se puede deshacer.`,
  )

  if (!confirmed) return

  state.conversationState = 'loading'
  state.conversationError = null
  renderApp()

  try {
    const response = await authFetch(`/api/contacts/${contactId}/messages`, {
      method: 'DELETE',
    })
    const payload = await parseApiPayload(response)

    if (response.status === 401) {
      clearSession()
      state.loginError = 'Tu sesion expiro. Inicia sesion nuevamente.'
      renderApp()
      return
    }

    if (!response.ok) {
      throw new Error(
        (payload?.error as string) ||
        (payload?.message as string) ||
        'No se pudo borrar la conversacion del contacto.',
      )
    }

    state.conversationState = 'idle'
    state.conversationData = {
      ...state.conversationData,
      messages: [],
    }
    state.notice = `Se borraron ${String(payload?.deletedCount ?? 0)} mensajes del chat.`
    renderApp()
  } catch (error) {
    state.conversationState = 'idle'
    state.conversationError =
      error instanceof Error ? error.message : 'No se pudo borrar la conversacion del contacto.'
    renderApp()
  }
}

const closeConversationModal = () => {
  state.isConversationModalOpen = false
  state.conversationState = 'idle'
  state.conversationError = null
  state.conversationData = defaultContactConversation()
  if (state.activeView === 'chat') {
    state.activeView = 'contactos'
    persistUiState()
  }
  renderApp()
}

const openContactProfileModal = (contactId: number) => {
  const contact =
    state.data?.contacts.find((item) => item.id === contactId) ??
    getChatContacts().find((item) => item.id === contactId) ??
    null

  if (!contact) {
    return
  }

  state.isContactProfileModalOpen = true
  state.notice = null
  state.activeView = 'ems'
  state.conversationData = {
    contact: {
      id: contact.id,
      name: contact.name,
      company: contact.company,
    },
    messages: state.conversationData.contact.id === contact.id ? state.conversationData.messages : [],
  }
  persistUiState()
  renderApp()
}

const closeContactProfileModal = () => {
  state.isContactProfileModalOpen = false
  renderApp()
}

const openTrackingInfoModal = (trackingId: string | number) => {
  const selectedPackage =
    state.trackingApiPackages.find(
      (item) => String(item.mailitm_pid) === String(trackingId) || item.codigo_s10 === String(trackingId),
    ) ?? null

  if (!selectedPackage) {
    return
  }

  state.selectedTrackingApiPackage = selectedPackage
  renderApp()
}

const closeTrackingInfoModal = () => {
  state.selectedTrackingApiPackage = null
  renderApp()
}

const syncChatRefreshLoop = () => {
  if (chatRefreshTimer) {
    clearInterval(chatRefreshTimer)
    chatRefreshTimer = null
  }

  const activeConversationId = state.conversationData.contact.id
  const shouldRefreshChat =
    Boolean(state.authToken) &&
    Boolean(state.sessionUser) &&
    (state.activeView === 'chat' || state.isConversationModalOpen) &&
    Boolean(activeConversationId)

  if (!shouldRefreshChat) {
    return
  }

  chatRefreshTimer = setInterval(() => {
    if (state.conversationState === 'loading') {
      return
    }

    void loadConversation(activeConversationId, { silent: true })
  }, CHAT_REFRESH_INTERVAL_MS)
}

const syncDashboardRefreshLoop = () => {
  if (dashboardRefreshTimer) {
    clearInterval(dashboardRefreshTimer)
    dashboardRefreshTimer = null
  }

  const shouldRefreshDashboard = Boolean(state.authToken) && Boolean(state.sessionUser)

  if (!shouldRefreshDashboard) {
    return
  }

  dashboardRefreshTimer = setInterval(() => {
    void loadDashboard({ silent: true })
  }, DASHBOARD_REFRESH_INTERVAL_MS)
}

const isTextEditingElement = (
  element: Element | null,
): element is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement => {
  if (!element) {
    return false
  }

  return (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement ||
    element.getAttribute('contenteditable') === 'true'
  )
}

const isSelectableTextElement = (
  element: Element | null,
): element is HTMLInputElement | HTMLTextAreaElement => {
  return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
}

const getFocusedFieldKey = (element: Element) => {
  const htmlElement = element as HTMLElement

  if (htmlElement.id) {
    return `id:${htmlElement.id}`
  }

  const name = htmlElement.getAttribute('name')
  if (name) {
    return `name:${htmlElement.tagName.toLowerCase()}:${name}`
  }

  return null
}

const captureFocusedFieldState = () => {
  const activeElement = document.activeElement

  if (!isTextEditingElement(activeElement)) {
    return null
  }

  const fieldKey = getFocusedFieldKey(activeElement)

  if (!fieldKey) {
    return null
  }

  return {
    fieldKey,
    selectionStart: isSelectableTextElement(activeElement) ? activeElement.selectionStart : null,
    selectionEnd: isSelectableTextElement(activeElement) ? activeElement.selectionEnd : null,
    selectionDirection: isSelectableTextElement(activeElement) ? activeElement.selectionDirection : null,
    scrollTop: activeElement.scrollTop,
  }
}

const restoreFocusedFieldState = (snapshot: ReturnType<typeof captureFocusedFieldState>) => {
  if (!snapshot) {
    return
  }

  const [keyType, ...keyParts] = snapshot.fieldKey.split(':')
  const searchKey = keyParts.join(':')

  let target: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null = null

  if (keyType === 'id') {
    target = document.getElementById(searchKey) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null
  } else if (keyType === 'name') {
    const [tagName, fieldName] = searchKey.split(':')
    target = document.querySelector(`${tagName}[name="${CSS.escape(fieldName)}"]`) as
      | HTMLInputElement
      | HTMLTextAreaElement
      | HTMLSelectElement
      | null
  }

  if (!isTextEditingElement(target)) {
    return
  }

  target.focus({ preventScroll: true })

  if (isSelectableTextElement(target) && typeof snapshot.selectionStart === 'number' && typeof snapshot.selectionEnd === 'number') {
    try {
      target.setSelectionRange(
        snapshot.selectionStart,
        snapshot.selectionEnd,
        snapshot.selectionDirection ?? undefined,
      )
    } catch {
      // Some fields do not support selection ranges.
    }
  }

  if (typeof snapshot.scrollTop === 'number') {
    target.scrollTop = snapshot.scrollTop
  }
}

const updateContactFormField = (
  field: 'name' | 'company' | 'segment' | 'owner' | 'status' | 'score',
  value: string,
) => {
  state.createContactForm[field] = value
}

const toggleContactChannel = (channel: string, checked: boolean) => {
  const nextChannels = checked
    ? [...new Set([...state.createContactForm.channels, channel])]
    : state.createContactForm.channels.filter((item) => item !== channel)

  state.createContactForm.channels = nextChannels

  if (!checked) {
    state.createContactForm.channelReferences[channel] = ''
  }

  renderApp()
}

const updateContactChannelReference = (channel: string, value: string) => {
  state.createContactForm.channelReferences[channel] = value
}

const updateWhatsAppCountrySearch = (value: string) => {
  state.createContactForm.whatsappCountrySearch = value.toUpperCase()
}

const updateWhatsAppLocalNumber = (value: string) => {
  const detectedPhone = detectPhoneCountryFromNumber(value)

  if (detectedPhone) {
    state.createContactForm.whatsappCountrySearch = detectedPhone.country.iso2
    state.createContactForm.whatsappLocalNumber = detectedPhone.localNumber
    return
  }

  state.createContactForm.whatsappLocalNumber = value
}

const updateLoginFormField = (field: keyof LoginForm, value: string | boolean) => {
  state.loginForm[field] = value as never
}

const clearDefaultLoginFieldOnFocus = (field: 'email' | 'password') => {
  const defaults = defaultLoginForm()
  if (state.loginForm[field] !== defaults[field]) {
    return
  }

  state.loginForm[field] = ''
  renderApp()
}

const updateWhatsAppConfigField = (field: keyof WhatsAppConfigForm, value: string) => {
  state.whatsappConfigForm[field] = value
}

const updateWhatsAppTestField = (field: keyof WhatsAppTestForm, value: string) => {
  state.whatsappTestForm[field] = value
}

const updateSendMessageField = (field: keyof WhatsAppMessageForm, value: string | number | null) => {
  state.sendMessageForm[field] = value as never
}

const formatConversationTimestamp = (value: string) => {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat('es-BO', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date)
}

const togglePasswordVisibility = () => {
  state.showPassword = !state.showPassword
  renderApp()
}

const clearSession = () => {
  clearSessionExpiryTimer()
  state.authToken = null
  state.authExpiresAt = null
  state.sessionUser = null
  state.data = null
  state.loading = false
  state.error = null
  state.searchQuery = ''
  state.segmentFilter = 'Todos'
  state.statusFilter = 'Todos'
  state.chatListPage = 1
  state.selectedContactIds.clear()
  state.groupCreateForm = defaultGroupCreateForm()
  state.groupCreateError = null
  state.isGroupSendModalOpen = false
  state.groupSendForm = defaultGroupSendForm()
  state.groupSendError = null
  state.isCreateContactModalOpen = false
  state.contactModalMode = 'create'
  state.activeContactId = null
  state.isSendMessageModalOpen = false
  state.sendMessageForm = defaultWhatsAppMessageForm()
  state.isConversationModalOpen = false
  state.conversationData = defaultContactConversation()
  state.messageNotifications = []
  seenMessageNotificationKeys.clear()
  for (const timer of messageNotificationCleanupTimers.values()) {
    clearTimeout(timer)
  }
  messageNotificationCleanupTimers.clear()
  state.collapsedFlyoutGroup = null
  state.topbarProfileOpen = false
  state.users = []
  state.usersState = 'idle'
  state.usersError = null
  state.usersSyncedAt = null
  state.isUserModalOpen = false
  state.userModalMode = 'create'
  state.activeUserId = null
  state.userForm = defaultUserForm()
  state.userSubmitState = 'idle'
  state.userSubmitError = null
  try {
    localStorage.removeItem(STORAGE_KEYS.authToken)
    localStorage.removeItem(STORAGE_KEYS.rememberSession)
  } catch {
    // ignore storage issues
  }

  syncLoginToLocation({ replace: true })
}

const createRenderContext = () => ({
  state,
  menuGroups,
  getViewHref,
  escapeHtml,
  getBrandIcon,
  getMenuGroupIcon,
  getRobotIcon,
  formatBoliviaTestPhone,
  getFilteredContacts,
  getContactPreviewLine,
  getContactLastMessagePreview,
  getContactConnectionLabel,
  getContactConnectionClass,
  getContactsPagination,
  formatConversationTimestamp,
  getStatusClass,
  getFilteredEmsContacts,
  getEmsColumnContacts,
  getEmsSearchQueryForColumn,
  getEmsStatusContacts,
  getEmsApiStatusContacts,
  getEmsApiStatusPackages,
  getEmsMonthOptions,
  getEmsApiCustomColumnContacts,
  getEmsApiCustomColumnPackages,
  getEmsReferenceChannelState,
  getContactReminderState,
  getChatListPagination,
  getCustomEmsColumnContacts,
  getEmsStatusKey,
  getEmsStatusLabel,
  getChatStatusLabel,
  getEmsStatusToneClass,
  getEmsPhaseLabel,
  getChatPhaseLabel,
  getChatPhaseDescription,
  getEmsPhaseDescription,
  getChatContacts,
  isAutoCreatedChatContact,
  getConversationMessagesChronological,
  renderConversationMessageMedia,
  getConversationMediaUrl,
  getAttachmentKindLabel,
  isAiAssistedConversation,
  areAllFilteredContactsSelected,
  getWhatsAppReference,
  hasWhatsAppChannel,
  isContactConnected,
  getTrackingApiPagination,
  getTrackingApiAvailableStates,
  getTrackingApiAvailableServices,
  getTrackingApiAvailableCountries,
  getTrackingApiTableHead,
  renderTrackingApiRows,
  renderTrackingApiPagination,
  exportTrackingApiToExcel,
  getContactPackagesPagination,
  getContactPackageTypeOptions,
  getContactPackageStatusOptions,
  getFilteredContactPackages,
  renderContactPackagesRows,
  renderContactPackagesPagination,
  exportContactPackagesToExcel,
  exportLogsReportToExcel,
  getTrackingPipelineColumns,
  getTrackingPipelineStage,
  getContactPackagePipelineStage,
  getApiPipelineStateOptions,
  renderCountryWithFlag,
  getTrackingOriginPhoneValue,
  getTrackingDestinationPhoneValue,
  getContactPackageRemitenteName,
  getContactPackageDestinatarioName,
  getContactPackageRemitentePhone,
  getContactPackageDestinatarioPhone,
  findContactByReferenceValue,
  findContactByWhatsAppReferenceValue,
  getEmsStatePackagesForScope,
  getEmsStatePackagesModalPagination,
  getEmsPipelineScopePageState,
  goToEmsPipelineScopePage,
  getProntsColumnConfig,
  getProntsColumnKeys,
  getProntsColumnContacts,
  getProntsSelectedContact,
  getProntsMetaForColumn,
  getPipelineColumnConfig,
  getProntsTokenChips,
  prontsPresetMeta,
  buildProntsSimulationResponse,
  findPhoneCountry,
  getFlagIconClass,
  defaultWhatsAppCountry,
  contactChannelOptions,
  phoneCountryOptions,
  truncateText,
  getSegmentOptions,
  getContactUpdatedTime,
  getPhoneCountryLabel,
  getCountryLabel,
  getCountryIso2,
  getCountryIso2FromLabel,
  getGroupPickerResultsMarkup,
  openEmsPackageDetailModal,
  closeEmsPackageDetailModal,
  openEmsStatePackagesModal,
  closeEmsStatePackagesModal,
  goToPrevEmsStatePackagesPage,
  goToNextEmsStatePackagesPage,
})


let renderAppFrame: ReturnType<typeof requestAnimationFrame> | null = null

const closeTopbarProfileMenu = () => {
  if (!state.topbarProfileOpen) return
  state.topbarProfileOpen = false
  renderApp()
}

const renderAppNow = () => {
  const focusedFieldState = captureFocusedFieldState()
  const conversationThreadScrollState = captureConversationThreadScrollState()
  if (!isValidView(state.activeView)) {
    state.activeView = 'ems'
  }
  syncSidebarGroupWithActiveView()

  if (state.authLoading) {
    app.innerHTML = `
      <div class="login-shell">
        <div class="login-card is-loading">
          <div class="empty-state loading-state">Verificando sesion...</div>
        </div>
      </div>
    `
    return
  }

  const renderContext = createRenderContext()
  app.innerHTML =
    state.authToken && state.sessionUser
      ? renderAuthenticatedApp(renderContext)
      : renderLoginScreen(renderContext)
  syncChatRefreshLoop()
  syncDashboardRefreshLoop()
  restoreFocusedFieldState(focusedFieldState)

  if (!state.authToken || !state.sessionUser) {
    document.querySelector<HTMLFormElement>('#login-form')?.addEventListener('submit', (event) => {
      event.preventDefault()
      void submitLogin()
    })

    document.querySelector<HTMLFormElement>('#login-form')?.addEventListener('input', (event) => {
      const target = event.target as HTMLInputElement
      if (target.name === 'remember') {
        updateLoginFormField('remember', target.checked)
        return
      }
      if (!target.name) return
      updateLoginFormField(target.name as keyof LoginForm, target.value)
    })

    document.querySelectorAll<HTMLInputElement>('#login-form input[name="email"], #login-form input[name="password"]').forEach((input) => {
      input.addEventListener('focus', () => {
        clearDefaultLoginFieldOnFocus(input.name as 'email' | 'password')
      })
    })

    document
      .querySelector<HTMLButtonElement>('#password-toggle')
      ?.addEventListener('click', togglePasswordVisibility)

    return
  }

  if (!topbarProfileGlobalListenersInstalled) {
    document.addEventListener(
      'click',
      (event) => {
        if (!state.topbarProfileOpen) return
        const profileWrap = document.querySelector('.topbar-profile-wrap')
        const path = event.composedPath()
        if (profileWrap && path.includes(profileWrap)) return
        closeTopbarProfileMenu()
      },
      true,
    )

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return
      closeTopbarProfileMenu()
    })

    topbarProfileGlobalListenersInstalled = true
  }

  if (!messageNotificationInteractionListenersInstalled) {
    const unlockMessageNotificationTone = () => {
      messageNotificationToneUnlocked = true
      const audioContext = ensureMessageNotificationAudioContext()
      if (audioContext && audioContext.state === 'suspended') {
        void audioContext.resume().catch(() => undefined)
      }
      if (typeof window !== 'undefined' && typeof Notification !== 'undefined' && Notification.permission === 'default') {
        void Notification.requestPermission().catch(() => undefined)
      }
    }

    document.addEventListener('pointerdown', unlockMessageNotificationTone, { once: true, passive: true })
    document.addEventListener('keydown', unlockMessageNotificationTone, { once: true })
    messageNotificationInteractionListenersInstalled = true
  }

  if (!locationSyncListenerInstalled) {
    window.addEventListener('popstate', () => {
      const nextView = getViewFromLocation()
      if (!nextView) {
        if (state.sessionUser) {
          syncViewToLocation(state.activeView, { replace: true })
        }
        return
      }

      if (nextView === state.activeView) {
        return
      }

      state.activeView = nextView
      state.collapsedFlyoutGroup = null
      syncSidebarGroupWithActiveView()
      persistUiState()
      renderApp()
    })

    locationSyncListenerInstalled = true
  }

  document.querySelector<HTMLButtonElement>('#sidebar-toggle')?.addEventListener('click', toggleSidebar)
  document
    .querySelector<HTMLButtonElement>('#open-create-contact')
    ?.addEventListener('click', openCreateContactModal)
  document
    .querySelector<HTMLButtonElement>('#header-whatsapp-test-toggle')
    ?.addEventListener('click', () => void toggleWhatsAppTestMode())
  document
    .querySelector<HTMLButtonElement>('#header-ai-agent-toggle')
    ?.addEventListener('click', toggleGlobalAiAgent)
  document
    .querySelector<HTMLButtonElement>('#profile-toggle')
    ?.addEventListener('click', () => {
      state.topbarProfileOpen = !state.topbarProfileOpen
      renderApp()
    })
  document
    .querySelector<HTMLButtonElement>('#retry-load')
    ?.addEventListener('click', () => void loadDashboard())
  document
    .querySelector<HTMLButtonElement>('#logout-button')
    ?.addEventListener('click', () => void logout())

  document
    .querySelector<HTMLButtonElement>('#open-user-create-modal')
    ?.addEventListener('click', openCreateUserModal)

  document.querySelectorAll<HTMLButtonElement>('[data-edit-user]').forEach((button) => {
    button.addEventListener('click', () => {
      const userId = Number(button.dataset.editUser)
      if (Number.isFinite(userId)) {
        openEditUserModal(userId)
      }
    })
  })

  document.querySelectorAll<HTMLButtonElement>('[data-delete-user]').forEach((button) => {
    button.addEventListener('click', () => {
      const userId = Number(button.dataset.deleteUser)
      if (Number.isFinite(userId)) {
        void deleteUser(userId)
      }
    })
  })

  document.querySelectorAll<HTMLButtonElement>('.menu-group-trigger').forEach((button) => {
    button.addEventListener('click', () => {
      const group = button.dataset.group as MenuGroupKey
      toggleGroup(group)
    })
  })

  document
    .querySelectorAll<HTMLAnchorElement>('.menu-item, .menu-flyout-item')
    .forEach((button) => {
      button.addEventListener('click', (event) => {
        if (
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return
        }

        const view = button.dataset.view
        if (!view) {
          return
        }

        event.preventDefault()
        setActiveView(view as ViewKey)
      })
    })

  document.querySelector<HTMLSelectElement>('#logs-hours-filter')?.addEventListener('change', (event) => {
    updateLogsFilter('hours', (event.target as HTMLSelectElement).value)
    void loadLogsReport()
  })

  document.querySelector<HTMLSelectElement>('#logs-month-filter')?.addEventListener('change', (event) => {
    updateLogsMonthFilter((event.target as HTMLSelectElement).value)
    void loadLogsReport()
  })

  document.querySelector<HTMLSelectElement>('#logs-level-filter')?.addEventListener('change', (event) => {
    updateLogsFilter('level', (event.target as HTMLSelectElement).value)
    void loadLogsReport()
  })

  document.querySelector<HTMLInputElement>('#ems-search-input')?.addEventListener('input', (event) => {
    state.searchQuery = (event.currentTarget as HTMLInputElement).value
    state.chatListPage = 1
    renderApp()
  })

  document.querySelector<HTMLButtonElement>('#refresh-logs-report')?.addEventListener('click', () => {
    void loadLogsReport()
  })

  document.querySelector<HTMLButtonElement>('#export-logs-report')?.addEventListener('click', () => {
    void exportLogsReportToExcel()
  })

  document.querySelectorAll<HTMLButtonElement>('[data-export-tracking-api-excel]').forEach((button) => {
    button.addEventListener('click', () => {
      void exportTrackingApiToExcel()
    })
  })

  document.querySelectorAll<HTMLButtonElement>('[data-logs-page]').forEach((button) => {
    button.addEventListener('click', () => {
      const action = button.dataset.logsPage
      const pagination = state.logsReport?.pagination ?? { page: 1, totalPages: 1 }

      if (action === 'prev') {
        setLogsPage(pagination.page - 1)
        return
      }

      if (action === 'next') {
        setLogsPage(pagination.page + 1)
      }
    })
  })

  document
    .querySelector<HTMLButtonElement>('#add-international-package')
    ?.addEventListener('click', addInternationalPackage)

  document
    .querySelector<HTMLInputElement>('#international-file-input')
    ?.addEventListener('change', (event) => {
      const input = event.currentTarget as HTMLInputElement
      const file = input.files?.[0]
      if (!file) return

      void importInternationalPackages(file).catch((error) => {
        state.notice = error instanceof Error ? error.message : 'No se pudo importar el archivo.'
        renderApp()
      })
    })

  document.querySelectorAll<HTMLInputElement>('[data-international-field]').forEach((input) => {
    input.addEventListener('change', () => {
      const id = Number(input.dataset.packageId)
      const field = input.dataset.internationalField as Exclude<keyof InternationalPackage, 'id'>
      if (!id || !field) return
      updateInternationalPackage(id, field, input.value)
    })
  })

  document.querySelectorAll<HTMLButtonElement>('[data-delete-package]').forEach((button) => {
    button.addEventListener('click', () => {
      const id = Number(button.dataset.deletePackage)
      if (id) removeInternationalPackage(id)
    })
  })

  document.querySelectorAll<HTMLButtonElement>('[data-focus-package]').forEach((button) => {
    button.addEventListener('click', () => {
      const id = button.dataset.focusPackage
      document.querySelector<HTMLInputElement>(`[data-package-id="${id}"]`)?.focus()
    })
  })

  document.querySelector<HTMLInputElement>('#ems-search-input')?.addEventListener('input', (event) => {
    state.searchQuery = (event.currentTarget as HTMLInputElement).value
    renderApp()
  })

  document.querySelectorAll<HTMLInputElement>('[data-ems-column-search]').forEach((input) => {
    input.addEventListener('input', () => {
      const column = input.dataset.emsColumnSearch as EmsColumnKey | undefined
      if (!column) return
      setEmsSearchQueryForColumn(column, input.value)
      renderApp()
      void loadEmsPipelineScopePage(column, 1)
    })
  })

  document.querySelectorAll<HTMLElement>('[data-ems-drag-package]').forEach((item) => {
    item.addEventListener('dragstart', (event) => {
      const target = event.currentTarget as HTMLElement
      const packageCode = target.dataset.emsDragPackage
      const source = target.dataset.emsDragSource as EmsColumnKey | undefined

      if (!packageCode || !source) {
        return
      }

      event.dataTransfer?.setData('text/plain', JSON.stringify({ packageCode, source }))
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move'
      }

      target.classList.add('is-dragging')
    })

    item.addEventListener('dragend', () => {
      item.classList.remove('is-dragging')
    })
  })

  document.querySelectorAll<HTMLElement>('[data-ems-dropzone]').forEach((zone) => {
    zone.addEventListener('dragover', (event) => {
      event.preventDefault()
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'move'
      }
      zone.classList.add('is-drag-over')
    })

    zone.addEventListener('dragleave', () => {
      zone.classList.remove('is-drag-over')
    })

    zone.addEventListener('drop', (event) => {
      event.preventDefault()
      zone.classList.remove('is-drag-over')
      const raw = event.dataTransfer?.getData('text/plain')
      const targetStage = zone.dataset.emsDropzone as EmsColumnKey | undefined

      if (!raw || !targetStage) {
        return
      }

      try {
        const payload = JSON.parse(raw) as { packageCode?: string; source?: string }
        const packageCode = payload.packageCode?.trim()

        if (!packageCode) {
          return
        }

        void moveEmsPackageToStage(packageCode, targetStage)
      } catch {
        // ignore malformed drag payloads
      }
    })
  })

  document.querySelectorAll<HTMLButtonElement>('[data-pronts-column]').forEach((button) => {
    button.addEventListener('click', () => {
      const column = button.dataset.prontsColumn as ProntsColumnKey | undefined
      if (!column) return
      state.prontsActiveColumn = column
      renderApp()
    })
  })

  document.querySelectorAll<HTMLSelectElement>('[data-pronts-preset-select]').forEach((select) => {
    select.addEventListener('change', () => {
      const column = select.dataset.prontsPresetSelect as ProntsColumnKey | undefined
      const preset = select.value as ProntsPresetKey | undefined
      if (!column || !preset || !prontsPresetMeta[preset]) return
      applyProntsPreset(column, preset)
      state.prontsActiveColumn = column
      renderApp()
    })
  })

  document.querySelectorAll<HTMLTextAreaElement>('[data-pronts-system-input]').forEach((input) => {
    input.addEventListener('input', () => {
      const column = input.dataset.prontsSystemInput as ProntsColumnKey | undefined
      if (!column) return
      setProntsColumnConfig(column, { systemPrompt: input.value })
      renderApp()
    })
  })

  document.querySelectorAll<HTMLTextAreaElement>('[data-pronts-template-input]').forEach((input) => {
    input.addEventListener('input', () => {
      const column = input.dataset.prontsTemplateInput as ProntsColumnKey | undefined
      if (!column) return
      setProntsColumnConfig(column, { userTemplate: input.value })
      renderApp()
    })
  })

  document.querySelectorAll<HTMLInputElement>('[data-pronts-temperature-input]').forEach((input) => {
    input.addEventListener('input', () => {
      const column = input.dataset.prontsTemperatureInput as ProntsColumnKey | undefined
      if (!column) return
      setProntsColumnConfig(column, { temperature: Number(input.value) })
      renderApp()
    })
  })

  document.querySelectorAll<HTMLSelectElement>('[data-pronts-action-select]').forEach((select) => {
    select.addEventListener('change', () => {
      const column = select.dataset.prontsActionSelect as ProntsColumnKey | undefined
      if (!column) return
      setProntsColumnConfig(column, { action: select.value })
      renderApp()
    })
  })

  document.querySelectorAll<HTMLSelectElement>('[data-pronts-sample-select]').forEach((select) => {
    select.addEventListener('change', () => {
      const column = select.dataset.prontsSampleSelect as ProntsColumnKey | undefined
      if (!column) return
      const contactId = Number(select.value)
      setProntsColumnConfig(column, {
        sampleContactId: Number.isFinite(contactId) ? contactId : null,
      })
      renderApp()
    })
  })

  document.querySelectorAll<HTMLButtonElement>('[data-pronts-insert-token]').forEach((button) => {
    button.addEventListener('click', () => {
      const token = button.dataset.prontsInsertToken
      if (!token) return
      const column = state.prontsActiveColumn
      const config = getProntsColumnConfig(column)
      const updatedTemplate = `${config.userTemplate.trimEnd()} ${token}`.trim()
      setProntsColumnConfig(column, { userTemplate: updatedTemplate })
      renderApp()
    })
  })

  document.querySelector<HTMLButtonElement>('#pronts-reset-defaults')?.addEventListener('click', () => {
    resetProntsDefaults()
    state.notice = 'Se restauraron los prompts predeterminados. Guarda para aplicarlos al sistema.'
    renderApp()
  })

  document.querySelector<HTMLButtonElement>('#pronts-save-config')?.addEventListener('click', () => {
    void saveProntsConfigToServer()
  })

  document.querySelector<HTMLButtonElement>('#pronts-run-simulation')?.addEventListener('click', () => {
    runProntsSimulation()
    renderApp()
  })

  document.querySelectorAll<HTMLInputElement>('[data-pipeline-title-input]').forEach((input) => {
    input.addEventListener('input', () => {
      const column = input.dataset.pipelineTitleInput as EmsColumnKey | undefined
      if (!column) return
      setPipelineColumnConfig(column, { title: input.value })
      renderApp()
    })
  })

  document.querySelectorAll<HTMLInputElement>('[data-pipeline-helper-input]').forEach((input) => {
    input.addEventListener('input', () => {
      const column = input.dataset.pipelineHelperInput as EmsColumnKey | undefined
      if (!column) return
      setPipelineColumnConfig(column, { helper: input.value })
      renderApp()
    })
  })

  document.querySelector<HTMLButtonElement>('#pipeline-reset-defaults')?.addEventListener('click', () => {
    resetPipelineDefaults()
    state.notice = 'Se restauró el pipeline predeterminado. Guarda para aplicarlo al sistema.'
    renderApp()
  })

  document.querySelector<HTMLButtonElement>('#pipeline-save-config')?.addEventListener('click', () => {
    void savePipelineConfigToServer()
  })

  document.querySelectorAll<HTMLButtonElement>('[data-ems-status-filter]').forEach((button) => {
    button.addEventListener('click', () => {
      const filter = button.dataset.emsStatusFilter as EmsStatusFilter | undefined
      if (!filter) return
      state.emsStatusFilter = filter
      state.chatListPage = 1
      renderApp()
    })
  })

  document
    .querySelector<HTMLButtonElement>('[data-clear-ems-filters]')
    ?.addEventListener('click', () => {
      state.emsStatusFilter = 'all'
      state.searchQuery = ''
      state.chatListPage = 1
      renderApp()
    })

  document.querySelectorAll<HTMLButtonElement>('[data-open-api-pipeline-states]').forEach((button) => {
    button.addEventListener('click', () => {
      const scope = button.dataset.openApiPipelineStates
      void openCustomEmsStateModal(scope && scope !== 'all' ? (scope as EmsColumnKey) : null)
    })
  })

  document.querySelectorAll<HTMLButtonElement>('[data-open-ems-state-packages]').forEach((button) => {
    button.addEventListener('click', () => {
      const scope = button.dataset.openEmsStatePackages
      openEmsStatePackagesModal(scope && scope !== 'all' ? (scope as EmsColumnKey) : null)
      openEmsStatePackagesModal(scope ? (scope as EmsColumnKey) : null)
    })
  })

  document.querySelectorAll<HTMLButtonElement>('[data-open-ems-package-detail]').forEach((button) => {
    button.addEventListener('click', () => {
      const packageId = button.dataset.openEmsPackageDetail
      if (!packageId) return
      openEmsPackageDetailModal(packageId)
    })
  })

  document.querySelectorAll<HTMLButtonElement>('[data-open-ems-contact-target]').forEach((button) => {
    button.addEventListener('click', () => {
      const contactId = Number(button.dataset.openEmsContactTarget)
      if (!Number.isFinite(contactId)) return
      void openContactConversationOrProfile(contactId)
    })
  })

  document.querySelectorAll<HTMLButtonElement>('[data-sync-ems-pipeline]').forEach((button) => {
    button.addEventListener('click', () => {
      if (state.emsPipelineSyncState === 'loading') {
        return
      }

      void refreshEmsPipelineFromApis()
    })
  })

  document.querySelector<HTMLSelectElement>('[data-ems-month-filter]')?.addEventListener('change', (event) => {
    state.emsMonthFilter = (event.currentTarget as HTMLSelectElement).value || 'all'
    persistUiState()
    renderApp()
    void reloadEmsPipelinePages()
  })

  document.querySelector<HTMLButtonElement>('[data-create-custom-ems-column]')?.addEventListener('click', () => {
    openCreatePipelineColumnModal()
  })

  document
    .querySelector<HTMLButtonElement>('#close-create-pipeline-column-modal')
    ?.addEventListener('click', closeCreatePipelineColumnModal)

  document
    .querySelector<HTMLButtonElement>('#cancel-create-pipeline-column-modal')
    ?.addEventListener('click', closeCreatePipelineColumnModal)

  document
    .querySelector<HTMLDivElement>('#create-pipeline-column-modal-backdrop')
    ?.addEventListener('click', (event) => {
      if (event.target === event.currentTarget) {
        closeCreatePipelineColumnModal()
      }
    })

  document
    .querySelector<HTMLFormElement>('#create-pipeline-column-form')
    ?.addEventListener('submit', (event) => {
      event.preventDefault()
      void submitCreatePipelineColumn()
    })

  document.querySelectorAll<HTMLInputElement>('[data-create-pipeline-column-input]').forEach((input) => {
    input.addEventListener('input', () => {
      const field = input.dataset.createPipelineColumnInput as keyof CreatePipelineColumnForm | undefined
      if (!field) return
      state.createPipelineColumnForm = {
        ...state.createPipelineColumnForm,
        [field]: input.value,
      }
    })
  })

  document.querySelectorAll<HTMLSelectElement>('[data-create-pipeline-column-select]').forEach((select) => {
    select.addEventListener('change', () => {
      const field = select.dataset.createPipelineColumnSelect as keyof CreatePipelineColumnForm | undefined
      if (!field) return
      state.createPipelineColumnForm = {
        ...state.createPipelineColumnForm,
        [field]: select.value as ProntsPresetKey,
      }
    })
  })

  document
    .querySelector<HTMLButtonElement>('#close-custom-ems-state-modal')
    ?.addEventListener('click', closeCustomEmsStateModal)

  document
    .querySelector<HTMLButtonElement>('#cancel-custom-ems-state-modal')
    ?.addEventListener('click', closeCustomEmsStateModal)

  document
    .querySelector<HTMLDivElement>('#custom-ems-state-modal-backdrop')
    ?.addEventListener('click', (event) => {
      if (event.target === event.currentTarget) {
        closeCustomEmsStateModal()
      }
    })

  document.querySelectorAll<HTMLButtonElement>('[data-register-api-pipeline-state]').forEach((button) => {
    button.addEventListener('click', () => {
      const stateKey = button.dataset.registerApiPipelineState
      if (!stateKey) return
      void includeApiPipelineStateInColumn(state.customEmsStateModalScope, stateKey)
    })
  })

  document.querySelectorAll<HTMLButtonElement>('[data-remove-custom-ems-state]').forEach((button) => {
    button.addEventListener('click', () => {
      const columnId = button.dataset.removeCustomEmsState
      if (!columnId) return
      removeCustomPipelineColumn(columnId)
      state.notice = 'Columna EMS eliminada. Se guardará en el sistema.'
      void savePipelineConfigToServer()
    })
  })

  document.querySelector<HTMLButtonElement>('#refresh-tracking-packages')?.addEventListener('click', () => {
    void loadTrackingApiPackages()
  })

  document
    .querySelector<HTMLFormElement>('#package-code-lookup-form')
    ?.addEventListener('submit', (event) => {
      event.preventDefault()
      void lookupPackageCode()
    })

  document
    .querySelector<HTMLInputElement>('#package-code-lookup-input')
    ?.addEventListener('input', (event) => {
      state.packageCodeLookupQuery = (event.currentTarget as HTMLInputElement).value
      if (state.packageCodeLookupError) {
        state.packageCodeLookupError = null
        renderApp()
      }
    })

  document.querySelectorAll<HTMLButtonElement>('[data-open-package-code-lookup]').forEach((button) => {
    button.addEventListener('click', openPackageCodeLookupModal)
  })

  document
    .querySelector<HTMLButtonElement>('#close-package-code-lookup-modal')
    ?.addEventListener('click', closePackageCodeLookupModal)

  document
    .querySelector<HTMLButtonElement>('#cancel-package-code-lookup-modal')
    ?.addEventListener('click', closePackageCodeLookupModal)

  document
    .querySelector<HTMLDivElement>('#package-code-lookup-modal-backdrop')
    ?.addEventListener('click', (event) => {
      if (event.target === event.currentTarget) {
        closePackageCodeLookupModal()
      }
    })

  document
    .querySelector<HTMLButtonElement>('#close-ems-package-detail-modal')
    ?.addEventListener('click', closeEmsPackageDetailModal)

  document
    .querySelector<HTMLDivElement>('#ems-package-detail-modal-backdrop')
    ?.addEventListener('click', (event) => {
      if (event.target === event.currentTarget) {
        closeEmsPackageDetailModal()
      }
    })

  document
    .querySelector<HTMLButtonElement>('#close-ems-state-packages-modal')
    ?.addEventListener('click', closeEmsStatePackagesModal)

  document
    .querySelector<HTMLButtonElement>('#cancel-ems-state-packages-modal')
    ?.addEventListener('click', closeEmsStatePackagesModal)

  document
    .querySelector<HTMLDivElement>('#ems-state-packages-modal-backdrop')
    ?.addEventListener('click', (event) => {
      if (event.target === event.currentTarget) {
        closeEmsStatePackagesModal()
      }
    })

  document.querySelectorAll<HTMLButtonElement>('[data-ems-state-packages-page]').forEach((button) => {
    button.addEventListener('click', () => {
      const action = button.dataset.emsStatePackagesPage
      if (action === 'prev') {
        goToPrevEmsStatePackagesPage()
        return
      }

      if (action === 'next') {
        goToNextEmsStatePackagesPage()
      }
    })
  })

  document.querySelectorAll<HTMLButtonElement>('[data-ems-column-page]').forEach((button) => {
    button.addEventListener('click', () => {
      const payload = button.dataset.emsColumnPage
      if (!payload) return

      const [scope, direction] = payload.split(':')
      if (!scope || !direction) return

      const pageState = getEmsPipelineScopePageState(scope)
      const nextPage = direction === 'prev' ? pageState.currentPage - 1 : pageState.currentPage + 1
      goToEmsPipelineScopePage(scope, nextPage)
    })
  })

  document
    .querySelector<HTMLButtonElement>('#clear-package-code-lookup-filter')
    ?.addEventListener('click', clearPackageCodeLookupFilter)

  document.querySelector<HTMLButtonElement>('#tracking-page-prev')?.addEventListener('click', () => {
    if (state.trackingApiState === 'loading') return
    if (state.trackingApiPage <= 1) return
    state.trackingApiPage -= 1
    const isFiltered = state.trackingApiStateFilter !== 'all' || Boolean(state.packageCodeLookupResult?.found)

    if (!isFiltered) {
      void loadTrackingApiPackages()
      return
    }

    renderApp()
  })

  document.querySelector<HTMLButtonElement>('#tracking-page-next')?.addEventListener('click', () => {
    if (state.trackingApiState === 'loading') return
    const pagination = getTrackingApiPagination()
    const isFiltered = state.trackingApiStateFilter !== 'all' || Boolean(state.packageCodeLookupResult?.found)

    if (!isFiltered) {
      if (!state.trackingApiHasMore) return
      state.trackingApiPage += 1
      void loadTrackingApiPackages()
      return
    }

    if (pagination.currentPage >= pagination.totalPages) return
    state.trackingApiPage += 1
    renderApp()
  })

  document.querySelector<HTMLSelectElement>('#tracking-api-state-filter')?.addEventListener('change', (event) => {
    state.trackingApiStateFilter = (event.currentTarget as HTMLSelectElement).value
    state.trackingApiPage = 1
    if (state.trackingApiCatalogPackages.length === 0 && state.trackingApiCatalogState !== 'loading') {
      void loadTrackingApiCatalogPackages()
      return
    }
    renderApp()
    void loadTrackingApiCatalogPackages()
  })

  document.querySelector<HTMLSelectElement>('#tracking-api-service-filter')?.addEventListener('change', (event) => {
    state.trackingApiServiceFilter = (event.currentTarget as HTMLSelectElement).value
    state.trackingApiPage = 1
    void loadTrackingApiCatalogPackages()
  })

  document.querySelector<HTMLSelectElement>('#tracking-api-origin-filter')?.addEventListener('change', (event) => {
    state.trackingApiOriginFilter = (event.currentTarget as HTMLSelectElement).value
    state.trackingApiPage = 1
    void loadTrackingApiCatalogPackages()
  })

  document.querySelector<HTMLSelectElement>('#tracking-api-destination-filter')?.addEventListener('change', (event) => {
    state.trackingApiDestinationFilter = (event.currentTarget as HTMLSelectElement).value
    state.trackingApiPage = 1
    void loadTrackingApiCatalogPackages()
  })

  document.querySelector<HTMLFormElement>('#tracking-api-code-form')?.addEventListener('submit', (event) => {
    event.preventDefault()
    state.packageCodeLookupQuery = state.packageCodeLookupQuery.trim()
    state.trackingApiPage = 1
    void lookupPackageCode()
  })

  document.querySelector<HTMLInputElement>('#tracking-api-code-search')?.addEventListener('input', (event) => {
    state.packageCodeLookupQuery = (event.currentTarget as HTMLInputElement).value
  })

  document.querySelector<HTMLButtonElement>('#tracking-api-code-clear')?.addEventListener('click', () => {
    state.packageCodeLookupQuery = ''
    state.trackingApiPage = 1
    state.packageCodeLookupResult = null
    renderApp()
  })

  document.querySelector<HTMLButtonElement>('#contact-packages-page-prev')?.addEventListener('click', () => {
    if (state.contactPackagesPage <= 1 || state.contactPackagesState === 'loading') return
    state.contactPackagesPage -= 1
    void loadContactPackages()
  })

  document.querySelector<HTMLButtonElement>('#contact-packages-page-next')?.addEventListener('click', () => {
    if (!state.contactPackagesHasMore || state.contactPackagesState === 'loading') return
    state.contactPackagesPage += 1
    void loadContactPackages()
  })

  document.querySelector<HTMLSelectElement>('#contact-packages-type-filter')?.addEventListener('change', (event) => {
    state.contactPackagesTypeFilter = (event.currentTarget as HTMLSelectElement).value
    if (state.contactPackagesTypeFilter !== 'all') {
      void ensureAllContactPackagesForFilters()
      return
    }
    renderApp()
  })

  document.querySelector<HTMLSelectElement>('#contact-packages-status-filter')?.addEventListener('change', (event) => {
    state.contactPackagesStatusFilter = (event.currentTarget as HTMLSelectElement).value
    if (state.contactPackagesTypeFilter !== 'all' || state.contactPackagesStatusFilter !== 'all') {
      void ensureAllContactPackagesForFilters()
      return
    }
    renderApp()
  })

  document.querySelectorAll<HTMLButtonElement>('[data-contact-packages-status-chip]').forEach((button) => {
    button.addEventListener('click', () => {
      const status = button.dataset.contactPackagesStatusChip
      if (!status) return

      state.contactPackagesStatusFilter = status
      if (state.contactPackagesTypeFilter !== 'all' || state.contactPackagesStatusFilter !== 'all') {
        void ensureAllContactPackagesForFilters()
        return
      }
      renderApp()
    })
  })

  document.querySelector<HTMLButtonElement>('#export-contact-packages')?.addEventListener('click', () => {
    void exportContactPackagesToExcel()
  })

  document.querySelectorAll<HTMLButtonElement>('[data-tracking-info]').forEach((button) => {
    button.addEventListener('click', () => {
      const trackingId = button.dataset.trackingInfo
      if (!trackingId) return
      openTrackingInfoModal(trackingId)
    })
  })

  document
    .querySelector<HTMLSelectElement>('#segment-filter')
    ?.addEventListener('change', (event) => {
      state.segmentFilter = (event.currentTarget as HTMLSelectElement).value
      state.contactListPage = 1
      renderApp()
    })

  document
    .querySelector<HTMLSelectElement>('#status-filter')
    ?.addEventListener('change', (event) => {
      state.statusFilter = (event.currentTarget as HTMLSelectElement).value
      state.contactListPage = 1
      renderApp()
    })

  document
    .querySelector<HTMLButtonElement>('#close-create-contact')
    ?.addEventListener('click', closeCreateContactModal)
  document
    .querySelector<HTMLButtonElement>('#cancel-create-contact')
    ?.addEventListener('click', () => {
      if (state.createContactStep === 'personal') {
        closeCreateContactModal()
        return
      }

      if (state.createContactStep === 'details') {
        goToCreateContactStep('channels')
        return
      }

      goToCreateContactStep('personal')
    })

  document
    .querySelector<HTMLButtonElement>('#continue-create-contact')
    ?.addEventListener('click', continueCreateContactStep)

  document.querySelectorAll<HTMLButtonElement>('[data-contact-step]').forEach((button) => {
    button.addEventListener('click', () => {
      if (state.contactModalMode !== 'edit') return
      const step = button.dataset.contactStep as CreateContactStep | undefined
      if (!step) return
      goToCreateContactStep(step)
    })
  })

  document.querySelector<HTMLDivElement>('#modal-backdrop')?.addEventListener('click', (event) => {
    if (event.target === event.currentTarget) {
      closeCreateContactModal()
    }
  })

  document
    .querySelector<HTMLButtonElement>('#close-send-message')
    ?.addEventListener('click', closeSendMessageModal)
  document
    .querySelector<HTMLButtonElement>('#cancel-send-message')
    ?.addEventListener('click', closeSendMessageModal)

  document
    .querySelector<HTMLButtonElement>('#close-contact-profile-modal')
    ?.addEventListener('click', closeContactProfileModal)

  document
    .querySelector<HTMLButtonElement>('#close-tracking-info-modal')
    ?.addEventListener('click', closeTrackingInfoModal)

  document
    .querySelector<HTMLDivElement>('#contact-profile-modal-backdrop')
    ?.addEventListener('click', (event) => {
      if (event.target === event.currentTarget) {
        closeContactProfileModal()
      }
    })

  document
    .querySelector<HTMLDivElement>('#tracking-info-modal-backdrop')
    ?.addEventListener('click', (event) => {
      if (event.target === event.currentTarget) {
        closeTrackingInfoModal()
      }
    })

  document.querySelector<HTMLButtonElement>('#close-user-modal')?.addEventListener('click', closeUserModal)
  document
    .querySelector<HTMLButtonElement>('#close-user-modal-secondary')
    ?.addEventListener('click', closeUserModal)
  document.querySelector<HTMLDivElement>('#user-modal-backdrop')?.addEventListener('click', (event) => {
    if (event.target === event.currentTarget) {
      closeUserModal()
    }
  })

  document.querySelector<HTMLFormElement>('#user-form')?.addEventListener('submit', (event) => {
    event.preventDefault()
    void submitUserForm()
  })

  document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('#user-form input, #user-form select').forEach((input) => {
    input.addEventListener('input', () => {
      const target = input as HTMLInputElement | HTMLSelectElement
      if (target.name === 'fullName') {
        state.userForm.fullName = target.value
      } else if (target.name === 'email') {
        state.userForm.email = target.value
      } else if (target.name === 'password') {
        state.userForm.password = target.value
      } else if (target.name === 'role') {
        state.userForm.role = target.value
      }
      state.userSubmitError = null
    })
  })

  document
    .querySelector<HTMLButtonElement>('[data-ai-suggest-reply]')
    ?.addEventListener('click', () => {
      void suggestConversationReply()
    })

  document
    .querySelector<HTMLDivElement>('#message-modal-backdrop')
    ?.addEventListener('click', (event) => {
      if (event.target === event.currentTarget) {
        closeSendMessageModal()
      }
    })

  document
    .querySelector<HTMLFormElement>('#send-message-form')
    ?.addEventListener('input', (event) => {
      const target = event.target as HTMLInputElement | HTMLTextAreaElement

      if (target instanceof HTMLInputElement && target.type === 'file') {
        const file = target.files?.[0] ?? null
        state.sendMessageForm.attachment = file
        state.sendMessageForm.attachmentName = file?.name ?? ''
        state.sendMessageForm.attachmentType = file?.type ?? ''
        renderApp()
        return
      }

      if (target.name === 'message' || target.name === 'targetReference') {
        state.sendMessageForm[target.name as 'message' | 'targetReference'] = target.value
      }
    })

  document
    .querySelector<HTMLFormElement>('#send-message-form')
    ?.addEventListener('change', (event) => {
      const target = event.target as HTMLInputElement

      if (target instanceof HTMLInputElement && target.type === 'file') {
        const file = target.files?.[0] ?? null
        state.sendMessageForm.attachment = file
        state.sendMessageForm.attachmentName = file?.name ?? ''
        state.sendMessageForm.attachmentType = file?.type ?? ''
        renderApp()
      }
    })

  document
    .querySelector<HTMLFormElement>('#create-contact-form')
    ?.addEventListener('input', (event) => {
      const target = event.target as HTMLInputElement | HTMLSelectElement

      if (target.classList.contains('whatsapp-country-select')) {
        updateWhatsAppCountrySearch(target.value)
        return
      }

      if (target.classList.contains('whatsapp-local-number')) {
        updateWhatsAppLocalNumber(target.value)
        return
      }

      if (target.classList.contains('contact-channel-reference')) {
        const channel = target.dataset.channel
        if (!channel) return
        updateContactChannelReference(channel, target.value)
        return
      }

      if (!target.name) return
      updateContactFormField(
        target.name as 'name' | 'company' | 'segment' | 'owner' | 'status' | 'score',
        target.value,
      )
    })

  document
    .querySelectorAll<HTMLInputElement>('.contact-channel-check')
    .forEach((checkbox) => {
      checkbox.addEventListener('change', (event) => {
        const target = event.currentTarget as HTMLInputElement
        const channel = target.dataset.channel
        if (!channel) return
        toggleContactChannel(channel, target.checked)
      })
    })

  document.querySelectorAll<HTMLButtonElement>('[data-edit-contact]').forEach((button) => {
    button.addEventListener('click', () => {
      const contactId = Number(button.dataset.editContact)
      if (!Number.isFinite(contactId)) return
      openEditContactModal(contactId)
    })
  })

  document
    .querySelector<HTMLFormElement>('#create-contact-form')
    ?.addEventListener('submit', (event) => {
      event.preventDefault()
      void submitCreateContact()
    })

  document
    .querySelector<HTMLFormElement>('#send-message-form')
    ?.addEventListener('input', (event) => {
      const target = event.target as HTMLInputElement | HTMLTextAreaElement
      if (!target.name) return
      updateSendMessageField(target.name as keyof WhatsAppMessageForm, target.value)
    })

  document
    .querySelector<HTMLFormElement>('#send-message-form')
    ?.addEventListener('submit', (event) => {
      event.preventDefault()
      void submitSendWhatsAppMessage()
    })

  document
    .querySelector<HTMLFormElement>('#chat-composer-form')
    ?.addEventListener('input', (event) => {
      const target = event.target as HTMLTextAreaElement
      if (target.name !== 'message') return
      updateSendMessageField('message', target.value)
    })

  document
    .querySelector<HTMLFormElement>('#chat-composer-form')
    ?.addEventListener('submit', (event) => {
      event.preventDefault()
      void submitSendWhatsAppMessage()
    })

  document.querySelectorAll<HTMLButtonElement>('[data-send-whatsapp]').forEach((button) => {
    button.addEventListener('click', () => {
      const contactId = Number(button.dataset.sendWhatsapp)
      if (!Number.isFinite(contactId)) return
      openSendMessageModal(contactId)
    })
  })

  document.querySelectorAll<HTMLButtonElement>('[data-chat-list-page]').forEach((button) => {
    button.addEventListener('click', () => {
      const action = button.dataset.chatListPage
      const pagination = getChatListPagination()

      if (action === 'prev') {
        setChatListPage(pagination.currentPage - 1)
        return
      }

      if (action === 'next') {
        setChatListPage(pagination.currentPage + 1)
      }
    })
  })

  document.querySelectorAll<HTMLButtonElement>('[data-contacts-list-page]').forEach((button) => {
    button.addEventListener('click', () => {
      const action = button.dataset.contactsListPage
      const pagination = getContactsPagination()

      if (action === 'prev') {
        setContactsListPage(pagination.currentPage - 1)
        return
      }

      if (action === 'next') {
        setContactsListPage(pagination.currentPage + 1)
      }
    })
  })

  document.querySelectorAll<HTMLButtonElement>('[data-open-chat]').forEach((button) => {
    button.addEventListener('click', () => {
      const contactId = Number(button.dataset.openChat)
      if (!Number.isFinite(contactId)) return
      void openConversationModal(contactId)
    })
  })

  document.querySelectorAll<HTMLButtonElement>('[data-dismiss-message-notification]').forEach((button) => {
    button.addEventListener('click', () => {
      const notificationId = button.dataset.dismissMessageNotification
      if (!notificationId) return
      dismissMessageNotification(notificationId)
    })
  })

  document.querySelectorAll<HTMLInputElement>('[data-ai-toggle-conversation]').forEach((input) => {
    input.addEventListener('change', () => {
      const contactId = Number(input.dataset.aiToggleConversation)
      if (!Number.isFinite(contactId)) return
      void toggleAiAssistanceForConversation(contactId, input.checked)
    })
  })

  document.querySelectorAll<HTMLButtonElement>('[data-add-chat-contact]').forEach((button) => {
    button.addEventListener('click', () => {
      const contactId = Number(button.dataset.addChatContact)
      if (!Number.isFinite(contactId)) return
      openChatContactModal(contactId)
    })
  })

  document.querySelectorAll<HTMLButtonElement>('[data-open-contact-profile]').forEach((button) => {
    button.addEventListener('click', () => {
      const contactId = Number(button.dataset.openContactProfile)
      if (!Number.isFinite(contactId)) return
      openContactProfileModal(contactId)
    })
  })

  document.querySelectorAll<HTMLButtonElement>('[data-toggle-message-expand]').forEach((button) => {
    button.addEventListener('click', () => {
      const messageId = Number(button.dataset.toggleMessageExpand)
      if (!Number.isFinite(messageId)) return
      toggleConversationMessageExpansion(messageId)
    })
  })

  document.querySelectorAll<HTMLButtonElement>('[data-profile-field]').forEach((button) => {
    button.addEventListener('click', () => {
      const contactId = state.conversationData.contact.id
      if (!Number.isFinite(contactId)) return
      openEditContactModal(contactId)
    })
  })

  document
    .querySelector<HTMLButtonElement>('#open-edit-contact-from-profile')
    ?.addEventListener('click', () => {
      const contactId = state.conversationData.contact.id
      if (!Number.isFinite(contactId)) return
      openEditContactModal(contactId)
    })

  document
    .querySelector<HTMLInputElement>('#select-all-contacts')
    ?.addEventListener('change', (event) => {
      toggleAllFilteredContacts((event.currentTarget as HTMLInputElement).checked)
    })

  document
    .querySelector<HTMLButtonElement>('#open-group-create-modal')
    ?.addEventListener('click', openGroupCreateModal)

  document.querySelectorAll<HTMLInputElement>('[data-contact-select]').forEach((input) => {
    input.addEventListener('change', () => {
      const contactId = Number(input.dataset.contactSelect)
      if (!Number.isFinite(contactId)) return
      toggleContactSelection(contactId, input.checked)
    })
  })

  document
    .querySelector<HTMLFormElement>('#contact-group-form')
    ?.addEventListener('input', (event) => {
      const target = event.target as HTMLInputElement
      if (!target.name) return

      if (target.name === 'group-contact-query') {
        updateGroupContactPickerField('query', target.value)
        updateGroupContactPickerField('contactId', '')
        refreshGroupPickerResults()
        return
      }

      updateGroupCreateField(target.name as keyof GroupCreateForm, target.value)
    })

  document
    .querySelector<HTMLFormElement>('#contact-group-form')
    ?.addEventListener('submit', (event) => {
      event.preventDefault()
      void submitCreateContactGroup()
    })

  document
    .querySelector<HTMLButtonElement>('#cancel-group-create')
    ?.addEventListener('click', closeGroupCreateModal)

  bindGroupPickerInteractions()

  document
    .querySelector<HTMLButtonElement>('#close-group-create-modal')
    ?.addEventListener('click', closeGroupCreateModal)

  document
    .querySelector<HTMLDivElement>('#group-create-modal-backdrop')
    ?.addEventListener('click', (event) => {
      if (event.target === event.currentTarget) {
        closeGroupCreateModal()
      }
    })

  document.querySelectorAll<HTMLButtonElement>('[data-open-add-members-group]').forEach((button) => {
    button.addEventListener('click', () => {
      const groupId = Number(button.dataset.openAddMembersGroup)
      if (!Number.isFinite(groupId)) return
      openAddMembersToGroupModal(groupId)
    })
  })

  document.querySelectorAll<HTMLButtonElement>('[data-remove-group-member]').forEach((button) => {
    button.addEventListener('click', () => {
      const rawValue = button.dataset.removeGroupMember
      if (!rawValue) return
      const [groupIdRaw, contactIdRaw] = rawValue.split(':')
      const groupId = Number(groupIdRaw)
      const contactId = Number(contactIdRaw)
      if (!Number.isFinite(groupId) || !Number.isFinite(contactId)) return
      void removeMemberFromGroup(groupId, contactId)
    })
  })

  document.querySelectorAll<HTMLButtonElement>('[data-send-group]').forEach((button) => {
    button.addEventListener('click', () => {
      const groupId = Number(button.dataset.sendGroup)
      if (!Number.isFinite(groupId)) return
      openGroupSendModal(groupId)
    })
  })

  document
    .querySelector<HTMLButtonElement>('#delete-conversation-btn')
    ?.addEventListener('click', () => {
      void deleteConversation()
    })

  document
    .querySelector<HTMLButtonElement>('#close-conversation-modal')
    ?.addEventListener('click', closeConversationModal)

  document
    .querySelector<HTMLDivElement>('#conversation-modal-backdrop')
    ?.addEventListener('click', (event) => {
      if (event.target === event.currentTarget) {
        closeConversationModal()
      }
    })

  document
    .querySelector<HTMLFormElement>('#group-send-form')
    ?.addEventListener('input', (event) => {
      const target = event.target as HTMLTextAreaElement
      if (target.name !== 'message') return
      state.groupSendForm.message = target.value
    })

  document
    .querySelector<HTMLFormElement>('#group-send-form')
    ?.addEventListener('submit', (event) => {
      event.preventDefault()
      void submitGroupSendMessage()
    })

  document
    .querySelector<HTMLButtonElement>('#cancel-group-send')
    ?.addEventListener('click', closeGroupSendModal)

  document
    .querySelector<HTMLButtonElement>('#close-group-send-modal')
    ?.addEventListener('click', closeGroupSendModal)

  document
    .querySelector<HTMLDivElement>('#group-send-modal-backdrop')
    ?.addEventListener('click', (event) => {
      if (event.target === event.currentTarget) {
        closeGroupSendModal()
      }
    })

  document
    .querySelector<HTMLFormElement>('#whatsapp-config-form')
    ?.addEventListener('input', (event) => {
      const target = event.target as HTMLInputElement
      if (!target.name) return
      updateWhatsAppConfigField(target.name as keyof WhatsAppConfigForm, target.value)
    })

  document
    .querySelector<HTMLFormElement>('#whatsapp-config-form')
    ?.addEventListener('submit', (event) => {
      event.preventDefault()
      void submitWhatsAppConfig()
    })

  document
    .querySelector<HTMLFormElement>('#whatsapp-test-form')
    ?.addEventListener('input', (event) => {
      const target = event.target as HTMLInputElement | HTMLTextAreaElement
      if (!target.name) return
      updateWhatsAppTestField(target.name as keyof WhatsAppTestForm, target.value)
    })

  document
    .querySelector<HTMLFormElement>('#whatsapp-test-form')
    ?.addEventListener('submit', (event) => {
      event.preventDefault()
      void submitWhatsAppTestMessage()
    })

  document
    .querySelector<HTMLFormElement>('#whatsapp-test-numbers-form')
    ?.addEventListener('input', (event) => {
      const target = event.target as HTMLInputElement
      if (target.name !== 'testNumber') return
      updateWhatsAppTestNumberDraft(target.value)
    })

  document.querySelector<HTMLSelectElement>('#whatsapp-test-number-country')?.addEventListener('change', (event) => {
    state.whatsappTestNumberCountry = (event.currentTarget as HTMLSelectElement).value
    renderApp()
  })

  document
    .querySelector<HTMLFormElement>('#whatsapp-test-numbers-form')
    ?.addEventListener('submit', (event) => {
      event.preventDefault()
      void submitWhatsAppTestNumber()
    })

  document
    .querySelector<HTMLButtonElement>('#cancel-whatsapp-test-number-edit')
    ?.addEventListener('click', cancelEditingWhatsAppTestNumber)

  document.querySelectorAll<HTMLButtonElement>('[data-edit-test-number]').forEach((button) => {
    button.addEventListener('click', () => {
      const number = button.dataset.editTestNumber
      if (number) {
        startEditingWhatsAppTestNumber(number)
      }
    })
  })

  document.querySelectorAll<HTMLButtonElement>('[data-delete-test-number]').forEach((button) => {
    button.addEventListener('click', () => {
      const number = button.dataset.deleteTestNumber
      if (number) {
        void deleteWhatsAppTestNumber(number)
      }
    })
  })

  syncChatRefreshLoop()

  if (
    (state.activeView === 'chat' || state.isConversationModalOpen) &&
    state.conversationState !== 'loading' &&
    state.conversationData.messages.length > 0
  ) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        restoreConversationThreadScrollState(conversationThreadScrollState)
      })
    })
  }
}

const renderApp = () => {
  if (renderAppFrame !== null) {
    return
  }

  renderAppFrame = requestAnimationFrame(() => {
    renderAppFrame = null
    renderAppNow()
  })
}

const loadDashboard = async (options: { silent?: boolean } = {}) => {
  if (!state.authToken) {
    state.loading = false
    state.error = null
    if (!options.silent) {
      state.loginError = 'Inicia sesion para cargar el dashboard.'
      renderApp()
    }
    return
  }

  if (dashboardRefreshInFlight) {
    return
  }

  dashboardRefreshInFlight = true

  const shouldBlockWorkspace = state.data === null && !options.silent
  if (shouldBlockWorkspace) {
    state.loading = true
    state.error = null
    renderApp()
  }

  try {
    const previousContacts = state.data?.contacts ?? []
    const response = await authFetch('/api/dashboard', { timeoutMs: 60000 })
    const payload = await parseApiPayload(response)

    if (response.status === 401) {
      clearSession()
      state.loginError = 'Tu sesion expiro. Vuelve a iniciar sesion.'
      renderApp()
      return
    }

    if (!response.ok) {
      throw new Error(
        (payload?.error as string) || (payload?.message as string) || 'No se pudo cargar el dashboard.',
      )
    }

    state.data = payload as DashboardData
    const nextContacts = state.data.contacts ?? []
    const validIds = new Set(state.data.contacts.map((contact) => contact.id))
    state.selectedContactIds = new Set(
      [...state.selectedContactIds].filter((contactId) => validIds.has(contactId)),
    )
    syncWhatsAppConfigFromDashboard(state.data)
    syncProntsConfigFromDashboard(state.data)
    syncPipelineConfigFromDashboard(state.data)
    syncEmsStageOverridesFromDashboard(state.data)

    if (previousContacts.length > 0 && nextContacts.length > 0) {
      const previousContactsById = new Map(previousContacts.map((contact) => [contact.id, contact] as const))

      nextContacts.forEach((nextContact) => {
        const previousContact = previousContactsById.get(nextContact.id) ?? null
        const nextDirection = String(nextContact.lastMessageDirection ?? '').trim().toLowerCase()
        const nextTimestamp = String(nextContact.lastMessageAt ?? '').trim()
        const nextPreview = String(nextContact.lastMessageText ?? '').trim()

        if (nextDirection !== 'inbound' || !nextTimestamp || !nextPreview) {
          return
        }

        const previousTimestamp = String(previousContact?.lastMessageAt ?? '').trim()
        const previousPreview = String(previousContact?.lastMessageText ?? '').trim()

        if (previousTimestamp === nextTimestamp && previousPreview === nextPreview) {
          return
        }

        enqueueMessageNotification({
          contactId: nextContact.id,
          contactName: nextContact.name,
          preview: nextPreview,
          timestamp: nextTimestamp,
        })
      })
    }

    if (state.activeView === 'internacionales' && state.trackingApiState !== 'loading') {
      void loadTrackingApiPackages()
    }
    if (state.activeView === 'internacionales-paquetes' && state.contactPackagesState !== 'loading') {
      void loadContactPackages()
    }
    if (state.activeView === 'usuarios' && state.usersState !== 'loading') {
      void loadUsers()
    }

    if (state.activeView === 'chat' && !state.conversationData.contact.id) {
      const latestChatContact = getChatContacts()[0]

      if (latestChatContact) {
        void loadConversation(latestChatContact.id)
      }
    }
  } catch (error) {
    state.error =
      error instanceof Error
        ? error.message
        : 'Ocurrio un error inesperado al cargar el CRM.'
  } finally {
    state.loading = false
    dashboardRefreshInFlight = false
    renderApp()
  }
}

const finishLogin = async (token: string, user: SessionUser) => {
  state.authToken = token
  state.authExpiresAt = state.loginForm.remember ? getEndOfTodayIso() : null
  state.sessionUser = user
  state.loginState = 'idle'
  state.loginError = null
  persistAuthState()
  scheduleSessionExpiry()
  syncViewToLocation(state.activeView, { replace: true })
  renderApp()
  await loadDashboard()
  if (state.activeView === 'ems') {
    void refreshEmsPipelineFromApis()
  }
}

const submitLogin = async () => {
  state.loginState = 'submitting'
  state.loginError = null
  renderApp()

  try {
    const response = await fetch(getApiUrl('/api/auth/login'), {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: state.loginForm.email,
        password: state.loginForm.password,
      }),
    })

    const payload = await parseApiPayload(response)

    if (!response.ok) {
      throw new Error(
        (payload?.error as string) || (payload?.message as string) || 'No se pudo iniciar sesion.',
      )
    }

    await finishLogin(payload?.token as string, payload?.user as SessionUser)
  } catch (error) {
    state.loginState = 'idle'
    state.loginError =
      error instanceof Error ? error.message : 'Ocurrio un error inesperado al iniciar sesion.'
    renderApp()
  }
}

const submitCreateContact = async () => {
  const isEditingContact = state.contactModalMode === 'edit' && Number.isFinite(state.activeContactId)
  const contactId = state.activeContactId

  state.submitState = 'submitting'
  state.submitError = null
  renderApp()

  try {
    const channelReferences = Object.fromEntries(
      Object.entries(state.createContactForm.channelReferences).filter(([, value]) => value.trim().length > 0),
    )

    if (state.createContactForm.channels.includes('WhatsApp')) {
      channelReferences.WhatsApp = buildWhatsAppReference()
    }

    const response = await authFetch(isEditingContact ? `/api/contacts/${contactId}` : '/api/contacts', {
      method: isEditingContact ? 'PUT' : 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: state.createContactForm.name,
        company: state.createContactForm.company,
        channels: state.createContactForm.channels,
        channelReferences,
        segment: state.createContactForm.segment,
        owner: state.createContactForm.owner,
        status: state.createContactForm.status,
        score: Number(state.createContactForm.score),
      }),
    })

    const payload = await parseApiPayload(response)

    if (response.status === 401) {
      clearSession()
      state.loginError = 'Tu sesion expiro. Inicia sesion nuevamente.'
      renderApp()
      return
    }

    if (!response.ok) {
      throw new Error(
        (payload?.error as string) ||
        (payload?.message as string) ||
        'No se pudo guardar el contacto.',
      )
    }

    state.notice = isEditingContact
      ? `Contacto ${String(payload?.name ?? '')} actualizado correctamente.`
      : `Contacto ${String(payload?.name ?? '')} creado correctamente.`
    state.isCreateContactModalOpen = false
    state.contactModalMode = 'create'
    state.activeContactId = null
    state.submitState = 'idle'
    await loadDashboard()
  } catch (error) {
    state.submitState = 'idle'
    state.submitError =
      error instanceof Error
        ? error.message
        : 'Ocurrio un error inesperado al guardar el contacto.'
    renderApp()
  }
}

const submitWhatsAppConfig = async () => {
  state.whatsappConfigState = 'submitting'
  state.whatsappConfigError = null
  renderApp()

  try {
    const response = await authFetch('/api/integrations/whatsapp-config', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(state.whatsappConfigForm),
    })

    const payload = await parseApiPayload(response)

    if (response.status === 401) {
      clearSession()
      state.loginError = 'Tu sesion expiro. Inicia sesion nuevamente.'
      renderApp()
      return
    }

    if (!response.ok) {
      throw new Error(
        (payload?.error as string) ||
        (payload?.message as string) ||
        'No se pudo guardar la configuracion de WhatsApp.',
      )
    }

    state.whatsappConfigState = 'idle'
    state.whatsappConfigForm.accessToken = ''
    state.notice = 'Configuracion de WhatsApp Meta guardada correctamente.'
    await loadDashboard()
  } catch (error) {
    state.whatsappConfigState = 'idle'
    state.whatsappConfigError =
      error instanceof Error ? error.message : 'No se pudo guardar la configuracion de WhatsApp.'
    renderApp()
  }
}

const submitWhatsAppTestMessage = async () => {
  state.whatsappTestState = 'submitting'
  state.whatsappTestError = null
  state.whatsappTestResult = null
  renderApp()

  try {
    const normalizedTarget = normalizePhoneDigits(state.whatsappTestForm.targetReference)

    if (state.whatsappTestModeEnabled) {
      await ensureWhatsAppTestModeSourcesLoaded()

      const normalizedTargetNumber = normalizeBoliviaTestPhoneDigits(normalizedTarget)
      if (!state.whatsappTestModeNumbers.includes(normalizedTargetNumber)) {
        throw new Error('El modo prueba esta activo. Solo puedes enviar a los numeros de prueba autorizados.')
      }

      if (!isWhatsAppTestNumberAvailableInLoadedApis(normalizedTargetNumber)) {
        throw new Error(
          'El modo prueba esta activo, pero ese numero no aparece en los datos cargados de Internacionales o Paquetes.',
        )
      }
    }

    const response = await authFetch('/api/messages/whatsapp/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: state.whatsappTestForm.targetReference,
        message: state.whatsappTestForm.message,
      }),
    })

    const payload = await parseApiPayload(response)

    if (response.status === 401) {
      clearSession()
      state.loginError = 'Tu sesion expiro. Inicia sesion nuevamente.'
      renderApp()
      return
    }

    if (!response.ok) {
      throw new Error(
        (payload?.error as string) ||
        (payload?.message as string) ||
        'No se pudo enviar la prueba de WhatsApp.',
      )
    }

    state.whatsappTestState = 'idle'
    state.whatsappTestResult = {
      recipient: String(payload?.recipient ?? ''),
      provider: String(payload?.provider ?? 'Meta Cloud API'),
      messageId: String(payload?.messageId ?? ''),
    }
    state.notice = `Prueba enviada correctamente a ${String(payload?.recipient ?? '')}.`
    renderApp()
  } catch (error) {
    state.whatsappTestState = 'idle'
    state.whatsappTestError =
      error instanceof Error ? error.message : 'No se pudo enviar la prueba de WhatsApp.'
    renderApp()
  }
}

const submitSendWhatsAppMessage = async () => {
  state.sendMessageState = 'submitting'
  state.sendMessageError = null
  renderApp()

  try {
    const targetContactId = state.sendMessageForm.contactId
    const aiEnabled = targetContactId !== null && isAiAssistedConversation(targetContactId)
    const attachment = state.sendMessageForm.attachment
    const hasAttachment = Boolean(attachment)
    const attachmentType = attachment?.type ?? ''

    let finalMessage = state.sendMessageForm.message.trim()

    if (aiEnabled && !hasAttachment) {
      const instruction = finalMessage || 'Responde de forma breve, cordial y profesional.'
      state.notice = 'La IA esta redactando la respuesta...'
      renderApp()

      const aiSuggestion = await generateAiSuggestedReply(targetContactId as number, instruction)
      if (!aiSuggestion) {
        throw new Error(state.notice || 'La IA no pudo generar una respuesta para esta conversacion.')
      }

      finalMessage = aiSuggestion
      state.sendMessageForm.message = aiSuggestion
    }

    if (!hasAttachment && !finalMessage) {
      throw new Error('Escribe un mensaje o adjunta una imagen/audio.')
    }

    if (hasAttachment && attachmentType.startsWith('audio/') && finalMessage) {
      throw new Error('Los audios no admiten texto adicional. Envia solo el archivo de audio.')
    }

    const normalizedTarget = normalizePhoneDigits(state.sendMessageForm.targetReference)

    if (state.whatsappTestModeEnabled) {
      await ensureWhatsAppTestModeSourcesLoaded()

      const normalizedTargetNumber = normalizeBoliviaTestPhoneDigits(normalizedTarget)
      if (!state.whatsappTestModeNumbers.includes(normalizedTargetNumber)) {
        throw new Error('El modo prueba esta activo. Solo puedes enviar a los numeros de prueba autorizados.')
      }

      if (!isWhatsAppTestNumberAvailableInLoadedApis(normalizedTargetNumber)) {
        throw new Error(
          'El modo prueba esta activo, pero ese numero no aparece en los datos cargados de Internacionales o Paquetes.',
        )
      }
    }

    const requestBody = hasAttachment ? new FormData() : null

    if (requestBody) {
      requestBody.append('contactId', String(state.sendMessageForm.contactId ?? ''))
      requestBody.append('to', state.sendMessageForm.targetReference)
      requestBody.append('message', finalMessage)
      requestBody.append('attachment', attachment as File)
    }

    const response = await authFetch('/api/messages/whatsapp/send', {
      method: 'POST',
      ...(requestBody ? { body: requestBody } : {
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contactId: state.sendMessageForm.contactId,
          to: state.sendMessageForm.targetReference,
          message: finalMessage,
        }),
      }),
    })

    const payload = await parseApiPayload(response)

    if (response.status === 401) {
      clearSession()
      state.loginError = 'Tu sesion expiro. Inicia sesion nuevamente.'
      renderApp()
      return
    }

    if (!response.ok) {
      throw new Error(
        (payload?.error as string) ||
        (payload?.message as string) ||
        'No se pudo enviar el mensaje por WhatsApp.',
      )
    }

    state.sendMessageState = 'idle'
    state.isSendMessageModalOpen = false
    const messageKind = String(payload?.messageKind ?? 'text')
    state.notice =
      messageKind === 'text'
        ? `Mensaje enviado correctamente a ${String(payload?.recipient ?? '')}.`
        : `${messageKind === 'image' ? 'Imagen' : 'Audio'} enviada correctamente a ${String(payload?.recipient ?? '')}.`
    const activeConversationId = state.conversationData.contact.id
    if (activeConversationId && state.activeView === 'chat') {
      state.sendMessageForm = defaultWhatsAppMessageForm()
      await loadConversation(activeConversationId)
      return
    }
    state.sendMessageForm = defaultWhatsAppMessageForm()
    await loadDashboard()
  } catch (error) {
    state.sendMessageState = 'idle'
    state.sendMessageError =
      error instanceof Error ? error.message : 'No se pudo enviar el mensaje por WhatsApp.'
    renderApp()
  }
}

const logout = async (expiredBySchedule = false) => {
  try {
    await authFetch('/api/auth/logout', {
      method: 'POST',
    })
  } catch {
    // ignore logout network error
  }

  clearSession()
  state.loginForm = defaultLoginForm()
  if (expiredBySchedule) {
    state.loginError = 'La sesion recordada vencio a las 00:00. Inicia sesion nuevamente.'
  }
  renderApp()
}

const restoreSession = async () => {
  if (!state.authToken) {
    state.authLoading = false
    syncLoginToLocation({ replace: true })
    renderApp()
    return
  }

  try {
    const response = await authFetch('/api/auth/session', { timeoutMs: 4000 })
    const payload = await parseApiPayload(response)

    if (!response.ok) {
      throw new Error(
        (payload?.error as string) || (payload?.message as string) || 'Sesion no valida.',
      )
    }

    state.sessionUser = payload?.user as SessionUser
    await syncGlobalAiAgentSetting()
    scheduleSessionExpiry()
  } catch {
    clearSession()
    state.loginError = 'La sesion no se pudo validar a tiempo. Inicia sesion nuevamente.'
    syncLoginToLocation({ replace: true })
  } finally {
    state.authLoading = false
    renderApp()
  }

  if (state.sessionUser) {
    syncViewToLocation(state.activeView, { replace: true })
    await loadDashboard()
    if (state.activeView === 'ems') {
      void refreshEmsPipelineFromApis()
      bootstrapEmsPipelineView()
    }
  }
}

renderApp()
void restoreSession()
