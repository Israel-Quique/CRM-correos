// @ts-nocheck

import { getDeclaredDestinationEntries, getSafeDeclaredDepartment } from '../utils/declaredDestination'

export const renderTrackingInfoModal = (ctx: any) => {
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
  if (!state.selectedTrackingApiPackage) {
    return ''
  }

  const selectedPackage = state.selectedTrackingApiPackage
  const origin = selectedPackage.origen ?? {}
  const destination = selectedPackage.destino ?? {}
  const originLabel = renderCountryWithFlag(
    origin.nombre || origin.codigo || 'Sin origen',
    origin.codigo,
  )
  const destinationLabel = renderCountryWithFlag(
    destination.nombre || destination.codigo || 'Sin destino',
    destination.codigo,
  )
  const events = Array.isArray(selectedPackage.eventos) ? selectedPackage.eventos : []
  const declaration = selectedPackage.declaracion_cds
  const declarationStateLabels: Record<string, string> = {
    declarada: 'Declaración registrada',
    objeto_sin_declaracion: 'Objeto sin declaración',
    sin_objeto_cds: 'Sin objeto CDS asociado',
    consulta_incompleta: 'Consulta incompleta',
  }
  const declarationState = declaration?.estado
  const declarationLabel =
    declarationStateLabels[declarationState] ||
    (declarationState ? `Estado: ${declarationState}` : 'Estado de declaración no informado')
  const declarationObjects = Array.isArray(declaration?.objetos) ? declaration.objetos : []
  const declarations = declarationObjects.flatMap((object: any) => object.declaraciones ?? [])
  const declaredDestinations = getDeclaredDestinationEntries(selectedPackage.destinos_declarados, declarations)
  const renderDeclaredDestination = (destination: Record<string, any> | null | undefined) => {
    if (!destination || typeof destination !== 'object') {
      return ''
    }

    const destinationParts = [
      ['Departamento', getSafeDeclaredDepartment(destination.departamento)],
      ['Ciudad', destination.ciudad],
      ['Código postal', destination.codigo_postal],
      ['País', destination.pais_codigo],
    ].filter(([, value]) => String(value ?? '').trim())

    if (destinationParts.length === 0) {
      return ''
    }

    return `
      <div class="tracking-declaration-destination">
        <strong>Destino declarado</strong>
        <span>${destinationParts.map(([label, value]) => `${escapeHtml(label)}: ${escapeHtml(String(value))}`).join(' · ')}</span>
      </div>
    `
  }
  const renderDeclarationFields = (fields: Record<string, string> = {}) => {
    const entries =
      fields && typeof fields === 'object'
        ? Object.entries(fields).filter(([label, value]) => {
            const normalizedLabel = label.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
            if (normalizedLabel === 'rsta' && !getSafeDeclaredDepartment(value)) return false
            return String(value ?? '').trim()
          })
        : []
    if (entries.length === 0) return '<div class="empty-inline">Sin campos declarados.</div>'

    return `
      <dl class="tracking-declaration-fields">
        ${entries
          .map(
            ([label, value]) => `
              <div>
                <dt>${escapeHtml(label)}</dt>
                <dd>${escapeHtml(value)}</dd>
              </div>
            `,
          )
          .join('')}
      </dl>
    `
  }
  const renderDeclarationDetails = () => {
    if (!declaration) {
      return '<div class="empty-inline">La API no incluyó datos de declaración para este paquete.</div>'
    }
    if (declarationObjects.length === 0) {
      return '<div class="empty-inline">La respuesta no contiene objetos CDS asociados.</div>'
    }

    const declaredDestinationSummary =
      declaredDestinations.length > 0
        ? `
          <div class="tracking-declaration-summary">
            <strong>Destinos declarados</strong>
            ${declaredDestinations
              .map(
                (destination: any) =>
                  `<span>${escapeHtml([getSafeDeclaredDepartment(destination.departamento), destination.ciudad].filter(Boolean).join(' · ') || destination.codigo_objeto || 'Destino sin detalle')}</span>`,
              )
              .join('')}
          </div>
        `
        : ''

    return `
      ${declaredDestinationSummary}
      ${declarationObjects
        .map(
          (rawObject: any, objectIndex: number) => {
            const object = rawObject && typeof rawObject === 'object' ? rawObject : {}
            return `
            <article class="tracking-declaration-object">
              <strong>Objeto ${escapeHtml(object.codigo || object.id_objeto_cds || objectIndex + 1)}</strong>
              <span>Estado: ${escapeHtml(object.estado_objeto || 'Sin estado')}</span>
              ${
                object.identificador_local || object.identificador_local_2
                  ? `<span>Identificador: ${escapeHtml([object.identificador_local, object.identificador_local_2].filter(Boolean).join(' · '))}</span>`
                  : ''
              }
              ${
                Array.isArray(object.declaraciones) && object.declaraciones.length > 0
                  ? object.declaraciones
                      .map(
                        (rawDeclaration: any, declarationIndex: number) => {
                          const item = rawDeclaration && typeof rawDeclaration === 'object' ? rawDeclaration : {}
                          return `
                          <section class="tracking-declaration-entry">
                            <h5>Declaración ${escapeHtml(item.numero || item.id || declarationIndex + 1)}</h5>
                            <span>Estado: ${escapeHtml(item.estado || 'Sin estado')} · Etapa: ${escapeHtml(item.etapa || 'Sin etapa')}</span>
                            ${renderDeclaredDestination(getDeclaredDestinationEntries([], [item])[0])}
                            ${
                              item.resumen_contenido
                                ? `<p>${escapeHtml(item.resumen_contenido)}</p>`
                                : ''
                            }
                            <span>Artículos: ${escapeHtml(item.cantidad_articulos ?? item.articulos?.length ?? 0)} · Documentos: ${escapeHtml(item.cantidad_documentos ?? item.documentos?.length ?? 0)}</span>
                            ${renderDeclarationFields(item.campos)}
                            ${
                              Array.isArray(item.articulos) && item.articulos.length > 0
                                ? `
                                  <div class="tracking-declaration-subsection">
                                    <strong>Artículos declarados</strong>
                                    ${item.articulos
                                      .map(
                                        (article: Record<string, string>) =>
                                          renderDeclarationFields(article),
                                      )
                                      .join('')}
                                  </div>
                                `
                                : ''
                            }
                            ${
                              Array.isArray(item.documentos) && item.documentos.length > 0
                                ? `
                                  <div class="tracking-declaration-subsection">
                                    <strong>Documentos</strong>
                                    ${item.documentos
                                      .map(
                                        (rawDocument: any) => {
                                          const document = rawDocument && typeof rawDocument === 'object' ? rawDocument : {}
                                          return `
                                          <div class="tracking-declaration-document">
                                            <strong>${escapeHtml(document.type || 'Documento')}</strong>
                                            ${renderDeclarationFields(document.fields)}
                                          </div>
                                        `
                                        },
                                      )
                                      .join('')}
                                  </div>
                                `
                                : ''
                            }
                          </section>
                        `
                        },
                      )
                      .join('')
                  : '<div class="empty-inline">El objeto no contiene declaraciones registradas.</div>'
              }
            </article>
          `
          },
        )
        .join('')}
    `
  }

  return `
    <div class="modal-backdrop" id="tracking-info-modal-backdrop">
      <div class="modal-card modal-card-profile tracking-info-modal">
        <div class="modal-header">
          <div>
            <p class="section-kicker">Información del paquete</p>
            <h3>${escapeHtml(selectedPackage.codigo_s10 || selectedPackage.codigo || 'Sin código')}</h3>
            <small class="conversation-subtitle">Detalle del paquete, declaración aduanera y eventos.</small>
          </div>
          <button class="modal-close" id="close-tracking-info-modal" type="button">Cerrar</button>
        </div>

        <div class="tracking-info-layout">
          <div class="tracking-info-details">
            <div class="profile-modal-hero">
              <div class="conversation-contact-avatar conversation-contact-avatar-xl">
                ${escapeHtml((selectedPackage.codigo_s10 || selectedPackage.codigo || '?').slice(0, 1))}
              </div>
              <div class="profile-modal-copy">
                <strong>${escapeHtml(selectedPackage.tipo_servicio || selectedPackage.clase_correo || 'Sin servicio')}</strong>
                <span>${escapeHtml(selectedPackage.fecha_registro || 'Sin fecha')}</span>
              </div>
              <span class="ems-chat-status is-active">
                ${escapeHtml(selectedPackage.estado_postal || 'Sin estado')}
              </span>
            </div>

            <div class="ems-meta-row profile-modal-grid">
              <div class="ems-meta-card">
                <span>Código origen</span>
                <strong>${escapeHtml(origin.codigo || 'Sin código')}</strong>
              </div>
              <div class="ems-meta-card">
                <span>Código destino</span>
                <strong>${escapeHtml(destination.codigo || 'Sin código')}</strong>
              </div>
              <div class="ems-meta-card">
                <span>Origen</span>
                <strong>${originLabel}</strong>
              </div>
              <div class="ems-meta-card">
                <span>Destino</span>
                <strong>${destinationLabel}</strong>
              </div>
              <div class="ems-meta-card">
                <span>Peso</span>
                <strong>${escapeHtml(selectedPackage.peso == null ? '—' : `${selectedPackage.peso} Kg`)}</strong>
              </div>
              <div class="ems-meta-card">
                <span>Teléfono origen</span>
                <strong>${escapeHtml(getTrackingOriginPhoneValue(selectedPackage))}</strong>
              </div>
              <div class="ems-meta-card">
                <span>Teléfono destino</span>
                <strong>${escapeHtml(getTrackingDestinationPhoneValue(selectedPackage))}</strong>
              </div>
              <div class="ems-meta-card">
                <span>Declaración CDS</span>
                <strong>${escapeHtml(declarationLabel)}</strong>
              </div>
            </div>
          </div>

          <div class="tracking-info-content">
            <div class="tracking-info-section">
              <h4>Declaración aduanera</h4>
              <div class="tracking-declaration-status">
                <strong>${escapeHtml(declarationLabel)}</strong>
                ${
                  declaration
                    ? `<span>${declarationObjects.length} objeto(s) CDS · ${declaration.truncado ? 'resultado truncado' : 'resultado completo'}</span>`
                    : ''
                }
              </div>
              <div class="tracking-declaration-list">${renderDeclarationDetails()}</div>
            </div>

            <div class="tracking-info-section">
              <h4>Eventos</h4>
              ${
                events.length > 0
                  ? `
                    <div class="tracking-events-list">
                      ${events
                        .map(
                          (event) => `
                            <article class="tracking-event-card">
                              <strong>${escapeHtml(event.evento_api || event.evento_original || 'Evento')}</strong>
                              <span>${escapeHtml(event.fecha || 'Sin fecha')}</span>
                              <p>${escapeHtml([event.oficina, event.detalle, event.movimiento_bolivia].filter(Boolean).join(' · ') || 'Sin detalles')}</p>
                            </article>
                          `,
                        )
                        .join('')}
                    </div>
                  `
                  : '<div class="empty-inline">Este paquete no trae eventos registrados.</div>'
              }
            </div>
          </div>
        </div>
      </div>
    </div>
  `
}
