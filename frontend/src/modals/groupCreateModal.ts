// @ts-nocheck

export const renderGroupCreateModal = (ctx: any) => {
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
  if (!state.isGroupCreateModalOpen) {
    return ''
  }

  const selectedContacts = (state.data?.contacts ?? []).filter((contact) =>
    state.selectedContactIds.has(contact.id),
  )
  const pickerOptions = getGroupContactPickerOptions()

  return `
    <div class="modal-backdrop" id="group-create-modal-backdrop">
      <div class="modal-card">
        <div class="modal-header">
          <div>
            <p class="section-kicker">${state.groupModalMode === 'add-members' ? 'Agregar miembros' : 'Nuevo grupo'}</p>
            <h3>${
              state.groupModalMode === 'add-members'
                ? `Sumar contactos a ${escapeHtml(state.groupActiveName || 'este grupo')}`
                : 'Crea una agrupacion de clientes'
            }</h3>
            <small>${
              state.groupModalMode === 'add-members'
                ? `${state.selectedContactIds.size} contacto(s) listos para agregar a este grupo.`
                : `${state.selectedContactIds.size} contacto(s) seleccionados desde la vista Contactos.`
            }</small>
          </div>
          <button class="modal-close" id="close-group-create-modal" type="button">Cerrar</button>
        </div>

        <form id="contact-group-form" class="modal-form">
          ${
            state.groupModalMode === 'create'
              ? `
                <label>
                  <span>Nombre del grupo</span>
                  <input
                    name="name"
                    value="${escapeHtml(state.groupCreateForm.name)}"
                    placeholder="Clientes VIP agosto"
                    required
                  />
                </label>
                <label>
                  <span>Descripcion</span>
                  <input
                    name="description"
                    value="${escapeHtml(state.groupCreateForm.description)}"
                    placeholder="Seguimiento para clientes con respuesta pendiente"
                  />
                </label>
                <label>
                  <span>Color</span>
                  <input name="color" type="color" value="${escapeHtml(state.groupCreateForm.color)}" />
                </label>
              `
              : ''
          }
          <div class="group-dual-panel">
            <div class="group-picker-panel">
              <strong>Todos los numeros disponibles</strong>
              <label class="group-picker-search">
                <span>Contacto con WhatsApp</span>
                <input
                  name="group-contact-query"
                  value="${escapeHtml(state.groupContactPickerForm.query)}"
                  placeholder="Escribe nombre, empresa o numero"
                  autocomplete="off"
                />
              </label>
              <div class="group-combobox">
                  ${
                    pickerOptions.length > 0
                      ? `
                        <div class="group-combobox-list group-dropzone" data-group-dropzone="available">
                          ${pickerOptions
                            .map(
                              (contact) => `
                                <button
                                  class="group-combobox-option group-drag-card"
                                  data-group-contact-option="${contact.id}"
                                  data-group-drag-contact="${contact.id}"
                                  data-group-drag-source="available"
                                  draggable="true"
                                  type="button"
                                >
                                  <strong>${escapeHtml(contact.name)}</strong>
                                  <small>${escapeHtml(`${contact.company} · ${getWhatsAppReference(contact)}`)}</small>
                                </button>
                              `,
                            )
                            .join('')}
                        </div>
                      `
                      : state.groupContactPickerForm.query.trim()
                        ? `<div class="group-combobox-empty group-dropzone" data-group-dropzone="available">No hay coincidencias con ese criterio.</div>`
                        : ''
                  }
                </div>
            </div>
            <div class="group-selected-panel group-dropzone" data-group-dropzone="selected">
              <strong>Numeros que entraran al grupo</strong>
            ${
              selectedContacts.length > 0
                ? `
                  <div class="group-selected-list">
                    ${selectedContacts
                      .map(
                        (contact) => `
                          <div
                            class="group-selected-item group-drag-card"
                            data-group-drag-contact="${contact.id}"
                            data-group-drag-source="selected"
                            draggable="true"
                          >
                            <div>
                              <span>${escapeHtml(contact.name)}</span>
                              <small>${escapeHtml(contact.company)} · ${escapeHtml(getWhatsAppReference(contact) || 'Sin WhatsApp')}</small>
                            </div>
                          </div>
                        `,
                      )
                      .join('')}
                  </div>
                `
                : `
                  <div class="empty-state group-selected-empty">
                    Aun no agregaste contactos al grupo. Seleccionalos desde la columna izquierda.
                  </div>
                `
            }
          </div>
          ${
            state.groupCreateError
              ? `<div class="form-error">${escapeHtml(state.groupCreateError)}</div>`
              : ''
          }
          <div class="modal-actions">
            <button class="secondary-btn" id="cancel-group-create" type="button">Cancelar</button>
            <button class="primary-btn" type="submit" ${state.groupCreateState === 'submitting' ? 'disabled' : ''}>
              ${
                state.groupCreateState === 'submitting'
                  ? state.groupModalMode === 'add-members'
                    ? 'Agregando...'
                    : 'Creando...'
                  : state.groupModalMode === 'add-members'
                    ? 'Agregar al grupo'
                    : 'Crear grupo con seleccion'
              }
            </button>
          </div>
        </form>
      </div>
    </div>
  `
}



