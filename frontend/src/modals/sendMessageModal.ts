// @ts-nocheck

export const renderSendMessageModal = (ctx: any) => {
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
  if (!state.isSendMessageModalOpen) {
    return ''
  }

  return `
    <div class="modal-backdrop" id="message-modal-backdrop">
      <div class="modal-card">
        <div class="modal-header">
          <div>
            <p class="section-kicker">WhatsApp Meta</p>
            <h3>Enviar mensaje a ${escapeHtml(state.sendMessageForm.contactName)}</h3>
          </div>
          <button class="modal-close" id="close-send-message" type="button">Cerrar</button>
        </div>

        <form id="send-message-form" class="modal-form">
          <label>
            <span>Destino</span>
            <input
              name="targetReference"
              value="${escapeHtml(state.sendMessageForm.targetReference)}"
              placeholder="+59170000000"
              required
            />
          </label>
          <label>
            <span>Canal</span>
            <input value="WhatsApp Meta Cloud API" disabled />
          </label>
          <label>
            <span>Adjunto</span>
            <input
              id="send-message-attachment"
              name="attachment"
              type="file"
              accept="image/*,audio/*"
            />
            <small class="channel-reference-hint">
              Puedes enviar una imagen o audio. Si adjuntas imagen, el texto se usa como caption.
            </small>
            ${
              state.sendMessageForm.attachmentName
                ? `
                  <small class="channel-reference-hint">
                    Seleccionado: ${escapeHtml(
                      `${getAttachmentKindLabel(state.sendMessageForm.attachmentType)} · ${state.sendMessageForm.attachmentName}`,
                    )}
                  </small>
                `
                : ''
            }
          </label>
          <label class="message-compose-field">
            <span>Mensaje</span>
            <textarea
              id="send-message-body"
              name="message"
              rows="6"
              placeholder="Escribe aqui el mensaje para el cliente"
            >${escapeHtml(state.sendMessageForm.message)}</textarea>
            <small class="channel-reference-hint">
              Para texto plano este campo es obligatorio. Para audio, deja el texto vacÃ­o.
            </small>
          </label>

          ${
            state.sendMessageError
              ? `<div class="form-error">${escapeHtml(state.sendMessageError)}</div>`
              : ''
          }

          <div class="modal-actions">
            <button class="secondary-btn" id="cancel-send-message" type="button">Cancelar</button>
            <button class="primary-btn" type="submit" ${state.sendMessageState === 'submitting' ? 'disabled' : ''}>
              ${state.sendMessageState === 'submitting' ? 'Enviando...' : 'Enviar mensaje'}
            </button>
          </div>
        </form>
      </div>
    </div>
  `
}



