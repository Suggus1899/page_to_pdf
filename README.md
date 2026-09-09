# Colección Web PDF

Extensión Manifest V3 para Chrome y Opera GX que guarda estados concretos de una web y los reúne en un solo PDF visual. Está pensada para aplicaciones con varias rutas, pestañas, filtros o estados SPA: cada pulsación en **Capturar web completa** o **Capturar secciones** crea una captura inmutable, incluso cuando la URL no cambia.

## Funciones incluidas

- Colecciones persistentes de hasta 50 vistas y 250 MB cada una.
- Captura asistida de página completa con preparación de contenido dinámico y restauración del scroll.
- Selector de múltiples inclusiones y exclusiones, aislado de los estilos de la página mediante Shadow DOM.
- **PDF visual** predeterminado: usa `Page.printToPDF` para conservar imágenes, estilos, fondos, enlaces y texto seleccionable en el instante de la captura.
- **Versión IA** secundaria: texto normalizado, encabezados, listas, tablas, código, enlaces, formularios visibles, figuras y metadatos de origen.
- Administrador para renombrar, previsualizar, reordenar, eliminar y exportar.
- Portada, índice y separador por vista en cada exportación.
- Todo se procesa y conserva localmente; no existe backend, telemetría ni lógica remota.

## Desarrollo

Requisitos: Node.js 22 o posterior y npm.

```powershell
npm install
npm run dev
```

Comandos principales:

```powershell
npm run typecheck
npm run lint
npm test
npm run build
npm run verify
```

El build compartido queda en `.output/chrome-mv3`.

## Cargar en los navegadores

1. Ejecuta `npm run build`.
2. En Chrome abre `chrome://extensions`; en Opera GX abre `opera://extensions`.
3. Activa el modo desarrollador.
4. Elige **Cargar descomprimida** y selecciona `F:\Proyectos\page_to_pdf\.output\chrome-mv3`.

No hay que generar un build distinto para Opera GX.

## Uso multivista

1. Crea o elige una colección en el popup.
2. Navega hasta el primer estado relevante de la web y añade la página completa o sus secciones.
3. Cambia de ruta, filtro, pestaña o estado y vuelve a añadirlo. Las URLs duplicadas están permitidas deliberadamente.
4. Abre el administrador, revisa las vistas, cambia el orden y exporta **PDF visual** o **Versión IA**.

En la primera captura visual, el navegador solicita el permiso opcional `debugger`. Si se deniega, se pierde o DevTools ya ocupa la pestaña, la captura se cancela sin guardar una vista parcial. Las capturas antiguas que solo tienen versión IA deben eliminarse y repetirse para incorporarlas al PDF visual.

## Pruebas en navegadores instalados

El E2E abre un perfil temporal, carga el build sin empaquetar y comprueba popup, persistencia inicial y administrador. Sin variable usa el Chromium incluido con Playwright; Opera GX admite el mismo flujo automatizado.

```powershell
$env:BROWSER_EXECUTABLE='C:\Program Files\Google\Chrome\Application\chrome.exe'
npm run test:e2e

$env:BROWSER_EXECUTABLE='C:\Users\PC\AppData\Local\Programs\Opera GX\opera.exe'
npm run test:e2e
```

Chrome estable puede ignorar las banderas de carga de extensiones de procesos automatizados. En ese caso se valida con Chromium y se hace la comprobación final en Chrome mediante **Cargar descomprimida**.

El sitio manual de casos límite está en `tests/fixtures/site/index.html` e incluye página larga, lazy-load, scroll anidado, dos estados SPA con la misma URL, tabla, código, formulario, iframe externo, canvas e imagen fallida.

## Límites conocidos de v1

No se capturan páginas internas del navegador, Chrome Web Store, visores PDF protegidos, iframes de otro origen, shadow roots cerrados, DRM ni sesiones de inicio de sesión automatizadas. El extractor legible representa estos casos con avisos o marcadores cuando es posible. La extensión no rastrea automáticamente un dominio: la colección de vistas es deliberadamente asistida.
