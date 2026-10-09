// @ts-nocheck

export const renderLoginScreen = (ctx: any) => {
  const {
    state,
    escapeHtml,
  } = ctx

  return `
    <div class="login-split-shell">
      <!-- PANEL IZQUIERDO (MOSTAZA / DORADO - CORREOS DE BOLIVIA) -->
      <section class="login-left-panel">
        
        <!-- Collage Visual de Estampillas, Dron y Carruaje al borde derecho -->
        <div class="login-hero-art-wrap" aria-hidden="true">
          <img
            src="/images/login/login-hero-collage.png"
            alt="Correos de Bolivia - Estampillas y Logística"
            class="login-hero-art-img"
          />
        </div>

        <div class="login-left-content">
          <!-- Header de Marca -->
          <div class="login-brand-header">
            <div class="login-brand-tag">CRM</div>
            <span class="login-brand-name">LiveCRM</span>
          </div>

          <!-- Hero Textos -->
          <div class="login-hero-block">
            <div class="login-category-pill">
              <span class="pill-dot-bullet">•</span>
              <span>Plataforma de Ventas</span>
            </div>
            <h1 class="login-main-title">CORREOS DE BOLIVIA</h1>
            <p class="login-main-subtitle">CRM postal para ventas, contactos, WhatsApp y seguimiento operativo en tiempo real.</p>
          </div>

          <!-- Lista de Características / Beneficios -->
          <ul class="login-benefits-list">
            <li>
              <span class="benefit-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="3"></rect>
                  <line x1="7" y1="8" x2="17" y2="8"></line>
                  <line x1="7" y1="12" x2="17" y2="12"></line>
                  <line x1="7" y1="16" x2="13" y2="16"></line>
                </svg>
              </span>
              <span>Pipeline Kanban interactivo</span>
            </li>
            <li>
              <span class="benefit-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                </svg>
              </span>
              <span>Historial conversacional unificado</span>
            </li>
            <li>
              <span class="benefit-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
                </svg>
              </span>
              <span>Chatbot WhatsApp y seguimiento</span>
            </li>
            <li>
              <span class="benefit-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="16.5" y1="9.4" x2="7.5" y2="4.21"></line>
                  <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                  <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
                  <line x1="12" y1="22.08" x2="12" y2="12"></line>
                </svg>
              </span>
              <span>Rastreo Internacional y Nacional</span>
            </li>
          </ul>
        </div>
      </section>

      <!-- PANEL DERECHO (FONDO CLARO CON MARCAS DE AGUA Y TARJETA FLOTANTE) -->
      <section class="login-right-panel">
        
        <!-- Marcas de Agua / Matasellos Postales Decorativos -->
        <div class="postal-watermark top-right" aria-hidden="true">
          <svg viewBox="0 0 200 200" fill="none" stroke="currentColor" stroke-width="1.2">
            <!-- Sello Circular 12 DE BMITT -->
            <circle cx="100" cy="100" r="70" stroke-dasharray="4 3"/>
            <circle cx="100" cy="100" r="60"/>
            <path d="M45 100h110M100 45v110" stroke-width="0.8"/>
            <text x="100" y="85" text-anchor="middle" font-size="10" font-family="sans-serif" font-weight="700" fill="currentColor">12 DE</text>
            <text x="100" y="100" text-anchor="middle" font-size="9" font-family="sans-serif" font-weight="700" fill="currentColor">BMITT</text>
            <text x="100" y="125" text-anchor="middle" font-size="11" font-family="sans-serif" font-weight="800" fill="currentColor">BOLIVIA</text>
            <!-- Líneas onduladas de matasellos -->
            <path d="M150 70c20-10 30 10 50 0M150 85c20-10 30 10 50 0M150 100c20-10 30 10 50 0M150 115c20-10 30 10 50 0" stroke-width="1.2"/>
          </svg>
        </div>

        <div class="postal-watermark bottom-right" aria-hidden="true">
          <svg viewBox="0 0 220 220" fill="none" stroke="currentColor" stroke-width="1.2">
            <circle cx="110" cy="110" r="85" stroke-dasharray="5 3"/>
            <circle cx="110" cy="110" r="75"/>
            <text x="110" y="70" text-anchor="middle" font-size="11" font-family="sans-serif" font-weight="800" fill="currentColor">CORREOS DE</text>
            <text x="110" y="165" text-anchor="middle" font-size="11" font-family="sans-serif" font-weight="800" fill="currentColor">BOLIVIA</text>
            <!-- Icono sobre postal -->
            <rect x="85" y="95" width="50" height="35" rx="3" stroke-width="1.5"/>
            <path d="M85 97l25 18 25-18" stroke-width="1.5"/>
            <!-- Ondas laterales -->
            <path d="M170 95c15-8 25 8 40 0M170 110c15-8 25 8 40 0M170 125c15-8 25 8 40 0" stroke-width="1.2"/>
          </svg>
        </div>

        <!-- Tarjeta de Login Flotante -->
        <div class="login-card-box">
          <div class="login-card-head">
            <h2 class="login-title">Iniciar sesión CRM</h2>
            <p class="login-subtitle">Ingresa con tus credenciales para gestionar el CRM</p>
          </div>

          <form id="login-form" class="login-fields-form">
            ${state.loginError ? `
              <div class="login-alert-banner" role="alert">
                ${escapeHtml(state.loginError)}
              </div>
            ` : ''}

            <!-- Campo 1: Usuario / Email -->
            <div class="login-input-group">
              <label class="login-field-lbl" for="login-email">CORREO O USUARIO</label>
              <div class="login-field-box">
                <span class="login-field-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="#94A3B8" stroke-width="1.8">
                    <path d="M4 7.5A1.5 1.5 0 0 1 5.5 6h13A1.5 1.5 0 0 1 20 7.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 16.5v-9Z"/>
                    <path d="m5 8 7 5 7-5" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                </span>
                <input
                  id="login-email"
                  name="email"
                  type="text"
                  value="${escapeHtml(state.loginForm.email)}"
                  placeholder="admin"
                  required
                  class="login-text-input"
                  autocomplete="username"
                />
              </div>
            </div>

            <!-- Campo 2: Contraseña -->
            <div class="login-input-group">
              <div class="login-lbl-split">
                <label class="login-field-lbl" for="login-password">CONTRASEÑA</label>
                <a href="#" class="login-forgot-pw" onclick="event.preventDefault();">¿Olvidaste tu contraseña?</a>
              </div>
              <div class="login-field-box">
                <span class="login-field-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="#94A3B8" stroke-width="1.8">
                    <path d="M7.5 10V8.25a4.5 4.5 0 1 1 9 0V10" stroke-linecap="round"/>
                    <rect x="5" y="10" width="14" height="10" rx="2"/>
                  </svg>
                </span>
                <input
                  id="login-password"
                  name="password"
                  type="${state.showPassword ? 'text' : 'password'}"
                  value="${escapeHtml(state.loginForm.password)}"
                  placeholder="••••••••"
                  required
                  class="login-text-input"
                  autocomplete="current-password"
                />
                <button
                  class="login-pw-toggle"
                  id="password-toggle"
                  type="button"
                  aria-label="${state.showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}"
                  title="${state.showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}"
                >
                  ${
                    state.showPassword
                      ? `
                        <svg viewBox="0 0 24 24" fill="none" stroke="#94A3B8" stroke-width="1.8">
                          <path d="M3 3l18 18" stroke-linecap="round"/>
                          <path d="M10.58 10.58A2 2 0 0 0 12 14a2 2 0 0 0 1.42-.58" stroke-linecap="round"/>
                          <path d="M9.88 5.09A10.94 10.94 0 0 1 12 4.9c5.05 0 9.27 3.11 10.5 7.1a11.38 11.38 0 0 1-3.04 4.62" stroke-linecap="round"/>
                          <path d="M6.23 6.23A11.55 11.55 0 0 0 1.5 12c.68 2.2 2.29 4.17 4.48 5.52A10.76 10.76 0 0 0 12 19.1c1.09 0 2.14-.16 3.13-.46" stroke-linecap="round"/>
                        </svg>
                      `
                      : `
                        <svg viewBox="0 0 24 24" fill="none" stroke="#94A3B8" stroke-width="1.8">
                          <path d="M1.5 12S5 4.9 12 4.9 22.5 12 22.5 12 19 19.1 12 19.1 1.5 12 1.5 12Z"/>
                          <circle cx="12" cy="12" r="3"/>
                        </svg>
                      `
                  }
                </button>
              </div>
            </div>

            <!-- Opciones: Recordar sesión y SSO -->
            <div class="login-meta-row">
              <label class="login-remember-lbl">
                <input name="remember" type="checkbox" ${state.loginForm.remember ? 'checked' : ''} />
                <span>Mantener la sesión iniciada</span>
              </label>
              <span class="login-sso-txt">SSO Habilitado</span>
            </div>

            <!-- Botón Dorado de Ingreso -->
            <button class="login-gold-btn" type="submit" ${state.loginState === 'submitting' ? 'disabled' : ''}>
              <span>${state.loginState === 'submitting' ? 'Ingresando...' : 'Ingresar al Workspace CRM'}</span>
              <span class="login-btn-arrow" aria-hidden="true">➔</span>
            </button>
          </form>

          <!-- Pie de la Tarjeta -->
          <div class="login-card-foot">
            <p>LiveCRM System © 2026. Todos los derechos reservados.</p>
            <span class="login-foot-ver">v5.2</span>
          </div>
        </div>

      </section>
    </div>
  `
}
