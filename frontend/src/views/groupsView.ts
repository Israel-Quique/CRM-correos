// @ts-nocheck

export const renderGroupsView = (ctx: any) => {
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
  const groups = state.data?.contactGroups ?? []
  const selectedCount = state.selectedContactIds.size

  return `
    <section class="section-panel ${state.activeView === 'agrupaciones' ? 'is-visible' : ''}">
      <div class="section-head">
        <div>
          <p class="section-kicker">Agrupaciones</p>
          <h2>Organiza clientes y envia el mismo mensaje personalizado</h2>
        </div>
        <div class="section-actions">
          <button class="primary-btn" id="open-group-create-modal" type="button">+ Nuevo grupo</button>
        </div>
      </div>

      ${
        state.notice
          ? `<div class="notice-banner">${escapeHtml(state.notice)}</div>`
          : ''
      }

      <div class="group-module-card">
        <div class="group-module-head">
          <div>
            <p class="section-kicker">Agrupaciones</p>
            <h3>Gestiona grupos de clientes desde el sidebar</h3>
            <small>${selectedCount} contacto(s) seleccionado(s) en la tabla de Contactos.</small>
          </div>
        </div>

        ${
          groups.length > 0
            ? `
              <div class="table-card">
                <div class="table-toolbar">
                  <strong>${groups.length} grupo(s)</strong>
                  <span>Consulta los clientes agrupados y lanza acciones desde cada fila.</span>
                </div>
                <div class="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Grupo</th>
                        <th>Descripcion</th>
                        <th>Contactos agrupados</th>
                        <th>Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${groups
                        .map(
                          (group) => `
                            <tr>
                              <td data-label="Grupo">
                                <div class="group-table-cell">
                                  <div class="group-color-dot" style="background:${escapeHtml(group.color)}"></div>
                                  <div>
                                    <strong>${escapeHtml(group.name)}</strong>
                                    <span>${group.memberCount} miembro(s)</span>
                                  </div>
                                </div>
                              </td>
                              <td data-label="Descripcion">${escapeHtml(group.description || 'Sin descripcion')}</td>
                              <td data-label="Contactos">
                                ${
                                  group.members.length > 0
                                    ? `
                                      <div class="group-members-list">
                                        ${group.members
                                          .map(
                                            (member) => `
                                              <span class="group-member-chip">
                                                <span>${escapeHtml(member.name)} · ${escapeHtml(member.company)}</span>
                                                <button
                                                  class="group-member-remove"
                                                  data-remove-group-member="${group.id}:${member.id}"
                                                  type="button"
                                                  aria-label="Quitar a ${escapeHtml(member.name)} del grupo ${escapeHtml(group.name)}"
                                                >
                                                  Quitar
                                                </button>
                                              </span>
                                            `,
                                          )
                                          .join('')}
                                      </div>
                                    `
                                    : '<span class="empty-inline">Sin contactos</span>'
                                }
                              </td>
                              <td data-label="Acciones">
                                <div class="group-card-actions">
                                  <button class="secondary-btn" data-open-add-members-group="${group.id}" type="button">
                                    Agregar miembros
                                  </button>
                                  <button class="primary-btn" data-send-group="${group.id}" type="button">
                                    Enviar WhatsApp
                                  </button>
                                </div>
                              </td>
                            </tr>
                          `,
                        )
                        .join('')}
                    </tbody>
                  </table>
                </div>
              </div>
            `
            : `
              <div class="empty-state">
                Aun no creaste grupos. Selecciona contactos en la vista Contactos y usa el boton superior para abrir el formulario.
              </div>
            `
        }
      </div>
    </section>
  `
}



