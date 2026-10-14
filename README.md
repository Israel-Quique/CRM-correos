# CRM Integrador

El proyecto está dividido en dos aplicaciones independientes:

```text
CRM/
  frontend/       # Vite + TypeScript: interfaz, vistas y modales
  backend/        # Express: API, autenticación, PostgreSQL y archivos
  public/         # Activos públicos del frontend (dentro de frontend/)
  .env            # Configuración compartida y secretos locales
  docker-compose.yml
```

## Desarrollo

Desde la carpeta `CRM`:

```bash
npm install
npm run dev
```

El frontend queda disponible en `http://localhost:5173` y la API en `http://localhost:3001`.

También se pueden ejecutar por separado:

```bash
npm --prefix frontend run dev
npm --prefix backend run dev
```

## Producción

```bash
npm run build
npm run start:server
```

El backend sirve el build generado en `frontend/dist`. Las credenciales y tokens deben mantenerse únicamente en `.env`, que no se versiona.

### Declaraciones CDS de SITRA

Tracking y CDS se consultan por separado para no bloquear los paquetes IPS cuando el permiso CDS no está disponible. El CRM solicita los paquetes por `/api/tracking/paquetes` con el token `TRACKING_SQLSERVER_TOKEN` y luego consulta `/api/tracking/cds/declaraciones` con `CDS_API_TOKEN`, que debe tener `cds.read`; `CDS_API_URL` puede apuntar al mismo origen o a un servicio CDS independiente. SITRA debe tener CDS habilitado. Si la consulta CDS falla, los paquetes de tracking siguen cargando y la respuesta indica que la declaración está incompleta/no consultada.

La API CDS acepta hasta 100 códigos por POST en `codes` y devuelve la declaración completa más `destino_declarado` (`departamento`, `ciudad`, código postal y país), derivado de los campos declarados `RSta`, `RCty`, `RZip` y `RCtr`. El campo `declaracion_cds` puede contener nombres, direcciones y artículos declarados. Protege el token y limita el acceso a los datos conforme a las reglas de la organización.