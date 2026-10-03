# Organiza

Aplicación móvil para llevar **casos** y sus acciones en Android y iPhone.

## Qué incluye esta versión

- Casos, acciones, fases configurables, contactos y recordatorios.
- Botón **Resumen** con indicadores, gráfica por caso y tabla dinámica de pendientes, realizadas y por confirmar; no muestra porcentajes.
- Calendario por caso: la app muestra los calendarios Google que ya estén configurados en el teléfono, para crear, actualizar y quitar eventos directamente ahí.
- Recordatorios locales: al activar Recordatorio, Organiza programa el aviso directamente en el celular. No depende de Google Calendar ni de Internet.
- Formularios que se acomodan sobre el teclado en Android y iPhone para que el campo que estás editando siga visible.
- Botón para agregar otra cuenta Google desde los ajustes del teléfono y actualizar los calendarios disponibles al volver a Organiza.
- Puedes usar un calendario distinto por caso. Los eventos ya creados se quedan en su calendario anterior; las acciones nuevas usan el que elijas después.
- Eliminar una acción o un caso completo. Cuando hay eventos asociados, puedes quitarlos también del calendario.
- Áreas seguras, teclado y selectores compatibles con Android y iPhone.

## Sin cuentas ni configuración externa

No hay inicio de sesión en Organiza, Firebase, Google Cloud, OAuth ni archivos `.env` que configurar.

Solo necesitas que la cuenta Google ya esté agregada y sincronizada en el calendario del teléfono. Al crear un caso, activa **Conectar calendario**, elige uno de los calendarios que aparecen y listo.

Los casos, acciones y contactos se guardan solo en el teléfono. Al perder, desinstalar o cambiar el celular no se recuperan automáticamente. Google Calendar conserva únicamente los eventos que ya se hayan agendado; no guarda la tabla de Organiza.

## Probar la app

1. Instala dependencias:

   ```powershell
   npm install
   ```

2. Inicia Metro y abre el QR desde **Organiza Development Build**:

   ```powershell
   npm run start:dev -- --clear
   ```

En Android, el build de desarrollo que ya tenía Calendar normalmente puede probar este cambio sin instalar otro APK. Para generar una actualización distribuible, o para iPhone, genera un build nuevo porque `app.json` ahora solicita acceso completo para mostrar los calendarios disponibles.

No desinstales la app Android antes de instalar una actualización con el mismo identificador `com.xime.organiza`; así conservarás los casos ya guardados localmente.

## iPhone

El mismo código es compatible con iPhone. Para instalar un build de prueba en un iPhone físico se necesita una cuenta del Apple Developer Program y registrar el dispositivo en EAS:

```powershell
npx eas-cli@latest build --platform ios --profile development
```

## Privacidad

Organiza no guarda contraseñas ni tokens de Google. Para datos de clientes o expedientes especialmente sensibles, añade después bloqueo con PIN o Face ID y una política de privacidad antes de usarla como herramienta profesional.
