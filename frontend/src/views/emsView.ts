// @ts-nocheck

export const renderEmsView = (ctx: any) => {
  const {
    state,
    menuGroups,
    escapeHtml,
    getBrandIcon,
    getMenuGroupIcon,
    getRobotIcon,
    formatBoliviaTestPhone,
    formatConversationTimestamp,
    getEmsStatusToneClass,
    getEmsSearchQueryForColumn,
    getEmsMonthOptions,
    findContactByReferenceValue,
    getWhatsAppReference,
    getEmsApiStatusPackages,
    getEmsApiCustomColumnPackages,
  } = ctx
  const apiStatusPackages = getEmsApiStatusPackages()
  const receivedPackages = apiStatusPackages.received
  const regionalPackages = apiStatusPackages.regional
  const transitPackages = apiStatusPackages.transit
  const courierPackages = apiStatusPackages.courier
  const deliveredPackages = apiStatusPackages.delivered
  const customColumns = state.pipelineConfig.customColumns ?? []
  const isSyncingEmsPipeline = state.emsPipelineSyncState === 'loading'
  const isEmsSyncError = state.emsPipelineSyncState === 'error' && Boolean(state.emsPipelineSyncError)
  const syncSummary = state.emsPipelineSyncSummary
  const monthOptions = getEmsMonthOptions()
  const boardPreviewLimit = 12

  const receivedPreview = receivedPackages.slice(0, boardPreviewLimit)
  const transitPreview = transitPackages.slice(0, boardPreviewLimit)
  const regionalPreview = regionalPackages.slice(0, boardPreviewLimit)
  const courierPreview = courierPackages.slice(0, boardPreviewLimit)
  const deliveredPreview = deliveredPackages.slice(0, boardPreviewLimit)

  const matchesPackageSearch = (card: any, column: EmsColumnKey) => {
    const query = getEmsSearchQueryForColumn(column).trim().toLowerCase()
    if (!query) return true

    return [
      card.code,
      card.title,
      card.summary,
      card.senderName,
      card.senderReference,
      card.recipientName,
      card.recipientReference,
      card.destination,
      card.status,
    ].some((value) => String(value ?? '').toLowerCase().includes(query))
  }

  const getCardReferenceLabel = (reference: string) => {
    if (!reference || reference === 'Sin referencia') {
      return 'Sin referencia'
    }

    const linkedContact = findContactByReferenceValue(reference)
    return linkedContact ? 'WhatsApp disponible' : 'Solo teléfono'
  }

  const renderEmsCard = (card: any) => `
    <button class="ems-package-card ${card.stage}" data-open-ems-package-detail="${card.id}" type="button">
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
        <small>${escapeHtml(card.senderReference)} · ${escapeHtml(getCardReferenceLabel(card.senderReference))}</small>
      </div>
      <div class="ems-package-meta">
        <span>${escapeHtml(card.recipientName)}</span>
        <small>${escapeHtml(card.recipientReference)} · ${escapeHtml(getCardReferenceLabel(card.recipientReference))}</small>
      </div>
      <div class="ems-package-foot">
        <span class="ems-package-time">${escapeHtml(formatConversationTimestamp(card.updatedAt))}</span>
        <span class="ems-package-badge ${getEmsStatusToneClass(card.stage)}">${escapeHtml(card.status)}</span>
      </div>
    </button>
  `

  const renderEmsColumn = (column: EmsColumnKey, title: string, helper: string, packages: any[], totalCount: number) => `
    <section class="ems-kanban-column ${column}">
      <div class="ems-kanban-column-head">
        <div class="ems-kanban-column-title">
          <span class="ems-dot ${column}"></span>
          <div class="ems-kanban-column-heading">
            <strong>${title}</strong>
            <span>${helper}</span>
          </div>
        </div>
        <span class="ems-column-count">${totalCount}</span>
      </div>
      <label class="ems-column-search">
        <input
          data-ems-column-search="${column}"
          type="text"
          value="${escapeHtml(getEmsSearchQueryForColumn(column))}"
          placeholder="Buscar por código..."
        />
      </label>
      <button class="primary-btn ems-column-state-btn" data-open-ems-state-packages="${column}" type="button">+ Estados de paquetes</button>
      <div class="ems-column-list">
        ${
          packages.filter((card) => matchesPackageSearch(card, column)).length > 0
            ? packages
                .filter((card) => matchesPackageSearch(card, column))
                .map((card) => renderEmsCard(card))
                .join('')
            : `<div class="empty-state ems-empty-column">Sin envíos en este estado.</div>`
        }
      </div>
      ${
        totalCount > packages.length
          ? `<div class="ems-column-more-hint">Mostrando ${packages.length} de ${totalCount}. Abre el modal para ver todos.</div>`
          : ''
      }
    </section>
  `

  return `
    <section class="section-panel ems-board-panel ${state.activeView === 'ems' ? 'is-visible' : ''}">
      <div class="ems-control-board">
        <div class="ems-control-header">
          <div class="ems-control-copy">
            <p class="section-kicker">Flujo y agrupación de envíos EMS por estados</p>
            <h2>Tablero de Control EMS: De Recibido a Entregado</h2>
            <p class="ems-control-subtitle">Organiza el flujo operativo, detecta cuellos de botella y da seguimiento visual a cada envío desde origen hasta entrega.</p>
          </div>
          <div class="ems-control-actions">
            <label class="ems-month-filter">
              <span>Mes</span>
              <select data-ems-month-filter>
                <option value="all"${state.emsMonthFilter === 'all' ? ' selected' : ''}>Todos los meses</option>
                ${monthOptions
                  .map(
                    (option: any) =>
                      `<option value="${escapeHtml(option.value)}"${state.emsMonthFilter === option.value ? ' selected' : ''}>${escapeHtml(option.label)}</option>`,
                  )
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
                  <h3>Estamos extrayendo todos los envíos para ordenarlos por estado</h3>
                  <p>Esto puede tardar más de lo normal porque estamos recorriendo varias páginas de Tracking y Paquetes-Contactos antes de pintar el pipeline.</p>
                  <div class="ems-loading-meta">
                    <span>Vista EMS</span>
                    <span>Extracción completa</span>
                    <span>${escapeHtml(syncSummary ? `${syncSummary.total} paquetes detectados` : 'Cargando páginas...')}</span>
                  </div>
                  ${
                    syncSummary
                      ? `
                        <div class="ems-loading-stats">
                          <strong>${syncSummary.total}</strong>
                          <span>paquetes procesados</span>
                          <small>${syncSummary.createdCount} nuevos · ${syncSummary.updatedCount} actualizados</small>
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
                    <h3>${escapeHtml(state.emsPipelineSyncError || 'Ocurrió un error al extraer los paquetes.')}</h3>
                    <p>Vuelve a intentar la carga para seguir extrayendo los paquetes desde las APIs y ordenarlos por estado.</p>
                    <div class="ems-loading-meta">
                      <span>Extracción parcial</span>
                      <span>Reintento disponible</span>
                    </div>
                    <button class="primary-btn" data-sync-ems-pipeline type="button">Reintentar sincronización</button>
                  </div>
                </div>
              `
            : `
              <div class="ems-kanban-grid">
          ${renderEmsColumn('received', '1. RECIBIDO ORIGEN', 'Paquetes recibidos en origen y agrupados para despacho.', receivedPreview, receivedPackages.length)}
          ${renderEmsColumn('transit', '2. EN CAMINO', 'En tránsito hacia el destino final.', transitPreview, transitPackages.length)}
          ${renderEmsColumn('regional', '3. RECIBIDO DESTINO', 'Paquetes recibidos en la regional de destino.', regionalPreview, regionalPackages.length)}
          ${renderEmsColumn('courier', '4. CARTERO', 'Paquetes asignados a reparto para entrega.', courierPreview, courierPackages.length)}
          ${renderEmsColumn('delivered', '5. ENTREGADO', 'Entregas confirmadas y cerradas.', deliveredPreview, deliveredPackages.length)}
          ${customColumns
            .map(
              (column, index) => `
                <section class="ems-kanban-column custom">
                  <div class="ems-kanban-column-head">
                    <div class="ems-kanban-column-title">
                      <span class="ems-dot custom"></span>
                      <div class="ems-kanban-column-heading">
                        <strong>${escapeHtml(`${index + 6}. ${column.title.toUpperCase()}`)}</strong>
                        <span>${escapeHtml(column.helper)}</span>
                      </div>
                    </div>
                    <div class="ems-column-head-actions">
                      <span class="ems-column-count">${getEmsApiCustomColumnPackages(column.id).length}</span>
                      <button class="danger-btn ems-remove-column-btn" data-remove-custom-ems-state="${escapeHtml(column.id)}" type="button">Eliminar</button>
                    </div>
                  </div>
                  <button class="primary-btn ems-column-state-btn" data-open-api-pipeline-states="all" type="button">+ Estados de paquetes</button>
                  <div class="ems-column-list">
                    ${
                      getEmsApiCustomColumnPackages(column.id).length > 0
                        ? getEmsApiCustomColumnPackages(column.id).slice(0, boardPreviewLimit).map((card) => renderEmsCard(card)).join('')
                        : `<div class="empty-state ems-empty-column">Sin envíos en este estado.</div>`
                    }
                  </div>
                  ${
                    getEmsApiCustomColumnPackages(column.id).length > boardPreviewLimit
                      ? `<div class="ems-column-more-hint">Mostrando ${boardPreviewLimit} de ${getEmsApiCustomColumnPackages(column.id).length}. Abre el modal para ver todos.</div>`
                      : ''
                  }
                </section>
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
