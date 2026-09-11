// @ts-nocheck

import { renderSidebar } from './sidebar'
import { renderWorkspace } from './workspace'
import {
  renderContactProfileModal,
  renderConversationModal,
  renderCreatePipelineColumnModal,
  renderCreateContactModal,
  renderEmsPackageDetailModal,
  renderCustomEmsStateModal,
  renderGroupCreateModal,
  renderGroupSendModal,
  renderPackageCodeLookupModal,
  renderEmsStatePackagesModal,
  renderSendMessageModal,
  renderTrackingInfoModal,
  renderUserModal,
} from '../modals'
export const renderAuthenticatedApp = (ctx: any) => {
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
  return `
  <div class="crm-shell">
    ${renderSidebar(ctx)}
    <div class="content-shell">
      <header class="topbar">
        <div class="topbar-center">
          <span>CRM comercial, marketing y automatizacion</span>
        </div>
        <div class="topbar-user">
          <button
            class="topbar-test-btn ${state.whatsappTestModeEnabled ? 'is-active' : 'is-inactive'}"
            id="header-whatsapp-test-toggle"
            type="button"
            aria-pressed="${state.whatsappTestModeEnabled ? 'true' : 'false'}"
            ${state.whatsappTestModeState === 'submitting' ? 'disabled' : ''}
            title="Activa el modo prueba para permitir envios solo al +59164229403 cuando aparezca en las APIs."
          >
            <span class="topbar-test-dot" aria-hidden="true"></span>
            <span class="topbar-test-copy">
              <strong>Prueba</strong>
              <small>${state.whatsappTestModeEnabled ? 'ON' : 'OFF'} · ${escapeHtml(formatBoliviaTestPhone(state.whatsappTestModeNumber))}</small>
            </span>
          </button>
          <button
            class="topbar-agent-btn ${state.globalAiAgentEnabled ? 'is-active' : ''}"
            id="header-ai-agent-toggle"
            type="button"
            aria-pressed="${state.globalAiAgentEnabled ? 'true' : 'false'}"
            title="Activar agente IA para todas las conversaciones"
          >
            <span class="topbar-agent-icon">${getRobotIcon()}</span>
            <span class="topbar-agent-copy">
              <strong>Agente IA</strong>
              <small>${state.globalAiAgentEnabled ? 'Activo' : 'Manual'}</small>
            </span>
          </button>
          <div class="topbar-chip">${state.data?.metrics.hotLeads ?? 0} leads calientes</div>
          <div class="topbar-profile-wrap ${state.topbarProfileOpen ? 'is-open' : ''}">
          <button
            class="topbar-profile-trigger"
            id="profile-toggle"
            type="button"
            aria-expanded="${state.topbarProfileOpen ? 'true' : 'false'}"
            aria-haspopup="menu"
          >
            <div class="topbar-user-main">
              <div class="user-badge">${escapeHtml(state.sessionUser?.fullName.slice(0, 1) ?? 'G')}</div>
              <div class="user-copy">
                <strong>${escapeHtml(state.sessionUser?.fullName ?? 'Gonzalo Fabris')}</strong>
                <span>${escapeHtml(state.sessionUser?.role ?? 'Administradores')}</span>
              </div>
            </div>
          </button>
          <div class="topbar-profile-menu" role="menu" aria-label="Perfil de usuario">
            <button
              class="logout-btn topbar-profile-logout"
              id="logout-button"
              type="button"
            >
              Salir
            </button>
          </div>
          </div>
        </div>
      </header>
      ${renderWorkspace(ctx)}
    </div>
  </div>
  ${
    state.messageNotifications.length > 0
      ? `
        <div class="message-notification-stack" aria-live="polite" aria-label="Nuevas notificaciones de mensajes">
          ${state.messageNotifications
            .map(
              (notification: any) => `
                <article class="message-notification-card">
                  <div class="message-notification-badge">Mensaje nuevo</div>
                  <strong>${escapeHtml(notification.contactName)}</strong>
                  <p>${escapeHtml(notification.preview)}</p>
                  <small>${escapeHtml(notification.timestamp || 'Sin hora registrada')}</small>
                  <div class="message-notification-actions">
                    <button class="message-notification-open" data-open-chat="${notification.contactId}" type="button">Ver chat</button>
                    <button class="message-notification-dismiss" data-dismiss-message-notification="${notification.id}" type="button">Cerrar</button>
                  </div>
                </article>
              `,
            )
            .join('')}
        </div>
      `
      : ''
  }
  ${renderCreateContactModal(ctx)}
  ${renderSendMessageModal(ctx)}
  ${state.isConversationModalOpen ? renderConversationModal(ctx) : ''}
  ${state.isContactProfileModalOpen ? renderContactProfileModal(ctx) : ''}
  ${renderTrackingInfoModal(ctx)}
  ${renderGroupCreateModal(ctx)}
  ${renderGroupSendModal(ctx)}
  ${renderUserModal(ctx)}
  ${renderPackageCodeLookupModal(ctx)}
  ${renderEmsPackageDetailModal(ctx)}
  ${renderEmsStatePackagesModal(ctx)}
  ${renderCustomEmsStateModal(ctx)}
  ${renderCreatePipelineColumnModal(ctx)}
`
}



