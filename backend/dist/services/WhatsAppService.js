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
const Setting_1 = require("../models/Setting");
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
                    protocolTimeout: 60000, // 60s timeout
                },
                webVersionCache: {
                    type: 'remote',
                    remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.3000.1045270340-alpha.html'
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
    static notificationsEnabled = process.env.ENABLE_WHATSAPP === 'true';
    static cachedGroupJidMap = new Map();
    static getQRCode() {
        return this.qrCode;
    }
    static getIsReady() {
        return this.isReady;
    }
    static async loadSettingsFromDb() {
        try {
            const setting = await Setting_1.Setting.findOne({ key: 'whatsapp_notifications_enabled' });
            if (setting && typeof setting.value === 'boolean') {
                this.notificationsEnabled = setting.value;
                console.log(`📱 Loaded WhatsApp notification setting from MongoDB: ${this.notificationsEnabled}`);
            }
        }
        catch (e) {
            console.warn('⚠️ Could not load WhatsApp notification setting from MongoDB:', e.message);
        }
    }
    static getNotificationsEnabled() {
        return this.notificationsEnabled;
    }
    static async setNotificationsEnabled(enabled) {
        this.notificationsEnabled = enabled;
        console.log(`📱 WhatsApp notifications enabled: ${enabled}`);
        try {
            await Setting_1.Setting.findOneAndUpdate({ key: 'whatsapp_notifications_enabled' }, { value: enabled }, { upsert: true, returnDocument: 'after' });
            console.log(`💾 Saved WhatsApp notification preference (${enabled}) to MongoDB`);
        }
        catch (e) {
            console.error('❌ Failed to persist WhatsApp notification setting to MongoDB:', e.message);
        }
    }
    static async sendGroupMessage(groupName, text, imageUrl) {
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
        let media = undefined;
        if (imageUrl && imageUrl.startsWith('data:')) {
            try {
                const parts = imageUrl.split(';base64,');
                if (parts.length === 2) {
                    const mimeType = parts[0].replace('data:', '');
                    const base64Data = parts[1];
                    media = new whatsapp_web_js_1.MessageMedia(mimeType, base64Data, `receipt_${Date.now()}.jpg`);
                }
            }
            catch (mediaErr) {
                console.warn('⚠️ Failed to construct MessageMedia for WhatsApp:', mediaErr.message);
            }
        }
        const cacheKey = (groupName || 'default').toLowerCase().trim();
        // 1. Fast path: Try sending directly using cached group JID
        if (this.cachedGroupJidMap.has(cacheKey)) {
            const targetJid = this.cachedGroupJidMap.get(cacheKey);
            try {
                console.log(`🚀 [WhatsApp] Dispatching message to JID: ${targetJid}`);
                const sendPromise = (async () => {
                    const chat = await this.client.getChatById(targetJid);
                    if (media) {
                        return await chat.sendMessage(media, { caption: text });
                    }
                    else {
                        return await chat.sendMessage(text);
                    }
                })();
                // Wrap in a 30-second timeout to prevent indefinite hangs
                await Promise.race([
                    sendPromise,
                    new Promise((_, reject) => setTimeout(() => reject(new Error('sendMessage timed out after 30 seconds')), 30000))
                ]);
                console.log(`✅ WhatsApp message (with ${media ? 'image' : 'text'}) sent directly using cached JID (${targetJid}) to group "${groupName}"`);
                return true;
            }
            catch (cacheErr) {
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
            // Find the group chat matching the name (case-insensitive, fuzzy, or single group fallback)
            const targetGroup = chats.find((chat) => chat.isGroup && (!groupName ||
                chat.name?.toLowerCase().trim() === groupName.toLowerCase().trim() ||
                chat.name?.toLowerCase().includes(groupName.toLowerCase()) ||
                groupName.toLowerCase().includes(chat.name?.toLowerCase() || ''))) || chats.find((chat) => chat.isGroup);
            if (!targetGroup) {
                console.warn(`⚠️ WhatsApp Group "${groupName}" not found! Available groups:`);
                const groups = chats.filter((c) => c.isGroup);
                groups.forEach((g) => console.log(`  - "${g.name}"`));
                return false;
            }
            // Cache the group JID for direct sub-second delivery on future messages
            this.cachedGroupJidMap.set(cacheKey, targetGroup.id);
            console.log(`🚀 [WhatsApp] Dispatching message to JID (fallback): ${targetGroup.id}`);
            const sendPromise = (async () => {
                const chat = await this.client.getChatById(targetGroup.id);
                if (media) {
                    return await chat.sendMessage(media, { caption: text });
                }
                else {
                    return await chat.sendMessage(text);
                }
            })();
            await Promise.race([
                sendPromise,
                new Promise((_, reject) => setTimeout(() => reject(new Error('sendMessage timed out after 30 seconds')), 30000))
            ]);
            console.log(`✅ WhatsApp message (with ${media ? 'image' : 'text'}) sent to group "${groupName}" (JID: ${targetGroup.id})`);
            return true;
        }
        catch (e) {
            console.error('❌ Failed to send WhatsApp message:', e);
            return false;
        }
    }
}
exports.WhatsAppService = WhatsAppService;
