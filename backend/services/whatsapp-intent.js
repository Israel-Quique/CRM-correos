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

export const selectLatestPackageEntry = (entries, getStageRank) =>
  [...entries].sort((first, second) => {
    const timestampDifference = Number(second.updatedAt || 0) - Number(first.updatedAt || 0)
    if (timestampDifference !== 0) return timestampDifference
    return getStageRank(second.stage) - getStageRank(first.stage)
  })[0] ?? null
