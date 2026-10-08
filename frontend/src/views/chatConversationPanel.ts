// @ts-nocheck

export const renderChatConversationPanel = (
  ctx: any,
  {
    conversation,
    sortedMessages,
    activeContact,
    activeReference,
    shouldShowAddContact,
    activePhaseLabel,
    activePhaseDescription,
    activePauseRemaining,
  }: any,
) => {
  const {
    state,
    escapeHtml,
    formatConversationTimestamp,
    renderConversationMessageMedia,
    getChatStatusLabel,
    isAiAssistedConversation,
  } = ctx

  return `
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
                ${
                  activePauseRemaining
                    ? `<span class="ems-ban-timer">⏳ Ban IA: ${escapeHtml(activePauseRemaining)}</span>`
                    : ''
                }
                ${
                  activePauseRemaining && activeContact
                    ? `<button class="ems-unban-btn" data-auto-reply-unpause="${activeContact.id}" type="button">Desactivar ban</button>`
                    : ''
                }
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
          id="chat-composer-send"
          class="conversation-composer-send ems-send-btn"
          type="submit"
          ${!activeContact || state.sendMessageState === 'submitting' ? 'disabled' : ''}
        >
          ${state.sendMessageState === 'submitting' ? 'Enviando...' : 'Enviar'}
        </button>
      </form>
      ${
        state.sendMessageError
          ? `<div class="form-error ems-composer-error">${escapeHtml(state.sendMessageError)}</div>`
          : ''
      }
    </section>
  `
}
