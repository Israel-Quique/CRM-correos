export const resolveTariffServiceKey = ({
  currentServiceKey = '',
  isFreshInternationalShipmentRequest = false,
  recentEmsFollowUpCategory = '',
  shouldRouteOversizedPackageToEms = false,
  currentDeliveryMode = '',
  isFreshShipmentRequestWithoutService = false,
  shouldAskServiceForCurrentRoute = false,
  isNewPackageQuestion = false,
  isRouteChangeQuestion = false,
  recentCustomerServiceKey = '',
  isNewTariffQuestionWithoutService = false,
  inferredServiceKey = '',
} = {}) => {
  if (currentServiceKey) return currentServiceKey
  if (isFreshInternationalShipmentRequest) return 'ems'
  if (recentEmsFollowUpCategory && !isFreshShipmentRequestWithoutService) return 'ems'
  if (shouldRouteOversizedPackageToEms) return 'ems'
  if (currentDeliveryMode) return 'delivery_express'
  if (
    !isFreshShipmentRequestWithoutService &&
    !shouldAskServiceForCurrentRoute &&
    !isNewPackageQuestion &&
    isRouteChangeQuestion &&
    recentCustomerServiceKey
  ) {
    return recentCustomerServiceKey
  }
  if (shouldAskServiceForCurrentRoute || isNewPackageQuestion || isNewTariffQuestionWithoutService) {
    return ''
  }
  return recentCustomerServiceKey || inferredServiceKey
}

export const isDeliveryExpressDimensionQuestion = (messageBody = '') => {
  const normalized = String(messageBody)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
  return /\b(mide|medida|medidas|alto|altura|ancho|largo|dimension|dimensiones|metro|metros|cm|centimetro|centimetros)\b/.test(
    normalized,
  )
}
