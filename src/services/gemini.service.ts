import { Injectable, signal } from '@angular/core';
import { GoogleGenAI, Type } from '@google/genai';
import { Assignment, ParsedReceipt, ReceiptItem } from '../models/bill.model';

@Injectable({
  providedIn: 'root',
})
export class GeminiService {
  private readonly genAI: GoogleGenAI;
  private readonly MODEL_NAME = 'gemini-2.5-flash';

  constructor() {
    // IMPORTANT: The API key is sourced from environment variables for security.
    // Do not hardcode the API key in the application.
    const apiKey = process.env.API_KEY;
    if (!apiKey) {
      throw new Error('API_KEY environment variable not set');
    }
    this.genAI = new GoogleGenAI({ apiKey });
  }

  async parseReceipt(
    base64ImageData: string
  ): Promise<ParsedReceipt> {
    const prompt = `You are an intelligent receipt scanner. Analyze this image and extract all line items with their corresponding prices. Also extract the total tax and tip amounts. Ensure prices, tax, and tip are numbers. Provide the output in a structured JSON format. If tax or tip are not explicitly found, return 0 for them.`;

    try {
      const response = await this.genAI.models.generateContent({
        model: this.MODEL_NAME,
        contents: {
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType: 'image/jpeg',
                data: base64ImageData,
              },
            },
          ],
        },
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              items: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    name: { type: Type.STRING },
                    price: { type: Type.NUMBER },
                  },
                },
              },
              tax: { type: Type.NUMBER },
              tip: { type: Type.NUMBER },
            },
          },
        },
      });

      const jsonString = response.text.trim();
      return JSON.parse(jsonString) as ParsedReceipt;

    } catch (error) {
      console.error('Error parsing receipt with Gemini:', error);
      throw new Error('Failed to parse receipt. Please try again with a clearer image.');
    }
  }

  async assignItems(
    chatMessage: string,
    unassignedItems: ReceiptItem[],
    people: string[]
  ): Promise<Assignment[]> {
    const prompt = `You are a bill splitting assistant. A user wants to assign items from a receipt to different people.
      User's request: "${chatMessage}"
      Unassigned items: ${JSON.stringify(unassignedItems.map(i => ({ name: i.name, price: i.price })))}
      People already involved: ${JSON.stringify(people)}
      
      Your task is to determine which person(s) should be assigned to which item(s) based on the user's request. 
      Respond with a JSON object. The names in your response must match the item names from the provided list exactly.
      If a user says an item is shared, create a separate assignment object for each person involved in the share.
      For example, if 'Sarah and Sue shared the pizza', you should return assignments for both 'Sarah' and 'Sue' for the 'pizza' item.
      Only assign items that are in the unassigned list.
      Capitalize the first letter of each person's name.`;

    try {
        const response = await this.genAI.models.generateContent({
            model: this.MODEL_NAME,
            contents: prompt,
            config: {
                responseMimeType: 'application/json',
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        assignments: {
                            type: Type.ARRAY,
                            items: {
                                type: Type.OBJECT,
                                properties: {
                                    personName: { type: Type.STRING },
                                    itemName: { type: Type.STRING },
                                },
                            },
                        },
                    },
                },
            },
        });

        const jsonString = response.text.trim();
        const result = JSON.parse(jsonString);
        return result.assignments || [];
    } catch (error) {
        console.error('Error assigning items with Gemini:', error);
        throw new Error('I had trouble understanding that. Could you please rephrase?');
    }
  }
}
