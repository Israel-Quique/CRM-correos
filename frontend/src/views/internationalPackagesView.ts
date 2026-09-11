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
    getTrackingApiAvailableStates,
    getTrackingApiAvailableServices,
    getTrackingApiAvailableCountries,
    getTrackingApiTableHead,
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
        <label class="field-control compact-field">
          <span>Estado</span>
          <select id="tracking-api-state-filter">
            <option value="all" ${state.trackingApiStateFilter === 'all' ? 'selected' : ''}>Todos los estados</option>
            ${getTrackingApiAvailableStates()
              .map(
                (status) =>
                  `<option value="${escapeHtml(status.value)}" ${state.trackingApiStateFilter === status.value ? 'selected' : ''}>${escapeHtml(status.label)} (${status.count})</option>`,
              )
              .join('')}
          </select>
        </label>

        <label class="field-control compact-field">
          <span>Servicio</span>
          <select id="tracking-api-service-filter">
            <option value="all" ${state.trackingApiServiceFilter === 'all' ? 'selected' : ''}>Todos los servicios</option>
            ${getTrackingApiAvailableServices()
              .map(
                (service: any) =>
                  `<option value="${escapeHtml(service.value)}" ${state.trackingApiServiceFilter === service.value ? 'selected' : ''}>${escapeHtml(service.label)} (${service.count})</option>`,
              )
              .join('')}
          </select>
        </label>

        <label class="field-control compact-field">
          <span>Origen</span>
          <select id="tracking-api-origin-filter">
            <option value="all" ${state.trackingApiOriginFilter === 'all' ? 'selected' : ''}>Todos los origenes</option>
            ${getTrackingApiAvailableCountries('origen')
              .map(
                (country: any) =>
                  `<option value="${escapeHtml(country.value)}" ${state.trackingApiOriginFilter === country.value ? 'selected' : ''}>${escapeHtml(country.label)} (${country.count})</option>`,
              )
              .join('')}
          </select>
        </label>

        <label class="field-control compact-field">
          <span>Destino</span>
          <select id="tracking-api-destination-filter">
            <option value="all" ${state.trackingApiDestinationFilter === 'all' ? 'selected' : ''}>Todos los destinos</option>
            ${getTrackingApiAvailableCountries('destino')
              .map(
                (country: any) =>
                  `<option value="${escapeHtml(country.value)}" ${state.trackingApiDestinationFilter === country.value ? 'selected' : ''}>${escapeHtml(country.label)} (${country.count})</option>`,
              )
              .join('')}
          </select>
        </label>

        <form id="tracking-api-code-form" class="international-code-search">
          <label class="field-control compact-field">
            <span>Código</span>
            <span>Codigo</span>
            <input
              id="tracking-api-code-search"
              type="search"
              placeholder="Ej. EE000725146BO"
              value="${escapeHtml(state.packageCodeLookupQuery)}"
            />
          </label>
          ${
            state.packageCodeLookupQuery
              ? '<button class="secondary-btn" id="tracking-api-code-clear" type="button">Limpiar</button>'
              : ''
          }
          <button class="secondary-btn" type="submit">Buscar código</button>
          <button class="secondary-btn" type="submit">Buscar codigo</button>
        </form>
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
          ${getTrackingApiTableHead()}
          <tbody>${renderTrackingApiRows()}</tbody>
        </table>
      </div>
    </div>

    ${renderTrackingApiPagination()}
  </section>
`

}
