// @ts-nocheck

export const renderEmsStatePackagesModal = (ctx: any) => {
  const {
    state,
    escapeHtml,
    formatConversationTimestamp,
    getEmsStatusToneClass,
    getEmsStatusLabel,
    getEmsPipelineScopePageState,
  } = ctx

  if (!state.isEmsStatePackagesModalOpen) {
    return ''
  }

  const scope = state.emsStatePackagesModalScope
  const pageState = scope ? getEmsPipelineScopePageState(scope) : null
  const scopeLabel = scope
    ? state.pipelineConfig.columns[scope]?.title ??
      state.pipelineConfig.customColumns.find((column: any) => column.id === scope)?.title ??
      getEmsStatusLabel(scope)
    : 'Todos los estados'

  const sourceItems = pageState?.items ?? []

  const renderReferenceTone = (reference: string) => {
    if (!reference || reference === 'Sin referencia') {
      return 'Sin referencia'
    }

    return reference.startsWith('+') || /^\d+$/.test(reference.replace(/[^\d]/g, ''))
      ? 'Solo telÃ©fono'
      : 'Referencia'
  }

  return `
    <div class="modal-backdrop" id="ems-state-packages-modal-backdrop">
      <div class="modal-card modal-card-compact ems-state-packages-modal">
        <div class="ems-state-packages-modal-head">
          <div class="pipeline-state-modal-title">
            <p class="section-kicker">EMS</p>
            <h3>Paquetes en ${escapeHtml(scopeLabel)}</h3>
            <small>Lista paginada con los paquetes de esta columna.</small>
          </div>
          <div class="pipeline-state-modal-actions">
            <span class="pipeline-state-modal-chip">${escapeHtml(`${pageState?.totalItems ?? 0} paquetes`)}</span>
            <button class="modal-close" id="close-ems-state-packages-modal" type="button">Cerrar</button>
          </div>
        </div>

        <div class="pipeline-state-modal-summary">
          <div class="pipeline-state-summary-card">
            <span class="pipeline-state-summary-label">Estado</span>
            <strong>${escapeHtml(scopeLabel)}</strong>
          </div>
          <div class="pipeline-state-summary-card">
            <span class="pipeline-state-summary-label">Paquetes</span>
            <strong>${pageState?.totalItems ?? 0}</strong>
          </div>
          <div class="pipeline-state-summary-card">
            <span class="pipeline-state-summary-label">PÃ¡gina</span>
            <strong>${pageState?.currentPage ?? 1} / ${pageState?.totalPages ?? 1}</strong>
          </div>
        </div>

        <div class="ems-state-packages-list">
          ${
            sourceItems.length > 0
              ? sourceItems
                  .map(
                    (item: any) => `
                      <article class="ems-state-package-row">
                        <button class="ems-state-package-main" data-open-ems-package-detail="${escapeHtml(item.id)}" type="button">
                          <div class="ems-state-package-code-wrap">
                            <strong>${escapeHtml(item.code)}</strong>
                            <span class="ems-state-package-badge ${getEmsStatusToneClass(item.stage)}">${escapeHtml(
                              getEmsStatusLabel(item.stage),
                            )}</span>
                          </div>
                          <div class="ems-state-package-copy">
                            <span>${escapeHtml(item.summary)}</span>
                            <small>${escapeHtml(item.destination || 'Sin destino')}</small>
                          </div>
                        </button>
                        <div class="ems-state-package-meta">
                          <div>
                            <strong>${escapeHtml(item.senderName)}</strong>
                            <small>${escapeHtml(item.senderReference)} Â· ${escapeHtml(renderReferenceTone(item.senderReference))}</small>
                          </div>
                          <div>
                            <strong>${escapeHtml(item.recipientName)}</strong>
                            <small>${escapeHtml(item.recipientReference)} Â· ${escapeHtml(renderReferenceTone(item.recipientReference))}</small>
                          </div>
                          <span>${escapeHtml(formatConversationTimestamp(item.updatedAt))}</span>
                        </div>
                      </article>
                    `,
                  )
                  .join('')
              : `<div class="pipeline-state-empty">${escapeHtml(
                  state.emsPipelineSyncState === 'loading'
                    ? 'Cargando paquetes desde las APIs...'
                    : 'No se encontraron paquetes para este estado.',
                )}</div>`
          }
        </div>

        <div class="ems-state-packages-footer">
          <div class="ems-state-packages-pagination">
            <button
              class="secondary-btn"
              data-ems-state-packages-page="prev"
              type="button"
              ${!scope || (pageState?.currentPage ?? 1) <= 1 || pageState?.state === 'loading' ? 'disabled' : ''}
            >
              Anterior
            </button>
            <span>PÃ¡gina ${pageState?.currentPage ?? 1} de ${pageState?.totalPages ?? 1}</span>
            <button
              class="secondary-btn"
              data-ems-state-packages-page="next"
              type="button"
              ${!scope || (pageState?.currentPage ?? 1) >= (pageState?.totalPages ?? 1) || pageState?.state === 'loading' ? 'disabled' : ''}
            >
              Siguiente
            </button>
          </div>
          <div class="modal-actions pipeline-state-modal-footer">
            <button class="secondary-btn" id="cancel-ems-state-packages-modal" type="button">Cerrar</button>
          </div>
        </div>
      </div>
    </div>
  `
}
