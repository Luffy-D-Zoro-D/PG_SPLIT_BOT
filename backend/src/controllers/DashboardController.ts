import { Request, Response } from 'express';
import mongoose from 'mongoose';
import Expense from '../models/Expense';
import Group from '../models/Group';
import User from '../models/User';
import Settlement from '../models/Settlement';
import { LedgerService } from '../services/LedgerService';

export class DashboardController {
  
  private static getDateFilter(range?: string) {
    if (range === 'week') {
      const now = new Date();
      const startOfWeek = new Date(now.setDate(now.getDate() - now.getDay()));
      startOfWeek.setHours(0, 0, 0, 0);
      return { createdAt: { $gte: startOfWeek } };
    } else if (range === 'month') {
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      return { createdAt: { $gte: startOfMonth } };
    }
    return {};
  }

  static async getStats(req: Request, res: Response) {
    try {
      const groupIdStr = req.query.groupId as string;
      const range = req.query.range as string;
      if (!groupIdStr) return res.status(400).json({ error: 'groupId is required' });
      const groupId = parseInt(groupIdStr, 10);
      const dateFilter = DashboardController.getDateFilter(range);

      const expensesQuery = { telegramChatId: groupId, status: 'CONFIRMED', ...dateFilter };
      const expensesCount = await Expense.countDocuments(expensesQuery as any);
      const groupsCount = await Group.countDocuments();
      const usersCount = await User.countDocuments();
      
      const allExpenses = await Expense.find(expensesQuery as any);
      const totalAmountRecorded = allExpenses.reduce((acc, curr) => acc + parseFloat(curr.totalAmount), 0);
      
      res.json({
        totalExpenses: expensesCount,
        totalGroups: groupsCount,
        totalUsers: usersCount,
        totalAmountRecorded: totalAmountRecorded.toFixed(2)
      });
    } catch (e) {
      res.status(500).json({ error: 'Failed to fetch stats' });
    }
  }

  static async getExpenses(req: Request, res: Response) {
    try {
      const groupIdStr = req.query.groupId as string;
      const range = req.query.range as string;
      if (!groupIdStr) return res.status(400).json({ error: 'groupId is required' });
      const groupId = parseInt(groupIdStr, 10);
      const dateFilter = DashboardController.getDateFilter(range);

      // Clean up any explicitly cancelled or deleted expenses from MongoDB Atlas
      // Do NOT delete PENDING_CONFIRMATION or they will vanish from Telegram before the user clicks Confirm!
      await Expense.deleteMany({ status: { $in: ['CANCELLED', 'DELETED'] } } as any);

      const expenses = await Expense.find({ telegramChatId: groupId, status: 'CONFIRMED', ...dateFilter } as any).sort({ createdAt: -1 }).limit(50).lean();
      const settlements = await Settlement.find({ telegramChatId: groupId, status: { $in: ['CONFIRMED', 'PENDING_APPROVAL'] }, ...dateFilter } as any).sort({ createdAt: -1 }).limit(50).lean();
      
      const userIds = new Set<number>();
      expenses.forEach(e => {
        userIds.add(e.paidByTelegramUserId);
        e.sharedParticipants.forEach(p => userIds.add(p.telegramUserId));
        e.personalExpenses.forEach(p => userIds.add(p.telegramUserId));
      });
      settlements.forEach(s => {
        userIds.add(s.paidByTelegramUserId);
        userIds.add(s.paidToTelegramUserId);
      });
      
      const users = await User.find({ telegramUserId: { $in: Array.from(userIds) } }).lean();
      const userMap = new Map();
      users.forEach(u => userMap.set(u.telegramUserId, u.firstName || u.username || 'Unknown'));
      
      const formattedExpenses = expenses.map(e => ({
        ...e,
        type: 'EXPENSE',
        paidByName: userMap.get(e.paidByTelegramUserId) || e.paidByTelegramUserId,
        sharedParticipants: e.sharedParticipants.map(p => ({ ...p, name: userMap.get(p.telegramUserId) || 'Unknown' })),
        personalExpenses: e.personalExpenses.map(p => ({ ...p, name: userMap.get(p.telegramUserId) || 'Unknown' }))
      }));

      const formattedSettlements = settlements.map(s => ({
        ...s,
        type: 'SETTLEMENT',
        paidByName: userMap.get(s.paidByTelegramUserId) || s.paidByTelegramUserId,
        paidToName: userMap.get(s.paidToTelegramUserId) || s.paidToTelegramUserId,
        description: `Settlement`,
        totalAmount: s.amount
      }));
      
      const unifiedLedger = [...formattedExpenses, ...formattedSettlements]
        .sort((a, b) => new Date(b.createdAt as Date).getTime() - new Date(a.createdAt as Date).getTime())
        .slice(0, 50);

      res.json(unifiedLedger);
    } catch (e) {
      res.status(500).json({ error: 'Failed to fetch ledger activity' });
    }
  }

  static async getBalances(req: Request, res: Response) {
    try {
      const groupIdStr = req.query.groupId as string;
      const range = req.query.range as string;
      if (!groupIdStr) return res.status(400).json({ error: 'groupId is required' });
      const groupId = parseInt(groupIdStr, 10);
      const dateFilter = DashboardController.getDateFilter(range);

      const expenses = await Expense.find({ telegramChatId: groupId, status: 'CONFIRMED', ...dateFilter } as any);
      const settlements = await Settlement.find({ telegramChatId: groupId, ...dateFilter } as any);
      
      const { net: netBalances, gross: grossBalances } = LedgerService.calculateBalances(expenses, settlements);
      
      const allUserIds = new Set<number>();
      for (const debtorIdStr in netBalances) {
        allUserIds.add(parseInt(debtorIdStr));
        for (const creditorIdStr in netBalances[debtorIdStr]) {
          allUserIds.add(parseInt(creditorIdStr));
        }
      }
      for (const debtorIdStr in grossBalances) {
        allUserIds.add(parseInt(debtorIdStr));
        for (const creditorIdStr in grossBalances[debtorIdStr]) {
          allUserIds.add(parseInt(creditorIdStr));
        }
      }
      
      const users = await User.find({ telegramUserId: { $in: Array.from(allUserIds) } }).lean();
      const userMap = new Map();
      users.forEach(u => userMap.set(u.telegramUserId, {
        name: u.firstName || u.username || 'Unknown'
      }));
      
      const formattedBalances: any[] = [];
      for (const debtorIdStr in netBalances) {
        const debtorId = parseInt(debtorIdStr);
        for (const creditorIdStr in netBalances[debtorIdStr]) {
          const creditorId = parseInt(creditorIdStr);
          const netAmount = netBalances[debtorIdStr][creditorIdStr];
          const grossDebtorToCreditor = grossBalances[debtorIdStr]?.[creditorIdStr] || '0.00';
          const grossCreditorToDebtor = grossBalances[creditorIdStr]?.[debtorIdStr] || '0.00';

          formattedBalances.push({
            id: `${debtorId}-${creditorId}`,
            debtorName: userMap.get(debtorId)?.name || 'Unknown',
            creditorName: userMap.get(creditorId)?.name || 'Unknown',
            amount: netAmount,
            grossDebtorToCreditor,
            grossCreditorToDebtor
          });
        }
      }
      
      res.json(formattedBalances);
    } catch (e) {
      res.status(500).json({ error: 'Failed to fetch balances' });
    }
  }

  static async deleteExpense(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const expense = await Expense.findById(id);
      
      if (!expense) return res.status(404).json({ error: 'Expense not found' });

      // Check if any confirmed settlements exist in this group AFTER the expense was created.
      // (As a simplified safety rule, we block deletion if any settlements exist in the group to avoid complex time-travel calculations)
      const settlementCount = await Settlement.countDocuments({ 
        telegramChatId: expense.telegramChatId, 
        status: 'CONFIRMED' 
      });

      if (settlementCount > 0) {
        return res.status(400).json({ 
          error: 'Cannot delete expense because settlements have already been confirmed in this group. Please create an offsetting adjustment expense instead.' 
        });
      }

      // Hard delete expense from MongoDB
      await Expense.deleteOne({ _id: id });
      
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: 'Failed to delete expense' });
    }
  }

  static async settleBalance(req: Request, res: Response) {
    try {
      const { debtorId, creditorId, amount, groupId } = req.body;
      
      if (!groupId) return res.status(400).json({ error: 'groupId is required for settlement' });

      const chatId = parseInt(groupId);

      const debtorName = (await User.findOne({ telegramUserId: parseInt(debtorId) }))?.firstName || 'Debtor';
      const creditorName = (await User.findOne({ telegramUserId: parseInt(creditorId) }))?.firstName || 'Creditor';
      
      const settlement = new Settlement({
        telegramChatId: chatId,
        paidByTelegramUserId: parseInt(debtorId),
        paidToTelegramUserId: parseInt(creditorId),
        amount: amount.toString(),
        status: 'PENDING_APPROVAL',
        approvedBy: []
      });
      
      await settlement.save();

      // Send Telegram approval request
      if (chatId !== 0) {
        const { TelegramService } = require('../services/TelegramService');
        const text = `💸 <b>Settlement Request</b>\n\n${debtorName} wants to settle ₹${amount} with ${creditorName}.\n\n<i>Waiting for both users to approve...</i>`;
        const replyMarkup = {
          inline_keyboard: [
            [
              { text: `✅ Approve (${debtorName})`, callback_data: `approve_settlement_${settlement._id}_${debtorId}` },
              { text: `✅ Approve (${creditorName})`, callback_data: `approve_settlement_${settlement._id}_${creditorId}` }
            ]
          ]
        };
        await TelegramService.sendMessage(chatId, text, replyMarkup);
      }

      res.json({ success: true, settlement });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Failed to settle balance' });
    }
  }

  static async updateExpense(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { imageUrl, createdAt, description, totalAmount } = req.body;

      console.log(`\n================ UPDATE EXPENSE REQUEST ================`);
      console.log(`[Target Expense ID]: ${id}`);
      console.log(`[Raw Payload Received]:`, { 
        hasImageUrl: !!imageUrl, 
        imageLength: imageUrl ? imageUrl.length : 0, 
        createdAt, 
        description, 
        totalAmount 
      });

      const updateFields: any = {};
      if (imageUrl !== undefined && imageUrl !== null) updateFields.imageUrl = imageUrl;
      if (createdAt !== undefined && createdAt !== null) {
        const parsedDate = new Date(createdAt);
        if (!isNaN(parsedDate.getTime())) {
          updateFields.createdAt = parsedDate;
          console.log(`[Parsed New createdAt]: ${parsedDate.toISOString()} (${parsedDate.toString()})`);
        } else {
          console.warn(`⚠️ [Warning]: Invalid createdAt date received: "${createdAt}"`);
        }
      }
      if (description !== undefined && description !== null) updateFields.description = description;
      if (totalAmount !== undefined && totalAmount !== null) updateFields.totalAmount = totalAmount.toString();

      if (Object.keys(updateFields).length === 0) {
        console.warn(`⚠️ [Warning]: No valid fields provided for update`);
        return res.status(400).json({ error: 'No valid fields provided for update' });
      }

      // Use raw MongoDB collection update to bypass Mongoose's timestamps middleware stripping createdAt
      const objectId = new mongoose.Types.ObjectId(id as string);
      await Expense.collection.updateOne({ _id: objectId as any }, { $set: updateFields });

      const expense = await Expense.findById(id);

      if (!expense) {
        console.error(`❌ [Error]: Expense ${id} not found in MongoDB`);
        return res.status(404).json({ error: 'Expense not found' });
      }

      console.log(`✅ [SUCCESS]: Expense ${id} updated in MongoDB!`);
      console.log(`   New createdAt in DB: ${expense.createdAt}`);
      console.log(`   Has imageUrl in DB: ${!!expense.imageUrl}`);
      console.log(`========================================================\n`);

      res.json({ success: true, expense });
    } catch (e: any) {
      console.error(`❌ [ERROR in updateExpense]:`, e.message || e);
      res.status(500).json({ error: 'Failed to update expense' });
    }
  }
}
