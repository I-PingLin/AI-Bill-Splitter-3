import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { GeminiService } from './services/gemini.service';
import { ReceiptItem, BillSummary, ChatMessage, Person, Assignment } from './models/bill.model';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule],
})
export class AppComponent {
  private geminiService = inject(GeminiService);

  // App State Signals
  appState = signal<'welcome' | 'parsing' | 'splitting' | 'error'>('welcome');
  errorMessage = signal<string | null>(null);

  // Bill State Signals
  receiptItems = signal<ReceiptItem[]>([]);
  tax = signal(0);
  tip = signal(0);
  
  // People & Assignments
  people = signal<Map<string, Person>>(new Map());

  // Chat State Signals
  chatHistory = signal<ChatMessage[]>([]);
  userMessage = signal('');
  isProcessingChat = signal(false);

  // Computed Signals
  subtotal = computed(() => this.receiptItems().reduce((acc, item) => acc + item.price, 0));
  unassignedItems = computed(() => this.receiptItems().filter(item => item.assignedTo.length === 0));

  billSummary = computed<BillSummary>(() => {
    const summary: BillSummary = {};
    const peopleMap = this.people();
    const totalSubtotal = this.subtotal();
    const overallTax = this.tax();
    const overallTip = this.tip();

    if (totalSubtotal === 0) return {};

    peopleMap.forEach((person, name) => {
      const personSubtotal = person.items.reduce((acc, item) => {
        return acc + (item.price / item.assignedTo.length);
      }, 0);

      const proportion = personSubtotal / totalSubtotal;
      const personTax = overallTax * proportion;
      const personTip = overallTip * proportion;
      const personTotal = personSubtotal + personTax + personTip;

      summary[name] = {
        subtotal: personSubtotal,
        tax: personTax,
        tip: personTip,
        total: personTotal,
      };
    });

    return summary;
  });

  summaryKeys = computed(() => Object.keys(this.billSummary()));
  
  constructor() {
    effect(() => {
        // Automatically scroll chat to bottom on new message
        const chatContainer = document.getElementById('chat-container');
        if (chatContainer) {
            chatContainer.scrollTop = chatContainer.scrollHeight;
        }
    });
  }

  async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) {
      return;
    }

    const file = input.files[0];
    if (!file.type.startsWith('image/')) {
      this.handleError('Please upload an image file.');
      return;
    }

    this.appState.set('parsing');
    this.errorMessage.set(null);

    try {
      const base64String = await this.fileToBase64(file);
      const parsedData = await this.geminiService.parseReceipt(base64String);
      
      this.receiptItems.set(parsedData.items.map((item, index) => ({
        id: index,
        name: item.name,
        price: item.price,
        assignedTo: [],
      })));
      this.tax.set(parsedData.tax);
      this.tip.set(parsedData.tip);

      this.chatHistory.set([{ role: 'system', text: 'Receipt parsed! Tell me who had what. For example, "David had the burger" or "Jane and John shared the fries".' }]);
      this.appState.set('splitting');
    } catch (error) {
        const message = error instanceof Error ? error.message : 'An unknown error occurred.';
        this.handleError(message);
    }
  }

  async handleChatMessage(): Promise<void> {
    const message = this.userMessage().trim();
    if (!message || this.isProcessingChat()) {
      return;
    }

    this.isProcessingChat.set(true);
    this.chatHistory.update(history => [...history, { role: 'user', text: message }]);
    this.userMessage.set('');

    try {
      const peopleNames = Array.from(this.people().keys());
      const assignments = await this.geminiService.assignItems(message, this.unassignedItems(), peopleNames);

      // FIX: Refactored state updates to be immutable. This fixes both the type error
      // and a runtime bug where UI would not update correctly with OnPush change detection.
      if (assignments.length === 0) {
        this.chatHistory.update(history => [...history, { role: 'model', text: "I couldn't find any items to assign from your message. Try again?" }]);
      } else {
        let newReceiptItems = this.receiptItems();
        let newPeople = this.people();

        // Apply assignments immutably
        newReceiptItems = newReceiptItems.map(item => {
            const assignmentsForItem = assignments.filter(a => a.itemName.toLowerCase() === item.name.toLowerCase() && item.assignedTo.length === 0);
            if (assignmentsForItem.length > 0) {
                const newAssignees = assignmentsForItem.map(a => this.capitalize(a.personName));
                return { ...item, assignedTo: [...item.assignedTo, ...newAssignees] };
            }
            return item;
        });

        const peopleToUpdate = new Map<string, Person>(newPeople);
        assignments.forEach(assignment => {
            const updatedItem = newReceiptItems.find(i => i.name.toLowerCase() === assignment.itemName.toLowerCase());
            if (updatedItem) {
                const personName = this.capitalize(assignment.personName);
                const person = peopleToUpdate.get(personName) ?? { name: personName, items: [] };

                // Ensure item is not duplicated in person's list
                if (!person.items.some(i => i.id === updatedItem.id)) {
                    // Create a new person object with the updated item list
                    peopleToUpdate.set(personName, { ...person, items: [...person.items, updatedItem] });
                }
            }
        });
        
        // Sync item references for people who might be sharing
        for(const [name, person] of peopleToUpdate.entries()) {
            const updatedItemsForPerson = person.items.map(i => newReceiptItems.find(newItem => newItem.id === i.id)!)
            peopleToUpdate.set(name, {...person, items: updatedItemsForPerson});
        }

        this.receiptItems.set(newReceiptItems);
        this.people.set(peopleToUpdate);

        const responseText = 'Assigned:' + assignments.map(a => `\n- ${a.itemName} to ${this.capitalize(a.personName)}`).join('');
        this.chatHistory.update(history => [...history, { role: 'model', text: responseText }]);
      }

    } catch (error) {
      const message = error instanceof Error ? error.message : 'An unknown error occurred.';
      this.chatHistory.update(history => [...history, { role: 'model', text: message }]);
    } finally {
      this.isProcessingChat.set(false);
    }
  }

  resetApp(): void {
    this.appState.set('welcome');
    this.errorMessage.set(null);
    this.receiptItems.set([]);
    this.tax.set(0);
    this.tip.set(0);
    this.people.set(new Map());
    this.chatHistory.set([]);
    this.userMessage.set('');
  }
  
  // FIX: Refactored to use immutable updates for signals, preventing UI bugs.
  unassignItem(itemToUnassign: ReceiptItem, personName: string): void {
      this.receiptItems.update(items =>
        items.map(item => {
          if (item.id === itemToUnassign.id) {
            return {
              ...item,
              assignedTo: item.assignedTo.filter(p => p !== personName),
            };
          }
          return item;
        })
      );
      
      this.people.update(currentPeople => {
          const newPeople = new Map(currentPeople);
          const person = newPeople.get(personName);
          if (person) {
              const updatedItems = person.items.filter(i => i.id !== itemToUnassign.id);
              if (updatedItems.length === 0) {
                  newPeople.delete(personName);
              } else {
                  newPeople.set(personName, { ...person, items: updatedItems });
              }
          }
          return newPeople;
      });
  }


  private handleError(message: string): void {
    this.errorMessage.set(message);
    this.appState.set('error');
  }

  private fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const result = reader.result as string;
        // remove prefix e.g. "data:image/jpeg;base64,"
        resolve(result.substring(result.indexOf(',') + 1));
      };
      reader.onerror = (error) => reject(error);
    });
  }
  
  private capitalize(s: string): string {
    if (!s) return '';
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
}
