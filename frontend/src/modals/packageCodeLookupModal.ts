// @ts-nocheck

export const renderPackageCodeLookupModal = (ctx: any) => {
  const { state, escapeHtml } = ctx

  if (!state.isPackageCodeLookupModalOpen) {
    return ''
  }

  const lookupResult = state.packageCodeLookupResult as Record<string, any> | null
  const extractedCode = String(lookupResult?.extractedCode ?? '').trim()
  const normalizedCode = String(lookupResult?.normalizedCode ?? '').trim()

  return `
    <div class="modal-backdrop" id="package-code-lookup-modal-backdrop">
      <div class="modal-card modal-card-profile">
        <div class="modal-header">
          <div>
            <p class="section-kicker">Búsqueda por código</p>
            <h3>Buscar paquete en APIs</h3>
            <small class="conversation-subtitle">Busca por código exacto y, si aparece, la tabla se filtrará automáticamente.</small>
          </div>
          <button class="modal-close" id="close-package-code-lookup-modal" type="button">Cerrar</button>
        </div>

        <form class="package-code-lookup-form" id="package-code-lookup-form">
          <label class="package-code-lookup-field" for="package-code-lookup-input">
            <span>Código o mensaje con código</span>
            <input
              id="package-code-lookup-input"
              name="packageCodeLookup"
              type="text"
              placeholder="Ejemplo: EN000005876LPZ"
              value="${escapeHtml(state.packageCodeLookupQuery)}"
            />
          </label>
          <div class="logs-test-number-actions">
            <button
              class="table-action-btn"
              type="submit"
              ${state.packageCodeLookupState === 'loading' ? 'disabled' : ''}
            >
              ${state.packageCodeLookupState === 'loading' ? 'Buscando...' : 'Buscar código'}
            </button>
            <button class="secondary-btn" id="cancel-package-code-lookup-modal" type="button">Cerrar</button>
          </div>
        </form>

        ${
          state.packageCodeLookupError
            ? `<div class="notice-banner notice-banner-error">${escapeHtml(state.packageCodeLookupError)}</div>`
            : ''
        }

        ${
          lookupResult
            ? `
              <div class="package-code-lookup-summary">
                <span>Consulta: <strong>${escapeHtml(String(lookupResult.query ?? state.packageCodeLookupQuery))}</strong></span>
                <span>Extraído: <strong>${escapeHtml(extractedCode || 'No detectado')}</strong></span>
                <span>Normalizado: <strong>${escapeHtml(normalizedCode || 'No disponible')}</strong></span>
                <span class="${lookupResult.found ? 'package-code-found' : 'package-code-missing'}">
                  ${lookupResult.found ? 'Se encontró el código y la tabla fue filtrada.' : 'No se encontró el código en las APIs.'}
                </span>
              </div>
            `
            : '<div class="empty-inline">Escribe un código para buscarlo y cargar el resultado en la tabla.</div>'
        }
      </div>
    </div>
  `
}
