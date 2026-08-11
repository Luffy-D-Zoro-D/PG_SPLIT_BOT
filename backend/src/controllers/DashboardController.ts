import { Request, Response } from 'express';
import Expense from '../models/Expense';
import Group from '../models/Group';
import User from '../models/User';
import Settlement from '../models/Settlement';
import { LedgerService } from '../services/LedgerService';

export class DashboardController {
  
  static async getStats(req: Request, res: Response) {
    try {
      const groupIdStr = req.query.groupId as string;
      if (!groupIdStr) return res.status(400).json({ error: 'groupId is required' });
      const groupId = parseInt(groupIdStr, 10);

      const expensesCount = await Expense.countDocuments({ telegramChatId: groupId } as any);
      const groupsCount = await Group.countDocuments(); // This might remain global or just 1
      const usersCount = await User.countDocuments();
      
      const allExpenses = await Expense.find({ telegramChatId: groupId, status: 'CONFIRMED' } as any);
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
      if (!groupIdStr) return res.status(400).json({ error: 'groupId is required' });
      const groupId = parseInt(groupIdStr, 10);

      const expenses = await Expense.find({ telegramChatId: groupId } as any).sort({ createdAt: -1 }).limit(50).lean();
      const settlements = await Settlement.find({ telegramChatId: groupId } as any).sort({ createdAt: -1 }).limit(50).lean();
      
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
      if (!groupIdStr) return res.status(400).json({ error: 'groupId is required' });
      const groupId = parseInt(groupIdStr, 10);

      const expenses = await Expense.find({ telegramChatId: groupId, status: 'CONFIRMED' } as any);
      const settlements = await Settlement.find({ telegramChatId: groupId } as any);
      
      const balances = LedgerService.calculateBalances(expenses, settlements);
      
      const allUserIds = new Set<number>();
      for (const debtorIdStr in balances) {
        allUserIds.add(parseInt(debtorIdStr));
        for (const creditorIdStr in balances[debtorIdStr]) {
          allUserIds.add(parseInt(creditorIdStr));
        }
      }
      
      const users = await User.find({ telegramUserId: { $in: Array.from(allUserIds) } }).lean();
      const userMap = new Map();
      users.forEach(u => userMap.set(u.telegramUserId, {
        name: u.firstName || u.username || 'Unknown'
      }));
      
      const formattedBalances: any[] = [];
      for (const debtorIdStr in balances) {
        const debtorId = parseInt(debtorIdStr);
        for (const creditorIdStr in balances[debtorIdStr]) {
          const creditorId = parseInt(creditorIdStr);
          formattedBalances.push({
            id: `${debtorId}-${creditorId}`,
            debtorName: userMap.get(debtorId)?.name || 'Unknown',
            creditorName: userMap.get(creditorId)?.name || 'Unknown',
            amount: balances[debtorIdStr][creditorIdStr]
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

      // Safe cancellation instead of deletion
      expense.status = 'CANCELLED' as any;
      await expense.save();
      
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
}
