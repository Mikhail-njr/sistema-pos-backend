const functions = require('firebase-functions');
const admin = require('firebase-admin');
const initSqlJs = require('sql.js');
const express = require('express');
const cors = require('cors');

admin.initializeApp();

const app = express();

// Configuración de CORS para Firebase Hosting
const corsOptions = {
    origin: [
        'https://punto-de-venta-web-f47e8.web.app',
        'http://localhost:3000',
        'http://127.0.0.1:3000'
    ],
    credentials: true
};

app.use(cors(corsOptions));
app.use(express.json());

// Configuración de SQLite con sql.js
let db;
let SQL;

async function initDatabase() {
    try {
        console.log('🔄 Inicializando base de datos...');

        SQL = await initSqlJs();
        db = new SQL.Database();

        // Crear tablas
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

        db.run(`CREATE TABLE IF NOT EXISTS ventas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            numero_factura TEXT UNIQUE NOT NULL,
            total REAL NOT NULL,
            metodo_pago TEXT NOT NULL,
            vuelto REAL DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS venta_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            venta_id INTEGER NOT NULL,
            producto_id INTEGER NOT NULL,
            cantidad INTEGER NOT NULL,
            precio_unitario REAL NOT NULL,
            descuento_porcentaje REAL DEFAULT 0,
            descuento_aplicado REAL DEFAULT 0,
            subtotal REAL NOT NULL
        )`);

        // Insertar datos de ejemplo
        const result = dbAll("SELECT COUNT(*) as count FROM productos");
        if (result.length === 0 || result[0].count === 0) {
            insertSampleData();
        }

        console.log('✅ Base de datos inicializada correctamente');
    } catch (error) {
        console.error('❌ Error inicializando base de datos:', error);
    }
}

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

function dbRun(query, params = []) {
    try {
        let finalQuery = query;
        params.forEach((param, index) => {
            const escapedParam = typeof param === 'string' ? param.replace(/'/g, "''") : param;
            finalQuery = finalQuery.replace('?', typeof param === 'string' ? `'${escapedParam}'` : param);
        });

        db.run(finalQuery);
        return { id: db.exec("SELECT last_insert_rowid() as id")[0].values[0][0], changes: 1 };
    } catch (error) {
        throw error;
    }
}

function insertSampleData() {
    const productos = [
        ['LAP-001', 'Laptop HP 15.6"', 'Laptop HP con pantalla 15.6 pulgadas', 899.99, 5, 'Tecnología'],
        ['MON-001', 'Monitor Samsung 24"', 'Monitor Samsung 24 pulgadas Full HD', 249.99, 3, 'Tecnología'],
        ['TEC-001', 'Teclado Mecánico RGB', 'Teclado mecánico con iluminación RGB', 89.99, 8, 'Periféricos'],
        ['MOU-001', 'Mouse Inalámbrico', 'Mouse inalámbrico ergonómico', 39.99, 10, 'Periféricos'],
        ['AUD-001', 'Audífonos Bluetooth', 'Audífonos inalámbricos con cancelación de ruido', 79.99, 5, 'Audio']
    ];

    productos.forEach(producto => {
        try {
            dbRun(
                `INSERT OR IGNORE INTO productos (codigo, nombre, descripcion, precio, stock, categoria)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                producto
            );
        } catch (error) {
            console.log('⚠️  Error insertando producto:', producto[0], error.message);
        }
    });

    console.log('✅ Datos de ejemplo insertados en SQLite');
}

function removeAccents(str) {
    return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// Inicializar base de datos
initDatabase();

// Rutas API
app.get('/products', async (req, res) => {
    try {
        const products = dbAll("SELECT * FROM productos ORDER BY nombre");
        res.json(products);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/products/search', async (req, res) => {
    try {
        const { q, category } = req.query;
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

        let products = dbAll(query, params);

        if (q) {
            const normalizedQ = removeAccents(q.toLowerCase());
            products = products.filter(product => {
                const normalizedName = removeAccents(product.nombre.toLowerCase());
                return normalizedName.includes(normalizedQ) || product.codigo.toLowerCase().includes(q.toLowerCase());
            });
        }

        res.json(products);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/products', async (req, res) => {
    const { codigo, nombre, descripcion, precio, stock, categoria } = req.body;

    if (!codigo || !nombre || precio === undefined || stock === undefined) {
        return res.status(400).json({ error: 'Código, nombre, precio y stock son campos requeridos' });
    }

    try {
        const existingProduct = dbAll("SELECT id FROM productos WHERE codigo = ?", [codigo]);
        if (existingProduct.length > 0) {
            return res.status(400).json({ error: 'Ya existe un producto con este código' });
        }

        const result = dbRun(
            `INSERT INTO productos (codigo, nombre, descripcion, precio, stock, categoria)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [codigo, nombre, descripcion || '', precio, stock, categoria || '']
        );

        const newProduct = dbAll("SELECT * FROM productos WHERE id = ?", [result.id]);
        res.status(201).json({
            success: true,
            message: 'Producto creado exitosamente',
            product: newProduct[0]
        });
    } catch (error) {
        res.status(500).json({ error: 'Error interno del servidor: ' + error.message });
    }
});

app.post('/sales', async (req, res) => {
    const { items, paymentMethod, metodo_pago, pagos, vuelto } = req.body;

    let metodoPago;
    if (pagos && Array.isArray(pagos) && pagos.length > 0) {
        metodoPago = JSON.stringify(pagos);
    } else {
        metodoPago = paymentMethod || metodo_pago || 'efectivo';
    }

    if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'La venta debe incluir al menos un item válido' });
    }

    try {
        db.run("BEGIN TRANSACTION");

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

        const saleResult = dbRun(
            "INSERT INTO ventas (numero_factura, total, metodo_pago, vuelto) VALUES (?, ?, ?, ?)",
            [facturaNumber, total, metodoPago, vuelto || 0]
        );

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

        db.run("COMMIT");

        res.json({
            success: true,
            factura: facturaNumber,
            total: total,
            saleId: saleResult.id,
            itemsWithDiscounts: itemsWithDiscounts,
            message: 'Venta registrada exitosamente'
        });
    } catch (error) {
        db.run("ROLLBACK");
        res.status(500).json({
            error: 'Error procesando la venta: ' + error.message
        });
    }
});

app.get('/sales', async (req, res) => {
    try {
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

        const sales = dbAll(salesQuery);

        const processedSales = sales.map(sale => {
            let metodoPagoParsed = sale.metodo_pago;

            try {
                const parsed = JSON.parse(sale.metodo_pago);
                if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].metodo) {
                    metodoPagoParsed = parsed;
                }
            } catch (e) {
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
        res.status(500).json({ error: error.message });
    }
});

app.get('/stats', async (req, res) => {
    try {
        const totalProducts = dbAll("SELECT COUNT(*) as count FROM productos");
        const totalSales = dbAll("SELECT COUNT(*) as count FROM ventas");
        const totalRevenue = dbAll("SELECT SUM(total) as total FROM ventas");

        const topProducts = dbAll(`
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

app.get('/categories', async (req, res) => {
    try {
        const categories = dbAll("SELECT DISTINCT categoria FROM productos WHERE categoria IS NOT NULL AND categoria != '' ORDER BY categoria");
        res.json(categories.map(row => row.categoria));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/diagnostic', async (req, res) => {
    try {
        const productCount = dbAll("SELECT COUNT(*) as count FROM productos");
        const salesCount = dbAll("SELECT COUNT(*) as count FROM ventas");

        res.json({
            database: 'SQLite (sql.js)',
            total_products: productCount[0].count,
            total_sales: salesCount[0].count,
            status: 'OK',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            error: error.message,
            database: 'SQLite (sql.js)',
            status: 'ERROR'
        });
    }
});

// Función principal de Firebase Functions
exports.api = functions.https.onRequest(app);