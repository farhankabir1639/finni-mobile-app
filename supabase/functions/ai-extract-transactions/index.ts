
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface TransactionData {
  date: string;
  description: string;
  withdraw?: number;
  deposit?: number;
  balance?: number;
  sourceText?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { fileId, rawData, fileType } = await req.json();

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    let extractedTransactions: TransactionData[] = [];

    if (fileType === 'csv' || fileType === 'xlsx') {
      extractedTransactions = await extractFromStructuredData(rawData);
    } else if (fileType === 'pdf') {
      extractedTransactions = await extractFromPDF(rawData);
    }

    // Store extracted transactions in database
    const transactionsToInsert = extractedTransactions.map((tx, index) => ({
      transaction_id: `${fileId}_${index}`,
      file_id: fileId,
      date: tx.date,
      description: tx.description,
      withdraw: tx.withdraw || null,
      deposit: tx.deposit || null,
      balance: tx.balance || null,
      source_text: tx.sourceText || null,
      row_index: index
    }));

    const { data: insertedTransactions, error: insertError } = await supabase
      .from('extracted_transactions')
      .insert(transactionsToInsert)
      .select();

    if (insertError) {
      throw insertError;
    }

    // Update file status to 'extracted'
    await supabase
      .from('user_uploaded_files')
      .update({ status: 'extracted' })
      .eq('id', fileId);

    return new Response(JSON.stringify({
      success: true,
      extractedCount: extractedTransactions.length,
      transactions: insertedTransactions
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in ai-extract-transactions:', error);
    return new Response(JSON.stringify({ 
      error: error.message,
      success: false 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function extractFromStructuredData(rawData: any[]): Promise<TransactionData[]> {
  const transactions: TransactionData[] = [];
  
  for (const row of rawData) {
    // Enhanced column detection logic
    const keys = Object.keys(row);
    
    let date = '';
    let description = '';
    let withdraw: number | undefined;
    let deposit: number | undefined;
    let balance: number | undefined;
    
    // Detect columns by patterns
    for (const key of keys) {
      const keyLower = key.toLowerCase();
      const value = row[key];
      
      // Date detection
      if (/date|dt|txn.*date|transaction.*date/.test(keyLower) && value) {
        date = new Date(value).toISOString();
      }
      
      // Description detection
      if (/description|particulars|narration|details|memo/.test(keyLower) && value) {
        description = String(value).trim();
      }
      
      // Amount detection
      if (/withdraw|debit|dr|outgoing/.test(keyLower) && value && !isNaN(parseFloat(value))) {
        withdraw = parseFloat(value);
      }
      
      if (/deposit|credit|cr|incoming/.test(keyLower) && value && !isNaN(parseFloat(value))) {
        deposit = parseFloat(value);
      }
      
      if (/balance|bal|running.*balance/.test(keyLower) && value && !isNaN(parseFloat(value))) {
        balance = parseFloat(value);
      }
    }
    
    // Only add if we have minimum required data
    if (date && description && (withdraw || deposit)) {
      transactions.push({
        date,
        description,
        withdraw,
        deposit,
        balance,
        sourceText: JSON.stringify(row)
      });
    }
  }
  
  return transactions;
}

async function extractFromPDF(rawText: string): Promise<TransactionData[]> {
  const transactions: TransactionData[] = [];
  const lines = rawText.split('\n').filter(line => line.trim());
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // Look for transaction patterns in the line
    const dateMatch = line.match(/(\d{1,2}[-\/]\w{3}[-\/]\d{2,4}|\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})/);
    const amountMatch = line.match(/(\d{1,3}(?:,\d{3})*\.?\d{0,2})/g);
    
    if (dateMatch && amountMatch && amountMatch.length > 0) {
      const date = new Date(dateMatch[1]).toISOString();
      const description = line.replace(dateMatch[0], '').replace(/[\d,\.]+/g, '').trim();
      
      // Determine if it's debit or credit based on context
      const isCredit = line.toLowerCase().includes('credit') || 
                      line.toLowerCase().includes('deposit') || 
                      line.toLowerCase().includes('inflow');
      
      const amount = parseFloat(amountMatch[amountMatch.length - 1].replace(/,/g, ''));
      
      transactions.push({
        date,
        description: description || `Transaction ${i + 1}`,
        withdraw: isCredit ? undefined : amount,
        deposit: isCredit ? amount : undefined,
        sourceText: line
      });
    }
  }
  
  return transactions;
}
