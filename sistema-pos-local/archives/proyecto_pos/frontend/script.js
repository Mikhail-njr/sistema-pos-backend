/**
 * @fileoverview Script principal de la aplicación.
 * @author Tu Nombre
 */

// alert('Script loaded');

// Variables globales
let cart = [];
let selectedProduct = null;
let selectedPaymentMethod = null;
let isLoggedIn = false;
let authCredentials = null;
const API_BASE = window.location.protocol + '//' + window.location.host + '/api';

// Funciones de autenticación
function login() {
    const credentials = prompt('Ingrese usuario y contraseña separados por ":"');
    if (credentials) {
        const [username, password] = credentials.split(':');
        if (username && password) {
            authCredentials = { username, password };
            isLoggedIn = true;
            sessionStorage.setItem('authCredentials', JSON.stringify(authCredentials));
            updateUIBasedOnAuth();
            showAlert('✅ Sesión iniciada correctamente', 'success');
            return true;
        }
    }
    showAlert('❌ Credenciales inválidas', 'error');
    return false;
}

function logout() {
    authCredentials = null;
    isLoggedIn = false;
    sessionStorage.removeItem('authCredentials');
    updateUIBasedOnAuth();
    showAlert('👋 Sesión cerrada', 'success');
}

function accessDashboard() {
    if (!isLoggedIn) {
        if (login()) {
            window.location.href = 'dashboard.html';
        }
    } else {
        window.location.href = 'dashboard.html';
    }
}

function updateUIBasedOnAuth() {
    const loginBtn = document.getElementById('loginBtn');
    const dashboardBtn = document.getElementById('dashboardBtn');
    const payBtn = document.getElementById('payBtn');

    if (loginBtn) {
        loginBtn.textContent = isLoggedIn ? 'Cerrar Sesión' : 'Iniciar Sesión';
        loginBtn.onclick = isLoggedIn ? logout : login;
    }

    if (dashboardBtn) {
        dashboardBtn.style.display = 'inline-block'; // Siempre visible
    }

    if (payBtn) {
        payBtn.disabled = !isLoggedIn;
        payBtn.textContent = isLoggedIn ? 'Pagar' : 'Simular Pago';
        payBtn.onclick = isLoggedIn ? () => {
            // Use the local processPayment function if it exists, otherwise use the global one
            if (typeof window.processPayment === 'function') {
                window.processPayment();
            } else {
                processPayment();
            }
        } : () => {
            // Use the local simulatePayment function if it exists, otherwise use the global one
            if (typeof window.simulatePayment === 'function') {
                window.simulatePayment();
            } else {
                simulatePayment();
            }
        };
    }
}

function simulatePayment() {
    if (cart.length === 0) {
        showAlert('❌ El carrito está vacío', 'error');
        return;
    }

    if (!selectedPaymentMethod) {
        showAlert('❌ Por favor selecciona un método de pago', 'error');
        return;
    }

    // Calcular total
    const total = cart.reduce((sum, item) => sum + (parseFloat(item.precio) * item.quantity), 0);

    // Generar factura simulada detallada
    const invoiceNumber = `SIM-${Date.now()}`;
    let invoiceDetails = `🎭 SIMULACIÓN DE COMPRA\n\n`;
    invoiceDetails += `Factura: ${invoiceNumber}\n`;
    invoiceDetails += `Fecha: ${new Date().toLocaleString()}\n`;
    invoiceDetails += `Método de Pago: ${selectedPaymentMethod.toUpperCase()}\n\n`;
    invoiceDetails += `PRODUCTOS:\n`;

    cart.forEach((item, index) => {
        const subtotal = parseFloat(item.precio) * item.quantity;
        invoiceDetails += `${index + 1}. ${item.nombre}\n`;
        invoiceDetails += `   Código: ${item.codigo}\n`;
        invoiceDetails += `   Cantidad: ${item.quantity} × ${formatCurrency(item.precio)} = ${formatCurrency(subtotal)}\n\n`;
    });

    invoiceDetails += `TOTAL: ${formatCurrency(total)}\n\n`;
    invoiceDetails += `⚠️ ESTA ES UNA SIMULACIÓN - No se procesó ningún pago real`;

    // Mostrar factura en alert
    alert(invoiceDetails);

    // Limpiar carrito
    cart = [];
    updateCart();
}

// Cargar credenciales al iniciar
function loadAuthFromStorage() {
    const stored = sessionStorage.getItem('authCredentials');
    if (stored) {
        authCredentials = JSON.parse(stored);
        isLoggedIn = true;
    }
    updateUIBasedOnAuth();
}

// Función para hacer requests a la API
async function apiRequest(endpoint, options = {}) {
    try {
        console.log('Enviando datos a la API:', endpoint, options);

        const headers = {
            'Content-Type': 'application/json',
            ...options.headers
        };

        // Agregar autenticación si está disponible
        if (authCredentials) {
            headers['Authorization'] = 'Basic ' + btoa(authCredentials.username + ':' + authCredentials.password);
        }

        const response = await fetch(`${API_BASE}${endpoint}`, {
            headers: headers,
            ...options
        });

        if (response.status === 401) {
            // Autenticación requerida
            isLoggedIn = false;
            updateUIBasedOnAuth();
            throw new Error('Autenticación requerida. Por favor inicie sesión.');
        }

        if (!response.ok) {
            throw new Error(`Error ${response.status}: ${response.statusText}`);
        }

        return await response.json();
    } catch (error) {
        console.error('Error en API request:', error);
        throw error;
    }
}

// Formatear moneda
function formatCurrency(amount) {
    return `$${amount.toFixed(2).replace('.', ',')}`;
}

// Funciones searchProducts y displayResults se definen en cada página específica

// Función selectProduct se define en cada página específica (index.html, dashboard.html)

// Funciones de carrito se definen en index.html

// Funciones de pago se definen en index.html

// Función showAlert se define en cada página específica
// Función resetSystem se define en index.html

// Event listeners se definen en cada página específica
// Funciones de autenticación se definen en cada página específica

// Funciones específicas para el dashboard
if (window.location.pathname.includes('dashboard.html')) {
    document.addEventListener('DOMContentLoaded', function() {
        // Obtener y mostrar métricas
        fetchMetrics();
        
        // Configurar evento para cierre de caja
        const closeRegisterBtn = document.getElementById('closeRegisterBtn');
        if (closeRegisterBtn) {
            closeRegisterBtn.addEventListener('click', performCloseRegister);
        }
    });
}

// Obtener y mostrar métricas de ventas
async function fetchMetrics() {
    try {
        // Obtener estadísticas
        const statsResponse = await apiRequest('/stats');
        
        // Mostrar productos más vendidos
        const topProductsTable = document.getElementById('top-products-table');
        if (topProductsTable) {
            const tbody = topProductsTable.querySelector('tbody');
            tbody.innerHTML = '';
            
            statsResponse.top_products.forEach((product, index) => {
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td>${index + 1}</td>
                    <td>${product.nombre}</td>
                    <td>${product.codigo}</td>
                    <td>${product.total_vendido}</td>
                `;
                tbody.appendChild(row);
            });
        }

        // Obtener historial de cierres
        const cierresResponse = await apiRequest('/cierres');
        const historialTable = document.getElementById('historial-cierres-table');
        if (historialTable) {
            const tbody = historialTable.querySelector('tbody');
            tbody.innerHTML = '';
            
            cierresResponse.forEach(cierre => {
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td>${new Date(cierre.fecha).toLocaleString()}</td>
                    <td>${formatCurrency(cierre.dinero_inicial)}</td>
                    <td>${formatCurrency(cierre.total_ventas)}</td>
                    <td>${formatCurrency(cierre.total_esperado)}</td>
                    <td>${formatCurrency(cierre.diferencia)}</td>
                    <td>${cierre.cantidad_ventas}</td>
                `;
                tbody.appendChild(row);
            });
            historialTable.style.display = 'table';
            document.querySelector('#historial-cierres-section .loading').style.display = 'none';
        }
    } catch (error) {
        console.error('Error obteniendo métricas:', error);
    }
}

// Funciones para manejar el modal de cierre de caja
function openCierreModal() {
    document.getElementById('cierreModal').classList.add('show');
}

function closeCierreModal() {
    document.getElementById('cierreModal').classList.remove('show');
}

// Realizar cierre de caja
async function performCloseRegister() {
    try {
        const dineroInicial = document.getElementById('dineroInicial').value;
        if (!dineroInicial || isNaN(dineroInicial) || dineroInicial < 0) {
            throw new Error('Por favor ingrese un monto inicial válido');
        }

        const response = await apiRequest('/close-register', {
            method: 'POST',
            body: JSON.stringify({
                fecha: new Date().toISOString(),
                dineroInicial: dineroInicial
            })
        });

        // Mostrar resultados en el modal
        document.getElementById('cierre-inicial').textContent = formatCurrency(response.dinero_inicial);
        document.getElementById('cierre-total').textContent = formatCurrency(response.total);
        document.getElementById('cierre-esperado').textContent = formatCurrency(response.total_esperado);
        document.getElementById('cierre-diferencia').textContent = formatCurrency(response.diferencia);
        document.getElementById('cierre-cantidad').textContent = response.cantidad_ventas;
        document.getElementById('cierre-fecha').textContent = new Date(response.fecha).toLocaleString();

        openCierreModal();
        showAlert('✅ Cierre de caja realizado correctamente', 'success');
    } catch (error) {
        console.error('Error en cierre de caja:', error);
        showAlert('❌ Error al realizar cierre de caja: ' + error.message, 'error');
    }
}

// Cerrar modal al hacer clic fuera
document.getElementById('cierreModal').addEventListener('click', function(e) {
    if (e.target === this) {
        closeCierreModal();
    }
});