// @ts-nocheck

const messageGroups = [
  {
    title: 'Tarifas y cotizaciones',
    description: 'Respuestas para solicitar datos, informar coberturas y devolver cotizaciones.',
    messages: [
      ['Datos faltantes', 'Para darte la tarifa exacta de tu envío, ayúdame con el peso del paquete y el servicio que buscas.'],
      ['Delivery Express · modalidad', 'Perfecto, Delivery Express. Para darte el precio exacto, indícame la modalidad.'],
      ['Provincia no disponible', 'Delivery Express no aplica para envíos a provincia o comunidades. Para ese destino corresponde EMS Nacional.'],
      ['Peso excedido', 'Delivery Express solo aplica para paquetes de hasta {maxWeightKg} kg.'],
      ['Varios envíos', 'Puedo ayudarte a cotizar varios envíos, pero necesito tener origen, destino, peso y servicio de cada uno.'],
      ['Sin tarifa activa', 'No encontré una tarifa activa para esa combinación de peso, destino y servicio.'],
    ],
  },
  {
    title: 'Mensajes personalizados de Delivery Express',
    description: 'Respuestas adaptadas según la modalidad elegida por el cliente.',
    messages: [
      ['Puerta a puerta', 'Claro, para ese caso te conviene Delivery Express puerta a puerta: recogemos el paquete en tu casa y lo entregamos en el domicilio destino.'],
      ['Puerta a ventanilla', 'Perfecto, con Delivery Express puerta a ventanilla recogemos el paquete en tu casa y lo dejamos disponible en una sucursal destino.'],
      ['Ventanilla a ventanilla', 'Perfecto, con Delivery Express ventanilla a ventanilla dejas el paquete en una sucursal y lo recogen en una sucursal destino.'],
    ],
  },
  {
    title: 'Seguimiento de paquetes',
    description: 'Mensajes utilizados cuando el cliente consulta una guía.',
    messages: [
      ['Falta la guía', '¡Perfecto! Déjame tu número de guía y lo revisamos de inmediato.'],
      ['Paquete no encontrado', 'No pude localizar el paquete {packageCode}. Verifica el código e inténtalo nuevamente, por favor.'],
      ['Resumen encontrado', 'Tu paquete {packageCode} figura como {status}. Último evento: {latestEvent}.'],
    ],
  },
]

export const renderCustomMessagesView = ({ escapeHtml, state }: any) => `
  <section class="section-panel is-visible custom-messages-panel">
    <div class="section-head">
      <div>
        <p class="section-kicker">Biblioteca de respuestas</p>
        <h2>Mensajes personalizados</h2>
        <p class="international-helper">Consulta los mensajes que el agente utiliza para contestar situaciones específicas.</p>
      </div>
      <span class="pronts-sandbox-pill">${messageGroups.reduce((total, group) => total + group.messages.length, 0)} mensajes configurados</span>
    </div>
    <div class="custom-messages-grid">
      ${messageGroups.map((group) => `
        <article class="group-module-card custom-message-group">
          <div class="group-module-head"><div><p class="section-kicker">${escapeHtml(group.title)}</p><small>${escapeHtml(group.description)}</small></div></div>
          <div class="custom-message-list">
            ${group.messages.map(([label, text]) => `
              <div class="custom-message-item">
                <strong>${escapeHtml(label)}</strong>
                <textarea class="custom-message-editable" rows="4">${escapeHtml(text)}</textarea>
              </div>`).join('')}
          </div>
        </article>`).join('')}
    </div>
  </section>
`
