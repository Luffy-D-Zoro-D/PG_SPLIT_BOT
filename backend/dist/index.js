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
// Serve frontend static files in production
app.use(express_1.default.static(path_1.default.join(__dirname, '../../frontend/dist')));
app.get('/{*path}', (req, res) => {
    res.sendFile(path_1.default.join(__dirname, '../../frontend/dist/index.html'));
});
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/pgsplitter';
async function startServer() {
    try {
        await mongoose_1.default.connect(MONGO_URI);
        console.log('✅ Connected to MongoDB');
        console.log('MongoDB URL:', MONGO_URI);
        app.listen(PORT, async () => {
            console.log(`🚀 Server running on port ${PORT}`);
            // Setup Webhook if URL is provided in env
            if (process.env.WEBHOOK_URL) {
                const success = await TelegramService_1.TelegramService.setWebhook(`${process.env.WEBHOOK_URL}/webhook/telegram`);
                if (success) {
                    console.log(`✅ Telegram Webhook set to ${process.env.WEBHOOK_URL}/webhook/telegram`);
                }
                else {
                    console.error('❌ Failed to set Telegram Webhook');
                }
            }
            // Initialize WhatsApp Client
            WhatsAppService_1.WhatsAppService.initialize();
        });
    }
    catch (e) {
        console.error('❌ Error starting server:', e);
    }
}
startServer();
