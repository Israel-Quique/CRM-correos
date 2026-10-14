import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildCustomsTrackingReply,
  buildNationalDistributionTrackingReply,
  buildPackageDeclarationReply,
  isPackageDeclarationQuestion,
  isPackageTrackingRequest,
  selectLatestPackageEntry,
} from '../services/whatsapp-intent.js'

test('prioriza consulta de estado con guia sobre una tarifa reciente', () => {
  assert.equal(
    isPackageTrackingRequest({
      messageBody: 'Quisiera saber el estado de este paquete EN000006438LPZ',
      packageCode: 'EN000006438LPZ',
    }),
    true,
  )
})

test('reconoce variaciones acentuadas y menciones de seguimiento', () => {
  assert.equal(
    isPackageTrackingRequest({
      messageBody: '¿Dónde está mi paquete? EN000006438LPZ',
      packageCode: 'EN000006438LPZ',
    }),
    true,
  )
  assert.equal(
    isPackageTrackingRequest({
      messageBody: 'Consulta de seguimiento para EN000006438LPZ',
      packageCode: 'EN000006438LPZ',
    }),
    true,
  )
})

test('reconoce una guia mencionada como otro paquete a consultar', () => {
  assert.equal(
    isPackageTrackingRequest({
      messageBody: 'Y de este paquete EN000005573LPZ',
      packageCode: 'EN000005573LPZ',
    }),
    true,
  )
})

test('reconoce pedir que busquen una guia internacional', () => {
  assert.equal(
    isPackageTrackingRequest({
      messageBody: 'Me podrias buscar este paqiete CP532216072CN',
      packageCode: 'CP532216072CN',
    }),
    true,
  )
})

test('no cambia el enrutamiento a seguimiento si no hay intencion de rastreo o guia', () => {
  assert.equal(
    isPackageTrackingRequest({
      messageBody: 'Quiero cotizar un envio EMS Internacional',
      packageCode: '',
    }),
    false,
  )
  assert.equal(
    isPackageTrackingRequest({
      messageBody: '¿Cuánto cuesta este paquete?',
      packageCode: 'EN000006438LPZ',
    }),
    false,
  )
  assert.equal(
    isPackageTrackingRequest({
      messageBody: 'Quiero cotizar otro envío EN000005573LPZ',
      packageCode: 'EN000005573LPZ',
    }),
    false,
  )
})

test('reconoce consultas de declaración y departamento para una guía', () => {
  assert.equal(isPackageDeclarationQuestion('¿En qué departamento está declarada esta guía?'), true)
  assert.equal(isPackageDeclarationQuestion('¿Tiene declaración aduanera?'), true)
  assert.equal(isPackageDeclarationQuestion('¿Dónde está mi paquete?'), false)
  assert.equal(isPackageDeclarationQuestion('¿Mi paquete está en aduana?'), false)
})

test('responde el destino declarado CDS sin confundirlo con la ubicación actual', () => {
  assert.equal(
    buildPackageDeclarationReply({
      packageCode: 'LP666718164MY',
      declaration: { estado: 'declarada' },
      destinations: [{ departamento: 'Cercado', ciudad: 'Tarija' }],
    }),
    'La declaración aduanera de la guía LP666718164MY indica como destino declarado: departamento Cercado, ciudad Tarija. Esto no confirma la ubicación actual del paquete.',
  )
})

test('no inventa departamento si una declaración no informa el destino', () => {
  assert.equal(
    buildPackageDeclarationReply({
      packageCode: 'EY467201535US',
      declaration: { estado: 'declarada' },
      destinations: [],
    }),
    'La guía EY467201535US figura declarada en CDS, pero la respuesta no informa el departamento de destino.',
  )
})

test('explica claramente cuando SITRA no pudo consultar CDS', () => {
  assert.match(
    buildPackageDeclarationReply({
      packageCode: 'EY467201535US',
      declaration: { estado: 'consulta_incompleta' },
    }),
    /no puedo confirmar su departamento/,
  )
})

test('responde claramente cuando el paquete esta en aduana', () => {
  assert.equal(
    buildCustomsTrackingReply({
      packageCode: 'EC256732418BE',
      latestEventLabel: 'Registrar informacion de aduanas sobre el envio (entrada)',
      latestEventLocation: 'Aduana postal La Paz',
    }),
    [
      '📦 Tu paquete *EC256732418BE* se encuentra en aduana.',
      '🛃 Está en revisión u observación aduanera; te notificaremos cuando registre un nuevo movimiento.',
    ].join('\n'),
  )
})

test('responde claramente cuando el paquete se clasifica para distribucion nacional', () => {
  assert.equal(
    buildNationalDistributionTrackingReply({
      packageCode: 'RV265219436ES',
      latestEventId: 35,
      latestEventLabel: 'Enviar envio a ubicacion nacional (entrada)',
    }),
    [
      '📦 Tu paquete *RV265219436ES* ya está en Bolivia.',
      '🔄 Se está clasificando para su distribución nacional; te notificaremos cuando registre un nuevo movimiento.',
    ].join('\n'),
  )
})

test('detecta distribucion nacional desde la firma del evento del pipeline', () => {
  assert.equal(
    buildNationalDistributionTrackingReply({
      packageCode: 'RV265219436ES',
      latestEventLabel: 'Enviar envio a ubicacion nacional (entrada)',
      latestEventSignature: '35|ENVIAR ENVIO A UBICACION NACIONAL (ENTRADA)|13/10/2026',
    }),
    [
      '📦 Tu paquete *RV265219436ES* ya está en Bolivia.',
      '🔄 Se está clasificando para su distribución nacional; te notificaremos cuando registre un nuevo movimiento.',
    ].join('\n'),
  )
})

test('prefiere el evento de transito mas reciente a un estado avanzado anterior', () => {
  const rank = (stage) => ({ received: 0, transit: 1, regional: 2, courier: 3, delivered: 4 })[stage] ?? -1
  const latestEntry = selectLatestPackageEntry([
    { source: 'contact', stage: 'delivered', updatedAt: Date.parse('2026-10-01T20:00:00Z') },
    { source: 'tracking', stage: 'transit', updatedAt: Date.parse('2026-10-01T21:00:00Z') },
  ], rank)

  assert.equal(latestEntry.source, 'tracking')
  assert.equal(latestEntry.stage, 'transit')
})

test('si dos fuentes tienen el mismo momento, conserva la etapa mas avanzada', () => {
  const rank = (stage) => ({ received: 0, transit: 1, regional: 2, courier: 3, delivered: 4 })[stage] ?? -1
  const latestEntry = selectLatestPackageEntry([
    { source: 'tracking', stage: 'transit', updatedAt: 100 },
    { source: 'contact', stage: 'regional', updatedAt: 100 },
  ], rank)

  assert.equal(latestEntry.stage, 'regional')
})
