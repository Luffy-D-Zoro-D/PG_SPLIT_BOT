import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import { TelegramWebhookController } from './controllers/TelegramWebhookController';
import { DashboardController } from './controllers/DashboardController';
import { TelegramService } from './services/TelegramService';
import { WhatsAppService } from './services/WhatsAppService';

import path from 'path';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

// Routes
app.post('/webhook/telegram', TelegramWebhookController.handleUpdate);

// Web API for dashboard
app.get('/api/health', (req, res) => res.send({ status: 'ok' }));
app.get('/api/stats', DashboardController.getStats);
app.get('/api/expenses', DashboardController.getExpenses);
app.get('/api/balances', DashboardController.getBalances);
app.delete('/api/expenses/:id', DashboardController.deleteExpense);
app.post('/api/settle', DashboardController.settleBalance);

// Serve frontend static files in production
app.use(express.static(path.join(__dirname, '../../frontend/dist')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../../frontend/dist/index.html'));
});

const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/pgsplitter';

async function startServer() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB');
    console.log('MongoDB URL:', MONGO_URI);

    app.listen(PORT, async () => {
      console.log(`🚀 Server running on port ${PORT}`);
      
      // Setup Webhook if URL is provided in env
      if (process.env.WEBHOOK_URL) {
        const success = await TelegramService.setWebhook(`${process.env.WEBHOOK_URL}/webhook/telegram`);
        if (success) {
          console.log(`✅ Telegram Webhook set to ${process.env.WEBHOOK_URL}/webhook/telegram`);
        } else {
          console.error('❌ Failed to set Telegram Webhook');
        }
      }

      // Initialize WhatsApp Client
      WhatsAppService.initialize();
    });
  } catch (e) {
    console.error('❌ Error starting server:', e);
  }
}

startServer();
