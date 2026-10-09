// @ts-nocheck

export const renderEmsView = (ctx: any) => {
  const {
    state,
    escapeHtml,
    formatConversationTimestamp,
    getEmsStatusToneClass,
    getEmsSearchQueryForColumn,
    findContactByReferenceValue,
    getWhatsAppReference,
    getEmsReferenceChannelState,
    getEmsPipelineScopePageState,
  } = ctx

  const customColumns = state.pipelineConfig.customColumns ?? []
  const isSyncingEmsPipeline = state.emsPipelineSyncState === 'loading'
  const isEmsSyncError = state.emsPipelineSyncState === 'error' && Boolean(state.emsPipelineSyncError)
  const syncSummary = state.emsPipelineSyncSummary
  const todayParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/La_Paz',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const today = `${todayParts.find((part: any) => part.type === 'year')?.value}-${todayParts.find((part: any) => part.type === 'month')?.value}-${todayParts.find((part: any) => part.type === 'day')?.value}`
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

  const getCardReferenceLabel = (reference: string) => {
    if (!reference || reference === 'Sin referencia') {
      return 'Sin referencia'
    }

    const linkedContact = findContactByReferenceValue(reference)
    return getEmsReferenceChannelState(reference, linkedContact).label
  }

  const renderEmsCard = (card: any) => `
    <button
      class="ems-package-card ${card.stage}"
      data-open-ems-package-detail="${card.id}"
      data-ems-drag-package="${card.code}"
      data-ems-drag-source="${card.stage}"
      draggable="true"
      type="button"
    >
      <div class="ems-package-card-top">
        <div class="ems-package-avatar">${escapeHtml(card.code.slice(0, 1))}</div>
        <div class="ems-package-copy">
          <strong>${escapeHtml(card.code)}</strong>
          <span>${escapeHtml(card.summary)}</span>
        </div>
      </div>
      <p class="ems-package-message">${escapeHtml(card.destination || card.status || 'Sin destino')}</p>
      <div class="ems-package-meta">
        <span>${escapeHtml(card.senderName)}</span>
        <small>${escapeHtml(card.senderReference)} Â· ${escapeHtml(getCardReferenceLabel(card.senderReference))}</small>
      </div>
      <div class="ems-package-meta">
        <span>${escapeHtml(card.recipientName)}</span>
        <small>${escapeHtml(card.recipientReference)} Â· ${escapeHtml(getCardReferenceLabel(card.recipientReference))}</small>
      </div>
      <div class="ems-package-foot">
        <span class="ems-package-time">${escapeHtml(formatConversationTimestamp(card.updatedAt))}</span>
        <span class="ems-package-badge ${getEmsStatusToneClass(card.stage)}">${escapeHtml(card.status)}</span>
      </div>
    </button>
  `

  const renderPageControls = (scope: string, pageState: any) => `
    <div class="ems-column-pagination">
      <button
        class="secondary-btn"
        type="button"
        data-ems-column-page="${escapeHtml(scope)}:prev"
        ${pageState.currentPage <= 1 || pageState.state === 'loading' ? 'disabled' : ''}
      >
        <
      </button>
      <span>Pagina ${pageState.currentPage ?? 1} de ${pageState.totalPages ?? 1}</span>
      <button
        class="secondary-btn"
        type="button"
        data-ems-column-page="${escapeHtml(scope)}:next"
        ${pageState.currentPage >= pageState.totalPages || pageState.state === 'loading' ? 'disabled' : ''}
      >
        >
      </button>
    </div>
  `

  const renderEmsColumn = (
    scope: string,
    title: string,
    helper: string,
    options: { showSearch?: boolean; isCustom?: boolean; showDelete?: boolean } = {},
  ) => {
    const pageState = getEmsPipelineScopePageState(scope)
    const items = Array.isArray(pageState.items) ? pageState.items : []

    return `
      <section class="ems-kanban-column ${options.isCustom ? 'custom' : scope}">
        <div class="ems-kanban-column-head">
          <div class="ems-kanban-column-title">
            <span class="ems-dot ${options.isCustom ? 'custom' : scope}"></span>
            <div class="ems-kanban-column-heading">
              <strong>${title}</strong>
              <span>${helper}</span>
            </div>
          </div>
          <div class="ems-column-head-actions">
            <span class="ems-column-count">${pageState.totalItems ?? 0}</span>
            ${
              options.showDelete
                ? `<button class="danger-btn ems-remove-column-btn" data-remove-custom-ems-state="${escapeHtml(scope)}" type="button">Eliminar</button>`
                : ''
            }
          </div>
        </div>
        ${
          options.showSearch
            ? `<label class="ems-column-search">
                <input
                  data-ems-column-search="${scope}"
                  type="text"
                  value="${escapeHtml(getEmsSearchQueryForColumn(scope as EmsColumnKey))}"
                  placeholder="Buscar por codigo..."
                />
              </label>`
            : ''
        }
        <div class="ems-column-actions">
          <button class="secondary-btn ems-column-state-btn is-states" data-open-api-pipeline-states="${options.isCustom ? 'all' : escapeHtml(scope)}" type="button">+ Estados</button>
          <button class="primary-btn ems-column-state-btn is-packages" data-open-ems-state-packages="${escapeHtml(scope)}" type="button">+ Paquetes</button>
        </div>
        <div class="ems-column-list ems-dropzone" data-ems-dropzone="${escapeHtml(scope)}">
          ${
            pageState.state === 'loading' && items.length === 0
              ? `<div class="empty-state ems-empty-column">Cargando paquetes...</div>`
              : items.length > 0
                ? items.map((card: any) => renderEmsCard(card)).join('')
                : `<div class="empty-state ems-empty-column">Sin envios en este estado.</div>`
          }
        </div>
        ${renderPageControls(scope, pageState)}
      </section>
    `
  }

  return `
    <section class="section-panel ems-board-panel ${state.activeView === 'ems' ? 'is-visible' : ''}">
      <div class="ems-control-board">
        <div class="ems-control-header">
          <div class="ems-control-copy">
            <p class="section-kicker">Flujo y agrupacion de envios EMS por estados</p>
            <h2>Tablero de Control EMS</h2>
          </div>
          <div class="ems-control-actions">
            <label class="ems-date-filter">
              <span>Desde</span>
              <input
                type="date"
                data-ems-pipeline-date-start
                value="${escapeHtml(state.emsPipelineDateStart)}"
                max="${today}"
              />
            </label>
            <label class="ems-date-filter">
              <span>Hasta</span>
              <input
                type="date"
                data-ems-pipeline-date-end
                value="${escapeHtml(state.emsPipelineDateEnd)}"
                max="${today}"
              />
            </label>
            <label class="ems-date-filter ems-department-filter">
              <span>Departamento del último movimiento</span>
              <select data-ems-pipeline-department>
                <option value="all"${state.emsPipelineDepartment === 'all' ? ' selected' : ''}>Todos los departamentos</option>
                ${departments
                  .map(([value, label]) => `<option value="${value}"${state.emsPipelineDepartment === value ? ' selected' : ''}>${label}</option>`)
                  .join('')}
              </select>
            </label>
            <button class="secondary-btn" data-sync-ems-pipeline type="button" ${isSyncingEmsPipeline ? 'disabled' : ''}>Actualizar paquetes</button>
            <button class="primary-btn" data-create-custom-ems-column type="button">+ Crear columna</button>
          </div>
        </div>

        ${
          isSyncingEmsPipeline
            ? `
              <div class="ems-loading-shell">
                <div class="ems-loading-card">
                  <div class="ems-loading-spinner" aria-hidden="true"></div>
                  <p class="section-kicker">Sincronizando paquetes desde las APIs</p>
                  <h3>Estamos actualizando el tablero por paginas</h3>
                  <p>La sincronizacion prepara el backend y luego carga solo la pagina visible de cada columna para no saturar el navegador.</p>
                  <div class="ems-loading-meta">
                    <span>Vista EMS</span>
                    <span>Paginacion por columna</span>
                    <span>${escapeHtml(syncSummary ? `${syncSummary.total} paquetes detectados` : 'Cargando...')}</span>
                  </div>
                  ${
                    syncSummary
                      ? `
                        <div class="ems-loading-stats">
                          <strong>${syncSummary.total}</strong>
                          <span>paquetes procesados</span>
                          <small>${syncSummary.createdCount} nuevos Â· ${syncSummary.updatedCount} actualizados</small>
                        </div>
                      `
                      : ''
                  }
                </div>
              </div>
            `
            : isEmsSyncError
              ? `
                <div class="ems-loading-shell">
                  <div class="ems-loading-card">
                    <p class="section-kicker">No se pudo sincronizar el pipeline EMS</p>
                    <h3>${escapeHtml(state.emsPipelineSyncError || 'Ocurrio un error al actualizar los paquetes.')}</h3>
                    <p>Vuelve a intentar la carga para seguir extrayendo los paquetes desde las APIs y ordenarlos por estado.</p>
                    <div class="ems-loading-meta">
                      <span>Extraccion parcial</span>
                      <span>Reintento disponible</span>
                    </div>
                    <button class="primary-btn" data-sync-ems-pipeline type="button">Reintentar sincronizacion</button>
                  </div>
                </div>
              `
            : `
              <div class="ems-kanban-grid">
                ${renderEmsColumn('received', '1. RECIBIDO ORIGEN', 'Paquetes recibidos en origen y agrupados para despacho.', { showSearch: true })}
                ${renderEmsColumn('transit', '2. EN CAMINO', 'En transito hacia el destino final.', { showSearch: true })}
                ${renderEmsColumn('regional', '3. RECIBIDO DESTINO', 'Paquetes recibidos en la regional de destino.', { showSearch: true })}
                ${renderEmsColumn('courier', '4. CARTERO', 'Paquetes asignados a reparto para entrega.', { showSearch: true })}
                ${renderEmsColumn('delivered', '5. ENTREGADO', 'Entregas confirmadas y cerradas.', { showSearch: true })}
                ${renderEmsColumn('cancelled', '6. CANCELADO', 'Paquetes cancelados, anulados o rechazados.', { showSearch: true })}
                ${customColumns
                  .map(
                    (column: any, index: number) => `
                      ${renderEmsColumn(column.id, `${index + 6}. ${column.title.toUpperCase()}`, column.helper, {
                        isCustom: true,
                        showDelete: true,
                      })}
                    `,
                  )
                  .join('')}
              </div>
            `
        }
      </div>
    </section>
  `
}
