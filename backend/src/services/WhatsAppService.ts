import { Client, LocalAuth } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

// Railway mounts a persistent volume at this path so the WhatsApp session
// survives across deployments/restarts, avoiding a re-scan of the QR code.
const WHATSAPP_AUTH_PATH = process.env.WHATSAPP_AUTH_PATH || '/app/whatsapp-auth';

export class WhatsAppService {
  private static client: Client | null = null;
  private static isReady: boolean = false;

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
          args: ['--no-sandbox', '--disable-setuid-sandbox'],
          executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined
        },
        webVersionCache: {
          type: 'none'
        }
      });

      this.client.on('qr', (qr) => {
        console.log('==========================================');
        console.log('📱 WHATSAPP LOGIN REQUIRED!');
        console.log('Scan the QR Code below with your WhatsApp:');
        console.log('==========================================');
        qrcode.generate(qr, { small: true });
      });

      this.client.on('ready', () => {
        this.isReady = true;
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

  static async sendGroupMessage(groupName: string, text: string): Promise<boolean> {
    if (!this.client || !this.isReady) {
      console.warn('⚠️ WhatsApp client is not ready. Message not sent.');
      return false;
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
          const chatCollection = (window as any).require('WAWebCollections').Chat;
          return chatCollection.getModelsArray().map((c: any) => ({
            id: c.id._serialized,
            name: c.name || c.formattedTitle || '',
            isGroup: c.id._serialized.endsWith('@g.us')
          }));
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
      
      // Find the group chat matching the name
      const targetGroup = chats.find(
        (chat: any) => chat.isGroup && chat.name === groupName
      );

      if (!targetGroup) {
        console.warn(`⚠️ WhatsApp Group "${groupName}" not found! Available groups:`);
        const groups = chats.filter((c: any) => c.isGroup);
        groups.forEach((g: any) => console.log(`  - "${g.name}"`));
        return false;
      }

      // Send the message using the serialized ID
      await this.client.sendMessage(targetGroup.id, text);
      console.log(`✅ WhatsApp message sent to group "${groupName}"`);
      return true;

    } catch (e) {
      console.error('❌ Failed to send WhatsApp message:', e);
      return false;
    }
  }
}
