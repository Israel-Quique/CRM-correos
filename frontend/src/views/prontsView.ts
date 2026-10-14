// @ts-nocheck

export const renderProntsView = (ctx: any) => {
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
    getProntsColumnKeys,
    getProntsColumnContacts,
    getProntsSelectedContact,
    getProntsTokenChips,
    getProntsMetaForColumn,
    getPipelineColumnConfig,
    prontsPresetMeta,
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
  const isCustomMessagesView = state.activeView === 'mensajes-personalizados'
  const isNationalScope = state.activeView === 'pronts-nacional'
  const scopeLabel = isCustomMessagesView ? 'Todos los flujos' : isNationalScope ? 'Nacional' : 'Internacional'
  const scopeKicker = isCustomMessagesView ? 'Módulo de mensajería' : isNationalScope ? 'Gestor Prompt Ops para Nacional' : 'Gestor Prompt Ops para Internacionales'
  const scopeTitle = isCustomMessagesView ? 'Mensajes personalizados' : isNationalScope ? 'Gestión y Configuración de Prompts IA Nacional' : 'Gestión y Configuración de Prompts IA Internacional'
  const scopeDescription = isCustomMessagesView ? 'Configura los mensajes para responder sobre los paquetes existentes en el sistema.' : isNationalScope ? 'Administra los prompts operativos para el flujo nacional y sus estados del tablero.' : 'Administra los prompts operativos para el flujo internacional y su seguimiento por estados.'
  const activeColumn = state.prontsActiveColumn
  const activeConfig = getProntsColumnConfig(activeColumn)
  const activeMeta = getProntsMetaForColumn(activeColumn)
  const activePipelineColumn = getPipelineColumnConfig(activeColumn)
  const selectedContact = getProntsSelectedContact(activeColumn)
  const selectedReference = selectedContact ? getWhatsAppReference(selectedContact) : ''
  const sampleContacts = getProntsColumnContacts(activeColumn)
  const totalContacts = getChatContacts().length
  const isSimulationRunning = state.prontsSimulationState === 'running'

  const renderColumnCard = (column: string) => {
    const meta = getProntsMetaForColumn(column)
    const isActive = activeColumn === column
    const pipelineColumn = getPipelineColumnConfig(column)

    return `
      <button class="pronts-column-card ${isActive ? 'is-active' : ''} ${meta.accentClass}" data-pronts-column="${column}" type="button">
        <div class="pronts-column-card-badge">${meta.badge}</div>
        <div class="pronts-column-card-copy">
          <strong>${escapeHtml(pipelineColumn.title)}</strong>
          <span>${escapeHtml(pipelineColumn.helper)}</span>
        </div>
        <span class="pronts-column-card-arrow">›</span>
      </button>
    `
  }

  const renderTokenChip = (token: string) => `
    <button class="pronts-token-chip" data-pronts-insert-token="${token}" type="button">${escapeHtml(token)}</button>
  `

  const renderSampleOption = (contact: Contact) => {
    const reference = getWhatsAppReference(contact) || `EMS-${contact.id}`
    const descriptor =
      contact.company === 'Numero de prueba'
        ? 'Numero de prueba'
        : contact.company || contact.segment || 'Sin empresa'
    return `
      <option value="${contact.id}" ${selectedContact?.id === contact.id ? 'selected' : ''}>
        ${escapeHtml(`${reference} · ${contact.name} · ${descriptor}`)}
      </option>
    `
  }

  const simulationResponse = activeConfig.response

  return `
    <section class="section-panel pronts-board-panel ${(state.activeView === 'pronts-nacional' || state.activeView === 'pronts-internacional' || state.activeView === 'mensajes-personalizados') ? 'is-visible' : ''}">
      <div class="pronts-board">
        <div class="pronts-header">
          <div class="pronts-header-copy">
            <p class="section-kicker">${scopeKicker}</p>
            <div class="pronts-title-row">
              <h2>${scopeTitle}</h2>
              <span class="pronts-sandbox-pill">${scopeLabel} · ${totalContacts} contactos activos</span>
            </div>
            <p class="international-helper">${scopeDescription}</p>
          </div>
          <div class="pronts-header-actions">
            <button class="secondary-btn pronts-reset-btn" id="pronts-reset-defaults" type="button">Restablecer valores predeterminados</button>
            <button class="primary-btn pronts-save-btn" id="pronts-save-config" type="button" ${state.prontsConfigState === 'submitting' ? 'disabled' : ''}>${state.prontsConfigState === 'submitting' ? 'Guardando...' : 'Guardar configuración de prompt'}</button>
          </div>
        </div>

        ${
          state.prontsConfigError
            ? `<div class="notice-banner notice-banner-error">${escapeHtml(state.prontsConfigError)}</div>`
            : ''
        }

        <div class="pronts-columns">
          ${getProntsColumnKeys().map((column) => renderColumnCard(column)).join('')}
        </div>

        ${
          isCustomMessagesView
            ? `
              <section class="pronts-editor-card custom-message-preview-card">
                <div class="pronts-editor-head">
                  <div>
                    <p class="section-kicker">Vista previa de respuesta personalizada</p>
                    <h3>Paquete en camino</h3>
                    <small>Mensaje usado cuando el paquete registra tránsito hacia su destino.</small>
                  </div>
                  <span class="pronts-sandbox-pill">Paquete real seleccionado</span>
                </div>
                <textarea class="custom-message-preview-text custom-message-preview-editor" data-custom-transit-message rows="7">${escapeHtml(state.customTransitMessage || '')}</textarea>
              </section>
            `
            : ''
        }

        <div class="pronts-layout">
          <section class="pronts-editor-card">
            <div class="pronts-editor-head">
              <div>
                <span class="pronts-active-pill ${activeMeta.accentClass}">COLUMNA ACTUAL: ${escapeHtml(activePipelineColumn.title.toUpperCase())}</span>
                <h3>${escapeHtml(activeMeta.systemLabel)}</h3>
                <small>${escapeHtml(activePipelineColumn.helper)}</small>
              </div>
              <div class="pronts-preset-wrap">
                <label>
                  <span>Presets:</span>
                  <select data-pronts-preset-select="${activeColumn}">
                    ${Object.entries(prontsPresetMeta)
                      .map(
                        ([presetKey, meta]) => `
                          <option value="${presetKey}" ${presetKey === activeConfig.presetKey ? 'selected' : ''}>
                            ${escapeHtml(meta.title.replace('Columna ', '').replace(': ', ' · '))}
                          </option>
                        `,
                      )
                      .join('')}
                  </select>
                </label>
              </div>
            </div>

            <div class="pronts-panel-block">
              <div class="pronts-block-head">
                <strong>Instrucción del Sistema (System Prompt)</strong>
                <small>Modelo: GPT-4o / Claude Sonnet</small>
              </div>
              <textarea
                id="pronts-system-input-${activeColumn}"
                class="pronts-textarea pronts-system-input"
                data-pronts-system-input="${activeColumn}"
                name="pronts-system-input-${activeColumn}"
                rows="7"
              >${escapeHtml(activeConfig.systemPrompt)}</textarea>
            </div>

            <div class="pronts-panel-block">
              <div class="pronts-block-head">
                <strong>Plantilla de Usuario con Variables de Contexto (User Prompt Template)</strong>
              </div>
              <textarea
                id="pronts-template-input-${activeColumn}"
                class="pronts-textarea pronts-template-input"
                data-pronts-template-input="${activeColumn}"
                name="pronts-template-input-${activeColumn}"
                rows="8"
              >${escapeHtml(activeConfig.userTemplate)}</textarea>
            </div>

            <div class="pronts-token-section">
              <strong>Variables de Contexto Disponibles (Haz clic para insertar):</strong>
              <div class="pronts-token-list">
                ${getProntsTokenChips().map((token) => renderTokenChip(token)).join('')}
              </div>
            </div>

            <div class="pronts-footer-grid">
              <label class="pronts-slider-field">
                <span>Temperatura (Creatividad vs Precisión):</span>
                <div class="pronts-slider-row">
                  <input
                    class="pronts-temperature-input"
                    data-pronts-temperature-input="${activeColumn}"
                    type="range"
                    min="0"
                    max="1"
                    step="0.1"
                    value="${activeConfig.temperature}"
                  />
                  <strong>${activeConfig.temperature.toFixed(1)}</strong>
                </div>
              </label>
              <label class="pronts-action-field">
                <span>Acción Automática Recomendada:</span>
                <select data-pronts-action-select="${activeColumn}">
                  <option ${activeConfig.action === 'Asignar Etiqueta IA y Notificar WhatsApp' ? 'selected' : ''}>Asignar Etiqueta IA y Notificar WhatsApp</option>
                  <option ${activeConfig.action === 'Mover Automáticamente a Siguiente Estado' ? 'selected' : ''}>Mover Automáticamente a Siguiente Estado</option>
                  <option ${activeConfig.action === 'Escalar a Revisión Humana' ? 'selected' : ''}>Escalar a Revisión Humana</option>
                </select>
              </label>
            </div>
          </section>

          <section class="pronts-playground-card">
            <div class="pronts-playground-head">
              <div class="pronts-playground-title">
                <span>Probador de prompt en vivo</span>
              </div>
              <span class="pronts-sandbox-pill">Sandbox Activo</span>
            </div>

            <label class="pronts-sample-select">
              <span>Selecciona un Paquete de Muestra:</span>
              <select data-pronts-sample-select="${activeColumn}">
                ${sampleContacts.map((contact) => renderSampleOption(contact)).join('')}
              </select>
            </label>

            <div class="pronts-sample-card">
              <div class="pronts-sample-card-top">
                <strong>${escapeHtml(selectedContact ? `EMS-${selectedContact.id}` : 'Sin paquete')}</strong>
                <span>${escapeHtml(selectedReference || activeMeta.subtitle)}</span>
              </div>
              <div class="pronts-sample-grid">
                <div>
                  <span>Cliente</span>
                  <strong>${escapeHtml(selectedContact?.name || 'Sin contacto')}</strong>
                </div>
                <div>
                  <span>Destino</span>
                  <strong>${escapeHtml(selectedContact?.company || selectedContact?.segment || 'Sin destino')}</strong>
                </div>
                <div>
                  <span>WhatsApp</span>
                  <strong>${escapeHtml(selectedReference || 'Sin numero')}</strong>
                </div>
                <div>
                  <span>Peso</span>
                  <strong>${escapeHtml(selectedContact ? `${Math.max(0.4, selectedContact.score / 32).toFixed(1)} Kg` : '0.0 Kg')}</strong>
                </div>
                <div>
                  <span>Valor</span>
                  <strong>${escapeHtml(selectedContact ? `$${selectedContact.score}` : '$0')}</strong>
                </div>
              </div>
            </div>

            <button class="primary-btn pronts-run-btn" id="pronts-run-simulation" type="button" ${isSimulationRunning ? 'disabled' : ''}>
              ${isSimulationRunning ? 'Generando y enviando...' : 'Ejecutar simulación de prompt'}
            </button>

            <div class="pronts-response-head">
              <strong>Respuesta Simulada del Modelo de IA:</strong>
              <span>${isSimulationRunning ? 'Procesando envío real...' : 'Esperando simulación...'}</span>
            </div>
            <pre class="pronts-response-box">${escapeHtml(simulationResponse)}</pre>

            <div class="pronts-tip-box">
              <span>Consejo: usa etiquetas condicionales en el prompt para automatizar mensajes personalizados de WhatsApp.</span>
            </div>
          </section>
        </div>
      </div>
    </section>
  `
}



