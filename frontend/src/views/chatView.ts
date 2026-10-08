// @ts-nocheck

import { renderChatConversationPanel } from './chatConversationPanel'

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
    formatAutoReplyPauseRemaining,
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
  const activePauseRemaining = activeContact ? formatAutoReplyPauseRemaining(activeContact) : ''
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
          <button class="ems-status-chip ${state.emsStatusFilter === 'paused' ? 'is-active' : ''}" data-ems-status-filter="paused" type="button">
            <span class="ems-status-dot is-paused"></span>
            Baneados 4h (${statusCounts.paused.length})
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
                        const isPaused = Boolean(contact.autoReplyPause?.isPaused && contact.autoReplyPause?.pausedUntil && new Date(contact.autoReplyPause.pausedUntil).getTime() > Date.now())
                        return `
                          <button
                            class="ems-chat-card ${contact.id === conversation.contact.id ? 'is-active' : ''} ${isPaused ? 'is-paused' : ''}"
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
                                ${
                                  isPaused
                                    ? `<span class="ems-chat-status is-paused">Baneado 4h</span>`
                                    : ''
                                }
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

          ${renderChatConversationPanel(ctx, {
            conversation,
            sortedMessages,
            activeContact,
            activeReference,
            shouldShowAddContact,
            activePhaseLabel,
            activePhaseDescription,
            activePauseRemaining,
          })}        </div>
      </div>
    </section>
  `
}



