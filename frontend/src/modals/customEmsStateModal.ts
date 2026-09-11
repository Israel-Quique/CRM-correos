// @ts-nocheck

export const renderCustomEmsStateModal = (ctx: any) => {
  const { state, escapeHtml, getApiPipelineStateOptions } = ctx

  if (!state.isCustomEmsStateModalOpen) {
    return ''
  }

  const scope = state.customEmsStateModalScope
  const items = getApiPipelineStateOptions(scope)
  const isLoading = state.trackingApiCatalogState === 'loading' || state.contactPackagesState === 'loading'
  const sourceError = state.trackingApiCatalogError || state.trackingApiError || state.contactPackagesError || null
  const hasVisibleItems = items.length > 0
  const totalVisibleStates = items.reduce((acc: number, item: any) => acc + (item.count || 0), 0)
  const sourceNames = [...new Set(items.flatMap((item: any) => item.sources ?? []))]
  const scopeLabel = scope ? state.pipelineConfig.columns[scope]?.title ?? 'Estados filtrados' : 'Pipeline EMS'

  return `
    <div class="modal-backdrop" id="custom-ems-state-modal-backdrop">
      <div class="modal-card modal-card-compact pipeline-state-modal">
        <div class="pipeline-state-modal-head">
          <div class="pipeline-state-modal-title">
            <p class="section-kicker">EMS</p>
            <h3>Estados de paquetes: ${escapeHtml(scopeLabel)}</h3>
            <small>Configura esta columna para que considere solo los estados que selecciones.</small>
          </div>
          <div class="pipeline-state-modal-actions">
            <span class="pipeline-state-modal-chip">${escapeHtml(scopeLabel)}</span>
            <button class="modal-close" id="close-custom-ems-state-modal" type="button">Cerrar</button>
          </div>
        </div>

        <div class="pipeline-state-modal-summary">
          <div class="pipeline-state-summary-card">
            <span class="pipeline-state-summary-label">Estados detectados</span>
            <strong>${items.length}</strong>
          </div>
          <div class="pipeline-state-summary-card">
            <span class="pipeline-state-summary-label">Paquetes detectados</span>
            <strong>${totalVisibleStates}</strong>
          </div>
          <div class="pipeline-state-summary-card">
            <span class="pipeline-state-summary-label">Fuentes</span>
            <strong>${sourceNames.length > 0 ? escapeHtml(sourceNames.join(' + ')) : 'API'}</strong>
          </div>
        </div>

        ${
          sourceError
            ? hasVisibleItems
              ? `<div class="pipeline-state-alert">Hay una alerta al consultar una de las fuentes, pero ya puedes revisar los estados detectados.</div>`
              : `<div class="pipeline-state-alert is-error">${escapeHtml(sourceError)}</div>`
            : ''
        }

        <div class="pipeline-state-flow">
          ${
            isLoading && items.length === 0
              ? `<div class="pipeline-state-empty">Cargando estados de paquetes desde la API...</div>`
              : items.length === 0
                ? `<div class="pipeline-state-empty">No se encontraron estados disponibles en las APIs cargadas.</div>`
                : items
                    .map(
                      (item, index) => `
                        <article class="pipeline-state-row ${item.isRegistered ? 'is-registered' : ''}">
                          <div class="pipeline-state-row-order">${index + 1}</div>
                          <div class="pipeline-state-row-copy">
                            <div class="pipeline-state-row-title-line">
                              <strong>${escapeHtml(item.title)}</strong>
                              <span class="pipeline-state-pill">${item.count} registro${item.count === 1 ? '' : 's'}</span>
                              <span class="pipeline-state-source">${escapeHtml(item.sources.join(' + '))}</span>
                            </div>
                            <small>${escapeHtml(item.helper)}</small>
                          </div>
                          <div class="pipeline-state-row-actions">
                            <button
                              class="${item.isRegistered ? 'secondary-btn' : 'primary-btn'} pipeline-state-register-btn"
                              data-register-api-pipeline-state="${escapeHtml(item.stateKey)}"
                              type="button"
                              ${item.isRegistered ? 'disabled' : ''}
                            >
                              ${item.isRegistered ? 'Incluido' : 'Incluir'}
                            </button>
                          </div>
                        </article>
                      `,
                    )
                    .join('')
          }
        </div>

        <div class="modal-actions pipeline-state-modal-footer">
          <button class="secondary-btn" id="cancel-custom-ems-state-modal" type="button">Cerrar</button>
        </div>
      </div>
    </div>
  `
}
