// @ts-nocheck

export const renderContactProfileModal = (ctx: any) => {
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
    getGroupPickerResultsMarkup,
    getContactReminderState
  } = ctx
  if (!state.isContactProfileModalOpen) {
    return ''
  }

  const conversation = state.conversationData
  const activeContact =
    state.data?.contacts.find((contact) => contact.id === conversation.contact.id) ??
    getChatContacts().find((contact) => contact.id === conversation.contact.id) ??
    null

  if (!activeContact) {
    return ''
  }

  const statusKey = getEmsStatusKey(activeContact)
  const activeReference = getWhatsAppReference(activeContact)
  const reminderState = getContactReminderState(activeContact)

  return `
    <div class="modal-backdrop" id="contact-profile-modal-backdrop">
      <div class="modal-card modal-card-profile">
        <div class="modal-header">
          <div>
            <p class="section-kicker">Perfil del contacto</p>
            <h3>${escapeHtml(activeContact.name)}</h3>
            <small class="conversation-subtitle">Haz clic en los campos para editar la ficha desde el CRM.</small>
          </div>
          <div class="conversation-header-actions">
            <button class="secondary-btn" id="open-edit-contact-from-profile" type="button">Editar contacto</button>
            <button class="modal-close" id="close-contact-profile-modal" type="button">Cerrar</button>
          </div>
        </div>

        <div class="profile-modal-hero">
          <div class="conversation-contact-avatar conversation-contact-avatar-xl">
            ${escapeHtml(activeContact.name.slice(0, 1))}
          </div>
          <div class="profile-modal-copy">
            <strong>${escapeHtml(activeContact.name)}</strong>
            <span>${escapeHtml(activeReference || 'Sin referencia de WhatsApp')}</span>
            ${
              reminderState.active
                ? `<small class="conversation-contact-reminder">${escapeHtml(reminderState.label)} · ${escapeHtml(reminderState.timestamp || 'Sin hora registrada')}</small>`
                : ''
            }
          </div>
          <span class="ems-chat-status ${getEmsStatusToneClass(statusKey)}">
            ${escapeHtml(getEmsStatusLabel(statusKey))}
          </span>
        </div>

        <div class="ems-meta-row profile-modal-grid">
          <button class="ems-meta-card profile-click-card" data-profile-field="company" type="button">
            <span>Empresa</span>
            <strong>${escapeHtml(activeContact.company || 'No registrada')}</strong>
          </button>
          <button class="ems-meta-card profile-click-card" data-profile-field="owner" type="button">
            <span>Owner</span>
            <strong>${escapeHtml(activeContact.owner || 'Sin asignar')}</strong>
          </button>
          <button class="ems-meta-card profile-click-card" data-profile-field="segment" type="button">
            <span>Segmento</span>
            <strong>${escapeHtml(activeContact.segment || 'Sin segmento')}</strong>
          </button>
          <button class="ems-meta-card profile-click-card" data-profile-field="status" type="button">
            <span>Estado</span>
            <strong>${escapeHtml(activeContact.status || 'Sin estado')}</strong>
          </button>
          <button class="ems-meta-card profile-click-card" data-profile-field="channel" type="button">
            <span>Canal</span>
            <strong>WhatsApp Meta</strong>
          </button>
          ${
            reminderState.active
              ? `
                <div class="ems-meta-card conversation-reminder-block">
                  <span>Recordatorio</span>
                  <strong>${escapeHtml(reminderState.label)}</strong>
                  <small>${escapeHtml(reminderState.note)}</small>
                </div>
              `
              : ''
          }
          <div class="ems-meta-card ems-ai-card">
            <div class="ai-toggle-header">
              <span>Atención por IA</span>
              <span class="ai-toggle-badge ${isAiAssistedConversation(activeContact.id) ? 'is-on' : ''}">
                ${isAiAssistedConversation(activeContact.id) ? 'AI activo' : 'Manual'}
              </span>
            </div>
            <label class="ai-switch" aria-label="Activar atención por IA para este contacto">
              <input
                type="checkbox"
                data-ai-toggle-conversation="${activeContact.id}"
                ${isAiAssistedConversation(activeContact.id) ? 'checked' : ''}
              />
              <span class="ai-slider"></span>
            </label>
          </div>
        </div>
      </div>
    </div>
  `
}



