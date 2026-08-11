import mongoose, { Document, Schema } from 'mongoose';

export interface IProcessedUpdate extends Document {
  updateId: number;
  processedAt: Date;
}

const ProcessedUpdateSchema: Schema = new Schema({
  updateId: { type: Number, required: true, unique: true },
  processedAt: { type: Date, default: Date.now, expires: 86400 } // Auto delete after 24 hours
});

export default mongoose.model<IProcessedUpdate>('ProcessedUpdate', ProcessedUpdateSchema);
