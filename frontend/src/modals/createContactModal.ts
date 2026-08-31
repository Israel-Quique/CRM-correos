// @ts-nocheck

export const renderCreateContactModal = (ctx: any) => {
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
    getProntsColumnContacts,
    getProntsSelectedContact,
    getProntsTokenChips,
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
  if (!state.isCreateContactModalOpen) {
    return ''
  }

  const isEditingContact = state.contactModalMode === 'edit'
  const activeConversationContact =
    state.data?.contacts.find((contact) => contact.id === state.conversationData.contact.id) ??
    getChatContacts().find((contact) => contact.id === state.conversationData.contact.id) ??
    null
  const showCapturedConversationSummary = !isEditingContact && isAutoCreatedChatContact(activeConversationContact)
  const conversationMessages = getConversationMessagesChronological(state.conversationData.messages)
  const latestConversationMessage = [...conversationMessages].reverse().find((message) => message.direction === 'inbound') ??
    conversationMessages.at(-1) ??
    null
  const capturedReference = activeConversationContact ? getWhatsAppReference(activeConversationContact) : ''
  const segmentOptions = getSegmentOptions()
  const stepIndex =
    state.createContactStep === 'personal' ? 1 : state.createContactStep === 'channels' ? 2 : 3
  const selectedCountry = findPhoneCountry(state.createContactForm.whatsappCountrySearch)
  const whatsappPreview = (() => {
    const localDigits = state.createContactForm.whatsappLocalNumber.replace(/[^\d]/g, '')
    return selectedCountry && localDigits
      ? `+${selectedCountry.dialCode}${localDigits}`
      : 'numero internacional completo'
  })()

  return `
    <div class="modal-backdrop" id="modal-backdrop">
      <div class="modal-card">
        <div class="modal-header">
          <div>
            <p class="section-kicker">${isEditingContact ? 'Editar contacto' : 'Nuevo contacto'}</p>
            <h3>
              ${
                state.createContactStep === 'personal'
                  ? 'Paso 1: datos personales'
                  : state.createContactStep === 'channels'
                    ? 'Paso 2: redes sociales'
                    : 'Paso 3: datos de contacto'
              }
            </h3>
          </div>
          <button class="modal-close" id="close-create-contact" type="button">Cerrar</button>
        </div>

        <div class="modal-stepper" aria-label="Progreso del formulario">
          <button
            class="modal-step ${stepIndex >= 1 ? 'is-active' : ''} ${isEditingContact ? 'is-clickable' : ''}"
            data-contact-step="personal"
            type="button"
            ${isEditingContact ? '' : 'disabled'}
          >
            <strong>1</strong>
            <span>Cliente</span>
          </button>
          <button
            class="modal-step ${stepIndex >= 2 ? 'is-active' : ''} ${isEditingContact ? 'is-clickable' : ''}"
            data-contact-step="channels"
            type="button"
            ${isEditingContact ? '' : 'disabled'}
          >
            <strong>2</strong>
            <span>Redes</span>
          </button>
          <button
            class="modal-step ${stepIndex >= 3 ? 'is-active' : ''} ${isEditingContact ? 'is-clickable' : ''}"
            data-contact-step="details"
            type="button"
            ${isEditingContact ? '' : 'disabled'}
          >
            <strong>3</strong>
            <span>Registro</span>
          </button>
        </div>

        <form id="create-contact-form" class="modal-form">
          ${
            showCapturedConversationSummary
              ? `
                <div class="modal-panel-intro contact-capture-summary">
                  <strong>Datos captados desde la conversación</strong>
                  <p>
                    Este contacto todavía no está agendado. El formulario ya trae la información detectada para que la guardes sin perder contexto.
                  </p>
                  <div class="contact-capture-grid">
                    <div class="contact-capture-item">
                      <span>Nombre detectado</span>
                      <strong>${escapeHtml(state.conversationData.contact.name || 'Sin nombre captado')}</strong>
                    </div>
                    <div class="contact-capture-item">
                      <span>WhatsApp</span>
                      <strong>${escapeHtml(capturedReference || 'Sin número captado')}</strong>
                    </div>
                    <div class="contact-capture-item">
                      <span>Empresa</span>
                      <strong>${escapeHtml(state.conversationData.contact.company || 'No registrada')}</strong>
                    </div>
                    <div class="contact-capture-item">
                      <span>Ãšltimo mensaje</span>
                      <p>${escapeHtml(truncateText(latestConversationMessage?.message ?? 'Sin mensajes recientes', 120))}</p>
                    </div>
                  </div>
                </div>
              `
              : ''
          }
          ${
            state.createContactStep === 'personal'
              ? `
                <div class="modal-panel-intro">
                  <strong>Primero registremos la informacion base del cliente.</strong>
                  <p>Estos datos abren el flujo y luego te llevamos a las redes sociales.</p>
                </div>
                <label>
                  <span>Nombre completo</span>
                  <input name="name" value="${escapeHtml(state.createContactForm.name)}" required />
                </label>
                <label>
                  <span>Empresa</span>
                  <input name="company" value="${escapeHtml(state.createContactForm.company)}" placeholder="Opcional" />
                </label>
              `
              : ''
          }

          ${
            state.createContactStep === 'channels'
              ? `
                <div class="channel-selector">
                  <span>Selecciona las redes y canales del cliente</span>
                  <div class="channel-grid">
                    ${contactChannelOptions
                      .map(
                        (channel) => `
                          <label class="channel-check">
                            <input
                              class="contact-channel-check"
                              data-channel="${channel}"
                              type="checkbox"
                              ${state.createContactForm.channels.includes(channel) ? 'checked' : ''}
                            />
                            <span>${channel}</span>
                          </label>
                        `,
                      )
                      .join('')}
                  </div>
                </div>
              `
              : ''
          }

          ${
            state.createContactStep === 'details'
              ? `
                <div class="channel-reference-block">
                  <span>Completa los datos segun las redes seleccionadas</span>
                  <div class="channel-reference-grid">
                    ${state.createContactForm.channels
                      .map(
                        (channel) => `
                          ${
                            channel === 'WhatsApp'
                              ? `
                                <div class="channel-reference-card channel-reference-card-whatsapp">
                                  <span>WhatsApp</span>
                                  <div class="whatsapp-reference-grid">
                                    <label>
                                      <span>Pais</span>
                                      <div class="whatsapp-country-control">
                                        <span
                                          class="whatsapp-country-flag ${getFlagIconClass(selectedCountry?.iso2 ?? defaultWhatsAppCountry.iso2)}"
                                          aria-hidden="true"
                                        ></span>
                                        <select class="whatsapp-country-select" aria-label="Selecciona el pais de WhatsApp">
                                          ${phoneCountryOptions
                                            .map(
                                              (country) => `
                                                <option
                                                  value="${escapeHtml(country.iso2)}"
                                                  ${selectedCountry?.iso2 === country.iso2 ? 'selected' : ''}
                                                  title="${escapeHtml(getPhoneCountryLabel(country))}"
                                                >
                                                  ${escapeHtml(country.name)} +${escapeHtml(country.dialCode)}
                                                </option>
                                              `,
                                            )
                                            .join('')}
                                        </select>
                                      </div>
                                    </label>
                                    <label>
                                      <span>Numero</span>
                                      <input
                                        class="whatsapp-local-number"
                                        inputmode="tel"
                                        value="${escapeHtml(state.createContactForm.whatsappLocalNumber)}"
                                        placeholder="+59164229403"
                                        required
                                      />
                                    </label>
                                  </div>
                                  <small class="channel-reference-hint">
                                    Se guardara como ${escapeHtml(whatsappPreview)}
                                  </small>
                                </div>
                              `
                              : `
                                <label class="channel-reference-card">
                                  <span>${channel}</span>
                                  <input
                                    class="contact-channel-reference"
                                    data-channel="${channel}"
                                    value="${escapeHtml(state.createContactForm.channelReferences[channel] ?? '')}"
                                    placeholder="${
                                      channel === 'Telegram'
                                        ? 'Numero o usuario'
                                        : channel === 'Email'
                                          ? 'correo@empresa.com'
                                          : 'Usuario, URL o referencia'
                                    }"
                                    required
                                  />
                                </label>
                              `
                          }
                        `,
                      )
                      .join('')}
                  </div>
                </div>
                <label>
                  <span>Segmento</span>
                  <select name="segment">
                    ${
                      segmentOptions.length > 0
                        ? segmentOptions
                            .map(
                              (segment) => `
                                <option value="${escapeHtml(segment)}" ${state.createContactForm.segment === segment ? 'selected' : ''}>${escapeHtml(segment)}</option>
                              `,
                            )
                            .join('')
                        : `<option value="">Sin grupos disponibles</option>`
                    }
                  </select>
                </label>
                <label>
                  <span>Owner</span>
                  <select name="owner">
                    <option value="Camila" ${state.createContactForm.owner === 'Camila' ? 'selected' : ''}>Camila</option>
                    <option value="Diego" ${state.createContactForm.owner === 'Diego' ? 'selected' : ''}>Diego</option>
                    <option value="Marina" ${state.createContactForm.owner === 'Marina' ? 'selected' : ''}>Marina</option>
                  </select>
                </label>
                <label>
                  <span>Estado</span>
                  <select name="status">
                    <option value="Nuevo" ${state.createContactForm.status === 'Nuevo' ? 'selected' : ''}>Nuevo</option>
                    <option value="En seguimiento" ${state.createContactForm.status === 'En seguimiento' ? 'selected' : ''}>En seguimiento</option>
                    <option value="Propuesta" ${state.createContactForm.status === 'Propuesta' ? 'selected' : ''}>Propuesta</option>
                    <option value="Activo" ${state.createContactForm.status === 'Activo' ? 'selected' : ''}>Activo</option>
                  </select>
                </label>
                <label>
                  <span>Score</span>
                  <input name="score" type="number" min="0" max="100" value="${escapeHtml(state.createContactForm.score)}" required />
                </label>
              `
              : ''
          }

          ${
            state.submitError
              ? `<div class="form-error">${escapeHtml(state.submitError)}</div>`
              : ''
          }

          <div class="modal-actions">
            <button class="secondary-btn" id="cancel-create-contact" type="button">
              ${state.createContactStep === 'personal' ? 'Cancelar' : 'Atras'}
            </button>
            ${
              state.createContactStep === 'details'
                ? `
                  <button class="primary-btn" type="submit" ${state.submitState === 'submitting' ? 'disabled' : ''}>
                    ${
                      state.submitState === 'submitting'
                        ? 'Guardando...'
                        : isEditingContact
                          ? 'Guardar cambios'
                          : 'Guardar contacto'
                    }
                  </button>
                `
                : `
                  <button class="primary-btn" id="continue-create-contact" type="button">
                    Continuar
                  </button>
                `
            }
          </div>
        </form>
      </div>
    </div>
  `
}



