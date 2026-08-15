import { Setting } from "../models/Setting";
import qrcode from 'qrcode-terminal';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

const WHATSAPP_AUTH_PATH = process.env.WHATSAPP_AUTH_PATH || path.join(process.cwd(), 'whatsapp-auth');

export class WhatsAppService {

    static sock: any = null;
    static isReady = false;
    static qrCode: any = null;
    static cachedGroupJidMap = new Map<string, string>();
    static chatHistories = new Map<string, { role: string, content: string, imageUrl?: string }[]>();
    static downloadMediaMessage: any = null;
    static downloadContentFromMessage: any = null;
    static async initialize() {
        console.log('Initializing WhatsApp Client (Baileys)...');
        if (this.sock) {
            try {
                this.sock.ws.close();
            }
            catch (e) { }
        }
        const baileys = await eval(`import('@whiskeysockets/baileys')`);
        const makeWASocket = baileys.default;
        const { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, downloadMediaMessage, downloadContentFromMessage } = baileys;
        this.downloadMediaMessage = downloadMediaMessage;
        this.downloadContentFromMessage = downloadContentFromMessage;
        try {
            fs.mkdirSync(WHATSAPP_AUTH_PATH, { recursive: true });
        }
        catch (e) { }
        const { state, saveCreds } = await useMultiFileAuthState(WHATSAPP_AUTH_PATH);
        const { version } = await fetchLatestBaileysVersion();
        const pino = require('pino');
        this.sock = makeWASocket({
            version,
            auth: state,
            printQRInTerminal: false,
            syncFullHistory: false,
            markOnlineOnConnect: true,
            logger: pino({ level: 'silent' }),
            browser: baileys.Browsers.macOS('Desktop')
        });
        this.sock.ev.on('creds.update', saveCreds);
        this.sock.ev.on('connection.update', async (update: any) => {
            const { connection, lastDisconnect, qr } = update;
            if (qr) {
                console.log('==========================================');
                console.log('📱 WHATSAPP LOGIN REQUIRED!');
                console.log('Scan the QR Code below with your WhatsApp:');
                console.log('==========================================');
                qrcode.generate(qr, { small: true });
                this.qrCode = qr;
            }
            if (connection === 'close') {
                const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
                console.log('WhatsApp connection closed due to ', lastDisconnect?.error, ', reconnecting ', shouldReconnect);
                this.isReady = false;
                if (shouldReconnect) {
                    setTimeout(() => this.initialize(), 3000);
                }
                else {
                    console.log('You are logged out. Please delete the session folder and restart.');
                    try {
                        fs.rmSync(WHATSAPP_AUTH_PATH, { recursive: true, force: true });
                    }
                    catch (e) { }
                }
            }
            else if (connection === 'open') {
                console.log('✅ WhatsApp Client is READY!');
                this.isReady = true;
                this.qrCode = null;
                
                // Pre-fetch all groups to populate cachedGroupJidMap
                try {
                    const groups = await this.sock!.groupFetchAllParticipating();
                    for (const id in groups) {
                        this.cachedGroupJidMap.set(id, groups[id].subject);
                    }
                    console.log(`📦 Loaded ${Object.keys(groups).length} WhatsApp groups into cache.`);
                } catch (err) {
                    console.error('Error fetching WhatsApp groups:', err);
                }
            }
        });
        this.sock.ev.on('messages.upsert', async (m: any) => {
            if (m.type !== 'notify') return;
            for (const msg of m.messages) {
                if (!msg.message) continue;
                const isGroup = msg.key.remoteJid?.endsWith('@g.us');
                if (!isGroup) continue;

                const groupJid = msg.key.remoteJid!;
                const senderJid = msg.key.participant || msg.participant || msg.key.remoteJid || '';

                let text = msg.message.conversation || msg.message.extendedTextMessage?.text || msg.message.imageMessage?.caption || msg.message.videoMessage?.caption || msg.message.documentMessage?.caption || '';
                let imageUrl: string | undefined = undefined;

                const downloadContentFromMessage = WhatsAppService.downloadContentFromMessage;

                // Check for Image
                if (msg.message.imageMessage || (msg.message.documentMessage && msg.message.documentMessage.mimetype?.startsWith('image/'))) {
                    try {
                        const messageType = msg.message.imageMessage ? 'image' : 'document';
                        const stream = await downloadContentFromMessage(
                            msg.message.imageMessage || msg.message.documentMessage,
                            messageType
                        );
                        let buffer = Buffer.from([]);
                        for await (const chunk of stream) {
                            buffer = Buffer.concat([buffer, chunk]);
                        }
                        const mimetype = msg.message.imageMessage?.mimetype || msg.message.documentMessage?.mimetype || 'image/jpeg';
                        imageUrl = `data:${mimetype};base64,${buffer.toString('base64')}`;
                        if (!text) text = "I attached a receipt. Please record this expense.";
                    } catch (err) {
                        console.error('Error downloading WhatsApp image:', err);
                    }
                }

                // Check for Audio / Voice Note
                if (!text && (msg.message.audioMessage)) {
                    try {
                        await this.sock!.sendMessage(groupJid, { text: '🎙️ _Listening..._' });
                        const stream = await downloadContentFromMessage(
                            msg.message.audioMessage,
                            'audio'
                        );
                        let buffer = Buffer.from([]);
                        for await (const chunk of stream) {
                            buffer = Buffer.concat([buffer, chunk]);
                        }
                        
                        const fileExt = msg.message.audioMessage.mimetype?.includes('ogg') ? '.ogg' : '.mp3';
                        const destName = `wa_audio_${Date.now()}${fileExt}`;
                        const path = require('path');
                        const destPath = path.join(process.cwd(), 'uploads', destName);
                        fs.mkdirSync(path.join(process.cwd(), 'uploads'), { recursive: true });
                        fs.writeFileSync(destPath, buffer as Buffer);
                        
                        const { AIService } = require('./AIService');
                        text = await AIService.transcribeAudio(destPath);
                        
                        const mimetype = fileExt === '.ogg' ? 'audio/ogg' : 'audio/mp3';
                        imageUrl = `data:${mimetype};base64,${buffer.toString('base64')}`;
                        try { fs.unlinkSync(destPath); } catch (e) {}
                    } catch (err) {
                        console.error('Error downloading/transcribing WhatsApp audio:', err);
                        await this.sock!.sendMessage(groupJid, { text: '❌ Failed to understand the audio.' });
                        continue;
                    }
                }

                if (!text) continue;

                // Prevent infinite loops from the bot's own automated replies
                if (msg.key.fromMe && (text.startsWith('🤖') || text.startsWith('❌') || text.startsWith('✅') || text.startsWith('❓') || text.startsWith('⏳') || text.startsWith('💸') || text.includes('Approve this expense?'))) {
                    continue;
                }

                // Handle Commands
                if (text.startsWith('/start')) {
                    await this.sock!.sendMessage(groupJid, { text: `🤖 *BOTTY*\nWelcome to PG SPLITTER 👋\n\nYour account is ready.\nYou can simply tell me about an expense in English, Hindi, Marathi, or mixed language.` });
                    continue;
                }
                
                if (text.startsWith('/balance')) {
                    try {
                        const Expense = require('../models/Expense').default;
                        const Settlement = require('../models/Settlement').default;
                        const { LedgerService } = require('./LedgerService');
                        const User = require('../models/User').default;
                        
                        // We need the group's telegramChatId to fetch the right balances
                        let gn = this.cachedGroupJidMap.get(groupJid);
                        if (!gn) {
                            try {
                                const metadata = await this.sock!.groupMetadata(groupJid);
                                gn = metadata.subject;
                                this.cachedGroupJidMap.set(groupJid, gn!);
                            } catch(e){}
                        }
                        const Group = require('../models/Group').default;
                        const grp = await Group.findOne({ title: gn });
                        
                        if (grp) {
                            const expenses = await Expense.find({ telegramChatId: grp.telegramChatId, status: 'CONFIRMED' });
                            const settlements = await Settlement.find({ telegramChatId: grp.telegramChatId });
                            const balances = LedgerService.calculateBalances(expenses, settlements);
                            
                            let balText = '*💰 Current Balances*\n\n';
                            let hasBalances = false;
                            for (const debtorIdStr in balances.net) {
                                const debtorId = parseInt(debtorIdStr, 10);
                                const debtor = await User.findOne({ telegramUserId: debtorId });
                                const debtorName = debtor?.firstName || debtor?.username || 'Unknown';
                                
                                for (const creditorIdStr in balances.net[debtorId]) {
                                    const creditorId = parseInt(creditorIdStr, 10);
                                    const creditor = await User.findOne({ telegramUserId: creditorId });
                                    const creditorName = creditor?.firstName || creditor?.username || 'Unknown';
                                    
                                    const amount = balances.net[debtorId][creditorId];
                                    balText += `• ${debtorName} owes ${creditorName} ₹${amount}\n`;
                                    hasBalances = true;
                                }
                            }
                            if (!hasBalances) {
                                balText += 'All settled up!';
                            }
                            await this.sock!.sendMessage(groupJid, { text: balText });
                        }
                    } catch (err) {
                        console.error('Error in /balance via WA', err);
                    }
                    continue;
                }

                // Track Chat History Context
                if (!this.chatHistories.has(groupJid)) this.chatHistories.set(groupJid, []);
                const history = this.chatHistories.get(groupJid)!;
                history.push({ role: 'user', content: text, imageUrl: imageUrl });
                if (history.length > 6) history.shift();

                // Inherit previous image if not provided in current message
                if (!imageUrl) {
                    for (let i = history.length - 1; i >= 0; i--) {
                        if (history[i].imageUrl) {
                            imageUrl = history[i].imageUrl;
                            break;
                        }
                    }
                }

                const quotedMsgId = msg.message.extendedTextMessage?.contextInfo?.stanzaId;
                const lowerText = text.trim().toLowerCase();
                const isConfirm = lowerText === 'yes' || lowerText === 'y' || lowerText === 'confirm';
                const isCancel = lowerText === 'no' || lowerText === 'n' || lowerText === 'cancel';

                if (isConfirm || isCancel) {
                    const Expense = require('../models/Expense').default;
                    const Settlement = require('../models/Settlement').default;
                    const User = require('../models/User').default;
                    const cleanSenderJid = senderJid.split('@')[0];
                    let user = await User.findOne({ whatsappJid: new RegExp(`^${cleanSenderJid}@`) });
                    let expense = null;
                    let settlement = null;
                    if (quotedMsgId) {
                        expense = await Expense.findOne({ whatsappPollMessageId: quotedMsgId, status: 'PENDING_CONFIRMATION' });
                        if (!expense) {
                            settlement = await Settlement.findOne({ whatsappPollMessageId: quotedMsgId, status: 'PENDING_APPROVAL' });
                        }
                    } else if (user) {
                        expense = await Expense.findOne({
                            $or: [{ addedByTelegramUserId: user.telegramUserId }, { paidByTelegramUserId: user.telegramUserId }],
                            status: 'PENDING_CONFIRMATION'
                        }).sort({ createdAt: -1 });
                        if (!expense) {
                            settlement = await Settlement.findOne({
                                $or: [{ paidByTelegramUserId: user.telegramUserId }, { paidToTelegramUserId: user.telegramUserId }],
                                status: 'PENDING_APPROVAL'
                            }).sort({ createdAt: -1 });
                        }
                    }
                    if (expense && user) {
                        const targetId = expense.addedByTelegramUserId || expense.paidByTelegramUserId;
                        if (user.telegramUserId !== targetId) {
                            await this.sock!.sendMessage(groupJid, { text: `🤖 *BOTTY*\n❌ Only the person who added the expense can confirm it.` }, { quoted: msg });
                            continue;
                        }
                        if (!isConfirm) {
                            expense.status = 'CANCELLED';
                            await expense.save();
                            await this.sock!.sendMessage(groupJid, { text: `🤖 *BOTTY*\n❌ Expense for ₹${expense.totalAmount} was cancelled.` });
                        } else {
                            expense.status = 'CONFIRMED';
                            await expense.save();
                            await this.sock!.sendMessage(groupJid, { text: `🤖 *BOTTY*\n✅ Expense for ₹${expense.totalAmount} has been confirmed! Ledger updated.` });
                            await WhatsAppService.broadcastToSplitHistory(expense, 'expense');
                        }
                        continue;
                    }
                    if (settlement && user) {
                        if (!isConfirm) {
                            await Settlement.deleteOne({ _id: settlement._id });
                            await this.sock!.sendMessage(groupJid, { text: `🤖 *BOTTY*\n❌ Settlement for ₹${settlement.amount} was cancelled by ${user.firstName}.` });
                            continue;
                        } else {
                            if (user.telegramUserId !== settlement.paidByTelegramUserId && user.telegramUserId !== settlement.paidToTelegramUserId) {
                                continue;
                            }
                            if (!settlement.approvedBy.includes(user.telegramUserId)) {
                                settlement.approvedBy.push(user.telegramUserId);
                                if (settlement.approvedBy.includes(settlement.paidByTelegramUserId) && settlement.approvedBy.includes(settlement.paidToTelegramUserId)) {
                                    settlement.status = 'CONFIRMED';
                                    await settlement.save();
                                    const { LedgerService } = require('./LedgerService');
                                    await LedgerService.processSettlement(settlement);
                                    await this.sock!.sendMessage(groupJid, { text: `🤖 *BOTTY*\n✅ Settlement of ₹${settlement.amount} is fully confirmed! Both parties approved.` });
                                    await WhatsAppService.broadcastToSplitHistory(settlement, 'settlement');
                                } else {
                                    await settlement.save();
                                    await this.sock!.sendMessage(groupJid, { text: `🤖 *BOTTY*\n⏳ ${user.firstName} approved the settlement. Waiting for the other party...` });
                                }
                            }
                            continue;
                        }
                    }
                }

                // If not yes/no, Process Natural Language Expense / Settlement
                let groupName = this.cachedGroupJidMap.get(groupJid);
                if (!groupName) {
                    try {
                        const metadata = await this.sock!.groupMetadata(groupJid);
                        groupName = metadata.subject;
                        this.cachedGroupJidMap.set(groupJid, groupName!);
                    } catch (e) {
                        continue;
                    }
                }
                const Group = require('../models/Group').default;
                const group = await Group.findOne({ title: groupName });
                if (!group) {
                    await this.sock!.sendMessage(groupJid, { text: '❌ Group not linked to ExpenseBot. Please create it in Telegram first with the exact same name.' });
                    continue;
                }
                const User = require('../models/User').default;
                const pushname = msg.pushName || 'WA User';
                const cleanSenderJid = senderJid.split('@')[0];
                let sender = await User.findOne({ whatsappJid: new RegExp(`^${cleanSenderJid}@`) });
                if (!sender) {
                    sender = await User.findOne({ firstName: pushname, telegramUserId: { $in: group.members } });
                    if (sender) {
                        sender.whatsappJid = senderJid;
                        await sender.save();
                    } else {
                        const fakeId = parseInt(cleanSenderJid.slice(-9)) || Math.floor(Math.random() * 1000000000);
                        sender = new User({
                            telegramUserId: fakeId,
                            whatsappJid: senderJid,
                            firstName: pushname
                        });
                        await sender.save();
                        group.members.push(fakeId);
                        await group.save();
                    }
                }

                const { ExpenseService } = require('./ExpenseService');
                
                // Pass history context and image
                const result = await ExpenseService.processTextMessage(group.telegramChatId, sender.telegramUserId, text, history.slice(0, -1), imageUrl);
                
                if ('error' in result) {
                    if (result.clarificationQuestion) {
                        history.push({ role: 'assistant', content: result.clarificationQuestion });
                        if (history.length > 6) history.shift();
                        await this.sock!.sendMessage(groupJid, { text: `🤖 *BOTTY*\n❓ ${result.clarificationQuestion}` });
                    } else if (result.chatResponse) {
                        history.push({ role: 'assistant', content: result.chatResponse });
                        if (history.length > 6) history.shift();
                        await this.sock!.sendMessage(groupJid, { text: `🤖 *BOTTY*\n${result.chatResponse}` });
                    } else if (result.error !== 'Intent not recognized as an expense.') {
                        await this.sock!.sendMessage(groupJid, { text: `🤖 *BOTTY*\n❌ ${result.error}` });
                    }
                    continue;
                }
                
                // Clear the chat history so the next expense doesn't get merged with this one
                this.chatHistories.delete(groupJid);

                const LocalUser = require('../models/User').default;
                const LocalExpenseService = require('./ExpenseService').ExpenseService;
                const allUserIds = new Set();
                allUserIds.add(result.paidByTelegramUserId);
                result.sharedParticipants.forEach((p: any) => allUserIds.add(p.telegramUserId));
                result.personalExpenses.forEach((p: any) => allUserIds.add(p.telegramUserId));
                
                const users = await LocalUser.find({ telegramUserId: { $in: Array.from(allUserIds) } });
                const userMap = new Map();
                users.forEach((u: any) => userMap.set(u.telegramUserId, u.firstName || u.username || u.telegramUserId.toString()));
                
                const confirmText = LocalExpenseService.formatExpenseConfirmation(result, userMap, 'whatsapp');
                const confirmMsg = await this.sock!.sendMessage(groupJid, { text: confirmText });
                
                const Expense = require('../models/Expense').default;
                await Expense.updateOne({ _id: result._id }, { whatsappPollMessageId: confirmMsg?.key?.id });
            }
        });
        this.sock.ev.on('messages.update', async (events: any) => {
            // Intentionally left blank or remove completely
        });
    }
    static notificationsEnabled = true;
    static async loadSettingsFromDb() {
        try {
            let setting = await Setting.findOne({ key: 'whatsappNotifications' });
            if (setting) {
                this.notificationsEnabled = setting.value === 'true';
                console.log(`📱 Loaded WhatsApp notification setting from MongoDB: ${this.notificationsEnabled}`);
            }
            else {
                await Setting.create({ key: 'whatsappNotifications', value: 'true' });
            }
        }
        catch (e) {
            console.error('Failed to load WhatsApp settings from DB', e);
        }
    }
    static getNotificationsEnabled() {
        return this.notificationsEnabled;
    }
    static async setNotificationsEnabled(enabled: boolean) {
        this.notificationsEnabled = enabled;
        await Setting.findOneAndUpdate({ key: 'whatsappNotifications' }, { value: enabled ? 'true' : 'false' }, { upsert: true });
    }
    static getIsReady() {
        return this.isReady;
    }
    static getQRCode() {
        return this.qrCode;
    }
    static async sendGroupMessage(groupTitle: string, message: string, _quoteMessageId?: string) {
        if (!this.isReady || !this.sock) {
            console.log('⚠️ WhatsApp client is not ready. Message not sent.');
            return;
        }
        try {
            const groupJid = [...this.cachedGroupJidMap.entries()].find(([jid, name]) => name === groupTitle)?.[0];
            if (groupJid) {
                await this.sock.sendMessage(groupJid, { text: message });
            }
        }
        catch (e) {
            console.error('Error sending WhatsApp group message:', e);
        }
    }
    static async sendGroupPoll(groupTitle: string, pollQuestion: string, options: any, settlementId?: string) {
        if (!this.isReady || !this.sock) {
            console.log('⚠️ WhatsApp client is not ready. Message not sent.');
            return null;
        }
        try {
            const groupJid = [...this.cachedGroupJidMap.entries()].find(([jid, name]) => name === groupTitle)?.[0];
            if (!groupJid) {
                console.log(`⚠️ Could not find WhatsApp group JID for title: ${groupTitle}`);
                return null;
            }
            const confirmMsg = await this.sock.sendMessage(groupJid, {
                text: `🤖 *BOTTY*\n${pollQuestion}\n\n*Reply* to this message with "yes" or "no".`
            });
            return confirmMsg?.key?.id || null;
        }
        catch (e) {
            console.error('Error sending WhatsApp confirmation message:', e);
            return null;
        }
    }

    static async broadcastToSplitHistory(item: any, type: 'expense' | 'settlement') {
        try {
            const Group = require('../models/Group').default;
            const User = require('../models/User').default;
            
            const splitHistoryName = process.env.SPLIT_HISTORY_GROUP_NAME || 'Split History';
            const splitHistoryGroup = await Group.findOne({ title: splitHistoryName });
            const splitHistoryJid = [...this.cachedGroupJidMap.entries()].find(([jid, name]) => name === splitHistoryName)?.[0];

            if (!splitHistoryGroup && !splitHistoryJid) return;

            const allUserIds = new Set<number>();
            if (type === 'expense') {
                allUserIds.add(item.paidByTelegramUserId);
                item.sharedParticipants.forEach((p: any) => allUserIds.add(p.telegramUserId));
                item.personalExpenses.forEach((p: any) => allUserIds.add(p.telegramUserId));
            } else {
                allUserIds.add(item.paidByTelegramUserId);
                allUserIds.add(item.paidToTelegramUserId);
            }

            const users = await User.find({ telegramUserId: { $in: Array.from(allUserIds) } });
            const userMap = new Map<number, string>();
            users.forEach((u: any) => userMap.set(u.telegramUserId, u.firstName || u.username || u.telegramUserId.toString()));

            let tgText = '';
            let waText = '';

            if (type === 'expense') {
                const LocalExpenseService = require('./ExpenseService').ExpenseService;
                tgText = `🤖 <b>[Message from BOTTY]</b>\n\n🧾 <b>New Expense Confirmed!</b>\n\n` + LocalExpenseService.formatExpenseConfirmation(item, userMap, 'telegram').replace(/🧾 <b>Expense Detected<\/b>\n\n/, '').replace(/Confirm this expense\?/, '');
                waText = `🤖 *[Message from BOTTY]*\n\n🧾 *New Expense Confirmed!*\n\n` + LocalExpenseService.formatExpenseConfirmation(item, userMap, 'whatsapp').replace(/🧾 \*Expense Detected\*\n\n/, '').replace(/\*Reply\* to this message.*/, '');
            } else {
                const paidByName = userMap.get(item.paidByTelegramUserId) || 'Unknown';
                const paidToName = userMap.get(item.paidToTelegramUserId) || 'Unknown';
                tgText = `🤖 <b>[Message from BOTTY]</b>\n\n✅ <b>Settlement Confirmed</b>\n\n💸 <b>${paidByName}</b> paid ₹${item.amount} to <b>${paidToName}</b>\nLedger updated!`;
                waText = `🤖 *[Message from BOTTY]*\n\n✅ *Settlement Confirmed*\n\n💸 *${paidByName}* paid ₹${item.amount} to *${paidToName}*\nLedger updated!`;
            }

            // Append Current Balances
            try {
                const Expense = require('../models/Expense').default;
                const Settlement = require('../models/Settlement').default;
                const LedgerService = require('./LedgerService').LedgerService;
                
                const allExpenses = await Expense.find({ status: 'CONFIRMED' });
                const allSettlements = await Settlement.find({});
                const balances = LedgerService.calculateBalances(allExpenses, allSettlements);

                const allUsers = await User.find({});
                const globalUserMap = new Map<number, string>();
                allUsers.forEach((u: any) => globalUserMap.set(u.telegramUserId, u.firstName || u.username || u.telegramUserId.toString()));

                let hasBalances = false;
                let tgBalanceText = `\n💳 <b>Current Balances:</b>\n`;
                let waBalanceText = `\n💳 *Current Balances:*\n`;

                for (const debtorStr in balances.net) {
                    const debtorId = parseInt(debtorStr, 10);
                    for (const creditorStr in balances.net[debtorStr]) {
                        const creditorId = parseInt(creditorStr, 10);
                        const amount = balances.net[debtorStr][creditorId];
                        const debtorName = globalUserMap.get(debtorId) || 'Unknown';
                        const creditorName = globalUserMap.get(creditorId) || 'Unknown';
                        tgBalanceText += `• ${debtorName} ➔ ${creditorName}: ₹${amount}\n`;
                        waBalanceText += `• ${debtorName} ➔ ${creditorName}: ₹${amount}\n`;
                        hasBalances = true;
                    }
                }

                if (hasBalances) {
                    tgText += tgBalanceText;
                    waText += waBalanceText;
                }
            } catch (err) {
                console.error('Failed to append balances:', err);
            }

            if (splitHistoryGroup) {
                const TelegramService = require('./TelegramService').TelegramService;
                if (type === 'expense' && item.imageUrl) {
                    if (item.imageUrl.startsWith('data:audio/')) {
                        await TelegramService.sendAudio(splitHistoryGroup.telegramChatId, item.imageUrl);
                        await TelegramService.sendMessage(splitHistoryGroup.telegramChatId, tgText);
                    } else {
                        await TelegramService.sendPhoto(splitHistoryGroup.telegramChatId, item.imageUrl, tgText);
                    }
                } else {
                    await TelegramService.sendMessage(splitHistoryGroup.telegramChatId, tgText);
                }
            }

            if (splitHistoryJid && this.sock) {
                if (type === 'expense' && item.imageUrl) {
                    if (item.imageUrl.startsWith('data:audio/')) {
                        const base64Data = item.imageUrl.split(',')[1];
                        const buffer = Buffer.from(base64Data, 'base64');
                        // Send audio voice note
                        await this.sock.sendMessage(splitHistoryJid, { audio: buffer, mimetype: 'audio/mp4', ptt: true });
                        // Send text confirmation separately since voice notes can't have captions in WA
                        await this.sock.sendMessage(splitHistoryJid, { text: waText });
                    } else {
                        const base64Data = item.imageUrl.split(',')[1];
                        const buffer = Buffer.from(base64Data, 'base64');
                        // Send image with caption
                        await this.sock.sendMessage(splitHistoryJid, { image: buffer, caption: waText });
                    }
                } else {
                    await this.sock.sendMessage(splitHistoryJid, { text: waText });
                }
            }
        } catch (e) {
            console.error('Error broadcasting to Split History:', e);
        }
    }
}
