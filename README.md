<div align="center">
  <img src="public/brand-mark.svg" width="112" height="112" alt="Logo de Colección Web PDF">

  # Colección Web PDF

  **Captura páginas y estados de aplicaciones web como un único PDF visual, sin subir su contenido a un servidor.**

  Manifest V3 · WXT · React · TypeScript · Chrome · Opera GX
</div>

## Qué problema resuelve

Una web moderna puede repartir su contenido entre rutas, filtros, pestañas y estados SPA, incluso manteniendo la misma URL. Colección Web PDF permite guardar cada estado como una vista independiente, ordenarlas y exportarlas juntas.

La extensión no rastrea el sitio automáticamente: tú decides qué páginas o secciones forman parte del documento.

## Funciones actuales

- Captura visual de una página completa con imágenes, estilos, fondos, enlaces y texto seleccionable.
- Selección de múltiples secciones y exclusiones internas mediante una interfaz aislada con Shadow DOM.
- Preparación de contenido dinámico con auto-scroll acotado y restauración de la posición original.
- Colecciones persistentes sin límite de vistas y con un máximo local de 300 MB cada una.
- Capturas inmutables: dos estados distintos con la misma URL se conservan como elementos independientes.
- Administrador para renombrar, previsualizar, reordenar, eliminar y volver a exportar vistas.
- PDF visual con portada, índice, separadores, URL y fecha de captura.
- Versión secundaria para lectura por IA con encabezados, párrafos, tablas, listas, código, enlaces y metadatos.
- Interfaz en español preparada para internacionalización.

## Cómo funciona

1. Crea o elige una colección desde el popup.
2. Abre el estado de la web que quieras conservar.
3. Pulsa **Web completa** o **Secciones**.
4. Confirma la captura después de preparar el contenido dinámico.
5. Repite el proceso para otras rutas, filtros o estados.
6. Abre el administrador, ajusta el orden y exporta el PDF visual o la versión IA.

El PDF visual se genera con `Page.printToPDF` mediante la API `debugger` de Chromium. Si el permiso no está disponible, DevTools ya usa la pestaña o la navegación cambia durante el proceso, la captura se cancela sin guardar una vista parcial.

## Privacidad

El contenido capturado, los PDF y las colecciones se procesan y almacenan localmente en el navegador mediante IndexedDB. La versión actual no incluye telemetría, cuenta de usuario ni backend, y no solicita acceso permanente a todos los sitios con `<all_urls>`.

El permiso `debugger` se utiliza exclusivamente para pedir al navegador el PDF visual de la pestaña elegida por el usuario.

## Instalar para desarrollo

### Requisitos

- Node.js 22 o posterior.
- npm.
- Chrome u Opera GX.

```powershell
git clone https://github.com/Suggus1899/page_to_pdf.git
cd page_to_pdf
npm install
npm run build
```

El paquete Chromium queda en `.output/chrome-mv3`.

### Cargar en Chrome

1. Abre `chrome://extensions`.
2. Activa **Modo desarrollador**.
3. Pulsa **Cargar descomprimida**.
4. Selecciona la carpeta `.output/chrome-mv3`.

### Cargar en Opera GX

1. Abre `opera://extensions`.
2. Activa **Modo desarrollador**.
3. Pulsa **Cargar descomprimida**.
4. Selecciona la misma carpeta `.output/chrome-mv3`.

No se necesita un build diferente para Opera GX.

## Desarrollo

```powershell
npm run dev        # WXT en modo desarrollo
npm run typecheck  # TypeScript estricto
npm run lint       # ESLint
npm test           # Vitest
npm run build      # Build Chromium MV3
npm run verify     # Typecheck, lint, pruebas y build
```

Para ejecutar el E2E con un navegador instalado:

```powershell
$env:BROWSER_EXECUTABLE='C:\Program Files\Google\Chrome\Application\chrome.exe'
npm run test:e2e

$env:BROWSER_EXECUTABLE='C:\Users\PC\AppData\Local\Programs\Opera GX\opera.exe'
npm run test:e2e
```

Chrome estable puede restringir la carga automatizada de extensiones. En ese caso, Playwright valida con Chromium y la revisión final se realiza cargando manualmente el mismo paquete.

## Arquitectura

```text
entrypoints/
  background.ts       Orquestación de captura y persistencia
  capture.ts          Runtime inyectado en la página
  popup/              Acciones rápidas y ajustes del PDF
  manager/            Administración y exportación
src/
  capture/             Auto-scroll, extracción y selección
  pdf/                 Adaptador Chromium para printToPDF
  export/              Generadores visual e IA
  storage/             IndexedDB
  domain/              Tipos y reglas de capacidad
tests/                 Unitarias, componentes, E2E y sitio de prueba
```

Las APIs específicas del navegador permanecen detrás de adaptadores pequeños. La generación pesada de PDF se ejecuta en un Web Worker y todo el código necesario se incluye en el paquete de la extensión.

## Sitio de prueba

`tests/fixtures/site/index.html` reúne los casos límite usados durante el desarrollo:

- artículo largo y lazy-load;
- scroll anidado;
- dos estados SPA bajo la misma URL;
- tablas, código y formularios;
- iframe externo, canvas e imagen fallida.

## Límites conocidos

No pueden capturarse páginas internas del navegador, Chrome Web Store, visores PDF protegidos, iframes de otro origen, shadow roots cerrados, contenido DRM ni sesiones de inicio de sesión automatizadas. Videos, animaciones y controles interactivos se representan únicamente por el estado estático que el navegador pueda imprimir.

## Hoja de ruta

- Cuenta de usuario con cuota gratuita de 150 MB cada 15 días.
- Suscripción Premium y apartado para apoyar el proyecto.
- Adaptador específico para Firefox.

Estas funciones están planificadas y todavía no forman parte del build actual.

## Contribuir

1. Crea una rama desde la rama principal del proyecto.
2. Mantén TypeScript estricto y evita lógica remota en el paquete MV3.
3. Añade o actualiza la prueba mínima que cubra el cambio.
4. Ejecuta `npm run verify` antes de abrir un pull request.
