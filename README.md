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
- Respaldo: exporta tus datos a un archivo y restáuralos cuando lo necesites.

## Sin cuentas ni configuración externa

No hay inicio de sesión en Organiza, Firebase, Google Cloud, OAuth ni archivos `.env` que configurar.

Solo necesitas que la cuenta Google ya esté agregada y sincronizada en el calendario del teléfono. Al crear un caso, activa **Conectar calendario**, elige uno de los calendarios que aparecen y listo.

Los casos, acciones y contactos se guardan solo en el teléfono. Al perder, desinstalar o cambiar el celular no se recuperan automáticamente: exporta un respaldo con regularidad (ver abajo). Google Calendar conserva únicamente los eventos que ya se hayan agendado; no guarda la tabla de Organiza.

## Respaldo de tus datos

En la pantalla principal, junto a **Contactos**, toca **Respaldo**.

**Exportar respaldo**

1. Toca **Exportar respaldo**.
2. En Android, elige una carpeta (por ejemplo, Descargas). En iPhone, elige **Guardar en Archivos** o envíalo a donde prefieras.
3. Se crea un archivo `organiza-respaldo-AAAA-MM-DD-HHMM.json` con tus casos, acciones, fases y contactos.

Guárdalo en un lugar seguro y privado: no incluye contraseñas ni claves, pero sí la información de tus casos sin cifrar.

**Restaurar respaldo**

1. Toca **Restaurar respaldo** y elige el archivo `.json`.
2. Organiza revisa el archivo y te muestra cuántos casos, acciones y contactos tiene. No cambia nada hasta que confirmes.
3. Al confirmar, primero guarda una **copia automática** de tus datos actuales en el teléfono y después los reemplaza por los del respaldo.
4. Si te arrepientes, en la misma pantalla aparece **Recuperar copia automática**.

Al restaurar en otro teléfono:

- Los **recordatorios** se vuelven a programar si permites las notificaciones (solo los que aún están en el futuro).
- Los **eventos de Google Calendar** ya creados siguen en tu calendario, pero la conexión con el calendario de cada caso pertenece al teléfono original: abre cada caso con calendario y elígelo de nuevo.

Si algún día Organiza no puede leer los datos guardados, no los sobrescribe: te mostrará opciones para reintentar, restaurar un respaldo o guardar una copia de esos datos.

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
