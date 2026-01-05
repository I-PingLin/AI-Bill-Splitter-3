export interface ReceiptItem {
  id: number;
  name: string;
  price: number;
  assignedTo: string[];
}

export interface ParsedReceipt {
  items: { name: string; price: number }[];
  tax: number;
  tip: number;
}

export interface Assignment {
  personName: string;
  itemName: string;
}

export interface Person {
  name: string;
  items: ReceiptItem[];
}

export interface BillSummary {
  [personName: string]: {
    subtotal: number;
    tax: number;
    tip: number;
    total: number;
  };
}

export interface ChatMessage {
  role: 'user' | 'model' | 'system';
  text: string;
}
