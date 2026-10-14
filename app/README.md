# app

App móvil de Sereno (Expo, Expo Router, TypeScript). Corre en el host Windows con el Node del host, no en Docker.

- Dependencias: `npm install` (librerías nuevas con `npx expo install <paquete>`)
- Desarrollo: `npm start` (Metro en el puerto 8087); `npm run android` abre la app en Expo Go en el emulador o el
  teléfono conectado por `adb`
- Tests: `npm test` (jest-expo y Testing Library); un archivo: `npm test -- src/__tests__/index.test.tsx`
- Tipos: `npm run typecheck`
- Lint: `npm run lint`

Desde el emulador de Android el host es `10.0.2.2` (API `http://10.0.2.2:8003`, Reverb `10.0.2.2:8086`); desde un
teléfono físico, la IP de la PC en la LAN. Proyecto de EAS vinculado en `app.json` (`extra.eas.projectId`, cuenta `ascariodev`).
