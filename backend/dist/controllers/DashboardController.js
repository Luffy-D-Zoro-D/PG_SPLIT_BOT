"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DashboardController = void 0;
const Expense_1 = __importDefault(require("../models/Expense"));
const Group_1 = __importDefault(require("../models/Group"));
const User_1 = __importDefault(require("../models/User"));
const Settlement_1 = __importDefault(require("../models/Settlement"));
const LedgerService_1 = require("../services/LedgerService");
class DashboardController {
    static async getStats(req, res) {
        try {
            const groupIdStr = req.query.groupId;
            if (!groupIdStr)
                return res.status(400).json({ error: 'groupId is required' });
            const groupId = parseInt(groupIdStr, 10);
            const expensesCount = await Expense_1.default.countDocuments({ telegramChatId: groupId });
            const groupsCount = await Group_1.default.countDocuments(); // This might remain global or just 1
            const usersCount = await User_1.default.countDocuments();
            const allExpenses = await Expense_1.default.find({ telegramChatId: groupId, status: 'CONFIRMED' });
            const totalAmountRecorded = allExpenses.reduce((acc, curr) => acc + parseFloat(curr.totalAmount), 0);
            res.json({
                totalExpenses: expensesCount,
                totalGroups: groupsCount,
                totalUsers: usersCount,
                totalAmountRecorded: totalAmountRecorded.toFixed(2)
            });
        }
        catch (e) {
            res.status(500).json({ error: 'Failed to fetch stats' });
        }
    }
    static async getExpenses(req, res) {
        try {
            const groupIdStr = req.query.groupId;
            if (!groupIdStr)
                return res.status(400).json({ error: 'groupId is required' });
            const groupId = parseInt(groupIdStr, 10);
            const expenses = await Expense_1.default.find({ telegramChatId: groupId, status: 'CONFIRMED' }).sort({ createdAt: -1 }).limit(50).lean();
            const settlements = await Settlement_1.default.find({ telegramChatId: groupId, status: 'CONFIRMED' }).sort({ createdAt: -1 }).limit(50).lean();
            const userIds = new Set();
            expenses.forEach(e => {
                userIds.add(e.paidByTelegramUserId);
                e.sharedParticipants.forEach(p => userIds.add(p.telegramUserId));
                e.personalExpenses.forEach(p => userIds.add(p.telegramUserId));
            });
            settlements.forEach(s => {
                userIds.add(s.paidByTelegramUserId);
                userIds.add(s.paidToTelegramUserId);
            });
            const users = await User_1.default.find({ telegramUserId: { $in: Array.from(userIds) } }).lean();
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
                .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                .slice(0, 50);
            res.json(unifiedLedger);
        }
        catch (e) {
            res.status(500).json({ error: 'Failed to fetch ledger activity' });
        }
    }
    static async getBalances(req, res) {
        try {
            const groupIdStr = req.query.groupId;
            if (!groupIdStr)
                return res.status(400).json({ error: 'groupId is required' });
            const groupId = parseInt(groupIdStr, 10);
            const expenses = await Expense_1.default.find({ telegramChatId: groupId, status: 'CONFIRMED' });
            const settlements = await Settlement_1.default.find({ telegramChatId: groupId });
            const { net: netBalances, gross: grossBalances } = LedgerService_1.LedgerService.calculateBalances(expenses, settlements);
            const allUserIds = new Set();
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
            const users = await User_1.default.find({ telegramUserId: { $in: Array.from(allUserIds) } }).lean();
            const userMap = new Map();
            users.forEach(u => userMap.set(u.telegramUserId, {
                name: u.firstName || u.username || 'Unknown'
            }));
            const formattedBalances = [];
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
        }
        catch (e) {
            res.status(500).json({ error: 'Failed to fetch balances' });
        }
    }
    static async deleteExpense(req, res) {
        try {
            const { id } = req.params;
            const expense = await Expense_1.default.findById(id);
            if (!expense)
                return res.status(404).json({ error: 'Expense not found' });
            // Check if any confirmed settlements exist in this group AFTER the expense was created.
            // (As a simplified safety rule, we block deletion if any settlements exist in the group to avoid complex time-travel calculations)
            const settlementCount = await Settlement_1.default.countDocuments({
                telegramChatId: expense.telegramChatId,
                status: 'CONFIRMED'
            });
            if (settlementCount > 0) {
                return res.status(400).json({
                    error: 'Cannot delete expense because settlements have already been confirmed in this group. Please create an offsetting adjustment expense instead.'
                });
            }
            // Safe cancellation instead of deletion
            expense.status = 'CANCELLED';
            await expense.save();
            res.json({ success: true });
        }
        catch (e) {
            res.status(500).json({ error: 'Failed to delete expense' });
        }
    }
    static async settleBalance(req, res) {
        try {
            const { debtorId, creditorId, amount, groupId } = req.body;
            if (!groupId)
                return res.status(400).json({ error: 'groupId is required for settlement' });
            const chatId = parseInt(groupId);
            const debtorName = (await User_1.default.findOne({ telegramUserId: parseInt(debtorId) }))?.firstName || 'Debtor';
            const creditorName = (await User_1.default.findOne({ telegramUserId: parseInt(creditorId) }))?.firstName || 'Creditor';
            const settlement = new Settlement_1.default({
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
        }
        catch (e) {
            console.error(e);
            res.status(500).json({ error: 'Failed to settle balance' });
        }
    }
}
exports.DashboardController = DashboardController;
