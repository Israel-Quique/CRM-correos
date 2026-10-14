const normalizeIntentText = (value) =>
  String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

export const isPackageTrackingRequest = ({ messageBody, packageCode }) => {
  if (!packageCode) return false

  const normalizedMessage = normalizeIntentText(messageBody)
  const hasTrackingIntent =
    /\b(estado|seguimiento|rastreo|rastrear|buscar|busqueda|donde esta|ubicacion|ubicar|trackear|tracking)\b/.test(normalizedMessage)
  const hasPackageFollowUp =
    /\b(y|tambien)\s+(?:de|con|sobre)\s+(?:este|ese|el siguiente)\s+(?:paquete|envio)\b/.test(normalizedMessage)

  return hasTrackingIntent || hasPackageFollowUp
}

export const isPackageDeclarationQuestion = (messageBody) =>
  /\b(declaracion(?:es)?|departamento(?:s)?|destino declarado)\b/.test(
    normalizeIntentText(messageBody),
  )

export const buildPackageDeclarationReply = ({ packageCode, declaration, destinations = [] }) => {
  const code = String(packageCode ?? '').trim()
  const status = String(declaration?.estado ?? '').trim()
  if (!code || !status) return ''

  if (status === 'declarada') {
    const destinationLabels = [...new Set(
      destinations
        .map((destination) => {
          const department = String(destination?.departamento ?? '').trim()
          const city = String(destination?.ciudad ?? '').trim()
          return [department ? `departamento ${department}` : '', city ? `ciudad ${city}` : '']
            .filter(Boolean)
            .join(', ')
        })
        .filter(Boolean),
    )]

    return destinationLabels.length
      ? `La declaración aduanera de la guía ${code} indica como destino declarado: ${destinationLabels.join('; ')}. Esto no confirma la ubicación actual del paquete.`
      : `La guía ${code} figura declarada en CDS, pero la respuesta no informa el departamento de destino.`
  }

  if (status === 'objeto_sin_declaracion') {
    return `SITRA encontró la guía ${code} en CDS, pero no una declaración aduanera asociada.`
  }

  if (status === 'sin_objeto_cds') {
    return `No encontré la guía ${code} en CDS, así que no puedo confirmar una declaración aduanera ni su departamento.`
  }

  if (status === 'consulta_incompleta') {
    return `No pude consultar la declaración CDS de la guía ${code} en este momento, así que no puedo confirmar su departamento.`
  }

  return ''
}

export const isCustomsTrackingContext = ({
  latestEventLabel = '',
  latestEventLocation = '',
  statusLabel = '',
} = {}) => {
  const normalizedContext = normalizeIntentText([
    latestEventLabel,
    latestEventLocation,
    statusLabel,
  ].join(' '))

  return /\b(aduana|aduanas|aduanera|aduanero|aduanero|customs)\b/.test(normalizedContext)
}

export const buildCustomsTrackingReply = ({
  packageCode,
  latestEventLabel = '',
  latestEventLocation = '',
  statusLabel = '',
} = {}) => {
  const code = String(packageCode ?? '').trim()
  if (!code || !isCustomsTrackingContext({ latestEventLabel, latestEventLocation, statusLabel })) return ''

  return [
    `📦 Tu paquete *${code}* se encuentra en aduana.`,
    '🛃 Está en revisión u observación aduanera; te notificaremos cuando registre un nuevo movimiento.',
  ].join('\n')
}

export const isNationalDistributionTrackingContext = ({
  latestEventId = null,
  latestEventLabel = '',
  latestEventSignature = '',
  statusLabel = '',
} = {}) => {
  const eventId = Number(latestEventId)
  if ([13, 14, 35, 71, 72].includes(eventId)) return true

  const normalizedContext = normalizeIntentText([
    latestEventLabel,
    latestEventSignature,
    statusLabel,
  ].join(' '))

  return (
    /\b(distribucion nacional|ubicacion nacional|traslado|clasificacion|clasificando|clasificar)\b/.test(normalizedContext) ||
    /\b(evento|event)\s*(13|14|35|71|72)\b/.test(normalizedContext) ||
    /\b(13|14|35|71|72)\b/.test(normalizedContext)
  )
}

export const buildNationalDistributionTrackingReply = ({
  packageCode,
  latestEventId = null,
  latestEventLabel = '',
  latestEventSignature = '',
  statusLabel = '',
} = {}) => {
  const code = String(packageCode ?? '').trim()
  if (!code || !isNationalDistributionTrackingContext({
    latestEventId,
    latestEventLabel,
    latestEventSignature,
    statusLabel,
  })) return ''

  return [
    `📦 Tu paquete *${code}* ya está en Bolivia.`,
    '🔄 Se está clasificando para su distribución nacional; te notificaremos cuando registre un nuevo movimiento.',
  ].join('\n')
}

export const selectLatestPackageEntry = (entries, getStageRank) =>
  [...entries].sort((first, second) => {
    const timestampDifference = Number(second.updatedAt || 0) - Number(first.updatedAt || 0)
    if (timestampDifference !== 0) return timestampDifference
    return getStageRank(second.stage) - getStageRank(first.stage)
  })[0] ?? null
