"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const mongoose_1 = __importDefault(require("mongoose"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const TelegramWebhookController_1 = require("./controllers/TelegramWebhookController");
const DashboardController_1 = require("./controllers/DashboardController");
const TelegramService_1 = require("./services/TelegramService");
const WhatsAppService_1 = require("./services/WhatsAppService");
const path_1 = __importDefault(require("path"));
dotenv_1.default.config();
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
app.use(express_1.default.json());
app.use('/uploads', express_1.default.static(path_1.default.join(process.cwd(), 'uploads')));
// Routes
app.post('/webhook/telegram', TelegramWebhookController_1.TelegramWebhookController.handleUpdate);
// Web API for dashboard
app.get('/api/health', (req, res) => res.send({ status: 'ok' }));
app.get('/api/stats', DashboardController_1.DashboardController.getStats);
app.get('/api/expenses', DashboardController_1.DashboardController.getExpenses);
app.get('/api/balances', DashboardController_1.DashboardController.getBalances);
app.delete('/api/expenses/:id', DashboardController_1.DashboardController.deleteExpense);
app.post('/api/settle', DashboardController_1.DashboardController.settleBalance);
// Public WhatsApp setup endpoints so the QR code can be scanned from the
// dashboard instead of the server console/logs.
app.get('/api/whatsapp-qr', (req, res) => {
    const isReady = WhatsAppService_1.WhatsAppService.getIsReady();
    const qr = WhatsAppService_1.WhatsAppService.getQRCode();
    if (isReady) {
        return res.send({ qr: null, status: 'authenticated' });
    }
    res.send({ qr });
});
app.get('/api/whatsapp-status', (req, res) => {
    const isReady = WhatsAppService_1.WhatsAppService.getIsReady();
    const needsAuth = !isReady && !!WhatsAppService_1.WhatsAppService.getQRCode();
    res.send({ isReady, needsAuth, notificationsEnabled: WhatsAppService_1.WhatsAppService.getNotificationsEnabled() });
});
app.get('/api/whatsapp-settings', (req, res) => {
    res.send({
        notificationsEnabled: WhatsAppService_1.WhatsAppService.getNotificationsEnabled(),
        isReady: WhatsAppService_1.WhatsAppService.getIsReady()
    });
});
app.post('/api/whatsapp-settings', (req, res) => {
    const { notificationsEnabled } = req.body;
    if (typeof notificationsEnabled === 'boolean') {
        WhatsAppService_1.WhatsAppService.setNotificationsEnabled(notificationsEnabled);
    }
    res.send({
        notificationsEnabled: WhatsAppService_1.WhatsAppService.getNotificationsEnabled(),
        isReady: WhatsAppService_1.WhatsAppService.getIsReady()
    });
});
// Serve frontend static files in production
app.use(express_1.default.static(path_1.default.join(__dirname, '../../frontend/dist')));
app.get('/{*path}', (req, res) => {
    res.sendFile(path_1.default.join(__dirname, '../../frontend/dist/index.html'));
});
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/pgsplitter';
function startServer() {
    // Start listening immediately so the HTTP server is always available,
    // regardless of MongoDB connection status or WhatsApp initialization.
    app.listen(PORT, () => {
        console.log(`🚀 Server running on port ${PORT}`);
    });
    // Connect to MongoDB in the background. The HTTP server does not wait on this.
    mongoose_1.default.connect(MONGO_URI)
        .then(() => {
        console.log('✅ Connected to MongoDB');
        console.log('MongoDB URL:', MONGO_URI);
    })
        .catch((e) => {
        console.error('❌ Error connecting to MongoDB (server continues running):', e);
    });
    // Setup Telegram Webhook if URL is provided in env. Fire-and-forget, does not block startup.
    if (process.env.WEBHOOK_URL) {
        TelegramService_1.TelegramService.setWebhook(`${process.env.WEBHOOK_URL}/webhook/telegram`)
            .then((success) => {
            if (success) {
                console.log(`✅ Telegram Webhook set to ${process.env.WEBHOOK_URL}/webhook/telegram`);
            }
            else {
                console.error('❌ Failed to set Telegram Webhook');
            }
        })
            .catch((e) => {
            console.error('❌ Error setting Telegram Webhook (server continues running):', e);
        });
    }
    // Initialize WhatsApp Client asynchronously. The HTTP server does not wait for it,
    // and any failure here must not affect server availability.
    try {
        WhatsAppService_1.WhatsAppService.initialize();
    }
    catch (e) {
        console.error('❌ Error initializing WhatsApp Service (server continues running):', e);
    }
}
startServer();
