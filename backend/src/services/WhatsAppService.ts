import { Client, LocalAuth, MessageMedia } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { Setting } from '../models/Setting';

dotenv.config();

// Railway mounts a persistent volume at this path so the WhatsApp session
// survives across deployments/restarts, avoiding a re-scan of the QR code.
const WHATSAPP_AUTH_PATH = process.env.WHATSAPP_AUTH_PATH || '/app/whatsapp-auth';

export class WhatsAppService {
  private static client: Client | null = null;
  private static isReady: boolean = false;
  private static qrCode: string | null = null;

  static initialize() {
    console.log('Initializing WhatsApp Client...');
    
    try {
      // Make sure the persistent volume directory exists before LocalAuth tries to use it.
      try {
        fs.mkdirSync(WHATSAPP_AUTH_PATH, { recursive: true });
      } catch (mkdirErr: any) {
        console.error('❌ Failed to ensure WhatsApp auth directory exists (continuing anyway):', mkdirErr.message);
      }

      // We use LocalAuth pointed at the persistent volume so the session survives
      // container restarts/redeploys and we don't need to scan the QR code every time.
      this.client = new Client({
        authStrategy: new LocalAuth({
          clientId: 'PG_SPLIT_BOT',
          dataPath: WHATSAPP_AUTH_PATH
        }),
        puppeteer: {
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-accelerated-2d-canvas',
            '--no-first-run'
          ],
          executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
          protocolTimeout: 60000, // 60s timeout
        }
      });

      this.client.on('qr', (qr) => {
        console.log('==========================================');
        console.log('📱 WHATSAPP LOGIN REQUIRED!');
        console.log('Scan the QR Code below with your WhatsApp:');
        console.log('==========================================');
        qrcode.generate(qr, { small: true });
        this.qrCode = qr;
        console.log('DEBUG: Assigned this.qrCode =', this.qrCode ? 'valid' : 'null');
      });

      this.client.on('ready', () => {
        this.isReady = true;
        this.qrCode = null;
        console.log('✅ WhatsApp Client is READY!');
      });

      this.client.on('disconnected', (reason) => {
        console.log('❌ WhatsApp Client was disconnected:', reason);
        this.isReady = false;
      });

      this.client.on('auth_failure', (msg) => {
        console.error('❌ WhatsApp auth failure:', msg);
        this.isReady = false;
      });

      this.client.initialize().catch((err: any) => {
        console.error('❌ WhatsApp failed to initialize (server continues without WhatsApp):', err.message);
      });
    } catch (err: any) {
      console.error('❌ WhatsApp setup error (server continues without WhatsApp):', err.message);
    }
  }

  private static notificationsEnabled: boolean = process.env.ENABLE_WHATSAPP === 'true';
  private static cachedGroupJidMap: Map<string, string> = new Map();

  static getQRCode(): string | null {
    return this.qrCode;
  }

  static getIsReady(): boolean {
    return this.isReady;
  }

  static async loadSettingsFromDb(): Promise<void> {
    try {
      const setting = await Setting.findOne({ key: 'whatsapp_notifications_enabled' });
      if (setting && typeof setting.value === 'boolean') {
        this.notificationsEnabled = setting.value;
        console.log(`📱 Loaded WhatsApp notification setting from MongoDB: ${this.notificationsEnabled}`);
      }
    } catch (e: any) {
      console.warn('⚠️ Could not load WhatsApp notification setting from MongoDB:', e.message);
    }
  }

  static getNotificationsEnabled(): boolean {
    return this.notificationsEnabled;
  }

  static async setNotificationsEnabled(enabled: boolean): Promise<void> {
    this.notificationsEnabled = enabled;
    console.log(`📱 WhatsApp notifications enabled: ${enabled}`);
    try {
      await Setting.findOneAndUpdate(
        { key: 'whatsapp_notifications_enabled' },
        { value: enabled },
        { upsert: true, returnDocument: 'after' }
      );
      console.log(`💾 Saved WhatsApp notification preference (${enabled}) to MongoDB`);
    } catch (e: any) {
      console.error('❌ Failed to persist WhatsApp notification setting to MongoDB:', e.message);
    }
  }

  static async sendGroupMessage(groupName: string, text: string, imageUrl?: string): Promise<boolean> {
    if (!this.notificationsEnabled) {
      console.log('ℹ️ WhatsApp notifications are disabled. Skipping message.');
      return false;
    }

    if (!this.client || !this.isReady) {
      console.warn('⚠️ WhatsApp client is not ready. Message not sent.');
      return false;
    }

    // Ensure header identifying BOTTY is always prepended
    if (!text.includes('[Message from BOTTY]')) {
      text = `🤖 *[Message from BOTTY]*\n\n` + text;
    }

    // Build MessageMedia if imageUrl is provided
    let media: MessageMedia | undefined = undefined;
    if (imageUrl) {
      try {
        if (imageUrl.startsWith('data:')) {
          const parts = imageUrl.split(';base64,');
          if (parts.length === 2) {
            const mimeType = parts[0].replace('data:', '');
            const base64Data = parts[1];
            media = new MessageMedia(mimeType, base64Data, `receipt_${Date.now()}.jpg`);
          }
        } else if (imageUrl.startsWith('/uploads/')) {
          const localPath = path.join(process.cwd(), imageUrl);
          if (fs.existsSync(localPath)) {
            media = MessageMedia.fromFilePath(localPath);
          } else {
            console.warn(`⚠️ WhatsApp image not found on disk: ${localPath}`);
          }
        }
      } catch (mediaErr: any) {
        console.warn('⚠️ Failed to construct MessageMedia for WhatsApp:', mediaErr.message);
      }
    }

    const cacheKey = (groupName || 'default').toLowerCase().trim();

    // 1. Fast path: Try sending directly using cached group JID
    if (this.cachedGroupJidMap.has(cacheKey)) {
      const targetJid = this.cachedGroupJidMap.get(cacheKey)!;
      try {
        console.log(`🚀 [WhatsApp] Dispatching message to JID: ${targetJid}`);
        
        const sendPromise = (async () => {
          if (media) {
            return await this.client!.sendMessage(targetJid, media, { caption: text });
          } else {
            return await this.client!.sendMessage(targetJid, text);
          }
        })();

        // Wrap in a 30-second timeout to prevent indefinite hangs
        await Promise.race([
          sendPromise,
          new Promise((_, reject) => setTimeout(() => reject(new Error('sendMessage timed out after 30 seconds')), 30000))
        ]);

        console.log(`✅ WhatsApp message (with ${media ? 'image' : 'text'}) sent directly using cached JID (${targetJid}) to group "${groupName}"`);
        return true;
      } catch (cacheErr: any) {
        console.warn(`⚠️ Direct send to cached JID failed (${cacheErr.message}). Clearing cache and re-discovering group...`);
        this.cachedGroupJidMap.delete(cacheKey);
      }
    }

    try {
      if (!this.client.pupPage) {
        console.warn('⚠️ WhatsApp client pupPage is not available.');
        return false;
      }

      // Use the library's internal WAWebCollections to fetch chats (bypasses broken getChats)
      let chats: any[] = [];
      try {
        chats = await this.client.pupPage.evaluate(() => {
          try {
            const req = (window as any).require;
            if (!req) return [];
            const chatCollection = req('WAWebCollections').Chat;
            const models = chatCollection?.getModelsArray ? chatCollection.getModelsArray() : [];
            return models
              .filter((c: any) => {
                const id = c.id?._serialized || (typeof c.id === 'string' ? c.id : '');
                return String(id).endsWith('@g.us');
              })
              .map((c: any) => ({
                id: String(c.id?._serialized || c.id || ''),
                name: String(c.name || c.formattedTitle || ''),
                isGroup: true
              }));
          } catch (e) {
            return [];
          }
        });
      } catch (evalError: any) {
        console.warn('⚠️ WhatsApp pupPage evaluate failed (detached frame?), falling back to getChats():', evalError.message);
        const rawChats = await this.client.getChats();
        chats = rawChats.map((c: any) => ({
          id: c.id._serialized,
          name: c.name,
          isGroup: c.isGroup
        }));
      }
      
      // Find the group chat matching the name (case-insensitive, fuzzy, or single group fallback)
      const targetGroup = chats.find((chat: any) => 
        chat.isGroup && (
          !groupName ||
          chat.name?.toLowerCase().trim() === groupName.toLowerCase().trim() ||
          chat.name?.toLowerCase().includes(groupName.toLowerCase()) ||
          groupName.toLowerCase().includes(chat.name?.toLowerCase() || '')
        )
      ) || chats.find((chat: any) => chat.isGroup);

      if (!targetGroup) {
        console.warn(`⚠️ WhatsApp Group "${groupName}" not found! Available groups:`);
        const groups = chats.filter((c: any) => c.isGroup);
        groups.forEach((g: any) => console.log(`  - "${g.name}"`));
        return false;
      }

      // Cache the group JID for direct sub-second delivery on future messages
      this.cachedGroupJidMap.set(cacheKey, targetGroup.id);

      console.log(`🚀 [WhatsApp] Dispatching message to JID (fallback): ${targetGroup.id}`);
      
      const sendPromise = (async () => {
        if (media) {
          return await this.client!.sendMessage(targetGroup.id, media, { caption: text });
        } else {
          return await this.client!.sendMessage(targetGroup.id, text);
        }
      })();

      await Promise.race([
        sendPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('sendMessage timed out after 30 seconds')), 30000))
      ]);

      console.log(`✅ WhatsApp message (with ${media ? 'image' : 'text'}) sent to group "${groupName}" (JID: ${targetGroup.id})`);
      return true;

    } catch (e) {
      console.error('❌ Failed to send WhatsApp message:', e);
      return false;
    }
  }
}
