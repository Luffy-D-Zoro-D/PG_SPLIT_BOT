import { Request, Response } from 'express';
import User from '../models/User';
import Group from '../models/Group';
import { ExpenseService } from '../services/ExpenseService';
import { TelegramService } from '../services/TelegramService';
import Expense from '../models/Expense';
import Settlement from '../models/Settlement';
import { LedgerService } from '../services/LedgerService';
import { AIService } from '../services/AIService';
import fs from 'fs';
import path from 'path';


const chatHistories = new Map<number, { role: string, content: string }[]>();

export class TelegramWebhookController {
  static async handleUpdate(req: Request, res: Response) {
    try {
      const update = req.body;

      // If there is a callback query (button press)
      if (update.callback_query) {
        await TelegramWebhookController.handleCallbackQuery(update.callback_query);
        return res.sendStatus(200);
      }

      // If there is a message
      if (update.message) {
        await TelegramWebhookController.handleMessage(update.message);
      }

      res.sendStatus(200);
    } catch (e) {
      console.error('Error handling webhook update:', e);
      res.sendStatus(200); // Always 200 to Telegram so it doesn't retry infinitely
    }
  }

  private static async handleMessage(message: any) {
    const chatId = message.chat.id;
    const from = message.from;
    let text = message.text || message.caption;
    let imageUrl: string | undefined = undefined;

    if (!from) return;

    // Handle photo uploads
    if (message.photo && message.photo.length > 0) {
      const highestResPhoto = message.photo[message.photo.length - 1];
      const telegramFilePath = await TelegramService.getFile(highestResPhoto.file_id);
      
      if (telegramFilePath) {
        const destName = `img_${Date.now()}.jpg`;
        const destPath = path.join(process.cwd(), 'uploads', destName);
        const localPath = await TelegramService.downloadFile(telegramFilePath, destPath);
        
        if (localPath) {
          imageUrl = `/uploads/${destName}`;
        }
      }
      
      if (!text) {
        text = "I attached a receipt. Please record this expense.";
      }
    }

    if (!text && (message.voice || message.audio)) {
      const fileId = message.voice ? message.voice.file_id : message.audio.file_id;
      const fileExt = message.voice ? '.ogg' : '.mp3';
      const telegramFilePath = await TelegramService.getFile(fileId);

      if (telegramFilePath) {
        await TelegramService.sendMessage(chatId, '🎙️ <i>Listening...</i>');
        const destName = `audio_${Date.now()}${fileExt}`;
        const destPath = path.join(process.cwd(), 'uploads', destName);
        const localPath = await TelegramService.downloadFile(telegramFilePath, destPath);

        if (localPath) {
          try {
            text = await AIService.transcribeAudio(localPath);
            fs.unlinkSync(localPath); // clean up
          } catch (e) {
            await TelegramService.sendMessage(chatId, '❌ Failed to understand the audio.');
            return;
          }
        }
      }
    }

    if (!text) return;

    // 1. Ensure user exists
    await User.findOneAndUpdate(
      { telegramUserId: from.id },
      {
        username: from.username,
        firstName: from.first_name,
        lastName: from.last_name
      },
      { upsert: true, returnDocument: 'after' }
    );

    // 2. Ensure group exists and user is a member
    const title = message.chat.type === 'private' ? 'Private' : message.chat.title;

    await Group.findOneAndUpdate(
      { telegramChatId: chatId },
      {
        $set: { title },
        $addToSet: { members: from.id }
      },
      { upsert: true, returnDocument: 'after' }
    );

    // 3. Handle commands
    if (text.startsWith('/start')) {
      await TelegramService.sendMessage(chatId, `Welcome to PG SPLITTER 👋\n\nYour account is ready.\nYou can simply tell me about an expense in English, Hindi, Marathi, or mixed language.`);
      return;
    }

    if (text.startsWith('/balance')) {
      await TelegramWebhookController.showBalances(chatId);
      return;
    }

    // Update chat history with user's message
    if (!chatHistories.has(chatId)) chatHistories.set(chatId, []);
    const history = chatHistories.get(chatId)!;
    history.push({ role: 'user', content: text });
    if (history.length > 6) history.shift(); // Keep last 6 messages

    // 4. Process natural language
    console.log(`\n--- NEW MESSAGE ---`);
    console.log(`[Telegram received] User: ${from.first_name}, Text/Transcribed: "${text}"`);

    const result = await ExpenseService.processTextMessage(chatId, from.id, text, history.slice(0, -1), imageUrl); // Pass history excluding the current message

    console.log(`[AI output processed] Result:`, JSON.stringify(result, null, 2));

    if ('error' in result) {
      if (result.clarificationQuestion) {
        history.push({ role: 'assistant', content: result.clarificationQuestion });
        if (history.length > 6) history.shift();
        await TelegramService.sendMessage(chatId, result.clarificationQuestion);
      } else if (result.chatResponse) {
        history.push({ role: 'assistant', content: result.chatResponse });
        if (history.length > 6) history.shift();
        await TelegramService.sendMessage(chatId, result.chatResponse);
      } else if (result.error !== 'Intent not recognized as an expense.') {
        await TelegramService.sendMessage(chatId, `❌ ${result.error}`);
      }
      return;
    }

    // Successfully parsed
    const expense = result;

    const allUserIds = new Set<number>();
    allUserIds.add(expense.paidByTelegramUserId);
    expense.sharedParticipants.forEach(p => allUserIds.add(p.telegramUserId));
    expense.personalExpenses.forEach(p => allUserIds.add(p.telegramUserId));

    const users = await User.find({ telegramUserId: { $in: Array.from(allUserIds) } });
    const userMap = new Map<number, string>();
    users.forEach(u => userMap.set(u.telegramUserId, u.firstName || u.username || u.telegramUserId.toString()));

    const paidByName = userMap.get(expense.paidByTelegramUserId) || 'Unknown';

    let confirmText = `🧾 <b>Expense Detected</b>\n\n`;
    confirmText += `💰 Total: ₹${expense.totalAmount}\n`;
    confirmText += `👤 Paid by: ${paidByName}\n\n`;

    if (parseFloat(expense.sharedAmount) > 0) {
      confirmText += `<b>Shared expense: ₹${expense.sharedAmount}</b>\n\n`;
      expense.sharedParticipants.forEach(p => {
        const name = userMap.get(p.telegramUserId) || 'Unknown';
        confirmText += `* ${name}: ₹${p.share}\n`;
      });
      confirmText += `\n`;
    }

    if (expense.personalExpenses && expense.personalExpenses.length > 0) {
      confirmText += `<b>Personal expense</b>\n\n`;
      expense.personalExpenses.forEach(p => {
        const name = userMap.get(p.telegramUserId) || 'Unknown';
        confirmText += `* ${name}: ₹${p.share}\n`;
      });
      confirmText += `\n`;
    }

    let owesText = '';
    allUserIds.forEach(userId => {
      if (userId === expense.paidByTelegramUserId) return;
      let totalShare = 0;

      const shared = expense.sharedParticipants.find(p => p.telegramUserId === userId);
      if (shared) totalShare += parseFloat(shared.share);

      const personal = expense.personalExpenses.find(p => p.telegramUserId === userId);
      if (personal) totalShare += parseFloat(personal.share);

      if (totalShare > 0) {
        const name = userMap.get(userId) || 'Unknown';
        owesText += `➡️ <b>${name} owes ${paidByName} ₹${totalShare.toFixed(2).replace(/\\.00$/, '')}</b>\n`;
      }
    });

    if (owesText) {
      confirmText += owesText + `\n`;
    }

    confirmText += `Confirm this expense?`;

    const replyMarkup = {
      inline_keyboard: [
        [
          { text: '✅ Confirm', callback_data: `confirm_${expense._id}` },
          { text: '❌ Cancel', callback_data: `cancel_${expense._id}` }
        ]
      ]
    };

    await TelegramService.sendMessage(chatId, confirmText, replyMarkup);
  }

  private static async handleCallbackQuery(callbackQuery: any) {
    const data = callbackQuery.data;
    const message = callbackQuery.message;
    const chatId = message.chat.id;

    if (data.startsWith('confirm_')) {
      const expenseId = data.split('_')[1];
      const expense = await ExpenseService.confirmExpense(expenseId);
      if (expense) {
        await TelegramService.sendMessage(chatId, `✅ Expense of ₹${expense.totalAmount} confirmed.`);
      }
    } else if (data.startsWith('cancel_')) {
      const expenseId = data.split('_')[1];
      await ExpenseService.cancelExpense(expenseId);
      await TelegramService.sendMessage(chatId, `❌ Expense cancelled.`);
    }
  }

  private static async showBalances(chatId: number) {
    const expenses = await Expense.find({ telegramChatId: chatId, status: 'CONFIRMED' } as any);
    const settlements = await Settlement.find({ telegramChatId: chatId } as any);

    const balances = LedgerService.calculateBalances(expenses, settlements);

    let text = '<b>💰 Current Balances</b>\n\n';

    let hasBalances = false;
    for (const debtorIdStr in balances) {
      const debtorId = parseInt(debtorIdStr, 10);
      const debtor = await User.findOne({ telegramUserId: debtorId });
      const debtorName = debtor?.firstName || debtor?.username || 'Unknown';

      for (const creditorIdStr in balances[debtorId]) {
        const creditorId = parseInt(creditorIdStr, 10);
        const creditor = await User.findOne({ telegramUserId: creditorId });
        const creditorName = creditor?.firstName || creditor?.username || 'Unknown';

        const amount = balances[debtorId][creditorId];
        text += `${debtorName} owes ${creditorName} ₹${amount}\n`;
        hasBalances = true;
      }
    }

    if (!hasBalances) {
      text += 'All settled up!';
    }

    await TelegramService.sendMessage(chatId, text);
  }
}
