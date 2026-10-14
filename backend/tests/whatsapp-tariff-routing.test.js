import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isDeliveryExpressDimensionQuestion,
  resolveTariffServiceKey,
} from '../services/whatsapp-tariff-routing.js'

test('the explicit service overrides an older EMS follow-up and weight fallback', () => {
  assert.equal(
    resolveTariffServiceKey({
      currentServiceKey: 'delivery_express',
      recentEmsFollowUpCategory: 'EMS NAT',
      shouldRouteOversizedPackageToEms: true,
      recentCustomerServiceKey: 'ems',
    }),
    'delivery_express',
  )
})

test('the explicit EMS service overrides an older Delivery Express selection', () => {
  assert.equal(
    resolveTariffServiceKey({
      currentServiceKey: 'ems',
      recentCustomerServiceKey: 'delivery_express',
    }),
    'ems',
  )
})

test('a Delivery Express mode identifies the service when its name is omitted', () => {
  assert.equal(resolveTariffServiceKey({ currentDeliveryMode: 'ventanilla_a_ventanilla' }), 'delivery_express')
})

test('Delivery Express dimension questions are detected without requiring route or mode details', () => {
  assert.equal(isDeliveryExpressDimensionQuestion('Pesa 500 gramos, mide 2 metros por 2 metros. ¿Puedo enviarlo?'), true)
  assert.equal(isDeliveryExpressDimensionQuestion('Paquete de 3 kg por Delivery Express'), false)
})
