"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExpenseService = void 0;
const decimal_js_1 = __importDefault(require("decimal.js"));
const Expense_1 = __importStar(require("../models/Expense"));
const Group_1 = __importDefault(require("../models/Group"));
const User_1 = __importDefault(require("../models/User"));
const AIService_1 = require("./AIService");
class ExpenseService {
    /**
     * Process a natural language text message into an Expense.
     */
    static async processTextMessage(chatId, fromUserId, text, chatHistory = [], imageUrl) {
        // Get group members
        const group = await Group_1.default.findOne({ telegramChatId: chatId });
        if (!group) {
            return { error: 'Group not found. Please type /start first.' };
        }
        const memberMap = new Map();
        const memberNames = [];
        const users = await User_1.default.find({ telegramUserId: { $in: group.members } });
        for (const user of users) {
            const name = user.firstName || user.username || user.telegramUserId.toString();
            memberNames.push(name);
            memberMap.set(name.toLowerCase(), user.telegramUserId);
        }
        if (memberNames.length === 0) {
            return { error: 'No members in this group.' };
        }
        // Get sender name so AI knows who "I" refers to
        const senderUser = users.find(u => u.telegramUserId === fromUserId);
        const senderName = senderUser ? (senderUser.firstName || senderUser.username || undefined) : undefined;
        // Call AIService
        const extraction = await AIService_1.AIService.extractExpense(text, memberNames, chatHistory, senderName);
        if (extraction.intent === 'CHAT') {
            return { error: 'CHAT', chatResponse: extraction.chatResponse || 'Hello!' };
        }
        if (extraction.intent !== 'CREATE_EXPENSE') {
            return { error: 'Intent not recognized as an expense.' };
        }
        if (extraction.needsClarification) {
            return {
                error: 'Ambiguous expense details.',
                clarificationQuestion: extraction.clarificationQuestion || 'Please provide more details.'
            };
        }
        if (!extraction.totalAmount || !extraction.paidBy) {
            return { error: 'Missing total amount or payer information.' };
        }
        // Validate math
        const totalAmount = new decimal_js_1.default(extraction.totalAmount);
        let sharedAmount = new decimal_js_1.default(extraction.sharedExpense?.amount || 0);
        let sumPersonal = new decimal_js_1.default(0);
        const personalShares = [];
        if (extraction.personalExpenses) {
            for (const p of extraction.personalExpenses) {
                const amt = p.amount || 0;
                sumPersonal = sumPersonal.plus(amt);
                // Find matching user id
                const matchedId = this.findMatchingUser(p.user, memberMap);
                if (!matchedId)
                    return { error: `Could not identify user: ${p.user}` };
                personalShares.push({ telegramUserId: matchedId, share: amt.toString() });
            }
        }
        // Auto-reconcile math if AI accidentally placed full amount in both shared AND personal
        if (!totalAmount.equals(sharedAmount.plus(sumPersonal))) {
            if (sharedAmount.equals(totalAmount) && sumPersonal.equals(totalAmount)) {
                // AI duplicated amount: e.g. "I paid 80 for Anuj" is 100% personal for Anuj
                console.log(`[Auto-Reconcile]: AI duplicated total amount in both shared and personal. Converting to 100% personal expense.`);
                sharedAmount = new decimal_js_1.default(0);
                if (extraction.sharedExpense) {
                    extraction.sharedExpense.amount = 0;
                    extraction.sharedExpense.participants = [];
                }
            }
            else if (sharedAmount.equals(0) && sumPersonal.equals(0)) {
                // Default to 100% shared
                sharedAmount = totalAmount;
                if (extraction.sharedExpense)
                    extraction.sharedExpense.amount = totalAmount.toNumber();
            }
        }
        if (!totalAmount.equals(sharedAmount.plus(sumPersonal))) {
            return { error: `The amounts don't add up.\nTotal: ${totalAmount}\nShared + Personal: ${sharedAmount.plus(sumPersonal)}\n\nPlease clarify.` };
        }
        // Calculate individual shared shares
        const sharedParticipants = [];
        if (extraction.sharedExpense && extraction.sharedExpense.participants) {
            for (const p of extraction.sharedExpense.participants) {
                const matchedId = this.findMatchingUser(p.user, memberMap);
                if (!matchedId)
                    return { error: `Could not identify user: ${p.user}` };
                sharedParticipants.push({ telegramUserId: matchedId, share: (p.share || 0).toString() });
            }
        }
        const paidById = this.findMatchingUser(extraction.paidBy, memberMap);
        if (!paidById)
            return { error: `Could not identify who paid: ${extraction.paidBy}` };
        // Create pending expense
        const expense = new Expense_1.default({
            telegramChatId: chatId,
            totalAmount: totalAmount.toString(),
            paidByTelegramUserId: paidById,
            addedByTelegramUserId: fromUserId,
            description: extraction.description || 'Expense',
            status: Expense_1.ExpenseStatus.PENDING_CONFIRMATION,
            sharedAmount: sharedAmount.toString(),
            sharedParticipants,
            personalExpenses: personalShares,
            itemsBreakdown: extraction.itemsBreakdown || [],
            imageUrl: imageUrl
        });
        await expense.save();
        return expense;
    }
    static async confirmExpense(expenseId) {
        const expense = await Expense_1.default.findOneAndUpdate({ _id: expenseId, status: Expense_1.ExpenseStatus.PENDING_CONFIRMATION }, { $set: { status: Expense_1.ExpenseStatus.CONFIRMED } }, { returnDocument: 'after' });
        return expense;
    }
    static async cancelExpense(expenseId) {
        const expense = await Expense_1.default.findOneAndDelete({ _id: expenseId });
        return expense;
    }
    static formatExpenseConfirmation(expense, userMap, platform) {
        const boldStart = platform === 'telegram' ? '<b>' : '*';
        const boldEnd = platform === 'telegram' ? '</b>' : '*';
        const paidByName = userMap.get(expense.paidByTelegramUserId) || 'Unknown';
        let confirmText = `🧾 ${boldStart}Expense Detected${boldEnd}\n\n`;
        if (expense.description) {
            confirmText += `📝 ${boldStart}Description:${boldEnd} ${expense.description}\n\n`;
        }
        confirmText += `💰 Total: ₹${expense.totalAmount}\n`;
        confirmText += `👤 Paid by: ${paidByName}\n\n`;
        if (expense.itemsBreakdown && expense.itemsBreakdown.length > 0) {
            confirmText += `🛒 ${boldStart}Itemized Breakdown:${boldEnd}\n`;
            expense.itemsBreakdown.forEach(item => {
                confirmText += `  • ${item}\n`;
            });
            confirmText += `\n`;
        }
        if (parseFloat(expense.sharedAmount) > 0) {
            confirmText += `${boldStart}Shared expense: ₹${expense.sharedAmount}${boldEnd}\n\n`;
            expense.sharedParticipants.forEach(p => {
                const name = userMap.get(p.telegramUserId) || 'Unknown';
                confirmText += `* ${name}: ₹${p.share}\n`;
            });
            confirmText += `\n`;
        }
        if (expense.personalExpenses && expense.personalExpenses.length > 0) {
            confirmText += `${boldStart}Personal expense${boldEnd}\n\n`;
            expense.personalExpenses.forEach(p => {
                const name = userMap.get(p.telegramUserId) || 'Unknown';
                confirmText += `* ${name}: ₹${p.share}\n`;
            });
            confirmText += `\n`;
        }
        let owesText = '';
        const allUserIds = new Set();
        allUserIds.add(expense.paidByTelegramUserId);
        expense.sharedParticipants.forEach(p => allUserIds.add(p.telegramUserId));
        expense.personalExpenses.forEach(p => allUserIds.add(p.telegramUserId));
        allUserIds.forEach(userId => {
            if (userId === expense.paidByTelegramUserId)
                return;
            let totalShare = 0;
            const shared = expense.sharedParticipants.find(p => p.telegramUserId === userId);
            if (shared)
                totalShare += parseFloat(shared.share);
            const personal = expense.personalExpenses.find(p => p.telegramUserId === userId);
            if (personal)
                totalShare += parseFloat(personal.share);
            if (totalShare > 0) {
                const name = userMap.get(userId) || 'Unknown';
                owesText += `➡️ ${boldStart}${name} owes ${paidByName} ₹${totalShare.toFixed(2).replace(/\.00$/, '')}${boldEnd}\n`;
            }
        });
        if (owesText) {
            confirmText += owesText + `\n`;
        }
        if (platform === 'whatsapp') {
            confirmText += `*Reply* to this message with "yes" to confirm or "no" to cancel.`;
        }
        else {
            confirmText += `Confirm this expense?`;
        }
        return confirmText;
    }
    static findMatchingUser(name, memberMap) {
        const lowerName = name.trim().toLowerCase();
        if (memberMap.has(lowerName)) {
            return memberMap.get(lowerName);
        }
        // Fuzzy search
        const matches = [];
        for (const [key, value] of memberMap.entries()) {
            if (key.includes(lowerName) || lowerName.includes(key)) {
                if (!matches.includes(value)) {
                    matches.push(value);
                }
            }
        }
        if (matches.length === 1) {
            return matches[0];
        }
        else if (matches.length > 1) {
            // Ambiguous match, we don't want to silently guess wrong
            return null;
        }
        return null;
    }
}
exports.ExpenseService = ExpenseService;
