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

  const fallbackColumns = getTrackingPipelineColumns('international')
  const orderedColumns = ['received', 'transit', 'regional', 'courier', 'delivered', 'cancelled']
  const columns = Object.fromEntries(
    orderedColumns.map((key) => [
      key,
      state.internationalPipelineColumns?.[key]?.items ?? fallbackColumns[key] ?? [],
    ]),
  )
  const totalItems = orderedColumns.reduce(
    (total, key) => total + Number(state.internationalPipelineColumns?.[key]?.totalItems ?? columns[key]?.length ?? 0),
    0,
  )
  const todayParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/La_Paz',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const today = `${todayParts.find((part) => part.type === 'year')?.value}-${todayParts.find((part) => part.type === 'month')?.value}-${todayParts.find((part) => part.type === 'day')?.value}`
  const departments = [
    ['la-paz', 'La Paz'],
    ['cochabamba', 'Cochabamba'],
    ['santa-cruz', 'Santa Cruz'],
    ['oruro', 'Oruro'],
    ['potosi', 'Potosí'],
    ['tarija', 'Tarija'],
    ['chuquisaca', 'Chuquisaca'],
    ['beni', 'Beni'],
    ['pando', 'Pando'],
  ]
  const isLoading = orderedColumns.some((key) => state.internationalPipelineColumns?.[key]?.state === 'loading')
  const pipelineError = orderedColumns
    .map((key) => state.internationalPipelineColumns?.[key]?.error)
    .find(Boolean)
  const sourceLabel = state.internationalPipelineSource === 'postgresql-catalog'
    ? 'catalogo IPS importado'
    : state.internationalPipelineSource === 'local-db'
      ? 'catalogo PostgreSQL guardado'
      : state.internationalPipelineSource === 'ips-events-api'
        ? 'movimientos IPS'
        : state.internationalPipelineSource === 'tracking-api'
          ? 'Tracking API con movimientos'
        : isLoading
          ? 'cargando fuente...'
          : 'fuente no disponible'

  const getEventFlowLabel = (eventCode: number) => {
    if ([1, 2, 3, 6, 8, 12].includes(eventCode)) return 'Salida / exportacion desde Bolivia'
    if ([30, 31, 34, 35, 38, 39, 71, 72, 73, 74, 75, 76].includes(eventCode)) {
      return 'Entrada / importacion a Bolivia'
    }
    return ''
  }

  const getEventOperationalNote = (eventCode: number) => {
    if (eventCode === 32) return 'Habilitado para retiro en ventanilla.'
    if (eventCode === 36) return 'Incidencia: intento fallido; requiere reintento o recojo.'
    if (eventCode === 76) return 'Incidencia: importacion detenida; no equivale a entrega.'
    return ''
  }

  const getColumnTitle = (key: string) =>
    key === 'cancelled'
      ? 'Importacion detenida'
      : key === 'delivered'
        ? 'Entregado'
        : key === 'courier'
          ? 'Ultima milla'
          : key === 'regional'
            ? 'Distribucion nacional'
            : key === 'transit'
              ? 'Aduana'
              : 'Origen y llegada'

  const getColumnHelper = (key: string) =>
    key === 'cancelled'
      ? 'Evento 76: importacion detenida; no equivale a entrega.'
      : key === 'delivered'
        ? 'Evento 37: entrega registrada.'
        : key === 'courier'
            ? 'Entrada: 32, 39, 73, 74 y 75. Incidencia: 36 por intento fallido.'
          : key === 'regional'
            ? 'Eventos 13, 14, 35, 71 y 72: saca, traslado y clasificacion nacional.'
            : key === 'transit'
              ? 'Eventos 31, 34 y 38: envio, informacion y retorno desde Aduana.'
              : 'Eventos 1, 2, 3, 8 y 12 en origen; evento 30 al ingresar a Bolivia.'

  const getStageLabel = (stage: string) =>
    stage === 'delivered'
      ? 'Entregado (37)'
      : stage === 'courier'
        ? 'Ultima milla'
        : stage === 'transit'
          ? 'Aduana'
          : stage === 'regional'
            ? 'Distribucion nacional'
            : stage === 'cancelled'
              ? 'Importacion detenida'
              : 'Origen y llegada'

  const getPackageCode = (item: any) => item.codigo_s10 || item.codigo || 'Sin código'

  const renderPipelineCard = (item: any) => {
    const stage = getTrackingPipelineStage(item)
    const code = getPackageCode(item)
    const originName = item.origen?.nombre || item.origen?.codigo || 'Sin origen'
    const destinationName = item.destino?.nombre || item.destino?.codigo || 'Sin destino'
    const events = Array.isArray(item.eventos) ? item.eventos : []
    const latestEvent = [...events].sort(
      (first, second) => Date.parse(second?.fecha || '') - Date.parse(first?.fecha || ''),
    )[0]
    const latestEventCode = latestEvent?.evento_id ?? latestEvent?.codigo_evento
    const latestEventName =
      latestEvent?.nombre || latestEvent?.evento_api || latestEvent?.evento_original || item.estado_postal || 'Sin evento'
    const latestEventNumber = Number(latestEventCode)
    const flowLabel = getEventFlowLabel(latestEventNumber)
    const operationalNote = getEventOperationalNote(latestEventNumber)

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
          <span>${escapeHtml(latestEventCode ? `Evento ${latestEventCode}` : 'Estado postal')}</span>
          <small>${escapeHtml(latestEventName)}</small>
          ${
            flowLabel || operationalNote
              ? `<small>${escapeHtml([flowLabel, operationalNote].filter(Boolean).join(' · '))}</small>`
              : ''
          }
        </div>
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
    const columnState = state.internationalPipelineColumns?.[key]
    const searchValue = String(state.internationalPipelineSearch?.[key] ?? '').trim()
    const totalItemsInColumn = Number(columnState?.totalItems ?? items.length)
    const totalPages = Math.max(1, Number(columnState?.totalPages ?? Math.ceil(items.length / 6)))
    const currentPage = Math.min(Math.max(1, Number(columnState?.currentPage ?? 1)), totalPages)
    const pageItems = items

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
            <span class="ems-column-count">${totalItemsInColumn}</span>
          </div>
        </div>
        <label class="ems-column-search">
          <input
            type="search"
            value="${escapeHtml(searchValue)}"
            placeholder="Codigo, evento, pais..."
            data-international-pipeline-search="${escapeHtml(key)}"
          />
        </label>
        <div class="ems-column-actions">
          <button class="secondary-btn ems-column-state-btn is-states" data-open-api-pipeline-states="${escapeHtml(key)}" type="button">+ Estados</button>
          <button class="primary-btn ems-column-state-btn is-packages" data-international-pipeline-show-all="${escapeHtml(key)}" type="button">Ver todos</button>
        </div>
        <div class="ems-column-list ems-dropzone">
          ${
            columnState?.state === 'loading' && items.length === 0
              ? `<div class="empty-state ems-empty-column">Consultando movimientos de SITRA. La primera carga puede tardar unos minutos...</div>`
              : pageItems.length > 0
                ? pageItems.map((item: any) => renderPipelineCard(item)).join('')
                : `<div class="empty-state ems-empty-column">${searchValue ? 'No hay paquetes que coincidan con el filtro.' : 'Sin paquetes en este estado.'}</div>`
          }
        </div>
        <div class="ems-column-pagination">
          <button class="secondary-btn" data-international-pipeline-page="${escapeHtml(key)}:prev" type="button" aria-label="Pagina anterior" title="Pagina anterior" ${currentPage <= 1 ? 'disabled' : ''}>&lt;</button>
          <span>${totalItemsInColumn > 0 ? `Pagina ${currentPage}/${totalPages} · ${totalItemsInColumn}` : 'Total 0'}</span>
          <button class="secondary-btn" data-international-pipeline-page="${escapeHtml(key)}:next" type="button" aria-label="Pagina siguiente" title="Pagina siguiente" ${currentPage >= totalPages ? 'disabled' : ''}>&gt;</button>
        </div>
      </section>
    `
  }

  return `
    <section class="section-panel international-panel international-pipeline-panel ${state.activeView === 'internacionales-tablero' ? 'is-visible' : ''}">
      <div class="ems-control-board international-ems-board">
        <div class="ems-control-header">
          <div class="ems-control-copy">
            <p class="section-kicker">Pipeline de internacionales</p>
            <h2>Flujo de seguimiento internacional</h2>
            <strong class="international-pipeline-total">${totalItems} paquetes en el periodo seleccionado · ${escapeHtml(sourceLabel)}</strong>
          </div>
          <div class="ems-control-actions">
            <label class="ems-date-filter">
              <span>Desde</span>
              <input type="date" data-international-pipeline-date-start value="${escapeHtml(state.internationalPipelineDateStart)}" max="${today}" />
            </label>
            <label class="ems-date-filter">
              <span>Hasta</span>
              <input type="date" data-international-pipeline-date-end value="${escapeHtml(state.internationalPipelineDateEnd)}" max="${today}" />
            </label>
            <label class="ems-date-filter ems-department-filter">
              <span>Departamento del último movimiento</span>
              <select data-international-pipeline-department>
                <option value="all"${state.internationalPipelineDepartment === 'all' ? ' selected' : ''}>Todos los departamentos</option>
                ${departments
                  .map(([value, label]) => `<option value="${value}"${state.internationalPipelineDepartment === value ? ' selected' : ''}>${label}</option>`)
                  .join('')}
              </select>
            </label>
            <label class="ems-column-search international-pipeline-sort">
              <span>Ordenar por fecha</span>
              <select id="international-pipeline-sort">
                <option value="newest" ${state.internationalPipelineSort !== 'oldest' ? 'selected' : ''}>Mas nuevo a mas antiguo</option>
                <option value="oldest" ${state.internationalPipelineSort === 'oldest' ? 'selected' : ''}>Mas antiguo a mas nuevo</option>
              </select>
            </label>
          </div>
        </div>

        ${
          pipelineError
            ? `<div class="notice-banner notice-banner-error">${escapeHtml(pipelineError)}</div>`
            : ''
        }

        <div class="ems-kanban-grid international-kanban-board">
          ${orderedColumns.map((key, index) => renderColumn(key, index)).join('')}
        </div>
      </div>
    </section>
  `
}
