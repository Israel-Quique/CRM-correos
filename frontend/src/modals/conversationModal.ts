// @ts-nocheck

export const renderConversationModal = (ctx: any) => {
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
  if (!state.isConversationModalOpen) {
    return ''
  }

  const conversation = state.conversationData
  const availableChatContacts = (state.data?.contacts ?? []).filter((contact) => hasWhatsAppChannel(contact))
  const sortedMessages = getConversationMessagesChronological(conversation.messages)
  const activeContact =
    state.data?.contacts.find((contact) => contact.id === conversation.contact.id) ??
    availableChatContacts.find((contact) => contact.id === conversation.contact.id) ??
    null
  const activeReference = activeContact ? getWhatsAppReference(activeContact) : ''

  return `
    <div class="modal-backdrop" id="conversation-modal-backdrop">
      <div class="modal-card modal-card-conversation">
        <div class="modal-header">
          <div>
            <p class="section-kicker">Inbox omnicanal</p>
            <h3>Conversaciones con clientes</h3>
            <small class="conversation-subtitle">Vista tipo inbox para revisar historial, ficha y acciones del contacto.</small>
          </div>
          <div class="conversation-header-actions">
            <button class="danger-btn" id="delete-conversation-btn" type="button">Borrar chat</button>
            <button class="modal-close" id="close-conversation-modal" type="button">Cerrar</button>
          </div>
        </div>

        <div class="conversation-shell">
          <aside class="conversation-sidebar">
            <div class="conversation-sidebar-head">
              <strong>Bandeja</strong>
              <span>${availableChatContacts.length} chat(s) con WhatsApp</span>
            </div>
            <div class="conversation-sidebar-list">
              ${
                availableChatContacts.length > 0
                  ? availableChatContacts
                      .map(
                        (contact) => `
                          <button
                            class="conversation-contact-card ${contact.id === conversation.contact.id ? 'is-active' : ''}"
                            data-open-chat="${contact.id}"
                            type="button"
                            aria-label="Abrir chat de ${escapeHtml(contact.name)}"
                          >
                            <div class="conversation-contact-avatar">${escapeHtml(contact.name.slice(0, 1))}</div>
                            <div class="conversation-contact-copy">
                              <strong>${escapeHtml(contact.name)}</strong>
                              <span>${escapeHtml(getContactPreviewLine(contact))}</span>
                            </div>
                          </button>
                        `,
                      )
                      .join('')
                  : `<div class="empty-state">No hay contactos con WhatsApp habilitado.</div>`
              }
            </div>
          </aside>

          <section class="conversation-main-panel">
            <div class="conversation-main-header">
              <div class="conversation-main-profile">
                <div class="conversation-contact-avatar conversation-contact-avatar-lg">
                  ${escapeHtml((conversation.contact.name || 'C').slice(0, 1))}
                </div>
                <div>
                  <h4>${escapeHtml(conversation.contact.name || 'Conversacion')}</h4>
                  <small>${escapeHtml(activeReference || conversation.contact.company || 'Sin referencia disponible')}</small>
                </div>
              </div>
              <div class="conversation-main-actions">
                <span class="conversation-pill">${escapeHtml(activeContact?.segment || 'Sin segmento')}</span>
                <button
                  class="secondary-btn"
                  data-send-whatsapp="${conversation.contact.id}"
                  type="button"
                  ${activeReference ? '' : 'disabled'}
                >
                  Enviar WhatsApp
                </button>
              </div>
            </div>

            <div class="conversation-thread-shell">
              ${
                state.conversationError
                  ? `<div class="form-error">${escapeHtml(state.conversationError)}</div>`
                  : ''
              }
              ${
                state.conversationState === 'loading'
                  ? `<div class="empty-state loading-state">Cargando conversacion...</div>`
                  : sortedMessages.length > 0
                    ? `
                      <div class="conversation-thread">
                        ${sortedMessages
                          .map(
                            (message) => `
                              <article class="conversation-bubble ${
                                message.direction === 'inbound' ? 'is-inbound' : 'is-outbound'
                              }">
                                <div class="conversation-meta">
                                  <strong>${message.direction === 'inbound' ? 'Cliente' : 'Equipo CRM'}</strong>
                                  <span>${escapeHtml(formatConversationTimestamp(message.createdAt))}</span>
                                </div>
                                ${renderConversationMessageMedia(message)}
                                <div class="conversation-status">
                                  <span>${escapeHtml(message.status)}</span>
                                  <small>${escapeHtml(message.provider)}</small>
                                </div>
                              </article>
                            `,
                          )
                          .join('')}
                      </div>
                    `
                    : `
                      <div class="empty-state">
                        Aun no hay mensajes guardados para este cliente. Cuando envies mensajes por WhatsApp desde el CRM, apareceran aqui.
                      </div>
                    `
              }
            </div>
          </section>

          <aside class="conversation-detail-panel">
            <div class="conversation-detail-card">
              <div class="conversation-contact-avatar conversation-contact-avatar-xl">
                ${escapeHtml((conversation.contact.name || 'C').slice(0, 1))}
              </div>
              <strong>${escapeHtml(conversation.contact.name || 'Sin nombre')}</strong>
              <span>${escapeHtml(activeReference || 'Sin WhatsApp registrado')}</span>
            </div>

            <div class="conversation-detail-block">
              <span>Empresa</span>
              <strong>${escapeHtml(conversation.contact.company || 'No registrada')}</strong>
            </div>
            <div class="conversation-detail-block">
              <span>Owner</span>
              <strong>${escapeHtml(activeContact?.owner || 'Sin asignar')}</strong>
            </div>
            <div class="conversation-detail-block">
              <span>Segmento</span>
              <strong>${escapeHtml(activeContact?.segment || 'Sin segmento')}</strong>
            </div>
            <div class="conversation-detail-block">
              <span>Estado</span>
              <strong>${escapeHtml(activeContact?.status || 'Sin estado')}</strong>
            </div>
            <div class="conversation-detail-block">
              <span>Canal</span>
              <strong>WhatsApp Meta</strong>
            </div>
            <div class="conversation-detail-block ai-toggle-block">
              <div class="ai-toggle-header">
                <span>Atencion por IA</span>
                <span class="ai-toggle-badge ${isAiAssistedConversation(conversation.contact.id) ? 'is-on' : ''}">
                  ${isAiAssistedConversation(conversation.contact.id) ? 'AI activo' : 'Manual'}
                </span>
              </div>
              <label class="ai-switch" aria-label="Activar atencion por IA para esta conversacion">
                <input
                  type="checkbox"
                  data-ai-toggle-conversation="${conversation.contact.id}"
                  ${isAiAssistedConversation(conversation.contact.id) ? 'checked' : ''}
                />
                <span class="ai-slider"></span>
              </label>
            </div>
          </aside>
        </div>
      </div>
    </div>
  `
}



