# 🚀 Despliegue en Railway - Sistema POS

## 📋 Requisitos Previos

1. **Cuenta en Railway**: [railway.app](https://railway.app)
2. **Cuenta en GitHub**: Para conectar el repositorio
3. **Proyecto subido a GitHub**

## 🗄️ Configuración de Base de Datos PostgreSQL

### 1. Crear proyecto en Railway
1. Ve a [railway.app](https://railway.app) y crea una cuenta
2. Haz clic en "New Project"
3. Selecciona "Deploy from GitHub repo"
4. Conecta tu cuenta de GitHub y selecciona este repositorio

### 2. Agregar PostgreSQL Database
1. En tu proyecto Railway, haz clic en "Add Plugin"
2. Selecciona "PostgreSQL"
3. Railway creará automáticamente la base de datos y configurará `DATABASE_URL`

## ⚙️ Variables de Entorno

Railway configura automáticamente `DATABASE_URL` cuando agregas PostgreSQL. No necesitas configurar variables manualmente.

## 🚀 Proceso de Despliegue

### Opción 1: Despliegue Automático (Recomendado)
1. Sube tu código a GitHub
2. Conecta el repositorio en Railway
3. Railway detectará `railway.json` y desplegará automáticamente

### Opción 2: Despliegue Manual
1. En Railway Dashboard, ve a tu proyecto
2. Haz clic en "Deploy"
3. Railway construirá y desplegará usando la configuración en `railway.json`

## 🔍 Verificación del Despliegue

### 1. Health Check
Visita: `https://tu-proyecto.railway.app/api/diagnostic`

Deberías ver:
```json
{
  "database": "PostgreSQL",
  "connection": "External (Railway)",
  "total_products": 8,
  "total_sales": 0,
  "status": "OK",
  "timestamp": "2025-..."
}
```

### 2. Frontend
Visita: `https://tu-proyecto.railway.app`

Deberías ver la interfaz del POS funcionando.

### 3. API Endpoints
- Productos: `https://tu-proyecto.railway.app/api/products`
- Ventas: `https://tu-proyecto.railway.app/api/sales`
- Estadísticas: `https://tu-proyecto.railway.app/api/stats`

## 🧪 Pruebas Locales con PostgreSQL

Para probar localmente antes del despliegue:

### 1. Instalar PostgreSQL localmente
```bash
# Windows (usando Chocolatey)
choco install postgresql

# macOS
brew install postgresql

# Ubuntu/Debian
sudo apt-get install postgresql
```

### 2. Crear base de datos local
```bash
createdb sistema_pos_local
```

### 3. Configurar variables de entorno
Crea un archivo `.env`:
```
DATABASE_URL=postgresql://username:password@localhost:5432/sistema_pos_local
```

### 4. Instalar dependencias y probar
```bash
npm install
npm start
```

## 🔧 Solución de Problemas

### Error de conexión a BD
- Verifica que PostgreSQL esté agregado en Railway
- Revisa las variables de entorno en Railway Dashboard

### Frontend no carga
- Verifica que los archivos estén en la carpeta `frontend/`
- Revisa que `express.static` esté configurado correctamente

### API devuelve errores
- Revisa los logs en Railway Dashboard
- Verifica la sintaxis de las queries PostgreSQL

## 💰 Costos en Railway

- **Hobby Plan**: $5/mes (incluye BD PostgreSQL)
- **Pro Plan**: $10/mes (más recursos)

## 📊 Monitoreo

- **Logs**: Railway Dashboard > Logs
- **Métricas**: Railway Dashboard > Metrics
- **Health Checks**: Configurado en `railway.json`

## 🔄 Actualizaciones

Cada push a la rama principal de GitHub activará un redeploy automático en Railway.

## 🛡️ Seguridad

- Las credenciales están en variables de entorno
- No hay datos sensibles en el código
- Railway maneja SSL automáticamente

---

¡Tu sistema POS ahora funcionará persistentemente en Railway con PostgreSQL! 🎉