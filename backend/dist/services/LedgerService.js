"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LedgerService = void 0;
const decimal_js_1 = __importDefault(require("decimal.js"));
const Expense_1 = require("../models/Expense");
class LedgerService {
    /**
     * Calculates net balances for all members in a group.
     * Format: balances[userA][userB] means userA owes userB that amount.
     */
    static calculateBalances(expenses, settlements) {
        const balances = {};
        const addDebt = (debtor, creditor, amount) => {
            if (debtor === creditor)
                return; // You don't owe yourself
            if (!balances[debtor])
                balances[debtor] = {};
            if (!balances[creditor])
                balances[creditor] = {};
            if (!balances[debtor][creditor])
                balances[debtor][creditor] = new decimal_js_1.default(0);
            if (!balances[creditor][debtor])
                balances[creditor][debtor] = new decimal_js_1.default(0);
            // Add to what debtor owes creditor
            balances[debtor][creditor] = balances[debtor][creditor].plus(amount);
            // Effectively reduces what creditor owes debtor
            balances[creditor][debtor] = balances[creditor][debtor].minus(amount);
        };
        // 1. Process Expenses
        for (const expense of expenses) {
            if (expense.status !== Expense_1.ExpenseStatus.CONFIRMED)
                continue;
            const creditorId = expense.paidByTelegramUserId;
            // Shared
            for (const participant of expense.sharedParticipants) {
                const debtorId = participant.telegramUserId;
                const shareAmount = new decimal_js_1.default(participant.share);
                addDebt(debtorId, creditorId, shareAmount);
            }
            // Personal
            for (const participant of expense.personalExpenses) {
                const debtorId = participant.telegramUserId;
                const amount = new decimal_js_1.default(participant.share);
                addDebt(debtorId, creditorId, amount);
            }
        }
        // 2. Process Settlements (Payments)
        for (const settlement of settlements) {
            if (settlement.status !== 'CONFIRMED')
                continue;
            // Settlement: paidBy A, paidTo B. Meaning A paid B.
            // This is equivalent to B owing A the amount, which nets against A owing B.
            const debtorId = settlement.paidToTelegramUserId;
            const creditorId = settlement.paidByTelegramUserId;
            const amount = new decimal_js_1.default(settlement.amount);
            addDebt(debtorId, creditorId, amount);
        }
        // 3. Simplify & Format Output
        const result = {};
        for (const debtorStr in balances) {
            const debtor = parseInt(debtorStr, 10);
            for (const creditorStr in balances[debtor]) {
                const creditor = parseInt(creditorStr, 10);
                const amount = balances[debtor]?.[creditor];
                if (amount && amount.isPositive() && !amount.isZero()) { // Only record positive debts
                    if (!result[debtor])
                        result[debtor] = {};
                    result[debtor][creditor] = amount.toFixed(2);
                }
            }
        }
        return result;
    }
}
exports.LedgerService = LedgerService;
