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

// Public WhatsApp setup endpoints so the QR code can be scanned from the
// dashboard instead of the server console/logs.
app.get('/api/whatsapp-qr', (req, res) => {
  const isReady = WhatsAppService.getIsReady();
  const qr = WhatsAppService.getQRCode();

  if (isReady) {
    return res.send({ qr: null, status: 'authenticated' });
  }

  res.send({ qr });
});

app.get('/api/whatsapp-status', (req, res) => {
  const isReady = WhatsAppService.getIsReady();
  const needsAuth = !isReady && !!WhatsAppService.getQRCode();

  res.send({ isReady, needsAuth });
});

// Serve frontend static files in production
app.use(express.static(path.join(__dirname, '../../frontend/dist')));
app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, '../../frontend/dist/index.html'));
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
  mongoose.connect(MONGO_URI)
    .then(() => {
      console.log('✅ Connected to MongoDB');
      console.log('MongoDB URL:', MONGO_URI);
    })
    .catch((e) => {
      console.error('❌ Error connecting to MongoDB (server continues running):', e);
    });

  // Setup Telegram Webhook if URL is provided in env. Fire-and-forget, does not block startup.
  if (process.env.WEBHOOK_URL) {
    TelegramService.setWebhook(`${process.env.WEBHOOK_URL}/webhook/telegram`)
      .then((success) => {
        if (success) {
          console.log(`✅ Telegram Webhook set to ${process.env.WEBHOOK_URL}/webhook/telegram`);
        } else {
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
    WhatsAppService.initialize();
  } catch (e) {
    console.error('❌ Error initializing WhatsApp Service (server continues running):', e);
  }
}

startServer();
