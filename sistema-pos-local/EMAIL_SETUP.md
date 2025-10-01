# Envío de Reportes PDF por Email

## Cómo Funciona

El sistema genera automáticamente un PDF con la lista completa de facturas y cierres de caja, luego abre Gmail con el email preparado. El PDF se guarda en el servidor y se proporciona un enlace para descargarlo y adjuntarlo manualmente al email.

## Pasos para Enviar un Reporte:

1. **Haz clic en "📧 Enviar Reporte por Email"** en el Dashboard
2. **Ingresa el email destino** donde quieres enviar el reporte
3. **Opcionalmente filtra por fechas** (desde/hasta)
4. **El sistema genera el PDF** con toda la información
5. **Se abren dos pestañas**:
   - Una con Gmail y el email preparado
   - Otra con el PDF para descargar
6. **Descarga el PDF** desde la pestaña del navegador
7. **Adjunta el PDF descargado** al email en Gmail
8. **Inicia sesión en Gmail** si es necesario y haz clic en "Enviar"

## Contenido del PDF

El reporte incluye:
- **Lista completa de facturas** con número, fecha, total, método de pago y vuelto
- **Lista completa de cierres de caja** con dinero inicial, totales y diferencias
- **Totales generales** del período seleccionado
- **Fecha de generación** del reporte

## Ventajas de Este Enfoque

- ✅ **No requiere configuración previa** de credenciales de email
- ✅ **Funciona con cualquier cuenta de Gmail** (incluyendo cuentas corporativas)
- ✅ **Más seguro** - no necesitas compartir credenciales con la aplicación
- ✅ **Más simple** - solo necesitas tener Gmail abierto
- ✅ **Compatible** con autenticación de 2 factores

## Solución de Problemas

### Gmail no se abre o no carga el adjunto
- Asegúrate de tener Gmail abierto en tu navegador
- Verifica que tengas conexión a internet
- Intenta refrescar la página de Gmail

### El PDF no se genera
- Verifica que el servidor esté ejecutándose
- Revisa la consola del navegador (F12) para ver errores
- Asegúrate de tener datos en la base de datos

### Problemas con fechas
- Las fechas deben estar en formato YYYY-MM-DD
- Si no especificas fechas, se incluyen todos los registros

## Configuración Alternativa (Opcional)

Si prefieres envío automático sin abrir Gmail, puedes configurar credenciales de email creando un archivo `.env` en la carpeta `backend/`:

```env
EMAIL_USER=tu-email@gmail.com
EMAIL_PASS=tu-contraseña-de-aplicación
```

Para obtener una contraseña de aplicación de Gmail:
1. Ve a https://myaccount.google.com/security
2. Activa "Verificación en 2 pasos" si no la tienes
3. Ve a "Contraseñas de aplicaciones"
4. Crea una nueva contraseña para "Sistema POS"
5. Usa esa contraseña de 16 caracteres en EMAIL_PASS