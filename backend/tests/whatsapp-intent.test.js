import assert from 'node:assert/strict'
import test from 'node:test'
import { isPackageTrackingRequest, selectLatestPackageEntry } from '../services/whatsapp-intent.js'

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
