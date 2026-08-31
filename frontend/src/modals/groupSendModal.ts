// @ts-nocheck

export const renderGroupSendModal = (ctx: any) => {
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
  if (!state.isGroupSendModalOpen) {
    return ''
  }

  return `
    <div class="modal-backdrop" id="group-send-modal-backdrop">
      <div class="modal-card">
        <div class="modal-header">
          <div>
            <p class="section-kicker">Envio grupal</p>
            <h3>${escapeHtml(state.groupSendForm.groupName || 'Grupo de contactos')}</h3>
          </div>
          <button class="modal-close" id="close-group-send-modal" type="button">Cerrar</button>
        </div>

        <form id="group-send-form" class="modal-form">
          <div class="modal-panel-intro">
            <strong>Usa variables para personalizar el mensaje sin escribir uno por uno.</strong>
            <p>Variables disponibles: {{name}}, {{company}}, {{owner}}, {{segment}}</p>
          </div>
          <label class="message-compose-field">
            <span>Mensaje base</span>
            <textarea name="message">${escapeHtml(state.groupSendForm.message)}</textarea>
          </label>
          ${
            state.groupSendError
              ? `<div class="form-error">${escapeHtml(state.groupSendError)}</div>`
              : ''
          }
          <div class="modal-actions">
            <button class="secondary-btn" id="cancel-group-send" type="button">Cancelar</button>
            <button class="primary-btn" type="submit" ${state.groupSendState === 'submitting' ? 'disabled' : ''}>
              ${state.groupSendState === 'submitting' ? 'Enviando...' : 'Enviar al grupo'}
            </button>
          </div>
        </form>
      </div>
    </div>
  `
}



