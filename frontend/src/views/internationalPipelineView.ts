// @ts-nocheck

export const renderInternationalPipelineView = (ctx: any) => {
  const {
    state,
    escapeHtml,
    formatConversationTimestamp,
    getEmsStatusToneClass,
    getTrackingPipelineColumns,
    getTrackingPipelineStage,
    renderCountryWithFlag,
    getTrackingOriginPhoneValue,
    getTrackingDestinationPhoneValue,
  } = ctx

  const columns = getTrackingPipelineColumns('international')
  const pipelineColumns = state.pipelineConfig.columns
  const orderedColumns = ['received', 'transit', 'regional', 'courier', 'delivered', 'cancelled']
  const totalItems = orderedColumns.reduce((total, key) => total + (columns[key]?.length ?? 0), 0)
  const isLoading = state.trackingApiState === 'loading' || state.trackingApiCatalogState === 'loading'

  const getColumnTitle = (key: string) =>
    pipelineColumns[key]?.title ??
    (key === 'cancelled'
      ? 'Cancelado'
      : key === 'delivered'
        ? 'Entregado'
        : key === 'courier'
          ? 'Cartero'
          : key === 'regional'
            ? 'Recibido Destino'
            : key === 'transit'
              ? 'En Camino'
              : 'Recibido Origen')

  const getColumnHelper = (key: string) =>
    pipelineColumns[key]?.helper ??
    (key === 'cancelled'
      ? 'Paquetes cancelados, anulados o rechazados.'
      : key === 'delivered'
        ? 'Entregas confirmadas y cerradas.'
        : key === 'courier'
          ? 'Paquetes asignados a reparto.'
          : key === 'regional'
            ? 'Paquetes recibidos en la regional de destino.'
            : key === 'transit'
              ? 'En tránsito hacia el destino final.'
              : 'Paquetes recibidos en origen y agrupados para despacho.')

  const getStageLabel = (stage: string) =>
    stage === 'delivered'
      ? 'Entregado'
      : stage === 'courier'
        ? 'Cartero'
        : stage === 'transit'
          ? 'En camino'
          : stage === 'regional'
            ? 'Recibido destino'
            : stage === 'cancelled'
              ? 'Cancelado'
              : 'Recibido origen'

  const getPackageCode = (item: any) => item.codigo_s10 || item.codigo || 'Sin código'

  const renderPipelineCard = (item: any) => {
    const stage = getTrackingPipelineStage(item)
    const code = getPackageCode(item)
    const originName = item.origen?.nombre || item.origen?.codigo || 'Sin origen'
    const destinationName = item.destino?.nombre || item.destino?.codigo || 'Sin destino'

    return `
      <button
        class="ems-package-card ${stage}"
        data-tracking-info="${escapeHtml(String(item.mailitm_pid ?? code))}"
        type="button"
      >
        <div class="ems-package-card-top">
          <div class="ems-package-avatar">${escapeHtml(String(code).slice(0, 1))}</div>
          <div class="ems-package-copy">
            <strong>${escapeHtml(code)}</strong>
            <span>${escapeHtml(item.contenido || item.tipo_servicio || item.clase_correo || 'Tracking SITRA')}</span>
          </div>
        </div>
        <p class="ems-package-message">${renderCountryWithFlag(originName, item.origen?.codigo)} <span class="international-pipeline-arrow">→</span> ${renderCountryWithFlag(destinationName, item.destino?.codigo)}</p>
        <div class="ems-package-meta">
          <span>${escapeHtml(item.remitente?.nombre || 'Tracking API')}</span>
          <small>${escapeHtml(getTrackingOriginPhoneValue(item))} · Origen</small>
        </div>
        <div class="ems-package-meta">
          <span>${escapeHtml(item.destinatario?.nombre || 'Sin destinatario')}</span>
          <small>${escapeHtml(getTrackingDestinationPhoneValue(item))} · Destino</small>
        </div>
        <div class="ems-package-foot">
          <span class="ems-package-time">${escapeHtml(formatConversationTimestamp(item.fecha_registro))}</span>
          <span class="ems-package-badge ${getEmsStatusToneClass(stage)}">${escapeHtml(getStageLabel(stage))}</span>
        </div>
      </button>
    `
  }

  const renderColumn = (key: string, index: number) => {
    const items = columns[key] ?? []

    return `
      <section class="ems-kanban-column ${key}">
        <div class="ems-kanban-column-head">
          <div class="ems-kanban-column-title">
            <span class="ems-dot ${key}"></span>
            <div class="ems-kanban-column-heading">
              <strong>${index + 1}. ${escapeHtml(getColumnTitle(key).toUpperCase())}</strong>
              <span>${escapeHtml(getColumnHelper(key))}</span>
            </div>
          </div>
          <div class="ems-column-head-actions">
            <span class="ems-column-count">${items.length}</span>
          </div>
        </div>
        <label class="ems-column-search">
          <input type="text" value="" placeholder="Buscar por código..." disabled />
        </label>
        <div class="ems-column-actions">
          <button class="secondary-btn ems-column-state-btn is-states" data-open-api-pipeline-states="${escapeHtml(key)}" type="button">+ Estados</button>
          <button class="primary-btn ems-column-state-btn is-packages" type="button" disabled>+ Paquetes</button>
        </div>
        <div class="ems-column-list ems-dropzone">
          ${
            isLoading && items.length === 0
              ? `<div class="empty-state ems-empty-column">Cargando paquetes...</div>`
              : items.length > 0
                ? items.slice(0, 8).map((item: any) => renderPipelineCard(item)).join('')
                : `<div class="empty-state ems-empty-column">Sin paquetes en este estado.</div>`
          }
        </div>
        <div class="ems-column-pagination">
          <button class="secondary-btn" type="button" disabled>&lt;</button>
          <span>${items.length > 8 ? `Mostrando 8 de ${items.length}` : `Total ${items.length}`}</span>
          <button class="secondary-btn" type="button" disabled>&gt;</button>
        </div>
      </section>
    `
  }

  return `
    <section class="section-panel international-panel international-pipeline-panel ${state.activeView === 'internacionales-pipeline' ? 'is-visible' : ''}">
      <div class="ems-control-board international-ems-board">
        <div class="ems-control-header">
          <div class="ems-control-copy">
            <p class="section-kicker">Pipeline de internacionales</p>
            <h2>Flujo de seguimiento internacional</h2>
            <p class="ems-control-subtitle">Agrupa los paquetes de Tracking SITRA por estado para ver el avance de cada envío internacional.</p>
            <strong class="international-pipeline-total">${totalItems} paquetes cargados desde Tracking API</strong>
          </div>
          <div class="ems-control-actions">
            <button class="secondary-btn" id="refresh-tracking-packages" type="button" ${isLoading ? 'disabled' : ''}>Actualizar paquetes</button>
          </div>
        </div>

        ${
          state.trackingApiError
            ? `<div class="notice-banner notice-banner-error">${escapeHtml(state.trackingApiError)}</div>`
            : ''
        }

        <div class="ems-kanban-grid international-kanban-board">
          ${orderedColumns.map((key, index) => renderColumn(key, index)).join('')}
        </div>
      </div>
    </section>
  `
}
