import { Request, Response } from 'express';
import Expense from '../models/Expense';
import Group from '../models/Group';
import User from '../models/User';
import Settlement from '../models/Settlement';
import { LedgerService } from '../services/LedgerService';

export class DashboardController {
  
  static async getStats(req: Request, res: Response) {
    try {
      const expensesCount = await Expense.countDocuments();
      const groupsCount = await Group.countDocuments();
      const usersCount = await User.countDocuments();
      
      const allExpenses = await Expense.find({ status: 'CONFIRMED' } as any);
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
      const expenses = await Expense.find().sort({ createdAt: -1 }).limit(50).lean();
      
      const userIds = new Set<number>();
      expenses.forEach(e => {
        userIds.add(e.paidByTelegramUserId);
        e.sharedParticipants.forEach(p => userIds.add(p.telegramUserId));
        e.personalExpenses.forEach(p => userIds.add(p.telegramUserId));
      });
      
      const users = await User.find({ telegramUserId: { $in: Array.from(userIds) } }).lean();
      const userMap = new Map();
      users.forEach(u => userMap.set(u.telegramUserId, u.firstName || u.username || 'Unknown'));
      
      const formattedExpenses = expenses.map(e => ({
        ...e,
        paidByName: userMap.get(e.paidByTelegramUserId) || e.paidByTelegramUserId,
        sharedParticipants: e.sharedParticipants.map(p => ({ ...p, name: userMap.get(p.telegramUserId) || 'Unknown' })),
        personalExpenses: e.personalExpenses.map(p => ({ ...p, name: userMap.get(p.telegramUserId) || 'Unknown' }))
      }));
      
      res.json(formattedExpenses);
    } catch (e) {
      res.status(500).json({ error: 'Failed to fetch expenses' });
    }
  }

  static async getBalances(req: Request, res: Response) {
    try {
      const expenses = await Expense.find({ status: 'CONFIRMED' } as any);
      const settlements = await Settlement.find();
      
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
      await Expense.findByIdAndDelete(id);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: 'Failed to delete expense' });
    }
  }

  static async settleBalance(req: Request, res: Response) {
    try {
      const { debtorId, creditorId, amount } = req.body;
      
      const settlement = new Settlement({
        telegramChatId: 0, // Global settlement from dashboard
        paidByTelegramUserId: parseInt(debtorId), // Debtor pays
        paidToTelegramUserId: parseInt(creditorId), // Creditor receives
        amount: amount.toString()
      });
      
      await settlement.save();
      res.json({ success: true, settlement });
    } catch (e) {
      res.status(500).json({ error: 'Failed to settle balance' });
    }
  }
}
