import database, { Schema, Document } from "@/lib/postgres";

export interface IInventory extends Document {
  code: string; // Asset code, e.g. AST-LAP-001
  name: string; // e.g. "MacBook Pro M1"
  category: string; // a key from Setting "inventory_categories" (defaults: laptop, phone, vehicle, other)
  condition: "good" | "damaged" | "lost";
}

const InventorySchema = new Schema<IInventory>({
  code: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true },
  category: { type: String, default: "other", required: true, trim: true },
  condition: { 
    type: String, 
    enum: ["good", "damaged", "lost"], 
    default: "good", 
    required: true 
  },
});

export default database.models.Inventory || database.model<IInventory>("Inventory", InventorySchema);
