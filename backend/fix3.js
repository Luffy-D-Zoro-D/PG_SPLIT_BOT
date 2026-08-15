const fs = require('fs');

let ts = fs.readFileSync('src/services/WhatsAppService.ts', 'utf8');

ts = ts.replace(/import Setting from "\.\.\/models\/Setting";/, '');
ts = ts.replace(/this\.cachedGroupJidMap\.set\(groupJid, groupName\);/, 'this.cachedGroupJidMap.set(groupJid!, groupName!);');
ts = ts.replace(/this\.sock\.ev\.on\('messages\.upsert', async \(events\) => \{/, "this.sock.ev.on('messages.upsert', async (events: any) => {");
ts = ts.replace(/public static setNotificationsEnabled\(enabled\)/, "public static setNotificationsEnabled(enabled: boolean)");

ts = ts.replace(/static async sendTextMessage\(groupTitle, message, _quoteMessageId\)/g, "static async sendTextMessage(groupTitle: string, message: string, _quoteMessageId?: string)");
ts = ts.replace(/static async sendPollToGroup\(groupTitle, pollQuestion, options, settlementId\)/g, "static async sendPollToGroup(groupTitle: string, pollQuestion: string, options: any, settlementId?: string)");

fs.writeFileSync('src/services/WhatsAppService.ts', ts);

let tw = fs.readFileSync('src/controllers/TelegramWebhookController.ts', 'utf8');
tw = tw.replace(/WhatsAppService\.sendGroupMessage\(waGroupName, waMsg\)/g, "WhatsAppService.sendTextMessage(waGroupName, waMsg, undefined)");
fs.writeFileSync('src/controllers/TelegramWebhookController.ts', tw);

console.log('Fixed TS 3!');
