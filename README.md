<div align="center">
  <img src="public/brand-mark.svg" width="112" height="112" alt="Logo de Colección Web PDF">

  # Colección Web PDF

  **Reúne páginas, secciones y estados de una web en un único PDF visual.**

  Gratis · Código abierto · Procesamiento local · Chrome · Opera GX
</div>

## Qué hace

Colección Web PDF guarda el estado actual de una página con imágenes, estilos, fondos, enlaces y texto seleccionable. Cada ruta, filtro, pestaña o estado SPA se añade manualmente como una vista independiente, incluso si comparte URL con otras vistas.

- Captura una página completa o varias secciones elegidas.
- Prepara contenido lazy-load con auto-scroll acotado y restaura el desplazamiento.
- Conserva un PDF visual y una versión semántica para lectura por IA.
- Permite previsualizar, renombrar, reordenar, eliminar y volver a exportar.
- Genera portada, índice, separadores, URL y fecha de captura.
- No requiere cuenta, registro, servidor ni conexión para capturar y exportar.

## Privacidad

Las páginas, imágenes, URL, títulos, documentos semánticos y PDF permanecen en el dispositivo. La extensión no incluye telemetría, backend ni código remoto. Las únicas solicitudes de red posibles son las que la propia página necesite para terminar de cargar sus recursos antes de imprimirla.

El permiso `debugger` se usa exclusivamente para solicitar a Chromium el PDF visual de la pestaña elegida por el usuario. El manifiesto no solicita permisos permanentes sobre sitios web.

## Límites locales

No existe límite de vistas ni cuota temporal. Cada colección tiene un límite local configurable de 100 MB, 300 MB, 500 MB o 1 GB; 300 MB es el valor predeterminado. El límite evita agotar accidentalmente el almacenamiento del navegador y no puede reducirse por debajo del espacio ya utilizado.

Las colecciones de versiones anteriores se migran automáticamente a IndexedDB v3 sin perder capturas ni artefactos.

## Instalación para usuarios

1. Descarga y descomprime una release.
2. Abre `chrome://extensions` u `opera://extensions`.
3. Activa el modo desarrollador.
4. Elige **Cargar descomprimida** y selecciona la carpeta `chrome-mv3`.

Las páginas internas del navegador, Chrome Web Store, visores PDF protegidos, iframes de otro origen, shadow roots cerrados y contenido DRM no pueden capturarse. Videos y controles interactivos se representan por el estado estático que Chromium pueda imprimir.

## Desarrollo

Requisitos: Node.js 22 o posterior, npm y un navegador Chromium para E2E.

```powershell
git clone https://github.com/Suggus1899/page_to_pdf.git
cd page_to_pdf
npm ci
npm run verify
npm run test:e2e
```

El build queda en `.output/chrome-mv3`. No se necesitan archivos `.env` ni servicios externos.

### Comandos

```powershell
npm run dev
npm run typecheck
npm run lint
npm test
npm run build
npm run verify
npm run test:e2e
npm audit --audit-level=high
```

## Arquitectura

```text
entrypoints/
  background.ts        Orquestación local de captura y persistencia
  capture.ts           Runtime aislado inyectado en la página
  popup/               Captura rápida y ajustes de impresión
  manager/             Colecciones, vistas previas y exportación
src/
  capture/             Auto-scroll, extracción y selector visual
  pdf/                 Adaptador Chromium para Page.printToPDF
  export/              Workers de PDF visual y semántico
  storage/             IndexedDB y migraciones locales
  domain/              Tipos y límites configurables
```

WXT genera un único paquete Manifest V3 para Chrome y Opera GX. La generación pesada se reparte entre workers; el contenido visual y semántico se guarda de forma atómica en IndexedDB.

## Contribuir y seguridad

Lee [CONTRIBUTING.md](CONTRIBUTING.md) antes de enviar cambios. Para vulnerabilidades, sigue el canal privado descrito en [SECURITY.md](SECURITY.md) y evita abrir un issue público con detalles sensibles.

## Licencia

Colección Web PDF se distribuye bajo [GNU GPL v3](LICENSE), identificador SPDX `GPL-3.0-only`.
