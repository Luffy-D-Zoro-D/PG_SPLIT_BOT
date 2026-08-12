"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WhatsAppService = void 0;
const whatsapp_web_js_1 = require("whatsapp-web.js");
const qrcode_terminal_1 = __importDefault(require("qrcode-terminal"));
const dotenv_1 = __importDefault(require("dotenv"));
const fs_1 = __importDefault(require("fs"));
dotenv_1.default.config();
// Railway mounts a persistent volume at this path so the WhatsApp session
// survives across deployments/restarts, avoiding a re-scan of the QR code.
const WHATSAPP_AUTH_PATH = process.env.WHATSAPP_AUTH_PATH || '/app/whatsapp-auth';
class WhatsAppService {
    static client = null;
    static isReady = false;
    static qrCode = null;
    static initialize() {
        console.log('Initializing WhatsApp Client...');
        try {
            // Make sure the persistent volume directory exists before LocalAuth tries to use it.
            try {
                fs_1.default.mkdirSync(WHATSAPP_AUTH_PATH, { recursive: true });
            }
            catch (mkdirErr) {
                console.error('❌ Failed to ensure WhatsApp auth directory exists (continuing anyway):', mkdirErr.message);
            }
            // We use LocalAuth pointed at the persistent volume so the session survives
            // container restarts/redeploys and we don't need to scan the QR code every time.
            this.client = new whatsapp_web_js_1.Client({
                authStrategy: new whatsapp_web_js_1.LocalAuth({
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
                    protocolTimeout: 120000, // 120s timeout
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
                qrcode_terminal_1.default.generate(qr, { small: true });
                this.qrCode = qr;
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
            this.client.initialize().catch((err) => {
                console.error('❌ WhatsApp failed to initialize (server continues without WhatsApp):', err.message);
            });
        }
        catch (err) {
            console.error('❌ WhatsApp setup error (server continues without WhatsApp):', err.message);
        }
    }
    static notificationsEnabled = process.env.ENABLE_WHATSAPP !== 'false';
    static getQRCode() {
        return this.qrCode;
    }
    static getIsReady() {
        return this.isReady;
    }
    static getNotificationsEnabled() {
        return this.notificationsEnabled;
    }
    static setNotificationsEnabled(enabled) {
        this.notificationsEnabled = enabled;
        console.log(`📱 WhatsApp notifications enabled: ${enabled}`);
    }
    static async sendGroupMessage(groupName, text) {
        if (!this.notificationsEnabled) {
            console.log('ℹ️ WhatsApp notifications are disabled. Skipping message.');
            return false;
        }
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
            let chats = [];
            try {
                chats = await this.client.pupPage.evaluate(() => {
                    const chatCollection = window.require('WAWebCollections').Chat;
                    return chatCollection.getModelsArray().map((c) => ({
                        id: c.id._serialized,
                        name: c.name || c.formattedTitle || '',
                        isGroup: c.id._serialized.endsWith('@g.us')
                    }));
                });
            }
            catch (evalError) {
                console.warn('⚠️ WhatsApp pupPage evaluate failed (detached frame?), falling back to getChats():', evalError.message);
                const rawChats = await this.client.getChats();
                chats = rawChats.map((c) => ({
                    id: c.id._serialized,
                    name: c.name,
                    isGroup: c.isGroup
                }));
            }
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
