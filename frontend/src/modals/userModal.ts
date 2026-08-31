// @ts-nocheck

export const renderUserModal = (ctx: any) => {
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
  if (!state.isUserModalOpen) {
    return ''
  }

  const isEdit = state.userModalMode === 'edit'

  return `
    <div class="modal-backdrop" id="user-modal-backdrop">
      <div class="modal-card">
        <div class="modal-header">
          <div>
            <p class="section-kicker">Usuarios</p>
            <h3>${isEdit ? 'Editar usuario' : 'Nuevo usuario'}</h3>
            <small>${isEdit ? 'Actualiza los datos de acceso del usuario.' : 'Crea una cuenta interna con acceso al sistema.'}</small>
          </div>
          <button class="modal-close" id="close-user-modal" type="button">Cerrar</button>
        </div>

        <form id="user-form" class="modal-form">
          <label class="field">
            <span>Nombre completo</span>
            <input name="fullName" type="text" value="${escapeHtml(state.userForm.fullName)}" placeholder="Nombre y apellido" />
          </label>

          <label class="field">
            <span>Correo</span>
            <input name="email" type="email" value="${escapeHtml(state.userForm.email)}" placeholder="usuario@correos.gob.bo" />
          </label>

          <label class="field">
            <span>Rol</span>
            <select name="role">
              ${['Administradores', 'Gestores', 'Carteros']
                .map(
                  (role) => `
                    <option value="${escapeHtml(role)}" ${state.userForm.role === role ? 'selected' : ''}>${escapeHtml(role)}</option>
                  `,
                )
                .join('')}
            </select>
          </label>

          <label class="field">
            <span>Contraseña ${isEdit ? '(opcional)' : ''}</span>
            <input name="password" type="password" value="${escapeHtml(state.userForm.password)}" placeholder="${isEdit ? 'Dejar en blanco para mantener la actual' : 'Contraseña inicial'}" />
          </label>

          ${
            state.userSubmitError
              ? `<div class="form-error">${escapeHtml(state.userSubmitError)}</div>`
              : ''
          }

          <div class="modal-actions">
            <button class="secondary-btn" id="close-user-modal-secondary" type="button">Cancelar</button>
            <button class="primary-btn" id="submit-user-form" type="submit" ${state.userSubmitState === 'submitting' ? 'disabled' : ''}>
              ${state.userSubmitState === 'submitting' ? 'Guardando...' : 'Guardar usuario'}
            </button>
          </div>
        </form>
      </div>
    </div>
  `
}




