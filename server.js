const express = require('express');
const compression = require('compression');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Gzip Compression
app.use(compression());

// Basic Security & Caching Headers
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
});

// Static assets (CSS, JS, images, svgs) with 1 day caching
app.use(express.static(path.join(__dirname), {
    maxAge: '1d',
    index: false // Do not serve index.html automatically, we control routes explicitly below
}));

// Healthcheck endpoint for Railway
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'ok',
        uptime: Math.floor(process.uptime()),
        timestamp: new Date().toISOString()
    });
});

// Main Landing Page (Eco Berghaus презентація та огляд)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'bron.html'));
});

// Online Booking Page (4-крокова система бронювання)
const bookingHandler = (req, res) => {
    res.sendFile(path.join(__dirname, '1.html'));
};
app.get('/reserve', bookingHandler);
app.get('/bron', bookingHandler);
app.get('/cottages', bookingHandler);
app.get('/kotedzhi', bookingHandler);
app.get('/1.html', bookingHandler);
app.get('/index.html', bookingHandler);

// Admin 2FA Login Page
const adminLoginHandler = (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
};
app.get('/admin', adminLoginHandler);
app.get('/login', adminLoginHandler);
app.get('/admin.html', adminLoginHandler);

// Admin Control Dashboard
const dashboardHandler = (req, res) => {
    res.sendFile(path.join(__dirname, 'dashboard.html'));
};
app.get('/dashboard', dashboardHandler);
app.get('/dashboard.html', dashboardHandler);

// 404 Fallback - redirect to home
app.use((req, res) => {
    res.redirect('/');
});

// Start Server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 EcoBerghaus Server is running on port ${PORT}`);
    console.log(`📍 Main Landing: http://localhost:${PORT}/`);
    console.log(`📍 Booking Flow: http://localhost:${PORT}/reserve`);
    console.log(`📍 Admin Panel:  http://localhost:${PORT}/admin`);
});
