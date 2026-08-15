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
const path_1 = __importDefault(require("path"));
const Setting_1 = require("../models/Setting");
dotenv_1.default.config();
// Railway mounts a persistent volume at this path so the WhatsApp session
// survives across deployments/restarts, avoiding a re-scan of the QR code.
const WHATSAPP_AUTH_PATH = process.env.WHATSAPP_AUTH_PATH || path_1.default.join(process.cwd(), 'whatsapp-auth');
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
                }
            });
            this.client.on('qr', (qr) => {
                console.log('==========================================');
                console.log('📱 WHATSAPP LOGIN REQUIRED!');
                console.log('Scan the QR Code below with your WhatsApp:');
                console.log('==========================================');
                qrcode_terminal_1.default.generate(qr, { small: true });
                this.qrCode = qr;
                console.log('DEBUG: Assigned this.qrCode =', this.qrCode ? 'valid' : 'null');
            });
            this.client.on('authenticated', (session) => {
                console.log('✅ WhatsApp Authenticated! (Wait for READY...)');
                this.qrCode = null; // Clear QR immediately so the frontend knows scanning succeeded
                // This means the phone successfully scanned and authorized the session.
                // If it hangs after this, it is likely an Out Of Memory (OOM) error or Puppeteer crash in Docker.
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
            this.client.on('message', async (msg) => {
                try {
                    // Only process group messages
                    if (!msg.from.endsWith('@g.us'))
                        return;
                    const text = msg.body.trim();
                    const lowerText = text.toLowerCase();
                    // Trigger word: Paid or Expense
                    if (!lowerText.startsWith('paid ') && !lowerText.startsWith('expense '))
                        return;
                    if (!msg.author)
                        return;
                    console.log(`💬 Received WhatsApp Expense: ${text}`);
                    const chat = await msg.getChat();
                    const groupName = chat.name;
                    const Group = require('../models/Group').default;
                    const group = await Group.findOne({ title: groupName });
                    if (!group) {
                        await msg.reply('❌ Group not linked to ExpenseBot. Please create it in Telegram first with the exact same name.');
                        return;
                    }
                    const User = require('../models/User').default;
                    const contact = await msg.getContact();
                    const pushname = contact.pushname || contact.name || 'WA User';
                    let sender = await User.findOne({ whatsappJid: msg.author });
                    if (!sender) {
                        // Check if they exist by firstName mapping
                        sender = await User.findOne({ firstName: pushname, telegramUserId: { $in: group.members } });
                        if (sender) {
                            sender.whatsappJid = msg.author;
                            await sender.save();
                        }
                        else {
                            // Generate fake telegramUserId from JID hash
                            const fakeId = parseInt(msg.author.replace(/\D/g, '').slice(-9)) || Math.floor(Math.random() * 1000000000);
                            sender = new User({
                                telegramUserId: fakeId,
                                whatsappJid: msg.author,
                                firstName: pushname
                            });
                            await sender.save();
                            group.members.push(fakeId);
                            await group.save();
                        }
                    }
                    const { ExpenseService } = require('./ExpenseService');
                    const result = await ExpenseService.processTextMessage(group.telegramChatId, sender.telegramUserId, text, [], undefined);
                    if ('error' in result) {
                        await msg.reply(`❌ ${result.error}`);
                        return;
                    }
                    // Reply with poll
                    const { Poll } = require('whatsapp-web.js');
                    const poll = new Poll(`✅ Expense Parsed!\nTotal: ₹${result.totalAmount}\nPaid By: ${sender.firstName || 'You'}\n\nApprove this expense?`, ['✅ Confirm', '❌ Cancel'], { allowMultipleAnswers: false });
                    const pollMsg = await this.client.sendMessage(msg.from, poll);
                    // Save the poll ID to the expense
                    result.whatsappPollMessageId = pollMsg.id._serialized;
                    await result.save();
                }
                catch (error) {
                    console.error('❌ Error processing WhatsApp message:', error);
                }
            });
            this.client.on('vote_update', async (vote) => {
                try {
                    const pollMessageId = vote.parentMessage.id._serialized;
                    const voterJid = vote.voter;
                    const selectedOptions = vote.selectedOptions; // array of { id, name }
                    if (selectedOptions.length === 0)
                        return; // Unvoted
                    const optionName = selectedOptions[0].name;
                    const Expense = require('../models/Expense').default;
                    const Settlement = require('../models/Settlement').default;
                    const User = require('../models/User').default;
                    let user = await User.findOne({ whatsappJid: voterJid });
                    // If user doesn't have whatsappJid yet but voted, try to find them by contact pushname
                    if (!user) {
                        const contact = await this.client.getContactById(voterJid);
                        const pushname = contact.pushname || contact.name || 'WA User';
                        user = await User.findOne({ firstName: pushname });
                        if (user) {
                            user.whatsappJid = voterJid;
                            await user.save();
                        }
                        else {
                            // Ignore votes from people completely unknown
                            return;
                        }
                    }
                    const expense = await Expense.findOne({ whatsappPollMessageId: pollMessageId, status: 'PENDING_CONFIRMATION' });
                    if (expense) {
                        if (optionName === '❌ Cancel') {
                            expense.status = 'CANCELLED';
                            await expense.save();
                            await this.client.sendMessage(vote.parentMessage.to, `❌ Expense for ₹${expense.totalAmount} was cancelled by ${user.firstName}.`);
                        }
                        else if (optionName === '✅ Confirm') {
                            expense.status = 'CONFIRMED';
                            await expense.save();
                            await this.client.sendMessage(vote.parentMessage.to, `✅ Expense for ₹${expense.totalAmount} has been confirmed! Ledger updated.`);
                        }
                        return;
                    }
                    const settlement = await Settlement.findOne({ whatsappPollMessageId: pollMessageId, status: 'PENDING_APPROVAL' });
                    if (settlement) {
                        if (optionName === '❌ Cancel') {
                            // Delete settlement
                            await Settlement.deleteOne({ _id: settlement._id });
                            await this.client.sendMessage(vote.parentMessage.to, `❌ Settlement for ₹${settlement.amount} was cancelled by ${user.firstName}.`);
                            return;
                        }
                        else if (optionName === '✅ Confirm') {
                            // Only debtor or creditor can approve
                            if (user.telegramUserId !== settlement.paidByTelegramUserId && user.telegramUserId !== settlement.paidToTelegramUserId) {
                                return; // Ignore votes from others
                            }
                            if (!settlement.approvedBy.includes(user.telegramUserId)) {
                                settlement.approvedBy.push(user.telegramUserId);
                            }
                            if (settlement.approvedBy.includes(settlement.paidByTelegramUserId) && settlement.approvedBy.includes(settlement.paidToTelegramUserId)) {
                                settlement.status = 'CONFIRMED';
                                await settlement.save();
                                // Process the settlement in the ledger
                                const { LedgerService } = require('./LedgerService');
                                await LedgerService.processSettlement(settlement);
                                await this.client.sendMessage(vote.parentMessage.to, `✅ Settlement of ₹${settlement.amount} is fully confirmed! Both parties approved.`);
                            }
                            else {
                                await settlement.save();
                                await this.client.sendMessage(vote.parentMessage.to, `⏳ ${user.firstName} approved the settlement. Waiting for the other party...`);
                            }
                        }
                    }
                }
                catch (error) {
                    console.error('❌ Error processing vote:', error);
                }
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
    static async sendGroupPoll(groupName, pollName, options) {
        if (!this.notificationsEnabled)
            return null;
        if (!this.client || !this.isReady)
            return null;
        try {
            const chats = await this.client.getChats();
            const targetGroup = chats.find(c => c.isGroup && c.name === groupName);
            if (targetGroup) {
                const { Poll } = require('whatsapp-web.js');
                const poll = new Poll(pollName, options, { allowMultipleAnswers: false });
                const pollMsg = await this.client.sendMessage(targetGroup.id._serialized, poll);
                return pollMsg;
            }
        }
        catch (e) {
            console.error('❌ Failed to send WhatsApp Poll:', e.message);
        }
        return null;
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
        if (imageUrl) {
            try {
                if (imageUrl.startsWith('data:')) {
                    const parts = imageUrl.split(';base64,');
                    if (parts.length === 2) {
                        const mimeType = parts[0].replace('data:', '');
                        const base64Data = parts[1];
                        media = new whatsapp_web_js_1.MessageMedia(mimeType, base64Data, `receipt_${Date.now()}.jpg`);
                    }
                }
                else if (imageUrl.startsWith('/uploads/')) {
                    const localPath = path_1.default.join(process.cwd(), imageUrl);
                    if (fs_1.default.existsSync(localPath)) {
                        media = whatsapp_web_js_1.MessageMedia.fromFilePath(localPath);
                    }
                    else {
                        console.warn(`⚠️ WhatsApp image not found on disk: ${localPath}`);
                    }
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
                    if (media) {
                        return await this.client.sendMessage(targetJid, media, { caption: text });
                    }
                    else {
                        return await this.client.sendMessage(targetJid, text);
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
                    try {
                        const req = window.require;
                        if (!req)
                            return [];
                        const chatCollection = req('WAWebCollections').Chat;
                        const models = chatCollection?.getModelsArray ? chatCollection.getModelsArray() : [];
                        return models
                            .filter((c) => {
                            const id = c.id?._serialized || (typeof c.id === 'string' ? c.id : '');
                            return String(id).endsWith('@g.us');
                        })
                            .map((c) => ({
                            id: String(c.id?._serialized || c.id || ''),
                            name: String(c.name || c.formattedTitle || ''),
                            isGroup: true
                        }));
                    }
                    catch (e) {
                        return [];
                    }
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
                if (media) {
                    return await this.client.sendMessage(targetGroup.id, media, { caption: text });
                }
                else {
                    return await this.client.sendMessage(targetGroup.id, text);
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
