// @ts-nocheck

export const renderLoginScreen = (ctx: any) => {
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
  <div class="login-shell">
    <div class="login-card">
      <div class="login-brand">
        <div class="login-brand-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none">
            <path d="M4 8.5h16v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5v-9Z" stroke="currentColor" stroke-width="1.8"/>
            <path d="M4 9l8 5 8-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M8 6.5V5A1 1 0 0 1 9 4h6a1 1 0 0 1 1 1v1.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
          </svg>
        </div>
        <h1>CORREOS DE BOLIVIA</h1>
        <p>Agencia Boliviana de Correos - CRM Postal</p>
      </div>

      <form id="login-form" class="login-form">
        ${
          state.loginError
            ? `<div class="login-error">${escapeHtml(state.loginError)}</div>`
            : ''
        }

        <label class="login-field">
          <span>Correo o usuario</span>
          <div class="input-with-icon">
            <span aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <path d="M4 7.5A1.5 1.5 0 0 1 5.5 6h13A1.5 1.5 0 0 1 20 7.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 16.5v-9Z" stroke="currentColor" stroke-width="1.7"/>
                <path d="m5 8 7 5 7-5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </span>
            <input
              name="email"
              type="text"
              value="${escapeHtml(state.loginForm.email)}"
              placeholder="usuario@correos.gob.bo o admin"
              required
            />
          </div>
        </label>

        <label class="login-field">
          <span>Contraseña de acceso</span>
          <div class="input-with-icon">
            <span aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <path d="M7.5 10V8.25a4.5 4.5 0 1 1 9 0V10" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
                <rect x="5" y="10" width="14" height="10" rx="2" stroke="currentColor" stroke-width="1.7"/>
              </svg>
            </span>
            <input
              name="password"
              type="${state.showPassword ? 'text' : 'password'}"
              value="${escapeHtml(state.loginForm.password)}"
              placeholder="••••••••"
              required
            />
            <button
              class="password-toggle"
              id="password-toggle"
              type="button"
              aria-label="${state.showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}"
              title="${state.showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}"
            >
              ${
                state.showPassword
                  ? `
                    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M3 3l18 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                      <path d="M10.58 10.58A2 2 0 0 0 12 14a2 2 0 0 0 1.42-.58" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                      <path d="M9.88 5.09A10.94 10.94 0 0 1 12 4.9c5.05 0 9.27 3.11 10.5 7.1a11.38 11.38 0 0 1-3.04 4.62" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                      <path d="M6.23 6.23A11.55 11.55 0 0 0 1.5 12c.68 2.2 2.29 4.17 4.48 5.52A10.76 10.76 0 0 0 12 19.1c1.09 0 2.14-.16 3.13-.46" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                    </svg>
                  `
                  : `
                    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M1.5 12S5 4.9 12 4.9 22.5 12 22.5 12 19 19.1 12 19.1 1.5 12 1.5 12Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
                      <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.8"/>
                    </svg>
                  `
              }
            </button>
          </div>
        </label>

        <label class="login-checkbox">
          <input name="remember" type="checkbox" ${state.loginForm.remember ? 'checked' : ''} />
          <span>Recordar sesion en este equipo</span>
        </label>

        <button class="login-submit" type="submit" ${state.loginState === 'submitting' ? 'disabled' : ''}>
          ${state.loginState === 'submitting' ? 'Ingresando...' : 'INGRESAR AL SISTEMA'}
        </button>


      </form>
    </div>
  </div>
`

}


