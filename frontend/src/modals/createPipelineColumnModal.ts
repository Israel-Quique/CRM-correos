// @ts-nocheck

export const renderCreatePipelineColumnModal = (ctx: any) => {
  const { state, escapeHtml, prontsPresetMeta } = ctx

  if (!state.isCreatePipelineColumnModalOpen) {
    return ''
  }

  return `
    <div class="modal-backdrop" id="create-pipeline-column-modal-backdrop">
      <div class="modal-card modal-card-compact">
        <div class="modal-header">
          <div>
            <p class="section-kicker">EMS</p>
            <h3>Crear columna y prompt relacionado</h3>
            <small>Registra una nueva columna del pipeline y define con qué prompt base quedará vinculada.</small>
          </div>
          <button class="modal-close" id="close-create-pipeline-column-modal" type="button">Cerrar</button>
        </div>

        ${
          state.pipelineConfigError
            ? `<div class="form-error">${escapeHtml(state.pipelineConfigError)}</div>`
            : ''
        }

        <form class="pipeline-column-modal-form" id="create-pipeline-column-form">
          <label class="form-field">
            <span>Nombre de la columna</span>
            <input
              data-create-pipeline-column-input="title"
              type="text"
              value="${escapeHtml(state.createPipelineColumnForm.title)}"
              placeholder="Ej. En aduana"
            />
          </label>

          <label class="form-field">
            <span>Descripción corta</span>
            <input
              data-create-pipeline-column-input="helper"
              type="text"
              value="${escapeHtml(state.createPipelineColumnForm.helper)}"
              placeholder="Describe qué sucede en esta etapa"
            />
          </label>

          <label class="form-field">
            <span>Prompt base relacionado</span>
            <select data-create-pipeline-column-select="presetKey">
              ${Object.entries(prontsPresetMeta)
                .map(
                  ([presetKey, meta]) => `
                    <option value="${presetKey}" ${state.createPipelineColumnForm.presetKey === presetKey ? 'selected' : ''}>
                      ${escapeHtml(meta.title)}
                    </option>
                  `,
                )
                .join('')}
            </select>
          </label>

          <div class="modal-actions">
            <button class="secondary-btn" id="cancel-create-pipeline-column-modal" type="button">Cancelar</button>
            <button class="primary-btn" type="submit">Crear columna</button>
          </div>
        </form>
      </div>
    </div>
  `
}
