
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface TransactionExtractionRequest {
  content: string;
  connection_id: string;
  user_id: string;
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
);

// Simple transaction extraction logic (can be enhanced with AI later)
const extractTransactionData = (content: string) => {
  const lowerContent = content.toLowerCase();
  
  // Look for common transaction indicators
  const transactionKeywords = [
    'charged', 'paid', 'transaction', 'purchase', 'payment', 'debit', 'withdrawal',
    'bill', 'invoice', 'receipt', 'order', 'subscription'
  ];
  
  const hasTransactionKeyword = transactionKeywords.some(keyword => 
    lowerContent.includes(keyword)
  );
  
  if (!hasTransactionKeyword) {
    return null;
  }
  
  // Extract amount using regex
  const amountPatterns = [
    /\$(\d+(?:\.\d{2})?)/g,
    /(\d+(?:\.\d{2})?) dollars?/gi,
    /amount:?\s*\$?(\d+(?:\.\d{2})?)/gi,
    /total:?\s*\$?(\d+(?:\.\d{2})?)/gi,
    /charged:?\s*\$?(\d+(?:\.\d{2})?)/gi
  ];
  
  let extractedAmount = null;
  
  for (const pattern of amountPatterns) {
    const matches = content.match(pattern);
    if (matches && matches.length > 0) {
      const amountStr = matches[0].replace(/[^\d.]/g, '');
      const amount = parseFloat(amountStr);
      if (!isNaN(amount) && amount > 0) {
        extractedAmount = amount;
        break;
      }
    }
  }
  
  // Extract description (merchant name or transaction description)
  let description = 'Transaction';
  
  // Look for merchant names or descriptions
  const merchantPatterns = [
    /at\s+([A-Za-z0-9\s]+?)(?:\s+on|\s+for|\.|$)/i,
    /from\s+([A-Za-z0-9\s]+?)(?:\s+on|\s+for|\.|$)/i,
    /payment\s+to\s+([A-Za-z0-9\s]+?)(?:\s+on|\s+for|\.|$)/i,
    /purchase\s+from\s+([A-Za-z0-9\s]+?)(?:\s+on|\s+for|\.|$)/i
  ];
  
  for (const pattern of merchantPatterns) {
    const match = content.match(pattern);
    if (match && match[1]) {
      description = match[1].trim();
      break;
    }
  }
  
  // Calculate confidence score based on extraction quality
  let confidence = 0.5; // Base confidence
  
  if (extractedAmount) confidence += 0.3;
  if (description !== 'Transaction') confidence += 0.2;
  
  return {
    amount: extractedAmount,
    description: description,
    confidence: Math.min(confidence, 1.0)
  };
};

// Simple category suggestion based on description
const suggestCategory = async (description: string, userId: string) => {
  // Get user's categories
  const { data: categories } = await supabase
    .from('categories')
    .select('*')
    .eq('user_id', userId);
  
  if (!categories || categories.length === 0) return null;
  
  const lowerDescription = description.toLowerCase();
  
  // Simple keyword-based category mapping
  const categoryKeywords = {
    food: ['restaurant', 'food', 'cafe', 'pizza', 'burger', 'coffee', 'dining', 'delivery', 'uber eats', 'doordash'],
    transport: ['uber', 'lyft', 'taxi', 'gas', 'fuel', 'parking', 'metro', 'transit', 'airline'],
    shopping: ['amazon', 'walmart', 'target', 'store', 'shop', 'retail', 'clothing', 'shoes'],
    entertainment: ['netflix', 'spotify', 'movie', 'theater', 'concert', 'gaming', 'subscription'],
    utilities: ['electric', 'water', 'internet', 'phone', 'cable', 'utility', 'bill'],
    health: ['pharmacy', 'doctor', 'hospital', 'medical', 'health', 'fitness', 'gym']
  };
  
  for (const [categoryType, keywords] of Object.entries(categoryKeywords)) {
    if (keywords.some(keyword => lowerDescription.includes(keyword))) {
      // Find matching user category
      const matchingCategory = categories.find(cat => 
        cat.name.toLowerCase().includes(categoryType) || 
        keywords.some(keyword => cat.name.toLowerCase().includes(keyword))
      );
      
      if (matchingCategory) {
        return matchingCategory.id;
      }
    }
  }
  
  // Default to first category if no match found
  return categories[0]?.id || null;
};

const handler = async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { content, connection_id, user_id }: TransactionExtractionRequest = await req.json();
    
    if (!content || !connection_id || !user_id) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Extract transaction data
    const extractedData = extractTransactionData(content);
    
    if (!extractedData) {
      return new Response(
        JSON.stringify({ message: 'No transaction data found in content' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Suggest category
    const suggestedCategoryId = await suggestCategory(extractedData.description, user_id);

    // Store extracted transaction
    const { data: extractedTransaction, error } = await supabase
      .from('extracted_transactions')
      .insert([
        {
          user_id,
          connection_id,
          raw_content: content,
          extracted_amount: extractedData.amount,
          extracted_description: extractedData.description,
          suggested_category_id: suggestedCategoryId,
          confidence_score: extractedData.confidence
        }
      ])
      .select()
      .single();

    if (error) {
      console.error('Error storing extracted transaction:', error);
      return new Response(
        JSON.stringify({ error: 'Failed to store extracted transaction' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        extracted_transaction: extractedTransaction,
        extracted_data: extractedData
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in extract-transactions function:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
};

serve(handler);
