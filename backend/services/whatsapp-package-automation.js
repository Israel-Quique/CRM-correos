export const selectPackageNotificationRecipients = ({
  testModeEnabled,
  packageRecipients = [],
  testRecipients = [],
  associatedPhones = [],
}) => {
  if (!testModeEnabled) return packageRecipients

  const associatedNumbers = new Set([...packageRecipients, ...associatedPhones])
  return [...new Set(testRecipients.filter((phone) => associatedNumbers.has(phone)))]
}

const normalizePackageStatusText = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()

export const isInternationalArrivalEvent = (eventLabel = '') => {
  const eventText = normalizePackageStatusText(eventLabel)
  return (
    eventText.includes('oficina de cambio') &&
    !/\b(salida|despacho de salida|outbound)\b/.test(eventText) &&
    /\b(entrada|recibir|recibido|recepcion)\b/.test(eventText)
  )
}

export const hasInternationalArrivalEvent = (events = []) =>
  events.some((event) => {
    const eventLabel =
      typeof event === 'string'
        ? event
        : [
            event?.nombre,
            event?.evento_api,
            event?.evento_original,
            event?.movimiento_bolivia,
            event?.detalle,
            event?.event_name,
          ]
            .filter(Boolean)
            .join(' ')
    return isInternationalArrivalEvent(eventLabel)
  })

export const buildInternationalArrivalMessage = ({
  packageCode = '',
  eventLabel = '',
  arrivalConfirmed = false,
}) => {
  const eventConfirmsArrival = isInternationalArrivalEvent(eventLabel)
  if (!arrivalConfirmed && !eventConfirmsArrival) return ''

  const code = String(packageCode ?? '').trim()
  const subject = code ? `La guía *${code}*` : 'Tu paquete'
  return `¡Buenas noticias! ${subject} ya llegó a Bolivia y continúa su proceso de clasificación y distribución. El sistema todavía no muestra una sucursal de destino ni disponibilidad para recojo.`
}

export const isPackageReturnToOriginEvent = ({ eventLabel = '', eventSignature = '' }) => {
  const eventText = normalizePackageStatusText(`${eventLabel} ${eventSignature}`)
  const indicatesReturn = ['devolucion', 'retorn', 'devuelt', 'regres'].some((indicator) =>
    eventText.includes(indicator),
  )
  const indicatesOrigin = ['origen', 'remitente'].some((indicator) =>
    eventText.includes(indicator),
  )

  return indicatesReturn && indicatesOrigin
}

export const buildPackageReturnToOriginMessage = ({
  contactName = '',
  packageCode = '',
  origin = '',
  noticeDates = [],
}) => {
  const name = String(contactName ?? '').trim() || 'Hola'
  const code = String(packageCode ?? '').trim() || 'tu paquete'
  const originLabel = String(origin ?? '').trim() || 'su departamento de origen'
  const dates = [...new Set(noticeDates.map((date) => String(date ?? '').trim()).filter(Boolean))]

  return [
    `Hola, ${name}. Tenemos una actualización de tu paquete *${code}*.`,
    '',
    dates.length > 0
      ? `Los avisos de salida a reparto se enviaron por WhatsApp los días: ${dates.join(', ')}.`
      : 'No encontramos avisos de salida a reparto enviados por este sistema.',
    `El último movimiento indica que no se pudo completar la entrega y el paquete está retornando a *${originLabel}*.`,
  ].join('\n')
}

export const buildPackageEventSignature = ({ eventId, eventCode, label, location, date }) =>
  [eventId, eventCode, label, location, date]
    .map((value) => String(value ?? '').trim().toUpperCase())
    .filter(Boolean)
    .join('|')

const getPackageStatusStage = (statusText) => {
  const status = normalizePackageStatusText(statusText)
  if (status.includes('cancel') || status.includes('anul') || status.includes('rechaz')) return 'cancelled'
  if (status.includes('entregad') || status.includes('deliver') || status.includes('cerrad')) return 'delivered'
  if (status.includes('cartero') || status.includes('reparto') || status.includes('distribucion')) return 'courier'
  if (
    status.includes('regional') ||
    status.includes('destino') ||
    status.includes('pasar a recoger') ||
    status.includes('ventanilla')
  ) {
    return 'regional'
  }
  if (
    status.includes('camino') ||
    status.includes('transit') ||
    status.includes('transito') ||
    status.includes('seguim') ||
    status.includes('aduan')
  ) {
    return 'transit'
  }
  if (
    ['recibido', 'recibida', 'received'].includes(status) ||
    status.includes('almacen') ||
    status.includes('admision') ||
    status.includes('recepcion') ||
    status.includes('origen')
  ) {
    return 'received'
  }
  return null
}

const getPackageStageRank = (stage) => ({
  received: 0,
  transit: 1,
  regional: 2,
  courier: 3,
  delivered: 4,
  cancelled: 5,
}[stage] ?? -1)

export const resolveContactPackageStage = ({ statusText, latestEventStage, transferStage }) => {
  const statusStage = getPackageStatusStage(statusText)
  const movementStage = [latestEventStage, transferStage]
    .filter(Boolean)
    .sort((first, second) => getPackageStageRank(second) - getPackageStageRank(first))[0] ?? null

  if (statusStage === 'cancelled') return statusStage
  if (
    ['regional', 'courier', 'delivered'].includes(statusStage) &&
    getPackageStageRank(statusStage) > getPackageStageRank(movementStage)
  ) {
    return statusStage
  }

  return movementStage ?? statusStage
}

export const isPackageEventNotificationEligible = ({ stage, eventLabel = '', eventSignature = '' }) => {
  if (isPackageReturnToOriginEvent({ eventLabel, eventSignature })) return true
  if (['transit', 'regional', 'courier', 'delivered'].includes(stage)) return true

  const eventText = normalizePackageStatusText(`${eventLabel} ${eventSignature}`)
  return [
    'ventanilla',
    'pendiente de recojo',
    'pendiente de entrega',
    'solicitud de recojo',
    'listo para recoger',
    'listo para entregar',
    'listo para entrega',
    'oficina de entrega',
  ].some((indicator) => eventText.includes(indicator))
}

export const WHATSAPP_TRACKING_RETRY_INTERVAL_MS = 15 * 60 * 1000
export const WHATSAPP_TRACKING_RETRY_WINDOW_MS = 24 * 60 * 60 * 1000
export const WHATSAPP_TRACKING_RETRY_POLL_INTERVAL_MS = 60 * 1000

export const getWhatsAppTrackingRetrySchedule = (createdAt = Date.now()) => ({
  nextAttemptAt: new Date(createdAt + WHATSAPP_TRACKING_RETRY_INTERVAL_MS),
  expiresAt: new Date(createdAt + WHATSAPP_TRACKING_RETRY_WINDOW_MS),
})

export const resolveAutomationBooleanSetting = ({ storedValue, envValue, defaultValue = false }) => {
  if (typeof storedValue === 'boolean') return storedValue
  if (envValue != null) return envValue === 'true'
  return defaultValue
}

export const getPackageAutomationPollIntervalMs = ({
  defaultIntervalMs,
  welcomeEnabled,
  welcomeIntervalMs,
  eventUpdatesEnabled,
  eventChangeIntervalMs,
}) => {
  const activeIntervals = [
    ...(welcomeEnabled ? [welcomeIntervalMs] : []),
    ...(eventUpdatesEnabled ? [eventChangeIntervalMs] : []),
  ].filter(Number.isFinite)

  return activeIntervals.length > 0
    ? Math.max(Math.min(defaultIntervalMs, ...activeIntervals), 60 * 1000)
    : defaultIntervalMs
}

export const getPackageAutomationNextDelayMs = ({
  defaultIntervalMs,
  now = Date.now(),
  welcomeEnabled,
  welcomeIntervalMs,
  lastWelcomeCheckAt,
  eventUpdatesEnabled,
  eventChangeIntervalMs,
  lastEventCheckAt,
  fullEventSyncEnabled,
  fullEventSyncIntervalMs,
  lastFullEventSyncAt,
  reconciliationEnabled = false,
  reconciliationIntervalMs,
  lastReconciliationCheckAt,
}) => {
  const deadlines = [
    ...(welcomeEnabled && lastWelcomeCheckAt > 0
      ? [lastWelcomeCheckAt + welcomeIntervalMs]
      : []),
    ...(eventUpdatesEnabled && lastEventCheckAt > 0
      ? [lastEventCheckAt + eventChangeIntervalMs]
      : []),
    ...(fullEventSyncEnabled && lastFullEventSyncAt > 0
      ? [lastFullEventSyncAt + fullEventSyncIntervalMs]
      : []),
    ...(reconciliationEnabled && lastReconciliationCheckAt > 0
      ? [lastReconciliationCheckAt + reconciliationIntervalMs]
      : []),
  ]
  const nextDeadline = deadlines.length > 0 ? Math.min(...deadlines) : now + defaultIntervalMs
  return Math.max(1000, Math.min(defaultIntervalMs, nextDeadline - now))
}

export const runAndReschedule = async ({ run, schedule, onError }) => {
  try {
    await run()
  } catch (error) {
    await onError(error)
  } finally {
    schedule()
  }
}

export const parsePackageTimestamp = (value) => {
  const normalized = String(value ?? '').trim()
  if (!normalized) return 0

  if (/^\d{10,13}$/.test(normalized)) {
    const numericTimestamp = Number(normalized)
    const timestamp = normalized.length === 10 ? numericTimestamp * 1000 : numericTimestamp
    return Number.isFinite(timestamp) ? timestamp : 0
  }

  const dayFirstDateMatch = normalized.match(
    /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?)?$/,
  )
  if (dayFirstDateMatch) {
    const [, dayText, monthText, yearText, hourText = '0', minuteText = '0', secondText = '0', fractionText = '0'] =
      dayFirstDateMatch
    const day = Number(dayText)
    const month = Number(monthText)
    const year = Number(yearText)
    const hour = Number(hourText)
    const minute = Number(minuteText)
    const second = Number(secondText)
    const millisecond = Number(fractionText.padEnd(3, '0').slice(0, 3))
    const localDate = new Date(Date.UTC(year, month - 1, day))

    if (
      localDate.getUTCFullYear() !== year ||
      localDate.getUTCMonth() !== month - 1 ||
      localDate.getUTCDate() !== day ||
      hour > 23 ||
      minute > 59 ||
      second > 59
    ) {
      return 0
    }

    return Date.UTC(year, month - 1, day, hour + 4, minute, second, millisecond)
  }

  const timestamp = Date.parse(normalized)
  return Number.isFinite(timestamp) ? timestamp : 0
}

export const migrateWelcomeIntervalSetting = ({
  settings,
  currentVersion,
  defaultIntervalMs,
}) => {
  const storedVersion = Number(settings.welcomeResponseIntervalVersion ?? 0)
  if (storedVersion >= currentVersion) {
    return { settings, changed: false }
  }

  const nextSettings = {
    ...settings,
    automaticWelcome: true,
    aiAutoReply: true,
    welcomeResponseIntervalMs: defaultIntervalMs,
    welcomeResponseIntervalVersion: currentVersion,
  }
  return { settings: nextSettings, changed: true }
}

export const isPackagePageOutsideRecentWindow = (items, cutoffMs, getItemTimestamp) =>
  items.length > 0 &&
  items.every((item) => {
    const itemTimestamp = getItemTimestamp(item)
    return Number.isFinite(itemTimestamp) && itemTimestamp > 0 && itemTimestamp < cutoffMs
  })

export const isEligibleNewPackageWelcomeEntry = ({
  contactId,
  source,
  action,
  updatedAt,
  now = Date.now(),
  recentWindowMs,
}) => {
  const timestamp = Number(updatedAt)
  return Boolean(contactId) &&
    ['contact', 'tracking'].includes(source) &&
    ['created', 'updated'].includes(action) &&
    Number.isFinite(timestamp) &&
    timestamp > 0 &&
    now - timestamp <= recentWindowMs
}

const collectRecipientPhoneValues = (value, result = []) => {
  if (!value || typeof value !== 'object') return result
  if (Array.isArray(value)) {
    value.forEach((item) => collectRecipientPhoneValues(item, result))
    return result
  }

  const phoneKeys = new Set([
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
  ])

  for (const [key, nestedValue] of Object.entries(value)) {
    const normalizedKey = key
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/gi, '')
      .toLowerCase()
    if (phoneKeys.has(normalizedKey) && typeof nestedValue !== 'object') {
      result.push(nestedValue)
    } else {
      collectRecipientPhoneValues(nestedValue, result)
    }
  }
  return result
}

export const getTrackingPackageRecipientPhoneCandidates = (item) => [
  ...collectRecipientPhoneValues(item?.telefonos?.destinatario),
  item?.telefonos?.destinatario,
  ...collectRecipientPhoneValues(item?.destinatario),
  item?.destinatario?.telefono,
  item?.destinatario?.phone,
  item?.destinatario?.celular,
  item?.destinatario?.movil,
  item?.telefono_destinatario,
  item?.telefonoDestinatario,
  item?.telefonodestinatario,
  item?.celular_destinatario,
  item?.phone_recipient,
]
  .flat()
  .map((value) => String(value ?? '').replace(/[^\d]/g, ''))
  .filter(Boolean)
  .filter((phone, index, phones) => phones.indexOf(phone) === index)

export const getNewPackageWelcomePhoneCandidates = (entry) =>
  entry?.source === 'tracking'
    ? (Array.isArray(entry.welcomePhoneCandidates) ? entry.welcomePhoneCandidates : [])
    : [entry?.primaryPhone].filter(Boolean)
