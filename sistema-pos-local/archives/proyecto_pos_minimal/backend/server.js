const express = require('express');
const cors = require('cors');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const basicAuth = require('express-basic-auth');

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Autenticación básica para operaciones que modifican datos
const authMiddleware = basicAuth({
    users: { 'admin': 'pos123' },
    challenge: true,
});

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

// Configuración de SQLite
const dbPath = path.join(__dirname, 'pos_database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('❌ Error conectando a SQLite:', err.message);
    } else {
        console.log('✅ Conectado a la base de datos SQLite');
        initDatabase();
    }
});

// Inicializar la base de datos
function initDatabase() {
    db.serialize(() => {
        // Tabla productos
        db.run(`CREATE TABLE IF NOT EXISTS productos (
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
        db.run(`CREATE TABLE IF NOT EXISTS ventas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            numero_factura TEXT UNIQUE NOT NULL,
            total REAL NOT NULL,
            metodo_pago TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Tabla items_venta
        db.run(`CREATE TABLE IF NOT EXISTS venta_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            venta_id INTEGER NOT NULL,
            producto_id INTEGER NOT NULL,
            cantidad INTEGER NOT NULL,
            precio_unitario REAL NOT NULL,
            subtotal REAL NOT NULL,
            FOREIGN KEY (venta_id) REFERENCES ventas(id),
            FOREIGN KEY (producto_id) REFERENCES productos(id)
        )`);

        // Tabla cierres_caja
        db.run(`CREATE TABLE IF NOT EXISTS cierres_caja (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            fecha DATETIME DEFAULT CURRENT_TIMESTAMP,
            dinero_inicial REAL NOT NULL,
            total_ventas REAL NOT NULL,
            total_esperado REAL NOT NULL,
            diferencia REAL NOT NULL,
            cantidad_ventas INTEGER NOT NULL
        )`);

        // Verificar si hay datos
        db.get("SELECT COUNT(*) as count FROM productos", (err, row) => {
            if (row.count === 0) {
                insertSampleData();
            }
        });
    });
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

    const stmt = db.prepare(`
        INSERT INTO productos (codigo, nombre, descripcion, precio, stock, categoria) 
        VALUES (?, ?, ?, ?, ?, ?)
    `);

    productos.forEach(producto => {
        stmt.run(producto, (err) => {
            if (err) {
                console.log('⚠️  Producto ya existe:', producto[0]);
            }
        });
    });

    stmt.finalize();
    console.log('✅ Datos de ejemplo insertados en SQLite');
}

// Función para hacer queries más fácil
function dbAll(query, params = []) {
    return new Promise((resolve, reject) => {
        db.all(query, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

function dbRun(query, params = []) {
    return new Promise((resolve, reject) => {
        db.run(query, params, function(err) {
            if (err) reject(err);
            else resolve({ id: this.lastID, changes: this.changes });
        });
    });
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
                GROUP_CONCAT(
                    JSON_OBJECT(
                        'producto_id', vi.producto_id,
                        'nombre', p.nombre,
                        'cantidad', vi.cantidad,
                        'precio_unitario', vi.precio_unitario,
                        'subtotal', vi.subtotal
                    )
                ) as items
            FROM ventas v
            LEFT JOIN venta_items vi ON v.id = vi.venta_id
            LEFT JOIN productos p ON vi.producto_id = p.id
            GROUP BY v.id, v.numero_factura, v.created_at, v.total, v.metodo_pago
            ORDER BY v.created_at DESC
        `;

        const sales = await dbAll(salesQuery);

        // Procesar los items JSON para cada venta
        const processedSales = sales.map(sale => ({
            id: sale.id,
            numero_factura: sale.numero_factura,
            fecha: sale.fecha,
            total: sale.total,
            metodo_pago: sale.metodo_pago,
            items: sale.items ? JSON.parse(`[${sale.items}]`) : []
        }));

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
                p.nombre AS nombre_producto
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
        let query = "SELECT * FROM productos";
        let conditions = [];
        let params = [];

        if (q) {
            conditions.push("(nombre LIKE ? OR codigo LIKE ?)");
            params.push(`%${q}%`, `%${q}%`);
        }
        if (category) {
            conditions.push("categoria = ?");
            params.push(category);
        }
        if (conditions.length > 0) {
            query += " WHERE " + conditions.join(" AND ");
        }
        query += " ORDER BY nombre";

        const products = await dbAll(query, params);
        res.json(products);
    } catch (error) {
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
    const { items, paymentMethod, metodo_pago } = req.body;
    const metodoPago = paymentMethod || metodo_pago; // acepta ambos nombres
    
    if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'La venta debe incluir al menos un item válido' });
}

    try {
        // Calcular total
        const total = items.reduce((sum, item) => sum + (item.precio * item.cantidad), 0);
        const facturaNumber = `FAC-${Date.now()}`;

        // Iniciar transacción
        await dbRun("BEGIN TRANSACTION");
console.log('🧾 Datos recibidos en /api/sales:', req.body);

        try {
            // Insertar venta
            const saleResult = await dbRun(
                "INSERT INTO ventas (numero_factura, total, metodo_pago) VALUES (?, ?, ?)",
                [facturaNumber, total, metodoPago]
            );

            // Insertar items y actualizar stock
            for (const item of items) {
                await dbRun(
                    `INSERT INTO venta_items (venta_id, producto_id, cantidad, precio_unitario, subtotal) 
                     VALUES (?, ?, ?, ?, ?)`,
                    [saleResult.id, item.id, item.cantidad, item.precio, item.precio * item.cantidad]
                );
                await dbRun(
                    "UPDATE productos SET stock = stock - ? WHERE id = ? AND stock >= ?",
                    [item.cantidad, item.id, item.cantidad]
                );
            }

            await dbRun("COMMIT");

            res.json({
                success: true,
                factura: facturaNumber,
                total: total,
                saleId: saleResult.id,
                message: 'Venta registrada exitosamente en SQLite'
            });

        } catch (error) {
            await dbRun("ROLLBACK");
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

// Ruta para cierre de caja
app.post('/api/close-register', async (req, res) => {
    try {
        const { fecha, dineroInicial } = req.body;

        // Validar dinero inicial
        const initialAmount = parseFloat(dineroInicial || 0);
        if (isNaN(initialAmount) || initialAmount < 0) {
            return res.status(400).json({ error: 'El dinero inicial debe ser un número positivo' });
        }

        // Obtener total de ventas del día
        const dailySales = await dbAll(`
            SELECT
                SUM(total) as total,
                COUNT(*) as cantidad
            FROM ventas
            WHERE DATE(created_at) = DATE(?)
        `, [fecha || new Date().toISOString()]);

        // Obtener detalles de ventas
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
                        'subtotal', vi.subtotal
                    )
                ) as items
            FROM ventas v
            LEFT JOIN venta_items vi ON v.id = vi.venta_id
            LEFT JOIN productos p ON vi.producto_id = p.id
            WHERE DATE(v.created_at) = DATE(?)
            GROUP BY v.id
        `, [fecha || new Date().toISOString()]);

        // Procesar items JSON
        const processedSales = salesDetails.map(sale => ({
            ...sale,
            items: sale.items ? JSON.parse(`[${sale.items}]`) : []
        }));

        // Calcular total esperado y diferencia
        const totalVentas = parseFloat(dailySales[0].total || 0);
        const totalEsperado = initialAmount + totalVentas;
        const diferencia = totalEsperado - totalVentas;

        // Guardar el cierre en la base de datos
        await dbRun(
            `INSERT INTO cierres_caja
            (fecha, dinero_inicial, total_ventas, total_esperado, diferencia, cantidad_ventas)
            VALUES (?, ?, ?, ?, ?, ?)`,
            [fecha || new Date().toISOString(), initialAmount, totalVentas, totalEsperado, diferencia, dailySales[0].cantidad || 0]
        );

        res.json({
            success: true,
            dinero_inicial: initialAmount,
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

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`🚀 Servidor ejecutándose en http://localhost:${PORT}`);
    console.log(`🌐 También disponible en la red local (reemplaza localhost con tu IP)`);
    console.log(`📦 API disponible en http://localhost:${PORT}/api/products`);
    console.log(`📊 Estadísticas: http://localhost:${PORT}/api/stats`);
    console.log(`🔧 Diagnóstico: http://localhost:${PORT}/api/diagnostic`);
    console.log(`💾 Base de datos: ${dbPath}`);
    console.log(`🌐 Frontend disponible en http://localhost:${PORT}`);
});

// Cerrar conexión al terminar
process.on('SIGINT', () => {
    db.close((err) => {
        if (err) {
            console.error(err.message);
        }
        console.log('✅ Conexión a la base de datos cerrada');
        process.exit(0);
    });
});