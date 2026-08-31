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