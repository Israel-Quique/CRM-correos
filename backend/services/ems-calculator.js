import { readFileSync } from 'node:fs'

const EMS_CATEGORIES = new Set(['EMS NAT', 'EMS INT'])
const REQUEST_TIMEOUT_MS = 10_000
const DEFAULT_EMS_CALCULATOR_ENDPOINT = 'https://postar.correos.gob.bo/api/calcular'
const emsDestinations = JSON.parse(
  readFileSync(new URL('../knowledge/ems-destinations.json', import.meta.url), 'utf8'),
)
const NATIONAL_DESTINATIONS = emsDestinations.national
const INTERNATIONAL_DESTINATIONS = emsDestinations.international
const INTERNATIONAL_ZONE_LABELS = {
  a: 'Sudamérica',
  b: 'Centroamérica y el Caribe',
  c: 'Norteamérica',
  d: 'Europa y Medio Oriente',
  e: 'África y Oceanía',
}
const INTERNATIONAL_CITIES = [
  { name: 'Arica', countryCode: 'chile' },
  { name: 'Santiago', countryCode: 'chile' },
  { name: 'Iquique', countryCode: 'chile' },
  { name: 'Antofagasta', countryCode: 'chile' },
  { name: 'Lima', countryCode: 'peru' },
  { name: 'Tacna', countryCode: 'peru' },
  { name: 'Buenos Aires', countryCode: 'argentina' },
  { name: 'São Paulo', countryCode: 'brasil' },
  { name: 'Madrid', countryCode: 'espana' },
]

const normalizeText = (value) =>
  String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_\s.-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const SPANISH_WEIGHT_NUMBERS = {
  cero: 0,
  un: 1,
  uno: 1,
  una: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
  once: 11,
  doce: 12,
  trece: 13,
  catorce: 14,
  quince: 15,
  dieciseis: 16,
  diecisiete: 17,
  dieciocho: 18,
  diecinueve: 19,
  veinte: 20,
  veintiun: 21,
  veintiuno: 21,
  veintiuna: 21,
  veintidos: 22,
  veintitres: 23,
  veinticuatro: 24,
  veinticinco: 25,
  veintiseis: 26,
  veintisiete: 27,
  veintiocho: 28,
  veintinueve: 29,
  treinta: 30,
}
const WEIGHT_NUMBER_PATTERN = Object.keys(SPANISH_WEIGHT_NUMBERS)
  .sort((first, second) => second.length - first.length)
  .join('|')

export const extractEmsWeightKg = (text = '') => {
  const normalized = normalizeText(String(text).replace(/(\d),(\d)/g, '$1.$2'))
  const weightPattern = new RegExp(
    `\\b(\\d+(?:\\.\\d+)?|${WEIGHT_NUMBER_PATTERN})\\s*(kg|kilo|kilos|kilogramo|kilogramos|g|gr|gramo|gramos)\\b`,
    'g',
  )
  const matches = [...normalized.matchAll(weightPattern)]
  const match = matches[matches.length - 1]
  if (!match) return null

  const value = Number.parseFloat(match[1]) || SPANISH_WEIGHT_NUMBERS[match[1]]
  if (!Number.isFinite(value) || value <= 0) return null
  return /^(g|gr|gramo|gramos)$/.test(match[2]) ? value / 1000 : value
}

export class EmsCalculatorError extends Error {
  constructor(message, code, cause) {
    super(message)
    this.name = 'EmsCalculatorError'
    this.code = code
    if (cause) this.cause = cause
  }
}

export const getEmsCalculatorEndpoint = () =>
  process.env.EMS_CALCULATOR_API_URL?.trim() || DEFAULT_EMS_CALCULATOR_ENDPOINT

export const getEmsInternationalZone = (destinationCode = '') => {
  const destination = INTERNATIONAL_DESTINATIONS.find((entry) => entry.code === destinationCode)
  const zoneKey = destination?.code.match(/^dest_([a-z])_/)?.[1]
  return INTERNATIONAL_ZONE_LABELS[zoneKey] ?? ''
}

export const isEmsInternationalShipmentRequest = (text = '') => {
  const normalized = normalizeText(text)
  return Boolean(inferEmsInternationalDestination(text).destinationCode) &&
    /\b(quiero|quisiera|necesito|deseo|voy a|enviar|envio|mandar|llevar)\b/.test(normalized) &&
    /\b(paquete|paquetes|encomienda|envio)\b/.test(normalized)
}

export const inferEmsCalculatorCategory = (text = '') => {
  const normalized = normalizeText(text)
  const isInternational =
    /\b(internacional|international|exterior|extranjero|fuera del pais|otro pais)\b/.test(normalized) ||
    /\bems\s+int\b/.test(normalized)
  const isNational =
    /\b(nacional|dentro de bolivia|dentro del pais|envio nacional)\b/.test(normalized) ||
    /\bems\s+nat\b/.test(normalized)

  if (isInternational === isNational) return ''
  return isInternational ? 'EMS INT' : 'EMS NAT'
}

export const inferEmsCategoryFromNationalRoute = (text = '') => {
  const normalized = normalizeText(text)
  const matchedDestinations = NATIONAL_DESTINATIONS.filter((destination) =>
    destination.aliases.some((alias) => matchPhrase(normalized, normalizeText(alias))),
  )
  return matchedDestinations.length >= 2 ? 'EMS NAT' : ''
}

export const inferEmsQuoteCategory = ({
  messageBody = '',
  recentNationalRoute = '',
  pendingCategory = '',
  calculatorText = '',
  oversizedPackage = false,
} = {}) =>
  inferEmsCalculatorCategory(messageBody) ||
  (isEmsInternationalShipmentRequest(messageBody) ? 'EMS INT' : '') ||
  pendingCategory ||
  inferEmsCategoryFromNationalRoute(recentNationalRoute) ||
  inferEmsCalculatorCategory(calculatorText) ||
  (oversizedPackage ? 'EMS NAT' : '')

export const shouldForceEmsForWeightLimit = ({
  weightKg,
  maxWeightKg,
  emsAlreadySelected = false,
} = {}) => Number(weightKg) > Number(maxWeightKg) && !emsAlreadySelected

export const isFreshEmsRouteQuoteRequest = ({ text = '', routePlaceCount = 0, hasService = false } = {}) => {
  const normalized = normalizeText(text)
  return (
    routePlaceCount >= 2 &&
    !hasService &&
    /\b(quiero|quisiera|necesito|deseo)\b.*\b(cotizar|cotizacion|enviar|envio|mandar|llevar)\b/.test(normalized) &&
    /\b(paquete|paquetes|encomienda|envio)\b/.test(normalized)
  )
}

export const inferEmsCategoryFromPendingPrompt = (conversation = '') => {
  const assistantMessages = String(conversation)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^Equipo:/i.test(line))
    .map((line) => line.replace(/^Equipo:\s*/i, ''))
    .reverse()

  for (const message of assistantMessages) {
    const normalized = normalizeText(message)
    if (!/\b(peso|dimensiones|alto|ancho|largo|pais de destino|departamento de destino|prefieres ems|quieres cotizar ems)\b/.test(normalized)) {
      continue
    }

    const category = inferEmsCalculatorCategory(message)
    if (category) return category
  }

  return ''
}

export const isEmsWeightReplyMissingUnit = (text = '', conversation = '') => {
  const normalizedReply = normalizeText(String(text).replace(/(\d),(\d)/g, '$1.$2'))
  if (!/^\d+(?:\.\d+)?$/.test(normalizedReply)) return false

  const lastAssistantMessage = String(conversation)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^Equipo:/i.test(line))
    .map((line) => line.replace(/^Equipo:\s*/i, ''))
    .at(-1)
  if (!lastAssistantMessage) return false

  const normalizedPrompt = normalizeText(lastAssistantMessage)
  return Boolean(inferEmsCalculatorCategory(lastAssistantMessage)) &&
    /\bpeso\b/.test(normalizedPrompt) &&
    /\b(kg|kilo|kilos|kilogramo|kilogramos|gramo|gramos)\b/.test(normalizedPrompt)
}

export const isEmsWeightReply = (text = '', conversation = '') => {
  if (!extractEmsWeightKg(text)) return false

  const lastAssistantMessage = String(conversation)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^Equipo:/i.test(line))
    .map((line) => line.replace(/^Equipo:\s*/i, ''))
    .at(-1)
  if (!lastAssistantMessage) return false

  const normalizedPrompt = normalizeText(lastAssistantMessage)
  return Boolean(inferEmsCalculatorCategory(lastAssistantMessage)) &&
    /\bpeso\b/.test(normalizedPrompt)
}

export const buildEmsWeightSpecificationsPrompt = (text = '', category = '') => {
  const weight = normalizeText(String(text).replace(/(\d),(\d)/g, '$1.$2'))
  if (!/^\d+(?:\.\d+)?$/.test(weight)) return ''

  const service = category === 'EMS INT'
    ? 'tu envío EMS Internacional'
    : category === 'EMS NAT'
      ? 'tu envío EMS Nacional'
      : 'tu envío EMS'
  return `Para cotizar con mayor precisión ${service}, confirma si son ${weight} kg e indícame las dimensiones aproximadas del paquete: largo, ancho y alto en centímetros. Si no tienes las medidas, dime “solo con el peso”.`
}

const matchPhrase = (text, phrase) => {
  const escapedPhrase = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')
  return new RegExp(`\\b${escapedPhrase}\\b`).test(text)
}

export const inferEmsInternationalDestination = (text = '') => {
  const normalized = normalizeText(text)
  const explicitCode = normalized.match(/\bdest_[a-e]_[a-z0-9_]+\b/)?.[0]
  if (explicitCode) {
    const explicitCountry = INTERNATIONAL_DESTINATIONS.find((entry) => entry.code === explicitCode)
    return {
      destinationCode: explicitCode,
      countryName: explicitCountry?.name ?? explicitCode.replace(/^dest_[a-e]_/, '').replaceAll('_', ' '),
      specificPlace: '',
    }
  }

  const countryMatch = INTERNATIONAL_DESTINATIONS
    .flatMap((entry) => entry.aliases.map((alias) => ({ entry, alias })))
    .filter(({ alias }) => matchPhrase(normalized, alias))
    .sort((first, second) => second.alias.length - first.alias.length)[0]
  if (countryMatch) {
    const country = countryMatch.entry
    const knownPlace = INTERNATIONAL_CITIES.find((city) => {
      return city.countryCode === country.code.replace(/^dest_[a-e]_/, '') &&
        matchPhrase(normalized, normalizeText(city.name))
    })?.name
    const countryStart = normalized.indexOf(countryMatch.alias)
    const textBeforeCountry = normalized.slice(0, countryStart)
    const placeBeforeCountry = textBeforeCountry.match(
      /\b(?:a|para|hacia)\s+(?:la\s+|el\s+|ciudad de\s+)?([a-z]+(?:\s+[a-z]+){0,2})\s*$/,
    )?.[1]
    const textAfterCountry = normalized.slice(countryStart + countryMatch.alias.length)
    const placeAfterCountry = textAfterCountry.match(
      /^\s*(?:,|en)\s+(?:la ciudad de\s+)?([a-z]+(?:\s+[a-z]+){0,2})\b/,
    )?.[1]
    const specificPlace = knownPlace || placeBeforeCountry || placeAfterCountry || ''
    return {
      destinationCode: country.code,
      countryName: country.name,
      specificPlace: specificPlace
        ? specificPlace.replace(/\b(de|del|la|el|ciudad)\b/g, '').trim().replace(/\b[a-z]/g, (letter) => letter.toUpperCase())
        : '',
    }
  }

  const city = INTERNATIONAL_CITIES.find((entry) => matchPhrase(normalized, normalizeText(entry.name)))
  if (!city) return { destinationCode: '', countryName: '', specificPlace: '' }

  const cityCountry = INTERNATIONAL_DESTINATIONS.find((entry) =>
    entry.code.endsWith(`_${city.countryCode}`),
  )
  return {
    destinationCode: cityCountry?.code ?? '',
    countryName: cityCountry?.name ?? '',
    specificPlace: city.name,
  }
}

export const inferEmsCalculatorDestinationCode = ({ category, text = '', destinationKey = '' }) => {
  if (!EMS_CATEGORIES.has(category)) return ''

  const normalizedKey = normalizeText(destinationKey).replaceAll('-', ' ')
  if (category === 'EMS NAT') {
    if (!normalizedKey || normalizedKey === 'nacional' || normalizedKey === 'internacional') return ''
    return NATIONAL_DESTINATIONS.find((entry) =>
      entry.aliases.some((alias) => normalizeText(alias) === normalizedKey) ||
      entry.code.replace(/^nacional_/, '').replaceAll('_', ' ') === normalizedKey,
    )?.code ?? ''
  }

  return inferEmsInternationalDestination(text).destinationCode
}

export const extractEmsPackageDimensions = (text = '') => {
  const dimensions = {}
  const labeledPatterns = {
    largo: /\b(?:largo|longitud|profundidad)\s*(?:de|:)?\s*(\d+(?:[.,]\d+)?)\s*(mm|cm|m)?\b/,
    ancho: /\b(?:ancho|anchura)\s*(?:de|:)?\s*(\d+(?:[.,]\d+)?)\s*(mm|cm|m)?\b/,
    alto: /\b(?:alto|altura)\s*(?:de|:)?\s*(\d+(?:[.,]\d+)?)\s*(mm|cm|m)?\b/,
  }

  const toCentimeters = (rawValue, unit = 'cm') => {
    const value = Number(rawValue.replace(',', '.'))
    if (!Number.isFinite(value) || value <= 0) return null
    if (unit === 'm') return value * 100
    if (unit === 'mm') return value / 10
    return value
  }

  const normalized = String(text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
  for (const [key, pattern] of Object.entries(labeledPatterns)) {
    const match = normalized.match(pattern)
    if (match) dimensions[key] = toCentimeters(match[1], match[2])
  }

  if (!dimensions.largo || !dimensions.ancho || !dimensions.alto) {
    const triplet = text.match(
      /(\d+(?:[.,]\d+)?)\s*(mm|cm|m)?\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*(mm|cm|m)?\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*(mm|cm|m)?/i,
    )
    if (triplet) {
      const commonUnit = triplet[6] || triplet[4] || triplet[2] || 'cm'
      dimensions.largo = dimensions.largo ?? toCentimeters(triplet[1], triplet[2] || commonUnit)
      dimensions.ancho = dimensions.ancho ?? toCentimeters(triplet[3], triplet[4] || commonUnit)
      dimensions.alto = dimensions.alto ?? toCentimeters(triplet[5], triplet[6] || commonUnit)
    }
  }

  if (![dimensions.largo, dimensions.ancho, dimensions.alto].every((value) => Number.isFinite(value) && value > 0)) {
    return null
  }

  return dimensions
}

const validateInput = ({ category, destination, weight, dimensions }) => {
  if (!EMS_CATEGORIES.has(category)) {
    throw new EmsCalculatorError('La calculadora solo admite EMS NAT o EMS INT.', 'unsupported_category')
  }

  if (typeof destination !== 'string' || !/^[a-z0-9_]+$/i.test(destination)) {
    throw new EmsCalculatorError('El destino debe ser un código válido del catálogo EMS.', 'invalid_destination')
  }

  if (category === 'EMS NAT' && !destination.toLowerCase().startsWith('nacional_')) {
    throw new EmsCalculatorError('EMS NAT requiere un código de destino nacional.', 'invalid_destination')
  }

  if (category === 'EMS INT' && destination.toLowerCase().startsWith('nacional_')) {
    throw new EmsCalculatorError('EMS INT requiere un código de destino internacional.', 'invalid_destination')
  }

  const weightKg = Number(weight)
  if (
    !Number.isFinite(weightKg) ||
    weightKg <= 0 ||
    weightKg > 999999 ||
    Math.abs(weightKg * 1000 - Math.round(weightKg * 1000)) > 1e-8
  ) {
    throw new EmsCalculatorError('El peso debe ser mayor a 0 y tener como máximo 3 decimales.', 'invalid_weight')
  }

  if (dimensions !== undefined && dimensions !== null) {
    for (const dimension of ['largo', 'ancho', 'alto']) {
      const value = Number(dimensions[dimension])
      if (!Number.isFinite(value) || value <= 0 || value > 100_000) {
        throw new EmsCalculatorError('Las dimensiones deben ser medidas positivas en centímetros.', 'invalid_dimensions')
      }
    }
  }

  return weightKg
}

const getCalculatorUrl = (endpoint) => {
  const configuredEndpoint = (typeof endpoint === 'string' ? endpoint.trim() : '') ||
    getEmsCalculatorEndpoint()

  let url
  try {
    url = new URL(configuredEndpoint)
  } catch (cause) {
    throw new EmsCalculatorError('EMS_CALCULATOR_API_URL no es una URL válida.', 'invalid_endpoint', cause)
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new EmsCalculatorError('EMS_CALCULATOR_API_URL debe usar HTTP o HTTPS.', 'invalid_endpoint')
  }

  return url
}

export const calculateEmsTariff = async ({
  category,
  destination,
  weight,
  dimensions,
  endpoint,
  fetchImpl = fetch,
}) => {
  const weightKg = validateInput({ category, destination, weight, dimensions })
  const url = getCalculatorUrl(endpoint)
  const requestBody = {
    categoria: category,
    destino: destination,
    peso: weightKg,
    ...(dimensions ? {
      largo: Number(dimensions.largo),
      ancho: Number(dimensions.ancho),
      alto: Number(dimensions.alto),
    } : {}),
  }

  let response
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (cause) {
    const isTimeout = cause?.name === 'TimeoutError'
    throw new EmsCalculatorError(
      isTimeout ? 'La consulta a la calculadora EMS excedió el tiempo límite.' : 'No se pudo conectar con la calculadora EMS.',
      isTimeout ? 'request_timeout' : 'connection_failed',
      cause,
    )
  }

  let payload
  try {
    payload = JSON.parse(await response.text())
  } catch (cause) {
    throw new EmsCalculatorError('La calculadora EMS devolvió una respuesta JSON inválida.', 'invalid_response', cause)
  }

  if (!response.ok) {
    const code = response.status === 422
      ? 'invalid_destination'
      : response.status === 404 && payload?.reason === 'no_rate'
        ? 'rate_not_found'
        : response.status === 409
          ? 'ambiguous_rate'
          : 'upstream_error'
    const message = code === 'rate_not_found'
      ? 'No hay una tarifa EMS para ese destino y peso.'
      : code === 'invalid_destination'
        ? 'La calculadora EMS no reconoce los datos o el código de destino.'
        : code === 'ambiguous_rate'
          ? 'La calculadora EMS encontró tarifas distintas para esos datos.'
          : `La calculadora EMS respondió con HTTP ${response.status}.`
    throw new EmsCalculatorError(message, code)
  }

  const tariff = Number(payload?.tarifa)
  if (payload?.success !== true || !Number.isFinite(tariff) || tariff < 0) {
    throw new EmsCalculatorError('La calculadora EMS no confirmó una tarifa válida.', 'invalid_calculation')
  }

  if (
    (payload.categoria && payload.categoria !== category) ||
    (payload.destino && payload.destino !== destination)
  ) {
    throw new EmsCalculatorError('La respuesta EMS no coincide con la categoría o el destino solicitado.', 'response_mismatch')
  }

  return {
    category,
    destination,
    weightKg,
    dimensions: dimensions ?? null,
    tariff,
    registrationId: payload.registro_id ?? null,
    sessionId: payload.sesion_consulta ?? null,
  }
}
