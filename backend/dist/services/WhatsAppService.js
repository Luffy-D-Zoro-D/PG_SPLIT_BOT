"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WhatsAppService = void 0;
const whatsapp_web_js_1 = require("whatsapp-web.js");
const qrcode_terminal_1 = __importDefault(require("qrcode-terminal"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
class WhatsAppService {
    static client = null;
    static isReady = false;
    static initialize() {
        console.log('Initializing WhatsApp Client...');
        // We use LocalAuth to save session data so we don't need to scan QR code every time
        this.client = new whatsapp_web_js_1.Client({
            authStrategy: new whatsapp_web_js_1.LocalAuth(),
            puppeteer: {
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            },
            webVersionCache: {
                type: 'remote',
                remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
            }
        });
        this.client.on('qr', (qr) => {
            console.log('==========================================');
            console.log('📱 WHATSAPP LOGIN REQUIRED!');
            console.log('Scan the QR Code below with your WhatsApp:');
            console.log('==========================================');
            qrcode_terminal_1.default.generate(qr, { small: true });
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
    static async sendGroupMessage(groupName, text) {
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
            const chats = await this.client.pupPage.evaluate(() => {
                const chatCollection = window.require('WAWebCollections').Chat;
                return chatCollection.getModelsArray().map((c) => ({
                    id: c.id._serialized,
                    name: c.name || c.formattedTitle || '',
                    isGroup: c.id._serialized.endsWith('@g.us')
                }));
            });
            // Find the group chat matching the name
            const targetGroup = chats.find((chat) => chat.isGroup && chat.name === groupName);
            if (!targetGroup) {
                console.warn(`⚠️ WhatsApp Group "${groupName}" not found! Available groups:`);
                const groups = chats.filter((c) => c.isGroup);
                groups.forEach((g) => console.log(`  - "${g.name}"`));
                return false;
            }
            // Send the message using the serialized ID
            await this.client.sendMessage(targetGroup.id, text);
            console.log(`✅ WhatsApp message sent to group "${groupName}"`);
            return true;
        }
        catch (e) {
            console.error('❌ Failed to send WhatsApp message:', e);
            return false;
        }
    }
}
exports.WhatsAppService = WhatsAppService;
