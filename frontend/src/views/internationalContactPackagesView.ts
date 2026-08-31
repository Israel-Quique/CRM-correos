// @ts-nocheck

export const renderInternationalContactPackagesView = (ctx: any) => {
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
    getContactPackageTypeOptions,
    getContactPackageStatusOptions,
    getFilteredContactPackages,
    renderContactPackagesRows,
    renderContactPackagesPagination,
    exportContactPackagesToExcel,
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
  const isLookupContactResult = Boolean(state.packageCodeLookupResult?.found && state.packageCodeLookupResult?.contact?.record)
  return `
  <section class="section-panel international-panel ${state.activeView === 'internacionales-paquetes' ? 'is-visible' : ''}">
    <div class="international-header international-header-compact">
      <div>
        <p class="section-kicker">Paquetes de Contactos</p>
        <h2>Tabla general de paquetes</h2>
        <p class="international-helper">Lista consolidada de paquetes consumidos desde la API de contactos.</p>
      </div>
      <div class="international-actions">
        <button class="secondary-btn" type="button" data-open-package-code-lookup>Buscar código</button>
      </div>
    </div>

    ${
      state.contactPackagesError
        ? `<div class="notice-banner notice-banner-error">${escapeHtml(state.contactPackagesError)}</div>`
        : ''
    }

    <div class="international-api-card">
      <div class="international-api-head">
        <div>
          <p class="section-kicker">Paquetes de Contactos</p>
          <small>
            ${
              state.contactPackagesState === 'loading'
                ? 'Cargando datos en tiempo real...'
                : `${state.contactPackagesTotalItems || state.contactPackages.length} registros sincronizados${state.contactPackagesSyncedAt ? ` · ${formatConversationTimestamp(state.contactPackagesSyncedAt)}` : ''}`
            }
          </small>
        </div>
        <div class="international-api-actions">
          <label class="field-control compact-field">
            <span>Tipo de paquete</span>
            <select id="contact-packages-type-filter">
              <option value="all" ${state.contactPackagesTypeFilter === 'all' ? 'selected' : ''}>Todos los tipos</option>
              ${getContactPackageTypeOptions()
                .map(
                  (type) =>
                    `<option value="${escapeHtml(type)}" ${state.contactPackagesTypeFilter === type ? 'selected' : ''}>${escapeHtml(type)}</option>`,
                )
                .join('')}
            </select>
          </label>
          <label class="field-control compact-field">
            <span>Estado</span>
            <select id="contact-packages-status-filter">
              <option value="all" ${state.contactPackagesStatusFilter === 'all' ? 'selected' : ''}>Todos los estados</option>
              ${getContactPackageStatusOptions()
                .map(
                  (status) =>
                    `<option value="${escapeHtml(status)}" ${state.contactPackagesStatusFilter === status ? 'selected' : ''}>${escapeHtml(status)}</option>`,
                )
                .join('')}
            </select>
          </label>
          ${
            isLookupContactResult
              ? '<button class="secondary-btn" id="clear-package-code-lookup-filter" type="button">Limpiar filtro</button>'
              : ''
          }
          <button class="table-action-btn" id="export-contact-packages" type="button">Exportar Excel</button>
        </div>
      </div>

      ${
        state.contactPackagesTypeFilter !== 'all'
          ? `<p class="international-filter-summary">Mostrando ${getFilteredContactPackages().length} de ${state.contactPackages.length} paquetes cargados.</p>`
          : ''
      }

      <div class="international-table-wrap">
        <table class="international-table international-tracking-table">
          <thead>
            <tr>
              <th>Código</th>
              <th>Remitente</th>
              <th>Destinatario</th>
              <th>Estado</th>
              <th>Lugar destino</th>
              <th>Tipo</th>
              <th>Fecha</th>
              <th>Teléfono remitente</th>
              <th>Teléfono destinatario</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>${renderContactPackagesRows()}</tbody>
        </table>
      </div>
    </div>

    ${renderContactPackagesPagination()}
  </section>
`

}


