const fs = require('fs');
let ts = fs.readFileSync('src/services/WhatsAppService.ts', 'utf8');

// Fix missing imports
ts = ts.replace(/qrcode_terminal_1\.default/g, 'qrcode');
ts = ts.replace(/fs_1\.default/g, 'fs');
ts = ts.replace(/Setting_1\.getSetting/g, 'getSetting');
ts = ts.replace(/Setting_1\.updateSetting/g, 'updateSetting');

// Fix implicit any
ts = ts.replace(/on\('connection\.update', \(update\) =>/g, "on('connection.update', (update: any) =>");
ts = ts.replace(/ev\.on\('messages\.upsert', async \(m\) =>/g, "ev.on('messages.upsert', async (m: any) =>");
ts = ts.replace(/sharedParticipants\.forEach\(\(p\) =>/g, "sharedParticipants.forEach((p: any) =>");
ts = ts.replace(/personalExpenses\.forEach\(\(p\) =>/g, "personalExpenses.forEach((p: any) =>");
ts = ts.replace(/users\.forEach\(\(u\) =>/g, "users.forEach((u: any) =>");
ts = ts.replace(/public static setNotificationsEnabled\(enabled\)/g, "public static setNotificationsEnabled(enabled: boolean)");
ts = ts.replace(/static async sendTextMessage\(groupTitle, message, _quoteMessageId\)/g, "static async sendTextMessage(groupTitle: string, message: string, _quoteMessageId?: string)");
ts = ts.replace(/static async sendPollToGroup\(groupTitle, pollQuestion, options, settlementId\)/g, "static async sendPollToGroup(groupTitle: string, pollQuestion: string, options: any, settlementId?: string)");
ts = ts.replace(/this\.sock\.ev\.on\('messages\.upsert', async \(events\)/g, "this.sock.ev.on('messages.upsert', async (events: any)");

// Fix possibly null objects (this.sock)
ts = ts.replace(/this\.sock\.ws/g, "this.sock!.ws");
ts = ts.replace(/this\.sock\.ev/g, "this.sock!.ev");
ts = ts.replace(/this\.sock\.sendMessage/g, "this.sock!.sendMessage");
ts = ts.replace(/this\.sock\.groupMetadata/g, "this.sock!.groupMetadata");

fs.writeFileSync('src/services/WhatsAppService.ts', ts);
console.log('Fixed TS!');
