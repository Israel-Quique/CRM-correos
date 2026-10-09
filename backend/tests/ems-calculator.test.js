import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildEmsWeightSpecificationsPrompt,
  calculateEmsTariff,
  EmsCalculatorError,
  extractEmsPackageDimensions,
  extractEmsWeightKg,
  getEmsInternationalZone,
  inferEmsCalculatorCategory,
  inferEmsCategoryFromNationalRoute,
  inferEmsCategoryFromPendingPrompt,
  inferEmsCalculatorDestinationCode,
  inferEmsQuoteCategory,
  inferEmsInternationalDestination,
  isFreshEmsRouteQuoteRequest,
  isEmsInternationalShipmentRequest,
  isUnsupportedEmsInternationalShipmentRequest,
  getAcceptedEmsAlternativeDestination,
  getNearestConfiguredEmsDestination,
  isEmsAlternativeDestinationAcceptance,
  isEmsWeightReply,
  isEmsWeightReplyMissingUnit,
  shouldForceEmsForWeightLimit,
} from '../services/ems-calculator.js'

const endpoint = 'http://127.0.0.1:8000/api/calcular'
const successResponse = (payload) => ({
  ok: true,
  status: 200,
  text: async () => JSON.stringify(payload),
})

test('calcula EMS nacional usando el contrato documentado', async () => {
  let request
  const result = await calculateEmsTariff({
    category: 'EMS NAT',
    destination: 'nacional_la_paz',
    weight: 1,
    endpoint,
    fetchImpl: async (url, options) => {
      request = { url: url.href, options }
      return successResponse({
        success: true,
        categoria: 'EMS NAT',
        destino: 'nacional_la_paz',
        tarifa: 17,
        registro_id: 123,
      })
    },
  })

  assert.equal(request.url, endpoint)
  assert.equal(request.options.method, 'POST')
  assert.deepEqual(JSON.parse(request.options.body), {
    categoria: 'EMS NAT',
    destino: 'nacional_la_paz',
    peso: 1,
  })
  assert.deepEqual(result, {
    category: 'EMS NAT',
    destination: 'nacional_la_paz',
    weightKg: 1,
    dimensions: null,
    tariff: 17,
    registrationId: 123,
    sessionId: null,
  })
})

test('cotiza EMS Nacional de 10 kg a Cochabamba sin exigir dimensiones', async () => {
  let requestBody
  const result = await calculateEmsTariff({
    category: 'EMS NAT',
    destination: 'nacional_cochabamba',
    weight: 10,
    endpoint,
    fetchImpl: async (_url, options) => {
      requestBody = JSON.parse(options.body)
      return successResponse({
        success: true,
        categoria: 'EMS NAT',
        destino: 'nacional_cochabamba',
        tarifa: 85,
      })
    },
  })

  assert.deepEqual(requestBody, {
    categoria: 'EMS NAT',
    destino: 'nacional_cochabamba',
    peso: 10,
  })
  assert.equal(result.tariff, 85)
})

test('incluye dimensiones opcionales en centímetros en la solicitud', async () => {
  let requestBody
  await calculateEmsTariff({
    category: 'EMS NAT',
    destination: 'nacional_la_paz',
    weight: 1,
    dimensions: { largo: 40, ancho: 30, alto: 20 },
    endpoint,
    fetchImpl: async (_url, options) => {
      requestBody = JSON.parse(options.body)
      return successResponse({
        success: true,
        categoria: 'EMS NAT',
        destino: 'nacional_la_paz',
        tarifa: 17,
      })
    },
  })

  assert.deepEqual(requestBody, {
    categoria: 'EMS NAT',
    destino: 'nacional_la_paz',
    peso: 1,
    largo: 40,
    ancho: 30,
    alto: 20,
  })
})

test('extrae dimensiones etiquetadas y formato largo por ancho por alto', () => {
  assert.deepEqual(
    extractEmsPackageDimensions('largo 40 cm, ancho 30 cm, altura 20 cm'),
    { largo: 40, ancho: 30, alto: 20 },
  )
  assert.deepEqual(extractEmsPackageDimensions('40 x 30 x 20 cm'), {
    largo: 40,
    ancho: 30,
    alto: 20,
  })
  assert.deepEqual(extractEmsPackageDimensions('0,4 x 0,3 x 0,2 m'), {
    largo: 40,
    ancho: 30,
    alto: 20,
  })
  assert.deepEqual(extractEmsPackageDimensions('largo 40,5 cm, ancho 30 cm, altura 20 cm'), {
    largo: 40.5,
    ancho: 30,
    alto: 20,
  })
  assert.equal(extractEmsPackageDimensions('40 x 30 cm'), null)
})

test('usa el peso corregido al final de la frase y soporta gramos y decimales', () => {
  assert.equal(extractEmsWeightKg('Mi paquete pesa más de 5 kilos, es decir 10 kilos'), 10)
  assert.equal(extractEmsWeightKg('El paquete pesa 1,5 kg'), 1.5)
  assert.equal(extractEmsWeightKg('El paquete pesa 750 gramos'), 0.75)
  assert.equal(extractEmsWeightKg('Son dos kilos'), 2)
  assert.equal(extractEmsWeightKg('El paquete pesa veintidós kilogramos'), 22)
  assert.equal(extractEmsWeightKg('No indicó el peso'), null)
})

test('calcula EMS internacional con destino del catálogo', async () => {
  const result = await calculateEmsTariff({
    category: 'EMS INT',
    destination: 'dest_a_argentina',
    weight: '1.25',
    endpoint,
    fetchImpl: async () => successResponse({
      success: true,
      categoria: 'EMS INT',
      destino: 'dest_a_argentina',
      tarifa: 228,
    }),
  })

  assert.equal(result.category, 'EMS INT')
  assert.equal(result.weightKg, 1.25)
  assert.equal(result.tariff, 228)
})

test('envía un POST nuevo por cada solicitud de cotización', async () => {
  let requestCount = 0
  const fetchImpl = async () => {
    requestCount += 1
    return successResponse({
      success: true,
      categoria: 'EMS NAT',
      destino: 'nacional_la_paz',
      tarifa: 17,
    })
  }
  const quote = {
    category: 'EMS NAT',
    destination: 'nacional_la_paz',
    weight: 1,
    endpoint,
    fetchImpl,
  }

  await calculateEmsTariff(quote)
  await calculateEmsTariff(quote)

  assert.equal(requestCount, 2)
})

test('rechaza servicios fuera de EMS antes de llamar a la API', async () => {
  await assert.rejects(
    calculateEmsTariff({
      category: 'Delivery Express',
      destination: 'nacional_la_paz',
      weight: 1,
      endpoint,
      fetchImpl: async () => assert.fail('No debe llamar a la API'),
    }),
    (error) => error instanceof EmsCalculatorError && error.code === 'unsupported_category',
  )
})

test('rechaza destinos nacionales para EMS internacional', async () => {
  await assert.rejects(
    calculateEmsTariff({
      category: 'EMS INT',
      destination: 'nacional_la_paz',
      weight: 1,
      endpoint,
      fetchImpl: async () => assert.fail('No debe llamar a la API'),
    }),
    (error) => error instanceof EmsCalculatorError && error.code === 'invalid_destination',
  )
})

test('rechaza peso inválido antes de llamar a la API', async () => {
  await assert.rejects(
    calculateEmsTariff({
      category: 'EMS NAT',
      destination: 'nacional_la_paz',
      weight: 1.2345,
      endpoint,
      fetchImpl: async () => assert.fail('No debe llamar a la API'),
    }),
    (error) => error instanceof EmsCalculatorError && error.code === 'invalid_weight',
  )
})

test('expone con claridad cuando la API no tiene tarifa', async () => {
  await assert.rejects(
    calculateEmsTariff({
      category: 'EMS INT',
      destination: 'dest_a_argentina',
      weight: 1,
      endpoint,
      fetchImpl: async () => ({
        ok: false,
        status: 404,
        text: async () => JSON.stringify({ success: false, reason: 'no_rate' }),
      }),
    }),
    (error) => error instanceof EmsCalculatorError && error.code === 'rate_not_found',
  )
})

test('infiere EMS nacional e internacional sin aceptar mensajes ambiguos', () => {
  assert.equal(inferEmsCalculatorCategory('Quiero EMS nacional'), 'EMS NAT')
  assert.equal(inferEmsCalculatorCategory('Quiero EMS internacional'), 'EMS INT')
  assert.equal(inferEmsCalculatorCategory('Quiero EMS NAT'), 'EMS NAT')
  assert.equal(inferEmsCalculatorCategory('Quiero EMS INT'), 'EMS INT')
  assert.equal(inferEmsCalculatorCategory('EMS nacional e internacional'), '')
})

test('una cotización nueva con ruta local no hereda servicio EMS internacional pendiente', () => {
  const message = 'Quisiera cotizar un envio de un paquete de la paz a cochabamba'
  assert.equal(isFreshEmsRouteQuoteRequest({
    text: message,
    routePlaceCount: 2,
    hasService: false,
  }), true)
  assert.equal(isFreshEmsRouteQuoteRequest({
    text: 'La Paz a Cochabamba, EMS Nacional 2 kg',
    routePlaceCount: 2,
    hasService: true,
  }), false)
  assert.equal(isFreshEmsRouteQuoteRequest({
    text: 'Quisiera cotizar un envio a España',
    routePlaceCount: 1,
    hasService: false,
  }), false)
})

test('la ruta nacional pendiente prevalece al elegir EMS después de otra cotización internacional', () => {
  const conversation = [
    'Cliente: Quisiera enviar un paquete de Bolivia a España',
    'Equipo: Para cotizar EMS Internacional, indícame el país y el peso.',
    'Cliente: Quisiera cotizar el envio de un paquete de la paz a cochabamba',
    'Equipo: Para cotizar de la paz a cochabamba, ¿prefieres EMS Nacional o Delivery Express?',
    'Cliente: Por Ems',
  ].join('\n')
  const pendingCategory = inferEmsCategoryFromPendingPrompt(conversation)
  const recentNationalRoute = 'Quisiera cotizar el envio de un paquete de la paz a cochabamba'

  assert.equal(pendingCategory, 'EMS NAT')
  assert.equal(inferEmsCategoryFromNationalRoute(recentNationalRoute), 'EMS NAT')
})

test('un nuevo envío a Perú prevalece sobre la ruta y la selección EMS nacional anteriores', () => {
  const message = 'y el envio de un paquete a peru'
  assert.equal(isEmsInternationalShipmentRequest(message), true)
  assert.equal(inferEmsQuoteCategory({
    messageBody: message,
    recentNationalRoute: 'Quisiera cotizar el envio de un paquete de la paz a cochabamba',
    pendingCategory: 'EMS NAT',
    calculatorText: message,
  }), 'EMS INT')
})

test('el peso de una cotización EMS Internacional no hereda la ruta nacional previa', () => {
  const conversation = [
    'Cliente: Quisiera cotizar el envio de un paquete de la paz a cochabamba',
    'Equipo: Para cotizar de la paz a cochabamba, ¿prefieres EMS Nacional o Delivery Express?',
    'Cliente: Por Ems',
    'Equipo: Para cotizar EMS Internacional, indícame el peso del paquete en kg.',
  ].join('\n')
  const message = '7kilos'
  const pendingCategory = inferEmsCategoryFromPendingPrompt(conversation)

  assert.equal(extractEmsWeightKg(message), 7)
  assert.equal(pendingCategory, 'EMS INT')
  assert.equal(inferEmsQuoteCategory({
    messageBody: message,
    recentNationalRoute: 'Quisiera cotizar el envio de un paquete de la paz a cochabamba',
    pendingCategory,
    calculatorText: `${conversation}\nCliente: ${message}`,
    oversizedPackage: true,
  }), 'EMS INT')
  assert.equal(shouldForceEmsForWeightLimit({
    weightKg: 7,
    maxWeightKg: 5,
    emsAlreadySelected: true,
  }), false)
  assert.equal(shouldForceEmsForWeightLimit({
    weightKg: 7,
    maxWeightKg: 5,
    emsAlreadySelected: false,
  }), true)
})

test('recupera la categoría EMS de la última pregunta pendiente del agente', () => {
  const conversation = [
    'Equipo: Para cotizar EMS Nacional, indícame el departamento y el peso.',
    'Cliente: Quisiera enviar un paquete de Bolivia a España',
    'Equipo: Para cotizar EMS Internacional, indícame el peso del paquete en kg.',
  ].join('\n')

  assert.equal(inferEmsCategoryFromPendingPrompt(conversation), 'EMS INT')
  assert.equal(
    inferEmsCategoryFromPendingPrompt('Equipo: Para cotizar EMS Nacional, indícame el departamento y el peso.'),
    'EMS NAT',
  )
  assert.equal(inferEmsCategoryFromPendingPrompt('Equipo: ¡Hola! ¿Cómo te puedo ayudar?'), '')
})

test('pide unidad cuando el cliente responde solo con un número a la pregunta de peso EMS', () => {
  const prompt = 'Equipo: Para cotizar EMS Internacional, indícame el peso del paquete en kg.'
  assert.equal(isEmsWeightReplyMissingUnit('2', prompt), true)
  assert.equal(
    isEmsWeightReplyMissingUnit(
      '2',
      [
        'Cliente: Quisiera enviar un paquete de Bolivia a Estados Unidos',
        prompt,
        'Cliente: 2',
      ].join('\n'),
    ),
    true,
  )
  assert.equal(isEmsWeightReplyMissingUnit('1,5', prompt), true)
  assert.equal(isEmsWeightReplyMissingUnit('2 kilos', prompt), false)
  assert.equal(isEmsWeightReplyMissingUnit('2', 'Equipo: ¡Hola! ¿Cómo te puedo ayudar?'), false)
  assert.equal(isEmsWeightReplyMissingUnit('2', 'Equipo: Para cotizar EMS Internacional, indícame el país.'), false)
})

test('reconoce "Son dos kilos" como respuesta al peso EMS solicitado', () => {
  const conversation = [
    'Cliente: Quisiera enviar un paquete de Bolivia a Estados Unidos',
    'Equipo: Para cotizar EMS Internacional, indícame el peso del paquete en kg.',
  ].join('\n')

  assert.equal(isEmsWeightReply('Son dos kilos', conversation), true)
  assert.equal(isEmsWeightReplyMissingUnit('Son dos kilos', conversation), false)
  assert.equal(isEmsWeightReplyMissingUnit('2', conversation), true)
  assert.equal(isEmsWeightReply('Son dos kilos', 'Equipo: ¡Hola! ¿Cómo te ayudo?'), false)
})

test('la aclaración de peso solicita especificaciones para cotizar con precisión', () => {
  const specsPrompt = buildEmsWeightSpecificationsPrompt('2', 'EMS INT')
  assert.equal(
    specsPrompt,
    'Para cotizar con mayor precisión tu envío EMS Internacional, confirma si son 2 kg e indícame las dimensiones aproximadas del paquete: largo, ancho y alto en centímetros. Si no tienes las medidas, dime “solo con el peso”.',
  )
  assert.equal(
    isEmsWeightReplyMissingUnit('2', `Equipo: ${specsPrompt}`),
    true,
    'la solicitud de especificaciones debe conservar contexto EMS para una respuesta numérica posterior',
  )
  assert.match(buildEmsWeightSpecificationsPrompt('1,5', 'EMS NAT'), /EMS Nacional.*1\.5 kg/)
  assert.equal(buildEmsWeightSpecificationsPrompt('dos'), '')
})

test('forma códigos de destino usando las convenciones documentadas', () => {
  assert.equal(
    inferEmsCalculatorDestinationCode({ category: 'EMS NAT', destinationKey: 'la-paz' }),
    'nacional_la_paz',
  )
  assert.equal(
    inferEmsCalculatorDestinationCode({ category: 'EMS NAT', destinationKey: 'cochabamba' }),
    'nacional_cochabamba',
  )
  assert.equal(
    inferEmsCalculatorDestinationCode({ category: 'EMS NAT', destinationKey: 'sucre' }),
    'nacional_chuquisaca',
  )
  assert.equal(
    inferEmsCalculatorDestinationCode({ category: 'EMS INT', text: 'EMS internacional a Argentina 1 kg' }),
    'dest_a_argentina',
  )
  assert.equal(
    inferEmsCalculatorDestinationCode({ category: 'EMS INT', text: 'EMS internacional desde Bolivia a Estados Unidos' }),
    'dest_c_eeuu',
  )
  assert.equal(
    inferEmsCalculatorDestinationCode({ category: 'EMS INT', text: 'EMS internacional a España' }),
    'dest_d_espana',
  )
})

test('clasifica destinos EMS internacionales por su zona postal', () => {
  assert.equal(getEmsInternationalZone('dest_a_argentina'), 'Sudamérica')
  assert.equal(getEmsInternationalZone('dest_b_panama'), 'Centroamérica y el Caribe')
  assert.equal(getEmsInternationalZone('dest_c_eeuu'), 'Norteamérica')
  assert.equal(getEmsInternationalZone('dest_d_espana'), 'Europa y Medio Oriente')
  assert.equal(getEmsInternationalZone('dest_e_australia'), 'África y Oceanía')
  assert.equal(getEmsInternationalZone('nacional_la_paz'), '')
  assert.equal(getEmsInternationalZone('dest_z_unknown'), '')
})

test('detecta una solicitud nueva de envio internacional por pais', () => {
  assert.equal(isEmsInternationalShipmentRequest('Quisiera enviar un paquete de Bolivia a España'), true)
  assert.equal(isEmsInternationalShipmentRequest('Quiero mandar una encomienda a Estados Unidos'), true)
  assert.equal(isEmsInternationalShipmentRequest('Quisiera enviar un paquete a un lugar desconocido'), false)
  assert.equal(isEmsInternationalShipmentRequest('España'), false)
})

test('reconoce China como destino internacional sin tarifa EMS configurada', () => {
  assert.equal(isUnsupportedEmsInternationalShipmentRequest('Buenas noches, quisiera mandar un paquete de La Paz a China4'), true)
  assert.equal(isUnsupportedEmsInternationalShipmentRequest('Quiero enviar una encomienda a China'), true)
  assert.equal(isUnsupportedEmsInternationalShipmentRequest('Quiero conversar sobre China'), false)
})

test('ofrece Rusia como alternativa configurada para una solicitud a China', () => {
  assert.deepEqual(getNearestConfiguredEmsDestination('Quisiera mandar un paquete a China4'), {
    name: 'Rusia',
    code: 'dest_d_rusia',
  })
  assert.equal(getNearestConfiguredEmsDestination('Quisiera enviar a Japón'), null)
})

test('acepta confirmar la cotización EMS a Rusia solo después de ofrecerla', () => {
  const conversation = [
    'Cliente: Quiero mandar un paquete de La Paz a China',
    'Equipo: China no figura en el tarifario EMS disponible. Rusia es una alternativa distinta que puedo revisar; cotizar hasta Rusia no incluye reenvío a China. ¿Quieres que cotice EMS hasta Rusia?',
  ].join('\n')

  assert.equal(isEmsAlternativeDestinationAcceptance({ text: 'Sí, por favor', conversation, destinationName: 'Rusia' }), true)
  assert.equal(isEmsAlternativeDestinationAcceptance({ text: 'sí', conversation: 'Equipo: ¿Quieres cotizar EMS Internacional?', destinationName: 'Rusia' }), false)
  assert.equal(isEmsAlternativeDestinationAcceptance({ text: 'no', conversation, destinationName: 'Rusia' }), false)
  assert.deepEqual(getAcceptedEmsAlternativeDestination([
    'Cliente: Quiero enviar un paquete a China',
    'Equipo: China no figura en el tarifario EMS disponible. Rusia es una alternativa distinta que puedo revisar; cotizar hasta Rusia no incluye reenvío a China. ¿Quieres que cotice EMS hasta Rusia?',
    'Cliente: Sí, por favor',
    'Equipo: Para cotizar EMS Internacional, indícame el peso del paquete en kg.',
  ].join('\n')), { name: 'Rusia', code: 'dest_d_rusia' })
})

test('resuelve una localidad internacional conocida a su país postal', () => {
  assert.deepEqual(inferEmsInternationalDestination('Quiero EMS internacional a Arica'), {
    destinationCode: 'dest_a_chile',
    countryName: 'Chile',
    specificPlace: 'Arica',
  })
  assert.equal(inferEmsCalculatorDestinationCode({
    category: 'EMS INT',
    text: 'Quiero enviar EMS a Arica',
  }), 'dest_a_chile')
  assert.deepEqual(inferEmsInternationalDestination('EMS internacional a Chile'), {
    destinationCode: 'dest_a_chile',
    countryName: 'Chile',
    specificPlace: '',
  })
  assert.deepEqual(inferEmsInternationalDestination('Enviar EMS a Valparaíso, Chile'), {
    destinationCode: 'dest_a_chile',
    countryName: 'Chile',
    specificPlace: 'Valparaiso',
  })
  assert.deepEqual(inferEmsInternationalDestination('Enviar EMS a Valparaiso'), {
    destinationCode: '',
    countryName: '',
    specificPlace: '',
  })
})
