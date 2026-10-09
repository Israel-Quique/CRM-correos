import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildInternationalArrivalMessage,
  buildPackageReturnToOriginMessage,
  buildPackageEventSignature,
  getPackageAutomationNextDelayMs,
  getWhatsAppTrackingRetrySchedule,
  getNewPackageWelcomePhoneCandidates,
  WHATSAPP_TRACKING_RETRY_INTERVAL_MS,
  WHATSAPP_TRACKING_RETRY_POLL_INTERVAL_MS,
  WHATSAPP_TRACKING_RETRY_WINDOW_MS,
  getPackageAutomationPollIntervalMs,
  getTrackingPackageRecipientPhoneCandidates,
  hasInternationalArrivalEvent,
  isInternationalArrivalEvent,
  isEligibleNewPackageWelcomeEntry,
  isPackageEventNotificationEligible,
  isPackageReturnToOriginEvent,
  isPackagePageOutsideRecentWindow,
  migrateWelcomeIntervalSetting,
  parsePackageTimestamp,
  resolveContactPackageStage,
  resolveAutomationBooleanSetting,
  runAndReschedule,
  selectPackageNotificationRecipients,
} from '../services/whatsapp-package-automation.js'

test('programa reintentos de tracking cada 15 minutos y vence a las 24 horas', () => {
  const createdAt = Date.parse('2026-10-05T14:00:00.000Z')
  const schedule = getWhatsAppTrackingRetrySchedule(createdAt)

  assert.equal(WHATSAPP_TRACKING_RETRY_INTERVAL_MS, 15 * 60 * 1000)
  assert.equal(WHATSAPP_TRACKING_RETRY_POLL_INTERVAL_MS, 60 * 1000)
  assert.equal(WHATSAPP_TRACKING_RETRY_WINDOW_MS, 24 * 60 * 60 * 1000)
  assert.equal(schedule.nextAttemptAt.getTime(), createdAt + 15 * 60 * 1000)
  assert.equal(schedule.expiresAt.getTime(), createdAt + 24 * 60 * 60 * 1000)
})

test('identifica la recepción de entrada en oficina de cambio como llegada a Bolivia', () => {
  const eventLabel = 'Recibir envío en oficina de cambio (entrada)'
  const expectedMessage =
    '¡Buenas noticias! La guía *EY592031552US* ya llegó a Bolivia y continúa su proceso de clasificación y distribución. El sistema todavía no muestra una sucursal de destino ni disponibilidad para recojo.'

  assert.equal(isInternationalArrivalEvent(eventLabel), true)
  assert.equal(hasInternationalArrivalEvent([{ evento_api: eventLabel }]), true)
  assert.equal(
    buildInternationalArrivalMessage({ packageCode: 'EY592031552US', eventLabel }),
    expectedMessage,
  )
  assert.equal(
    buildInternationalArrivalMessage({
      packageCode: 'EY592031552US',
      eventLabel: 'Paquete en tránsito',
      arrivalConfirmed: true,
    }),
    expectedMessage,
  )
})

test('no infiere llegada a Bolivia por un evento de salida o por tener una guía registrada', () => {
  assert.equal(isInternationalArrivalEvent('Despacho desde oficina de cambio (salida)'), false)
  assert.equal(isInternationalArrivalEvent('Recibir envío en oficina de cambio (salida)'), false)
  assert.equal(hasInternationalArrivalEvent([{ evento_api: 'Despacho desde oficina de cambio (salida)' }]), false)
  assert.equal(buildInternationalArrivalMessage({ packageCode: 'EY592031552US' }), '')
})

test('en modo de prueba envía solo al número autorizado vinculado al paquete', () => {
  assert.deepEqual(
    selectPackageNotificationRecipients({
      testModeEnabled: true,
      packageRecipients: ['59177501487'],
      testRecipients: ['59164229403'],
      associatedPhones: ['59164229403'],
    }),
    ['59164229403'],
  )
})

test('en modo de prueba no envía si ningún número autorizado está vinculado al paquete', () => {
  assert.deepEqual(
    selectPackageNotificationRecipients({
      testModeEnabled: true,
      packageRecipients: ['59177501487'],
      testRecipients: ['59164229403'],
      associatedPhones: [],
    }),
    [],
  )
})

test('fuera del modo de prueba conserva los destinatarios normales del paquete', () => {
  assert.deepEqual(
    selectPackageNotificationRecipients({
      testModeEnabled: false,
      packageRecipients: ['59177501487'],
      testRecipients: ['59164229403'],
      associatedPhones: ['59164229403'],
    }),
    ['59177501487'],
  )
})

test('la configuracion guardada en la interfaz prevalece sobre el flag heredado de entorno', () => {
  assert.equal(
    resolveAutomationBooleanSetting({
      storedValue: true,
      envValue: 'false',
      defaultValue: false,
    }),
    true,
  )
  assert.equal(
    resolveAutomationBooleanSetting({
      storedValue: false,
      envValue: 'true',
      defaultValue: true,
    }),
    false,
  )
})

test('el estado actual de destino prevalece sobre un evento viejo de salida en transito', () => {
  assert.equal(
    resolveContactPackageStage({
      statusText: 'Recibido en destino',
      latestEventStage: 'transit',
      transferStage: 'transit',
    }),
    'regional',
  )
})

test('mantiene la etapa mas avanzada entre el estado actual y los movimientos', () => {
  assert.equal(
    resolveContactPackageStage({
      statusText: 'En tránsito',
      latestEventStage: 'regional',
      transferStage: null,
    }),
    'regional',
  )
  assert.equal(
    resolveContactPackageStage({
      statusText: 'Recibido en destino',
      latestEventStage: 'delivered',
      transferStage: null,
    }),
    'delivered',
  )
})

test('permite notificar ventanilla aunque el identificador del evento la clasifique como recibido', () => {
  assert.equal(
    isPackageEventNotificationEligible({
      stage: 'received',
      eventLabel: 'Correspondencia pendiente de recojo en ventanilla',
    }),
    true,
  )
  assert.equal(
    isPackageEventNotificationEligible({
      stage: 'received',
      eventSignature: 'VENTANILLA',
    }),
    true,
  )
  assert.equal(
    isPackageEventNotificationEligible({
      stage: 'received',
      eventLabel: 'Paquete recibido en origen',
    }),
    false,
  )
})

test('reconoce eventos de devolución al origen sin confundir una devolución genérica', () => {
  assert.equal(
    isPackageReturnToOriginEvent({ eventLabel: 'Devolución a origen' }),
    true,
  )
  assert.equal(
    isPackageReturnToOriginEvent({ eventSignature: 'RETORNO AL REMITENTE' }),
    true,
  )
  assert.equal(
    isPackageReturnToOriginEvent({ eventLabel: 'Paquete devuelto por incidencia' }),
    false,
  )
  assert.equal(
    isPackageEventNotificationEligible({
      stage: 'cancelled',
      eventLabel: 'Devolución a origen',
    }),
    true,
  )
  assert.equal(
    isPackageEventNotificationEligible({
      stage: 'cancelled',
      eventLabel: 'Paquete cancelado',
    }),
    false,
  )
})

test('el aviso de retorno incluye las fechas únicas de los avisos de reparto', () => {
  const message = buildPackageReturnToOriginMessage({
    contactName: 'Ana',
    packageCode: 'EE123456789BO',
    origin: 'La Paz',
    noticeDates: ['01/10/2026', '02/10/2026', '01/10/2026'],
  })

  assert.match(message, /avisos de salida a reparto se enviaron por WhatsApp los días: 01\/10\/2026, 02\/10\/2026/)
  assert.match(message, /retornando a \*La Paz\*/)
  assert.doesNotMatch(message, /01\/10\/2026, 02\/10\/2026, 01\/10\/2026/)
})

test('el aviso de retorno no afirma días de reparto si no hay avisos registrados', () => {
  const message = buildPackageReturnToOriginMessage({
    contactName: 'Ana',
    packageCode: 'EE123456789BO',
    origin: 'La Paz',
  })

  assert.match(message, /No encontramos avisos de salida a reparto enviados por este sistema/)
})

test('firma los eventos usando fecha_registro cuando no existe fecha principal', () => {
  const firstSignature = buildPackageEventSignature({
    eventId: 318,
    label: 'Recepcion en destino',
    location: 'Santa Cruz',
    date: '2026-10-01T10:00:00Z',
  })
  const nextSignature = buildPackageEventSignature({
    eventId: 318,
    label: 'Recepcion en destino',
    location: 'Santa Cruz',
    date: '2026-10-01T12:00:00Z',
  })

  assert.notEqual(firstSignature, nextSignature)
})

test('el watcher respeta el intervalo activo configurado en automatizacion', () => {
  assert.equal(
    getPackageAutomationPollIntervalMs({
      defaultIntervalMs: 5 * 60 * 1000,
      welcomeEnabled: true,
      welcomeIntervalMs: 60 * 1000,
      eventUpdatesEnabled: true,
      eventChangeIntervalMs: 60 * 1000,
    }),
    60 * 1000,
  )
  assert.equal(
    getPackageAutomationPollIntervalMs({
      defaultIntervalMs: 5 * 60 * 1000,
      welcomeEnabled: true,
      welcomeIntervalMs: 10 * 60 * 1000,
      eventUpdatesEnabled: true,
      eventChangeIntervalMs: 2 * 60 * 1000,
    }),
    2 * 60 * 1000,
  )
})

test('el watcher conserva el intervalo base cuando no hay automatizaciones activas', () => {
  assert.equal(
    getPackageAutomationPollIntervalMs({
      defaultIntervalMs: 5 * 60 * 1000,
      welcomeEnabled: false,
      welcomeIntervalMs: 60 * 1000,
      eventUpdatesEnabled: false,
      eventChangeIntervalMs: 60 * 1000,
    }),
    5 * 60 * 1000,
  )
})

test('el watcher programa el siguiente ciclo incluso si la ejecucion actual falla', async () => {
  let scheduled = 0
  let reportedError

  await runAndReschedule({
    run: async () => {
      throw new Error('fallo de prueba')
    },
    schedule: () => {
      scheduled += 1
    },
    onError: async (error) => {
      reportedError = error
    },
  })

  assert.equal(scheduled, 1)
  assert.match(reportedError.message, /fallo de prueba/)
})

test('el watcher ejecuta la revision de bienvenida cada cinco minutos cuando ese es el intervalo configurado', () => {
  assert.equal(
    getPackageAutomationPollIntervalMs({
      defaultIntervalMs: 5 * 60 * 1000,
      welcomeEnabled: true,
      welcomeIntervalMs: 5 * 60 * 1000,
      eventUpdatesEnabled: false,
      eventChangeIntervalMs: 15 * 60 * 1000,
    }),
    5 * 60 * 1000,
  )
})

test('la comprobacion de bienvenida respeta el intervalo personalizado configurado', () => {
  const now = Date.parse('2026-10-01T19:00:00Z')

  assert.equal(
    getPackageAutomationNextDelayMs({
      defaultIntervalMs: 5 * 60 * 1000,
      now,
      welcomeEnabled: true,
      welcomeIntervalMs: 5 * 60 * 1000,
      lastWelcomeCheckAt: now,
      eventUpdatesEnabled: false,
      eventChangeIntervalMs: 15 * 60 * 1000,
      lastEventCheckAt: 0,
      fullEventSyncEnabled: false,
      fullEventSyncIntervalMs: 60 * 60 * 1000,
      lastFullEventSyncAt: 0,
    }),
    5 * 60 * 1000,
  )
  assert.equal(
    getPackageAutomationNextDelayMs({
      defaultIntervalMs: 5 * 60 * 1000,
      now: now + 4 * 60 * 1000,
      welcomeEnabled: true,
      welcomeIntervalMs: 5 * 60 * 1000,
      lastWelcomeCheckAt: now,
      eventUpdatesEnabled: false,
      eventChangeIntervalMs: 15 * 60 * 1000,
      lastEventCheckAt: 0,
      fullEventSyncEnabled: false,
      fullEventSyncIntervalMs: 60 * 60 * 1000,
      lastFullEventSyncAt: 0,
    }),
    60 * 1000,
  )
})

test('el comprobador de conciliacion programa su siguiente carga completa', () => {
  const now = Date.parse('2026-10-01T19:00:00Z')
  const intervalMs = 30 * 60 * 1000

  assert.equal(
    getPackageAutomationNextDelayMs({
      defaultIntervalMs: 5 * 60 * 1000,
      now: now + 10 * 60 * 1000,
      welcomeEnabled: true,
      welcomeIntervalMs: 5 * 60 * 1000,
      lastWelcomeCheckAt: now + 10 * 60 * 1000,
      eventUpdatesEnabled: true,
      eventChangeIntervalMs: 15 * 60 * 1000,
      lastEventCheckAt: now + 10 * 60 * 1000,
      fullEventSyncEnabled: false,
      fullEventSyncIntervalMs: 60 * 60 * 1000,
      lastFullEventSyncAt: 0,
      reconciliationEnabled: true,
      reconciliationIntervalMs: intervalMs,
      lastReconciliationCheckAt: now,
    }),
    5 * 60 * 1000,
  )
  assert.equal(
    getPackageAutomationNextDelayMs({
      defaultIntervalMs: 5 * 60 * 1000,
      now: now + 28 * 60 * 1000,
      welcomeEnabled: true,
      welcomeIntervalMs: 5 * 60 * 1000,
      lastWelcomeCheckAt: now + 28 * 60 * 1000,
      eventUpdatesEnabled: true,
      eventChangeIntervalMs: 15 * 60 * 1000,
      lastEventCheckAt: now + 28 * 60 * 1000,
      fullEventSyncEnabled: false,
      fullEventSyncIntervalMs: 60 * 60 * 1000,
      lastFullEventSyncAt: 0,
      reconciliationEnabled: true,
      reconciliationIntervalMs: intervalMs,
      lastReconciliationCheckAt: now,
    }),
    2 * 60 * 1000,
  )
})

test('el ciclo de polling vuelve a consultar en cinco minutos por defecto', () => {
  const now = Date.parse('2026-10-01T19:00:00Z')

  assert.equal(
    getPackageAutomationNextDelayMs({
      defaultIntervalMs: 5 * 60 * 1000,
      now,
      welcomeEnabled: true,
      welcomeIntervalMs: 5 * 60 * 1000,
      lastWelcomeCheckAt: now,
      eventUpdatesEnabled: false,
      eventChangeIntervalMs: 15 * 60 * 1000,
      lastEventCheckAt: 0,
      fullEventSyncEnabled: false,
      fullEventSyncIntervalMs: 60 * 60 * 1000,
      lastFullEventSyncAt: 0,
    }),
    5 * 60 * 1000,
  )
})

test('una pagina mixta no detiene la búsqueda por un paquete antiguo aislado', () => {
  const cutoff = Date.parse('2026-10-01T12:00:00Z')
  const getTimestamp = (item) => Date.parse(item.createdAt)

  assert.equal(
    isPackagePageOutsideRecentWindow([
      { createdAt: '2026-10-01T11:30:00Z' },
      { createdAt: '2026-10-01T12:05:00Z' },
    ], cutoff, getTimestamp),
    false,
  )
  assert.equal(
    isPackagePageOutsideRecentWindow([
      { createdAt: '2026-10-01T11:30:00Z' },
      { createdAt: '2026-10-01T11:45:00Z' },
    ], cutoff, getTimestamp),
    true,
  )
  assert.equal(
    isPackagePageOutsideRecentWindow([
      { createdAt: '2026-10-01T11:30:00Z' },
      { createdAt: '' },
    ], cutoff, getTimestamp),
    false,
  )
})

test('interpreta fechas SIOP dia/mes/anio como fecha local de Bolivia', () => {
  const timestamp = parsePackageTimestamp('01/10/2026 15:09')
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/La_Paz',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(timestamp)
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))

  assert.equal(values.year, '2026')
  assert.equal(values.month, '10')
  assert.equal(values.day, '01')
  assert.equal(values.hour, '15')
  assert.equal(values.minute, '09')
  assert.equal(
    isEligibleNewPackageWelcomeEntry({
      contactId: 1,
      source: 'tracking',
      action: 'created',
      updatedAt: timestamp,
      now: Date.parse('2026-10-01T19:10:00Z'),
      recentWindowMs: 24 * 60 * 60 * 1000,
    }),
    true,
  )
  assert.equal(parsePackageTimestamp('2026-10-01T19:09:00.000Z'), Date.parse('2026-10-01T19:09:00.000Z'))
  assert.equal(parsePackageTimestamp('1790881740'), Date.parse('2026-10-01T19:09:00.000Z'))
  assert.equal(parsePackageTimestamp('1790881740000'), Date.parse('2026-10-01T19:09:00.000Z'))
  assert.equal(parsePackageTimestamp('31/02/2026 15:09'), 0)
})

test('activa las respuestas automaticas y fija cinco minutos al migrar la version 6', () => {
  const migration = migrateWelcomeIntervalSetting({
    settings: {
      automaticWelcome: false,
      welcomeResponseIntervalMs: 5 * 60 * 1000,
      welcomeResponseIntervalVersion: 6,
    },
    currentVersion: 7,
    defaultIntervalMs: 5 * 60 * 1000,
  })

  assert.equal(migration.settings.automaticWelcome, true)
  assert.equal(migration.settings.aiAutoReply, true)
  assert.equal(migration.settings.welcomeResponseIntervalMs, 5 * 60 * 1000)
  assert.equal(migration.settings.welcomeResponseIntervalVersion, 7)
})

test('permite bienvenida a paquetes recién creados detectados por Tracking', () => {
  assert.equal(
    isEligibleNewPackageWelcomeEntry({
      contactId: 42,
      source: 'tracking',
      action: 'created',
      updatedAt: 1_790_876_000_000,
      now: 1_790_876_060_000,
      recentWindowMs: 24 * 60 * 60 * 1000,
    }),
    true,
  )
  assert.equal(
    isEligibleNewPackageWelcomeEntry({
      contactId: 42,
      source: 'international',
      action: 'created',
      updatedAt: 1_790_876_000_000,
      now: 1_790_876_060_000,
      recentWindowMs: 24 * 60 * 60 * 1000,
    }),
    false,
  )
})

test('para una bienvenida desde Tracking usa solo los teléfonos del destinatario', () => {
  assert.deepEqual(
    getNewPackageWelcomePhoneCandidates({
      source: 'tracking',
      welcomePhoneCandidates: ['59164229403'],
      phoneCandidates: ['59164229403', '59171234567'],
    }),
    ['59164229403'],
  )
  assert.deepEqual(
    getNewPackageWelcomePhoneCandidates({
      source: 'contact',
      primaryPhone: '59164229403',
    }),
    ['59164229403'],
  )
})

test('extrae teléfonos de varios formatos del destinatario sin usar los del remitente', () => {
  assert.deepEqual(
    getTrackingPackageRecipientPhoneCandidates({
      telefonos: {
        destinatario: { numero: '591 64229403' },
        remitente: '59171234567',
      },
      destinatario: { celular: '(591) 63334455' },
      remitente: { telefono: '59170000000' },
    }),
    ['59164229403', '59163334455'],
  )
})
