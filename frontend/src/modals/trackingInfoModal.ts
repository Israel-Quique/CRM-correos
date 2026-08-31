// @ts-nocheck

export const renderTrackingInfoModal = (ctx: any) => {
  const {
    state,
    menuGroups,
    escapeHtml,
    getBrandIcon,
    getMenuGroupIcon,
    getRobotIcon,
    formatBoliviaTestPhone,
    getFilteredContacts,
    getContactPreviewLine,
    getContactLastMessagePreview,
    getContactConnectionLabel,
    getContactConnectionClass,
    formatConversationTimestamp,
    getStatusClass,
    getFilteredEmsContacts,
    getEmsStatusContacts,
    getEmsStatusKey,
    getEmsStatusLabel,
    getEmsStatusToneClass,
    getEmsPhaseLabel,
    getEmsPhaseDescription,
    getChatContacts,
    isAutoCreatedChatContact,
    getConversationMessagesChronological,
    renderConversationMessageMedia,
    getConversationMediaUrl,
    getAttachmentKindLabel,
    isAiAssistedConversation,
    getWhatsAppReference,
    hasWhatsAppChannel,
    isContactConnected,
    getTrackingApiPagination,
    renderTrackingApiRows,
    renderTrackingApiPagination,
    getContactPackagesPagination,
    renderContactPackagesRows,
    renderContactPackagesPagination,
    getTrackingPipelineColumns,
    getTrackingPipelineStage,
    renderCountryWithFlag,
    getTrackingOriginPhoneValue,
    getTrackingDestinationPhoneValue,
    getContactPackageRemitenteName,
    getContactPackageDestinatarioName,
    getContactPackageRemitentePhone,
    getContactPackageDestinatarioPhone,
    getProntsColumnConfig,
    getProntsColumnContacts,
    getProntsSelectedContact,
    getProntsTokenChips,
    buildProntsSimulationResponse,
    findPhoneCountry,
    getFlagIconClass,
    defaultWhatsAppCountry,
    contactChannelOptions,
    phoneCountryOptions,
    truncateText,
    getPhoneCountryLabel,
    getCountryLabel,
    getCountryIso2,
    getCountryIso2FromLabel,
    getGroupPickerResultsMarkup
  } = ctx
  if (!state.selectedTrackingApiPackage) {
    return ''
  }

  const selectedPackage = state.selectedTrackingApiPackage
  const originLabel = renderCountryWithFlag(
    selectedPackage.origen.nombre || selectedPackage.origen.codigo,
    selectedPackage.origen.codigo,
  )
  const destinationLabel = renderCountryWithFlag(
    selectedPackage.destino.nombre || selectedPackage.destino.codigo,
    selectedPackage.destino.codigo,
  )
  const events = selectedPackage.eventos ?? []

  return `
    <div class="modal-backdrop" id="tracking-info-modal-backdrop">
      <div class="modal-card modal-card-profile tracking-info-modal">
        <div class="modal-header">
          <div>
            <p class="section-kicker">Información del paquete</p>
            <h3>${escapeHtml(selectedPackage.codigo_s10 || selectedPackage.codigo || 'Sin código')}</h3>
            <small class="conversation-subtitle">Detalle completo del tracking, origen, destino, teléfono y eventos.</small>
          </div>
          <button class="modal-close" id="close-tracking-info-modal" type="button">Cerrar</button>
        </div>

        <div class="profile-modal-hero">
          <div class="conversation-contact-avatar conversation-contact-avatar-xl">
            ${escapeHtml((selectedPackage.codigo_s10 || selectedPackage.codigo || '?').slice(0, 1))}
          </div>
          <div class="profile-modal-copy">
            <strong>${escapeHtml(selectedPackage.tipo_servicio || selectedPackage.clase_correo || 'Sin servicio')}</strong>
            <span>${escapeHtml(selectedPackage.fecha_registro || 'Sin fecha')}</span>
          </div>
          <span class="ems-chat-status is-active">
            ${escapeHtml(selectedPackage.estado_postal || 'Sin estado')}
          </span>
        </div>

        <div class="ems-meta-row profile-modal-grid">
          <div class="ems-meta-card">
            <span>Código origen</span>
            <strong>${escapeHtml(selectedPackage.origen.codigo || 'Sin código')}</strong>
          </div>
          <div class="ems-meta-card">
            <span>Código destino</span>
            <strong>${escapeHtml(selectedPackage.destino.codigo || 'Sin código')}</strong>
          </div>
          <div class="ems-meta-card">
            <span>Origen</span>
            <strong>${originLabel}</strong>
          </div>
          <div class="ems-meta-card">
            <span>Destino</span>
            <strong>${destinationLabel}</strong>
          </div>
          <div class="ems-meta-card">
            <span>Peso</span>
            <strong>${escapeHtml(selectedPackage.peso == null ? '—' : `${selectedPackage.peso} Kg`)}</strong>
          </div>
          <div class="ems-meta-card">
            <span>Teléfono origen</span>
            <strong>${escapeHtml(getTrackingOriginPhoneValue(selectedPackage))}</strong>
          </div>
          <div class="ems-meta-card">
            <span>Teléfono destino</span>
            <strong>${escapeHtml(getTrackingDestinationPhoneValue(selectedPackage))}</strong>
          </div>
        </div>

        <div class="tracking-info-section">
          <h4>Eventos</h4>
          ${
            events.length > 0
              ? `
                <div class="tracking-events-list">
                  ${events
                    .map(
                      (event) => `
                        <article class="tracking-event-card">
                          <strong>${escapeHtml(event.evento_api || event.evento_original || 'Evento')}</strong>
                          <span>${escapeHtml(event.fecha || 'Sin fecha')}</span>
                          <p>${escapeHtml([event.oficina, event.detalle, event.movimiento_bolivia].filter(Boolean).join(' · ') || 'Sin detalles')}</p>
                        </article>
                      `,
                    )
                    .join('')}
                </div>
              `
              : '<div class="empty-inline">Este paquete no trae eventos registrados.</div>'
          }
        </div>
      </div>
    </div>
  `
}



