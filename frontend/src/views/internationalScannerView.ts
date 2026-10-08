// @ts-nocheck

export const renderInternationalScannerView = (ctx: any) => {
  const {
    state,
    escapeHtml,
    formatConversationTimestamp,
    getEmsStatusToneClass,
    getTrackingPipelineStage,
    renderCountryWithFlag,
  } = ctx

  const stages = [
    { key: 'received', label: 'Origen y llegada' },
    { key: 'transit', label: 'Aduana' },
    { key: 'regional', label: 'Distribución nacional' },
    { key: 'courier', label: 'Última milla' },
    { key: 'delivered', label: 'Entregado' },
    { key: 'cancelled', label: 'Importación detenida' },
  ]
  const sessionLog = Array.isArray(state.scannerSessionLog) ? state.scannerSessionLog : []
  const stageCounts = Object.fromEntries(
    stages.map(({ key }) => [key, sessionLog.filter((entry) => entry.stage === key).length]),
  )
  const visibleLog = state.scannerStageFilter === 'all'
    ? sessionLog
    : sessionLog.filter((entry) => entry.stage === state.scannerStageFilter)
  const trackingPackages = Array.isArray(state.trackingApiCatalogPackages) && state.trackingApiCatalogPackages.length > 0
    ? state.trackingApiCatalogPackages
    : Array.isArray(state.trackingApiPackages)
      ? state.trackingApiPackages
      : []
  const quickCodes = trackingPackages
    .map((item) => String(item.codigo_s10 || item.codigo || '').trim().toUpperCase())
    .filter(Boolean)
    .filter((code, index, values) => values.indexOf(code) === index)
    .slice(0, 4)
  const result = state.scannerResult
  const events = Array.isArray(result?.eventos) ? result.eventos : []
  const latestEvent = events.length > 0 ? events[events.length - 1] : null
  const resultCode = result?.codigo_s10 || result?.codigo || state.scannerQuery
  const resultStage = result ? getTrackingPipelineStage(result) : ''
  const stageLabel = stages.find(({ key }) => key === resultStage)?.label || 'Sin etapa'
  const stageTone = resultStage ? getEmsStatusToneClass(resultStage) : ''
  const trackingStates = state.trackingApiState === 'loading'
    ? 'Sincronizando catálogo de tracking…'
    : state.trackingApiTotalItems || trackingPackages.length
      ? `${Number(state.trackingApiTotalItems || trackingPackages.length).toLocaleString('es-BO')} paquetes disponibles`
      : 'Consulta individual; catálogo completo bajo demanda'
  const errorMessage = state.scannerQueryError || state.scannerEventsError

  const renderEvent = (event) => {
    const date = event?.fecha ? formatConversationTimestamp(event.fecha) : 'Fecha no disponible'
    const description = event?.evento_api || event?.evento_original || event?.nombre || event?.detalle || 'Movimiento registrado'
    const code = event?.codigo_evento || event?.event_code || event?.evento_id
    const office = event?.oficina || event?.office_name || event?.ubicacion
    return `
      <div class="intl-trace-row">
        <span class="intl-trace-time">${escapeHtml(date)}</span>
        <div class="intl-trace-desc">
          <strong>${escapeHtml(code ? `Evento ${code}: ` : '')}${escapeHtml(description)}</strong>
          ${office ? `<small>${escapeHtml(office)}</small>` : ''}
          ${event?.detalle && event?.detalle !== description ? `<small>${escapeHtml(event.detalle)}</small>` : ''}
        </div>
      </div>
    `
  }

  const renderInspection = () => {
    if (!result) {
      const message = state.scannerQueryState === 'loading'
        ? 'Buscando el código en el catálogo de tracking…'
        : errorMessage
          ? `No se pudo completar la búsqueda: ${errorMessage}`
          : 'Ingresa un código S10 para consultar la ruta, el estado y sus movimientos.'
      return `<div class="intl-empty-logs">${escapeHtml(message)}</div>`
    }

    const origin = result.origen?.nombre || result.origen?.codigo || 'Sin origen'
    const destination = result.destino?.nombre || result.destino?.codigo || 'Sin destino'
    const sender = result.remitente?.nombre || result.remitente?.razon_social || 'No disponible'
    const recipient = result.destinatario?.nombre || result.destinatario?.razon_social || 'No disponible'
    const contents = result.contenido || result.tipo_servicio || result.clase_correo || 'No especificado'
    const latestDescription = latestEvent
      ? latestEvent.evento_api || latestEvent.evento_original || latestEvent.nombre || 'Movimiento registrado'
      : result.estado_postal || 'Sin movimientos registrados'
    const historyMessage = state.scannerEventsState === 'loading'
      ? '<div class="intl-empty-logs">Cargando historial de movimientos…</div>'
      : state.scannerEventsState === 'error'
        ? `<div class="intl-empty-logs">No se pudo cargar el historial: ${escapeHtml(state.scannerEventsError || 'Error desconocido')}</div>`
        : events.length > 0
          ? events.map(renderEvent).join('')
          : '<div class="intl-empty-logs">Este paquete no tiene movimientos registrados.</div>'

    return `
      <div class="intl-inspection-header">
        <div class="intl-inspection-main">
          <span class="intl-card-kicker">Paquete consultado</span>
          <div class="intl-code-row">
            <h3 class="intl-inspection-code">${escapeHtml(resultCode)}</h3>
            <span class="intl-stage-badge is-${escapeHtml(resultStage)} ${escapeHtml(stageTone)}">${escapeHtml(stageLabel)}</span>
          </div>
        </div>
        <div class="intl-inspection-geo">
          <span class="intl-geo-item"><span class="intl-geo-lbl">Origen:</span><strong>${renderCountryWithFlag(origin, result.origen?.codigo)}</strong></span>
          <span class="intl-geo-item"><span class="intl-geo-lbl">Destino:</span><strong>${renderCountryWithFlag(destination, result.destino?.codigo)}</strong></span>
        </div>
      </div>
      <div class="intl-funnel-tracker">
        <span class="intl-funnel-tracker-title">Último movimiento</span>
        <strong class="intl-event-main-text">${escapeHtml(latestDescription)}</strong>
        <small>${escapeHtml(latestEvent?.fecha ? formatConversationTimestamp(latestEvent.fecha) : 'Fecha no disponible')}</small>
      </div>
      <div class="intl-package-meta-grid">
        <div class="intl-meta-box"><span class="intl-meta-lbl">Remitente</span><strong>${escapeHtml(sender)}</strong></div>
        <div class="intl-meta-box"><span class="intl-meta-lbl">Destinatario</span><strong>${escapeHtml(recipient)}</strong></div>
        <div class="intl-meta-box"><span class="intl-meta-lbl">Contenido / servicio</span><strong>${escapeHtml(contents)}</strong></div>
      </div>
      <div class="intl-trace-history">
        <div class="intl-trace-head">Historial de movimientos (${events.length})</div>
        <div class="intl-trace-list">${historyMessage}</div>
      </div>
    `
  }

  return `
    <section class="section-panel intl-scanner-view ${state.activeView === 'internacionales-pipeline' ? 'is-visible' : ''}">
      <div class="intl-scanner-board">
        <header class="intl-scanner-header">
          <div class="intl-scanner-header-left">
            <div class="intl-kicker-row">
              <span class="intl-kicker-badge">Tracking internacional</span>
              <span class="intl-solution-pill"><span class="intl-pill-dot"></span>Consulta individual</span>
            </div>
            <h2 class="intl-scanner-title">Escáner e inspección internacional</h2>
            <p class="intl-scanner-stats"><strong>${escapeHtml(trackingStates)}</strong></p>
          </div>
          <div class="intl-scanner-header-right">
            <div class="intl-quick-guides">
              <span class="intl-quick-label">Códigos recientes</span>
              <div class="intl-quick-chips">
                ${
                  quickCodes.length > 0
                    ? quickCodes.map((code) => `<button class="intl-chip-btn" type="button" data-scanner-quick-code="${escapeHtml(code)}">${escapeHtml(code)}</button>`).join('')
                    : '<span class="intl-quick-label">Los códigos aparecerán después de consultar guías.</span>'
                }
              </div>
            </div>
          </div>
        </header>

        <section class="intl-scanner-box">
          <div class="intl-scanner-box-left">
            <span class="intl-scanner-box-badge"><span class="barcode-bars">▥</span> Escáner rápido</span>
            <h2>Consulta un paquete internacional</h2>
            <p>Escribe o escanea el código de seguimiento <strong>S10</strong>.</p>
          </div>
          <form class="intl-scanner-form" data-scanner-form>
            <label class="intl-scanner-input-wrap">
              <span class="intl-barcode-icon" aria-hidden="true">▥</span>
              <input
                class="intl-scanner-input"
                type="search"
                name="tracking-code"
                placeholder="Ej.: EE123456789BO"
                autocomplete="off"
                data-scanner-input
                value="${escapeHtml(state.scannerQuery || '')}"
                aria-label="Código de seguimiento S10"
              />
            </label>
            <button class="intl-scanner-submit-btn" type="submit" ${state.scannerQueryState === 'loading' ? 'disabled' : ''}>
              ${state.scannerQueryState === 'loading' ? 'Buscando…' : 'Consultar'}
            </button>
          </form>
        </section>

        <div class="intl-scanner-grid">
          <section class="intl-card intl-inspection-card" aria-live="polite">
            ${renderInspection()}
          </section>

          <div class="intl-scanner-right-col">
            <section class="intl-card intl-session-logs-card">
              <div class="intl-session-logs-header">
                <strong class="intl-session-logs-title">Registro de consultas</strong>
                <span class="intl-processed-pill">${sessionLog.length} consultados</span>
              </div>
              <div class="intl-session-logs-list">
                ${
                  visibleLog.length > 0
                    ? visibleLog.map((entry) => `
                      <div class="intl-session-log-item ${entry.codigo === resultCode ? 'is-active' : ''}" role="button" tabindex="0" data-scanner-select-log="${escapeHtml(entry.codigo)}">
                        <div class="intl-log-item-top">
                          <strong class="intl-log-code">${escapeHtml(entry.codigo)}</strong>
                          <span class="intl-log-stage-tag">${escapeHtml(entry.stageLabel || 'Sin etapa')}</span>
                        </div>
                        <div class="intl-log-item-bottom">
                          <span class="intl-log-event">${escapeHtml(entry.lastEvent || 'Sin movimientos')}</span>
                          <time class="intl-log-time">${escapeHtml(entry.time || '')}</time>
                        </div>
                      </div>
                    `).join('')
                    : '<div class="intl-empty-logs">Las consultas realizadas en esta sesión aparecerán aquí.</div>'
                }
              </div>
            </section>

            <section class="intl-card intl-funnel-volume-card">
              <div class="intl-funnel-vol-header">
                <strong class="intl-funnel-vol-title">Consultas por etapa</strong>
                <span class="intl-funnel-total-txt">${sessionLog.length} total</span>
              </div>
              <div class="intl-funnel-tiles-grid">
                ${stages.map(({ key, label }) => `
                  <button
                    class="intl-funnel-tile is-${escapeHtml(key)} ${state.scannerStageFilter === key ? 'is-active' : ''}"
                    type="button"
                    data-scanner-stage-filter="${escapeHtml(key)}"
                    aria-pressed="${state.scannerStageFilter === key}"
                  >
                    <span class="intl-tile-name">${escapeHtml(label)}</span>
                    <strong class="intl-tile-count">${stageCounts[key]}</strong>
                    <span class="intl-tile-pct">${sessionLog.length ? `${Math.round((stageCounts[key] / sessionLog.length) * 100)}%` : '0%'}</span>
                  </button>
                `).join('')}
              </div>
            </section>
          </div>
        </div>
      </div>
    </section>
  `
}