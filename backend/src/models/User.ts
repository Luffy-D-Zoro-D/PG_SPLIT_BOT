import mongoose, { Document, Schema } from 'mongoose';

export interface IUser extends Document {
  telegramUserId: number;
  whatsappJid?: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema: Schema = new Schema({
  telegramUserId: { type: Number, required: true, unique: true },
  whatsappJid: { type: String, required: false, unique: true, sparse: true },
  username: { type: String, required: false },
  firstName: { type: String, required: false },
  lastName: { type: String, required: false },
}, {
  timestamps: true
});

export default mongoose.model<IUser>('User', UserSchema);
