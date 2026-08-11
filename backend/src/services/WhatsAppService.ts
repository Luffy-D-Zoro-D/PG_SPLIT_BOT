import { Client, LocalAuth } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import dotenv from 'dotenv';

dotenv.config();

export class WhatsAppService {
  private static client: Client | null = null;
  private static isReady: boolean = false;

  static initialize() {
    console.log('Initializing WhatsApp Client...');
    
    // We use LocalAuth to save session data so we don't need to scan QR code every time
    this.client = new Client({
      authStrategy: new LocalAuth(),
      puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox']
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

    this.client.initialize();
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
