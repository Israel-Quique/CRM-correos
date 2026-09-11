// @ts-nocheck

export const renderChatView = (ctx: any) => {
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
    getChatStatusLabel,
    getEmsStatusToneClass,
    getEmsPhaseLabel,
    getChatPhaseLabel,
    getChatPhaseDescription,
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
    getGroupPickerResultsMarkup,
    getChatListPagination
  } = ctx
  const conversation = state.conversationData
  const allChatContacts = getChatContacts()
  const statusCounts = getEmsStatusContacts()
  const sortedMessages = getConversationMessagesChronological(conversation.messages)
  const chatPagination = getChatListPagination()
  const activeContact =
    state.data?.contacts.find((contact) => contact.id === conversation.contact.id) ??
    allChatContacts.find((contact) => contact.id === conversation.contact.id) ??
    null
  const activeReference = activeContact ? getWhatsAppReference(activeContact) : ''
  const shouldShowAddContact = isAutoCreatedChatContact(activeContact)
  const activeConversationCount = allChatContacts.length
  const activePhaseLabel = activeContact ? getChatPhaseLabel(activeContact) : 'Nuevo'
  const activePhaseDescription = activeContact
    ? getChatPhaseDescription(activeContact)
    : 'Selecciona una conversación para ver su seguimiento.'
  const chatPaginationVisible = chatPagination.totalItems > chatPagination.pageSize

  return `
    <section class="section-panel chat-module-panel ${state.activeView === 'chat' ? 'is-visible' : ''}">
      <div class="ems-board">
        <div class="ems-header">
          <div class="ems-header-copy">
            <p class="section-kicker">Módulo de conversaciones segregadas</p>
            <div class="ems-title-row">
              <h2>Chats y Atención Omnicanal por Estado del Paquete</h2>
              <div class="ems-active-pill">
                <span class="ems-active-dot"></span>
                ${activeConversationCount} Conversaciones Activas
              </div>
            </div>
          </div>
          ${
            activeContact
              ? `
                <button class="danger-btn ems-delete-btn" id="delete-conversation-btn" type="button">Borrar chat</button>
              `
              : ''
          }
        </div>

        <div class="ems-status-tabs">
          <button class="ems-status-chip ${state.emsStatusFilter === 'all' ? 'is-active' : ''}" data-ems-status-filter="all" type="button">
            <span class="ems-status-dot is-all"></span>
            Todos los Chats (${statusCounts.all.length})
          </button>
          <button class="ems-status-chip ${state.emsStatusFilter === 'received' ? 'is-active' : ''}" data-ems-status-filter="received" type="button">
            <span class="ems-status-dot is-received"></span>
            1. Recibido Origen (${statusCounts.received.length})
          </button>
          <button class="ems-status-chip ${state.emsStatusFilter === 'transit' ? 'is-active' : ''}" data-ems-status-filter="transit" type="button">
            <span class="ems-status-dot is-transit"></span>
            2. En Camino / Tránsito (${statusCounts.transit.length})
          </button>
          <button class="ems-status-chip ${state.emsStatusFilter === 'regional' ? 'is-active' : ''}" data-ems-status-filter="regional" type="button">
            <span class="ems-status-dot is-regional"></span>
            3. Recibido Destino (${statusCounts.regional.length})
          </button>
          <button class="ems-status-chip ${state.emsStatusFilter === 'courier' ? 'is-active' : ''}" data-ems-status-filter="courier" type="button">
            <span class="ems-status-dot is-courier"></span>
            4. Cartero (${statusCounts.courier.length})
          </button>
          <button class="ems-status-chip ${state.emsStatusFilter === 'delivered' ? 'is-active' : ''}" data-ems-status-filter="delivered" type="button">
            <span class="ems-status-dot is-delivered"></span>
            5. Entregado / CSAT (${statusCounts.delivered.length})
          </button>
        </div>

        ${
          state.notice
            ? `<div class="notice-banner">${escapeHtml(state.notice)}</div>`
            : ''
        }

        <div class="ems-layout">
          <aside class="ems-list-panel">
            <div class="ems-list-head">
              <div>
                <strong>Hilos de conversación</strong>
                <span>${activeConversationCount} chat(s) con WhatsApp</span>
              </div>
              <button class="ems-filter-icon" data-clear-ems-filters type="button" aria-label="Limpiar filtros" title="Limpiar filtros">
                â·
              </button>
            </div>
            <label class="ems-search">
              <input
                id="ems-search-input"
                type="text"
                value="${escapeHtml(state.searchQuery)}"
                placeholder="Buscar chat por cliente o guía..."
              />
            </label>
            <div class="ems-list-scroll">
              ${
                chatPagination.items.length > 0
                  ? chatPagination.items
                      .map((contact) => {
                        const statusKey = getEmsStatusKey(contact)
                        const statusLabel = getChatStatusLabel(contact)
                        return `
                          <button
                            class="ems-chat-card ${contact.id === conversation.contact.id ? 'is-active' : ''}"
                            data-open-chat="${contact.id}"
                            type="button"
                            aria-label="Abrir chat de ${escapeHtml(contact.name)}"
                          >
                            <div class="ems-chat-card-avatar">${escapeHtml(contact.name.slice(0, 1))}</div>
                            <div class="ems-chat-card-copy">
                              <div class="ems-chat-card-top">
                                <strong>${escapeHtml(contact.name)}</strong>
                                <span>${escapeHtml(formatConversationTimestamp(contact.updatedAt))}</span>
                              </div>
                              <small>${escapeHtml(getContactPreviewLine(contact))}</small>
                              <p>${escapeHtml(getContactLastMessagePreview(contact))}</p>
                              <div class="ems-chat-card-bottom">
                                <span class="contact-connection-badge ${getContactConnectionClass(contact)}">
                                  <span class="contact-connection-dot" aria-hidden="true"></span>
                                  ${escapeHtml(getContactConnectionLabel(contact))}
                                </span>
                                <span class="ems-chat-status ${getEmsStatusToneClass(statusKey)}">${escapeHtml(statusLabel)}</span>
                              </div>
                            </div>
                          </button>
                        `
                      })
                      .join('')
                  : `<div class="empty-state">No hay conversaciones para este filtro.</div>`
              }
            </div>
            ${
              chatPaginationVisible
                ? `
                  <div class="international-pagination chat-pagination">
                    <div class="international-pagination-info">
                      <strong>${chatPagination.currentPage}</strong>
                      <span>de ${chatPagination.totalPages} páginas</span>
                      <span>Mostrando ${Math.min(
                        chatPagination.totalItems,
                        chatPagination.currentPage * chatPagination.pageSize,
                      )} de ${chatPagination.totalItems} chats</span>
                    </div>
                    <div class="international-pagination-actions">
                      <button
                        class="secondary-btn pagination-btn"
                        data-chat-list-page="prev"
                        type="button"
                        ${chatPagination.currentPage <= 1 ? 'disabled' : ''}
                      >
                        Anterior
                      </button>
                      <button
                        class="secondary-btn pagination-btn"
                        data-chat-list-page="next"
                        type="button"
                        ${chatPagination.currentPage >= chatPagination.totalPages ? 'disabled' : ''}
                      >
                        Siguiente
                      </button>
                    </div>
                  </div>
                `
                : ''
            }
          </aside>

          <section class="ems-conversation-panel">
            <div class="ems-conversation-main">
              <div class="ems-conversation-header">
                <button
                  class="ems-conversation-profile"
                  data-open-contact-profile="${activeContact?.id ?? ''}"
                  type="button"
                  ${activeContact ? '' : 'disabled'}
                >
                  <div class="conversation-contact-avatar conversation-contact-avatar-lg">
                    ${escapeHtml((conversation.contact.name || 'C').slice(0, 1))}
                  </div>
                  <div>
                    <div class="ems-conversation-name-row">
                      <h4>${escapeHtml(conversation.contact.name || 'Selecciona una conversacion')}</h4>
                      <span class="ems-conversation-state">${escapeHtml(activePhaseLabel.replace('Fase ', ''))}</span>
                    </div>
                    <small>${escapeHtml(activeReference || conversation.contact.company || 'Sin referencia disponible')}</small>
                  </div>
                </button>
                <div class="ems-conversation-actions">
                  <button
                    class="primary-btn ems-ai-btn"
                    data-ai-suggest-reply
                    type="button"
                    ${!activeContact || state.conversationState === 'loading' ? 'disabled' : ''}
                  >
                    Sugerir Respuesta IA
                  </button>
                  ${
                    shouldShowAddContact
                      ? `
                        <button
                          class="secondary-btn conversation-add-contact-btn"
                          data-add-chat-contact="${activeContact?.id ?? ''}"
                          type="button"
                        >
                          Agregar contacto
                        </button>
                      `
                      : ''
                  }
                </div>
              </div>

              <div class="ems-phase-strip">
                <strong>${escapeHtml(activePhaseLabel)}:</strong>
                <span>${escapeHtml(activePhaseDescription)}</span>
              </div>

              <div class="ems-meta-row">
                <div class="ems-meta-card">
                  <span>Empresa</span>
                  <strong>${escapeHtml(activeContact?.company || 'No registrada')}</strong>
                </div>
                <div class="ems-meta-card">
                  <span>Owner</span>
                  <strong>${escapeHtml(activeContact?.owner || 'Sin asignar')}</strong>
                </div>
                <div class="ems-meta-card">
                  <span>Segmento</span>
                  <strong>${escapeHtml(activeContact?.segment || 'Sin segmento')}</strong>
                </div>
                <div class="ems-meta-card">
                  <span>Estado</span>
                  <strong>${escapeHtml(activeContact ? getChatStatusLabel(activeContact) : 'Sin estado')}</strong>
                </div>
                <div class="ems-meta-card">
                  <span>Canal</span>
                  <strong>WhatsApp Meta</strong>
                </div>
                <div class="ems-meta-card ems-ai-card">
                  <div class="ai-toggle-header">
                    <span>Atención por IA</span>
                    <span class="ai-toggle-badge ${isAiAssistedConversation(conversation.contact.id) ? 'is-on' : ''}">
                      ${isAiAssistedConversation(conversation.contact.id) ? 'AI activo' : 'Manual'}
                    </span>
                  </div>
                  <label class="ai-switch" aria-label="Activar atención por IA para esta conversación">
                    <input
                      type="checkbox"
                      data-ai-toggle-conversation="${conversation.contact.id}"
                      ${isAiAssistedConversation(conversation.contact.id) ? 'checked' : ''}
                    />
                    <span class="ai-slider"></span>
                  </label>
                </div>
              </div>

              <div class="ems-thread-shell">
                ${
                  state.conversationError
                    ? `<div class="form-error">${escapeHtml(state.conversationError)}</div>`
                    : ''
                }
                ${
                  state.conversationState === 'loading'
                    ? `<div class="empty-state loading-state">Cargando conversacion...</div>`
                    : conversation.contact.id === 0
                      ? `<div class="empty-state">Selecciona un contacto de la bandeja izquierda para abrir el chat.</div>`
                      : sortedMessages.length > 0
                        ? `
                          <div class="ems-thread conversation-thread">
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
            </div>

            <form class="conversation-composer ems-composer ems-composer-panel" id="chat-composer-form">
              <button class="conversation-composer-addon" type="button" aria-label="Adjuntar" disabled>+</button>
              <textarea
                id="chat-composer-input"
                name="message"
                rows="1"
                placeholder="Escribe un mensaje"
                ${activeContact ? '' : 'disabled'}
              >${escapeHtml(state.sendMessageForm.contactId === activeContact?.id ? state.sendMessageForm.message : '')}</textarea>
              <button
                class="conversation-composer-send ems-send-btn"
                type="submit"
                ${!activeContact || state.sendMessageState === 'submitting' ? 'disabled' : ''}
              >
                ${state.sendMessageState === 'submitting' ? 'Enviando...' : 'Enviar'}
              </button>
            </form>
          </section>
        </div>
      </div>
    </section>
  `
}



