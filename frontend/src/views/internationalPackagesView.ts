// @ts-nocheck

export const renderInternationalPackagesView = (ctx: any) => {
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
  return `
  <section class="section-panel international-panel ${state.activeView === 'internacionales' ? 'is-visible' : ''}">
    <div class="international-header international-header-compact">
      <div>
        <p class="section-kicker">Tracking Sitra</p>
        <h2>Internacionales</h2>
        <p class="international-helper">Seguimiento de paquetes consumidos desde la API externa.</p>
      </div>
      <div class="international-actions">
        <button class="secondary-btn" type="button" data-open-package-code-lookup>Buscar código</button>
      </div>
    </div>

    ${
      state.trackingApiError
        ? `<div class="notice-banner notice-banner-error">${escapeHtml(state.trackingApiError)}</div>`
        : ''
    }

    <div class="international-api-card">
      <div class="international-api-head">
        <div>
          <p class="section-kicker">Tracking Sitra</p>
          <small>
            ${
              state.trackingApiState === 'loading'
                ? 'Cargando datos en tiempo real...'
                : `${state.trackingApiTotalItems || state.trackingApiPackages.length} registros sincronizados${state.trackingApiSyncedAt ? ` · ${formatConversationTimestamp(state.trackingApiSyncedAt)}` : ''}`
            }
          </small>
        </div>
      </div>

      <div class="international-table-wrap">
        <table class="international-table international-tracking-table">
          <thead>
            <tr>
              <th>Código</th>
              <th>Origen</th>
              <th>Destino</th>
              <th>Estado</th>
              <th>Lugar destino</th>
              <th>Servicio</th>
              <th>Peso</th>
              <th>Teléfono origen</th>
              <th>Teléfono destino</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>${renderTrackingApiRows()}</tbody>
        </table>
      </div>
    </div>

    ${renderTrackingApiPagination()}
  </section>
`

}


