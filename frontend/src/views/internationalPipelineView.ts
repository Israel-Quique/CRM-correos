// @ts-nocheck

export const renderInternationalPipelineView = (ctx: any) => {
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
  const columns = getTrackingPipelineColumns()
  const totalItems = state.trackingApiPackages.length
  const pipelineColumns = state.pipelineConfig.columns

  const renderPipelineCard = (item: TrackingApiPackage) => {
    const stage = getTrackingPipelineStage(item)
    const stageLabel =
      stage === 'delivered'
        ? 'Entregado'
          : stage === 'courier'
            ? 'Cartero'
        : stage === 'transit'
          ? 'En camino'
          : stage === 'regional'
            ? 'Recibido regional'
            : 'Recibido inicial'

    return `
      <article class="international-pipeline-card">
        <div class="international-pipeline-card-head">
          <strong>${escapeHtml(item.codigo_s10 || item.codigo || 'Sin código')}</strong>
          <span class="international-pipeline-badge ${stage}">${escapeHtml(stageLabel)}</span>
        </div>
        <div class="international-pipeline-card-meta">
          ${renderCountryWithFlag(item.origen.nombre || item.origen.codigo || 'Sin origen', item.origen.codigo)}
          <span class="international-pipeline-arrow">-></span>
          ${renderCountryWithFlag(item.destino.nombre || item.destino.codigo || 'Sin destino', item.destino.codigo)}
        </div>
        <div class="international-pipeline-card-grid">
          <span><strong>Servicio</strong>${escapeHtml(item.tipo_servicio || item.clase_correo || '—')}</span>
          <span><strong>Peso</strong>${escapeHtml(item.peso == null ? '—' : `${item.peso} Kg`)}</span>
          <span><strong>Tel. origen</strong>${escapeHtml(getTrackingOriginPhoneValue(item))}</span>
          <span><strong>Tel. destino</strong>${escapeHtml(getTrackingDestinationPhoneValue(item))}</span>
        </div>
        <div class="international-pipeline-card-actions">
          <small>${escapeHtml(formatConversationTimestamp(item.fecha_registro))}</small>
          <button class="table-action-btn" data-tracking-info="${item.mailitm_pid}" type="button">Información</button>
        </div>
      </article>
    `
  }

  const renderColumn = (key: EmsColumnKey, items: TrackingApiPackage[]) => `
    <section class="international-pipeline-column ${key}">
      <div class="international-pipeline-column-head">
        <div>
          <strong>${escapeHtml(pipelineColumns[key].title)}</strong>
          <small>${escapeHtml(pipelineColumns[key].helper)}</small>
        </div>
        <span>${items.length}</span>
      </div>
      <button class="primary-btn ems-column-state-btn" data-open-api-pipeline-states type="button">+ Estados de paquetes</button>
      <div class="international-pipeline-list">
        ${
          items.length > 0
            ? items.map((item) => renderPipelineCard(item)).join('')
            : `<div class="international-pipeline-empty">Sin paquetes en este estado.</div>`
        }
      </div>
    </section>
  `

  return `
    <section class="section-panel international-panel international-pipeline-panel ${state.activeView === 'internacionales-pipeline' ? 'is-visible' : ''}">
      <div class="international-header international-header-compact">
        <div>
          <p class="section-kicker">Pipeline de Internacionales</p>
          <h2>Flujo de seguimiento internacional</h2>
          <p class="international-helper">Agrupa los paquetes por estado para ver el avance de cada envío.</p>
        </div>
      </div>

      ${
        state.trackingApiError
          ? `<div class="notice-banner notice-banner-error">${escapeHtml(state.trackingApiError)}</div>`
          : ''
      }

      ${
        state.pipelineConfigError
          ? `<div class="notice-banner notice-banner-error">${escapeHtml(state.pipelineConfigError)}</div>`
          : ''
      }

      <div class="international-pipeline-summary">
        <strong>${totalItems}</strong>
        <span>paquetes cargados desde la API</span>
      </div>

      <section class="table-card pipeline-config-card">
        <div class="table-toolbar pipeline-config-toolbar">
          <div>
            <strong>Configuración del pipeline</strong>
            <span>Edita los nombres y descripciones de cada columna. Los prompts usan esta misma estructura.</span>
          </div>
          <div class="pipeline-config-actions">
            <button class="secondary-btn" id="pipeline-reset-defaults" type="button">Restablecer</button>
            <button class="primary-btn" id="pipeline-save-config" type="button" ${state.pipelineConfigState === 'submitting' ? 'disabled' : ''}>${state.pipelineConfigState === 'submitting' ? 'Guardando...' : 'Guardar pipeline'}</button>
          </div>
        </div>
        <div class="pipeline-config-grid">
          ${(['received', 'transit', 'regional', 'courier', 'delivered'] as EmsColumnKey[])
            .map(
              (key) => `
                <article class="pipeline-config-item">
                  <strong>${escapeHtml(pipelineColumns[key].title)}</strong>
                  <label>
                    <span>Título</span>
                    <input type="text" value="${escapeHtml(pipelineColumns[key].title)}" data-pipeline-title-input="${key}" />
                  </label>
                  <label>
                    <span>Descripción</span>
                    <input type="text" value="${escapeHtml(pipelineColumns[key].helper)}" data-pipeline-helper-input="${key}" />
                  </label>
                </article>
              `,
            )
            .join('')}
        </div>
      </section>

      <div class="international-pipeline-grid">
        ${renderColumn('received', columns.received)}
        ${renderColumn('transit', columns.transit)}
        ${renderColumn('regional', columns.regional)}
        ${renderColumn('courier', columns.courier)}
        ${renderColumn('delivered', columns.delivered)}
      </div>
    </section>
  `
}



