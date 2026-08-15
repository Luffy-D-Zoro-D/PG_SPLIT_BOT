const fs = require('fs');

let ts = fs.readFileSync('src/services/WhatsAppService.ts', 'utf8');

ts = ts.replace(/import \{ getSetting, updateSetting \} from "\.\.\/models\/Setting";/, 'import Setting, { getSetting, updateSetting } from "../models/Setting";');
ts = ts.replace(/this\.sock\.ev\.on\('messages\.upsert', async \(events\)/, "this.sock.ev.on('messages.upsert', async (events: any)");
ts = ts.replace(/public static setNotificationsEnabled\(enabled\)/, "public static setNotificationsEnabled(enabled: boolean)");

ts = ts.replace(/static async sendTextMessage\(groupTitle, message, _quoteMessageId\)/g, "static async sendTextMessage(groupTitle: string, message: string, _quoteMessageId?: string)");
ts = ts.replace(/static async sendPollToGroup\(groupTitle, pollQuestion, options, settlementId\)/g, "static async sendPollToGroup(groupTitle: string, pollQuestion: string, options: any, settlementId?: string)");

// Fix TelegramWebhookController 
let tw = fs.readFileSync('src/controllers/TelegramWebhookController.ts', 'utf8');
tw = tw.replace(/WhatsAppService\.sendTextMessage/g, "WhatsAppService.sendGroupMessage");
fs.writeFileSync('src/controllers/TelegramWebhookController.ts', tw);

// Oh wait, in the decompiled JS, sendGroupMessage is actually still named sendTextMessage if I renamed it?
// Let me rename sendTextMessage back to sendGroupMessage so it matches!
ts = ts.replace(/static async sendTextMessage/g, "static async sendGroupMessage");

fs.writeFileSync('src/services/WhatsAppService.ts', ts);

console.log('Fixed TS 4!');
