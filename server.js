const express = require('express');
const cors = require('cors');
const path = require('path');
const initSqlJs = require('sql.js');
const basicAuth = require('express-basic-auth');
const session = require('express-session');
const { exec } = require('child_process');
const PDFDocument = require('pdfkit');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
    origin: [
        'https://punto-de-venta-web-f47e8.web.app',
        'http://localhost:3000',
        'http://127.0.0.1:3000'
    ],
    credentials: true
}));
app.use(express.json());

// Configuración de sesiones
app.use(session({
    secret: 'pos-secret-key-2024',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false, // Cambiar a true en producción con HTTPS
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000 // 24 horas
    }
}));

// Función para limpiar archivos temporales antiguos (PDFs)
function cleanupTempFiles() {
    const tempDir = path.join(__dirname, 'temp');
    if (!fs.existsSync(tempDir)) return;

    const files = fs.readdirSync(tempDir);
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 horas

    files.forEach(file => {
        const filePath = path.join(tempDir, file);
        const stats = fs.statSync(filePath);
        if (now - stats.mtime.getTime() > maxAge) {
            fs.unlinkSync(filePath);
            console.log(`🗑️  Archivo temporal eliminado: ${file}`);
        }
    });
}

// Credenciales válidas
const VALID_CREDENTIALS = { 'admin': 'pos123' };

// Middleware de autenticación basado en sesión
function authMiddleware(req, res, next) {
    if (req.session && req.session.authenticated) {
        return next();
    }
    return res.status(401).json({ error: 'Autenticación requerida' });
}

// Middleware para proteger solo operaciones de escritura
function protectWriteOperations(req, res, next) {
    if (req.method === 'GET') {
        // Permitir lecturas sin autenticación
        return next();
    }
    // Para POST, PUT, DELETE requerir autenticación
    return authMiddleware(req, res, next);
}

// Aplicar protección a rutas de productos (lectura pública, escritura protegida)
app.use('/api/products', protectWriteOperations);
app.use('/api/sales', authMiddleware);
app.use('/api/items', authMiddleware);
app.use('/api/categories', protectWriteOperations);

// Logging de requests (comentado para debug)
// app.use((req, res, next) => {
//     console.log(`${req.method} ${req.url}`);
//     next();
// });

// CSP comentado temporalmente para debug
// app.use((req, res, next) => {
//     res.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:;");
//     next();
// });

// Servir archivos frontend desde carpeta ../Frontend (AGREGADO)
app.use(express.static(path.join(__dirname, '../Frontend'), { maxAge: 0 }));

// Configuración de SQLite con sql.js
const dbPath = path.join(__dirname, 'pos_database.sqlite');
let db;

async function initDatabaseConnection() {
    try {
        const SQL = await initSqlJs();
        let filebuffer = null;

        // Intentar cargar base de datos existente
        if (fs.existsSync(dbPath)) {
            filebuffer = fs.readFileSync(dbPath);
        }

        db = new SQL.Database(filebuffer);

        // Función para guardar la base de datos
        const saveDatabase = () => {
            const data = db.export();
            const buffer = Buffer.from(data);
            fs.writeFileSync(dbPath, buffer);
        };

        // Guardar cada 30 segundos
        setInterval(saveDatabase, 30000);

        // Guardar al cerrar
        process.on('SIGINT', () => {
            saveDatabase();
            console.log('✅ Conexión a la base de datos cerrada');
            process.exit(0);
        });

        console.log('✅ Conectado a la base de datos SQLite (sql.js)');
        initDatabase();
    } catch (error) {
        console.error('❌ Error inicializando base de datos:', error);
        process.exit(1);
    }
}

async function startServer() {
    await initDatabaseConnection();

    // Iniciar servidor
    app.listen(PORT, () => {
        console.log(`🚀 Servidor ejecutándose en http://localhost:${PORT}`);
        console.log(`🌐 También disponible en la red local (reemplaza localhost con tu IP)`);
        console.log(`📦 API disponible en http://localhost:${PORT}/api/products`);
        console.log(`📊 Estadísticas: http://localhost:${PORT}/api/stats`);
        console.log(`🔧 Diagnóstico: http://localhost:${PORT}/api/diagnostic`);
        console.log(`💾 Base de datos: ${dbPath}`);
        console.log(`🌐 Frontend disponible en http://localhost:${PORT}`);

        // Limpiar archivos temporales antiguos al iniciar
        cleanupTempFiles();
        console.log('📧 Los reportes PDF se generan y se preparan para envío por Gmail');
    });
}

startServer();

// Inicializar la base de datos
function initDatabase() {
    try {
        // Tabla productos
        db.exec(`CREATE TABLE IF NOT EXISTS productos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            codigo TEXT UNIQUE NOT NULL,
            nombre TEXT NOT NULL,
            descripcion TEXT,
            precio REAL NOT NULL,
            stock INTEGER DEFAULT 0,
            categoria TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Tabla ventas
        db.exec(`CREATE TABLE IF NOT EXISTS ventas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            numero_factura TEXT UNIQUE NOT NULL,
            total REAL NOT NULL,
            metodo_pago TEXT NOT NULL,
            vuelto REAL DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Tabla items_venta
        db.exec(`CREATE TABLE IF NOT EXISTS venta_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            venta_id INTEGER NOT NULL,
            producto_id INTEGER NOT NULL,
            cantidad INTEGER NOT NULL,
            precio_unitario REAL NOT NULL,
            descuento_porcentaje REAL DEFAULT 0,
            descuento_aplicado REAL DEFAULT 0,
            subtotal REAL NOT NULL,
            FOREIGN KEY (venta_id) REFERENCES ventas(id),
            FOREIGN KEY (producto_id) REFERENCES productos(id)
        )`);

        // Agregar columnas de descuento si no existen (para compatibilidad con bases de datos existentes)
        try {
            db.exec(`ALTER TABLE venta_items ADD COLUMN descuento_porcentaje REAL DEFAULT 0`);
            console.log('✅ Columna descuento_porcentaje agregada');
        } catch (err) {
            if (!err.message.includes('duplicate column name')) {
                console.log('⚠️  Columna descuento_porcentaje ya existe o error:', err.message);
            }
        }
        try {
            db.exec(`ALTER TABLE venta_items ADD COLUMN descuento_aplicado REAL DEFAULT 0`);
            console.log('✅ Columna descuento_aplicado agregada');
        } catch (err) {
            if (!err.message.includes('duplicate column name')) {
                console.log('⚠️  Columna descuento_aplicado ya existe o error:', err.message);
            }
        }

        // Tabla cierres_caja
        db.exec(`CREATE TABLE IF NOT EXISTS cierres_caja (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            fecha DATETIME DEFAULT CURRENT_TIMESTAMP,
            dinero_inicial REAL NOT NULL,
            total_ventas REAL NOT NULL,
            total_esperado REAL NOT NULL,
            diferencia REAL NOT NULL,
            cantidad_ventas INTEGER NOT NULL
        )`);

        // Tabla proveedores (suppliers)
        db.exec(`CREATE TABLE IF NOT EXISTS proveedores (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre_proveedor TEXT NOT NULL,
            nombre_contacto TEXT,
            telefono TEXT,
            email TEXT,
            productos_servicios TEXT,
            condiciones_pago TEXT,
            estatus TEXT DEFAULT 'Activo',
            notas TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Tabla promociones
        db.exec(`CREATE TABLE IF NOT EXISTS promociones (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Tabla productos en promocion
        db.exec(`CREATE TABLE IF NOT EXISTS promocion_productos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            promocion_id INTEGER NOT NULL,
            producto_id INTEGER NOT NULL,
            descuento_porcentaje REAL NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (promocion_id) REFERENCES promociones(id) ON DELETE CASCADE,
            FOREIGN KEY (producto_id) REFERENCES productos(id) ON DELETE CASCADE
        )`);

        // Verificar si hay datos
        const stmt = db.prepare("SELECT COUNT(*) as count FROM productos");
        const result = stmt.getAsObject();
        stmt.free();
        if (result.count === 0) {
            insertSampleData();
        }
    } catch (error) {
        console.error('❌ Error inicializando base de datos:', error);
    }
}

// Insertar datos de ejemplo
function insertSampleData() {
    const productos = [
        ['LAP-001', 'Laptop HP 15.6"', 'Laptop HP con pantalla 15.6 pulgadas', 899.99, 25, 'Tecnología'],
        ['MON-001', 'Monitor Samsung 24"', 'Monitor Samsung 24 pulgadas Full HD', 249.99, 15, 'Tecnología'],
        ['TEC-001', 'Teclado Mecánico RGB', 'Teclado mecánico con iluminación RGB', 89.99, 30, 'Periféricos'],
        ['MOU-001', 'Mouse Inalámbrico', 'Mouse inalámbrico ergonómico', 39.99, 45, 'Periféricos'],
        ['AUD-001', 'Audífonos Bluetooth', 'Audífonos inalámbricos con cancelación de ruido', 79.99, 20, 'Audio'],
        ['CAM-001', 'Cámara Web HD', 'Cámara web 1080p para streaming', 59.99, 18, 'Video'],
        ['DIS-001', 'Disco Duro 1TB', 'Disco duro interno 1TB 7200RPM', 69.99, 12, 'Almacenamiento'],
        ['MEM-001', 'Memoria RAM 8GB', 'Memoria RAM DDR4 8GB 2666MHz', 49.99, 8, 'Componentes']
    ];

    productos.forEach(producto => {
        try {
            const stmt = db.prepare(`
                INSERT OR IGNORE INTO productos (codigo, nombre, descripcion, precio, stock, categoria)
                VALUES (?, ?, ?, ?, ?, ?)
            `);
            stmt.run(producto);
            stmt.free();
        } catch (error) {
            console.log('⚠️  Error insertando producto:', producto[0], error.message);
        }
    });

    console.log('✅ Datos de ejemplo insertados en SQLite');
}

// Función para hacer queries más fácil
function dbAll(query, params = []) {
    try {
        const stmt = db.prepare(query);
        const results = [];
        while (stmt.step()) {
            results.push(stmt.getAsObject());
        }
        stmt.free();
        return results;
    } catch (error) {
        throw error;
    }
}

// Función para remover acentos
function removeAccents(str) {
    return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// Rutas de autenticación
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;

    if (VALID_CREDENTIALS[username] && VALID_CREDENTIALS[username] === password) {
        req.session.authenticated = true;
        req.session.username = username;
        res.json({ success: true, message: 'Login exitoso' });
    } else {
        res.status(401).json({ error: 'Credenciales inválidas' });
    }
});

app.post('/api/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({ error: 'Error al cerrar sesión' });
        }
        res.json({ success: true, message: 'Sesión cerrada' });
    });
});

app.get('/api/auth-status', (req, res) => {
    res.json({
        authenticated: !!(req.session && req.session.authenticated),
        username: req.session ? req.session.username : null
    });
});

// Endpoint para generar reporte de ventas (para abrir en Gmail)
app.post('/api/generate-sales-report', authMiddleware, async (req, res) => {
    try {
        const { dateFrom, dateTo } = req.body;

        // Obtener ventas en el rango de fechas
        let query = "SELECT * FROM ventas WHERE 1=1";
        let params = [];

        if (dateFrom) {
            query += " AND DATE(created_at) >= DATE(?)";
            params.push(dateFrom);
        }

        if (dateTo) {
            query += " AND DATE(created_at) <= DATE(?)";
            params.push(dateTo);
        }

        query += " ORDER BY created_at DESC";

        const sales = await dbAll(query, params);

        if (sales.length === 0) {
            return res.status(404).json({ error: 'No hay ventas en el período seleccionado' });
        }

        // Calcular total general
        let totalGeneral = 0;
        sales.forEach(sale => {
            totalGeneral += sale.total;
        });

        res.json({
            success: true,
            totalSales: sales.length,
            totalAmount: totalGeneral,
            period: {
                from: dateFrom || 'Inicio',
                to: dateTo || 'Hoy'
            },
            generatedAt: new Date().toLocaleString('es-AR')
        });

    } catch (error) {
        console.error('Error generando reporte:', error);
        res.status(500).json({
            error: 'Error al generar el reporte: ' + error.message
        });
    }
});

// Servir archivos temporales (PDFs generados)
app.use('/temp', express.static(path.join(__dirname, 'temp')));

// Endpoint para generar reporte PDF con facturas y cierres de caja
app.post('/api/generate-pdf-report', authMiddleware, async (req, res) => {
    try {
        const { dateFrom, dateTo } = req.body;

        // Obtener facturas en el rango de fechas
        let salesQuery = "SELECT * FROM ventas WHERE 1=1";
        let salesParams = [];

        if (dateFrom) {
            salesQuery += " AND DATE(created_at) >= DATE(?)";
            salesParams.push(dateFrom);
        }

        if (dateTo) {
            salesQuery += " AND DATE(created_at) <= DATE(?)";
            salesParams.push(dateTo);
        }

        salesQuery += " ORDER BY created_at DESC";

        const sales = await dbAll(salesQuery, salesParams);

        // Obtener cierres de caja en el rango de fechas
        let cierresQuery = "SELECT * FROM cierres_caja WHERE 1=1";
        let cierresParams = [];

        if (dateFrom) {
            cierresQuery += " AND DATE(fecha) >= DATE(?)";
            cierresParams.push(dateFrom);
        }

        if (dateTo) {
            cierresQuery += " AND DATE(fecha) <= DATE(?)";
            cierresParams.push(dateTo);
        }

        cierresQuery += " ORDER BY fecha DESC";

        const cierres = await dbAll(cierresQuery, cierresParams);

        // Generar nombre único para el PDF
        const timestamp = Date.now();
        const fileName = `reporte-pos-${timestamp}.pdf`;
        const filePath = path.join(__dirname, 'temp', fileName);

        // Asegurar que existe el directorio temp
        const tempDir = path.join(__dirname, 'temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        // Crear PDF y guardarlo
        const doc = new PDFDocument();
        const writeStream = fs.createWriteStream(filePath);

        doc.pipe(writeStream);

        // Contenido del PDF - Versión simplificada y legible
        doc.fontSize(18).text('REPORTE DEL SISTEMA POS', { align: 'center' });
        doc.moveDown();
        doc.fontSize(10).text(`Fecha de generación: ${new Date().toLocaleString('es-AR')}`, { align: 'right' });
        doc.text(`Período del reporte: ${dateFrom || 'Todo el historial'} - ${dateTo || 'Fecha actual'}`, { align: 'right' });
        doc.moveDown(2);

        // Sección de Facturas
        doc.fontSize(14).text('VENTAS REGISTRADAS', { underline: true });
        doc.moveDown();

        if (sales.length === 0) {
            doc.fontSize(10).text('No se encontraron ventas en el período seleccionado.');
            doc.moveDown();
        } else {
            // Mostrar cada venta en líneas separadas
            sales.forEach((sale, index) => {
                doc.fontSize(10).font('Helvetica-Bold');
                doc.text(`${index + 1}. Factura: ${sale.numero_factura}`);
                doc.font('Helvetica').fontSize(9);
                doc.text(`   Fecha: ${new Date(sale.created_at).toLocaleDateString('es-AR')}`);
                doc.text(`   Total: $${sale.total.toFixed(2)}`);

                // Procesar método de pago para mostrarlo de forma legible
                let metodoPagoTexto = 'No especificado';
                try {
                    const metodoParsed = JSON.parse(sale.metodo_pago);
                    if (Array.isArray(metodoParsed) && metodoParsed.length > 0) {
                        // Si es array de pagos, mostrar resumen
                        const metodos = metodoParsed.map(p => p.METODO || p.metodo).filter(m => m);
                        metodoPagoTexto = metodos.join(' + ') || 'Múltiple';
                    } else {
                        metodoPagoTexto = sale.metodo_pago;
                    }
                } catch (e) {
                    // Si no es JSON, usar el texto tal cual
                    metodoPagoTexto = sale.metodo_pago;
                }
                doc.text(`   Pago: ${metodoPagoTexto.toUpperCase()}`);
                doc.text(`   Vuelto: $${(sale.vuelto || 0).toFixed(2)}`);
                doc.moveDown(0.5);
            });

            // Total de ventas
            doc.moveDown(0.5);
            const totalVentas = sales.reduce((sum, sale) => sum + sale.total, 0);
            doc.fontSize(12).font('Helvetica-Bold');
            doc.text(`TOTAL VENTAS: $${totalVentas.toFixed(2)} (Cantidad: ${sales.length} facturas)`, { align: 'center' });
        }

        doc.moveDown(2);

        // Sección de Cierres de Caja
        doc.fontSize(14).text('CIERRES DE CAJA', { underline: true });
        doc.moveDown();

        if (cierres.length === 0) {
            doc.fontSize(10).text('No se encontraron cierres de caja en el período seleccionado.');
            doc.moveDown();
        } else {
            // Mostrar cada cierre en líneas separadas
            cierres.forEach((cierre, index) => {
                doc.fontSize(10).font('Helvetica-Bold');
                doc.text(`${index + 1}. Cierre del ${new Date(cierre.fecha).toLocaleDateString('es-AR')}`);
                doc.font('Helvetica').fontSize(9);
                doc.text(`   Dinero Inicial: $${cierre.dinero_inicial.toFixed(2)}`);
                doc.text(`   Total Ventas: $${cierre.total_ventas.toFixed(2)}`);
                doc.text(`   Total Esperado: $${cierre.total_esperado.toFixed(2)}`);
                doc.text(`   Diferencia: $${cierre.diferencia.toFixed(2)}`);
                doc.text(`   Cantidad de Ventas: ${cierre.cantidad_ventas}`);
                doc.moveDown(0.5);
            });
        }

        // Pie de página
        doc.moveDown(2);
        doc.fontSize(8).font('Helvetica-Oblique');
        doc.text('Sistema POS - Reporte generado automáticamente', { align: 'center' });

        doc.end();

        // Esperar a que se complete la escritura del archivo
        writeStream.on('finish', () => {
            // Devolver la URL del PDF para descarga
            const pdfUrl = `${req.protocol}://${req.get('host')}/temp/${fileName}`;
            res.json({
                success: true,
                message: 'PDF generado exitosamente',
                pdfUrl: pdfUrl,
                fileName: fileName,
                salesCount: sales.length,
                cierresCount: cierres.length
            });
        });

        writeStream.on('error', (error) => {
            console.error('Error escribiendo PDF:', error);
            res.status(500).json({
                error: 'Error al guardar el PDF: ' + error.message
            });
        });

    } catch (error) {
        console.error('Error generando PDF:', error);
        res.status(500).json({
            error: 'Error al generar el PDF: ' + error.message
        });
    }
});

function dbRun(query, params = []) {
    try {
        // Para INSERT, necesitamos manejar los parámetros de manera diferente
        if (params.length > 0) {
            const stmt = db.prepare(query);
            const result = stmt.run(params);
            stmt.free();
            return { id: result.insertId, changes: 1 };
        } else {
            db.run(query);
            return { id: undefined, changes: 1 };
        }
    } catch (error) {
        throw error;
    }
}
//auto categorias
app.get('/api/categories', async (req, res) => {
    try {
        const categories = await dbAll("SELECT DISTINCT categoria FROM productos WHERE categoria IS NOT NULL AND categoria != '' ORDER BY categoria");
        res.json(categories.map(row => row.categoria));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Rutas de la API
app.get('/api/products', async (req, res) => {
    try {
        const products = await dbAll("SELECT * FROM productos ORDER BY nombre");
        res.json(products);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// >>> NUEVA RUTA para obtener todas las ventas agrupadas por factura
app.get('/api/sales', async (req, res) => {
    try {
        // Obtener ventas con sus items agrupados
        const salesQuery = `
            SELECT
                v.id,
                v.numero_factura,
                v.created_at AS fecha,
                v.total,
                v.metodo_pago,
                v.vuelto,
                GROUP_CONCAT(
                    JSON_OBJECT(
                        'producto_id', vi.producto_id,
                        'nombre', p.nombre,
                        'cantidad', vi.cantidad,
                        'precio_unitario', vi.precio_unitario,
                        'descuento_porcentaje', COALESCE(vi.descuento_porcentaje, 0),
                        'descuento_aplicado', COALESCE(vi.descuento_aplicado, 0),
                        'subtotal', vi.subtotal
                    )
                ) as items
            FROM ventas v
            LEFT JOIN venta_items vi ON v.id = vi.venta_id
            LEFT JOIN productos p ON vi.producto_id = p.id
            GROUP BY v.id, v.numero_factura, v.created_at, v.total, v.metodo_pago, v.vuelto
            ORDER BY v.created_at DESC
        `;

        const sales = await dbAll(salesQuery);

        // Procesar los items JSON para cada venta
        const processedSales = sales.map(sale => {
            let metodoPagoParsed = sale.metodo_pago;

            // Intentar parsear como JSON si contiene información detallada de pagos
            try {
                const parsed = JSON.parse(sale.metodo_pago);
                if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].metodo) {
                    // Es un array de pagos detallados
                    metodoPagoParsed = parsed;
                }
            } catch (e) {
                // No es JSON, mantener como string simple
                metodoPagoParsed = sale.metodo_pago;
            }

            return {
                id: sale.id,
                numero_factura: sale.numero_factura,
                fecha: sale.fecha,
                total: sale.total,
                metodo_pago: metodoPagoParsed,
                vuelto: sale.vuelto || 0,
                items: sale.items ? JSON.parse(`[${sale.items}]`) : []
            };
        });

        res.json(processedSales);
    } catch (error) {
        console.error('Error obteniendo ventas:', error);
        res.status(500).json({ error: error.message });
    }
});

// >>> NUEVA RUTA para obtener el detalle de productos vendidos
app.get('/api/items', async (req, res) => {
    try {
        const items = await dbAll(`
            SELECT
                vi.venta_id,
                vi.producto_id,
                vi.cantidad,
                vi.precio_unitario,
                vi.descuento_porcentaje,
                vi.descuento_aplicado,
                vi.subtotal,
                p.nombre AS nombre_producto,
                p.precio AS precio_original
            FROM venta_items vi
            JOIN productos p ON vi.producto_id = p.id
            ORDER BY vi.venta_id DESC
        `);
        res.json(items);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/products/search', async (req, res) => {
    try {
        res.setHeader('Cache-Control', 'no-cache');
        const { q, category } = req.query;
        console.log('🔍 Search request:', { q, category });

        // Obtener todos los productos
        let query = "SELECT * FROM productos";
        let conditions = [];
        let params = [];

        if (category) {
            conditions.push("categoria = ?");
            params.push(category);
        }
        if (conditions.length > 0) {
            query += " WHERE " + conditions.join(" AND ");
        }
        query += " ORDER BY nombre";

        let products = await dbAll(query, params);
        console.log('📦 Products before filter:', products.length);

        // Filtrar por búsqueda si hay q, ignorando acentos
        if (q) {
            const normalizedQ = removeAccents(q.toLowerCase());
            console.log('🔤 Normalized query:', normalizedQ);
            products = products.filter(product => {
                const normalizedName = removeAccents(product.nombre.toLowerCase());
                const matches = normalizedName.includes(normalizedQ) || product.codigo.toLowerCase().includes(q.toLowerCase());
                if (matches) console.log('✅ Match:', product.nombre, '->', normalizedName);
                return matches;
            });
        }

        console.log('📋 Products after filter:', products.length);
        res.json(products);
    } catch (error) {
        console.error('❌ Search error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/products/:id', async (req, res) => {
    try {
        const product = await dbAll("SELECT * FROM productos WHERE id = ?", [req.params.id]);
        if (product.length === 0) {
            return res.status(404).json({ error: 'Producto no encontrado' });
        }
        res.json(product[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// >>> NUEVA RUTA para crear productos
app.post('/api/products', async (req, res) => {
    const { codigo, nombre, descripcion, precio, stock, categoria } = req.body;

    // Validaciones
    if (!codigo || !nombre || precio === undefined || stock === undefined) {
        return res.status(400).json({ error: 'Código, nombre, precio y stock son campos requeridos' });
    }

    if (typeof precio !== 'number' || precio < 0) {
        return res.status(400).json({ error: 'El precio debe ser un número positivo' });
    }

    if (typeof stock !== 'number' || stock < 0 || !Number.isInteger(stock)) {
        return res.status(400).json({ error: 'El stock debe ser un número entero positivo' });
    }

    try {
        // Verificar que el código no esté duplicado
        const existingProduct = await dbAll("SELECT id FROM productos WHERE codigo = ?", [codigo]);
        if (existingProduct.length > 0) {
            return res.status(400).json({ error: 'Ya existe un producto con este código' });
        }

        // Insertar el nuevo producto
        const result = await dbRun(
            `INSERT INTO productos (codigo, nombre, descripcion, precio, stock, categoria)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [codigo, nombre, descripcion || '', precio, stock, categoria || '']
        );

        // Obtener el producto recién creado
        const newProduct = await dbAll("SELECT * FROM productos WHERE id = ?", [result.id]);

        res.status(201).json({
            success: true,
            message: 'Producto creado exitosamente',
            product: newProduct[0]
        });

    } catch (error) {
        console.error('Error creando producto:', error);
        res.status(500).json({ error: 'Error interno del servidor: ' + error.message });
    }
});

// >>> NUEVA RUTA para actualizar productos
app.put('/api/products/:id', async (req, res) => {
    const { codigo, nombre, descripcion, precio, stock, categoria } = req.body;
    const productId = req.params.id;

    try {
        // Verificar que el producto existe
        const existingProduct = await dbAll("SELECT * FROM productos WHERE id = ?", [productId]);
        if (existingProduct.length === 0) {
            return res.status(404).json({ error: 'Producto no encontrado' });
        }

        // Verificar que el código no esté duplicado (excepto para el mismo producto)
        if (codigo) {
            const duplicateCode = await dbAll("SELECT id FROM productos WHERE codigo = ? AND id != ?", [codigo, productId]);
            if (duplicateCode.length > 0) {
                return res.status(400).json({ error: 'El código ya existe para otro producto' });
            }
        }

        // Construir la consulta de actualización dinámicamente
        const updates = [];
        const params = [];

        if (codigo !== undefined) {
            updates.push("codigo = ?");
            params.push(codigo);
        }
        if (nombre !== undefined) {
            updates.push("nombre = ?");
            params.push(nombre);
        }
        if (descripcion !== undefined) {
            updates.push("descripcion = ?");
            params.push(descripcion);
        }
        if (precio !== undefined) {
            updates.push("precio = ?");
            params.push(parseFloat(precio));
        }
        if (stock !== undefined) {
            updates.push("stock = ?");
            params.push(parseInt(stock));
        }
        if (categoria !== undefined) {
            updates.push("categoria = ?");
            params.push(categoria);
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'No se proporcionaron campos para actualizar' });
        }

        // Agregar el ID al final de los parámetros
        params.push(productId);

        const query = `UPDATE productos SET ${updates.join(", ")} WHERE id = ?`;
        const result = await dbRun(query, params);

        if (result.changes === 0) {
            return res.status(404).json({ error: 'Producto no encontrado' });
        }

        // Obtener el producto actualizado
        const updatedProduct = await dbAll("SELECT * FROM productos WHERE id = ?", [productId]);

        res.json({
            success: true,
            message: 'Producto actualizado exitosamente',
            product: updatedProduct[0]
        });

    } catch (error) {
        console.error('Error actualizando producto:', error);
        res.status(500).json({ error: 'Error interno del servidor: ' + error.message });
    }
});

app.post('/api/sales', async (req, res) => {
    const { items, paymentMethod, metodo_pago, pagos, vuelto } = req.body;
    // Determinar método de pago: usar pagos detallados si existen, sino el método simple
    let metodoPago;
    if (pagos && Array.isArray(pagos) && pagos.length > 0) {
        // Si hay pagos detallados, guardarlos como JSON
        metodoPago = JSON.stringify(pagos);
    } else {
        // Método de pago simple (compatibilidad hacia atrás)
        metodoPago = paymentMethod || metodo_pago || 'efectivo';
    }

    if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'La venta debe incluir al menos un item válido' });
    }

    try {
        // Calcular total usando los precios finales ya calculados en el frontend
        let total = 0;
        const itemsWithDiscounts = items.map(item => {
            const precioFinal = item.precio_final || (item.precio * item.cantidad);
            total += precioFinal;

            return {
                ...item,
                descuento_porcentaje: item.descuento_porcentaje || 0,
                descuento_aplicado: item.descuento_aplicado || 0,
                precio_final: precioFinal
            };
        });

        const facturaNumber = `FAC-${Date.now()}`;

        // Logging de tiempo para debug
        const now = new Date();
        console.log('🕒 Tiempo actual del servidor - UTC:', now.toISOString());
        console.log('🕒 Tiempo actual del servidor - Local:', now.toLocaleString());
        console.log('🕒 Timestamp para factura:', Date.now());

        // Iniciar transacción
        db.exec("BEGIN TRANSACTION");
        console.log('🧾 Datos recibidos en /api/sales:', req.body);

        try {
            // Insertar venta
            const saleResult = dbRun(
                "INSERT INTO ventas (numero_factura, total, metodo_pago, vuelto) VALUES (?, ?, ?, ?)",
                [facturaNumber, total, metodoPago, vuelto || 0]
            );

            // Insertar items con descuentos y actualizar stock
            for (const item of itemsWithDiscounts) {
                dbRun(
                    `INSERT INTO venta_items (venta_id, producto_id, cantidad, precio_unitario, descuento_porcentaje, descuento_aplicado, subtotal)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [saleResult.id, item.id, item.cantidad, item.precio, item.descuento_porcentaje, item.descuento_aplicado, item.precio_final]
                );
                dbRun(
                    "UPDATE productos SET stock = stock - ? WHERE id = ? AND stock >= ?",
                    [item.cantidad, item.id, item.cantidad]
                );
            }

            db.exec("COMMIT");

            res.json({
                success: true,
                factura: facturaNumber,
                total: total,
                saleId: saleResult.id,
                itemsWithDiscounts: itemsWithDiscounts,
                message: 'Venta registrada exitosamente en SQLite'
            });

        } catch (error) {
            db.exec("ROLLBACK");
            throw error;
        }

    } catch (error) {
        res.status(500).json({
            error: 'Error procesando la venta: ' + error.message
        });
    }
});

// Ruta para obtener estadísticas
app.get('/api/stats', async (req, res) => {
    try {
        const totalProducts = await dbAll("SELECT COUNT(*) as count FROM productos");
        const totalSales = await dbAll("SELECT COUNT(*) as count FROM ventas");
        const totalRevenue = await dbAll("SELECT SUM(total) as total FROM ventas");
        
        // Obtener productos más vendidos
        const topProducts = await dbAll(`
            SELECT
                p.id,
                p.nombre,
                p.codigo,
                SUM(vi.cantidad) as total_vendido
            FROM venta_items vi
            JOIN productos p ON vi.producto_id = p.id
            GROUP BY p.id
            ORDER BY total_vendido DESC
        `);

        res.json({
            total_products: totalProducts[0].count,
            total_sales: totalSales[0].count,
            total_revenue: totalRevenue[0].total || 0,
            top_products: topProducts
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Ruta para calcular cierre de caja (preview)
app.post('/api/close-register-preview', async (req, res) => {
    try {
        const { fecha, dineroInicial } = req.body;

        // Validar dinero inicial
        const initialAmount = parseFloat(dineroInicial || 0);
        if (isNaN(initialAmount) || initialAmount < 0) {
            return res.status(400).json({ error: 'El dinero inicial debe ser un número positivo' });
        }

        // Obtener la fecha del último cierre del día
        const lastClose = await dbAll(`
            SELECT fecha FROM cierres_caja
            WHERE DATE(fecha) = DATE(?)
            ORDER BY fecha DESC
            LIMIT 1
        `, [fecha || new Date().toISOString()]);

        console.log('Last close found:', lastClose);

        // Construir condición de fecha para ventas
        let dateCondition = "DATE(created_at) = DATE(?)";
        let dateParams = [fecha || new Date().toISOString()];

        if (lastClose.length > 0) {
            // Si hay un cierre anterior hoy, solo contar ventas después de ese cierre
            // Convertir created_at a formato ISO para comparación
            dateCondition = "datetime(created_at) > datetime(?)";
            dateParams = [lastClose[0].fecha];
            console.log('Using last close time:', lastClose[0].fecha);
        } else {
            console.log('No previous close today, counting all sales for date:', fecha || new Date().toISOString());
        }

        // Obtener total de ventas desde el último cierre
        const dailySales = await dbAll(`
            SELECT
                SUM(total) as total,
                COUNT(*) as cantidad
            FROM ventas
            WHERE ${dateCondition}
        `, dateParams);

        // Calcular total esperado
        const totalVentas = parseFloat(dailySales[0].total || 0);
        const totalEsperado = initialAmount + totalVentas;

        // Para preview, el dinero contado es igual al esperado (diferencia = 0)
        const countedAmount = totalEsperado;
        const diferencia = 0;

        // Obtener detalles de ventas desde el último cierre
        const salesDetails = await dbAll(`
            SELECT
                v.id,
                v.numero_factura,
                v.total,
                v.metodo_pago,
                v.created_at,
                GROUP_CONCAT(
                    JSON_OBJECT(
                        'producto_id', vi.producto_id,
                        'nombre', p.nombre,
                        'cantidad', vi.cantidad,
                        'precio_unitario', vi.precio_unitario,
                        'descuento_porcentaje', COALESCE(vi.descuento_porcentaje, 0),
                        'descuento_aplicado', COALESCE(vi.descuento_aplicado, 0),
                        'subtotal', vi.subtotal
                    )
                ) as items
            FROM ventas v
            LEFT JOIN venta_items vi ON v.id = vi.venta_id
            LEFT JOIN productos p ON vi.producto_id = p.id
            WHERE ${dateCondition.replace('created_at', 'v.created_at')}
            GROUP BY v.id
        `, dateParams);

        // Procesar items JSON
        const processedSales = salesDetails.map(sale => ({
            ...sale,
            items: sale.items ? JSON.parse(`[${sale.items}]`) : []
        }));

        // Calcular totales por método de pago
        const paymentTotals = {};
        processedSales.forEach(sale => {
            let metodoPago = sale.metodo_pago;

            // Intentar parsear como JSON si contiene información detallada de pagos
            try {
                const parsed = JSON.parse(sale.metodo_pago);
                if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].metodo) {
                    // Es un array de pagos detallados
                    parsed.forEach(pago => {
                        const metodo = pago.metodo.toUpperCase();
                        const monto = parseFloat(pago.monto || 0);
                        paymentTotals[metodo] = (paymentTotals[metodo] || 0) + monto;
                    });
                    return;
                }
            } catch (e) {
                // No es JSON, mantener como string simple
                metodoPago = sale.metodo_pago;
            }

            // Método de pago simple
            const metodo = metodoPago.toUpperCase();
            paymentTotals[metodo] = (paymentTotals[metodo] || 0) + parseFloat(sale.total || 0);
        });

        res.json({
            success: true,
            dinero_inicial: initialAmount,
            dinero_contado: countedAmount,
            total: totalVentas,
            total_esperado: totalEsperado,
            diferencia: diferencia,
            cantidad_ventas: dailySales[0].cantidad || 0,
            ventas: processedSales,
            payment_totals: paymentTotals,
            fecha: fecha || new Date().toISOString(),
            preview: true // Indica que es solo preview
        });

    } catch (error) {
        console.error('Error en preview de cierre de caja:', error);
        res.status(500).json({
            error: 'Error en preview de cierre de caja: ' + error.message
        });
    }
});

// Ruta para confirmar y guardar cierre de caja
app.post('/api/close-register-confirm', async (req, res) => {
    try {
        const { fecha, dinero_inicial, total, total_esperado, diferencia, cantidad_ventas } = req.body;

        // Guardar el cierre en la base de datos
        await dbRun(
            `INSERT INTO cierres_caja
            (fecha, dinero_inicial, total_ventas, total_esperado, diferencia, cantidad_ventas)
            VALUES (?, ?, ?, ?, ?, ?)`,
            [fecha, dinero_inicial, total, total_esperado, diferencia, cantidad_ventas]
        );

        res.json({
            success: true,
            message: 'Cierre de caja confirmado y registrado exitosamente'
        });

    } catch (error) {
        console.error('Error confirmando cierre de caja:', error);
        res.status(500).json({
            error: 'Error confirmando cierre de caja: ' + error.message
        });
    }
});

// Ruta para cierre de caja (legacy - mantiene compatibilidad)
app.post('/api/close-register', async (req, res) => {
    try {
        const { fecha, dineroInicial, dineroContado } = req.body;

        // Validar dinero inicial
        const initialAmount = parseFloat(dineroInicial || 0);
        if (isNaN(initialAmount) || initialAmount < 0) {
            return res.status(400).json({ error: 'El dinero inicial debe ser un número positivo' });
        }

        // Obtener la fecha del último cierre del día
        const lastClose = await dbAll(`
            SELECT fecha FROM cierres_caja
            WHERE DATE(fecha) = DATE(?)
            ORDER BY fecha DESC
            LIMIT 1
        `, [fecha || new Date().toISOString()]);

        console.log('Last close found:', lastClose);

        // Construir condición de fecha para ventas
        let dateCondition = "DATE(created_at) = DATE(?)";
        let dateParams = [fecha || new Date().toISOString()];

        if (lastClose.length > 0) {
            // Si hay un cierre anterior hoy, solo contar ventas después de ese cierre
            // Convertir created_at a formato ISO para comparación
            dateCondition = "datetime(created_at) > datetime(?)";
            dateParams = [lastClose[0].fecha];
            console.log('Using last close time:', lastClose[0].fecha);
        } else {
            console.log('No previous close today, counting all sales for date:', fecha || new Date().toISOString());
        }

        // Obtener total de ventas desde el último cierre
        const dailySales = await dbAll(`
            SELECT
                SUM(total) as total,
                COUNT(*) as cantidad
            FROM ventas
            WHERE ${dateCondition}
        `, dateParams);

        // Calcular total esperado
        const totalVentas = parseFloat(dailySales[0].total || 0);
        const totalEsperado = initialAmount + totalVentas;
        console.log('Calculations:', { initialAmount, totalVentas, totalEsperado, dineroContado });

        // Determinar dinero contado
        let countedAmount;
        if (dineroContado === 'auto') {
            // Modo automático: usar el total esperado como dinero contado
            countedAmount = totalEsperado;
            console.log('Auto mode: countedAmount =', countedAmount);
        } else {
            // Modo manual: validar el valor proporcionado
            countedAmount = parseFloat(dineroContado || 0);
            if (isNaN(countedAmount) || countedAmount < 0) {
                return res.status(400).json({ error: 'El dinero contado debe ser un número positivo' });
            }
        }

        // Obtener detalles de ventas desde el último cierre
        const salesDetails = await dbAll(`
            SELECT
                v.id,
                v.numero_factura,
                v.total,
                v.metodo_pago,
                v.created_at,
                GROUP_CONCAT(
                    JSON_OBJECT(
                        'producto_id', vi.producto_id,
                        'nombre', p.nombre,
                        'cantidad', vi.cantidad,
                        'precio_unitario', vi.precio_unitario,
                        'descuento_porcentaje', COALESCE(vi.descuento_porcentaje, 0),
                        'descuento_aplicado', COALESCE(vi.descuento_aplicado, 0),
                        'subtotal', vi.subtotal
                    )
                ) as items
            FROM ventas v
            LEFT JOIN venta_items vi ON v.id = vi.venta_id
            LEFT JOIN productos p ON vi.producto_id = p.id
            WHERE ${dateCondition.replace('created_at', 'v.created_at')}
            GROUP BY v.id
        `, dateParams);

        // Procesar items JSON
        const processedSales = salesDetails.map(sale => ({
            ...sale,
            items: sale.items ? JSON.parse(`[${sale.items}]`) : []
        }));

        // Calcular diferencia
        const diferencia = totalEsperado - countedAmount;

        // Guardar el cierre en la base de datos
        await dbRun(
            `INSERT INTO cierres_caja
            (fecha, dinero_inicial, total_ventas, total_esperado, diferencia, cantidad_ventas)
            VALUES (?, ?, ?, ?, ?, ?)`,
            [new Date().toISOString(), initialAmount, totalVentas, totalEsperado, diferencia, dailySales[0].cantidad || 0]
        );

        res.json({
            success: true,
            dinero_inicial: initialAmount,
            dinero_contado: countedAmount,
            total: totalVentas,
            total_esperado: totalEsperado,
            diferencia: diferencia,
            cantidad_ventas: dailySales[0].cantidad || 0,
            ventas: processedSales,
            fecha: fecha || new Date().toISOString()
        });

    } catch (error) {
        console.error('Error en el cierre de caja:', error);
        res.status(500).json({
            error: 'Error en el cierre de caja: ' + error.message
        });
    }
});

// Ruta para obtener historial de cierres
app.get('/api/cierres', async (req, res) => {
    try {
        const cierres = await dbAll(`
            SELECT * FROM cierres_caja
            ORDER BY fecha DESC
        `);
        res.json(cierres);
    } catch (error) {
        res.status(500).json({
            error: 'Error obteniendo historial de cierres: ' + error.message
        });
    }
});

// Ruta para resetear datos de ventas y cierres (para testing)
app.post('/api/reset-data', authMiddleware, async (req, res) => {
    try {
        // Iniciar transacción
        db.exec("BEGIN TRANSACTION");

        try {
            // Eliminar todos los items de venta
            dbRun("DELETE FROM venta_items");

            // Eliminar todas las ventas
            dbRun("DELETE FROM ventas");

            // Eliminar todos los cierres de caja
            dbRun("DELETE FROM cierres_caja");

            // Resetear stock de productos (opcional, comentado)
            // dbRun("UPDATE productos SET stock = 0");

            db.exec("COMMIT");

            res.json({
                success: true,
                message: 'Datos de ventas y cierres reseteados exitosamente. Los productos permanecen intactos.'
            });

        } catch (error) {
            db.exec("ROLLBACK");
            throw error;
        }

    } catch (error) {
        console.error('Error reseteando datos:', error);
        res.status(500).json({
            error: 'Error reseteando datos: ' + error.message
        });
    }
});

// >>> RUTAS PARA PROVEEDORES (SUPPLIERS)

// Obtener todos los proveedores
app.get('/api/suppliers', async (req, res) => {
    try {
        const suppliers = await dbAll("SELECT * FROM proveedores ORDER BY nombre_proveedor");
        res.json(suppliers);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Obtener un proveedor por ID
app.get('/api/suppliers/:id', async (req, res) => {
    try {
        const supplier = await dbAll("SELECT * FROM proveedores WHERE id = ?", [req.params.id]);
        if (supplier.length === 0) {
            return res.status(404).json({ error: 'Proveedor no encontrado' });
        }
        res.json(supplier[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Crear nuevo proveedor
app.post('/api/suppliers', async (req, res) => {
    const { nombre_proveedor, nombre_contacto, telefono, email, productos_servicios, condiciones_pago, estatus, notas } = req.body;

    // Validaciones
    if (!nombre_proveedor || nombre_proveedor.trim() === '') {
        return res.status(400).json({ error: 'El nombre del proveedor es requerido' });
    }

    try {
        const result = await dbRun(
            `INSERT INTO proveedores (nombre_proveedor, nombre_contacto, telefono, email, productos_servicios, condiciones_pago, estatus, notas)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [nombre_proveedor.trim(), nombre_contacto || '', telefono || '', email || '', productos_servicios || '', condiciones_pago || '', estatus || 'Activo', notas || '']
        );

        const newSupplier = await dbAll("SELECT * FROM proveedores WHERE id = ?", [result.id]);

        res.status(201).json({
            success: true,
            message: 'Proveedor creado exitosamente',
            supplier: newSupplier[0]
        });

    } catch (error) {
        console.error('Error creando proveedor:', error);
        res.status(500).json({ error: 'Error interno del servidor: ' + error.message });
    }
});

// Actualizar proveedor
app.put('/api/suppliers/:id', async (req, res) => {
    const { nombre_proveedor, nombre_contacto, telefono, email, productos_servicios, condiciones_pago, estatus, notas } = req.body;
    const supplierId = req.params.id;

    try {
        // Verificar que el proveedor existe
        const existingSupplier = await dbAll("SELECT * FROM proveedores WHERE id = ?", [supplierId]);
        if (existingSupplier.length === 0) {
            return res.status(404).json({ error: 'Proveedor no encontrado' });
        }

        // Validar nombre si se proporciona
        if (nombre_proveedor !== undefined && (!nombre_proveedor || nombre_proveedor.trim() === '')) {
            return res.status(400).json({ error: 'El nombre del proveedor no puede estar vacío' });
        }

        // Construir consulta de actualización dinámicamente
        const updates = [];
        const params = [];

        if (nombre_proveedor !== undefined) {
            updates.push("nombre_proveedor = ?");
            params.push(nombre_proveedor.trim());
        }
        if (nombre_contacto !== undefined) {
            updates.push("nombre_contacto = ?");
            params.push(nombre_contacto);
        }
        if (telefono !== undefined) {
            updates.push("telefono = ?");
            params.push(telefono);
        }
        if (email !== undefined) {
            updates.push("email = ?");
            params.push(email);
        }
        if (productos_servicios !== undefined) {
            updates.push("productos_servicios = ?");
            params.push(productos_servicios);
        }
        if (condiciones_pago !== undefined) {
            updates.push("condiciones_pago = ?");
            params.push(condiciones_pago);
        }
        if (estatus !== undefined) {
            updates.push("estatus = ?");
            params.push(estatus);
        }
        if (notas !== undefined) {
            updates.push("notas = ?");
            params.push(notas);
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'No se proporcionaron campos para actualizar' });
        }

        params.push(supplierId);
        const query = `UPDATE proveedores SET ${updates.join(", ")} WHERE id = ?`;
        const result = await dbRun(query, params);

        if (result.changes === 0) {
            return res.status(404).json({ error: 'Proveedor no encontrado' });
        }

        const updatedSupplier = await dbAll("SELECT * FROM proveedores WHERE id = ?", [supplierId]);

        res.json({
            success: true,
            message: 'Proveedor actualizado exitosamente',
            supplier: updatedSupplier[0]
        });

    } catch (error) {
        console.error('Error actualizando proveedor:', error);
        res.status(500).json({ error: 'Error interno del servidor: ' + error.message });
    }
});

// Eliminar proveedor
app.delete('/api/suppliers/:id', async (req, res) => {
    try {
        const supplierId = req.params.id;

        // Verificar que el proveedor existe
        const existingSupplier = await dbAll("SELECT * FROM proveedores WHERE id = ?", [supplierId]);
        if (existingSupplier.length === 0) {
            return res.status(404).json({ error: 'Proveedor no encontrado' });
        }

        await dbRun("DELETE FROM proveedores WHERE id = ?", [supplierId]);

        res.json({
            success: true,
            message: 'Proveedor eliminado exitosamente'
        });

    } catch (error) {
        console.error('Error eliminando proveedor:', error);
        res.status(500).json({ error: 'Error interno del servidor: ' + error.message });
    }
});


// >>> RUTAS PARA PROMOCIONES

// Obtener todas las promociones con sus productos
app.get('/api/promotions', async (req, res) => {
    try {
        // Get promotions
        const promotions = await dbAll(`
            SELECT id, nombre, created_at
            FROM promociones
            ORDER BY created_at DESC
        `);

        // Get products for each promotion
        const processedPromotions = [];
        for (const promo of promotions) {
            const products = await dbAll(`
                SELECT
                    pp.producto_id,
                    pp.descuento_porcentaje,
                    prod.nombre,
                    prod.codigo,
                    prod.precio as precio_original,
                    ROUND(prod.precio * (1 - pp.descuento_porcentaje / 100.0), 2) as precio_con_descuento
                FROM promocion_productos pp
                JOIN productos prod ON pp.producto_id = prod.id
                WHERE pp.promocion_id = ?
                ORDER BY prod.nombre
            `, [promo.id]);

            processedPromotions.push({
                ...promo,
                productos: products
            });
        }

        res.json(processedPromotions);
    } catch (error) {
        console.error('Error obteniendo promociones:', error);
        res.status(500).json({ error: error.message });
    }
});

// Crear nueva promoción
app.post('/api/promotions', async (req, res) => {
    const { nombre, productos } = req.body;

    if (!nombre || !productos || !Array.isArray(productos) || productos.length === 0) {
        return res.status(400).json({ error: 'Nombre y productos son requeridos' });
    }

    try {
        // Iniciar transacción
        db.exec("BEGIN TRANSACTION");

        try {
            // Crear promoción
            const promoResult = dbRun(
                "INSERT INTO promociones (nombre) VALUES (?)",
                [nombre]
            );

            // Agregar productos a la promoción
            for (const producto of productos) {
                if (!producto.producto_id || producto.descuento_porcentaje === undefined) {
                    throw new Error('Producto ID y descuento son requeridos');
                }
                if (producto.descuento_porcentaje < 0 || producto.descuento_porcentaje > 100) {
                    throw new Error('El descuento debe estar entre 0 y 100');
                }

                dbRun(
                    "INSERT INTO promocion_productos (promocion_id, producto_id, descuento_porcentaje) VALUES (?, ?, ?)",
                    [promoResult.id, producto.producto_id, producto.descuento_porcentaje]
                );
            }

            db.exec("COMMIT");

            res.status(201).json({
                success: true,
                message: 'Promoción creada exitosamente',
                promotion: { id: promoResult.id, nombre, productos }
            });

        } catch (error) {
            db.exec("ROLLBACK");
            throw error;
        }

    } catch (error) {
        console.error('Error creando promoción:', error);
        res.status(500).json({ error: 'Error interno del servidor: ' + error.message });
    }
});

// Actualizar promoción
app.put('/api/promotions/:id', async (req, res) => {
    const { nombre, productos } = req.body;
    const promotionId = req.params.id;

    if (!nombre || !productos || !Array.isArray(productos)) {
        return res.status(400).json({ error: 'Nombre y productos son requeridos' });
    }

    try {
        // Verificar que la promoción existe
        const existingPromo = await dbAll("SELECT * FROM promociones WHERE id = ?", [promotionId]);
        if (existingPromo.length === 0) {
            return res.status(404).json({ error: 'Promoción no encontrada' });
        }

        try {
            // Actualizar nombre de la promoción
            await dbRun("UPDATE promociones SET nombre = ? WHERE id = ?", [nombre, promotionId]);

            // Eliminar productos existentes
            await dbRun("DELETE FROM promocion_productos WHERE promocion_id = ?", [promotionId]);

            // Agregar productos actualizados
            for (const producto of productos) {
                if (!producto.producto_id || producto.descuento_porcentaje === undefined) {
                    throw new Error('Producto ID y descuento son requeridos');
                }
                if (producto.descuento_porcentaje < 0 || producto.descuento_porcentaje > 100) {
                    throw new Error('El descuento debe estar entre 0 y 100');
                }

                await dbRun(
                    "INSERT INTO promocion_productos (promocion_id, producto_id, descuento_porcentaje) VALUES (?, ?, ?)",
                    [promotionId, producto.producto_id, producto.descuento_porcentaje]
                );
            }

            res.json({
                success: true,
                message: 'Promoción actualizada exitosamente'
            });

        } catch (error) {
            console.error('Error actualizando promoción:', error);
            res.status(500).json({ error: 'Error interno del servidor: ' + error.message });
        }

    } catch (error) {
        console.error('Error actualizando promoción:', error);
        res.status(500).json({ error: 'Error interno del servidor: ' + error.message });
    }
});

// Eliminar promoción
app.delete('/api/promotions/:id', async (req, res) => {
    try {
        const promotionId = req.params.id;

        // Verificar que la promoción existe
        const existingPromo = await dbAll("SELECT * FROM promociones WHERE id = ?", [promotionId]);
        if (existingPromo.length === 0) {
            return res.status(404).json({ error: 'Promoción no encontrada' });
        }

        // Eliminar promoción (los productos se eliminan automáticamente por CASCADE)
        await dbRun("DELETE FROM promociones WHERE id = ?", [promotionId]);

        res.json({
            success: true,
            message: 'Promoción eliminada exitosamente'
        });

    } catch (error) {
        console.error('Error eliminando promoción:', error);
        res.status(500).json({ error: 'Error interno del servidor: ' + error.message });
    }
});

// Obtener promociones aplicables para productos específicos
app.post('/api/promotions/check', async (req, res) => {
    try {
        const { productIds } = req.body;

        if (!Array.isArray(productIds) || productIds.length === 0) {
            return res.json([]);
        }

        // Obtener promociones que contengan cualquiera de los productos
        const promotions = await dbAll(`
            SELECT DISTINCT
                p.id,
                p.nombre,
                pp.producto_id,
                pp.descuento_porcentaje,
                prod.nombre as producto_nombre,
                prod.precio as precio_original
            FROM promociones p
            JOIN promocion_productos pp ON p.id = pp.promocion_id
            JOIN productos prod ON pp.producto_id = prod.id
            WHERE pp.producto_id IN (${productIds.map(() => '?').join(',')})
            ORDER BY p.id, pp.producto_id
        `, productIds);

        // Agrupar por promoción
        const groupedPromotions = {};
        promotions.forEach(promo => {
            if (!groupedPromotions[promo.id]) {
                groupedPromotions[promo.id] = {
                    id: promo.id,
                    nombre: promo.nombre,
                    productos: []
                };
            }
            groupedPromotions[promo.id].productos.push({
                producto_id: promo.producto_id,
                nombre: promo.producto_nombre,
                precio_original: promo.precio_original,
                descuento_porcentaje: promo.descuento_porcentaje,
                precio_con_descuento: promo.precio_original * (1 - promo.descuento_porcentaje / 100)
            });
        });

        res.json(Object.values(groupedPromotions));

    } catch (error) {
        console.error('Error obteniendo promociones aplicables:', error);
        res.status(500).json({ error: error.message });
    }
});

// Ruta de diagnóstico
app.get('/api/diagnostic', async (req, res) => {
    try {
        const productCount = await dbAll("SELECT COUNT(*) as count FROM productos");
        const salesCount = await dbAll("SELECT COUNT(*) as count FROM ventas");

        res.json({
            database: 'SQLite',
            file: 'pos_database.sqlite',
            total_products: productCount[0].count,
            total_sales: salesCount[0].count,
            status: 'OK',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            error: error.message,
            database: 'SQLite',
            status: 'ERROR'
        });
    }
});

// Ruta para establecer hora del sistema
app.post('/api/set-time', authMiddleware, (req, res) => {
    const { date, time } = req.body;
    if (!date || !time) {
        return res.status(400).json({ error: 'Fecha y hora son requeridas' });
    }

    // Convertir formato: date es YYYY-MM-DD, time es HH:MM
    const dateTimeStr = `${date}T${time}:00`; // YYYY-MM-DDTHH:MM:00
    const psCommand = `Set-Date -Date "${dateTimeStr}"`;

    console.log('🕒 Setting system date/time to:', dateTimeStr);

    // Ejecutar comando PowerShell
    exec(`powershell -Command "${psCommand}"`, (error, stdout, stderr) => {
        if (error) {
            console.error('Error setting date/time:', error);
            let errorMsg = 'Error al establecer fecha/hora: ' + error.message;
            if (error.message.includes('privilegio requerido')) {
                errorMsg += '. Asegúrese de ejecutar el servidor como administrador.';
            }
            return res.status(500).json({ error: errorMsg });
        }
        console.log('Date/time set successfully');
        res.json({ success: true, message: 'Hora del sistema actualizada correctamente' });
    });
});

// Rutas para servir páginas HTML (AGREGADO)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../Frontend/index.html'));
});

app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, '../Frontend/dashboard.html'));
});

// Manejo de errores
app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
});


// Endpoint temporal para mostrar PDF generado (sin autenticación - solo para demo)
app.post('/api/demo-pdf', async (req, res) => {
    try {
        const { dateFrom, dateTo } = req.body;

        // Obtener facturas en el rango de fechas
        let salesQuery = "SELECT * FROM ventas WHERE 1=1";
        let salesParams = [];

        if (dateFrom) {
            salesQuery += " AND DATE(created_at) >= DATE(?)";
            salesParams.push(dateFrom);
        }

        if (dateTo) {
            salesQuery += " AND DATE(created_at) <= DATE(?)";
            salesParams.push(dateTo);
        }

        salesQuery += " ORDER BY created_at DESC LIMIT 5"; // Solo 5 para demo

        const sales = await dbAll(salesQuery, salesParams);

        // Obtener cierres de caja en el rango de fechas
        let cierresQuery = "SELECT * FROM cierres_caja WHERE 1=1";
        let cierresParams = [];

        if (dateFrom) {
            cierresQuery += " AND DATE(fecha) >= DATE(?)";
            cierresParams.push(dateFrom);
        }

        if (dateTo) {
            cierresQuery += " AND DATE(fecha) <= DATE(?)";
            cierresParams.push(dateTo);
        }

        cierresQuery += " ORDER BY fecha DESC LIMIT 3"; // Solo 3 para demo

        const cierres = await dbAll(cierresQuery, cierresParams);

        // Generar nombre único para el PDF
        const timestamp = Date.now();
        const fileName = `demo-reporte-pos-${timestamp}.pdf`;
        const filePath = path.join(__dirname, 'temp', fileName);

        // Asegurar que existe el directorio temp
        const tempDir = path.join(__dirname, 'temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        // Crear PDF y guardarlo
        const doc = new PDFDocument();
        const writeStream = fs.createWriteStream(filePath);

        doc.pipe(writeStream);

        // Contenido del PDF (versión mejorada)
        doc.fontSize(20).text('REPORTE DEL SISTEMA POS', { align: 'center' });
        doc.moveDown();
        doc.fontSize(10).text(`Fecha de generación: ${new Date().toLocaleString('es-AR')}`, { align: 'right' });
        doc.text(`Período del reporte: ${dateFrom || 'Todo el historial'} - ${dateTo || 'Fecha actual'}`, { align: 'right' });
        doc.moveDown(2);

        // Línea separadora
        doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
        doc.moveDown(1);

        // Sección de Facturas
        doc.fontSize(16).text('VENTAS REGISTRADAS', { underline: true });
        doc.moveDown(0.5);

        if (sales.length === 0) {
            doc.fontSize(10).text('No se encontraron ventas en el período seleccionado.', { align: 'center' });
            doc.moveDown();
        } else {
            // Encabezados de tabla de ventas
            const tableTop = doc.y;
            doc.fontSize(9).font('Helvetica-Bold');
            doc.text('N° Factura', 50, tableTop);
            doc.text('Fecha', 150, tableTop);
            doc.text('Total', 280, tableTop);
            doc.text('Método de Pago', 350, tableTop);
            doc.text('Vuelto', 480, tableTop);

            // Línea bajo encabezados
            doc.moveTo(50, doc.y + 5).lineTo(550, doc.y + 5).stroke();
            doc.moveDown(0.5);

            // Datos de ventas
            doc.font('Helvetica').fontSize(8);
            sales.forEach((sale, index) => {
                const y = doc.y;
                doc.text(sale.numero_factura, 50, y);
                doc.text(new Date(sale.created_at).toLocaleDateString('es-AR'), 150, y);
                doc.text(`$${sale.total.toFixed(2)}`, 280, y);
                doc.text(sale.metodo_pago.toUpperCase(), 350, y);
                doc.text(`$${(sale.vuelto || 0).toFixed(2)}`, 480, y);
                doc.moveDown(0.3);

                // Línea separadora cada 5 ventas
                if ((index + 1) % 5 === 0 && index < sales.length - 1) {
                    doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
                    doc.moveDown(0.2);
                }
            });

            // Total de ventas
            doc.moveDown(0.5);
            const totalVentas = sales.reduce((sum, sale) => sum + sale.total, 0);
            doc.font('Helvetica-Bold').fontSize(10);
            doc.text(`TOTAL VENTAS: $${totalVentas.toFixed(2)}`, 350, doc.y, { align: 'right' });
            doc.text(`Cantidad: ${sales.length} facturas`, 50, doc.y);
        }

        doc.moveDown(2);

        // Línea separadora
        doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
        doc.moveDown(1);

        // Sección de Cierres de Caja
        doc.fontSize(16).text('CIERRES DE CAJA', { underline: true });
        doc.moveDown(0.5);

        if (cierres.length === 0) {
            doc.fontSize(10).text('No se encontraron cierres de caja en el período seleccionado.', { align: 'center' });
            doc.moveDown();
        } else {
            // Encabezados de tabla de cierres
            const tableTop2 = doc.y;
            doc.fontSize(9).font('Helvetica-Bold');
            doc.text('Fecha', 50, tableTop2);
            doc.text('Dinero Inicial', 150, tableTop2);
            doc.text('Total Ventas', 250, tableTop2);
            doc.text('Total Esperado', 350, tableTop2);
            doc.text('Diferencia', 450, tableTop2);
            doc.text('Cant. Ventas', 520, tableTop2);

            // Línea bajo encabezados
            doc.moveTo(50, doc.y + 5).lineTo(550, doc.y + 5).stroke();
            doc.moveDown(0.5);

            // Datos de cierres
            doc.font('Helvetica').fontSize(8);
            cierres.forEach((cierre, index) => {
                const y = doc.y;
                doc.text(new Date(cierre.fecha).toLocaleDateString('es-AR'), 50, y);
                doc.text(`$${cierre.dinero_inicial.toFixed(2)}`, 150, y);
                doc.text(`$${cierre.total_ventas.toFixed(2)}`, 250, y);
                doc.text(`$${cierre.total_esperado.toFixed(2)}`, 350, y);
                doc.text(`$${cierre.diferencia.toFixed(2)}`, 450, y);
                doc.text(cierre.cantidad_ventas.toString(), 530, y);
                doc.moveDown(0.3);

                // Línea separadora cada 3 cierres
                if ((index + 1) % 3 === 0 && index < cierres.length - 1) {
                    doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
                    doc.moveDown(0.2);
                }
            });
        }

        // Pie de página
        doc.moveDown(2);
        doc.fontSize(8).font('Helvetica-Oblique');
        doc.text('Sistema POS - Reporte generado automáticamente', 50, doc.y, { align: 'center' });

        doc.end();

        // Esperar a que se complete la escritura del archivo
        writeStream.on('finish', () => {
            // Devolver la URL del PDF para descarga
            const pdfUrl = `${req.protocol}://${req.get('host')}/temp/${fileName}`;
            res.json({
                success: true,
                message: 'PDF de demostración generado exitosamente',
                pdfUrl: pdfUrl,
                fileName: fileName,
                salesCount: sales.length,
                cierresCount: cierres.length,
                note: 'Este es un PDF de ejemplo con datos limitados para demostración'
            });
        });

        writeStream.on('error', (error) => {
            console.error('Error escribiendo PDF demo:', error);
            res.status(500).json({
                error: 'Error al guardar el PDF de demo: ' + error.message
            });
        });

    } catch (error) {
        console.error('Error generando PDF demo:', error);
        res.status(500).json({
            error: 'Error al generar el PDF de demo: ' + error.message
        });
    }
});

// Cerrar conexión al terminar
process.on('SIGINT', () => {
    db.close();
    console.log('✅ Conexión a la base de datos cerrada');
    process.exit(0);
});