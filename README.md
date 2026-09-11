<div align="center">
  <img src="public/brand-mark.svg" width="112" height="112" alt="Logo de Colección Web PDF">

  # Colección Web PDF

  **Reúne páginas, secciones y estados de una web en un único PDF visual.**

  Manifest V3 · WXT · React · TypeScript · Chrome · Opera GX
</div>

## Qué hace

Colección Web PDF conserva el estado actual de una página con imágenes, estilos, fondos, enlaces y texto seleccionable. Cada ruta, filtro, pestaña o estado SPA se añade manualmente como una vista independiente, incluso cuando varias vistas comparten la misma URL.

- Captura una web completa o múltiples secciones.
- Prepara imágenes y contenido lazy-load con auto-scroll acotado.
- Restaura el scroll y limpia la superficie temporal después de capturar.
- Guarda un PDF visual y una versión semántica para lectura por IA.
- Permite previsualizar, renombrar, reordenar, eliminar y volver a exportar.
- Genera portada, índice, separadores, URL y fecha de captura.
- Mantiene el contenido web, las imágenes, las colecciones y los PDF en el dispositivo.

## Planes y límites

| Plan | Capturas | Precio |
| --- | --- | --- |
| Gratuito | 150 MB cada 15 días | USD 0 |
| Premium | Sin cuota remota de captura | USD 2,49 al mes |

Cada colección conserva un límite local de 300 MB y no tiene límite de vistas. Exportar de nuevo una captura existente no consume cuota.

La primera contribución de USD 4 o más incluye tres meses de Premium, una sola vez por cuenta. Las contribuciones posteriores apoyan el proyecto sin añadir meses. La suscripción y los aportes se procesan en PayPal; la extensión nunca recibe datos de tarjeta.

Al cancelar una suscripción se detiene la siguiente renovación y el acceso se conserva hasta terminar el período ya pagado. Un reembolso o reverso revoca el tiempo restante asociado a ese pago.

## Flujo de captura seguro

1. La extensión genera localmente el PDF visual y el documento semántico.
2. Calcula sus bytes reales y valida el límite local de la colección.
3. Reserva exactamente esos bytes en la cuenta con una operación idempotente.
4. Guarda ambos artefactos en IndexedDB como una sola captura pendiente.
5. Confirma la reserva y habilita la vista para previsualizar y exportar.

Una interrupción después del guardado no duplica el consumo: el administrador puede reconciliar la captura pendiente. Borrar datos locales o reinstalar la extensión no reinicia el ciclo de la cuenta.

## Privacidad

El HTML capturado, las imágenes, las URL, los títulos, los documentos semánticos y los PDF no se envían al backend. Supabase recibe únicamente los datos necesarios para cuenta y control de acceso: identificador de usuario, correo de autenticación, cantidad exacta de bytes, fechas del ciclo, reservas y estado de pago.

No hay telemetría ni carga de código remoto. El permiso `debugger` se utiliza exclusivamente para solicitar a Chromium el PDF visual de la pestaña elegida por el usuario.

## Desarrollo de la extensión

### Requisitos

- Node.js 22 o posterior.
- npm.
- Chrome, Opera GX o Chromium para las pruebas E2E.

```powershell
git clone https://github.com/Suggus1899/page_to_pdf.git
cd page_to_pdf
npm install
Copy-Item .env.example .env
npm run build
```

Configura en `.env` únicamente los valores públicos del cliente:

```dotenv
WXT_SUPABASE_URL=https://TU_PROYECTO.supabase.co
WXT_SUPABASE_PUBLISHABLE_KEY=sb_publishable_REEMPLAZAR
```

El build queda en `.output/chrome-mv3`. Cárgalo como extensión descomprimida desde `chrome://extensions` u `opera://extensions` con el modo desarrollador activado.

## Backend de cuenta y pagos

El directorio `supabase/` contiene la migración PostgreSQL, las Edge Functions y una prueba de base de datos. Se requieren un proyecto Supabase y una cuenta PayPal Business.

```powershell
npx supabase login
npx supabase link --project-ref TU_PROJECT_REF
npx supabase db push
npx supabase secrets set --env-file supabase/functions/.env
npx supabase functions deploy billing-api
npx supabase functions deploy paypal-webhook --no-verify-jwt
```

Antes de desplegar:

1. Activa la confirmación de correo en Supabase Auth y configura una URL pública de redirección.
2. Crea en PayPal un producto y un plan mensual de USD 2,49.
3. Registra la URL pública de `paypal-webhook` y guarda su Webhook ID.
4. Copia `supabase/functions/.env.example` a `supabase/functions/.env` y completa los secretos localmente.
5. Configura páginas HTTPS públicas de retorno y cancelación para PayPal.

Nunca incluyas `SUPABASE_SERVICE_ROLE_KEY`, `PAYPAL_CLIENT_SECRET` ni otros secretos del servidor en las variables `WXT_*` o en el paquete de la extensión.

## Comandos

```powershell
npm run dev
npm run typecheck
npm run lint
npm test
npm run build
npm run verify
npm run test:e2e
```

Con Supabase CLI instalado, la política de cuota se valida con:

```powershell
npx supabase test db
```

## Arquitectura

```text
entrypoints/
  background.ts        Captura, cuota, persistencia y mensajes de cuenta
  capture.ts           Runtime aislado que se inyecta en la página
  popup/               Captura rápida, cuenta y ajustes
  manager/             Colecciones, exportación y facturación
src/
  account/             Sesión Supabase, cuota y UI de cuenta
  capture/             Auto-scroll, extracción y selector visual
  pdf/                 Adaptador Chromium para Page.printToPDF
  export/              Generadores visual y semántico
  storage/             IndexedDB y reconciliación local
  domain/              Tipos y límite local de 300 MB
supabase/
  migrations/          Esquema, RLS y operaciones atómicas
  functions/           Checkout PayPal y webhook verificado
  tests/               Pruebas SQL de cuota e idempotencia
```

La extensión usa una clave pública de Supabase y conserva la sesión en `storage.local`, restringida a contextos de confianza. Toda mutación de cuota ocurre en funciones SQL atómicas; solo un webhook PayPal verificado puede conceder o revocar Premium.

## Compatibilidad y límites conocidos

El mismo build Chromium MV3 se usa en Chrome y Opera GX. No pueden capturarse páginas internas del navegador, Chrome Web Store, visores PDF protegidos, iframes de otro origen, shadow roots cerrados ni contenido DRM. Videos, animaciones y controles interactivos se representan por el estado estático que Chromium pueda imprimir.

Sin conexión se pueden consultar y exportar capturas listas, pero no crear nuevas porque la cuota no puede verificarse. Una extensión desempaquetada y modificada por el usuario no puede considerarse un cliente confiable; la protección comercial efectiva corresponde al paquete oficial distribuido.

## Estado del proyecto

El repositorio es público y la extensión está en desarrollo. Las capturas existentes anteriores al sistema de cuenta permanecen locales, exportables y no consumen cuota retroactiva.
