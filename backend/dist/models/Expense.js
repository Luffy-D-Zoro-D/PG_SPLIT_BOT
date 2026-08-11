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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExpenseStatus = void 0;
const mongoose_1 = __importStar(require("mongoose"));
var ExpenseStatus;
(function (ExpenseStatus) {
    ExpenseStatus["PENDING_CONFIRMATION"] = "PENDING_CONFIRMATION";
    ExpenseStatus["CONFIRMED"] = "CONFIRMED";
    ExpenseStatus["CANCELLED"] = "CANCELLED";
})(ExpenseStatus || (exports.ExpenseStatus = ExpenseStatus = {}));
const ParticipantShareSchema = new mongoose_1.Schema({
    telegramUserId: { type: Number, required: true },
    share: { type: String, required: true }
}, { _id: false });
const ExpenseSchema = new mongoose_1.Schema({
    telegramChatId: { type: Number, required: true, index: true },
    totalAmount: { type: String, required: true },
    paidByTelegramUserId: { type: Number, required: true },
    description: { type: String, required: true },
    status: { type: String, enum: Object.values(ExpenseStatus), default: ExpenseStatus.PENDING_CONFIRMATION },
    sharedAmount: { type: String, required: true },
    sharedParticipants: { type: [ParticipantShareSchema], default: [] },
    personalExpenses: { type: [ParticipantShareSchema], default: [] },
    itemsBreakdown: { type: [String], default: [] },
    imageUrl: { type: String },
}, {
    timestamps: true
});
exports.default = mongoose_1.default.model('Expense', ExpenseSchema);
