# Contribuir a Colección Web PDF

Gracias por mejorar el proyecto. Antes de trabajar en un cambio, revisa los issues abiertos y crea uno si la propuesta altera el comportamiento público.

## Preparación

```powershell
git clone https://github.com/Suggus1899/page_to_pdf.git
cd page_to_pdf
npm ci
npm run verify
```

Se requiere Node.js 22 o posterior. La extensión no usa backend, telemetría, lógica remota ni variables de entorno.

## Cambios

- Mantén TypeScript estricto y los adaptadores específicos del navegador pequeños.
- Conserva el procesamiento de contenido y PDF completamente local.
- Añade o actualiza la prueba mínima que demuestre el comportamiento modificado.
- No incluyas datos personales, capturas privadas, secretos ni artefactos generados.
- Usa commits convencionales con tipo en inglés y asunto breve en español.

Antes de abrir un pull request ejecuta:

```powershell
npm run verify
npm run test:e2e
npm audit --audit-level=high
```

Describe el problema resuelto, el alcance del cambio y las pruebas realizadas. Los cambios se aceptan bajo `GPL-3.0-only`.
